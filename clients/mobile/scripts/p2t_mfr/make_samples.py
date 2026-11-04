"""Références Python des lecteurs OCR pour le banc navigateur (scripts/engine-harness) : pour chaque image de
samples/, la lecture de chaque lecteur INT8 par serving/ocr/trocr_onnx.py. Le JavaScript de l'app doit lire pareil.

    .venv-ocr/bin/python clients/mobile/scripts/p2t_mfr/make_samples.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[3]))

from PIL import Image  # noqa: E402

from serving.ocr.trocr_onnx import TrOCROnnx  # noqa: E402

SAMPLES = HERE.parent / "engine-harness/samples"


def main() -> None:
    onnx = HERE / "onnx"
    names = json.loads((onnx / "readers.json").read_text())["readers"]
    readers = [TrOCROnnx(onnx / n, "int8") for n in names]
    path = SAMPLES / "samples.json"
    samples = json.loads(path.read_text())
    for s in samples:
        img = Image.open(SAMPLES / s["file"]).convert("RGB")
        out = [r.read(img) for r in readers]
        s["readers"] = names
        s["python"] = [text for text, _ in out]
        s["confidence"] = [round(c, 3) for _, c in out]
        print(f"{s['file']:14s} {s['latex']:28s} " + "  |  ".join(s["python"]))
    path.write_text(json.dumps(samples, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
