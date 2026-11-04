"""Télécharge la version `champion` de modèles du registry MLflow avant le démarrage des serveurs (docker compose).

Pour chaque modèle : /registry/<nom>/model/ (l'artefact enregistré), /registry/<nom>/VERSION, et pour un GGUF un
lien /registry/<nom>/current.gguf. Une version déjà présente n'est pas retéléchargée. Promouvoir une version
dans le registry puis relancer la stack suffit donc à la mettre en production.

Autonome (mlflow seul) : il tourne dans l'image MLflow, sans le code du projet.

    python serving/fetch_models.py math-7b-teacher explainer-0.6b-p20-gguf
"""

from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import mlflow
from mlflow import MlflowClient

URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
ALIAS = os.getenv("MODEL_ALIAS", "champion")
DEST = Path(os.getenv("REGISTRY_DIR", "/registry"))
os.environ.setdefault("MLFLOW_ENABLE_PROXY_MULTIPART_DOWNLOAD", "false")


def fetch(client: MlflowClient, name: str) -> None:
    mv = client.get_model_version_by_alias(name, ALIAS)
    target = DEST / name
    version_file = target / "VERSION"
    if version_file.exists() and version_file.read_text().strip() == mv.version:
        print(f"{name}@{ALIAS} v{mv.version} déjà présent")
        return
    t0 = time.time()
    tmp = DEST / f".{name}.part"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    mlflow.artifacts.download_artifacts(artifact_uri=mv.source, dst_path=str(tmp / "dl"), tracking_uri=URI)
    # l'artefact s'appelle « model » : dl/model/... -> model/...
    (tmp / "dl" / Path(mv.source).name).rename(tmp / "model")
    shutil.rmtree(tmp / "dl")
    ggufs = sorted((tmp / "model").glob("*.gguf"))
    if ggufs:
        (tmp / "current.gguf").symlink_to(Path("model") / ggufs[0].name)
    (tmp / "VERSION").write_text(mv.version)
    shutil.rmtree(target, ignore_errors=True)
    tmp.rename(target)
    print(f"{name}@{ALIAS} v{mv.version} téléchargé en {time.time() - t0:.0f} s")


def main() -> None:
    mlflow.set_tracking_uri(URI)
    client = MlflowClient()
    for attempt in range(30):  # MLflow peut démarrer après nous
        try:
            client.search_registered_models(max_results=1)
            break
        except Exception as e:  # noqa: BLE001
            print("MLflow pas prêt :", e)
            time.sleep(2)
    else:
        raise SystemExit("MLflow injoignable")
    for name in sys.argv[1:]:
        fetch(client, name)


if __name__ == "__main__":
    main()
