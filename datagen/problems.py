"""Générateur de problèmes SymPy : équations, systèmes, dérivées, intégrales (primitives), limites.

Chaque problème est un dict JSON-sérialisable :
    id, type, subtype, difficulty, latex, statement_fr, statement_en, vars,
    answer (str SymPy), answer_latex,
    check      -> transmis tel quel au bac à sable pour juger `result`
    steps      -> [{text_fr, latex, lhs?, rhs?, kind}] ; chaque égalité est vérifiée à la génération
    aliases    -> remplacements LaTeX pour la vérification de fidélité (f(x), \\Delta, ...)
    reference_code -> code SymPy de référence (sert à tester la chaîne et d'amorce d'entraînement)

Les mêmes constructeurs servent au serveur (`from_latex`) pour produire les étapes d'un problème reçu.
"""

from __future__ import annotations

import hashlib
import random

import sympy as sp

x, y = sp.symbols("x y")
L = sp.latex


def L_py(e) -> str:
    """Expression en syntaxe Python/SymPy lisible (code de référence, prompts)."""
    return sp.sstr(e)


def _id(ptype: str, latex: str) -> str:
    return f"{ptype}-{hashlib.sha1(latex.encode()).hexdigest()[:10]}"


def _step(text_fr: str, latex: str | None = None, lhs=None, rhs=None, kind: str = "identity") -> dict:
    d = {"text_fr": text_fr, "latex": latex, "kind": kind}
    if lhs is not None:
        d["lhs"], d["rhs"] = str(lhs), str(rhs)
    return d


def _par(v) -> str:
    """LaTeX d'un nombre, entre parenthèses s'il est négatif."""
    s = L(v)
    return f"\\left({s}\\right)" if (v.is_number and v < 0) else s


# Route attendue (dossier, phase 1) : ce que le téléphone traite seul, ce qui escalade vers le serveur.
LOCAL_SUBTYPES = {("equation", "linear")}


def _finish(p: dict) -> dict:
    p["id"] = _id(p["type"], p["latex"])
    p["route"] = "local" if (p["type"], p["subtype"]) in LOCAL_SUBTYPES else "server"
    p.setdefault("aliases", {})
    p.setdefault("symbols", {})
    return p


# ------------------------------------------------------------------ équations

def equation_linear(rng: random.Random) -> dict:
    while True:
        a, b, c, d = (rng.randint(-9, 9) for _ in range(4))
        if a != 0 and a != c:
            break
    return linear_problem(a * x + b, c * x + d)


def linear_problem(lhs, rhs, difficulty: int = 1) -> dict:
    """Équation du premier degré quelconque (lhs = rhs, linéaire en x)."""
    poly = sp.expand(lhs - rhs)
    k, r = poly.coeff(x, 1), -poly.coeff(x, 0)  # forme k x = r
    sol = r / k
    latex = f"{L(lhs)} = {L(rhs)}"
    steps = [
        _step("On regroupe les termes en x à gauche et les constantes à droite.",
              f"{L(k * x)} = {L(r)}", k * x, r, "equation"),
        _step(f"On divise les deux membres par {L(k)}.", f"x = {L(sol)}", x, sol, "equation"),
        _step(f"L'équation admet une unique solution : $x = {L(sol)}$."),
    ]
    return _equation(latex, lhs, rhs, [sol], steps, "linear", difficulty)


def equation_quadratic(rng: random.Random, difficulty: int = 2) -> dict:
    mode = rng.choices(["two", "double", "none"], [0.7, 0.15, 0.15])[0]
    k = rng.choice([1, 1, 2, -1, 3] if difficulty >= 2 else [1])
    if mode == "none":
        p, q = rng.randint(-6, 6), rng.randint(1, 12)
        while p * p - 4 * q >= 0:
            q += 3
        poly = sp.expand(k * (x**2 + p * x + q))
    else:
        r1 = rng.randint(-6, 6) if difficulty < 3 else sp.Rational(rng.randint(-7, 7), rng.choice([2, 3]))
        r2 = r1 if mode == "double" else rng.choice([v for v in range(-6, 7) if v != r1])
        den = sp.denom(r1) if isinstance(r1, sp.Rational) else 1
        poly = sp.expand(k * den * (x - r1) * (x - r2))
    return quadratic_problem(poly, sp.Integer(0), difficulty)


