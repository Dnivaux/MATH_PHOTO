"""Nettoyage d'une zone photographiée avant l'OCR, identique sur le téléphone (ocrSource.ts) et le serveur.

1. Éclairage : le fond (maximum local de l'image réduite au 1/16, flouté) est ramené au blanc, comme dans l'app.
2. Encre : pixels nettement plus sombres que le fond, regroupés en composantes connexes (8-voisinage).
3. On retire ce qui n'appartient pas à la formule : les morceaux de lignes voisines coupés par le bord du cadre
   (ils touchent le bord haut ou bas et sortent de la bande de la formule), et un numéro ou une ponctuation isolés
   par un grand blanc à l'extrême gauche ou droite (« 1. », « #05 », « ; »).
4. Tout ce qui n'est pas de l'encre gardée devient blanc (moiré, quadrillage, ombres), puis l'image est recadrée
   sur la formule avec une marge.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

MAX_SIDE = 1024
INK = 0.72  # encre : plus sombre que 72 % du fond
STROKE = 21  # épaisseur maximale d'un trait d'écriture, en pixels pour une image de 1024 de côté


def _background(g: np.ndarray) -> np.ndarray:
    h, w = g.shape
    sw, sh = max(4, round(w / 16)), max(4, round(h / 16))
    small = np.asarray(Image.fromarray(g).resize((sw, sh), Image.BILINEAR), dtype=np.float32)
    small = ndimage.maximum_filter(ndimage.maximum_filter(small, size=3, mode="nearest"), size=3, mode="nearest")
    big = np.asarray(Image.fromarray(small).resize((w, h), Image.BILINEAR), dtype=np.float32)
    return ndimage.gaussian_filter(big, max(2, round(min(w, h) / 40)))  # blur(r) du canvas de l'app : écart type r


def normalize_light(img: Image.Image) -> np.ndarray:
    """Niveaux de gris, côté le plus long ramené à 1024 au plus, fond ramené au blanc (float32, 0-255)."""
    g = img.convert("L")
    k = min(1.0, MAX_SIDE / max(g.size))
    if k < 1:
        g = g.resize((round(g.width * k), round(g.height * k)), Image.BICUBIC)
    a = np.asarray(g, dtype=np.float32)
    return np.minimum(255.0, a * 255.0 / np.maximum(1.0, _background(a)))


def _runs(cols: np.ndarray) -> list[tuple[int, int]]:
    """Plages [début, fin) de colonnes contenant de l'encre."""
    out, start = [], None
    for i, v in enumerate(cols):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(cols)))
    return out


def _weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    """Médiane pondérée par l'aire : la hauteur des vrais caractères, pas celle des miettes et des tirets."""
    order = np.argsort(values)
    cum = np.cumsum(weights[order])
    return float(values[order][np.searchsorted(cum, cum[-1] / 2)])


def _stray_marks(keep: np.ndarray, boxes: list, area: np.ndarray, text_h: float) -> np.ndarray:
    """Points de numérotation (« . », « .. ») au début, ponctuation (« ; », « , », « . ») à la fin : de petits signes
    isolés en bout de ligne. Un « − » (plus large que haut) ou un « 1 » (aussi haut que le texte) ne sont pas visés."""
    idx = [i for i in np.flatnonzero(keep) if area[i] >= 4]
    if len(idx) < 3:
        return np.zeros_like(keep)
    order = sorted(idx, key=lambda i: boxes[i][1].start)
    hw = {i: (boxes[i][0].stop - boxes[i][0].start, boxes[i][1].stop - boxes[i][1].start) for i in order}

    def dot(i):
        hh, ww = hw[i]
        return max(hh, ww) < 0.4 * text_h

    def punct(i):
        hh, ww = hw[i]
        return dot(i) or (hh < 0.8 * text_h and ww < 0.3 * text_h and ww < hh)

    drop = np.zeros_like(keep)
    lead = []
    for i in order:  # points au début
        if not dot(i):
            break
        lead.append(i)
    if lead and len(lead) < len(order):
        nxt = order[len(lead)]
        if boxes[nxt][1].start - max(boxes[i][1].stop for i in lead) >= 0.25 * text_h:
            drop[lead] = True
    tail = []
    for i in reversed(order):  # ponctuation à la fin
        if not punct(i) or len(tail) >= 2:
            break
        tail.append(i)
    if tail and len(tail) < len(order):
        rest_end = max(boxes[i][1].stop for i in order if i not in tail)
        if min(boxes[i][1].start for i in tail) - rest_end >= 0.2 * text_h:
            drop[tail] = True
    return drop


