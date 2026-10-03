"""Images OCR synthétiques (dossier, phase 1) : LaTeX du jeu d'évaluation -> rendu -> augmentations « photo ».

Rendu par matplotlib mathtext (pas besoin d'une installation TeX), plusieurs polices, fonds blanc / papier
quadrillé / gris, puis perspective, rotation, flou, bruit, éclairage inégal.

    python -m training.ocr.make_synthetic --n 300 --out data/ocr/synthetic
    python -m training.ocr.make_synthetic --sheet --n 50 --out data/ocr/real   # planche à imprimer et photographier
"""

from __future__ import annotations

import argparse
import io
import json
import random
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter  # noqa: E402

from common.config import EVAL_SET, read_jsonl  # noqa: E402

FONTSETS = ["cm", "stix", "stixsans", "dejavusans", "dejavuserif"]


def ocr_target(p: dict) -> str | None:
    """Formule à reconnaître : l'expression du problème, sans l'environnement cases (non rendu par mathtext)."""
    latex = p["latex"]
    if "\\begin{cases}" in latex:
        return None
    return latex.replace("\\left(", "(").replace("\\right)", ")")


def render(latex: str, fontset: str, size: int = 28, dpi: int = 200) -> Image.Image:
    with plt.rc_context({"mathtext.fontset": fontset}):
        fig = plt.figure(figsize=(0.01, 0.01))
        fig.text(0, 0, f"${latex}$", fontsize=size)
        buf = io.BytesIO()
        fig.savefig(buf, dpi=dpi, bbox_inches="tight", pad_inches=0.25, transparent=True)
        plt.close(fig)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGBA")


def background(w: int, h: int, rng: random.Random) -> Image.Image:
    kind = rng.choice(["white", "grid", "grey", "lined"])
    base = {"white": 250, "grid": 245, "grey": rng.randint(200, 235), "lined": 248}[kind]
    img = Image.new("RGB", (w, h), (base, base, max(0, base - rng.randint(0, 12))))
    d = ImageDraw.Draw(img)
    if kind == "grid":
        step = rng.randint(18, 30)
        for xx in range(0, w, step):
            d.line([(xx, 0), (xx, h)], fill=(180, 200, 230), width=1)
        for yy in range(0, h, step):
            d.line([(0, yy), (w, yy)], fill=(180, 200, 230), width=1)
    elif kind == "lined":
        for yy in range(0, h, rng.randint(28, 40)):
            d.line([(0, yy), (w, yy)], fill=(170, 190, 220), width=1)
    return img


def augment(formula: Image.Image, rng: random.Random) -> Image.Image:
    pad = rng.randint(20, 80)
    img = background(formula.width + 2 * pad, formula.height + 2 * pad, rng)
    img.paste(formula, (pad, pad), formula)
    if rng.random() < 0.7:  # éclairage inégal / ombre
        arr = np.asarray(img).astype(np.float32)
        h, w = arr.shape[:2]
        gx = np.linspace(rng.uniform(0.6, 1.0), rng.uniform(0.85, 1.1), w)[None, :, None]
        gy = np.linspace(rng.uniform(0.7, 1.05), rng.uniform(0.8, 1.05), h)[:, None, None]
        img = Image.fromarray(np.clip(arr * gx * gy, 0, 255).astype(np.uint8))
    if rng.random() < 0.6:  # perspective légère
        w, h = img.size
        m = 0.06
        quad = [rng.uniform(0, m) * w, rng.uniform(0, m) * h, rng.uniform(0, m) * w, h - rng.uniform(0, m) * h,
                w - rng.uniform(0, m) * w, h - rng.uniform(0, m) * h, w - rng.uniform(0, m) * w, rng.uniform(0, m) * h]
        img = img.transform((w, h), Image.QUAD, quad, resample=Image.BICUBIC, fillcolor=(235, 235, 235))
    img = img.rotate(rng.uniform(-4, 4), resample=Image.BICUBIC, expand=True, fillcolor=(235, 235, 235))
    if rng.random() < 0.5:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.3)))
    if rng.random() < 0.6:
        arr = np.asarray(img).astype(np.float32)
        arr += np.random.default_rng(rng.randint(0, 2**31)).normal(0, rng.uniform(3, 12), arr.shape)
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if rng.random() < 0.5:  # compression JPEG d'un téléphone
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=rng.randint(45, 85))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def make_synthetic(problems, n: int, out: Path, seed: int) -> None:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    labels = []
    candidates = [p for p in problems if ocr_target(p)]
    for attempt in range(n * 3):  # plusieurs rendus par formule si n > nombre de formules
        if len(labels) >= n:
            break
        p = candidates[attempt % len(candidates)] if attempt < len(candidates) else rng.choice(candidates)
        target = ocr_target(p)
        fontset = rng.choice(FONTSETS)
        try:
            img = augment(render(target, fontset), rng)
        except Exception:  # noqa: BLE001  (mathtext ne sait pas tout rendre)
            continue
        name = f"{p['id']}-{fontset}-{attempt:04d}.jpg"
        img.convert("RGB").save(out / name, quality=92)
        labels.append({"file": name, "latex": target, "type": p["type"], "source": "synthetic", "fontset": fontset})
    (out / "labels.jsonl").write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in labels))
    print(f"{len(labels)} images -> {out}")


def make_sheet(problems, n: int, out: Path, seed: int) -> None:
    """PDF à imprimer : formules numérotées, grandes ; on photographie ensuite chaque formule au téléphone
    et on nomme la photo photo_XX.jpg (XX = numéro). Les étiquettes sont déjà dans labels.jsonl."""
    from matplotlib.backends.backend_pdf import PdfPages

    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    chosen = [p for p in rng.sample(problems, len(problems)) if ocr_target(p)][:n]
    labels = []
    with PdfPages(out / "planche_a_imprimer.pdf") as pdf:
        for page in range(0, len(chosen), 6):
            fig = plt.figure(figsize=(8.27, 11.69))
            for k, p in enumerate(chosen[page:page + 6]):
                num = page + k + 1
                y = 0.9 - k * 0.155
                fig.text(0.06, y, f"#{num:02d}", fontsize=12, color="grey")
                fig.text(0.16, y, f"${ocr_target(p)}$", fontsize=22)
                labels.append({"file": f"photo_{num:02d}.jpg", "latex": ocr_target(p), "type": p["type"], "source": "real"})
            pdf.savefig(fig)
            plt.close(fig)
    (out / "labels.jsonl").write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in labels))
    print(f"planche : {out/'planche_a_imprimer.pdf'} ({len(labels)} formules). Photos attendues : {out}/photo_XX.jpg")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--out", default="data/ocr/synthetic")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()
    problems = read_jsonl(EVAL_SET)
    (make_sheet if args.sheet else make_synthetic)(problems, args.n, Path(args.out), args.seed)


if __name__ == "__main__":
    main()
