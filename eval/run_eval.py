"""Banc d'évaluation unique (dossier, phase 2), appelé à la fin de chaque étape du pipeline.

Tâche « code » (LLM de maths) :
    exactitude d'exécution, taux d'exécution, code autonome, rejets de l'analyse statique, timeouts,
    pass@k si --n > 1, latence et débit ; détail par type et par difficulté.
Tâche « explain » (LLM de raisonnement) :
    fidélité (égalités vraies), hallucination (nombres inventés), taux d'acceptation, par niveau.

Le modèle est servi par un serveur compatible OpenAI (vLLM ou llama-server pour les GGUF) :
    python -m eval.run_eval code    --model qwen-math-7b --run-name baseline-7b
    python -m eval.run_eval explain --model qwen3-0.6b   --run-name baseline-qwen3-0.6b --levels lycee
"""

from __future__ import annotations

import argparse
import collections
import json
import statistics
import tempfile
import time
from math import comb
from pathlib import Path

import mlflow

from common import llm, tracking
from common.config import EVAL_SET, VLLM_BASE_URL, read_jsonl, write_jsonl
from common.prompts import code_messages, explain_messages, extract_code
from eval.faithfulness import check_explanation
from serving.sandbox import run_many, run_standalone


def pass_at_k(n: int, c: int, k: int) -> float:
    """Estimateur non biaisé de pass@k (Chen et al., 2021)."""
    if n - c < k:
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def _pct(values) -> float:
    values = list(values)
    return 100.0 * sum(values) / len(values) if values else 0.0


def _breakdown(rows, key, metric) -> dict:
    groups = collections.defaultdict(list)
    for r in rows:
        groups[r[key]].append(r[metric])
    return {f"{metric}.{key}.{g}": _pct(v) for g, v in sorted(groups.items())}


def eval_code(problems, gens, n: int, check_autonomy: bool) -> tuple[dict, list[dict]]:
    jobs, index = [], []
    for i, (p, g) in enumerate(zip(problems, gens)):
        for j, text in enumerate(g.texts):
            code = extract_code(text)
            index.append((i, j, code))
            jobs.append((code or "raise SystemExit('pas de code')", p["check"]))
    results = run_many(jobs)
    per_problem = collections.defaultdict(list)
    rows = []
    for (i, j, code), res in zip(index, results):
        p = problems[i]
        row = {"id": p["id"], "type": p["type"], "difficulty": p["difficulty"], "sample": j, "code": code,
               "has_code": code is not None, "status": res.status, "correct": bool(res.correct),
               "executed": res.status == "ok", "result": res.result, "error": res.error,
               "exec_ms": res.elapsed_ms, "latency_s": gens[i].latency_s}
        if check_autonomy and j == 0 and code:
            ok, last = run_standalone(code)
            row["autonomous"] = ok
        per_problem[i].append(row["correct"])
        rows.append(row)
    first = [r for r in rows if r["sample"] == 0]
    m = {
        "exec_accuracy": _pct(r["correct"] for r in first),
        "exec_rate": _pct(r["executed"] for r in first),
        "no_code_rate": _pct(not r["has_code"] for r in first),
        "rejected_rate": _pct(r["status"] == "rejected" for r in first),
        "timeout_rate": _pct(r["status"] == "timeout" for r in first),
        "exec_ms_p50": statistics.median(r["exec_ms"] for r in first),
    }
    if check_autonomy:
        m["autonomous_rate"] = _pct(r.get("autonomous", False) for r in first)
    if n > 1:
        for k in sorted({1, min(4, n), n}):
            m[f"pass_at_{k}"] = 100 * statistics.mean(pass_at_k(len(c), sum(c), k) for c in per_problem.values())
    m.update(_breakdown(first, "type", "correct"))
    m.update(_breakdown(first, "difficulty", "correct"))
    return m, rows


