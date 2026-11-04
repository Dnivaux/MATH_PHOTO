"""Clés API hachées et suivi d'usage par utilisateur (dossier, phase 7 ; grille MLOps, niveau 1).

- Une clé appartient à un utilisateur et porte un type : `user` (compte) ou `device` (un téléphone, un
  ordinateur). Seul son SHA-256 est stocké ; le clair n'est affiché qu'une fois, à la création.
- Chaque requête authentifiée laisse une ligne dans `usage` : qui, depuis quel client, quel type de problème,
  pourquoi le client a escaladé, statut, temps LLM (proxy du temps GPU), versions des modèles.
- Les jetons de GATEWAY_TOKENS (`dev-token` par défaut) restent acceptés et comptés sous l'utilisateur `dev` :
  l'app de développement continue de marcher. En production : GATEWAY_TOKENS vide.

    GATEWAY_DB_URL=postgresql+psycopg2://mlflow:mlflow@postgres:5432/gateway   # docker compose
    (défaut : SQLite dans data/gateway.db)
"""

from __future__ import annotations

import hashlib
import os
import secrets
import statistics
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import (
    JSON, Column, DateTime, Float, ForeignKey, Integer, MetaData, String, Table, create_engine, func, insert, select,
    update,
)
from sqlalchemy.engine import Engine

from common.config import DATA

meta = MetaData()
users = Table(
    "users", meta,
    Column("id", Integer, primary_key=True),
    Column("name", String(64), unique=True, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)
api_keys = Table(
    "api_keys", meta,
    Column("id", Integer, primary_key=True),
    Column("user_id", ForeignKey("users.id"), nullable=False),
    Column("kind", String(16), nullable=False),          # user | device
    Column("label", String(64)),                          # ex. « Pixel 7 de Dae »
    Column("prefix", String(12), nullable=False),         # début de la clé, pour la reconnaître dans les listes
    Column("sha256", String(64), unique=True, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)),
)
usage = Table(
    "usage", meta,
    Column("id", Integer, primary_key=True),
    Column("ts", DateTime(timezone=True), nullable=False, index=True),
    Column("user", String(64), nullable=False, index=True),
    Column("key_id", Integer),
    Column("endpoint", String(32), nullable=False),
    Column("platform", String(16)),
    Column("mode", String(16)),
    Column("problem_type", String(16)),
    Column("escalation_reason", String(32)),
    Column("status", String(16)),
    Column("error_code", String(32)),
    Column("total_ms", Float),
    Column("llm_ms", Float),
    Column("model", String(64)),
    Column("model_version", String(16)),
    Column("extra", JSON),
)

KEY_PREFIX = "pm_"
_engine: Engine | None = None


def configure(url: str | None = None) -> Engine:
    """(Re)crée le moteur et les tables. Appelé paresseusement ; les tests passent leur propre URL."""
    global _engine
    url = url or os.getenv("GATEWAY_DB_URL") or f"sqlite:///{DATA / 'gateway.db'}"
    if url.startswith("sqlite:///"):
        DATA.mkdir(exist_ok=True)
    kwargs = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
    _engine = create_engine(url, **kwargs)
    meta.create_all(_engine)
    return _engine


def engine() -> Engine:
    return _engine or configure()


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass(frozen=True)
class Principal:
    user: str
    key_id: int | None = None
    kind: str = "user"


# ---- Clés

def create_user(name: str) -> int:
    with engine().begin() as c:
        return c.execute(insert(users).values(name=name, created_at=_now())).inserted_primary_key[0]


def issue_key(user: str, *, kind: str = "user", label: str | None = None) -> tuple[int, str]:
    """Crée une clé pour un utilisateur existant. Renvoie (id, clé en clair) : le clair n'est jamais stocké."""
    token = KEY_PREFIX + secrets.token_urlsafe(32)
    with engine().begin() as c:
        uid = c.execute(select(users.c.id).where(users.c.name == user)).scalar()
        if uid is None:
            raise KeyError(user)
        kid = c.execute(insert(api_keys).values(user_id=uid, kind=kind, label=label, prefix=token[:10],
                                                sha256=_hash(token), created_at=_now())).inserted_primary_key[0]
    return kid, token


def revoke(key_id: int) -> bool:
    with engine().begin() as c:
        n = c.execute(update(api_keys).where(api_keys.c.id == key_id, api_keys.c.revoked_at.is_(None))
                      .values(revoked_at=_now())).rowcount
    return n == 1


def list_keys() -> list[dict]:
    q = (select(api_keys.c.id, users.c.name.label("user"), api_keys.c.kind, api_keys.c.label, api_keys.c.prefix,
                api_keys.c.created_at, api_keys.c.revoked_at)
         .join(users, users.c.id == api_keys.c.user_id).order_by(api_keys.c.id))
    with engine().connect() as c:
        return [dict(r._mapping) for r in c.execute(q)]


def resolve(token: str) -> Principal | None:
    q = (select(api_keys.c.id, api_keys.c.kind, users.c.name)
         .join(users, users.c.id == api_keys.c.user_id)
         .where(api_keys.c.sha256 == _hash(token), api_keys.c.revoked_at.is_(None)))
    with engine().connect() as c:
        r = c.execute(q).first()
    return Principal(user=r.name, key_id=r.id, kind=r.kind) if r else None


# ---- Usage

def record(who: Principal, endpoint: str, **fields) -> None:
    cols = {k: v for k, v in fields.items() if k in usage.c and k != "extra"}
    extra = {k: v for k, v in fields.items() if k not in usage.c} | fields.get("extra", {})
    with engine().begin() as c:
        c.execute(insert(usage).values(ts=_now(), user=who.user, key_id=who.key_id, endpoint=endpoint,
                                       extra=extra or None, **cols))


def summary(hours: float = 24, user: str | None = None) -> list[dict]:
    """Agrégats par utilisateur sur la fenêtre : volume, statuts, raisons d'escalade, latence, temps LLM."""
    q = select(usage).where(usage.c.ts >= _now() - timedelta(hours=hours))
    if user:
        q = q.where(usage.c.user == user)
    with engine().connect() as c:
        rows = [r._mapping for r in c.execute(q)]
    out: dict[str, dict] = {}
    for r in rows:
        u = out.setdefault(r["user"], {"user": r["user"], "requests": 0, "by_endpoint": {}, "by_status": {},
                                       "by_escalation_reason": {}, "by_platform": {}, "llm_s": 0.0, "_lat": []})
        u["requests"] += 1
        for key, val in (("by_endpoint", r["endpoint"]), ("by_status", r["status"]),
                         ("by_escalation_reason", r["escalation_reason"]), ("by_platform", r["platform"])):
            if val:
                u[key][val] = u[key].get(val, 0) + 1
        u["llm_s"] += (r["llm_ms"] or 0) / 1e3
        if r["total_ms"] is not None:
            u["_lat"].append(r["total_ms"])
    for u in out.values():
        lat = sorted(u.pop("_lat"))
        u["latency_p50_ms"] = statistics.median(lat) if lat else None
        u["latency_p95_ms"] = lat[min(len(lat) - 1, int(0.95 * len(lat)))] if lat else None
        u["llm_s"] = round(u["llm_s"], 2)
    return sorted(out.values(), key=lambda u: -u["requests"])


def count() -> int:
    with engine().connect() as c:
        return c.execute(select(func.count()).select_from(usage)).scalar()
