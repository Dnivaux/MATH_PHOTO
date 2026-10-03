"""Gateway factice : même contrat que la vraie, réponses fixes. Le collègue développe l'app sans GPU.

    uvicorn serving.gateway.mock:app --host 0.0.0.0 --port 8100
    curl -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
         -d '{"latex": "x^2-5x+6=0", "want_code": true}' localhost:8100/v1/solve

Scénarios forcés avec l'en-tête `X-Mock-Scenario: ok | unverified | error | slow`.
Les exemples (serving/gateway/examples/*.json) sont générés par `python -m serving.gateway.export_contract`.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, Header

from datagen.from_latex import detect_type
from serving.gateway.auth import require_token
from serving.gateway.schema import (
    ErrorCode, ErrorInfo, ExplainRequest, ExplainResponse, Explanation, Health, SolveRequest, SolveResponse,
)

EXAMPLES = Path(__file__).with_name("examples")
app = FastAPI(title="Photo → Maths gateway (factice)", version="1.0")


def _example(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text())


@app.get("/health", response_model=Health)
def health():
    return Health(status="ok", mock=True)


@app.post("/v1/solve", response_model=SolveResponse, dependencies=[Depends(require_token)])
async def solve(req: SolveRequest, x_mock_scenario: str = Header("ok")):
    if x_mock_scenario == "slow":
        await asyncio.sleep(3)
    if x_mock_scenario == "error":
        return SolveResponse(request_id=uuid.uuid4().hex, status="error", escalation=req.escalation,
                             error=ErrorInfo(code=ErrorCode.parse_error, message="LaTeX illisible (scénario factice)"))
    try:
        ptype = req.type_hint.value if req.type_hint else detect_type(req.latex or "")
    except ValueError:
        ptype = "equation"
    resp = SolveResponse(**_example(f"solve_{ptype}"))
    resp.request_id, resp.escalation = uuid.uuid4().hex, req.escalation
    if not req.want_code:
        resp.code = None
    if x_mock_scenario == "unverified":
        resp.status = "unverified"
        resp.result.verified = False
        resp.error = ErrorInfo(code=ErrorCode.answer_mismatch, message="le code et SymPy divergent (scénario factice)")
    return resp


@app.post("/v1/explain", response_model=ExplainResponse, dependencies=[Depends(require_token)])
def explain(req: ExplainRequest):
    text = "\n\n".join(f"{s.index}. {s.text_fr}" + (f" $${s.latex}$$" if s.latex else "") for s in req.steps)
    return ExplainResponse(request_id=uuid.uuid4().hex,
                           explanation=Explanation(level=req.level, text_fr=text + f"\n\nRésultat : ${req.result.latex}$.",
                                                   faithfulness=1.0))
