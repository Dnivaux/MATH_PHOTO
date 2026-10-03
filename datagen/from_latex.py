"""Construit un problème (type, solution SymPy, étapes vérifiées) à partir d'un LaTeX reçu par le serveur.

Mêmes constructeurs que le générateur : les étapes renvoyées au client ont la même forme que celles
qui ont servi à distiller le LLM de raisonnement.
"""

from __future__ import annotations

import re

import sympy as sp

from datagen import problems as P
from eval.faithfulness import normalize_latex, parse

x, y = P.x, P.y


class UnsupportedProblem(ValueError):
    """LaTeX lisible mais hors du périmètre du serveur (code d'erreur `unsupported_type`)."""


def detect_type(latex: str) -> str:
    if "\\lim" in latex:
        return "limit"
    if "\\int" in latex:
        return "integral"
    if re.search(r"\\frac\{d\}\{d\s*x\}|f'\(x\)|\\prime", latex):
        return "derivative"
    if "\\begin{cases}" in latex or "\\\\" in latex or latex.count("=") >= 2:
        return "system"
    if "=" in latex:
        return "equation"
    raise UnsupportedProblem("type de problème non reconnu")


def _parse(s: str) -> sp.Expr:
    e = parse(normalize_latex(s), ("x", "y"))
    return e.xreplace({s_: sp.Symbol(s_.name) for s_ in e.free_symbols})  # symboles sans hypothèses


def from_latex(latex: str, type_hint: str | None = None) -> dict:
    ptype = type_hint or detect_type(latex)
    body = latex.strip().strip("$")
    if ptype == "equation":
        lhs, rhs = (_parse(side) for side in body.split("=", 1))
        free = (lhs - rhs).free_symbols
        if free - {x}:
            raise UnsupportedProblem(f"inconnue autre que x : {free}")
        deg = sp.Poly(sp.expand(lhs - rhs), x).degree() if (lhs - rhs).is_polynomial(x) else None
        if deg == 1:
            return P.linear_problem(lhs, rhs)
        if deg == 2:
            return P.quadratic_problem(lhs, rhs)
        return _generic_equation(lhs, rhs)
    if ptype == "system":
        inner = re.sub(r"\\(?:begin|end)\{cases\}", "", body)
        eqs = [e for e in re.split(r"\\\\|;", inner) if "=" in e]
        pairs = [tuple(_parse(side) for side in e.split("=", 1)) for e in eqs]
        return _generic_system(body, pairs)
    if ptype == "derivative":
        m = re.match(r"^\\frac\{d\}\{d\s*x\}\s*(.+)$", body, re.S)
        expr = m.group(1) if m else body.split("=", 1)[-1]
        return P.derivative_problem(_parse(expr))
    if ptype == "integral":
        m = re.match(r"^\\int\s*(.+?)\s*\\?,?\s*d\s*x\s*$", body, re.S)
        if not m:
            raise UnsupportedProblem("intégrale non reconnue (attendu : \\int ... dx)")
        return P.integral_problem(_parse(m.group(1)))
    if ptype == "limit":
        lim = _parse(body)
        if not isinstance(lim, sp.Limit):
            raise UnsupportedProblem("limite non reconnue")
        return _generic_limit(body, lim)
    raise UnsupportedProblem(f"type non géré : {ptype}")


def _generic_equation(lhs, rhs) -> dict:
    sols = [s for s in sp.solve(sp.Eq(lhs, rhs), x) if s.is_real]
    steps = [P._step("Résolution exacte par SymPy.", f"x \\in \\left\\{{{' ; '.join(P.L(s) for s in sols)}\\right\\}}")]
    return P._equation(f"{P.L(lhs)} = {P.L(rhs)}", lhs, rhs, sols, steps, "general", 3)


def _generic_system(latex: str, pairs) -> dict:
    syms = sorted(set().union(*[(l - r).free_symbols for l, r in pairs]), key=str)
    sol = sp.solve([sp.Eq(l, r) for l, r in pairs], syms, dict=True)
    if len(sol) != 1:
        raise UnsupportedProblem("le système n'a pas une solution unique")
    sol = sol[0]
    steps = [P._step(f"Valeur de {s}.", f"{s} = {P.L(sol[s])}", s, sol[s], "equation") for s in syms]
    names = [str(s) for s in syms]
    eqs = ", ".join(f"Eq({P.L_py(l)}, {P.L_py(r)})" for l, r in pairs)
    return P._finish({
        "type": "system", "subtype": "general", "difficulty": 2, "latex": latex,
        "statement_fr": f"Résoudre le système ${latex}$.", "statement_en": f"Solve the system of equations ${latex}$.",
        "vars": names, "answer": str(sol), "answer_latex": ", \\; ".join(f"{s} = {P.L(sol[s])}" for s in syms),
        "check": {"type": "system", "answer": {str(k): str(v) for k, v in sol.items()}, "vars": names},
        "steps": steps,
        "reference_code": f"from sympy import *\n{', '.join(names)} = symbols('{' '.join(names)}')\n"
                          f"result = solve([{eqs}], [{', '.join(names)}], dict=True)[0]\n",
    })


def _generic_limit(latex: str, lim: sp.Limit) -> dict:
    expr, var, point = lim.args[0], lim.args[1], lim.args[2]
    val = sp.limit(expr, var, point)
    steps = [P._step("Calcul de la limite par SymPy.", f"{latex} = {P.L(val)}", lim, val)]
    return P._finish({
        "type": "limit", "subtype": "general", "difficulty": 2, "latex": latex,
        "statement_fr": f"Calculer la limite ${latex}$.", "statement_en": f"Compute the limit ${latex}$.",
        "vars": ["x"], "answer": str(val), "answer_latex": P.L(val),
        "check": {"type": "limit", "answer": str(val), "var": "x"}, "steps": steps,
        "reference_code": f"from sympy import *\nx = symbols('x')\nresult = limit({P.L_py(expr)}, x, {P.L_py(point)})\n",
    })
