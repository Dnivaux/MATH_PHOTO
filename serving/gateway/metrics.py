"""Métriques Prometheus de la gateway (dossier, phase 9 : système et métier). Exposées sur GET /metrics.

- requêtes par endpoint, statut, client, type de problème et raison d'escalade ;
- latences par étape (parse, LLM, bac à sable, total) ;
- temps LLM par utilisateur, proxy du temps GPU pour le tableau de bord des coûts ;
- tentatives d'auto-correction, fidélité des explications serveur.
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

from serving.gateway import canary
from serving.gateway.schema import SolveRequest, SolveResponse
from serving.gateway.usage import Principal

REQUESTS = Counter("gateway_requests_total", "Requêtes traitées",
                   ["endpoint", "status", "platform", "problem_type", "escalation_reason"])
STAGE_SECONDS = Histogram("gateway_stage_seconds", "Durée par étape", ["endpoint", "stage"],
                          buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32))
LLM_SECONDS = Counter("gateway_llm_seconds_total", "Temps passé dans les LLM (proxy du temps GPU)", ["user", "endpoint"])
ATTEMPTS = Histogram("gateway_solve_attempts", "Tentatives par résolution (1 + auto-corrections)", buckets=(1, 2, 3))
SERVER_OCR = Counter("gateway_server_ocr_total", "Photos relues par l'OCR serveur et résolues avec sa lecture")
FAITHFULNESS = Histogram("gateway_explain_faithfulness", "Fidélité des explications serveur",
                         buckets=(0.5, 0.8, 0.9, 0.95, 0.99, 1.0))
VARIANT_SOLVES = Counter("gateway_variant_solves_total", "Résolutions où le LLM a été appelé", ["variant", "status"])
VARIANT_LLM_SECONDS = Histogram("gateway_variant_llm_seconds", "Temps LLM par résolution", ["variant"],
                                buckets=(0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32))
CANARY_WEIGHT = Gauge("gateway_canary_weight", "Part du trafic envoyée au canary")
CANARY_WEIGHT.set_function(canary.weight)

router = APIRouter()


@router.get("/metrics", include_in_schema=False)
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def observe_solve(who: Principal, req: SolveRequest, resp: SolveResponse) -> None:
    REQUESTS.labels("solve", resp.status, req.client.platform, resp.problem.type.value if resp.problem else "none",
                    req.escalation.reason.value if req.escalation else "none").inc()
    t = resp.timings
    for stage, ms in (("parse", t.parse_ms), ("llm", t.llm_ms), ("sandbox", t.sandbox_ms), ("total", t.total_ms)):
        STAGE_SECONDS.labels("solve", stage).observe(ms / 1e3)
    if t.ocr_ms:
        STAGE_SECONDS.labels("solve", "ocr").observe(t.ocr_ms / 1e3)
    if resp.problem and resp.problem.latex_source == "server_ocr":
        SERVER_OCR.inc()
    LLM_SECONDS.labels(who.user, "solve").inc(t.llm_ms / 1e3)
    if resp.code:
        ATTEMPTS.observe(resp.code.attempts)


def observe_variant(route: canary.Route, resp: SolveResponse) -> None:
    if resp.problem is None and not route.fell_back:
        return  # formule illisible : le modèle n'y est pour rien
    VARIANT_SOLVES.labels(route.variant, "fallback" if route.fell_back else resp.status).inc()
    if not route.fell_back:
        VARIANT_LLM_SECONDS.labels(route.variant).observe(resp.timings.llm_ms / 1e3)


def observe_ocr(platform: str, ms: float) -> None:
    REQUESTS.labels("ocr", "ok", platform, "none", "none").inc()
    STAGE_SECONDS.labels("ocr", "ocr").observe(ms / 1e3)


def observe_explain(who: Principal, problem_type: str, llm_ms: float, faithfulness: float) -> None:
    REQUESTS.labels("explain", "ok", "none", problem_type, "none").inc()
    STAGE_SECONDS.labels("explain", "llm").observe(llm_ms / 1e3)
    LLM_SECONDS.labels(who.user, "explain").inc(llm_ms / 1e3)
    FAITHFULNESS.observe(faithfulness)
