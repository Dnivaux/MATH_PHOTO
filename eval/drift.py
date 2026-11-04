"""Détection de dérive (grille MLOps 2, Evidently) sur les requêtes reçues par la gateway.

Deux comparaisons, un run MLflow chacune (rapport HTML en artefact) :
  entrées     formules reçues (type, longueur, variables, fractions, puissance, fonctions) face aux données
              d'entraînement (data/train/pool_v1.jsonl) : les élèves envoient-ils ce que les modèles ont appris ?
  production  fenêtre courante face à la précédente : types, raisons d'escalade, statuts, source du LaTeX,
              latence, tentatives d'auto-correction.

Les lignes viennent de GET /admin/usage/rows (jeton GATEWAY_ADMIN_TOKEN) : la formule elle-même n'est pas
stockée, seulement ses caractéristiques (serving/gateway/features.py, même calcul des deux côtés). Le trafic
du test de charge (app_version = locust) est écarté, sauf --include-load.

    .venv/bin/python -m eval.drift --hours 168            # code de sortie 1 si dérive avec --fail-on-drift
"""

from __future__ import annotations

import argparse
import json
import os
import random
import warnings
import tempfile
from pathlib import Path

os.environ.setdefault("EVIDENTLY_DISABLE_TELEMETRY", "1")
warnings.filterwarnings("ignore", category=RuntimeWarning)  # corrélations d'une colonne constante (Evidently)

import httpx  # noqa: E402
import mlflow  # noqa: E402
import pandas as pd  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

from common import tracking  # noqa: E402
from serving.gateway.features import latex_features  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ["latex_len", "n_vars", "n_frac", "max_power", "n_functions"]
MIN_ROWS = 30


def reference(n: int) -> pd.DataFrame:
    rows = [json.loads(line) for line in (ROOT / "data/train/pool_v1.jsonl").read_text().splitlines() if line.strip()]
    random.Random(0).shuffle(rows)
    return pd.DataFrame([{"problem_type": r["type"], **latex_features(r["latex"])} for r in rows[:n]])


def fetch(host: str, token: str, hours: float) -> pd.DataFrame:
    r = httpx.get(f"{host.rstrip('/')}/admin/usage/rows", params={"endpoint": "solve", "hours": hours},
                  headers={"Authorization": f"Bearer {token}"}, timeout=60)
    r.raise_for_status()
    rows = [{**{k: v for k, v in x.items() if k != "extra"}, **(x.get("extra") or {})} for x in r.json()]
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"], utc=True, format="ISO8601")
    return df


def drift_report(cur: pd.DataFrame, ref: pd.DataFrame, numerical: list[str], categorical: list[str]):
    from evidently import DataDefinition, Dataset, Report
    from evidently.presets import DataDriftPreset

    cols = numerical + categorical
    dd = DataDefinition(numerical_columns=numerical, categorical_columns=categorical)
    snap = Report([DataDriftPreset()]).run(Dataset.from_pandas(cur[cols], data_definition=dd),
                                           Dataset.from_pandas(ref[cols], data_definition=dd))
    columns, share = {}, 0.0
    for m in snap.dict()["metrics"]:
        if m["metric_name"].startswith("DriftedColumnsCount"):
            share = m["value"]["share"]
        elif m["metric_name"].startswith("ValueDrift"):
            # méthode choisie par Evidently selon le type et la taille : p-value (dérive si petite) ou
            # distance (Wasserstein, Jensen-Shannon, PSI : dérive si grande)
            method, thr, value = m["config"]["method"], float(m["config"]["threshold"]), float(m["value"])
            columns[m["config"]["column"]] = {"method": method, "value": value, "threshold": thr,
                                              "drift": value < thr if "p_value" in method else value >= thr}
    return snap, share, columns


