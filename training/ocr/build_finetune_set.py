"""Jeu d'entraînement du lecteur OCR du téléphone (pix2text-mfr v1) : imprimé réaliste, manuscrit, imprimé général.

Chaque image passe par le nettoyage de production (serving/ocr/preprocess.clean) puis est enregistrée en 384 x 384
niveaux de gris, l'entrée exacte du modèle. Étiquettes au style du lecteur : un symbole par jeton, séparés par des
espaces, chiffres séparés (« 2 3 x ^ { 2 } »).

Sources (aucune formule du banc d'évaluation) :
  printed   formules du pool d'entraînement (datagen), rendues en 5 polices, avec lignes voisines, numéro,
            moiré d'écran (40 %), puis effets « photo »
  hand      MathWriting (Google, CC BY-NC-SA 4.0), tracés humains dessinés au stylo sur papier blanc, quadrillé
            ou ligné, avec lignes voisines manuscrites
  unimer    UniMER-1M (Apache 2.0), formules imprimées variées, pour ne pas oublier ce que le modèle sait déjà

    .venv-ocr/bin/python -m training.ocr.build_finetune_set --printed 60000 --hand 100000 --unimer 40000
"""

from __future__ import annotations

import argparse
import json
import random
import re
import xml.etree.ElementTree as ET
import zipfile
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from common.config import TRAIN_POOL, read_jsonl
from serving.ocr.preprocess import clean
from training.ocr.clutter import compose
from training.ocr.make_synthetic import FONTSETS, augment, ocr_target, photo_effects, render

OUT = Path("data/ocr/finetune")
MW = Path("data/ocr/mathwriting/mathwriting-2024")
UNIMER_ZIP = Path("data/ocr/unimer/UniMER-1M.zip")
UNIMER_SRC = Path("data/ocr/unimer/UniMER-1M-sample")
SIZE = 384
MAX_TOKENS = 150
TOKEN = re.compile(r"\\[a-zA-Z]+|\\.|[^\s]")
NS = "{http://www.w3.org/2003/InkML}"


def spaced(latex: str) -> str:
    s = re.sub(r"\\(left|right|displaystyle)\b", "", latex)
    s = re.sub(r"\\(left|right)(?=[^a-zA-Z])", "", s)
    return " ".join(TOKEN.findall(s))


def finish(img: Image.Image) -> Image.Image:
    return clean(img).resize((SIZE, SIZE), Image.BICUBIC)


# ---- manuscrit -------------------------------------------------------------------------------------------------
def read_ink(path: Path) -> tuple[list[np.ndarray], str]:
    root = ET.parse(path).getroot()
    label = next(a.text for a in root.iter(f"{NS}annotation") if a.get("type") == "normalizedLabel")
    traces = []
    for t in root.iter(f"{NS}trace"):
        pts = [p.split()[:2] for p in t.text.strip().split(",")]
        traces.append(np.array(pts, dtype=np.float32))
    return traces, label


def draw_ink(traces: list[np.ndarray], rng: random.Random) -> Image.Image:
    allp = np.concatenate(traces)
    x0, y0 = allp.min(0)
    x1, y1 = allp.max(0)
    target_h = rng.uniform(50, 130)
    k = target_h / max(1.0, y1 - y0, (x1 - x0) / 12)
    w, h = int((x1 - x0) * k) + 40, int((y1 - y0) * k) + 40
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = rng.choice([(20, 20, 30), (25, 35, 110), (60, 60, 60), (10, 10, 10), (90, 90, 95)])
    width = rng.randint(2, 5)
    for t in traces:
        pts = [((x - x0) * k + 20, (y - y0) * k + 20) for x, y in t]
        if len(pts) == 1:
            x, y = pts[0]
            d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color + (255,))
        else:
            d.line(pts, fill=color + (255,), width=width, joint="curve")
    return img


def hand_sample(args: tuple[int, str, list[str], int]) -> dict | None:
    i, path, others, seed = args
    rng = random.Random(seed)
    try:
        traces, label = read_ink(MW / path)
        target = spaced(label)
        if not target or len(target.split()) > MAX_TOKENS:
            return None
        ink = draw_ink(traces, rng)
        if rng.random() < 0.5:
            neigh = [draw_ink(read_ink(MW / o)[0], rng) for o in others]
            img = compose(ink, neigh, rng.choice(FONTSETS), rng.randint(24, 34), rng, screen=False, marks=False)
        else:
            img = augment(ink, rng)
        return save(finish(img), f"hand-{i:06d}", target, "hand")
    except Exception:  # noqa: BLE001  (tracé vide, image illisible)
        return None


