"""Construit le jeu d'évaluation figé et le pool d'entraînement, avec tests de données, et trace tout dans MLflow.

    python -m datagen.build_sets eval  --per-type 50              # 250 problèmes, graine fixe -> data/eval/problems_v1.jsonl
    python -m datagen.build_sets train --per-type 3000            # pool disjoint de l'éval -> data/train/pool_v1.jsonl

Tests (dossier, phase 1) : étapes vérifiées, code de référence juste, pas de doublon, pas de fuite éval/entraînement,
distribution par type et difficulté. Le build échoue si un test ne passe pas.
"""

from __future__ import annotations

import argparse
import collections
import random
import sys

from common.config import EVAL_SET, TRAIN_POOL, read_jsonl, write_jsonl
from datagen.problems import TYPES, generate, verify_steps
from serving.sandbox import run_many

DIFFICULTY_WEIGHTS = {1: 0.3, 2: 0.4, 3: 0.3}


def build(per_type: int, seed: int, exclude_ids: set[str], max_tries_factor: int = 20) -> list[dict]:
    rng = random.Random(seed)
    out, seen = [], set(exclude_ids)
    for ptype in TYPES:
        n, tries = 0, 0
        while n < per_type and tries < per_type * max_tries_factor:
            tries += 1
            d = rng.choices(list(DIFFICULTY_WEIGHTS), list(DIFFICULTY_WEIGHTS.values()))[0]
            p = generate(ptype, rng, d)
            if p["id"] in seen:
                continue
            seen.add(p["id"])
            out.append(p)
            n += 1
        if n < per_type:
            print(f"[warn] {ptype}: seulement {n}/{per_type} problèmes uniques", file=sys.stderr)
    return out


def data_tests(problems: list[dict], exclude_ids: set[str], check_code: bool) -> dict:
    ids = [p["id"] for p in problems]
    report = {
        "n": len(problems),
        "duplicates": len(ids) - len(set(ids)),
        "leak_with_eval": len(set(ids) & exclude_ids),
        "bad_steps": sum(bool(verify_steps(p)) for p in problems),
        "by_type": dict(collections.Counter(p["type"] for p in problems)),
        "by_difficulty": dict(collections.Counter(p["difficulty"] for p in problems)),
        "by_route": dict(collections.Counter(p["route"] for p in problems)),
    }
    if check_code:
        res = run_many([(p["reference_code"], p["check"]) for p in problems], timeout=10)
        report["bad_reference_code"] = sum(not r.correct for r in res)
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("split", choices=["eval", "train"])
    ap.add_argument("--per-type", type=int, default=50)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-mlflow", action="store_true")
    args = ap.parse_args()

    out = args.out or (EVAL_SET if args.split == "eval" else TRAIN_POOL)
    seed = args.seed if args.seed is not None else (2026 if args.split == "eval" else 1)
    exclude = set()
    if args.split == "train":
        exclude = {p["id"] for p in read_jsonl(EVAL_SET)}  # jamais de problème d'éval à l'entraînement
    elif EVAL_SET.exists() and str(out) == str(EVAL_SET):
        sys.exit(f"{EVAL_SET} existe déjà : le jeu d'évaluation est figé. Change --out pour en créer un autre.")

    problems = build(args.per_type, seed, exclude)
    # Vérifier le code de référence de 20 000 problèmes prend du temps : sur le pool, on teste un échantillon.
    report = data_tests(problems if args.split == "eval" else random.Random(0).sample(problems, min(500, len(problems))),
                        exclude, check_code=True)
    report["n"] = len(problems)
    print(report)
    failed = report["duplicates"] or report["leak_with_eval"] or report["bad_steps"] or report.get("bad_reference_code")
    if failed:
        sys.exit("tests de données en échec : rien n'est écrit")
    write_jsonl(out, problems)
    print(f"écrit : {out}")

    if not args.no_mlflow:
        import mlflow

        from common import tracking

        tracking.init()
        with mlflow.start_run(run_name=f"data-{args.split}"):
            mlflow.set_tags({"stage": "data", "split": args.split})
            mlflow.log_params({"per_type": args.per_type, "seed": seed, "generator": "datagen.problems v1"})
            tracking.log_jsonl_dataset(out, f"problems-{args.split}", args.split)
            mlflow.log_dict(report, "data_report.json")
            mlflow.log_metrics({k: v for k, v in report.items() if isinstance(v, int)})


if __name__ == "__main__":
    main()
