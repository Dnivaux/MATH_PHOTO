"""Décision du canary (grille MLOps 3) : compare le challenger au champion sur le trafic réel et règle sa part.

Lignes : GET /admin/usage/rows, comme eval/drift.py. Un run MLflow par décision.

    .venv/bin/python -m eval.canary_check --hours 1            # affiche la décision
    .venv/bin/python -m eval.canary_check --hours 1 --apply    # l'applique (PUT /admin/canary)
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STEPS = [0.1, 0.25, 0.5, 1.0]
MIN_ROWS = 30
TOLERANCE_PTS = 2.0  # bruit mesuré entre deux runs identiques
MAX_FALLBACK_PCT = 1.0
LATENCY_RATIO = 1.2


def decide(champion: dict, can: dict, fallback_pct: float) -> tuple[str, str]:
    if fallback_pct > MAX_FALLBACK_PCT:
        return "rollback", f"{fallback_pct:.1f} % de replis sur le champion"
    if min(champion["n"], can["n"]) < MIN_ROWS:
        return "hold", f"moins de {MIN_ROWS} requêtes par variante"
    if can["ok_pct"] < champion["ok_pct"] - TOLERANCE_PTS:
        return "rollback", f"vérifiés : {can['ok_pct']:.1f} % contre {champion['ok_pct']:.1f} %"
    if can["llm_p95_ms"] > LATENCY_RATIO * champion["llm_p95_ms"]:
        return "rollback", f"p95 LLM : {can['llm_p95_ms']:.0f} ms contre {champion['llm_p95_ms']:.0f} ms"
    return "advance", "le challenger tient la comparaison"


def next_weight(decision: str, current: float) -> float:
    if decision == "rollback":
        return 0.0
    if decision == "hold":
        return current
    return next((s for s in STEPS if s > current), current)


def stats(df) -> dict:
    return {"n": len(df), "ok_pct": 100 * float((df["status"] == "ok").mean()) if len(df) else 0.0,
            "llm_p95_ms": float(df["llm_ms"].quantile(0.95)) if len(df) else 0.0}


def main() -> None:
    import httpx
    import mlflow
    from dotenv import load_dotenv

    from common import tracking
    from eval.drift import fetch

    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.getenv("GATEWAY_URL", "http://localhost:8100"))
    ap.add_argument("--token", default=os.getenv("GATEWAY_ADMIN_TOKEN"))
    ap.add_argument("--hours", type=float, default=1)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not args.token:
        raise SystemExit("GATEWAY_ADMIN_TOKEN manquant (variable d'environnement ou --token)")

    df = fetch(args.host, args.token, args.hours)
    if df.empty or "variant" not in df:
        raise SystemExit("aucune résolution avec variante dans la fenêtre")
    df = df.dropna(subset=["problem_type", "variant"])
    fell_back = df["canary_fallback"].eq(True)
    on_canary = df["variant"] == "canary"
    champion, can = stats(df[~on_canary]), stats(df[on_canary & ~fell_back])
    fallback_pct = 100 * float(fell_back[on_canary].mean()) if on_canary.any() else 0.0

    headers = {"Authorization": f"Bearer {args.token}"}
    url = f"{args.host.rstrip('/')}/admin/canary"
    current = httpx.get(url, headers=headers, timeout=30).raise_for_status().json()["weight"]
    decision, why = decide(champion, can, fallback_pct)
    target = next_weight(decision, current)
    print(f"{decision} : {why} ; part {current:g}, puis {target:g}")
    print(f"   champion {champion}\n   canary   {can}\n   replis   {fallback_pct:.1f} %")

    tracking.init()
    with mlflow.start_run(run_name="canary-check"):
        mlflow.set_tags({"stage": "monitoring", "task": "canary", "decision": decision, "applied": str(args.apply).lower()})
        mlflow.log_metrics({"weight_before": current, "weight_after": target, "fallback_pct": fallback_pct,
                            **{f"champion.{k}": v for k, v in champion.items()},
                            **{f"canary.{k}": v for k, v in can.items()}})
    if args.apply and target != current:
        httpx.put(url, json={"weight": target}, headers=headers, timeout=30).raise_for_status()


if __name__ == "__main__":
    main()
