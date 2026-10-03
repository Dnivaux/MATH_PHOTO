"""Contrat d'API v1 entre les clients (téléphone, ordinateur) et la gateway. Source unique de vérité :
le JSON Schema et l'OpenAPI de docs/api/ sont générés depuis ce fichier (python -m serving.gateway.export_contract).

Principes (dossier) :
- le serveur calcule et vérifie ; il renvoie le résultat, les étapes SymPy et le code exact exécuté ;
- l'explication est rédigée sur l'appareil, sauf en mode léger (POST /v1/explain) ;
- le client dit pourquoi il escalade ; le serveur renvoie cette raison (télémétrie, taux d'escalade par raison).
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

API_VERSION = "1.0"


class ProblemType(str, Enum):
    equation = "equation"
    system = "system"
    derivative = "derivative"
    integral = "integral"
    limit = "limit"


class EscalationReason(str, Enum):
    """Pourquoi le client a envoyé la requête au serveur (section « Escalade vers le serveur »)."""
    ocr_low_confidence = "ocr_low_confidence"
    invalid_latex = "invalid_latex"
    out_of_local_scope = "out_of_local_scope"      # degré >= 2, système, intégrale, limite...
    local_code_failed = "local_code_failed"        # ordinateur : 2 tentatives en échec
    device_too_weak = "device_too_weak"            # mode léger, < 6 Go de RAM
    user_request = "user_request"


class ErrorCode(str, Enum):
    """Échec côté serveur : le client affiche un message et propose de corriger le LaTeX."""
    parse_error = "parse_error"
    unsupported_type = "unsupported_type"
    image_not_supported = "image_not_supported"    # OCR serveur pas encore branché
    code_failed = "code_failed"                    # code en erreur après les tentatives d'auto-correction
    timeout = "timeout"
    answer_mismatch = "answer_mismatch"            # le code et SymPy ne donnent pas le même résultat
    llm_unavailable = "llm_unavailable"


class Level(str, Enum):
    college = "college"
    lycee = "lycee"
    superieur = "superieur"


class Escalation(BaseModel):
    reason: EscalationReason
    detail: str | None = Field(None, description="Ex. confiance OCR 0.42, message d'erreur local")
    ocr_confidence: float | None = Field(None, ge=0, le=1)


class ClientInfo(BaseModel):
    platform: Literal["android", "ios", "desktop", "web", "test"] = "test"
    app_version: str | None = None
    mode: Literal["complet", "leger"] = "complet"


class SolveRequest(BaseModel):
    latex: str | None = Field(None, max_length=2000, examples=["x^{2} - 5 x + 6 = 0"])
    image_base64: str | None = Field(None, description="JPEG/PNG en base64 (OCR serveur)")
    type_hint: ProblemType | None = None
    want_code: bool = Field(False, description="true pour l'ordinateur : renvoie le code exécuté")
    escalation: Escalation | None = None
    client: ClientInfo = ClientInfo()

    @model_validator(mode="after")
    def _one_input(self):
        if not self.latex and not self.image_base64:
            raise ValueError("latex ou image_base64 est requis")
        return self


class Problem(BaseModel):
    latex: str
    type: ProblemType
    variables: list[str]
    route: Literal["local", "server"] = Field(description="Où ce type de problème est censé être traité")


class Result(BaseModel):
    latex: str = Field(examples=["x \\in \\left\\{2 ; 3\\right\\}"])
    sympy: str = Field(description="Valeur SymPy sérialisée (str)", examples=["[2, 3]"])
    verified: bool = Field(description="Le code exécuté et SymPy donnent le même résultat")


class Step(BaseModel):
    index: int
    text_fr: str
    latex: str | None = None


class Code(BaseModel):
    language: Literal["python"] = "python"
    source: str = Field(description="Exactement le code exécuté, autonome (imports inclus), finit par print(result)")
    stdout: str = ""
    status: Literal["ok", "error", "timeout", "rejected", "no_result"]
    exec_ms: float
    attempts: int = Field(1, description="1 + nombre d'auto-corrections")


class Explanation(BaseModel):
    level: Level
    text_fr: str = Field(description="Markdown avec formules LaTeX entre $...$")
    faithfulness: float = Field(ge=0, le=1, description="Part des égalités vérifiées par SymPy")


class ErrorInfo(BaseModel):
    code: ErrorCode
    message: str


class ModelInfo(BaseModel):
    code_model: str | None = None
    code_model_version: str | None = None
    explain_model: str | None = None


class Timings(BaseModel):
    ocr_ms: float = 0
    parse_ms: float = 0
    llm_ms: float = 0
    sandbox_ms: float = 0
    total_ms: float = 0


class SolveResponse(BaseModel):
    api_version: str = API_VERSION
    request_id: str
    status: Literal["ok", "unverified", "error"] = Field(
        description="ok : résultat vérifié ; unverified : résultat SymPy sans confirmation du code (afficher un avertissement) ; error : voir `error`")
    problem: Problem | None = None
    result: Result | None = None
    steps: list[Step] = []
    code: Code | None = None
    explanation: Explanation | None = None
    escalation: Escalation | None = Field(None, description="Raison d'escalade reçue du client, renvoyée telle quelle")
    error: ErrorInfo | None = None
    models: ModelInfo = ModelInfo()
    timings: Timings = Timings()
    graph: dict | None = Field(None, description="Réservé : tracé de fonction (SVG ou points)")


class ExplainRequest(BaseModel):
    """Mode léger : le client sans LLM local demande l'explication au serveur."""
    problem: Problem
    steps: list[Step]
    result: Result
    level: Level = Level.lycee


class ExplainResponse(BaseModel):
    api_version: str = API_VERSION
    request_id: str
    explanation: Explanation
    models: ModelInfo = ModelInfo()


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    api_version: str = API_VERSION
    mock: bool = False
    llm: bool | None = None
