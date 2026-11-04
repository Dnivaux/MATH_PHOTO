"""Remise en ordre ponctuelle de MLflow avant la soutenance (docs/BILAN_MODELES_ET_APP.md, section 5).

Rien n'est supprimé : les runs à écarter reçoivent `stage=invalid` et un tag `invalid_reason`, que
`eval/report.py` et l'UI permettent de filtrer. Idempotent.

    .venv/bin/python scripts/mlflow_hygiene.py          # affiche ce qui serait fait
    .venv/bin/python scripts/mlflow_hygiene.py --apply
"""

from __future__ import annotations

import argparse
from pathlib import Path

from mlflow import MlflowClient

from common import tracking
from common.config import MLFLOW_EXPERIMENT, MODELS


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    tracking.init()
    c = MlflowClient()
    exp = c.get_experiment_by_name(MLFLOW_EXPERIMENT)
    runs = c.search_runs([exp.experiment_id], max_results=1000, order_by=["attributes.start_time ASC"])
    actions: list[tuple[str, str, str]] = []  # (run_id, nom, raison)

    def mark(run, reason):
        if run.data.tags.get("invalid_reason") != reason:
            actions.append((run.info.run_id, run.info.run_name, reason))

    by_name: dict[str, list] = {}
    for r in runs:
        by_name.setdefault(r.info.run_name, []).append(r)

    # Baselines d'explication notées avec l'ancien filtre d'hallucination : la première de chaque paire
    for name in ("baseline-qwen3-0.6b", "baseline-qwen3-1.7b"):
        if len(by_name.get(name, [])) > 1:
            mark(by_name[name][0], "ancien filtre d'hallucination (re-noté dans le run suivant du même nom)")
    # « pass4 » lancé en greedy (n=1, T=0) : c'est un second passage greedy
    for r in by_name.get("baseline-math-1.5b-pass4", []):
        if r.data.params.get("n") == "1":
            mark(r, "lancé avec n=1 et T=0 : second passage greedy, pas un pass@4")
    # Enregistrements en échec (upload > 500 Mo), refaits ensuite
    for r in runs:
        if r.info.status == "FAILED" and r.data.tags.get("stage") == "register":
            mark(r, "enregistrement en échec (upload multipart), refait ensuite")
    # Entraînement loggué deux fois (callback MLflow de transformers + tracking.py) : garder celui que le
    # registry cite dans la lignée (tag `run_id` des versions), sinon le premier
    cited = {mv.tags.get("run_id") for rm in c.search_registered_models()
             for mv in c.search_model_versions(f"name='{rm.name}'")}
    for name, rs in by_name.items():
        train = [r for r in rs if r.data.tags.get("stage") == "train"]
        if len(train) > 1:
            keep = next((r for r in train if r.info.run_id in cited), train[0])
            for r in train:
                if r is not keep:
                    mark(r, f"doublon du run d'entraînement {keep.info.run_id[:8]} (double logging)")

    for run_id, name, reason in actions:
        print(f"invalid  {name:32s} {run_id[:8]}  {reason}")
        if args.apply:
            c.set_tag(run_id, "stage", "invalid")
            c.set_tag(run_id, "invalid_reason", reason)

    # Registry : un `champion` ne garde pas l'alias `challenger` ; hash et taille des GGUF en tags
    for rm in c.search_registered_models():
        aliases = rm.aliases or {}
        if "champion" in aliases and aliases.get("challenger") == aliases["champion"]:
            print(f"alias    {rm.name}: retrait de challenger (v{aliases['champion']} est champion)")
            if args.apply:
                c.delete_registered_model_alias(rm.name, "challenger")
        if rm.name.endswith("-gguf"):
            for mv in c.search_model_versions(f"name='{rm.name}'"):
                if "sha256" in mv.tags:
                    continue
                local = next(Path(MODELS, "gguf").glob(f"{rm.name.removesuffix('-gguf')}/registry/*.gguf"), None)
                if local is None:
                    print(f"hash     {rm.name} v{mv.version}: fichier local introuvable, la gateway le calculera")
                    continue
                sha = tracking.file_sha256(local)
                print(f"hash     {rm.name} v{mv.version}: sha256={sha[:12]}…, {local.stat().st_size} octets")
                if args.apply:
                    c.set_model_version_tag(rm.name, mv.version, "sha256", sha)
                    c.set_model_version_tag(rm.name, mv.version, "bytes", str(local.stat().st_size))

    if not args.apply:
        print("\n(simulation : relancer avec --apply)")


if __name__ == "__main__":
    main()
