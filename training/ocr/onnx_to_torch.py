"""pix2text-mfr n'est publié qu'en ONNX : on reconstruit le modèle PyTorch (VisionEncoderDecoder DeiT + TrOCR)
depuis config.json et on y recopie les poids des graphes, pour pouvoir le réentraîner.

Les biais gardent leur nom ; les matrices des couches linéaires sont des initialiseurs anonymes (onnx::MatMul_*),
transposés : chacun alimente un MatMul dont la sortie est ajoutée à un biais nommé « X.bias », d'où le nom
« X.weight ». Vérification : mêmes sorties qu'ONNX Runtime (encodeur et logits du décodeur) sur une image.

    .venv-ocr/bin/python -m training.ocr.onnx_to_torch --repo breezedeus/pix2text-mfr --out models/ocr/p2t-mfr-torch
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
import onnx
import torch
from huggingface_hub import snapshot_download
from onnx import numpy_helper

REVISIONS = {"breezedeus/pix2text-mfr": "bea257edb2653f2ae413b084f2ac0e8299d08df0",
             "breezedeus/pix2text-mfr-1.5": "1cef9f0bdcd6a4c63df7de1311fb0894593340cc"}


def onnx_weights(path: Path, prefix: str) -> dict[str, np.ndarray]:
    m = onnx.load(str(path))
    inits = {i.name: numpy_helper.to_array(i) for i in m.graph.initializer}
    consumers: dict[str, list] = {}
    for node in m.graph.node:
        for name in node.input:
            consumers.setdefault(name, []).append(node)
    out = {}
    for name, arr in inits.items():
        if not name.startswith("onnx::"):
            out[name] = arr
            continue
        for node in consumers.get(name, []):
            if node.op_type != "MatMul":
                continue
            for add in consumers.get(node.output[0], []):
                bias = next((i for i in add.input if i.endswith(".bias") and i in inits), None)
                if add.op_type == "Add" and bias:
                    out[bias.removesuffix(".bias") + ".weight"] = arr.T
    # projection finale vers le vocabulaire (sans biais) : le MatMul qui produit la sortie « logits »
    producers = {o: node for node in m.graph.node for o in node.output}
    for g_out in m.graph.output:
        node = producers.get(g_out.name)
        if g_out.name == "logits" and node is not None and node.op_type == "MatMul":
            w = next((i for i in node.input if i in inits), None)
            if w is not None:
                out["decoder.output_projection.weight"] = inits[w].T
    return {prefix + k: v for k, v in out.items()}


def convert(repo: str, out: Path) -> Path:
    from transformers import VisionEncoderDecoderConfig, VisionEncoderDecoderModel

    src = Path(snapshot_download(repo, revision=REVISIONS.get(repo)))
    model = VisionEncoderDecoderModel(VisionEncoderDecoderConfig.from_pretrained(src))
    weights = onnx_weights(src / "encoder_model.onnx", "encoder.") | onnx_weights(src / "decoder_model.onnx", "")
    state = model.state_dict()
    loaded, missing = {}, []
    for key, ref in state.items():
        arr = weights.get(key)
        if arr is None and key.startswith("encoder.pooler."):  # inutilisé par VisionEncoderDecoder : absent d'ONNX
            loaded[key] = ref
            continue
        if arr is None or tuple(arr.shape) != tuple(ref.shape):
            missing.append(key)
            continue
        loaded[key] = torch.from_numpy(arr.copy())
    if missing:
        raise SystemExit(f"{len(missing)} poids introuvables dans les graphes ONNX : {missing[:8]}")
    model.load_state_dict(loaded)
    out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out)
    for f in ("preprocessor_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
              "generation_config.json"):
        shutil.copy(src / f, out / f)
    check(model.eval(), src)
    print(f"{repo} -> {out} ({sum(p.numel() for p in model.parameters()) / 1e6:.1f} M paramètres)")
    return out


@torch.no_grad()
def check(model, src: Path) -> None:
    import onnxruntime as ort

    rng = np.random.default_rng(0)
    x = rng.standard_normal((1, 3, 384, 384)).astype(np.float32)
    enc = ort.InferenceSession(str(src / "encoder_model.onnx"), providers=["CPUExecutionProvider"])
    dec = ort.InferenceSession(str(src / "decoder_model.onnx"), providers=["CPUExecutionProvider"])
    mem = enc.run(None, {"pixel_values": x})[0]
    ids = np.array([[model.config.decoder_start_token_id or 1, 5, 17, 42]], dtype=np.int64)
    logits = dec.run(None, {"input_ids": ids, "encoder_hidden_states": mem})[0]
    t_mem = model.encoder(pixel_values=torch.from_numpy(x)).last_hidden_state
    t_logits = model.decoder(input_ids=torch.from_numpy(ids), encoder_hidden_states=t_mem).logits
    e1, e2 = np.abs(t_mem.numpy() - mem).max(), np.abs(t_logits.numpy() - logits).max()
    print(f"écart max PyTorch / ONNX : encodeur {e1:.2e}, logits {e2:.2e}")
    if e1 > 1e-3 or e2 > 1e-2:
        raise SystemExit("le modèle reconstruit ne reproduit pas les graphes ONNX")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="breezedeus/pix2text-mfr")
    ap.add_argument("--out", type=Path, default=Path("models/ocr/p2t-mfr-torch"))
    args = ap.parse_args()
    convert(args.repo, args.out)


if __name__ == "__main__":
    main()
