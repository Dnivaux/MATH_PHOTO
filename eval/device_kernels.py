"""Vitesse des modèles embarqués mesurée sur le téléphone → MLflow (sujet embarqué, niveau 2).

Complète eval/device_bench.py (mesures de l'app en usage réel) par des bancs reproductibles, sans toucher à l'app :

  llm : llama-bench (Android arm64, infra/setup/build_llamacpp_android.sh) lancé par adb sur chaque GGUF, avec les
        réglages de l'app (llama.rn : 4 fils, CPU, lots de 256) : tok/s du prompt et de la génération, RAM en pic
        (VmHWM), taille du fichier.

    .venv/bin/python -m eval.device_kernels llm --device "S24 Ultra"

  ocr : résultats de clients/mobile/scripts/device-ocr-bench.mjs (même code WASM que la WebView, INT8 / FP32).

    .venv/bin/python -m eval.device_kernels ocr --file clients/mobile/ocr-s24.json --device "S24 Ultra"

Un run MLflow par (appareil, banc), métriques suffixées par modèle et quantization ; la précision de chaque GGUF
vient des runs gguf-*-t03-gpu (même fichier, même llama.cpp).
"""

from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import time
from pathlib import Path

import mlflow

from common import tracking

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / "third_party/llama.cpp/build-android/bin/llama-bench"
REMOTE = "/data/local/tmp/photo-maths"
MODELS = [f"{m}/{m}-{q}.gguf" for m in ("explainer-0.6b", "explainer-0.6b-p20") for q in ("q4_k_m", "q8_0", "f16")]


def adb(*args: str, check: bool = True) -> str:
    return subprocess.run(["adb", *args], capture_output=True, text=True, check=check).stdout


def bench_one(name: str, threads: int, prompt: int, gen: int, reps: int) -> dict:
    """llama-bench sur le téléphone ; RAM en pic relevée dans /proc pendant le run (VmHWM ne fait que croître)."""
    cmd = (f"cd {REMOTE} || exit 1; ./llama-bench -m {Path(name).name} -t {threads} -p {prompt} -n {gen} -b 256 -ngl 0 "
           f"-r {reps} -o json > out.json 2> err.txt & p=$!; peak=0; "
           "while kill -0 $p 2>/dev/null; do h=$(grep VmHWM /proc/$p/status 2>/dev/null | tr -dc 0-9); "
           "[ -n \"$h\" ] && peak=$h; sleep 0.3; done; echo PEAK $peak; cat out.json")
    out = adb("shell", cmd)
    peak_kb = int(out.split("PEAK ", 1)[1].split()[0])
    rows = json.loads(out[out.index("["):])
    pp = next(r for r in rows if r["n_prompt"] > 0)
    tg = next(r for r in rows if r["n_gen"] > 0)
    return {"pp_tok_s": pp["avg_ts"], "tg_tok_s": tg["avg_ts"], "tg_tok_s_std": tg["stddev_ts"],
            "ram_peak_mb": peak_kb / 1024, "size_mb": pp["model_size"] / 1e6}


def run_llm(args) -> None:
    if not BENCH.exists():
        raise SystemExit(f"{BENCH} absent : lancer infra/setup/build_llamacpp_android.sh")
    adb("shell", f"mkdir -p {REMOTE}")
    adb("push", str(BENCH), f"{REMOTE}/llama-bench")
    adb("shell", f"chmod 755 {REMOTE}/llama-bench")
    soc = adb("shell", "getprop", "ro.soc.model").strip()
    results = {}
    for name in args.models.split(",") if args.models else MODELS:
        local = ROOT / "models/gguf" / name
        print(f"{name} : envoi ({local.stat().st_size / 1e6:.0f} Mo)…", flush=True)
        adb("push", str(local), f"{REMOTE}/{local.name}")
        time.sleep(args.cooldown)   # le téléphone chauffe : même point de départ pour chaque modèle
        r = bench_one(name, args.threads, args.prompt, args.gen, args.reps)
        adb("shell", f"rm {REMOTE}/{local.name}")
        key = local.stem.replace("explainer-0.6b", "base").replace("base-p20", "p20")
        results[key] = r
        print(f"  prompt {r['pp_tok_s']:7.1f} tok/s   génération {r['tg_tok_s']:5.1f} ± {r['tg_tok_s_std']:.1f} tok/s"
              f"   RAM {r['ram_peak_mb']:5.0f} Mo   fichier {r['size_mb']:5.0f} Mo", flush=True)
    adb("shell", f"rm -r {REMOTE}")

    out = ROOT / f"eval/results/device-llm-{args.device.lower().replace(' ', '-')}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"device": args.device, "soc": soc, "threads": args.threads, "prompt": args.prompt,
                               "gen": args.gen, "results": results}, indent=1))
    tracking.init()
    with mlflow.start_run(run_name=f"device-llm-{args.device.lower().replace(' ', '-')}"):
        mlflow.set_tags({"stage": "device-bench", "device": args.device, "soc": soc, "bench": "llama-bench",
                         "threads": str(args.threads)})
        mlflow.log_metrics({f"{k}.{m}": v for m, r in results.items() for k, v in r.items()})
        mlflow.log_artifact(str(out), "device")


def run_ocr(args) -> None:
    data = json.loads(Path(args.file).read_text())
    m = {}
    for v in data["variants"]:
        warm = [x for x in v["runs"] if x["rep"] > 0 or v["reps"] == 1]
        m[f"load_ms.{v['variant']}"] = v["loadMs"]
        for reader in sorted({x["reader"] for x in v["runs"]}):
            ms = [x["ms"] for x in warm if x["reader"] == reader]
            m[f"ms_p50.{reader}.{v['variant']}"] = statistics.median(ms)
            m[f"ms_p95.{reader}.{v['variant']}"] = sorted(ms)[min(len(ms) - 1, int(0.95 * len(ms)))]
        both = {}
        for x in warm:
            both[(x["rep"], x["file"])] = both.get((x["rep"], x["file"]), 0) + x["ms"]
        m[f"ms_p50.both.{v['variant']}"] = statistics.median(both.values())
    tracking.init()
    with mlflow.start_run(run_name=f"device-ocr-{args.device.lower().replace(' ', '-')}"):
        mlflow.set_tags({"stage": "device-bench", "device": args.device, "bench": "onnxruntime-web",
                         "model_reported": data.get("device", "")})
        mlflow.log_metrics(m)
        mlflow.log_artifact(args.file, "device")
    for k, v in sorted(m.items()):
        print(f"{k:32s} {v:8.0f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="bench", required=True)
    llm = sub.add_parser("llm")
    llm.add_argument("--device", required=True)
    llm.add_argument("--models", default=None, help="chemins sous models/gguf, séparés par des virgules")
    llm.add_argument("--threads", type=int, default=4, help="4 : réglage de l'app (src/explain/explainer.ts)")
    llm.add_argument("--prompt", type=int, default=256, help="longueur du prompt d'explication, à peu près")
    llm.add_argument("--gen", type=int, default=128)
    llm.add_argument("--reps", type=int, default=3)
    llm.add_argument("--cooldown", type=float, default=20)
    ocr = sub.add_parser("ocr")
    ocr.add_argument("--file", required=True)
    ocr.add_argument("--device", required=True)
    args = ap.parse_args()
    run_llm(args) if args.bench == "llm" else run_ocr(args)


if __name__ == "__main__":
    main()
