"""Administration (jeton GATEWAY_ADMIN_TOKEN) : utilisateurs, clés hachées, usage par utilisateur.

    curl -X POST localhost:8100/admin/users -H "Authorization: Bearer $ADMIN" -d '{"name": "dae"}' -H 'Content-Type: application/json'
    curl localhost:8100/admin/usage?hours=24 -H "Authorization: Bearer $ADMIN"
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from serving.gateway import usage
from serving.gateway.auth import require_admin

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)], tags=["admin"])


class NewUser(BaseModel):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[\w.-]+$")


class NewKey(BaseModel):
    kind: Literal["user", "device"] = "user"
    label: str | None = Field(None, max_length=64)


class IssuedKey(BaseModel):
    key_id: int
    user: str
    kind: str
    key: str = Field(description="Clé en clair : affichée une seule fois, seul son SHA-256 est stocké")


@router.post("/users", response_model=IssuedKey, status_code=201)
def create_user(body: NewUser):
    """Crée l'utilisateur et sa première clé."""
    try:
        usage.create_user(body.name)
    except IntegrityError as e:
        raise HTTPException(409, f"l'utilisateur {body.name} existe déjà") from e
    kid, key = usage.issue_key(body.name, label="compte")
    return IssuedKey(key_id=kid, user=body.name, kind="user", key=key)


@router.post("/users/{name}/keys", response_model=IssuedKey, status_code=201)
def create_key(name: str, body: NewKey):
    try:
        kid, key = usage.issue_key(name, kind=body.kind, label=body.label)
    except KeyError as e:
        raise HTTPException(404, f"utilisateur {name} inconnu") from e
    return IssuedKey(key_id=kid, user=name, kind=body.kind, key=key)


@router.get("/keys")
def list_keys():
    return usage.list_keys()


@router.delete("/keys/{key_id}", status_code=204)
def revoke_key(key_id: int):
    if not usage.revoke(key_id):
        raise HTTPException(404, "clé inconnue ou déjà révoquée")


@router.get("/usage")
def get_usage(hours: float = 24, user: str | None = None):
    return usage.summary(hours, user)
