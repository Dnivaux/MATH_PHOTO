"""GET /v1/models/{client}/latest : la gateway annonce le `champion` du registry et sert son fichier."""

import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from serving.gateway import mock, models

AUTH = {"Authorization": "Bearer dev-token"}
PAYLOAD = b"GGUF factice"


class FakeRegistry:
    def __init__(self, tags):
        self.mv = SimpleNamespace(version="3", source="mlflow-artifacts:/x/model", tags=tags)

    def get_model_version_by_alias(self, name, alias):
        if name != "explainer-0.6b-p20-gguf" or alias != "champion":
            raise RuntimeError("absent")
        return self.mv

    def get_model_version(self, name, version):
        return self.mv


@pytest.fixture
def gateway(tmp_path, monkeypatch):
    def fetch(name, version, source):
        d = tmp_path / name / version
        d.mkdir(parents=True, exist_ok=True)
        (d / "lineage.json").write_text("{}")
        (d / "explainer-q4_k_m.gguf").write_bytes(PAYLOAD)
        return d / "explainer-q4_k_m.gguf"

    def setup(tags):
        monkeypatch.setattr(models, "_client", lambda: FakeRegistry(tags))
        monkeypatch.setattr(models, "_fetch", fetch)
        monkeypatch.setattr(models, "_manifests", {})
        return TestClient(mock.app)

    return setup


def test_latest_manifest_and_file(gateway):
    c = gateway({})
    assert c.get("/v1/models/android/latest").status_code == 401
    m = c.get("/v1/models/android/latest?role=explainer", headers=AUTH).json()
    assert m["name"] == "explainer-0.6b-p20-gguf" and m["version"] == "3" and m["alias"] == "champion"
    assert m["sha256"] == hashlib.sha256(PAYLOAD).hexdigest() and m["bytes"] == len(PAYLOAD)
    r = c.get(m["url"], headers=AUTH)
    assert r.status_code == 200 and r.content == PAYLOAD


def test_sha_from_registry_tag(gateway):
    c = gateway({"sha256": "abc"})
    assert c.get("/v1/models/android/latest", headers=AUTH).json()["sha256"] == "abc"


def test_unknown_role_and_undistributed_files(gateway):
    c = gateway({})
    assert c.get("/v1/models/android/latest?role=math", headers=AUTH).status_code == 404
    # seul le fichier de l'artefact d'un modèle distribué est servi
    assert c.get("/v1/models/files/math-7b-teacher/1/x.gguf", headers=AUTH).status_code == 404
    assert c.get("/v1/models/files/explainer-0.6b-p20-gguf/3/lineage.json", headers=AUTH).status_code == 404
