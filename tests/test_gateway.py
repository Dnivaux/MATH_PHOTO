from fastapi.testclient import TestClient

from datagen.from_latex import from_latex
from serving.gateway import mock, pipeline
from serving.gateway.schema import SolveRequest

AUTH = {"Authorization": "Bearer dev-token"}


def test_mock_requires_token():
    c = TestClient(mock.app)
    assert c.post("/v1/solve", json={"latex": "x=1"}).status_code == 401
    assert c.post("/v1/solve", json={"latex": "x=1"}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_mock_solve_each_type():
    c = TestClient(mock.app)
    for latex, ptype in [("x^2=4", "equation"), (r"\int x dx", "integral"), (r"\lim_{x \to 0} x", "limit")]:
        r = c.post("/v1/solve", json={"latex": latex, "want_code": True}, headers=AUTH)
        assert r.status_code == 200 and r.json()["problem"]["type"] == ptype and r.json()["code"]


def test_pipeline_self_correction():
    """Premier code en erreur, le second juste : 2 tentatives, résultat vérifié."""
    ref = from_latex("x^2 - 5x + 6 = 0")["reference_code"]
    answers = iter(["```python\nresult = 1/0\n```", f"```python\n{ref}print(result)\n```"])
    resp = pipeline.solve(SolveRequest(latex="x^2 - 5x + 6 = 0", want_code=True), lambda m: next(answers))
    assert resp.status == "ok" and resp.result.verified and resp.code.attempts == 2


def test_pipeline_answer_mismatch():
    resp = pipeline.solve(SolveRequest(latex="x^2 - 5x + 6 = 0"), lambda m: "```python\nresult = [7]\n```")
    assert resp.status == "unverified" and resp.error.code.value == "answer_mismatch"


def test_pipeline_parse_error():
    resp = pipeline.solve(SolveRequest(latex="\\frac{{{"), lambda m: "")
    assert resp.status == "error"
