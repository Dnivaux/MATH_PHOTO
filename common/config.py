"""Chemins et variables d'environnement partagés."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
# Le téléchargement multipart via le proxy d'artefacts MLflow bloque (requêtes Range) : désactivé.
os.environ.setdefault("MLFLOW_ENABLE_PROXY_MULTIPART_DOWNLOAD", "false")

DATA = ROOT / "data"
MODELS = ROOT / "models"
EVAL_SET = DATA / "eval" / "problems_v1.jsonl"
TRAIN_POOL = DATA / "train" / "pool_v1.jsonl"

MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
MLFLOW_EXPERIMENT = os.getenv("MLFLOW_EXPERIMENT", "photo-maths")
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")

# Modèles Hugging Face du week-end
QWEN_MATH_1_5B = "Qwen/Qwen2.5-Math-1.5B-Instruct"
QWEN_MATH_7B = "Qwen/Qwen2.5-Math-7B-Instruct"
QWEN3_0_6B = "Qwen/Qwen3-0.6B"
QWEN3_1_7B = "Qwen/Qwen3-1.7B"
QWEN3_8B = "Qwen/Qwen3-8B"  # enseignant multilingue pour les explications françaises


def read_jsonl(path) -> list[dict]:
    import json

    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def write_jsonl(path, rows) -> None:
    import json

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
