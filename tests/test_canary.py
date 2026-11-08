"""Canary du modèle de code : tirage, repli sur le champion, réglage de la part et décision."""

import pytest
from fastapi.testclient import TestClient

from datagen.from_latex import from_latex
from eval.canary_check import decide, next_weight
from serving.gateway import app as gateway
from serving.gateway import canary, usage

ADMIN = {"Authorization": "Bearer admin-secret"}
AUTH = {"Authorization": "Bearer dev-token"}
LATEX = "x^2 - 5x + 6 = 0"
OK = {"n": 100, "ok_pct": 100.0, "llm_p95_ms": 1000.0}
WRONG = "```python\nresult = [7]\nprint(result)\n```"


@pytest.fixture(autouse=True)
def reset_weight(monkeypatch):
    monkeypatch.setattr(canary, "_weight", 0.5)


@pytest.fixture
def client(tmp_path, monkeypatch):
    usage.configure(f"sqlite:///{tmp_path / 'gw.db'}")
    monkeypatch.setenv("GATEWAY_ADMIN_TOKEN", "admin-secret")
    ref = from_latex(LATEX)["reference_code"]
    monkeypatch.setattr(gateway, "_generate_code", lambda m: f"```python\n{ref}print(result)\n```")
    monkeypatch.setattr(gateway, "_generate_canary", lambda m: WRONG)
    monkeypatch.setattr(gateway, "_canary_client", object())
    return TestClient(gateway.app)


def last_usage(client) -> dict:
    return client.get("/admin/usage/rows?endpoint=solve", headers=ADMIN).json()[0]


def test_draw_selects_variant():
    assert canary.Route(lambda m: "a", lambda m: "b", draw=lambda: 0.1)([]) == "b"
    assert canary.Route(lambda m: "a", lambda m: "b", draw=lambda: 0.9)([]) == "a"


def test_without_canary_service_stays_on_champion():
    canary.set_weight(1.0)
    assert canary.Route(lambda m: "a", None).variant == "champion"


def test_unreachable_canary_falls_back_once():
    calls = []

    def down(messages):
        calls.append(messages)
        raise OSError

    route = canary.Route(lambda m: "a", down, draw=lambda: 0.0)
    assert route([]) == "a" and route([]) == "a"
    assert route.fell_back and route.variant == "canary" and len(calls) == 1


def test_decision():
    assert decide(OK, {**OK, "ok_pct": 90.0}, 0)[0] == "rollback"
    assert decide(OK, {**OK, "llm_p95_ms": 2000.0}, 0)[0] == "rollback"
    assert decide(OK, OK, 5.0)[0] == "rollback"
    assert decide(OK, {**OK, "n": 3}, 0)[0] == "hold"
    assert decide(OK, {**OK, "ok_pct": 98.5}, 0)[0] == "advance"


def test_next_weight():
    assert next_weight("advance", 0.1) == 0.25
    assert next_weight("advance", 1.0) == 1.0
    assert next_weight("rollback", 0.5) == 0.0
    assert next_weight("hold", 0.25) == 0.25


def test_admin_controls_weight(client):
    assert client.put("/admin/canary", json={"weight": 0.2}).status_code == 401
    assert client.put("/admin/canary", json={"weight": 1.5}, headers=ADMIN).status_code == 422
    assert client.put("/admin/canary", json={"weight": 0.2}, headers=ADMIN).json() == {"weight": 0.2}
    assert client.get("/admin/canary", headers=ADMIN).json() == {"weight": 0.2}


def test_solve_on_canary_is_reported_and_recorded(client):
    client.put("/admin/canary", json={"weight": 1.0}, headers=ADMIN)
    body = client.post("/v1/solve", json={"latex": LATEX}, headers=AUTH).json()
    # challenger faux : le résultat reste celui de SymPy, seule la vérification échoue
    assert body["status"] == "unverified" and body["result"]["sympy"] == "[2, 3]"
    assert body["models"]["code_model"] == gateway.VLLM_CANARY_MODEL
    row = last_usage(client)
    assert row["model"] == gateway.VLLM_CANARY_MODEL and row["extra"]["variant"] == "canary"


def test_solve_with_weight_zero_uses_champion(client):
    client.put("/admin/canary", json={"weight": 0}, headers=ADMIN)
    body = client.post("/v1/solve", json={"latex": LATEX}, headers=AUTH).json()
    assert body["status"] == "ok" and body["models"]["code_model"] == gateway.VLLM_MODEL
    assert last_usage(client)["extra"]["variant"] == "champion"


def test_solve_survives_canary_outage(client, monkeypatch):
    def down(messages):
        raise OSError

    monkeypatch.setattr(gateway, "_generate_canary", down)
    client.put("/admin/canary", json={"weight": 1.0}, headers=ADMIN)
    body = client.post("/v1/solve", json={"latex": LATEX}, headers=AUTH).json()
    assert body["status"] == "ok" and body["models"]["code_model"] == gateway.VLLM_MODEL
    extra = last_usage(client)["extra"]
    assert extra["variant"] == "canary" and extra["canary_fallback"] is True