def quadratic_problem(lhs, rhs, difficulty: int = 2) -> dict:
    """Équation du second degré quelconque, résolue par le discriminant."""
    poly = sp.expand(lhs - rhs)
    a, b, c = (poly.coeff(x, i) for i in (2, 1, 0))
    D = b**2 - 4 * a * c
    latex = f"{L(lhs)} = {L(rhs)}"
    aliases = {"\\Delta": L(D)}
    steps = [_step(f"On identifie a = {a}, b = {b}, c = {c} et on calcule le discriminant.",
                   f"\\Delta = b^{{2}} - 4ac = {_par(b)}^{{2}} - 4 \\times {_par(a)} \\times {_par(c)} = {L(D)}",
                   sp.Symbol("Delta"), D)]
    if D > 0:
        x1, x2 = sp.nsimplify((-b - sp.sqrt(D)) / (2 * a)), sp.nsimplify((-b + sp.sqrt(D)) / (2 * a))
        sols = sorted([x1, x2], key=lambda v: float(v))
        steps += [
            _step("Le discriminant est strictement positif : l'équation a deux solutions réelles."),
            _step("Première solution.", f"x_1 = \\frac{{{L(-b)} - \\sqrt{{{L(D)}}}}}{{{L(2 * a)}}} = {L(x1)}", x, x1, "equation"),
            _step("Seconde solution.", f"x_2 = \\frac{{{L(-b)} + \\sqrt{{{L(D)}}}}}{{{L(2 * a)}}} = {L(x2)}", x, x2, "equation"),
            _step(f"Les solutions sont $x = {L(sols[0])}$ et $x = {L(sols[1])}$."),
        ]
    elif D == 0:
        x0 = -b / (2 * a)
        sols = [x0]
        steps += [
            _step("Le discriminant est nul : l'équation a une solution double."),
            _step("Solution double.", f"x_0 = \\frac{{{L(-b)}}}{{{L(2 * a)}}} = {L(x0)}", x, x0, "equation"),
            _step(f"L'unique solution est $x = {L(x0)}$."),
        ]
    else:
        sols = []
        steps.append(_step("Le discriminant est strictement négatif : l'équation n'a aucune solution réelle."))
    p = _equation(latex, lhs, rhs, sols, steps, "quadratic", difficulty)
    p["aliases"] = aliases
    p["symbols"] = {"a": str(a), "b": str(b), "c": str(c), "Delta": str(D)}
    return p


def _equation(latex, lhs, rhs, sols, steps, subtype, difficulty) -> dict:
    ans = str(sorted(sols, key=lambda v: float(v)))
    return _finish({
        "type": "equation", "subtype": subtype, "difficulty": difficulty, "latex": latex,
        "statement_fr": f"Résoudre dans $\\mathbb{{R}}$ l'équation ${latex}$.",
        "statement_en": f"Solve the equation ${latex}$ for real $x$.",
        "vars": ["x"], "answer": ans,
        "answer_latex": "\\emptyset" if not sols else "x \\in \\left\\{" + " ; ".join(L(s) for s in sorted(sols, key=float)) + "\\right\\}",
        "check": {"type": "equation", "answer": ans, "var": "x"},
        "steps": steps,
        "reference_code": ("from sympy import *\nx = symbols('x')\n"
                           f"result = [s for s in solve(Eq({L_py(lhs)}, {L_py(rhs)}), x) if s.is_real]\n"),
    })


# ------------------------------------------------------------------ systèmes

