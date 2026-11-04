"""Baselines OCR (dossier, phase 2) : pix2tex et TexTeller sur images synthétiques et vraies photos.

Métriques : expression exacte (après normalisation), équivalence mathématique (SymPy),
taux d'erreur par token (distance d'édition), temps d'inférence p50 / p95. Un run MLflow par (modèle, jeu).

À lancer dans le venv OCR (dépendances séparées) :
    .venv-ocr/bin/python -m eval.ocr_bench --model pix2tex  --data data/ocr/synthetic
    .venv-ocr/bin/python -m eval.ocr_bench --model texteller --data data/ocr/real
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import tempfile
import time
from pathlib import Path

import mlflow
from PIL import Image

from common import tracking
from serving.ocr.text import canonicalize, strip_delimiters  # noqa: F401  (strip_delimiters : tests)

TOKEN_RE = re.compile(r"\\[a-zA-Z]+|\\.|[^\s]")


def normalize(latex: str) -> str:
    s = strip_delimiters(latex).strip()
    s = re.sub(r"\\(left|right|displaystyle|mathrm|operatorname|limits)\b", "", s)
    s = re.sub(r"\\[,;:! ]", "", s)
    s = s.replace("\\dfrac", "\\frac").replace("\\cdot", "\\times")
    s = re.sub(r"\{\s*\}", "", s)
    s = re.sub(r"\\(sin|cos|tan|ln|log|exp)\s*\{(\([^{}]*\))\}", r"\\\1\2", s)  # \sin{(2x)} -> \sin(2x)
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"\{([a-zA-Z0-9])\}", r"\1", s)  # x^{2} -> x^2, \sin{x} -> \sinx
    return s


def tokens(latex: str) -> list[str]:
    return TOKEN_RE.findall(normalize(latex))


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, ta in enumerate(a, 1):
        cur = [i]
        for j, tb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ta != tb)))
        prev = cur
    return prev[-1]


def equivalent(pred: str, ref: str) -> bool:
    """Égalité mathématique (SymPy) ; pour une équation, compare lhs - rhs à un facteur près."""
    try:
        import sympy as sp

        from eval.faithfulness import normalize_latex, parse
        from serving.sandbox.runner import exprs_equal

        def expr(s):
            s = normalize_latex(strip_delimiters(s))
            if "=" in s:
                lhs, rhs = s.split("=", 1)
                return parse(lhs) - parse(rhs), True
            return parse(s), False

        (a, eq_a), (b, eq_b) = expr(pred), expr(ref)
        if eq_a != eq_b:
            return False
        if eq_a:
            ratio = sp.simplify(a / b)
            return ratio.is_number and ratio != 0
        return exprs_equal(a.doit() if hasattr(a, "doit") else a, b.doit() if hasattr(b, "doit") else b)
    except Exception:  # noqa: BLE001
        return False


# ------------------------------------------------------------------ modèles

def load_pix2tex():
    from pix2tex.cli import LatexOCR

    model = LatexOCR()
    return lambda img: model(img)


def load_texteller(device: str):
    import torch
    from texteller import img2latex, load_model, load_tokenizer

    device = torch.device(device)  # img2latex compare device.type

    model, tok = load_model(), load_tokenizer()
    try:
        model = model.to(device)
    except Exception:  # noqa: BLE001
        pass

    def predict(img: Image.Image) -> str:
        with tempfile.NamedTemporaryFile(suffix=".png") as f:
            img.save(f.name)
            try:
                out = img2latex(model, tok, [f.name], device=device)
            except TypeError:
                out = img2latex(model, tok, [f.name])
        return out[0] if isinstance(out, list) else out

    return predict


def load_p2t_mfr(repo: str, threads: int):
    """pix2text-mfr (TrOCR, MIT), en ONNX Runtime sur CPU : proche des conditions du téléphone."""
    import onnxruntime as ort
    from optimum.onnxruntime import ORTModelForVision2Seq
    from transformers import TrOCRProcessor

    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    processor = TrOCRProcessor.from_pretrained(repo)
    model = ORTModelForVision2Seq.from_pretrained(repo, use_cache=False, session_options=so)

    def predict(img: Image.Image) -> str:
        pixel_values = processor(images=[img], return_tensors="pt").pixel_values
        ids = model.generate(pixel_values, max_new_tokens=256)
        return processor.batch_decode(ids, skip_special_tokens=True)[0]

    return predict


def load_pp_formulanet(name: str, threads: int):
    """PP-FormulaNet (PaddleOCR 3, Apache 2.0), sur CPU. Venv séparé : .venv-paddle."""
    from paddleocr import FormulaRecognition

    model = FormulaRecognition(model_name=name, device="cpu", cpu_threads=threads)

    def predict(img: Image.Image) -> str:
        with tempfile.NamedTemporaryFile(suffix=".png") as f:
            img.save(f.name)
            out = list(model.predict(input=f.name, batch_size=1))
        return out[0]["rec_formula"]

    return predict


MODELS = {"pix2tex": "pix2tex", "texteller": "texteller",
          "p2t-mfr": "breezedeus/pix2text-mfr", "p2t-mfr-1.5": "breezedeus/pix2text-mfr-1.5",
          "pp-formulanet-plus-s": "PP-FormulaNet_plus-S", "pp-formulanet-s": "PP-FormulaNet-S"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=sorted(MODELS), help="modèle de référence (sinon --onnx)")
    ap.add_argument("--data", required=True, help="dossier avec labels.jsonl")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--threads", type=int, default=4, help="ONNX Runtime sur CPU (modèles p2t-mfr)")
    ap.add_argument("--onnx", type=Path, default=None,
                    help="dossier d'un lecteur exporté pour l'app (clients/mobile/scripts/p2t_mfr/export.py)")
    ap.add_argument("--variant", default="int8", choices=["fp32", "fp16", "int8"], help="avec --onnx")
    args = ap.parse_args()

    data = Path(args.data)
    labels = [json.loads(l) for l in (data / "labels.jsonl").read_text().splitlines() if l.strip()]
    labels = [l for l in labels if (data / l["file"]).exists()][: args.limit]
    if not labels:
        raise SystemExit(f"aucune image étiquetée trouvée dans {data}")
    confidence = None
    if args.onnx:
        from serving.ocr.trocr_onnx import TrOCROnnx

        reader = TrOCROnnx(args.onnx, args.variant, args.threads)
        args.model, args.device = f"{reader.cfg['name']}-{args.variant}", f"cpu-onnx-{args.threads}t"
        last: dict[str, float] = {}

        def predict(img):
            raw, last["c"] = reader.read(img)
            return raw

        def confidence():
            return last.get("c")
    elif not args.model:
        raise SystemExit("--model ou --onnx est requis")
    elif args.model == "pix2tex":
        predict = load_pix2tex()
    elif args.model == "texteller":
        predict = load_texteller(args.device)
    elif args.model.startswith("pp-"):
        predict, args.device = load_pp_formulanet(MODELS[args.model], args.threads), f"cpu-paddle-{args.threads}t"
    else:
        predict, args.device = load_p2t_mfr(MODELS[args.model], args.threads), f"cpu-onnx-{args.threads}t"
    predict(Image.open(data / labels[0]["file"]).convert("RGB"))  # chauffe (chargement CUDA)

    rows = []
    for l in labels:
        img = Image.open(data / l["file"]).convert("RGB")
        t = time.perf_counter()
        try:
            raw = predict(img)
        except Exception as e:  # noqa: BLE001
            raw = f"<erreur {type(e).__name__}>"
        pred = canonicalize(raw)  # même mise en forme pour tous les modèles (et pour le serveur)
        ms = (time.perf_counter() - t) * 1e3
        ref_t, pred_t = tokens(l["latex"]), tokens(pred)
        rows.append({**l, "pred": pred, "pred_raw": raw, "ms": ms, "confidence": confidence() if confidence else None, "exact": normalize(pred) == normalize(l["latex"]),
                     "equivalent": equivalent(pred, l["latex"]),
                     "token_error_rate": edit_distance(pred_t, ref_t) / max(1, len(ref_t))})

    ms = sorted(r["ms"] for r in rows)
    metrics = {
        "exact_match": 100 * statistics.mean(r["exact"] for r in rows),
        "math_equivalence": 100 * statistics.mean(r["equivalent"] or r["exact"] for r in rows),
        "token_error_rate": 100 * statistics.mean(r["token_error_rate"] for r in rows),
        "latency_p50_ms": statistics.median(ms), "latency_p95_ms": ms[int(0.95 * (len(ms) - 1))],
        "n_images": len(rows),
    }
    for t in sorted({r["type"] for r in rows}):
        sub = [r for r in rows if r["type"] == t]
        metrics[f"math_equivalence.type.{t}"] = 100 * statistics.mean(r["equivalent"] or r["exact"] for r in sub)

    tracking.init()
    with mlflow.start_run(run_name=f"ocr-{args.model}-{data.name}"):
        mlflow.set_tags({"stage": "eval", "task": "ocr", "role": "quantization" if args.onnx else "baseline",
                         "model": args.model, "dataset": data.name})
        params = {"model": args.model, "data": str(data), "device": args.device}
        if args.onnx:
            files = reader.cfg["variants"][args.variant]
            size = sum(reader.cfg["files"][files[k]]["bytes"] for k in ("encoder", "decoder"))
            params |= {"variant": args.variant, "onnx_dir": str(args.onnx), "revision": reader.cfg["revision"]}
            mlflow.log_metric("model_mb", size / 1e6)
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "ocr_predictions.jsonl"
            p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
            mlflow.log_artifact(str(p))
    print(json.dumps({k: round(v, 2) for k, v in metrics.items()}, indent=1))


if __name__ == "__main__":
    main()
