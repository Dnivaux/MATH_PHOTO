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
    Code, ErrorCode, ErrorInfo, EscalationReason, ModelInfo, Problem, Result, SolveRequest, SolveResponse, Step, Timings,
)
from serving.sandbox import ExecResult, run_code

# Une fonction qui prend des messages de chat et renvoie le texte du modèle.
CodeGenerator = Callable[[list[dict]], str]
# Une fonction qui lit une image (base64) et renvoie du LaTeX : OCR serveur (TexTeller).
ImageReader = Callable[[str], str]
# Raisons pour lesquelles la lecture du téléphone est douteuse : la photo est alors relue par le serveur.
REREAD_REASONS = {EscalationReason.ocr_low_confidence, EscalationReason.invalid_latex, EscalationReason.user_request}
MAX_ATTEMPTS = 3  # 1 + 2 auto-corrections (dossier, phase 5)

FIX_PROMPT = """The program failed with this error:

{error}

Fix the program. Same requirements: store the answer in `result`, end with `print(result)`.
Answer with a single ```python code block."""


def _error(rid: str, code: ErrorCode, msg: str, req: SolveRequest, timings: Timings, **kw) -> SolveResponse:
    return SolveResponse(request_id=rid, status="error", error=ErrorInfo(code=code, message=msg),
                         escalation=req.escalation, timings=timings, **kw)


def _read_by(source: str, latex: str) -> str:
    """L'erreur de la meilleure lecture est rapportée : avec la relecture serveur, on dit ce qui a été lu."""
    return f" (photo relue par le serveur : {latex})" if source == "server_ocr" else ""


def _candidates(req: SolveRequest, read_image: ImageReader | None, timings: Timings) -> list[tuple[str, str]]:
    """Formules à essayer, dans l'ordre : la relecture serveur de la photo quand la lecture du téléphone est
    douteuse (ou absente), puis le LaTeX du client."""
    out = []
    doubtful = not req.latex or (req.escalation is not None and req.escalation.reason in REREAD_REASONS)
    if req.image_base64 and read_image and doubtful:
        t = time.perf_counter()
        try:
            latex = read_image(req.image_base64)
        except Exception:  # noqa: BLE001  (service OCR injoignable : on garde la lecture du client)
            latex = ""
        timings.ocr_ms = (time.perf_counter() - t) * 1e3
        if latex:
            out.append((latex, "server_ocr"))
    if req.latex:
        out.append((req.latex, "client"))
    return out


def solve(req: SolveRequest, generate_code: CodeGenerator, models: ModelInfo | None = None,
          request_id: str | None = None, read_image: ImageReader | None = None) -> SolveResponse:
    rid = request_id or uuid.uuid4().hex
    t0 = time.perf_counter()
    timings = Timings()
    models = models or ModelInfo()

    candidates = _candidates(req, read_image, timings)
    if not candidates:
        return _error(rid, ErrorCode.image_not_supported,
                      "Photo illisible pour le serveur, ou OCR serveur non configuré : envoyer le LaTeX.", req, timings)

    # 1. Problème déterministe (SymPy) : type, solution de référence, étapes vérifiées. La première formule
    #    lisible gagne ; l'indice de type du client ne vaut que pour sa propre lecture.
    t = time.perf_counter()
    problem, source, err = None, "client", None
    for latex, source in candidates:
        hint = req.type_hint.value if req.type_hint and source == "client" else None
        try:
            problem = from_latex(latex, hint)
            break
        except UnsupportedProblem as e:
            err = err or (ErrorCode.unsupported_type, str(e) + _read_by(source, latex))
        except Exception as e:  # noqa: BLE001
            err = err or (ErrorCode.parse_error, f"LaTeX illisible : {type(e).__name__}" + _read_by(source, latex))
    timings.parse_ms = (time.perf_counter() - t) * 1e3
    if problem is None:
        return _error(rid, err[0], err[1], req, timings)

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
        problem=Problem(latex=p["latex"], type=p["type"], variables=p["vars"], route=p["route"], latex_source=source),
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
