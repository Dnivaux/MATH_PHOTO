"""Fine-tuning supervisé générique : QLoRA, LoRA ou complet, tracé dans MLflow.

Sert pour toutes les étapes LLM du week-end (même script, mêmes logs) :
    # QLoRA du 7B (nuit de samedi)  -> teacher-ft
    python -m training.llm.sft --base Qwen/Qwen2.5-Math-7B-Instruct --data data/sft/code_7b_raw.jsonl \
        --method qlora --r 16 --out models/teacher-ft-lora --run-name qlora-7b-r16
    # Distillation 1,5B (codes de teacher-ft)
    python -m training.llm.sft --base Qwen/Qwen2.5-Math-1.5B-Instruct --data data/sft/code_teacher_ft.jsonl \
        --method full --lr 1e-5 --out models/math-1.5b-distill --run-name distill-1.5b
    # Distillation Qwen3-0.6B (explications françaises)
    python -m training.llm.sft --base Qwen/Qwen3-0.6B --data data/sft/explain_fr.jsonl \
        --method full --lr 2e-5 --out models/qwen3-0.6b-explain --run-name distill-qwen3-0.6b
    # LoRA de réparation après pruning
    python -m training.llm.sft --base models/qwen3-0.6b-pruned20 --data data/sft/explain_fr.jsonl \
        --method lora --r 32 --epochs 1 --out models/qwen3-0.6b-pruned20-repair-lora --run-name repair-pruned20

Les prompts sont rendus avec le chat template du modèle (Qwen3 : enable_thinking=False, comme à l'inférence),
et la perte ne porte que sur la complétion.
"""

from __future__ import annotations

import argparse
import json
import os

import mlflow
import torch
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from common import tracking
from common.config import read_jsonl


def build_dataset(path: str, tokenizer, seed: int, eval_frac: float):
    rows = []
    for r in read_jsonl(path):
        prompt = tokenizer.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True,
                                               enable_thinking=False)
        rows.append({"prompt": prompt, "completion": r["completion"] + tokenizer.eos_token})
    ds = Dataset.from_list(rows).shuffle(seed=seed)
    n_eval = max(1, int(len(ds) * eval_frac)) if eval_frac > 0 else 0
    return ds.select(range(n_eval, len(ds))), (ds.select(range(n_eval)) if n_eval else None)


def main() -> None:
    from peft import LoraConfig, prepare_model_for_kbit_training
    from trl import SFTConfig, SFTTrainer

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="id HF ou dossier local")
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--method", choices=["qlora", "lora", "full"], default="qlora")
    ap.add_argument("--r", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=None, help="défaut : 2 r")
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--lr", type=float, default=None, help="défaut : 2e-4 (LoRA) / 1e-5 (complet)")
    ap.add_argument("--bs", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--max-len", type=int, default=1536)
    ap.add_argument("--eval-frac", type=float, default=0.02)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--parent", default=None, help="lignée : modèle parent (registry ou id HF)")
    args = ap.parse_args()

    lora = args.method in ("qlora", "lora")
    lr = args.lr or (2e-4 if lora else 1e-5)
    tracking.init()
    os.environ["MLFLOW_FLATTEN_PARAMS"] = "1"

    tok = AutoTokenizer.from_pretrained(args.base)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    train_ds, eval_ds = build_dataset(args.data, tok, args.seed, args.eval_frac)

    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                               bnb_4bit_compute_dtype=torch.bfloat16) if args.method == "qlora" else None
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16, quantization_config=quant,
                                                 attn_implementation="sdpa", device_map={"": 0})
    if args.method == "qlora":
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    peft_config = LoraConfig(r=args.r, lora_alpha=args.alpha or 2 * args.r, lora_dropout=0.05,
                             target_modules="all-linear", task_type="CAUSAL_LM") if lora else None

    cfg = SFTConfig(
        output_dir=args.out, run_name=args.run_name, num_train_epochs=args.epochs, learning_rate=lr,
        per_device_train_batch_size=args.bs, per_device_eval_batch_size=args.bs,
        gradient_accumulation_steps=args.grad_accum, lr_scheduler_type="cosine", warmup_ratio=0.03,
        bf16=True, gradient_checkpointing=True, max_length=args.max_len, packing=False,
        optim="paged_adamw_8bit" if lora else "adamw_torch_fused",
        logging_steps=10, eval_strategy="steps" if eval_ds is not None else "no", eval_steps=100,
        save_strategy="no", report_to=["mlflow"], seed=args.seed,
    )
    with mlflow.start_run(run_name=args.run_name):
        mlflow.set_tags({"stage": "train", "method": args.method, "base": args.base,
                         "parent": args.parent or args.base})
        tracking.log_jsonl_dataset(args.data, os.path.basename(args.data), "train")
        trainer = SFTTrainer(model=model, args=cfg, train_dataset=train_ds, eval_dataset=eval_ds,
                             processing_class=tok, peft_config=peft_config)
        if lora:
            trainer.model.print_trainable_parameters()
        result = trainer.train()
        trainer.save_model(args.out)
        tok.save_pretrained(args.out)
        with open(os.path.join(args.out, "lineage.json"), "w") as f:
            json.dump({"base": args.base, "data": args.data, "method": args.method, "run_id": mlflow.active_run().info.run_id,
                       "data_sha256": tracking.file_sha256(args.data)}, f, indent=1)
        mlflow.log_metrics({"train_runtime_min": result.metrics.get("train_runtime", 0) / 60,
                            "gpu_peak_gb": torch.cuda.max_memory_allocated() / 2**30})
        print(f"modèle sauvé dans {args.out} (run {mlflow.active_run().info.run_id})")


if __name__ == "__main__":
    main()