def clean(img: Image.Image, crop: bool = True) -> Image.Image:
    g = normalize_light(img)
    h, w = g.shape
    smooth = ndimage.gaussian_filter(g, 1.0)  # le moiré et le grain ne font pas de fausse encre
    # encre = trait sombre ET fin (« black top-hat ») : une ombre, un bord de feuille ou d'écran sont sombres mais
    # larges, et ne passent pas
    # taille du filtre : plus large que le trait le plus épais (photo floue, gros caractères), mesurée sur la
    # hauteur du cadre où la formule occupe en général 30 à 60 %
    k = max(9, round(STROKE * max(h, w) / MAX_SIDE), round(0.12 * h)) | 1
    tophat = ndimage.grey_closing(smooth, size=(k, k)) - smooth
    # seuil à deux niveaux : un trait pâle (photo floue) est gardé en entier s'il touche un trait bien sombre
    strong = (tophat > 255 * (1 - INK)) & (smooth < 255 * INK)
    weak_lab, _ = ndimage.label(tophat > 255 * (1 - INK) / 2, structure=np.ones((3, 3)))
    mask = np.isin(weak_lab, np.unique(weak_lab[strong]))
    mask &= weak_lab > 0
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0:
        return Image.fromarray(g.astype(np.uint8))
    boxes = ndimage.find_objects(lab)
    area = np.bincount(lab.ravel())[1:]
    heights = np.array([b[0].stop - b[0].start for b in boxes])
    widths = np.array([b[1].stop - b[1].start for b in boxes])
    big = area >= 12
    if not big.any():
        return Image.fromarray(g.astype(np.uint8))
    text_h = _weighted_median(heights[big], area[big])

    # lignes de texte : profil vertical de l'encre (sans les miettes ni les grands traits qui relieraient deux
    # lignes) ; deux bandes séparées par moins de 0,35 hauteur de caractère sont la même ligne (exposant, fraction,
    # limite). La formule est la ligne la plus chargée, pondérée par sa distance au centre du cadre.
    # longs traits horizontaux qui traversent le cadre : lignes du cahier, bord de la feuille (pas une barre de
    # fraction, qui ne touche pas les deux bords)
    rule = (widths > 0.8 * w) & (heights < 0.4 * text_h) & np.array([b[1].start <= 1 or b[1].stop >= w - 1
                                                                       for b in boxes])
    area[rule] = 0
    big &= ~rule
    tall = heights > max(3 * text_h, 0.6 * h)
    prof = np.isin(lab, np.flatnonzero(big & ~tall) + 1).any(axis=1)
    bands, merge = _runs(prof), 0.35 * text_h
    merged: list[list[int]] = []
    for a, b in bands:
        if merged and a - merged[-1][1] < merge:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    if not merged:
        return Image.fromarray(g.astype(np.uint8))
    rows_ink = np.bincount(lab.ravel(), minlength=n + 1)  # masse d'encre par ligne, via les composantes
    cy = h / 2

    edge = np.array([bx[0].start <= 1 or bx[0].stop >= h - 1 or bx[1].start <= 1 or bx[1].stop >= w - 1
                     for bx in boxes])

    def score(band):
        a, b = band
        # ce qui touche le bord compte peu : ligne voisine coupée, bord de la feuille ou de l'écran
        mass = sum(rows_ink[i + 1] * (0.2 if edge[i] else 1.0) for i, bx in enumerate(boxes)
                   if big[i] and bx[0].start >= a and bx[0].stop <= b)
        dist = 0 if a <= cy <= b else min(abs(cy - a), abs(cy - b))
        return mass / (1 + 3 * dist / h)

    top, bottom = max(merged, key=score)
    keep = np.zeros(n, dtype=bool)
    for i, b in enumerate(boxes):
        if area[i] < 4:
            continue
        inside = max(0, min(b[0].stop, bottom) - max(b[0].start, top)) / (b[0].stop - b[0].start)
        keep[i] = inside >= 0.5

    # numéro ou ponctuation isolés à gauche ou à droite par un grand blanc (hauteur des caractères de la ligne)
    kept_big = keep & big
    if kept_big.any():
        text_h = _weighted_median(heights[kept_big], area[kept_big])
    # les miettes (bruit, moiré) ne comptent pas pour mesurer les blancs, mais partent avec le numéro retiré
    gap_min = 1.5 * text_h
    runs: list[list[int]] = []  # groupes de colonnes d'encre séparés par au moins gap_min
    for a, b in _runs(np.isin(lab, np.flatnonzero(kept_big) + 1).any(axis=0)):
        if runs and a - runs[-1][1] < gap_min:
            runs[-1][1] = b
        else:
            runs.append([a, b])
    centers = np.array([(b[1].start + b[1].stop) / 2 for b in boxes])
    for side in ("left", "left", "right", "right"):  # au plus deux groupes de chaque côté (bord + numéro)
        if len(runs) < 2:
            break
        end, nxt = (runs[0], runs[1]) if side == "left" else (runs[-1], runs[-2])
        total = runs[-1][1] - runs[0][0]
        if (end[1] - end[0]) <= max(2.5 * text_h, 0.2 * total):
            cut = (centers < nxt[0]) if side == "left" else (centers >= nxt[1])
            keep &= ~cut
            runs = runs[1:] if side == "left" else runs[:-1]
    keep &= area >= max(4.0, 0.006 * text_h**2)  # taches plus petites qu'un point (grille de pixels d'un écran)
    keep &= ~_stray_marks(keep, boxes, area, text_h)
    kept_mask = np.isin(lab, np.flatnonzero(keep) + 1)

    if not kept_mask.any():
        return Image.fromarray(g.astype(np.uint8))
    halo = ndimage.binary_dilation(kept_mask, iterations=max(2, round(0.06 * text_h)))
    out = np.where(halo, smooth, 255.0)  # version lissée : le moiré qui reste sur les traits s'atténue
    if crop:
        ys, xs = np.nonzero(kept_mask)
        m = int(round(0.6 * text_h)) + 8
        out = out[max(0, ys.min() - m):min(h, ys.max() + 1 + m), max(0, xs.min() - m):min(w, xs.max() + 1 + m)]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
