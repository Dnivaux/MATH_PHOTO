"""Bac à sable en service séparé (dossier, phase 5) : la gateway lui envoie le code au lieu de l'exécuter chez elle.

Dans docker compose, ce conteneur n'est relié qu'à un réseau interne partagé avec la gateway (pas d'Internet,
ni Postgres, ni MLflow), système de fichiers en lecture seule, aucune capability, nombre de processus et mémoire
limités. À l'intérieur, chaque exécution garde ses protections : analyse AST, liste blanche d'imports,
rlimits, timeout.

    uvicorn serving.sandbox.service:app --port 8200
    SANDBOX_TOKEN : secret partagé avec la gateway (en-tête X-Sandbox-Token), facultatif
"""

from __future__ import annotations

import hmac
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from serving.sandbox import run_local

app = FastAPI(title="Photo → Maths sandbox")


class RunRequest(BaseModel):
    code: str = Field(max_length=20_000)
    expected: dict | None = None
    timeout: float = Field(5.0, gt=0, le=10)
    mem_mb: int = Field(2048, ge=64, le=2048)


def _check_token(token: str | None) -> None:
    secret = os.getenv("SANDBOX_TOKEN")
    if secret and not hmac.compare_digest(token or "", secret):
        raise HTTPException(401, "jeton du bac à sable invalide")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run")
async def run(req: RunRequest, x_sandbox_token: str | None = Header(None)):
    _check_token(x_sandbox_token)
    res = await run_in_threadpool(run_local, req.code, req.expected, req.timeout, req.mem_mb)
    return res.to_dict()
