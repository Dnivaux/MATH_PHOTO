"""Chaîne de résolution serveur : LaTeX -> problème SymPy -> code (LLM) -> bac à sable -> réponse vérifiée.

Utilisée par la vraie gateway (code généré par vLLM) et par la gateway factice (code de référence).
"""

from __future__ import annotations

import time
import uuid
from typing import Callable

from common.prompts import code_messages, extract_code
from datagen.from_latex import UnsupportedProblem, from_latex
from serving.gateway.schema import (
    Code, ErrorCode, ErrorInfo, ModelInfo, Problem, Result, SolveRequest, SolveResponse, Step, Timings,
)
from serving.sandbox import ExecResult, run_code

# Une fonction qui prend des messages de chat et renvoie le texte du modèle.
CodeGenerator = Callable[[list[dict]], str]
MAX_ATTEMPTS = 3  # 1 + 2 auto-corrections (dossier, phase 5)

FIX_PROMPT = """The program failed with this error:

{error}

Fix the program. Same requirements: store the answer in `result`, end with `print(result)`.
Answer with a single ```python code block."""


def _error(rid: str, code: ErrorCode, msg: str, req: SolveRequest, timings: Timings, **kw) -> SolveResponse:
    return SolveResponse(request_id=rid, status="error", error=ErrorInfo(code=code, message=msg),
                         escalation=req.escalation, timings=timings, **kw)


def solve(req: SolveRequest, generate_code: CodeGenerator, models: ModelInfo | None = None,
          request_id: str | None = None) -> SolveResponse:
    rid = request_id or uuid.uuid4().hex
    t0 = time.perf_counter()
    timings = Timings()
    models = models or ModelInfo()

    if not req.latex:
        return _error(rid, ErrorCode.image_not_supported, "OCR serveur pas encore branché : envoyer le LaTeX.", req, timings)

    # 1. Problème déterministe (SymPy) : type, solution de référence, étapes vérifiées.
    t = time.perf_counter()
    try:
        problem = from_latex(req.latex, req.type_hint.value if req.type_hint else None)
    except UnsupportedProblem as e:
        return _error(rid, ErrorCode.unsupported_type, str(e), req, timings)
    except Exception as e:  # noqa: BLE001
        return _error(rid, ErrorCode.parse_error, f"LaTeX illisible : {type(e).__name__}", req, timings)
    timings.parse_ms = (time.perf_counter() - t) * 1e3

    # 2. Code généré par le LLM, exécuté et comparé au résultat SymPy, avec auto-correction.
    messages = code_messages(problem)
    code, res, attempts = None, None, 0
    for attempts in range(1, MAX_ATTEMPTS + 1):
        t = time.perf_counter()
        try:
            text = generate_code(messages)
        except Exception as e:  # noqa: BLE001
            return _error(rid, ErrorCode.llm_unavailable, f"LLM injoignable : {type(e).__name__}", req, timings)
        timings.llm_ms += (time.perf_counter() - t) * 1e3
        code = extract_code(text)
        if code is None:
            res = ExecResult("no_result", error="pas de bloc de code dans la réponse")
        else:
            res = run_code(code, problem["check"])
            timings.sandbox_ms += res.elapsed_ms
        if res.status == "ok":
            break  # résultat obtenu (juste ou non) : on ne relance pas le LLM pour un désaccord
        messages = messages + [{"role": "assistant", "content": text},
                               {"role": "user", "content": FIX_PROMPT.format(error=res.error or res.status)}]

    p = problem
    resp = SolveResponse(
        request_id=rid, status="ok",
        problem=Problem(latex=p["latex"], type=p["type"], variables=p["vars"], route=p["route"]),
        result=Result(latex=p["answer_latex"], sympy=p["answer"], verified=bool(res and res.correct)),
        steps=[Step(index=i + 1, text_fr=s["text_fr"], latex=s.get("latex")) for i, s in enumerate(p["steps"])],
        escalation=req.escalation, models=models, timings=timings,
    )
    if req.want_code and code:
        resp.code = Code(source=code,  # exactement le code exécuté, jamais réécrit (dossier, « Règles sur le code »)
                         stdout=res.stdout, status=res.status, exec_ms=res.elapsed_ms, attempts=attempts)
    if res.status in ("timeout",):
        resp.status, resp.error = "unverified", ErrorInfo(code=ErrorCode.timeout, message="le code a dépassé le temps limite")
    elif res.status != "ok":
        resp.status, resp.error = "unverified", ErrorInfo(code=ErrorCode.code_failed, message=(res.error or res.status)[:300])
    elif not res.correct:
        resp.status, resp.error = "unverified", ErrorInfo(
            code=ErrorCode.answer_mismatch, message=f"le code donne {res.result}, SymPy donne {p['answer']}")
    timings.total_ms = (time.perf_counter() - t0) * 1e3
    return resp
