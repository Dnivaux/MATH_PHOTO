"""Échantillons du jeu de test UniMER (Apache 2.0) pour le banc OCR : manuscrit (hwe) et captures d'écran (sce).

Seules les formules du périmètre de l'app sont gardées (équations, dérivées, intégrales, limites, expressions
avec x, y, nombres, fractions, racines, fonctions usuelles) : pas de chimie, de géométrie ni de texte.

    curl -L -o data/ocr/unimer/UniMER-Test.zip \
      https://huggingface.co/datasets/wanderkid/UniMER_Dataset/resolve/main/UniMER-Test.zip
    unzip -q data/ocr/unimer/UniMER-Test.zip -d data/ocr/unimer
    python scripts/ocr_unimer_subset.py --subset hwe --n 300
"""

from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path

ROOT = Path("data/ocr/unimer")
COMMANDS = {"frac", "sqrt", "int", "lim", "to", "infty", "sin", "cos", "tan", "ln", "log", "exp", "pi", "times",
            "div", "cdot", "left", "right", "geq", "leq", "neq", "pm", "mathrm", "d", "dfrac", "prime"}
ALLOWED = re.compile(r"^[0-9xyabcdtnefk+\-=*/^_(){}\[\]|<>.,' ]+$")


def in_scope(latex: str) -> bool:
    cmds = set(re.findall(r"\\([a-zA-Z]+)", latex))
    if not cmds <= COMMANDS:
        return False
    rest = re.sub(r"\\[a-zA-Z]+", "", latex)
    return bool(ALLOWED.match(rest)) and ("x" in rest or "=" in rest or any(c.isdigit() for c in rest)) and len(latex) > 4


def kind(latex: str) -> str:
    if "\\int" in latex:
        return "integral"
    if "\\lim" in latex:
        return "limit"
    if re.search(r"\\frac\s*\{\s*d\s*\}|'", latex):
        return "derivative"
    return "equation" if "=" in latex else "expression"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subset", choices=["hwe", "sce", "spe", "cpe"], required=True)
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    src = ROOT / "UniMER-Test"
    lines = (src / f"{args.subset}.txt").read_text().splitlines()
    pool = [(f"{i:07d}.png", s.strip()) for i, s in enumerate(lines)
            if in_scope(s) and (src / args.subset / f"{i:07d}.png").exists()]
    random.Random(args.seed).shuffle(pool)
    out = ROOT / f"{args.subset}{args.n}"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, latex in pool[: args.n]:
        dest = out / name
        if not dest.exists():
            dest.symlink_to((src / args.subset / name).resolve())
        rows.append({"file": name, "latex": latex, "type": kind(latex), "source": f"unimer-{args.subset}"})
    (out / "labels.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    counts = {t: sum(r["type"] == t for r in rows) for t in sorted({r["type"] for r in rows})}
    print(f"{args.subset} : {len(pool)} formules dans le périmètre sur {len(lines)}, {len(rows)} gardées -> {out} {counts}")


if __name__ == "__main__":
    main()
