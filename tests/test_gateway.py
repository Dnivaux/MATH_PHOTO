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


def test_server_ocr_rereads_doubtful_photo():
    """Lecture du téléphone douteuse + photo : la relecture serveur est résolue, sans l'indice de type du client."""
    ref = from_latex("2x^2 - 3x - 5 = 0")["reference_code"]
    req = SolveRequest(latex=r"\begin{array}{c}\hat{U}\end{array}", image_base64="aW1n", type_hint="limit",
                       escalation={"reason": "ocr_low_confidence", "ocr_confidence": 0.4})
    resp = pipeline.solve(req, lambda m: f"```python\n{ref}print(result)\n```", read_image=lambda b64: r"2x^{2}-3x-5=0")
    assert resp.status == "ok" and resp.problem.latex_source == "server_ocr" and resp.problem.type.value == "equation"


def test_server_ocr_falls_back_to_client_latex():
    ref = from_latex("x^2 - 5x + 6 = 0")["reference_code"]
    gen = lambda m: f"```python\n{ref}print(result)\n```"
    req = SolveRequest(latex="x^2 - 5x + 6 = 0", image_base64="aW1n", escalation={"reason": "user_request"})
    # OCR serveur illisible, puis injoignable : la lecture du client est gardée
    for reader in (lambda b64: r"\frac{{{", lambda b64: (_ for _ in ()).throw(OSError())):
        resp = pipeline.solve(req, gen, read_image=reader)
        assert resp.status == "ok" and resp.problem.latex_source == "client"
    # escalade pour une autre raison : la photo n'est pas relue
    req2 = SolveRequest(latex="x^2 - 5x + 6 = 0", image_base64="aW1n", escalation={"reason": "out_of_local_scope"})
    assert pipeline.solve(req2, gen, read_image=lambda b64: "faux").problem.latex_source == "client"


def test_image_only_without_ocr_service():
    resp = pipeline.solve(SolveRequest(image_base64="aW1n"), lambda m: "")
    assert resp.status == "error" and resp.error.code.value == "image_not_supported"


def test_server_ocr_error_reports_its_reading():
    req = SolveRequest(latex=r"\hat{U}\oplus", image_base64="aW1n", escalation={"reason": "ocr_low_confidence"})
    resp = pipeline.solve(req, lambda m: "", read_image=lambda b64: r"x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}")
    assert resp.status == "error" and "photo relue par le serveur" in resp.error.message and "b^{2}" in resp.error.message
