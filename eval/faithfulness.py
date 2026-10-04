"""Vérification de fidélité d'une explication : chaque égalité écrite en LaTeX ($...$) doit être vraie.

Une relation `A = B` est acceptée si :
- c'est une identité (A - B se simplifie en 0, ou égalité numérique en points aléatoires) ;
- pour une intégrale : A - B est constant en x (primitive à une constante près) ;
- pour une équation / un système : elle est vérifiée par la ou les solutions du problème
  (ex. « 2x = 4 » ou « x_1 = 2 » sont des égalités vraies aux solutions).

Les égalités qu'on ne sait pas parser sont comptées à part (`unparsed`) : elles ne sont ni vraies ni fausses.

Hallucination (dossier, phase 2) : nombres présents dans les formules du texte mais absents de l'énoncé
et des étapes SymPy fournies.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import sympy as sp
from sympy.parsing.latex import parse_latex

from serving.sandbox.runner import exprs_equal

MATH_RE = re.compile(r"\$\$(.+?)\$\$|\\\[(.+?)\\\]|\$(.+?)\$|\\\((.+?)\\\)", re.S)
# Séparateurs entre plusieurs relations dans un même bloc mathématique.
SEP_RE = re.compile(r"\\quad|\\qquad|\\text\{[^}]*\}|\\textrm\{[^}]*\}|\\mathrm\{\s*(?:ou|et|donc)\s*\}|;|\\\\|\\iff|\\Leftrightarrow|\\Rightarrow|\\implies|\\Longleftrightarrow")
SKIP_RE = re.compile(r"\\neq|\\ne\b|<|>|\\leq?|\\geq?|\\in\b|\\notin|\\approx|\\simeq|\\sim\b|\\to\b(?![^_]*\})|\\\{|\\emptyset|\\varnothing|\\mathbb|\\forall|\\exists|\\pm|\\mp")


def normalize_latex(s: str, aliases: dict[str, str] | None = None) -> str:
    for k in sorted(aliases or {}, key=len, reverse=True):
        s = s.replace(k, "\\left(" + aliases[k] + "\\right)")
    s = re.sub(r"\\left\s*([(\[|])", r"\1", s)
    s = re.sub(r"\\right\s*([)\]|])", r"\1", s)
    s = s.replace("\\left.", "").replace("\\right.", "")
    s = re.sub(r"\\(?:mathrm|operatorname|text)\{\s*e\s*\}", "e", s)
    s = re.sub(r"\\(?:mathrm|operatorname)\{([a-z]+)\}", r"\\\1", s)
    s = s.replace("\\cdot", "\\times").replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    s = re.sub(r"\\[,;:!]|\\ |~", " ", s)
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)  # décimales à la française
    # « x (x + 4) » : une variable seule devant une parenthèse est un produit, pas un appel de fonction.
    s = re.sub(r"(?<![\\a-zA-Z])([a-z])\s*(?=\()", r"\1 \\times ", s)
    # Multiplication implicite après une puissance (x^{3} e^{2x}, x^{2} \sin x) : lark ne la lit pas.
    s = re.sub(r"(\^\{[^{}]*\}|\^\w)\s*(?=[a-zA-Z(]|\\(?!times|cdot|right|end|quad|text|to\b|leq?\b|geq?\b|neq?\b))",
               r"\1 \\times ", s)
    s = re.sub(r"\\(?:begin|end)\{[a-z*]+\}", "", s).replace("&", "").replace("\\displaystyle", "")
    return s.strip().rstrip(".").strip()


def _pick(tree_or_expr):
    """Le parseur lark peut renvoyer un arbre ambigu (_ambig) : on prend la première lecture."""
    from lark import Tree

    while isinstance(tree_or_expr, Tree):
        tree_or_expr = tree_or_expr.children[0]
    return tree_or_expr


def _strip_group(s: str) -> str:
    """'(A + B)' ou '{A + B}' -> 'A + B' si les délimiteurs entourent toute la chaîne."""
    s = s.strip()
    pairs = {"(": ")", "{": "}", "[": "]"}
    if s and s[0] in pairs:
        depth = 0
        for i, ch in enumerate(s):
            depth += ch in "({[" and 1 or 0
            depth -= ch in ")}]" and 1 or 0
            if depth == 0:
                return s[1:-1].strip() if i == len(s) - 1 else s
    return s


DERIV_RE = re.compile(r"^\\frac\{d\}\{d\s*([a-z])\}\s*(.+)$", re.S)
INT_RE = re.compile(r"^\\int\s*(.+?)\s*\bd\s*([a-z])\s*$", re.S)
LIM_RE = re.compile(r"^\\lim_\{\s*([a-z])\s*\\to\s*(.+?)\}\s*(.+)$", re.S)


def _parse_raw(s: str):
    """Dérivée, intégrale et limite sont découpées ici (corps parsé séparément), le reste par SymPy."""
    s = _strip_group(s)
    if m := DERIV_RE.match(s):
        return sp.Derivative(_parse_raw(m.group(2)), sp.Symbol(m.group(1)))
    if m := INT_RE.match(s):
        return sp.Integral(_parse_raw(m.group(1)), sp.Symbol(m.group(2)))
    if m := LIM_RE.match(s):
        pt = m.group(2).replace("+\\infty", "\\infty").strip()
        point = sp.oo if pt == "\\infty" else -sp.oo if pt == "-\\infty" else _parse_raw(pt)
        return sp.Limit(_parse_raw(m.group(3)), sp.Symbol(m.group(1)), point)
    try:
        return parse_latex(s)  # backend ANTLR : le plus fiable (fonctions, multiplication implicite)
    except Exception:
        return _pick(parse_latex(s, backend="lark"))


def parse(s: str, var_names=("x", "y")) -> sp.Expr:
    expr = _parse_raw(s)
    if not isinstance(expr, sp.Basic):
        raise ValueError(f"lecture impossible : {s}")
    repl = {}
    for sym in expr.free_symbols:
        name = sym.name
        if name == "e":
            repl[sym] = sp.E
        elif name == "C" or re.fullmatch(r"C_?\{?\d*\}?", name):
            repl[sym] = sp.Symbol("C")
        else:
            m = re.fullmatch(r"([a-z])_\{?\w+\}?", name)  # x_1, x_{2} -> x
            if m and m.group(1) in var_names:
                repl[sym] = sp.Symbol(m.group(1))
    return expr.xreplace(repl) if repl else expr


def split_relations(segment: str) -> list[tuple[str, str]]:
    """'a = b = c' -> [(a, b), (b, c)], en coupant d'abord sur les séparateurs (\\quad, \\text{ou}, ;)."""
    pairs = []
    for part in SEP_RE.split(segment):
        if not part or "=" not in part or SKIP_RE.search(part):
            continue
        sides = [p.strip() for p in part.split("=")]
        sides = [p for p in sides if p]
        pairs.extend(zip(sides, sides[1:]))
    return pairs