# ---- imprimé réaliste ------------------------------------------------------------------------------------------
def printed_sample(args: tuple[int, str, list[str], int]) -> dict | None:
    i, latex, others, seed = args
    rng = random.Random(seed)
    try:
        fontset, size = rng.choice(FONTSETS), rng.randint(22, 36)
        target = render(latex, fontset, size)
        screen = rng.random() < 0.4
        if rng.random() < 0.7:
            img = compose(target, [render(o, fontset, size) for o in others], fontset, size, rng, screen)
        else:
            img = photo_effects(augment_plain(target, rng), rng, screen=screen)
        return save(finish(img), f"printed-{i:06d}", spaced(latex), "printed")
    except Exception:  # noqa: BLE001  (mathtext ne sait pas tout rendre)
        return None


def augment_plain(formula: Image.Image, rng: random.Random) -> Image.Image:
    from training.ocr.make_synthetic import background

    pad = rng.randint(15, 70)
    img = background(formula.width + 2 * pad, formula.height + 2 * pad, rng)
    img.paste(formula, (pad, pad), formula)
    return img


# ---- imprimé général (UniMER-1M) ---------------------------------------------------------------------------
def unimer_sample(args: tuple[int, str, str, int]) -> dict | None:
    i, name, label, seed = args
    rng = random.Random(seed)
    try:
        img = Image.open(UNIMER_SRC / name).convert("RGB")
        if img.height < 64:  # rendus parfois minuscules : les effets « photo » les détruiraient
            k = 64 / img.height
            img = img.resize((round(img.width * k), 64), Image.BICUBIC)
        target = spaced(label)
        if not target or len(target.split()) > MAX_TOKENS:
            return None
        if rng.random() < 0.6:  # rendu propre -> photographié
            rgba = img.convert("L").point(lambda v: 255 - v).convert("L")
            ink = Image.new("RGBA", img.size, (0, 0, 0, 255))
            ink.putalpha(rgba)
            img = photo_effects(augment_plain(ink, rng), rng, screen=rng.random() < 0.3)
        return save(finish(img), f"unimer-{i:06d}", target, "unimer")
    except Exception:  # noqa: BLE001
        return None


def save(img: Image.Image, name: str, label: str, source: str) -> dict:
    split = "val" if int(name.rsplit("-", 1)[1]) % 100 == 0 else "train"
    path = OUT / split / f"{name}.png"
    img.save(path, optimize=False)
    return {"file": f"{split}/{name}.png", "text": label, "source": source}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--printed", type=int, default=60000)
    ap.add_argument("--hand", type=int, default=100000)
    ap.add_argument("--unimer", type=int, default=40000)
    ap.add_argument("--workers", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    for split in ("train", "val"):
        (OUT / split).mkdir(parents=True, exist_ok=True)

    jobs = []
    pool_f = [t for t in (ocr_target(p) for p in read_jsonl(TRAIN_POOL)) if t]
    for i in range(args.printed):
        jobs.append((printed_sample, (i, rng.choice(pool_f), rng.sample(pool_f, 2), rng.randrange(2**31))))
    inks = sorted(p.name for p in (MW / "train").glob("*.inkml"))
    rng.shuffle(inks)
    for i, name in enumerate(inks[: args.hand]):
        jobs.append((hand_sample, (i, f"train/{name}", [f"train/{o}" for o in rng.sample(inks, 2)],
                                   rng.randrange(2**31))))
    with zipfile.ZipFile(UNIMER_ZIP) as z:
        have = {n.rsplit("/", 1)[1] for n in z.namelist() if n.endswith(".png")}
        labels = z.read("UniMER-1M/train.txt").decode().splitlines()
        candidates = [(f"{k:07d}.png", s) for k, s in enumerate(labels) if f"{k:07d}.png" in have]
        chosen = rng.sample(candidates, args.unimer)
        UNIMER_SRC.mkdir(parents=True, exist_ok=True)
        for name, _ in chosen:  # une seule lecture de l'archive (un million d'entrées)
            if not (UNIMER_SRC / name).exists():
                (UNIMER_SRC / name).write_bytes(z.read(f"UniMER-1M/images/{name}"))
    for i, (name, label) in enumerate(chosen):
        jobs.append((unimer_sample, (i, name, label, rng.randrange(2**31))))
    rng.shuffle(jobs)

    rows = []
    with Pool(args.workers) as pool:
        for k, r in enumerate(pool.imap_unordered(_run, jobs, chunksize=64)):
            if r:
                rows.append(r)
            if k % 10000 == 0:
                print(f"{k}/{len(jobs)} ({len(rows)} gardées)", flush=True)
    for split in ("train", "val"):
        sub = [r for r in rows if r["file"].startswith(split)]
        (OUT / f"{split}.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in sub))
    counts = {s: sum(r["source"] == s for r in rows) for s in ("printed", "hand", "unimer")}
    print(f"{len(rows)} images -> {OUT} {counts}")


def _run(job):
    fn, a = job
    return fn(a)


if __name__ == "__main__":
    main()
