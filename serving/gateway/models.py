"""Distribution des modèles aux clients (dossier, phase 6 : GET /v1/models/{client}/latest).

Le registry MLflow décide : la gateway renvoie la version qui porte l'alias `champion` du modèle associé au
couple (client, rôle). Le fichier est téléchargé une fois depuis MLflow, mis en cache sur le disque de la
gateway, puis servi par `GET /v1/models/files/...`. Le client vérifie le SHA-256 annoncé.

Une promotion dans le registry (`champion` déplacé sur une nouvelle version) suffit donc à mettre à jour les
téléphones, sans republier l'app.

    MODEL_ROLES='{"android/explainer": "explainer-0.6b-p20-gguf"}'   # (client/rôle) -> modèle du registry
    MODEL_CACHE=models/cache                                         # cache disque de la gateway
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from common import tracking
from common.config import MLFLOW_TRACKING_URI, ROOT
from serving.gateway.auth import require_token

DEFAULT_ROLES = {
    "android/explainer": "explainer-0.6b-p20-gguf",
    "ios/explainer": "explainer-0.6b-p20-gguf",
    "desktop/explainer": "explainer-0.6b-p20-gguf",
}
ALIAS = os.getenv("MODEL_ALIAS", "champion")
CACHE = Path(os.getenv("MODEL_CACHE", ROOT / "models" / "cache"))
# Extension du fichier servi selon le format (un artefact peut contenir lineage.json, etc.)
SERVED_SUFFIXES = (".gguf", ".onnx")


def roles() -> dict[str, str]:
    return {**DEFAULT_ROLES, **json.loads(os.getenv("MODEL_ROLES", "{}"))}


class ModelNotFound(Exception):
    pass


@dataclass
class Manifest:
    role: str
    name: str
    version: str
    alias: str
    filename: str
    sha256: str
    bytes: int
    path: Path

    def public(self) -> dict:
        return {"role": self.role, "name": self.name, "version": self.version, "alias": self.alias,
                "url": f"/v1/models/files/{self.name}/{self.version}/{self.filename}",
                "sha256": self.sha256, "bytes": self.bytes}


_lock = threading.Lock()
_manifests: dict[tuple[str, str], Manifest] = {}


def _client():
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
    return MlflowClient()


def _fetch(name: str, version: str, source: str) -> Path:
    """Télécharge l'artefact de la version dans le cache (une seule fois) et renvoie le fichier à servir."""
    target = CACHE / name / version
    if not target.exists():
        import mlflow

        tmp = CACHE / name / f".{version}.part"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        mlflow.artifacts.download_artifacts(artifact_uri=source, dst_path=str(tmp), tracking_uri=MLFLOW_TRACKING_URI)
        tmp.rename(target)
    files = sorted(f for f in target.rglob("*") if f.is_file() and f.suffix in SERVED_SUFFIXES)
    if len(files) != 1:
        raise ModelNotFound(f"{name} v{version} : {len(files)} fichiers servables dans l'artefact")
    return files[0]


def _manifest(name: str, version: str, source: str, tags: dict) -> Manifest:
    """Manifeste d'une version, calculé une fois par processus. Le hash est lu dans les tags de la version
    (posés à l'enregistrement), sinon calculé sur le fichier."""
    key = (name, version)
    with _lock:
        m = _manifests.get(key)
        if m is None:
            path = _fetch(name, version, source)
            sha = tags.get("sha256") or tracking.file_sha256(path)
            m = Manifest(role="", name=name, version=version, alias=ALIAS, filename=path.name, sha256=sha,
                         bytes=path.stat().st_size, path=path)
            _manifests[key] = m
    return m


def latest(client: str, role: str) -> Manifest:
    """Manifeste de la version `champion` du modèle associé à ce client et ce rôle."""
    name = roles().get(f"{client}/{role}")
    if not name:
        raise ModelNotFound(f"aucun modèle pour {client}/{role}")
    try:
        mv = _client().get_model_version_by_alias(name, ALIAS)
    except Exception as e:  # noqa: BLE001  (modèle ou alias absent du registry)
        raise ModelNotFound(f"{name}@{ALIAS} introuvable : {e}") from e
    m = _manifest(name, mv.version, mv.source, mv.tags)
    return Manifest(**{**m.__dict__, "role": role})


def file_path(name: str, version: str, filename: str) -> Path:
    """Fichier à servir. Seuls les modèles distribués (MODEL_ROLES) sont accessibles, et seulement le fichier
    de leur artefact : pas d'accès arbitraire au disque."""
    if name not in roles().values():
        raise ModelNotFound(f"{name} n'est pas distribué")
    m = _manifests.get((name, version))
    if m is None:
        try:
            mv = _client().get_model_version(name, version)
        except Exception as e:  # noqa: BLE001
            raise ModelNotFound(f"{name} v{version} introuvable : {e}") from e
        m = _manifest(name, mv.version, mv.source, mv.tags)
    if m.filename != filename:
        raise ModelNotFound(f"{name} v{version} ne contient pas {filename}")
    return m.path


# ---- Endpoints (inclus dans la gateway réelle et dans la factice : aucun GPU nécessaire)
router = APIRouter(prefix="/v1/models", dependencies=[Depends(require_token)], tags=["models"])


@router.get("/{client}/latest")
async def get_latest(client: str, role: str = "explainer"):
    try:
        # le premier appel télécharge l'artefact depuis MLflow et calcule le hash : hors de la boucle asyncio
        return (await run_in_threadpool(latest, client, role)).public()
    except ModelNotFound as e:
        raise HTTPException(404, str(e)) from e


@router.get("/files/{name}/{version}/{filename}")
async def get_file(name: str, version: str, filename: str):
    try:
        path = await run_in_threadpool(file_path, name, version, filename)
    except ModelNotFound as e:
        raise HTTPException(404, str(e)) from e
    return FileResponse(path, media_type="application/octet-stream", filename=filename)