@dataclass
class Context:
    ptype: str
    var_names: list[str]
    solutions: list[dict] = field(default_factory=list)  # [{x: 2}, {x: 3}] ou [{x: 1, y: 2}]
    aliases: dict[str, str] = field(default_factory=dict)
    symbols: dict[sp.Symbol, sp.Expr] = field(default_factory=dict)  # a, b, c, Delta... -> valeurs

    @classmethod
    def from_problem(cls, problem: dict) -> "Context":
        names = problem.get("vars", ["x"])
        syms = [sp.Symbol(n) for n in names]
        sols = []
        ans = sp.sympify(problem["answer"]) if problem["type"] in ("equation",) else None
        if problem["type"] == "equation":
            sols = [{syms[0]: v} for v in ans]
        elif problem["type"] == "system":
            sols = [{sp.Symbol(k): sp.sympify(v) for k, v in problem["check"]["answer"].items()}]
        symbols = {sp.Symbol(k): sp.sympify(v) for k, v in problem.get("symbols", {}).items()}
        return cls(problem["type"], names, sols, problem.get("aliases", {}), symbols)


def relation_holds(lhs: sp.Expr, rhs: sp.Expr, ctx: Context) -> bool:
    if isinstance(lhs, sp.Equality) or isinstance(rhs, sp.Equality):
        return False
    lhs, rhs = sp.sympify(lhs).subs(ctx.symbols).doit(), sp.sympify(rhs).subs(ctx.symbols).doit()
    if exprs_equal(lhs, rhs):
        return True
    diff = lhs - rhs
    x = sp.Symbol(ctx.var_names[0])
    if ctx.ptype == "integral" or sp.Symbol("C") in diff.free_symbols:
        try:
            if sp.simplify(sp.diff(diff, x)) == 0:
                return True
        except Exception:
            pass
    if ctx.solutions:
        def ok(sol):
            try:
                return sp.simplify(diff.subs(sol)) == 0
            except Exception:
                return False
        if ctx.ptype == "system":
            return all(ok(s) for s in ctx.solutions)
        return any(ok(s) for s in ctx.solutions)
    return False


class _Timeout(Exception):
    pass


def _with_time_limit(fn, seconds: int):
    """Limite le temps d'un calcul SymPy (simplify peut exploser). Actif seulement dans le thread principal."""
    import signal
    import threading

    if threading.current_thread() is not threading.main_thread():
        return fn()

    def handler(*_):
        raise _Timeout()

    old = signal.signal(signal.SIGALRM, handler)
    signal.alarm(seconds)
    try:
        return fn()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


