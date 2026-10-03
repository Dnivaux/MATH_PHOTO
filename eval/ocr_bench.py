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

TOKEN_RE = re.compile(r"\\[a-zA-Z]+|\\.|[^\s]")


def normalize(latex: str) -> str:
    s = latex.strip().strip("$")
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
            s = normalize_latex(s)
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
    from texteller import img2latex, load_model, load_tokenizer

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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["pix2tex", "texteller"], required=True)
    ap.add_argument("--data", required=True, help="dossier avec labels.jsonl")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    data = Path(args.data)
    labels = [json.loads(l) for l in (data / "labels.jsonl").read_text().splitlines() if l.strip()]
    labels = [l for l in labels if (data / l["file"]).exists()][: args.limit]
    if not labels:
        raise SystemExit(f"aucune image étiquetée trouvée dans {data}")
    predict = load_pix2tex() if args.model == "pix2tex" else load_texteller(args.device)
    predict(Image.open(data / labels[0]["file"]).convert("RGB"))  # chauffe (chargement CUDA)

    rows = []
    for l in labels:
        img = Image.open(data / l["file"]).convert("RGB")
        t = time.perf_counter()
        try:
            pred = predict(img)
        except Exception as e:  # noqa: BLE001
            pred = f"<erreur {type(e).__name__}>"
        ms = (time.perf_counter() - t) * 1e3
        ref_t, pred_t = tokens(l["latex"]), tokens(pred)
        rows.append({**l, "pred": pred, "ms": ms, "exact": normalize(pred) == normalize(l["latex"]),
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
        mlflow.set_tags({"stage": "eval", "task": "ocr", "role": "baseline", "model": args.model, "dataset": data.name})
        mlflow.log_params({"model": args.model, "data": str(data), "device": args.device})
        mlflow.log_metrics(metrics)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "ocr_predictions.jsonl"
            p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
            mlflow.log_artifact(str(p))
    print(json.dumps({k: round(v, 2) for k, v in metrics.items()}, indent=1))


if __name__ == "__main__":
    main()
