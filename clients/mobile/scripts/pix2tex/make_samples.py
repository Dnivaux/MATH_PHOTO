"""
Images de test pour le banc d'essai du moteur de l'app (scripts/engine-harness) : formules rendues, puis
dégradées pour imiter une photo de téléphone (perspective légère, flou, ombre, bruit, papier gris).
Écrit aussi la sortie de référence de l'OCR ONNX INT8 en Python, que la version JavaScript doit reproduire.

    uv run make_samples.py ../engine-harness/samples
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageFilter

from export_onnx import FORMULAS, OUT, decode_tokens, greedy, prepare, render, to_tensor

PHOTO = [r"3x-7=11", r"2x^{2}-3x-5=0", r"\frac{2}{3}+\frac{5}{6}", r"\lim_{x\to 0}\frac{\sin x}{x}"]


def photo_like(gray: np.ndarray, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = Image.fromarray(gray).convert("L")
    w, h = img.size
    canvas = Image.new("L", (int(w * 1.6), int(h * 2.2)), 255)
    canvas.paste(img, (int(w * 0.3), int(h * 0.6)))
    canvas = canvas.resize((canvas.width * 3, canvas.height * 3), Image.BICUBIC)
    W, H = canvas.size
    d = W * 0.03
    coeffs = Image.Transform.PERSPECTIVE
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    dst = [(d * rng.uniform(0, 1), d * rng.uniform(0, 1)), (W - d * rng.uniform(0, 1), d * rng.uniform(0, 1)),
           (W - d * rng.uniform(0, 1), H - d * rng.uniform(0, 1)), (d * rng.uniform(0, 1), H - d * rng.uniform(0, 1))]
    a = []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    b = np.array(src).reshape(8)
    p = np.linalg.solve(np.array(a, dtype=float), b)
    canvas = canvas.transform((W, H), coeffs, tuple(p), Image.BICUBIC, fillcolor=255)
    arr = np.array(canvas.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    shade = 0.72 + 0.28 * (xx / W) * (1 - 0.4 * yy / H)  # ombre de la main / éclairage inégal
    arr = arr * 0.86 * shade + rng.normal(0, 5, arr.shape)
    return np.clip(arr, 0, 255).astype(np.uint8)


def main() -> None:
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2
    s = {n: ort.InferenceSession(str(OUT / f"{n}.int8.onnx"), so) for n in ("encoder", "decoder", "resizer")}
    enc = lambda x: s["encoder"].run(None, {"image": x})[0]
    dec = lambda t, m: s["decoder"].run(None, {"tokens": t, "memory": m})[0]
    res = lambda x: s["resizer"].run(None, {"image": x})[0]
    vocab = json.loads((OUT / "vocab.json").read_text())
    cfg = json.loads((OUT / "config.json").read_text())

    class A:
        bos_token, eos_token = cfg["bos"], cfg["eos"]

    samples = []
    for i, latex in enumerate(FORMULAS):
        gray = render(latex)
        items = [("rendu", gray)]
        if latex in PHOTO:
            items.append(("photo", photo_like(gray, i)))
        for kind, img in items:
            name = f"{i:02d}-{kind}.png"
            Image.fromarray(img).save(out / name)
            ids, probs = greedy(enc, dec, to_tensor(prepare(img, res)), A)
            conf = float(np.exp(np.mean(np.log(np.maximum(probs, 1e-9)))))
            samples.append({"file": name, "kind": kind, "latex": latex,
                            "python": decode_tokens(ids, vocab), "confidence": round(conf, 3)})
            print(json.dumps(samples[-1], ensure_ascii=False))
    (out / "samples.json").write_text(json.dumps(samples, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