def log(name: str, snap, share: float, columns: dict, n_cur: int, n_ref: int, params: dict) -> bool:
    drifted = [c for c, v in columns.items() if v["drift"]]
    is_drift = share >= 0.5
    with mlflow.start_run(run_name=name):
        mlflow.set_tags({"stage": "monitoring", "task": "drift", "drift": str(is_drift).lower(),
                         "drifted_columns": ",".join(drifted) or "-"})
        mlflow.log_params({**params, "n_current": n_cur, "n_reference": n_ref,
                           **{f"method.{c}": v["method"] for c, v in columns.items()}})
        mlflow.log_metrics({"share_drifted": share, "n_current": n_cur, **{f"score.{c}": v["value"] for c, v in columns.items()}})
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / f"{name}.html"
            snap.save_html(str(p))
            mlflow.log_artifact(str(p))
    print(f"{name} : {n_cur} requêtes, {share:.0%} des colonnes dérivent" + (f" ({', '.join(drifted)})" if drifted else ""))
    for c, v in columns.items():
        print(f"   {c:18s} {v['method']:32s} {v['value']:.3g} (seuil {v['threshold']:g}){'  ← dérive' if v['drift'] else ''}")
    return is_drift


def main() -> None:
    load_dotenv(ROOT / ".env")  # GATEWAY_ADMIN_TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.getenv("GATEWAY_URL", "http://localhost:8100"))
    ap.add_argument("--token", default=os.getenv("GATEWAY_ADMIN_TOKEN"))
    ap.add_argument("--hours", type=float, default=24 * 7, help="fenêtre courante (la précédente a la même durée)")
    ap.add_argument("--reference-size", type=int, default=5000)
    ap.add_argument("--include-load", action="store_true", help="garder le trafic du test de charge")
    ap.add_argument("--fail-on-drift", action="store_true")
    args = ap.parse_args()
    if not args.token:
        raise SystemExit("GATEWAY_ADMIN_TOKEN manquant (variable d'environnement ou --token)")

    df = fetch(args.host, args.token, 2 * args.hours)
    if not df.empty and not args.include_load:
        df = df[(df.get("app_version") != "locust") & (df["platform"] != "test")]
    if df.empty or "latex_len" not in df:
        raise SystemExit("aucune requête avec caractéristiques dans la fenêtre")
    cut = df["ts"].max() - pd.Timedelta(hours=args.hours)
    cur, prev = df[df["ts"] > cut], df[df["ts"] <= cut]
    params = {"hours": args.hours, "include_load": args.include_load}
    tracking.init()
    drift = False

    inputs = cur.dropna(subset=FEATURES + ["problem_type"])
    if len(inputs) >= MIN_ROWS:
        ref = reference(args.reference_size)
        snap, share, cols = drift_report(inputs, ref, FEATURES, ["problem_type"])
        drift |= log("drift-entrees", snap, share, cols, len(inputs), len(ref), params)
    else:
        print(f"entrées : {len(inputs)} requêtes, moins de {MIN_ROWS} : pas de comparaison")

    ops_num, ops_cat = ["total_ms", "attempts"], ["problem_type", "escalation_reason", "status", "latex_source"]
    # attempts est vide quand le code n'a pas été demandé (want_code = false) : 0 tentative affichée
    a, b = (x.assign(**{c: x[c].fillna("none") for c in ops_cat if c in x},
                     **({"attempts": x["attempts"].fillna(0)} if "attempts" in x else {})) for x in (cur, prev))
    a, b = (x.assign(**{c: pd.to_numeric(x[c], errors="coerce") for c in ops_num if c in x}) for x in (a, b))
    a, b = (x.dropna(subset=["total_ms"]) for x in (a, b))
    if len(a) >= MIN_ROWS and len(b) >= MIN_ROWS and all(c in a and c in b for c in ops_num + ops_cat):
        snap, share, cols = drift_report(a, b, ops_num, ops_cat)
        drift |= log("drift-production", snap, share, cols, len(a), len(b), params)
    else:
        print(f"production : {len(a)} requêtes contre {len(b)} dans la fenêtre précédente : pas de comparaison")

    if drift and args.fail_on_drift:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
