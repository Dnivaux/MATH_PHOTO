"""Export des deux lecteurs OCR du téléphone : pix2text-mfr et pix2text-mfr 1.5 (breezedeus, licence MIT).

Les graphes ONNX publiés (encodeur DeiT + décodeur TrOCR, sans cache) sont repris tels quels, puis déclinés en :
  *.fp32.onnx  référence
  *.fp16.onnx  poids et calculs en float16 (entrées / sorties gardées en float32 ; pas exécutable en WASM)
  *.int8.onnx  MatMul et Gather quantifiés en INT8, quantization dynamique (ce que l'app embarque)

Écrit pour chaque lecteur : config.json (prétraitement, jetons, fichiers et SHA-256) et vocab.json (id -> jeton
ByteLevel). Vérifie que la version FP32 relue par serving/ocr/trocr_onnx.py donne le même texte que
pix2text / transformers sur quelques images.

À lancer depuis la racine du dépôt, dans le venv OCR :
    .venv-ocr/bin/python clients/mobile/scripts/p2t_mfr/export.py
Ensuite : cd clients/mobile && npm run engine-assets
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

READERS = {  # nom -> dépôt Hugging Face, révision figée
    "p2t-mfr": ("breezedeus/pix2text-mfr", "bea257edb2653f2ae413b084f2ac0e8299d08df0"),
    "p2t-mfr-1.5": ("breezedeus/pix2text-mfr-1.5", "1cef9f0bdcd6a4c63df7de1311fb0894593340cc"),
}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def to_fp16(src: Path, dst: Path) -> None:
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16

    # version d'onnxruntime : gère les Cast du graphe (celle d'onnxconverter-common produit un graphe invalide)
    m = convert_float_to_float16(onnx.load(str(src)), keep_io_types=True)
    onnx.save(m, str(dst))


def to_int8(src: Path, dst: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(src), str(dst), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gather"])


def export(name: str, repo: str, rev: str, out: Path) -> None:
    from huggingface_hub import snapshot_download

    src = Path(snapshot_download(repo, revision=rev))
    d = out / name
    d.mkdir(parents=True, exist_ok=True)
    gen = json.loads((src / "generation_config.json").read_text())
    pre = json.loads((src / "preprocessor_config.json").read_text())
    tok = json.loads((src / "tokenizer.json").read_text())
    vocab = [None] * (max(tok["model"]["vocab"].values()) + 1)
    for t, i in tok["model"]["vocab"].items():
        vocab[i] = t
    for a in tok["added_tokens"]:
        vocab[a["id"]] = a["content"]
    (d / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False))

    for part in ("encoder", "decoder"):
        fp32 = d / f"{part}.fp32.onnx"
        shutil.copyfile(src / f"{part}_model.onnx", fp32)
        print(f"  {name} {part} : FP16, INT8")
        to_fp16(fp32, d / f"{part}.fp16.onnx")
        to_int8(fp32, d / f"{part}.int8.onnx")

    variants = {v: {"encoder": f"encoder.{v}.onnx", "decoder": f"decoder.{v}.onnx"} for v in ("fp32", "fp16", "int8")}
    cfg = {
        "name": name, "arch": "trocr", "repo": repo, "revision": rev, "license": "MIT",
        "size": pre["size"]["height"], "mean": pre["image_mean"][0], "std": pre["image_std"][0],
        "start": gen["decoder_start_token_id"], "eos": gen["eos_token_id"], "pad": gen["pad_token_id"],
        "max_tokens": 256,
        "encoder": variants["int8"]["encoder"], "decoder": variants["int8"]["decoder"],  # embarqués dans l'app
        "variants": variants,
        "files": {f.name: {"bytes": f.stat().st_size, "sha256": sha256(f)} for f in sorted(d.glob("*.onnx"))},
    }
    (d / "config.json").write_text(json.dumps(cfg, indent=1))
    for f, meta in cfg["files"].items():
        print(f"  {name}/{f}  {meta['bytes'] / 1e6:.1f} Mo")


def check(name: str, out: Path, data: Path, n: int) -> None:
    """Même texte que transformers (ORTModelForVision2Seq) sur n images : valide prétraitement et détokenisation."""
    from PIL import Image

    from eval.ocr_bench import load_p2t_mfr
    from serving.ocr.trocr_onnx import TrOCROnnx

    labels = [json.loads(line) for line in (data / "labels.jsonl").read_text().splitlines() if line.strip()][:n]
    ours, ref = TrOCROnnx(out / name, "fp32"), load_p2t_mfr(READERS[name][0], 4)
    same = 0
    for lab in labels:
        img = Image.open(data / lab["file"]).convert("RGB")
        a, b = ours(img), ref(img.convert("L").convert("RGB"))
        same += a == b
        if a != b:
            print(f"    différent : {lab['file']}\n      nous : {a}\n      réf. : {b}")
    print(f"  {name} : {same}/{len(labels)} lectures identiques à transformers")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "onnx")
    ap.add_argument("--check", type=Path, default=ROOT / "data/ocr/synthetic", help="images pour la vérification")
    ap.add_argument("--n", type=int, default=20)
    args = ap.parse_args()
    for name, (repo, rev) in READERS.items():
        export(name, repo, rev, args.out)
        if args.n:
            check(name, args.out, args.check, args.n)
    (args.out / "readers.json").write_text(json.dumps({"readers": list(READERS)}, indent=1))


if __name__ == "__main__":
    main()