@dataclass
class FaithfulnessReport:
    n_ok: int = 0
    n_fail: int = 0
    n_unparsed: int = 0
    failures: list[str] = field(default_factory=list)
    final_answer_stated: bool = False
    n_numbers: int = 0
    hallucinated: list[str] = field(default_factory=list)

    @property
    def hallucination_rate(self) -> float:
        return len(self.hallucinated) / self.n_numbers if self.n_numbers else 0.0

    @property
    def score(self) -> float:
        n = self.n_ok + self.n_fail
        return self.n_ok / n if n else 0.0

    def accept(self, max_unparsed_ratio: float = 0.34) -> bool:
        """Critère de filtrage des données de distillation : aucune égalité fausse, aucun nombre inventé,
        au moins une égalité vraie, la réponse finale énoncée, et peu d'égalités illisibles."""
        total = self.n_ok + self.n_fail + self.n_unparsed
        return (self.n_fail == 0 and not self.hallucinated and self.n_ok >= 1 and self.final_answer_stated
                and (self.n_unparsed / total if total else 1) <= max_unparsed_ratio)

    def to_dict(self) -> dict:
        return {**self.__dict__, "score": self.score, "hallucination_rate": self.hallucination_rate}


NUM_RE = re.compile(r"(?<![a-zA-Z_^\\])\d+(?:\.\d+)?")


def _numbers(latex: str) -> set[str]:
    return {n.rstrip("0").rstrip(".") if "." in n else n for n in NUM_RE.findall(normalize_latex(latex))}


def allowed_numbers(problem: dict) -> set[str]:
    src = [problem["latex"], problem.get("answer_latex") or "", str(problem.get("answer", ""))]
    for st in problem["steps"]:
        src += [st.get("latex") or "", st.get("text_fr") or ""]
    allowed = set().union(*(_numbers(s) for s in src))
    return allowed | {"0", "1", "2"}  # constantes de rédaction (2a, x², facteur 1...)


def _is_final_answer(rhs: sp.Expr, problem: dict) -> bool:
    ptype, chk = problem["type"], problem["check"]
    try:
        if ptype == "equation":
            return any(exprs_equal(rhs, v) for v in sp.sympify(chk["answer"]))
        if ptype == "system":
            return any(exprs_equal(rhs, sp.sympify(v)) for v in chk["answer"].values())
        if ptype == "integral":
            x = sp.Symbol(chk.get("var", "x"))
            return exprs_equal(sp.diff(rhs.subs(sp.Symbol("C"), 0), x), chk["integrand"])
        return exprs_equal(rhs, chk["answer"])
    except Exception:
        return False


def check_explanation(text: str, problem: dict) -> FaithfulnessReport:
    ctx = Context.from_problem(problem)
    rep = FaithfulnessReport()
    if problem["type"] == "equation" and not ctx.solutions:  # pas de solution réelle
        rep.final_answer_stated = bool(re.search(r"aucune solution|pas de solution|\\emptyset|\\varnothing", text, re.I))
    allowed = allowed_numbers(problem)
    segments = []  # (nombres, segment entièrement vérifié ?)
    for m in MATH_RE.finditer(text):
        raw = next(g for g in m.groups() if g)
        nums = _numbers(raw)
        rep.n_numbers += len(nums)
        seg = normalize_latex(raw, ctx.aliases)
        seg_ok = seg_bad = 0
        for a, b in split_relations(seg):
            try:
                lhs, rhs = parse(a, ctx.var_names), parse(b, ctx.var_names)
            except Exception:
                rep.n_unparsed += 1
                seg_bad += 1
                continue
            try:
                good = _with_time_limit(lambda: relation_holds(lhs, rhs, ctx), 5)
            except (Exception, _Timeout):
                rep.n_unparsed += 1
                seg_bad += 1
                continue
            if good:
                rep.n_ok += 1
                seg_ok += 1
                rep.final_answer_stated |= _is_final_answer(rhs, problem)
            else:
                rep.n_fail += 1
                seg_bad += 1
                rep.failures.append(f"{a} = {b}")
        segments.append((nums, seg_ok > 0 and seg_bad == 0))
    # Un nombre absent des étapes n'est pas une hallucination s'il apparaît dans un calcul entièrement vérifié
    # (ex. « 3 × (−3) − (−14) × 3 = −9 + 42 », niveau collège où chaque calcul est détaillé).
    derived = set().union(*(n for n, ok in segments if ok)) if segments else set()
    for nums, _ in segments:
        rep.hallucinated += sorted(nums - allowed - derived)
    return rep
