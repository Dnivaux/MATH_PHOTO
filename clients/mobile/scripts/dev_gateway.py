"""
Gateway de développement pour tester l'app sans GPU : même contrat v1 que MATH_PHOTO (serving/gateway/schema.py),
mais chaque problème est vraiment résolu par datagen/from_latex.py (SymPy, étapes du générateur).
La gateway factice du dépôt (`make mock`) renvoie toujours le même exemple : inutilisable pour tester une
formule modifiée.

Sans LLM ni bac à sable, rien ne confirme le résultat par une seconde méthode : les réponses sont donc
marquées `unverified` (l'app l'affiche honnêtement).

    PYTHONPATH=<chemin de MATH_PHOTO> uv run --no-project --python 3.12 --with sympy --with lark \
        --with 'antlr4-python3-runtime==4.11.*' --with pydantic --with fastapi --with 'uvicorn[standard]' \
        uvicorn --app-dir scripts dev_gateway:app --port 8100
"""

from __future__ import annotations

import uuid

from fastapi import Depends, FastAPI

from datagen.from_latex import UnsupportedProblem, from_latex
from serving.gateway.auth import require_token
from serving.gateway.mock import explain as mock_explain
from serving.gateway.schema import (
    ErrorCode, ErrorInfo, ExplainRequest, Health, ModelInfo, Problem, Result, SolveRequest, SolveResponse, Step,
)

app = FastAPI(title="Photo → Maths gateway (développement, SymPy seul)", version="1.0")


@app.get("/health", response_model=Health)
def health():
    return Health(status="degraded", mock=True, llm=False)


@app.post("/v1/solve", response_model=SolveResponse, dependencies=[Depends(require_token)])
def solve(req: SolveRequest):
    rid = uuid.uuid4().hex
    if not req.latex:
        return SolveResponse(request_id=rid, status="error", escalation=req.escalation,
                             error=ErrorInfo(code=ErrorCode.image_not_supported, message="LaTeX requis"))
    try:
        p = from_latex(req.latex, req.type_hint.value if req.type_hint else None)
    except UnsupportedProblem as e:
        return SolveResponse(request_id=rid, status="error", escalation=req.escalation,
                             error=ErrorInfo(code=ErrorCode.unsupported_type, message=str(e)))
    except Exception as e:  # noqa: BLE001
        return SolveResponse(request_id=rid, status="error", escalation=req.escalation,
                             error=ErrorInfo(code=ErrorCode.parse_error, message=str(e)))
    return SolveResponse(
        request_id=rid,
        status="unverified",
        problem=Problem(latex=p["latex"], type=p["type"], variables=p["vars"], route=p["route"]),
        result=Result(latex=p["answer_latex"], sympy=str(p["answer"]), verified=False),
        steps=[Step(index=i + 1, text_fr=s["text_fr"], latex=s.get("latex")) for i, s in enumerate(p["steps"])],
        escalation=req.escalation,
        error=ErrorInfo(code=ErrorCode.llm_unavailable, message="gateway de développement : SymPy seul, sans seconde vérification"),
        models=ModelInfo(code_model="sympy-dev"),
    )


@app.post("/v1/explain", dependencies=[Depends(require_token)])
def explain(req: ExplainRequest):
    return mock_explain(req)
