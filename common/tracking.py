"""MLflow : initialisation, datasets, registry avec lignée et alias (champion / challenger)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import mlflow
from mlflow import MlflowClient

from common.config import MLFLOW_EXPERIMENT, MLFLOW_TRACKING_URI


def init(experiment: str | None = None) -> None:
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
    mlflow.set_experiment(experiment or MLFLOW_EXPERIMENT)


def file_sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def log_jsonl_dataset(path, name: str, context: str) -> str:
    """Trace un fichier JSONL comme dataset d'entrée du run (onglet « Datasets » de MLflow). Renvoie son hash."""
    import pandas as pd

    digest = file_sha256(path)
    df = pd.read_json(path, lines=True)
    ds = mlflow.data.from_pandas(df, source=str(Path(path).resolve()), name=name, digest=digest[:16])
    mlflow.log_input(ds, context=context)
    mlflow.log_param(f"data.{context}.{name}.sha256", digest[:16])
    return digest


def register_dir(model_dir: str, name: str, *, alias: str | None = None, parent: str | None = None,
                 tags: dict | None = None, artifact_path: str = "model") -> str:
    """Envoie un dossier de modèle (adapter LoRA, HF, GGUF...) dans les artefacts du run actif et l'enregistre
    dans le registry. La lignée (modèle parent, données) est portée par des tags. Renvoie la version."""
    run = mlflow.active_run()
    assert run, "à appeler dans un mlflow.start_run()"
    mlflow.log_artifacts(model_dir, artifact_path)
    client = MlflowClient()
    try:
        client.create_registered_model(name)
    except mlflow.exceptions.MlflowException:
        pass  # déjà créé
    mv = client.create_model_version(name, source=f"{run.info.artifact_uri}/{artifact_path}", run_id=run.info.run_id,
                                     tags={**(tags or {}), **({"parent": parent} if parent else {})})
    if alias:
        client.set_registered_model_alias(name, alias, mv.version)
    return mv.version