def system_2x2(rng: random.Random, difficulty: int = 2) -> dict:
    span = 5 if difficulty < 3 else 9
    x0, y0 = rng.randint(-span, span), rng.randint(-span, span)
    while True:
        a1, b1, a2, b2 = (rng.randint(-6, 6) for _ in range(4))
        if a1 * b2 - a2 * b1 != 0 and 0 not in (a1, b2):
            break
    c1, c2 = a1 * x0 + b1 * y0, a2 * x0 + b2 * y0
    e1, e2 = a1 * x + b1 * y, a2 * x + b2 * y
    D = a1 * b2 - a2 * b1
    nx, ny = c1 * b2 - c2 * b1, a1 * c2 - a2 * c1
    latex = f"\\begin{{cases}} {L(e1)} = {c1} \\\\ {L(e2)} = {c2} \\end{{cases}}"
    steps = [
        _step("On calcule le déterminant du système (méthode de Cramer).",
              f"\\Delta = {_par(sp.Integer(a1))} \\times {_par(sp.Integer(b2))} - {_par(sp.Integer(a2))} \\times {_par(sp.Integer(b1))} = {D}",
              sp.Symbol("Delta"), D),
        _step("Le déterminant est non nul : le système admet une unique solution."),
        _step("Calcul de x.", f"x = \\frac{{{_par(sp.Integer(c1))} \\times {_par(sp.Integer(b2))} - {_par(sp.Integer(c2))} \\times {_par(sp.Integer(b1))}}}{{{D}}} = {x0}",
              x, x0, "equation"),
        _step("Calcul de y.", f"y = \\frac{{{_par(sp.Integer(a1))} \\times {_par(sp.Integer(c2))} - {_par(sp.Integer(a2))} \\times {_par(sp.Integer(c1))}}}{{{D}}} = {y0}",
              y, y0, "equation"),
        _step(f"Vérification dans la première équation : {a1}×({x0}) + {b1}×({y0}) = {c1}."),
        _step(f"La solution est $(x ; y) = ({x0} ; {y0})$."),
    ]
    assert nx == x0 * D and ny == y0 * D
    ans = {"x": str(x0), "y": str(y0)}
    return _finish({
        "type": "system", "subtype": "linear_2x2", "difficulty": difficulty, "latex": latex,
        "statement_fr": f"Résoudre le système ${latex}$.",
        "statement_en": f"Solve the system of equations ${latex}$.",
        "vars": ["x", "y"], "answer": str({x: x0, y: y0}),
        "answer_latex": f"x = {x0}, \\; y = {y0}",
        "check": {"type": "system", "answer": ans, "vars": ["x", "y"]},
        "steps": steps,
        "aliases": {"\\Delta": str(D)},
        "symbols": {"Delta": str(D)},
        "reference_code": ("from sympy import *\nx, y = symbols('x y')\n"
                           f"result = solve([Eq({L_py(e1)}, {c1}), Eq({L_py(e2)}, {c2})], [x, y], dict=True)[0]\n"),
    })


# ------------------------------------------------------------------ dérivées

def _rand_term(rng: random.Random, difficulty: int, for_integral: bool = False):
    k = rng.choice([1, 2, 3, 4, 5, -1, -2, -3, sp.Rational(1, 2)])
    m = rng.choice([1, 2, 3, -1])
    simple = [k * x ** rng.randint(1, 5), k * sp.sin(m * x), k * sp.cos(m * x), k * sp.exp(m * x)]
    medium = simple + [k / x if for_integral else k * sp.log(x), k * sp.sqrt(x) if not for_integral else k * x ** rng.randint(1, 3)]
    hard = [x ** rng.randint(1, 3) * sp.exp(m * x), x * sp.sin(m * x), x * sp.cos(x),
            (x + rng.randint(1, 5)) / (x + rng.randint(-5, 0) or 1) if not for_integral else x * sp.exp(x)]
    pool = simple if difficulty == 1 else medium if difficulty == 2 else medium + hard * 2
    return rng.choice(pool)


def derivative(rng: random.Random, difficulty: int = 2) -> dict:
    n_terms = {1: 2, 2: 2, 3: 3}[difficulty]
    terms = []
    while len(terms) < n_terms:
        t = _rand_term(rng, difficulty)
        if all(sp.simplify(t / u).free_symbols for u in terms):
            terms.append(t)
    return derivative_problem(sp.Add(*terms), difficulty)


def derivative_problem(f, difficulty: int = 2) -> dict:
    df = sp.diff(f, x)
    latex = f"\\frac{{d}}{{dx}}\\left({L(f)}\\right)"
    steps = []
    if len(f.args) > 1 and isinstance(f, sp.Add):
        steps.append(_step("Par linéarité, on dérive chaque terme séparément."))
        for t in f.args:
            steps.append(_derivative_step(t))
    else:
        steps.append(_derivative_step(f))
    steps.append(_step("On rassemble les termes.", f"f'(x) = {L(df)}", sp.Derivative(f, x), df))
    return _finish({
        "type": "derivative", "subtype": "mixed", "difficulty": difficulty, "latex": latex,
        "statement_fr": f"Calculer la dérivée de la fonction $f(x) = {L(f)}$.",
        "statement_en": f"Compute the derivative of $f(x) = {L(f)}$ with respect to $x$.",
        "vars": ["x"], "answer": str(df), "answer_latex": f"f'(x) = {L(df)}",
        "check": {"type": "derivative", "answer": str(df), "var": "x"},
        "steps": steps,
        "aliases": {"f'(x)": L(df), "f(x)": L(f)},  # f'(x) désigne la vraie dérivée
        "reference_code": f"from sympy import *\nx = symbols('x')\nresult = diff({L_py(f)}, x)\n",
    })


