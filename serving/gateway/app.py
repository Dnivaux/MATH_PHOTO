"""Gateway réelle : remplace la factice, même contrat.

    VLLM_BASE_URL=http://localhost:8000/v1 VLLM_MODEL=teacher-ft \
    uvicorn serving.gateway.app:app --host 0.0.0.0 --port 8100

Option mode léger : EXPLAIN_BASE_URL / EXPLAIN_MODEL (ex. llama-server sur le GGUF Qwen3-0.6B).
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from openai import OpenAI

from common.prompts import explain_messages
from eval.faithfulness import check_explanation
from serving.gateway import admin, metrics, models, pipeline, usage
from serving.gateway.auth import require_token
from serving.gateway.features import latex_features
from serving.gateway.schema import (
    ExplainRequest, ExplainResponse, Explanation, Health, ModelInfo, OcrCollectRequest, OcrCollectResponse, OcrRequest,
    OcrResponse, SolveRequest, SolveResponse,
)
from serving.gateway.usage import Principal

VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "teacher-ft")
# Version du registry MLflow servie : variable, sinon le fichier écrit par serving/fetch_models.py (docker compose)
_VERSION_FILE = Path(os.getenv("REGISTRY_DIR", "/registry"), os.getenv("CODE_MODEL_REGISTRY", "math-7b-teacher"), "VERSION")
MODEL_VERSION = os.getenv("VLLM_MODEL_VERSION") or (_VERSION_FILE.read_text().strip() if _VERSION_FILE.exists() else None)
EXPLAIN_BASE_URL = os.getenv("EXPLAIN_BASE_URL")
EXPLAIN_MODEL = os.getenv("EXPLAIN_MODEL", "explainer")
OCR_URL = os.getenv("OCR_URL")  # service OCR serveur (serving/ocr/service.py, TexTeller)
# Développement seulement (vide par défaut) : garde les photos relues et la lecture du serveur, pour comprendre
# une mauvaise lecture et constituer le jeu de vraies photos. Jamais activé en production (données des élèves).
OCR_CAPTURE_DIR = os.getenv("OCR_CAPTURE_DIR")

app = FastAPI(title="Photo → Maths gateway", version="1.0")
app.include_router(models.router)
app.include_router(admin.router)
app.include_router(metrics.router)
_code_client = OpenAI(base_url=VLLM_BASE_URL, api_key="EMPTY", timeout=60)


async def _read_image_async(image_base64: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{OCR_URL.rstrip('/')}/ocr", json={"image_base64": image_base64})
    r.raise_for_status()
    return r.json()["latex"]


def _read_image(image_base64: str) -> str:
    import httpx

    r = httpx.post(f"{OCR_URL.rstrip('/')}/ocr", json={"image_base64": image_base64}, timeout=30)
    r.raise_for_status()
    return r.json()["latex"]


def _generate_code(messages: list[dict]) -> str:
    r = _code_client.chat.completions.create(model=VLLM_MODEL, messages=messages, temperature=0.0, max_tokens=1024)
    return r.choices[0].message.content or ""


@app.get("/health", response_model=Health)
def health():
    try:
        _code_client.models.list()
        return Health(status="ok", llm=True)
    except Exception:  # noqa: BLE001
        return Health(status="degraded", llm=False)


@app.post("/v1/solve", response_model=SolveResponse)
async def solve(req: SolveRequest, bg: BackgroundTasks, who: Principal = Depends(require_token)):
    info = ModelInfo(code_model=VLLM_MODEL, code_model_version=MODEL_VERSION)
    # Le bac à sable et SymPy sont bloquants : on les sort de la boucle asyncio.
    resp = await run_in_threadpool(pipeline.solve, req, _generate_code, info, None, _read_image if OCR_URL else None)
    metrics.observe_solve(who, req, resp)
    # Usage par utilisateur, écrit après l'envoi de la réponse
    bg.add_task(usage.record, who, "solve", platform=req.client.platform, mode=req.client.mode,
                problem_type=resp.problem.type.value if resp.problem else None,
                escalation_reason=req.escalation.reason.value if req.escalation else None,
                status=resp.status, error_code=resp.error.code.value if resp.error else None,
                total_ms=resp.timings.total_ms, llm_ms=resp.timings.llm_ms, model=VLLM_MODEL, model_version=MODEL_VERSION,
                extra={"attempts": resp.code.attempts if resp.code else None, "request_id": resp.request_id,
                       "input": "+".join(k for k, v in (("latex", req.latex), ("image", req.image_base64)) if v),
                       "latex_source": resp.problem.latex_source if resp.problem else None, "ocr_ms": resp.timings.ocr_ms,
                       # suivi de dérive (eval/drift.py) : caractéristiques de la formule, pas la formule
                       **latex_features(resp.problem.latex if resp.problem else req.latex),
                       "app_version": req.client.app_version,
                       "ocr_confidence": req.escalation.ocr_confidence if req.escalation else None})
    return resp


@app.post("/v1/ocr", response_model=OcrResponse)
async def ocr(req: OcrRequest, bg: BackgroundTasks, who: Principal = Depends(require_token)):
    """Relecture d'une photo : le téléphone l'appelle quand sa propre lecture est douteuse (dossier, « Escalade »)."""
    if not OCR_URL:
        raise HTTPException(503, "OCR serveur non configuré : OCR_URL")
    t0 = time.perf_counter()
    try:
        # asynchrone : une relecture en attente (TexTeller sur CPU, une photo à la fois) n'occupe pas un des fils de
        # la gateway ; sinon, sous charge, elle bloque les résolutions (test de charge à 128 utilisateurs)
        latex = await _read_image_async(req.image_base64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"OCR serveur indisponible : {type(e).__name__}") from e
    ms = (time.perf_counter() - t0) * 1e3
    rid = uuid.uuid4().hex
    metrics.observe_ocr(req.client.platform, ms)
    bg.add_task(usage.record, who, "ocr", platform=req.client.platform, mode=req.client.mode, status="ok",
                total_ms=ms, model="texteller", extra={"request_id": rid})
    if OCR_CAPTURE_DIR:
        bg.add_task(_capture, rid, req.image_base64, latex)
    return OcrResponse(request_id=rid, latex=latex, ms=ms)


def _capture(rid: str, image_base64: str, latex: str) -> None:
    import base64

    d = Path(OCR_CAPTURE_DIR)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{time.strftime('%Y%m%d-%H%M%S')}-{rid[:8]}.jpg").write_bytes(base64.b64decode(image_base64))
    with (d / "captures.jsonl").open("a") as f:
        f.write(json.dumps({"request_id": rid, "latex_server": latex, "at": time.time()}) + "\n")


@app.post("/v1/ocr/collect", response_model=OcrCollectResponse)
def ocr_collect(req: OcrCollectRequest, who: Principal = Depends(require_token)):
    """Mode collecte de l'app : chaque zone scannée est gardée avec les lectures du téléphone (banc OCR réel)."""
    if not OCR_CAPTURE_DIR:
        raise HTTPException(404, "collecte désactivée : OCR_CAPTURE_DIR")
    import base64

    d = Path(OCR_CAPTURE_DIR, "collect")
    (d / req.condition).mkdir(parents=True, exist_ok=True)
    cid = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    (d / req.condition / f"{cid}.jpg").write_bytes(base64.b64decode(req.image_base64))
    row = req.model_dump(exclude={"image_base64"}) | {"id": cid, "file": f"{req.condition}/{cid}.jpg", "at": time.time()}
    with (d / "collect.jsonl").open("a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return OcrCollectResponse(id=cid, count=len(list((d / req.condition).glob("*.jpg"))))


@app.post("/v1/explain", response_model=ExplainResponse)
async def explain(req: ExplainRequest, bg: BackgroundTasks, who: Principal = Depends(require_token)):
    if not EXPLAIN_BASE_URL:
        raise HTTPException(503, "explication serveur (mode léger) non configurée : EXPLAIN_BASE_URL")
    problem = {"type": req.problem.type.value, "vars": req.problem.variables, "latex": req.problem.latex,
               "statement_fr": f"${req.problem.latex}$", "answer_latex": req.result.latex,
               "steps": [{"text_fr": s.text_fr, "latex": s.latex} for s in req.steps]}
    client = OpenAI(base_url=EXPLAIN_BASE_URL, api_key="EMPTY", timeout=60)
    t0 = time.perf_counter()
    r = await run_in_threadpool(lambda: client.chat.completions.create(
        model=EXPLAIN_MODEL, messages=explain_messages(problem, req.level.value), temperature=0.3, max_tokens=800,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}}))
    text = r.choices[0].message.content or ""
    try:  # fidélité : nécessite la réponse SymPy, recalculée depuis le LaTeX
        from datagen.from_latex import from_latex

        score = check_explanation(text, from_latex(req.problem.latex, req.problem.type.value)).score
    except Exception:  # noqa: BLE001
        score = 0.0
    llm_ms = (time.perf_counter() - t0) * 1e3
    rid = uuid.uuid4().hex
    metrics.observe_explain(who, req.problem.type.value, llm_ms, score)
    bg.add_task(usage.record, who, "explain", mode="leger", problem_type=req.problem.type.value, status="ok",
                total_ms=llm_ms, llm_ms=llm_ms, model=EXPLAIN_MODEL,
                extra={"level": req.level.value, "faithfulness": score, "request_id": rid,
                       "completion_tokens": r.usage.completion_tokens if r.usage else None})
    return ExplainResponse(request_id=rid, models=ModelInfo(explain_model=EXPLAIN_MODEL),
                           explanation=Explanation(level=req.level, text_fr=text, faithfulness=score))
