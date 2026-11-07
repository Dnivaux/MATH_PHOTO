"""Images OCR « encombrées » : ce que l'utilisateur cadre vraiment sur une feuille d'exercices ou un écran.

Autour de la formule : morceaux des lignes voisines coupés par le bord du cadre, numéro d'exercice à gauche
(« 3. », « #07 », « a) »), ponctuation à droite, et pour un écran, moiré et grille de pixels. Puis les mêmes
effets « photo » que le banc synthétique (perspective, flou, bruit, éclairage, JPEG).

    python -m training.ocr.clutter --n 300 --out data/ocr/clutter --seed 1
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from PIL import Image

from common.config import EVAL_SET, read_jsonl
from training.ocr.make_synthetic import FONTSETS, background, ocr_target, photo_effects, render

PREFIXES = ["{n}.", "{n})", "#{n:02d}", "{a})", r"\bullet", "-", "Ex {n}"]
SUFFIXES = [";", ".", ",", "({n})"]


def _text(s: str, fontset: str, size: int) -> Image.Image:
    tex = s if s.startswith("\\") else r"\mathrm{" + s.replace(" ", r"\ ").replace("#", r"\#") + "}"
    return render(tex, fontset, size)


def compose(target: Image.Image, others: list[Image.Image], fontset: str, size: int, rng: random.Random,
            screen: bool, marks: bool = True) -> Image.Image:
    """marks=False : lignes voisines seulement, sans numéro ni ponctuation (formule manuscrite : un numéro imprimé
    plus gros qu'elle ne serait pas reconnu comme tel)."""
    fh = target.height
    parts = [(target, 0)]
    x = target.width
    left = right = 0
    if marks and rng.random() < 0.6:  # numéro d'exercice
        n = rng.randint(1, 30)
        pre = _text(rng.choice(PREFIXES).format(n=n, a="abcdef"[n % 6]), fontset, size)
        left = pre.width + rng.randint(int(0.6 * fh), int(2.5 * fh))
        parts.append((pre, -left))
    if marks and rng.random() < 0.3:
        suf = _text(rng.choice(SUFFIXES).format(n=rng.randint(1, 9)), fontset, size)
        gap = rng.randint(int(0.1 * fh), int(1.5 * fh))
        parts.append((suf, x + gap))
        right = target.width + gap + suf.width
    # marge : le recadrage final (7 % de chaque côté) ne doit pas couper la formule
    margin_x = int(0.1 * (left + max(target.width, right))) + rng.randint(10, 60)
    w = left + max(target.width, right) + 2 * margin_x
    gap_above, gap_below = (rng.randint(int(0.25 * fh), int(0.9 * fh)) for _ in range(2))
    above = others[0] if rng.random() < 0.6 else None
    below = others[1] if rng.random() < 0.6 else None
    # le cadre coupe la ligne voisine : on n'en voit qu'une partie (20 à 70 % de sa hauteur)
    show_above = int(above.height * rng.uniform(0.35, 0.9)) if above else rng.randint(10, 40)
    show_below = int(below.height * rng.uniform(0.35, 0.9)) if below else rng.randint(10, 40)
    h = show_above + (gap_above if above else 0) + fh + (gap_below if below else 0) + show_below
    canvas = background(w, h, rng)
    y0 = show_above + (gap_above if above else 0)
    ox = margin_x + left
    for img, dx in parts:
        canvas.paste(img, (ox + dx, y0 + (fh - img.height) // 2), img)
    if above:
        canvas.paste(above, (rng.randint(0, max(1, w // 3)), show_above - above.height), above)
    if below:
        canvas.paste(below, (rng.randint(0, max(1, w // 3)), y0 + fh + gap_below), below)
    img = photo_effects(canvas, rng, screen=screen)
    # cadre de l'app : à l'intérieur de la photo, sans les coins remplis par la rotation et la perspective
    cw, ch = img.size
    mx, my = int(cw * 0.07), int(ch * 0.09)
    return img.crop((mx, my, cw - mx, ch - my))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--out", default="data/ocr/clutter")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--screen", type=float, default=0.4, help="part d'images « photo d'écran » (moiré)")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    problems = [p for p in read_jsonl(EVAL_SET) if ocr_target(p)]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    labels = []
    for k in range(args.n * 3):
        if len(labels) >= args.n:
            break
        p, n1, n2 = rng.sample(problems, 3)
        fontset, size = rng.choice(FONTSETS), rng.randint(24, 34)
        screen = rng.random() < args.screen
        try:
            target = render(ocr_target(p), fontset, size)
            others = [render(ocr_target(q), fontset, size) for q in (n1, n2)]
            img = compose(target, others, fontset, size, rng, screen)
        except Exception:  # noqa: BLE001  (mathtext ne sait pas tout rendre)
            continue
        name = f"{p['id']}-{fontset}-{'ecran' if screen else 'papier'}-{k:04d}.jpg"
        img.convert("RGB").save(out / name, quality=90)
        labels.append({"file": name, "latex": ocr_target(p), "type": p["type"], "source": "clutter",
                       "condition": "ecran" if screen else "papier", "fontset": fontset})
    (out / "labels.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in labels))
    print(f"{len(labels)} images -> {out}")


if __name__ == "__main__":
    main()
