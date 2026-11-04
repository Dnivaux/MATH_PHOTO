"""Bac à sable en service : même comportement qu'en local, appelé par run_code quand SANDBOX_URL est défini."""

import httpx
from fastapi.testclient import TestClient

from serving import sandbox
from serving.sandbox import service

EXP = {"type": "equation", "answer": "[2, 3]", "var": "x"}
GOOD = "from sympy import *\nx = symbols('x')\nresult = solve(x**2 - 5*x + 6, x)\nprint(result)"


def test_service_runs_and_rejects(monkeypatch):
    c = TestClient(service.app)
    r = c.post("/run", json={"code": GOOD, "expected": EXP}).json()
    assert r["status"] == "ok" and r["correct"] is True
    assert c.post("/run", json={"code": "import os"}).json()["status"] == "rejected"
    monkeypatch.setenv("SANDBOX_TOKEN", "s3cret")
    assert c.post("/run", json={"code": GOOD}).status_code == 401
    assert c.post("/run", json={"code": GOOD}, headers={"X-Sandbox-Token": "s3cret"}).status_code == 200


def test_run_code_goes_remote(monkeypatch):
    c = TestClient(service.app)
    monkeypatch.setenv("SANDBOX_URL", "http://sandbox:8200")
    monkeypatch.setattr(httpx, "post", lambda url, json, headers, timeout: c.post("/run", json=json, headers=headers))
    assert sandbox.run_code(GOOD, EXP).correct is True
    # l'AST est vérifiée avant l'envoi
    assert sandbox.run_code("import subprocess").status == "rejected"


def test_remote_unreachable_fails_cleanly(monkeypatch):
    monkeypatch.setenv("SANDBOX_URL", "http://127.0.0.1:9")  # port fermé : refus immédiat
    r = sandbox.run_code(GOOD, EXP)
    assert r.status == "error" and r.correct is False and "injoignable" in r.error