def eval_explain(problems, gens, level: str) -> tuple[dict, list[dict]]:
    rows = []
    for p, g in zip(problems, gens):
        text = g.texts[0]
        rep = check_explanation(text, p)
        rows.append({"id": p["id"], "type": p["type"], "level": level, "text": text, **rep.to_dict(),
                     "accepted": rep.accept(), "latency_s": g.latency_s})
    m = {
        f"faithfulness.{level}": 100 * statistics.mean(r["score"] for r in rows),
        f"hallucination_rate.{level}": 100 * statistics.mean(r["hallucination_rate"] for r in rows),
        f"accept_rate.{level}": _pct(r["accepted"] for r in rows),
        f"final_answer_rate.{level}": _pct(r["final_answer_stated"] for r in rows),
        f"unparsed_per_text.{level}": statistics.mean(r["n_unparsed"] for r in rows),
    }
    m.update({f"{k}.{level}": v for k, v in _breakdown(rows, "type", "accepted").items()})
    return m, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("task", choices=["code", "explain"])
    ap.add_argument("--model", default=None, help="nom du modèle servi (défaut : le premier listé)")
    ap.add_argument("--base-url", default=VLLM_BASE_URL)
    ap.add_argument("--eval-file", default=str(EVAL_SET))
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--role", default="baseline", help="baseline | teacher-ft | distilled | pruned | quantized ...")
    ap.add_argument("--n", type=int, default=1, help="échantillons par problème (pass@k)")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--max-tokens", type=int, default=1024)
    ap.add_argument("--concurrency", type=int, default=64)
    ap.add_argument("--levels", default="lycee", help="explain : niveaux séparés par des virgules")
    ap.add_argument("--no-think", action="store_true", help="Qwen3 : désactive le mode thinking")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--extra-tags", default="{}", help='tags JSON, ex. {"quant": "Q4_K_M"}')
    args = ap.parse_args()

    problems = read_jsonl(args.eval_file)[: args.limit]
    model = args.model or llm.served_model(args.base_url)
    extra = llm.NO_THINK if args.no_think else None
    tracking.init()
    with mlflow.start_run(run_name=args.run_name):
        mlflow.set_tags({"stage": "eval", "task": args.task, "role": args.role, "model": model,
                         **json.loads(args.extra_tags)})
        mlflow.log_params({k: v for k, v in vars(args).items() if k not in ("extra_tags",)} | {"served_model": model})
        tracking.log_jsonl_dataset(args.eval_file, "eval-problems", "eval")
        t0 = time.perf_counter()
        metrics, all_rows = {}, []
        if args.task == "code":
            gens = llm.generate([code_messages(p) for p in problems], model, base_url=args.base_url, n=args.n,
                                temperature=args.temperature if args.n == 1 else max(args.temperature, 0.7),
                                max_tokens=args.max_tokens, concurrency=args.concurrency, extra_body=extra)
            metrics, all_rows = eval_code(problems, gens, args.n, check_autonomy=True)
        else:
            for level in args.levels.split(","):
                gens = llm.generate([explain_messages(p, level) for p in problems], model, base_url=args.base_url,
                                    temperature=args.temperature, max_tokens=args.max_tokens,
                                    concurrency=args.concurrency, extra_body=extra)
                m, rows = eval_explain(problems, gens, level)
                metrics.update(m)
                all_rows += rows
        wall = time.perf_counter() - t0
        lat = [g.latency_s for g in gens]
        toks = sum(g.completion_tokens for g in gens)
        metrics.update({"latency_p50_s": statistics.median(lat), "latency_p95_s": sorted(lat)[int(0.95 * (len(lat) - 1))],
                        "throughput_tok_s": toks / wall, "wall_s": wall,
                        "completion_tokens_mean": toks / max(1, sum(len(g.texts) for g in gens))})
        mlflow.log_metrics(metrics)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "predictions.jsonl"
            write_jsonl(path, all_rows)
            mlflow.log_artifact(str(path))
        headline = {k: round(v, 2) for k, v in metrics.items() if "." not in k or k.split(".")[0] in ("faithfulness", "accept_rate")}
        print(json.dumps(headline, indent=1))


if __name__ == "__main__":
    main()
