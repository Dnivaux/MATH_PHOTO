"""Authentification `Authorization: Bearer <token>` (dossier, phase 7).

- Clés par utilisateur et par appareil, stockées hachées (serving/gateway/usage.py) : la voie normale.
- Jetons de GATEWAY_TOKENS (séparés par des virgules, « dev-token » par défaut) : développement, comptés sous
  l'utilisateur `dev`. GATEWAY_TOKENS vide les désactive.
- GATEWAY_ADMIN_TOKEN : gestion des utilisateurs, des clés et lecture de l'usage (/admin). Sans lui, /admin
  est fermé.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException

from serving.gateway import usage
from serving.gateway.usage import Principal


def _tokens() -> set[str]:
    return {t.strip() for t in os.getenv("GATEWAY_TOKENS", "dev-token").split(",") if t.strip()}


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "jeton manquant : Authorization: Bearer <token>")
    return authorization.removeprefix("Bearer ").strip()


def require_token(authorization: str | None = Header(None)) -> Principal:
    token = _bearer(authorization)
    if token in _tokens():
        return Principal(user="dev")
    if token.startswith(usage.KEY_PREFIX) and (who := usage.resolve(token)):
        return who
    raise HTTPException(401, "jeton invalide")


def require_admin(authorization: str | None = Header(None)) -> None:
    admin = os.getenv("GATEWAY_ADMIN_TOKEN")
    if not admin:
        raise HTTPException(403, "administration désactivée : GATEWAY_ADMIN_TOKEN non défini")
    if not hmac.compare_digest(_bearer(authorization), admin):
        raise HTTPException(401, "jeton d'administration invalide")
