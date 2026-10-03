"""Trace les GGUF (taille, vitesse CPU par quantization) dans MLflow et enregistre le Q4_K_M au registry."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mlflow

from common import tracking


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--parent", required=True)
    ap.add_argument("--register-quant", default="q4_k_m")
    args = ap.parse_args()
    out = Path(args.dir)
    tracking.init()
    with mlflow.start_run(run_name=f"gguf-{args.name}"):
        mlflow.set_tags({"stage": "quantize", "parent": args.parent, "format": "gguf"})
        for q in ("f16", "q8_0", "q4_k_m"):
            f = out / f"{args.name}-{q}.gguf"
            mlflow.log_metric(f"size_mb.{q}", f.stat().st_size / 2**20)
            bench = out / f"bench-{q}.json"
            if bench.exists():
                for r in json.loads(bench.read_text()):
                    kind = "pp" if r["n_prompt"] else "tg"
                    mlflow.log_metric(f"cpu4t_{kind}_tok_s.{q}", r["avg_ts"])
        mlflow.log_param("imatrix", (out / "imatrix.gguf").exists())
        reg = out / "registry"
        reg.mkdir(exist_ok=True)
        target = reg / f"{args.name}-{args.register_quant}.gguf"
        if not target.exists():
            target.hardlink_to(out / f"{args.name}-{args.register_quant}.gguf")
        (reg / "lineage.json").write_text(json.dumps({"parent": args.parent, "quant": args.register_quant}))
        v = tracking.register_dir(str(reg), f"{args.name}-gguf", alias="challenger", parent=args.parent,
                                  tags={"quant": args.register_quant})
        print(f"{args.name}-gguf v{v} enregistré")


if __name__ == "__main__":
    main()
