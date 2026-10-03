import random

import pytest

from datagen.problems import TYPES, generate
from eval.faithfulness import check_explanation


def _faithful_text(p):
    return "\n".join(s["text_fr"] + (f" $${s['latex']}$$" if s["latex"] else "") for s in p["steps"])


@pytest.mark.parametrize("ptype", TYPES)
def test_faithful_explanations_are_accepted(ptype):
    rng = random.Random(3)
    for d in (1, 2, 3):
        p = generate(ptype, rng, d)
        assert check_explanation(_faithful_text(p), p).accept(), p["latex"]


def test_false_equality_is_rejected():
    p = generate("equation", random.Random(5), 2)  # 2x² - 22x + 60 = 0, solutions 5 et 6
    rep = check_explanation(r"On trouve $\Delta = 12$ donc $x = 7$.", p)
    assert not rep.accept() and rep.n_fail == 2 and rep.hallucinated


def test_symbolic_formula_with_coefficients():
    p = generate("equation", random.Random(5), 2)
    assert check_explanation(r"$\Delta = b^2 - 4ac = 4$ donc $x_1 = 5$ et $x_2 = 6$.", p).accept()


def test_derivative_alias():
    d = generate("derivative", random.Random(2), 1)
    assert not check_explanation("Donc $f'(x) = 0$.", d).accept()
    assert check_explanation(f"Donc ${d['answer_latex']}$.", d).accept()
