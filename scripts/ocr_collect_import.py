"""Range les scans du mode collecte (POST /v1/ocr/collect) dans le banc OCR de vraies photos.

Chaque scan est rattaché à la formule de la planche (data/ocr/real/labels.jsonl) la plus proche des lectures du
téléphone (distance d'édition par token). Les rattachements douteux sont listés : à vérifier à la main dans
data/ocr/real/<condition>/labels.jsonl (champ `check`), puis poser `"checked_by_hand": true` sur la ligne
corrigée pour qu'un nouvel import ne l'écrase pas.

    make ocr-collect-import          # copie depuis le volume Docker, puis ce script
    python -m scripts.ocr_collect_import --src /chemin/vers/collect
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from eval.ocr_bench import edit_distance, tokens

PLANCHE = Path("data/ocr/real/labels.jsonl")
OUT = Path("data/ocr/real")
DOUBT = 0.25  # distance relative au-delà de laquelle le rattachement est à vérifier


def best_label(readings: list[str], labels: list[dict]) -> tuple[dict, float]:
    best, score = labels[0], float("inf")
    for lab in labels:
        ref = tokens(lab["latex"])
        for r in readings:
            d = edit_distance(tokens(r), ref) / max(1, len(ref))
            if d < score:
                best, score = lab, d
    return best, score


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="dossier collect/ (collect.jsonl + <condition>/*.jpg)")
    args = ap.parse_args()
    labels = [json.loads(line) for line in PLANCHE.read_text().splitlines() if line.strip()]
    rows = [json.loads(line) for line in (args.src / "collect.jsonl").read_text().splitlines() if line.strip()]

    by_condition: dict[str, list[dict]] = {}
    for row in rows:
        src = args.src / row["file"]
        if not src.exists():
            continue
        readings = [r for r in (row.get("device_latex"), row.get("device_alt")) if r]
        lab, dist = best_label(readings, labels) if readings else (labels[0], float("inf"))
        dest = OUT / row["condition"] / src.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        by_condition.setdefault(row["condition"], []).append({
            "file": src.name, "latex": lab["latex"], "type": lab["type"], "source": "real",
            "condition": row["condition"], "planche": lab["file"], "match_distance": round(dist, 3),
            "check": dist > DOUBT, "device_latex": row.get("device_latex"), "device_alt": row.get("device_alt"),
            "device_agree": row.get("agree"), "device_confidence": row.get("confidence"),
        })

    for condition, items in sorted(by_condition.items()):
        path = OUT / condition / "labels.jsonl"
        keep = {}
        if path.exists():  # une ligne corrigée à la main (checked_by_hand: true) n'est pas écrasée
            keep = {r["file"]: r for r in map(json.loads, path.read_text().splitlines()) if r.get("checked_by_hand")}
        items = [keep.get(it["file"], it) for it in items]
        path.write_text("".join(json.dumps(it, ensure_ascii=False) + "\n" for it in items))
        doubt = [it for it in items if it["check"] and not it.get("checked_by_hand")]
        covered = len({it["planche"] for it in items})
        print(f"{condition} : {len(items)} photos, {covered} formules de la planche sur {len(labels)}, "
              f"{len(doubt)} rattachements à vérifier -> {path}")
        for it in doubt:
            print(f"   {it['file']}  lu : {it['device_latex']!r}  ->  {it['planche']} {it['latex']!r}")


if __name__ == "__main__":
    main()
