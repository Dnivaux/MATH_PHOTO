"""Test de charge par paliers (grille MLOps 2) : Locust sans interface, un run MLflow par palier d'utilisateurs.

Métriques par palier : débit (req/s), latence p50 / p95 / p99 par endpoint et au total, taux d'échec. Le palier
où la p95 de /v1/solve dépasse le budget (--budget-ms) donne la capacité de la stack pour le rapport.

    .venv/bin/python -m eval.load_test --users 1 4 8 16 --duration 90
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import mlflow

from common import tracking

ROOT = Path(__file__).resolve().parents[1]
LOCUSTFILE = ROOT / "infra/load/locustfile.py"


def run_step(host: str, users: int, duration: int, out: Path) -> list[dict]:
    prefix = out / f"u{users}"
    cmd = [sys.executable, "-m", "locust", "-f", str(LOCUSTFILE), "--headless", "--host", host,
           "-u", str(users), "-r", str(max(1, users // 2)), "-t", f"{duration}s", "--csv", str(prefix),
           "--html", f"{prefix}.html", "--only-summary"]
    subprocess.run(cmd, check=False, capture_output=True, text=True)
    with open(f"{prefix}_stats.csv") as f:
        return list(csv.DictReader(f))


def slug(name: str) -> str:
    return name.replace("/v1/", "").replace("/", "_").replace(" ", "").replace("[", ".").replace("]", "").replace("{", "").replace("}", "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://localhost:8100")
    ap.add_argument("--users", type=int, nargs="+", default=[1, 4, 8, 16])
    ap.add_argument("--duration", type=int, default=90, help="secondes par palier")
    ap.add_argument("--budget-ms", type=float, default=5000, help="p95 acceptable pour /v1/solve")
    ap.add_argument("--env", default="local", help="local (PC, GPU) | staging (VM, faux LLM) : tag et nom des runs")
    args = ap.parse_args()

    tracking.init()
    summary = []
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        for users in args.users:
            rows = run_step(args.host, users, args.duration, out)
            total = next(r for r in rows if r["Name"] == "Aggregated")
            solve = [r for r in rows if r["Name"].startswith("/v1/solve")]
            n_solve = sum(int(r["Request Count"]) for r in solve) or 1
            # p95 de /v1/solve pondérée par le nombre de requêtes de chaque type
            p95_solve = sum(float(r["95%"]) * int(r["Request Count"]) for r in solve) / n_solve
            metrics = {
                "rps": float(total["Requests/s"]),
                "requests": int(total["Request Count"]),
                "failure_rate": 100 * int(total["Failure Count"]) / max(1, int(total["Request Count"])),
                "latency_p50_ms": float(total["50%"]), "latency_p95_ms": float(total["95%"]), "latency_p99_ms": float(total["99%"]),
                "solve_p95_ms": p95_solve,
            }
            for r in rows:
                if r["Name"] != "Aggregated" and int(r["Request Count"]):
                    metrics[f"{slug(r['Name'])}.p50_ms"] = float(r["50%"])
                    metrics[f"{slug(r['Name'])}.p95_ms"] = float(r["95%"])
            name = f"load-{users}u" if args.env == "local" else f"load-{args.env}-{users}u"
            with mlflow.start_run(run_name=name):
                mlflow.set_tags({"stage": "eval", "task": "load", "role": "load_test", "env": args.env})
                mlflow.log_params({"users": users, "duration_s": args.duration, "host": args.host, "budget_ms": args.budget_ms,
                                   "mix": "solve 8 : ocr 1 : models 1, attente 1-3 s",
                                   "skip": os.getenv("LOAD_SKIP", "")})
                mlflow.log_metrics(metrics)
                for f in out.glob(f"u{users}*"):
                    mlflow.log_artifact(str(f))
            summary.append({"users": users, **{k: round(v, 1) for k, v in metrics.items() if "." not in k}})
            print(json.dumps(summary[-1]))
    ok = [s for s in summary if s["solve_p95_ms"] <= args.budget_ms and s["failure_rate"] < 1]
    print(f"capacité : {max(s['users'] for s in ok) if ok else 0} utilisateurs simultanés avec /v1/solve p95 ≤ {args.budget_ms:.0f} ms")


if __name__ == "__main__":
    main()
