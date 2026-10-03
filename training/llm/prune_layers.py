"""Pruning de couches type ShortGPT (dossier, 3B/3C) : on retire les blocs qui changent le moins
leur entrée, mesuré par la Block Influence BI_i = 1 - cos(h_entrée, h_sortie) moyennée sur un jeu de calibration.

    python -m training.llm.prune_layers --model models/qwen3-0.6b-explain --ratio 0.2 \
        --calib data/sft/explain_fr.jsonl --out models/qwen3-0.6b-pruned20

Pruning structuré uniquement : le modèle reste une architecture standard (moins de couches),
donc vLLM et llama.cpp le chargent sans modification.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import mlflow
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from common import tracking
from common.config import read_jsonl


@torch.no_grad()
def block_influence(model, tok, texts: list[str], max_len: int = 512) -> list[float]:
    n_layers = model.config.num_hidden_layers
    sums, count = torch.zeros(n_layers, dtype=torch.float64), 0
    for text in texts:
        enc = tok(text, return_tensors="pt", truncation=True, max_length=max_len).to(model.device)
        hs = model(**enc, output_hidden_states=True).hidden_states  # n_layers + 1 tenseurs
        for i in range(n_layers):
            cos = torch.nn.functional.cosine_similarity(hs[i][0].float(), hs[i + 1][0].float(), dim=-1)
            sums[i] += (1 - cos).sum().double().cpu()
        count += enc["input_ids"].shape[1]
    return (sums / count).tolist()


def drop_layers(model, drop: list[int]):
    keep = [i for i in range(model.config.num_hidden_layers) if i not in set(drop)]
    model.model.layers = torch.nn.ModuleList([model.model.layers[i] for i in keep])
    for new_idx, layer in enumerate(model.model.layers):
        layer.self_attn.layer_idx = new_idx  # index du cache KV
    cfg = model.config
    cfg.num_hidden_layers = len(keep)
    if getattr(cfg, "layer_types", None):
        cfg.layer_types = [cfg.layer_types[i] for i in keep]
    if getattr(cfg, "max_window_layers", None):
        cfg.max_window_layers = min(cfg.max_window_layers, len(keep))
    return model


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--ratio", type=float, default=0.2)
    ap.add_argument("--calib", required=True, help="JSONL SFT (messages + completion)")
    ap.add_argument("--n-calib", type=int, default=256)
    ap.add_argument("--keep-first-last", action="store_true", default=True,
                    help="ne jamais retirer la première ni la dernière couche")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=torch.bfloat16, device_map={"": 0}).eval()
    rows = read_jsonl(args.calib)[: args.n_calib]
    texts = [tok.apply_chat_template(r["messages"], tokenize=False, add_generation_prompt=True, enable_thinking=False)
             + r["completion"] for r in rows]
    bi = block_influence(model, tok, texts)
    n = model.config.num_hidden_layers
    k = round(n * args.ratio)
    candidates = [i for i in range(n) if not (args.keep_first_last and i in (0, n - 1))]
    drop = sorted(sorted(candidates, key=lambda i: bi[i])[:k])
    n_params_before = sum(p.numel() for p in model.parameters())
    model = drop_layers(model, drop)
    n_params_after = sum(p.numel() for p in model.parameters())
    model.save_pretrained(args.out, safe_serialization=True)
    tok.save_pretrained(args.out)
    Path(args.out, "lineage.json").write_text(json.dumps(
        {"parent": args.model, "method": "shortgpt-block-influence", "ratio": args.ratio, "dropped_layers": drop}, indent=1))

    tracking.init()
    with mlflow.start_run(run_name=f"prune-{Path(args.out).name}"):
        mlflow.set_tags({"stage": "prune", "parent": args.model, "method": "shortgpt"})
        mlflow.log_params({"ratio": args.ratio, "n_layers_before": n, "n_layers_after": n - k,
                           "dropped_layers": ",".join(map(str, drop)), "n_calib": len(texts)})
        mlflow.log_metrics({"params_before_m": n_params_before / 1e6, "params_after_m": n_params_after / 1e6})
        for i, v in enumerate(bi):
            mlflow.log_metric("block_influence", v, step=i)
        mlflow.log_dict({"block_influence": bi, "dropped": drop}, "block_influence.json")
    print(f"couches retirées {drop} ; {n_params_before/1e6:.0f}M -> {n_params_after/1e6:.0f}M paramètres -> {args.out}")


if __name__ == "__main__":
    main()
