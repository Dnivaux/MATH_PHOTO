"""Gateway réelle : remplace la factice, même contrat.

    VLLM_BASE_URL=http://localhost:8000/v1 VLLM_MODEL=teacher-ft \
    uvicorn serving.gateway.app:app --host 0.0.0.0 --port 8100

Option mode léger : EXPLAIN_BASE_URL / EXPLAIN_MODEL (ex. llama-server sur le GGUF Qwen3-0.6B).
"""

from __future__ import annotations

import os
import uuid

from fastapi import Depends, FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from openai import OpenAI

from common.prompts import explain_messages
from eval.faithfulness import check_explanation
from serving.gateway import pipeline
from serving.gateway.auth import require_token
from serving.gateway.schema import (
    ExplainRequest, ExplainResponse, Explanation, Health, ModelInfo, SolveRequest, SolveResponse,
)

VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")
VLLM_MODEL = os.getenv("VLLM_MODEL", "teacher-ft")
MODEL_VERSION = os.getenv("VLLM_MODEL_VERSION")  # version du registry MLflow servie
EXPLAIN_BASE_URL = os.getenv("EXPLAIN_BASE_URL")
EXPLAIN_MODEL = os.getenv("EXPLAIN_MODEL", "explainer")

app = FastAPI(title="Photo → Maths gateway", version="1.0")
_code_client = OpenAI(base_url=VLLM_BASE_URL, api_key="EMPTY", timeout=60)


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


@app.post("/v1/solve", response_model=SolveResponse, dependencies=[Depends(require_token)])
async def solve(req: SolveRequest):
    models = ModelInfo(code_model=VLLM_MODEL, code_model_version=MODEL_VERSION)
    # Le bac à sable et SymPy sont bloquants : on les sort de la boucle asyncio.
    return await run_in_threadpool(pipeline.solve, req, _generate_code, models)


@app.post("/v1/explain", response_model=ExplainResponse, dependencies=[Depends(require_token)])
async def explain(req: ExplainRequest):
    if not EXPLAIN_BASE_URL:
        raise HTTPException(503, "explication serveur (mode léger) non configurée : EXPLAIN_BASE_URL")
    problem = {"type": req.problem.type.value, "vars": req.problem.variables, "latex": req.problem.latex,
               "statement_fr": f"${req.problem.latex}$", "answer_latex": req.result.latex,
               "steps": [{"text_fr": s.text_fr, "latex": s.latex} for s in req.steps]}
    client = OpenAI(base_url=EXPLAIN_BASE_URL, api_key="EMPTY", timeout=60)
    r = await run_in_threadpool(lambda: client.chat.completions.create(
        model=EXPLAIN_MODEL, messages=explain_messages(problem, req.level.value), temperature=0.3, max_tokens=800,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}}))
    text = r.choices[0].message.content or ""
    try:  # fidélité : nécessite la réponse SymPy, recalculée depuis le LaTeX
        from datagen.from_latex import from_latex

        score = check_explanation(text, from_latex(req.problem.latex, req.problem.type.value)).score
    except Exception:  # noqa: BLE001
        score = 0.0
    return ExplainResponse(request_id=uuid.uuid4().hex, models=ModelInfo(explain_model=EXPLAIN_MODEL),
                           explanation=Explanation(level=req.level, text_fr=text, faithfulness=score))