def _derivative_step(t) -> dict:
    dt = sp.diff(t, x)
    coeff, rest = t.as_coeff_Mul()
    if isinstance(rest, sp.Mul) and len(rest.args) == 2 and all(a.has(x) for a in rest.args):
        u, v = rest.args
        du, dv = sp.diff(u, x), sp.diff(v, x)
        mid = f"{L(coeff) + ' ' if coeff != 1 else ''}\\left(({L(du)}) ({L(v)}) + ({L(u)}) ({L(dv)})\\right)"
        return _step(f"Dérivée d'un produit : (uv)' = u'v + uv' avec u = {L(u)} et v = {L(v)}.",
                     f"\\frac{{d}}{{dx}}\\left({L(t)}\\right) = {mid} = {L(dt)}", sp.Derivative(t, x), dt)
    if isinstance(rest, sp.Mul) and any(isinstance(a, sp.Pow) and a.exp == -1 and a.base.has(x) for a in rest.args):
        return _step("Dérivée d'un quotient : (u/v)' = (u'v - uv')/v².",
                     f"\\frac{{d}}{{dx}}\\left({L(t)}\\right) = {L(dt)}", sp.Derivative(t, x), dt)
    return _step(f"Dérivée de ${L(t)}$.", f"\\frac{{d}}{{dx}}\\left({L(t)}\\right) = {L(dt)}", sp.Derivative(t, x), dt)


# ------------------------------------------------------------------ intégrales (primitives)

def integral(rng: random.Random, difficulty: int = 2) -> dict:
    n_terms = {1: 2, 2: 2, 3: 3}[difficulty]
    terms = []
    while len(terms) < n_terms:
        t = _rand_term(rng, difficulty, for_integral=True)
        if all(sp.simplify(t / u).free_symbols for u in terms):
            terms.append(t)
    return integral_problem(sp.Add(*terms), difficulty)


def integral_problem(f, difficulty: int = 2) -> dict:
    F = sp.integrate(f, x)
    latex = f"\\int \\left({L(f)}\\right) dx"
    steps = [_step("Par linéarité, on cherche une primitive de chaque terme.")]
    for t in (f.args if isinstance(f, sp.Add) else [f]):
        Ft = sp.integrate(t, x)
        hint = "par parties" if (isinstance(t, sp.Mul) and sum(a.has(x) for a in t.args) == 2) else "primitive usuelle"
        steps.append(_step(f"Terme ${L(t)}$ ({hint}).", f"\\int {L(t)} \\, dx = {L(Ft)} + C",
                           sp.Integral(t, x), Ft + sp.Symbol("C"), "antiderivative"))
    steps.append(_step("On additionne les primitives.", f"F(x) = {L(F)} + C", sp.Integral(f, x), F + sp.Symbol("C"), "antiderivative"))
    return _finish({
        "type": "integral", "subtype": "antiderivative", "difficulty": difficulty, "latex": latex,
        "statement_fr": f"Déterminer une primitive de la fonction $f(x) = {L(f)}$.",
        "statement_en": f"Find an antiderivative of $f(x) = {L(f)}$.",
        "vars": ["x"], "answer": str(F), "answer_latex": f"F(x) = {L(F)} + C",
        "check": {"type": "integral", "answer": str(F), "integrand": str(f), "var": "x"},
        "steps": steps,
        "aliases": {"F(x)": L(F), "f(x)": L(f)},  # une primitive, à une constante près
        "reference_code": f"from sympy import *\nx = symbols('x')\nresult = integrate({L_py(f)}, x)\n",
    })


# ------------------------------------------------------------------ limites

