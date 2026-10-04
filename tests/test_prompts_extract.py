"""Extraction du code dans la réponse du LLM."""

from common.prompts import extract_code


def test_garde_le_programme_et_pas_le_bloc_de_sortie():
    text = (
        "```python\nfrom sympy import *\nx = symbols('x')\nresult = integrate(4*x**3, x)\nprint(result)\n```\n"
        "Output:\n```\nx**4\n```"
    )
    assert extract_code(text).startswith("from sympy import *")


def test_bloc_unique():
    assert extract_code("```python\nresult = 1\nprint(result)\n```") == "result = 1\nprint(result)"
