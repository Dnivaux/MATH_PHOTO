"""Données problème -> code SymPy, filtrées par exécution (dossier, 3B).

Le modèle servi par vLLM génère --k codes par problème du pool d'entraînement ; on ne garde que ceux qui
s'exécutent, donnent la solution SymPy ET tournent seuls (code autonome). Au plus --keep par problème.

    # Samedi soir, données du QLoRA : le 7B brut
    python -m training.llm.gen_code_data --model qwen-math-7b --k 8 --out data/sft/code_7b_raw.jsonl
    # Dimanche matin, données de distillation du 1,5B : teacher-ft
    python -m training.llm.gen_code_data --model teacher-ft --k 4 --out data/sft/code_teacher_ft.jsonl

Sortie : JSONL {"id", "type", "messages": [system, user], "completion": "```python ...```"}.
"""

from __future__ import annotations

import argparse
import collections
import random
from concurrent.futures import ThreadPoolExecutor

import mlflow

from common import llm, tracking
from common.config import TRAIN_POOL, VLLM_BASE_URL, read_jsonl, write_jsonl
from common.prompts import code_messages, extract_code
from serving.sandbox import run_code, run_standalone


def _check(job):
    code, check = job
    if code is None:
        return False
    r = run_code(code, check)
    return bool(r.correct) and run_standalone(code)[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--base-url", default=VLLM_BASE_URL)
    ap.add_argument("--pool", default=str(TRAIN_POOL))
    ap.add_argument("--n-problems", type=int, default=6000)
    ap.add_argument("--k", type=int, default=8, help="échantillons par problème")
    ap.add_argument("--keep", type=int, default=2, help="codes justes gardés au plus par problème")
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--max-tokens", type=int, default=768)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    pool = read_jsonl(args.pool)
    random.Random(args.seed).shuffle(pool)
    problems = pool[: args.n_problems]
    model = args.model or llm.served_model(args.base_url)

    tracking.init()
    with mlflow.start_run(run_name=f"gen-code-{model}"):
        mlflow.set_tags({"stage": "data", "task": "code", "teacher": model})
        mlflow.log_params(vars(args) | {"served_model": model})
        tracking.log_jsonl_dataset(args.pool, "train-pool", "source")

        gens = llm.generate([code_messages(p) for p in problems], model, base_url=args.base_url, n=args.k,
                            temperature=args.temperature, max_tokens=args.max_tokens)
        jobs, owners = [], []
        for i, (p, g) in enumerate(zip(problems, gens)):
            for text in g.texts:
                jobs.append((extract_code(text), p["check"]))
                owners.append(i)
        with ThreadPoolExecutor(max(2, (__import__("os").cpu_count() or 4) - 2)) as ex:
            ok = list(ex.map(_check, jobs))

        kept, seen = collections.defaultdict(list), set()
        for (code, _), good, i in zip(jobs, ok, owners):
            norm = "\n".join(l.rstrip() for l in (code or "").splitlines() if l.strip())
            if good and len(kept[i]) < args.keep and (i, norm) not in seen:
                seen.add((i, norm))
                kept[i].append(code)
        rows = [{"id": problems[i]["id"], "type": problems[i]["type"], "difficulty": problems[i]["difficulty"],
                 "messages": code_messages(problems[i]), "completion": f"```python\n{code}\n```"}
                for i, codes in kept.items() for code in codes]
        write_jsonl(args.out, rows)

        solved = collections.Counter(problems[i]["type"] for i in kept)
        total = collections.Counter(p["type"] for p in problems)
        metrics = {"samples": len(jobs), "samples_correct_pct": 100 * sum(ok) / len(ok),
                   "problems_solved_pct": 100 * len(kept) / len(problems), "rows": len(rows)}
        metrics |= {f"solved_pct.{t}": 100 * solved[t] / total[t] for t in total}
        mlflow.log_metrics(metrics)
        tracking.log_jsonl_dataset(args.out, "sft-code", "output")
        print(metrics, "->", args.out)


if __name__ == "__main__":
    main()
