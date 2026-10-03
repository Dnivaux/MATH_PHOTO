"""Explications françaises à partir des étapes SymPy, filtrées par vérification (dossier, 3C).

Enseignant multilingue (Qwen3-8B ou Qwen2.5-7B-Instruct servi par vLLM) : Qwen2.5-Math est faible en français.
Chaque explication est gardée seulement si toutes ses égalités sont vraies, aucun nombre n'est inventé
et le résultat final est énoncé. Trois niveaux (collège, lycée, supérieur) : la distillation est conditionnée.

    vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --max-model-len 4096
    python -m training.llm.gen_explanations --model qwen3-8b --n-problems 4000 --out data/sft/explain_fr.jsonl
"""

from __future__ import annotations

import argparse
import collections
import random
from concurrent.futures import ProcessPoolExecutor

import mlflow

from common import llm, tracking
from common.config import TRAIN_POOL, VLLM_BASE_URL, read_jsonl, write_jsonl
from common.prompts import LEVELS, explain_messages
from eval.faithfulness import check_explanation


def _check(args):
    text, problem = args
    rep = check_explanation(text, problem)
    return rep.accept(), rep.score, len(rep.hallucinated)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--base-url", default=VLLM_BASE_URL)
    ap.add_argument("--pool", default=str(TRAIN_POOL))
    ap.add_argument("--n-problems", type=int, default=4000)
    ap.add_argument("--k", type=int, default=2, help="explications par (problème, niveau)")
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--max-tokens", type=int, default=900)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    pool = read_jsonl(args.pool)
    random.Random(args.seed).shuffle(pool)
    problems = pool[: args.n_problems]
    model = args.model or llm.served_model(args.base_url)
    jobs = [(p, lvl) for p in problems for lvl in LEVELS]

    tracking.init()
    with mlflow.start_run(run_name=f"gen-explain-{model}"):
        mlflow.set_tags({"stage": "data", "task": "explain", "teacher": model})
        mlflow.log_params(vars(args) | {"served_model": model})
        gens = llm.generate([explain_messages(p, lvl) for p, lvl in jobs], model, base_url=args.base_url, n=args.k,
                            temperature=args.temperature, max_tokens=args.max_tokens, extra_body=llm.NO_THINK)
        flat = [(text, p, lvl) for (p, lvl), g in zip(jobs, gens) for text in g.texts]
        # SymPy est lent et pas thread-safe pour les timeouts : un processus par cœur.
        with ProcessPoolExecutor() as ex:
            checks = list(ex.map(_check, [(t, p) for t, p, _ in flat], chunksize=16))

        rows, kept = [], set()
        stats = collections.Counter()
        for (text, p, lvl), (ok, _score, n_hallu) in zip(flat, checks):
            stats["total"] += 1
            stats["hallucinated"] += n_hallu > 0
            if ok and (p["id"], lvl) not in kept:  # une explication par (problème, niveau)
                kept.add((p["id"], lvl))
                rows.append({"id": p["id"], "type": p["type"], "level": lvl,
                             "messages": explain_messages(p, lvl), "completion": text.strip()})
                stats[f"kept.{lvl}"] += 1
        write_jsonl(args.out, rows)
        metrics = {"accept_rate_pct": 100 * len(rows) / max(1, len(jobs)),
                   "texts_with_hallucination_pct": 100 * stats["hallucinated"] / stats["total"], "rows": len(rows)}
        metrics |= {k: v for k, v in stats.items() if k.startswith("kept.")}
        mlflow.log_metrics(metrics)
        tracking.log_jsonl_dataset(args.out, "sft-explain-fr", "output")
        print(metrics, "->", args.out)


if __name__ == "__main__":
    main()