def limit(rng: random.Random, difficulty: int = 2) -> dict:
    kind = rng.choice({1: ["infinity"], 2: ["removable", "infinity"], 3: ["removable", "infinity", "trig", "exp"]}[difficulty])
    if kind == "removable":
        a = rng.randint(-5, 5)
        b, c = rng.sample([v for v in range(-6, 7) if v != a], 2)
        num, den = sp.expand((x - a) * (x - b)), sp.expand((x - a) * (x - c))
        expr, point = num / den, a
        simp = (x - b) / (x - c)
        val = sp.Rational(a - b, a - c)
        steps = [
            _step(f"En remplaçant x par {a}, on obtient la forme indéterminée 0/0 : on factorise."),
            _step("Factorisation du numérateur.", f"{L(num)} = {L((x - a) * (x - b))}", num, sp.factor(num)),
            _step("Factorisation du dénominateur.", f"{L(den)} = {L((x - a) * (x - c))}", den, sp.factor(den)),
            _step(f"Pour x ≠ {a}, on simplifie par (x - {a}).", f"\\frac{{{L(num)}}}{{{L(den)}}} = {L(simp)}", expr, simp),
        ]
    elif kind == "infinity":
        p = rng.randint(1, 3)
        q = rng.choice([p, p, p - 1 if p > 1 else p, p + 1])
        lead_n, lead_d = rng.choice([1, 2, 3, -2, 5]), rng.choice([1, 2, 4, -1, 3])
        num = lead_n * x**p + sum(rng.randint(-5, 5) * x**i for i in range(p))
        den = lead_d * x**q + sum(rng.randint(-5, 5) * x**i for i in range(q)) + (rng.randint(1, 5) if q == 0 else 0)
        if sp.Poly(den, x).degree() < 0 or den == 0:
            den = x + 1
        expr, point = num / den, sp.oo
        val = sp.limit(expr, x, sp.oo)
        n = max(p, q)
        scaled_n, scaled_d = sp.expand(num / x**n), sp.expand(den / x**n)
        steps = [
            _step(f"Forme indéterminée en +∞ : on divise numérateur et dénominateur par $x^{{{n}}}$.",
                  f"\\frac{{{L(num)}}}{{{L(den)}}} = \\frac{{{L(scaled_n)}}}{{{L(scaled_d)}}}", expr, scaled_n / scaled_d),
            _step("Les termes en 1/x^k tendent vers 0 quand x tend vers +∞."),
        ]
    elif kind == "trig":
        k = rng.randint(2, 7)
        expr, point, val = sp.sin(k * x) / x, 0, sp.Integer(k)
        u = sp.Symbol("u")
        steps = [
            _step("On fait apparaître la limite usuelle sin(u)/u → 1 quand u → 0.",
                  f"\\frac{{\\sin({k} x)}}{{x}} = {k} \\times \\frac{{\\sin({k} x)}}{{{k} x}}", expr, k * sp.sin(k * x) / (k * x)),
            _step("Limite usuelle.", "\\lim_{u \\to 0} \\frac{\\sin(u)}{u} = 1", sp.Limit(sp.sin(u) / u, u, 0), 1),
        ]
    else:
        k = rng.randint(2, 6)
        expr, point, val = (sp.exp(k * x) - 1) / x, 0, sp.Integer(k)
        u = sp.Symbol("u")
        steps = [
            _step("On fait apparaître la limite usuelle (e^u - 1)/u → 1 quand u → 0.",
                  f"\\frac{{e^{{{k} x}} - 1}}{{x}} = {k} \\times \\frac{{e^{{{k} x}} - 1}}{{{k} x}}", expr, k * (sp.exp(k * x) - 1) / (k * x)),
            _step("Limite usuelle.", "\\lim_{u \\to 0} \\frac{e^{u} - 1}{u} = 1", sp.Limit((sp.exp(u) - 1) / u, u, 0), 1),
        ]
    to = "\\infty" if point == sp.oo else L(sp.sympify(point))
    lim = sp.Limit(expr, x, point)
    latex = f"\\lim_{{x \\to {to}}} {L(expr)}"
    steps.append(_step("Conclusion.", f"{latex} = {L(val)}", lim, val))
    return _finish({
        "type": "limit", "subtype": kind, "difficulty": difficulty, "latex": latex,
        "statement_fr": f"Calculer la limite ${latex}$.",
        "statement_en": f"Compute the limit ${latex}$.",
        "vars": ["x"], "answer": str(val), "answer_latex": L(val),
        "check": {"type": "limit", "answer": str(val), "var": "x"},
        "steps": steps,
        "reference_code": f"from sympy import *\nx = symbols('x')\nresult = limit({L_py(expr)}, x, {L_py(sp.sympify(point))})\n",
    })


# ------------------------------------------------------------------ API

TYPES = ["equation", "system", "derivative", "integral", "limit"]


def generate(ptype: str, rng: random.Random, difficulty: int) -> dict:
    if ptype == "equation":
        return equation_linear(rng) if difficulty == 1 else equation_quadratic(rng, difficulty)
    return {"system": system_2x2, "derivative": derivative, "integral": integral, "limit": limit}[ptype](rng, difficulty)


def verify_steps(problem: dict) -> list[str]:
    """Vérifie chaque étape (lhs = rhs) avec les règles de la vérification de fidélité. Renvoie les erreurs."""
    from eval.faithfulness import Context, relation_holds

    ctx = Context.from_problem(problem)
    errors = []
    for st in problem["steps"]:
        if "lhs" not in st:
            continue
        lhs, rhs = sp.sympify(st["lhs"]), sp.sympify(st["rhs"])
        if not relation_holds(lhs, rhs, ctx):
            errors.append(f"{st['lhs']} = {st['rhs']}")
    return errors
