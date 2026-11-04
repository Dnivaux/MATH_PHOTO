"""Mesures sur le téléphone → MLflow (dossier, phase 2 « bancs embarqués » ; sujet embarqué, niveau 2).

Protocole, par modèle à comparer (prunée ou non, Q4_K_M, Q8_0...) :
  1. installer le modèle sur le téléphone, vider les mesures (Réglages → Outils de développement) ;
  2. résoudre la même série de problèmes, explication comprise ;
  3. pendant la série, relever la RAM de l'app : --adb (dumpsys meminfo, toutes les 2 s) ;
  4. Exporter les mesures (même écran), copier le JSON sur le PC, puis :

    .venv/bin/python -m eval.device_bench --file mesures.json --device "Pixel 7" \
        --model explainer-0.6b-p20 --quant Q4_K_M [--meminfo ram.txt]

Un run MLflow par (appareil, modèle) : latences OCR et explication, tok/s, taux d'escalade par raison, RAM.

Relevé de RAM, à lancer pendant la série (Ctrl-C pour arrêter) :
    .venv/bin/python -m eval.device_bench --watch-ram ram.txt
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import time
from collections import Counter
from pathlib import Path

import mlflow

from common import tracking

PACKAGE = "com.photomaths"
PSS_RE = re.compile(r"TOTAL(?: PSS)?:?\s+(\d+)")


def pct(values: list[float], q: float) -> float | None:
    v = sorted(x for x in values if x is not None)
    return v[min(len(v) - 1, int(q * len(v)))] if v else None


def watch_ram(out: Path, package: str, every_s: float = 2.0) -> None:
    """Relève la mémoire de l'app (PSS, en Mo) toutes les `every_s` secondes jusqu'à Ctrl-C."""
    print(f"relevé de la RAM de {package} dans {out} (Ctrl-C pour arrêter)")
    with open(out, "a") as f:
        try:
            while True:
                txt = subprocess.run(["adb", "shell", "dumpsys", "meminfo", package], capture_output=True, text=True).stdout
                m = PSS_RE.search(txt)
                if m:
                    mb = int(m.group(1)) / 1024
                    f.write(f"{time.time():.0f} {mb:.1f}\n")
                    f.flush()
                    print(f"\r{mb:7.1f} Mo", end="")
                time.sleep(every_s)
        except KeyboardInterrupt:
            print()


def metrics(export: dict) -> dict[str, float]:
    ev = export.get("events", [])
    by = {t: [e["data"] for e in ev if e["type"] == t] for t in ("ocr", "solve", "explain", "escalation", "model")}
    m: dict[str, float] = {}

    def put(name, values, qs=(0.5, 0.95)):
        values = [v for v in values if isinstance(v, (int, float))]
        if values:
            for q in qs:
                m[f"{name}_p{int(q * 100)}"] = pct(values, q)
            m[f"{name}_n"] = len(values)

    ocr = by["ocr"]
    put("ocr_inference_ms", [d.get("inferenceMs") for d in ocr])
    put("ocr_total_ms", [d.get("ms") for d in ocr])
    put("ocr_confidence", [d.get("confidence") for d in ocr])

    dev = [d for d in by["explain"] if d.get("via") == "device"]
    put("explain_ms", [d.get("ms") for d in dev])
    put("explain_tok_s", [d.get("tokensPerSecond") for d in dev])
    put("explain_prompt_ms", [d.get("promptMs") for d in dev])
    put("explain_tokens", [d.get("tokens") for d in dev])
    loads = [d.get("loadMs") for d in dev if d.get("loadMs")]
    if loads:
        m["model_load_ms"] = statistics.median(loads)
    put("explain_server_ms", [d.get("ms") for d in by["explain"] if d.get("via") == "server"])

    solves = by["solve"]
    if solves:
        server = sum(1 for d in solves if d.get("route") == "server")
        m["escalation_rate"] = 100 * server / len(solves)
        m["solves"] = len(solves)
        put("solve_local_ms", [d.get("ms") for d in solves if d.get("route") == "local"])
    for reason, n in Counter(d.get("reason") for d in by["escalation"]).items():
        m[f"escalation.{reason}"] = n
    return m


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="JSON exporté par l'app (Réglages → Outils de développement → Exporter)")
    ap.add_argument("--device", help='ex. "Pixel 7"')
    ap.add_argument("--model", help="modèle d'explication installé, ex. explainer-0.6b-p20")
    ap.add_argument("--quant", default="Q4_K_M")
    ap.add_argument("--meminfo", help="fichier produit par --watch-ram pendant la série")
    ap.add_argument("--run-name", default=None)
    ap.add_argument("--watch-ram", metavar="OUT", help="relève la RAM de l'app par adb (Ctrl-C pour arrêter)")
    ap.add_argument("--package", default=PACKAGE)
    args = ap.parse_args()

    if args.watch_ram:
        watch_ram(Path(args.watch_ram), args.package)
        return
    if not (args.file and args.device and args.model):
        ap.error("--file, --device et --model sont requis (ou --watch-ram)")

    export = json.loads(Path(args.file).read_text())
    m = metrics(export)
    if args.meminfo:
        ram = [float(line.split()[1]) for line in Path(args.meminfo).read_text().splitlines() if line.strip()]
        if ram:
            m["ram_peak_mb"], m["ram_p50_mb"] = max(ram), statistics.median(ram)
    if export.get("ram"):
        m["device_ram_gb"] = float(export["ram"])

    tracking.init()
    name = args.run_name or f"device-{args.device.lower().replace(' ', '-')}-{args.model}-{args.quant.lower()}"
    with mlflow.start_run(run_name=name):
        mlflow.set_tags({"stage": "device-bench", "device": args.device, "model": args.model, "quant": args.quant,
                         "app_version": str(export.get("app", ""))})
        mlflow.log_metrics({k: float(v) for k, v in m.items() if v is not None})
        mlflow.log_artifact(args.file, "device")
        if args.meminfo:
            mlflow.log_artifact(args.meminfo, "device")
    for k, v in sorted(m.items()):
        print(f"{k:28s} {v:10.1f}")


if __name__ == "__main__":
    main()
