"""Authentification `Authorization: Bearer <token>` (dossier, phase 7).

Week-end : jetons en clair dans GATEWAY_TOKENS (séparés par des virgules), « dev-token » par défaut.
Phase 7 : clés par utilisateur et par appareil, stockées hachées dans Postgres.
"""

from __future__ import annotations

import os

from fastapi import Header, HTTPException


def _tokens() -> set[str]:
    return {t.strip() for t in os.getenv("GATEWAY_TOKENS", "dev-token").split(",") if t.strip()}


def require_token(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "jeton manquant : Authorization: Bearer <token>")
    token = authorization.removeprefix("Bearer ").strip()
    if token not in _tokens():
        raise HTTPException(401, "jeton invalide")
    return token
