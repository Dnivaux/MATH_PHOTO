"""Fusionne un adapter LoRA dans son modèle de base (bf16) pour le servir avec vLLM ou le convertir en GGUF.

    python -m training.llm.merge_lora --adapter models/teacher-ft-lora --out models/teacher-ft
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch
from peft import PeftConfig, PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    base = PeftConfig.from_pretrained(args.adapter).base_model_name_or_path
    model = AutoModelForCausalLM.from_pretrained(base, dtype=torch.bfloat16, device_map={"": 0})
    model = PeftModel.from_pretrained(model, args.adapter).merge_and_unload()
    model.save_pretrained(args.out, safe_serialization=True)
    AutoTokenizer.from_pretrained(args.adapter).save_pretrained(args.out)
    lineage = Path(args.adapter, "lineage.json")
    if lineage.exists():
        d = json.loads(lineage.read_text()) | {"merged_from_adapter": args.adapter}
        Path(args.out, "lineage.json").write_text(json.dumps(d, indent=1))
    # vLLM lit generation_config.json : on garde celui de la base (eos, top_p...).
    for f in ("generation_config.json",):
        src = Path(args.adapter, f)
        if src.exists():
            shutil.copy(src, Path(args.out, f))
    print(f"fusionné : {base} + {args.adapter} -> {args.out}")


if __name__ == "__main__":
    main()
