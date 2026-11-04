"""Clés hachées, administration et suivi d'usage par utilisateur (gateway réelle, LLM remplacé)."""

import pytest
from fastapi.testclient import TestClient

from datagen.from_latex import from_latex
from serving.gateway import app as gateway
from serving.gateway import usage

ADMIN = {"Authorization": "Bearer admin-secret"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    usage.configure(f"sqlite:///{tmp_path / 'gw.db'}")
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "admin-secret")
    ref = from_latex("x^2 - 5x + 6 = 0")["reference_code"]
    monkeypatch.setattr(gateway, "_generate_code", lambda m: f"```python\n{ref}print(result)\n```")
    return TestClient(gateway.app)


def test_admin_requires_its_token(client, monkeypatch):
    assert client.get("/admin/keys").status_code == 401
    assert client.get("/admin/keys", headers={"Authorization": "Bearer dev-token"}).status_code == 401
    monkeypatch.delenv("GATEWAY_ADMIN_TOKEN")
    assert client.get("/admin/keys", headers=ADMIN).status_code == 403


def test_key_lifecycle_and_usage(client):
    r = client.post("/admin/users", json={"name": "dae"}, headers=ADMIN)
    assert r.status_code == 201
    key = r.json()["key"]
    assert key.startswith("pm_")
    assert client.post("/admin/users", json={"name": "dae"}, headers=ADMIN).status_code == 409
    # seul le hash est stocké
    stored = usage.list_keys()[0]
    assert stored["prefix"] == key[:10] and key not in str(stored)

    body = {"latex": "x^2 - 5x + 6 = 0", "client": {"platform": "android", "mode": "complet"},
            "escalation": {"reason": "out_of_local_scope"}}
    r = client.post("/v1/solve", json=body, headers={"Authorization": f"Bearer {key}"})
    assert r.status_code == 200 and r.json()["status"] == "ok"
    client.post("/v1/solve", json={"latex": "x = 1"}, headers={"Authorization": "Bearer dev-token"})

    s = {u["user"]: u for u in client.get("/admin/usage", headers=ADMIN).json()}
    assert s["dae"]["requests"] == 1 and s["dae"]["by_platform"] == {"android": 1}
    assert s["dae"]["by_escalation_reason"] == {"out_of_local_scope": 1} and s["dae"]["by_status"] == {"ok": 1}
    assert s["dev"]["requests"] == 1

    # clé d'appareil, puis révocation
    dev = client.post("/admin/users/dae/keys", json={"kind": "device", "label": "Pixel"}, headers=ADMIN).json()
    assert client.post("/v1/solve", json=body, headers={"Authorization": f"Bearer {dev['key']}"}).status_code == 200
    assert client.delete(f"/admin/keys/{dev['key_id']}", headers=ADMIN).status_code == 204
    assert client.post("/v1/solve", json=body, headers={"Authorization": f"Bearer {dev['key']}"}).status_code == 401
    assert client.delete(f"/admin/keys/{dev['key_id']}", headers=ADMIN).status_code == 404
    assert client.post("/admin/users/inconnu/keys", json={}, headers=ADMIN).status_code == 404


def test_unknown_key_rejected(client):
    assert client.post("/v1/solve", json={"latex": "x=1"}, headers={"Authorization": "Bearer pm_nimporte"}).status_code == 401


def test_metrics_exposed(client):
    client.post("/v1/solve", json={"latex": "x^2 - 5x + 6 = 0", "client": {"platform": "android"}},
                headers={"Authorization": "Bearer dev-token"})
    text = client.get("/metrics").text
    assert 'gateway_requests_total{endpoint="solve"' in text and 'platform="android"' in text
    assert 'gateway_llm_seconds_total{endpoint="solve",user="dev"}' in text


def test_ocr_endpoint(client, monkeypatch):
    auth = {"Authorization": "Bearer dev-token"}
    assert client.post("/v1/ocr", json={"image_base64": "aW1n"}).status_code == 401
    monkeypatch.setattr(gateway, "OCR_URL", None)
    assert client.post("/v1/ocr", json={"image_base64": "aW1n"}, headers=auth).status_code == 503
    monkeypatch.setattr(gateway, "OCR_URL", "http://ocr:8300")
    monkeypatch.setattr(gateway, "_read_image", lambda b64: "2x^{2}-3x-5=0")
    r = client.post("/v1/ocr", json={"image_base64": "aW1n", "client": {"platform": "android"}}, headers=auth)
    assert r.status_code == 200 and r.json()["latex"] == "2x^{2}-3x-5=0"
    monkeypatch.setattr(gateway, "_read_image", lambda b64: (_ for _ in ()).throw(OSError()))
    assert client.post("/v1/ocr", json={"image_base64": "aW1n"}, headers=auth).status_code == 502
    assert 'gateway_requests_total{endpoint="ocr"' in client.get("/metrics").text
