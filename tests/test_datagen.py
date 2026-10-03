import random

import pytest

from datagen.from_latex import UnsupportedProblem, from_latex
from datagen.problems import TYPES, generate, verify_steps
from serving.sandbox import run_many


@pytest.mark.parametrize("ptype", TYPES)
def test_generated_problems_are_consistent(ptype):
    rng = random.Random(42)
    problems = [generate(ptype, rng, d) for d in (1, 2, 3) for _ in range(5)]
    assert all(not verify_steps(p) for p in problems)
    assert all(r.correct for r in run_many([(p["reference_code"], p["check"]) for p in problems]))


def test_generation_is_deterministic():
    a = [generate(t, random.Random(7), 2)["id"] for t in TYPES]
    b = [generate(t, random.Random(7), 2)["id"] for t in TYPES]
    assert a == b


@pytest.mark.parametrize("latex,ptype,answer", [
    ("x^2 - 5x + 6 = 0", "equation", "[2, 3]"),
    ("3x - 7 = 11", "equation", "[6]"),
    (r"\begin{cases} 2x + y = 5 \\ x - y = 1 \end{cases}", "system", "{x: 2, y: 1}"),
    (r"\lim_{x \to 0} \frac{\sin(3x)}{x}", "limit", "3"),
])
def test_from_latex(latex, ptype, answer):
    p = from_latex(latex)
    assert p["type"] == ptype and p["answer"] == answer and not verify_steps(p)


def test_from_latex_unsupported():
    with pytest.raises(UnsupportedProblem):
        from_latex("3 + 4")
