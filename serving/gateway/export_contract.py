"""Génère les artefacts du contrat d'API à partager avec le collègue :
docs/api/openapi.json, docs/api/solve_response.schema.json, et un exemple de réponse par type
(serving/gateway/examples/), produit par la vraie chaîne avec le code de référence à la place du LLM.

    python -m serving.gateway.export_contract
"""

from __future__ import annotations

import json
from pathlib import Path

from common.config import ROOT
from datagen.from_latex import from_latex
from serving.gateway import mock, pipeline
from serving.gateway.schema import ClientInfo, Escalation, SolveRequest, SolveResponse

EXAMPLE_INPUTS = {
    "equation": "2 x^{2} - 3 x - 5 = 0",
    "system": "\\begin{cases} 2 x + y = 5 \\\\ x - y = 1 \\end{cases}",
    "derivative": "\\frac{d}{dx}\\left(x^{2} \\sin(x)\\right)",
    "integral": "\\int x e^{x} \\, dx",
    "limit": "\\lim_{x \\to 0} \\frac{\\sin(3 x)}{x}",
}


def reference_generator(latex: str):
    problem = from_latex(latex)
    return lambda messages: f"```python\n# Code de référence (exemple)\n{problem['reference_code']}print(result)\n```"


def main() -> None:
    api = ROOT / "docs" / "api"
    api.mkdir(parents=True, exist_ok=True)
    (api / "openapi.json").write_text(json.dumps(mock.app.openapi(), indent=1, ensure_ascii=False))
    (api / "solve_response.schema.json").write_text(json.dumps(SolveResponse.model_json_schema(), indent=1, ensure_ascii=False))
    (api / "solve_request.schema.json").write_text(json.dumps(SolveRequest.model_json_schema(), indent=1, ensure_ascii=False))
    out = Path(mock.EXAMPLES)
    out.mkdir(exist_ok=True)
    for ptype, latex in EXAMPLE_INPUTS.items():
        req = SolveRequest(latex=latex, want_code=True, client=ClientInfo(platform="android"),
                           escalation=Escalation(reason="out_of_local_scope"))
        resp = pipeline.solve(req, reference_generator(latex), request_id=f"exemple-{ptype}")
        assert resp.status == "ok", (ptype, resp.error)
        (out / f"solve_{ptype}.json").write_text(resp.model_dump_json(indent=1))
        if ptype == "equation":
            (api / "example_request.json").write_text(req.model_dump_json(indent=1, exclude_none=True))
            (api / "example_response.json").write_text(resp.model_dump_json(indent=1))
    print(f"contrat exporté dans {api} et {out}")


if __name__ == "__main__":
    main()
