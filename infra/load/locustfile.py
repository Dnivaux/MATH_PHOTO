"""Test de charge de la gateway (grille MLOps 2) : des téléphones simulés qui escaladent vers le serveur.

Mélange réaliste, d'après le dossier (« Escalade vers le serveur ») : surtout des résolutions (problèmes du jeu
d'évaluation figé, tous types), quelques relectures de photo par l'OCR serveur et des vérifications de mise à
jour du modèle. Les requêtes portent `app_version = locust` : la détection de dérive les écarte.

Lancé par eval/load_test.py (paliers d'utilisateurs, résultats dans MLflow) ou à la main :
    .venv/bin/locust -f infra/load/locustfile.py --host http://localhost:8100

LOAD_TYPES=limit,integral ne tire que ces types : trafic volontairement déséquilibré, pour montrer que
eval/drift.py détecte la dérive.
"""

from __future__ import annotations

import base64
import json
import os
import random
from pathlib import Path

from locust import HttpUser, between, task

ROOT = Path(__file__).resolve().parents[2]
TOKEN = os.getenv("LOAD_TOKEN", "dev-token")
PROBLEMS = [json.loads(line) for line in (ROOT / "data/eval/problems_v1.jsonl").read_text().splitlines() if line.strip()]
if os.getenv("LOAD_TYPES"):
    PROBLEMS = [p for p in PROBLEMS if p["type"] in os.getenv("LOAD_TYPES").split(",")]
_ocr = ROOT / "data/ocr/synthetic"
IMAGES = [base64.b64encode((_ocr / json.loads(line)["file"]).read_bytes()).decode()
          for line in (_ocr / "labels.jsonl").read_text().splitlines()[:40] if line.strip()] if _ocr.exists() else []
CLIENT = {"platform": "android", "app_version": "locust", "mode": "complet"}


class Phone(HttpUser):
    wait_time = between(1, 3)  # temps de lecture entre deux exercices

    def on_start(self):
        self.client.headers["Authorization"] = f"Bearer {TOKEN}"

    @task(8)
    def solve(self):
        p = random.choice(PROBLEMS)
        body = {"latex": p["latex"], "type_hint": p["type"], "client": CLIENT,
                "escalation": {"reason": "out_of_local_scope"}}
        with self.client.post("/v1/solve", json=body, name=f"/v1/solve [{p['type']}]", catch_response=True) as r:
            if r.status_code == 200 and r.json().get("status") == "error":
                r.failure(f"status error : {r.json().get('error', {}).get('code')}")

    @task(1)
    def ocr(self):
        if IMAGES:
            self.client.post("/v1/ocr", json={"image_base64": random.choice(IMAGES), "client": CLIENT}, name="/v1/ocr")

    @task(1)
    def model_update(self):
        self.client.get("/v1/models/android/latest", name="/v1/models/{client}/latest")
