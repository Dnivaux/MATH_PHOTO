"""Enregistre un modèle (dossier HF fusionné, adapter LoRA ou GGUF) dans le registry MLflow, avec sa lignée.

    python -m training.llm.register --dir models/teacher-ft-lora --name math-7b-teacher --alias challenger \
        --eval-run <run_id de l'éval>
Le run d'éval (metrics) est relié par un tag ; l'alias `champion` n'est donné qu'après comparaison.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mlflow

from common import tracking


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--name", required=True, help="nom dans le registry, ex. math-7b-teacher, explainer-0.6b")
    ap.add_argument("--alias", default="challenger")
    ap.add_argument("--eval-run", default=None)
    ap.add_argument("--tags", default="{}")
    args = ap.parse_args()

    lineage = Path(args.dir, "lineage.json")
    lin = json.loads(lineage.read_text()) if lineage.exists() else {}
    tags = {k: str(v) for k, v in {**lin, **json.loads(args.tags)}.items()}
    if args.eval_run:
        tags["eval_run"] = args.eval_run
    tracking.init()
    with mlflow.start_run(run_name=f"register-{args.name}"):
        mlflow.set_tags({"stage": "register", **tags})
        size_mb = sum(f.stat().st_size for f in Path(args.dir).rglob("*") if f.is_file()) / 2**20
        mlflow.log_metric("size_mb", size_mb)
        version = tracking.register_dir(args.dir, args.name, alias=args.alias, parent=lin.get("parent") or lin.get("base"),
                                        tags=tags)
    print(f"{args.name} v{version} (alias {args.alias}), {size_mb:.0f} Mo")


if __name__ == "__main__":
    main()
