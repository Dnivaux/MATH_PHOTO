"""Exécuté dans un sous-processus isolé (python -I runner.py) : lit une requête JSON sur stdin,
exécute le code du modèle avec une liste blanche d'imports et des limites de ressources,
compare éventuellement `result` à la réponse attendue, et écrit un JSON sur stdout.

Ce fichier ne doit dépendre que de la bibliothèque standard et de SymPy : il n'importe pas
le reste du dépôt, pour fonctionner même lancé en mode isolé.

Ce n'est pas une frontière de sécurité forte (SymPy expose beaucoup de choses) : c'est un garde-fou
contre les erreurs du modèle. En production, l'envelopper dans nsjail / gVisor / un conteneur sans réseau.
"""

import builtins
import contextlib
import io
import json
import random
import resource
import signal
import sys

ALLOWED_MODULES = {
    "sympy", "math", "cmath", "fractions", "decimal", "numbers",
    "itertools", "functools", "collections", "operator", "re", "mpmath",
}
BLOCKED_BUILTINS = {"open", "exec", "eval", "compile", "input", "breakpoint", "help", "exit", "quit", "memoryview"}
MARKER = "__SANDBOX_RESULT__"


def _set_limits(mem_mb: int, cpu_s: int) -> None:
    resource.setrlimit(resource.RLIMIT_AS, (mem_mb * 2**20, mem_mb * 2**20))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2**20, 2**20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name.split(".")[0] not in ALLOWED_MODULES:
        raise ImportError(f"import interdit dans le bac à sable : {name}")
    return builtins.__import__(name, globals, locals, fromlist, level)


def _safe_builtins() -> dict:
    b = {k: v for k, v in vars(builtins).items() if k not in BLOCKED_BUILTINS}
    b["__import__"] = _guarded_import
    return b


# ---------------------------------------------------------------- comparaison

def _sp():
    import sympy
    return sympy


def to_sympy(v):
    """Convertit une valeur Python/SymPy produite par le modèle en objet SymPy (récursif)."""
    sp = _sp()
    if isinstance(v, dict):
        return {to_sympy(k) if not isinstance(k, str) else sp.Symbol(k): to_sympy(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [to_sympy(x) for x in v]
    if isinstance(v, sp.FiniteSet):
        return [to_sympy(x) for x in v.args]
    if isinstance(v, sp.Tuple):
        return [to_sympy(x) for x in v.args]
    if isinstance(v, str):
        return sp.sympify(v)
    return sp.sympify(v)


def exprs_equal(a, b, var_names=("x", "y")) -> bool:
    sp = _sp()
    try:
        a, b = sp.sympify(a), sp.sympify(b)
    except Exception:
        return False
    if a == b:
        return True
    if a.has(sp.oo, -sp.oo, sp.zoo, sp.nan) or b.has(sp.oo, -sp.oo, sp.zoo, sp.nan):
        return False
    try:
        if sp.simplify(a - b) == 0:
            return True
    except Exception:
        pass
    # Repli numérique : évaluation en quelques points aléatoires.
    syms = sorted((a - b).free_symbols, key=str)
    rng = random.Random(0)
    try:
        for _ in range(6):
            pt = {s: sp.Float(rng.uniform(0.3, 2.7)) for s in syms}
            va, vb = complex(a.evalf(subs=pt)), complex(b.evalf(subs=pt))
            if abs(va - vb) > 1e-8 * max(1.0, abs(vb)):
                return False
        return True
    except Exception:
        return False


def _solution_list(v):
    """Normalise une sortie de solve() en liste de valeurs (équation à une inconnue)."""
    sp = _sp()
    if isinstance(v, sp.Set) and not isinstance(v, sp.FiniteSet):
        if v == sp.S.EmptySet:
            return []
        raise ValueError("ensemble non fini")
    v = to_sympy(v)
    if not isinstance(v, list):
        v = [v]
    out = []
    for item in v:
        if isinstance(item, dict):
            out.extend(item.values())
        elif isinstance(item, sp.Equality):
            out.append(item.rhs)
        elif isinstance(item, list) and len(item) == 1:
            out.append(item[0])
        else:
            out.append(item)
    # On ne garde que les solutions réelles.
    return [s for s in out if s.is_real is not False]


def _system_dict(v, var_names):
    sp = _sp()
    syms = [sp.Symbol(n) for n in var_names]
    v = to_sympy(v)
    if isinstance(v, list) and len(v) == 1 and isinstance(v[0], (dict, list)):
        v = v[0]
    if isinstance(v, dict):
        return {sp.Symbol(str(k)): val for k, val in v.items()}
    if isinstance(v, list) and len(v) == len(syms):
        return dict(zip(syms, v))
    raise ValueError(f"format de système non reconnu : {v!r}")


def check_answer(result, expected: dict) -> bool:
    """expected = {"type", "answer" (str SymPy), "var", "vars", "integrand"} produit par le générateur."""
    sp = _sp()
    ptype = expected["type"]
    var = sp.Symbol(expected.get("var", "x"))
    if ptype == "equation":
        got = []
        for g in _solution_list(result):  # dédoublonne (racine double listée deux fois)
            if not any(exprs_equal(g, h) for h in got):
                got.append(g)
        want = list(sp.sympify(expected["answer"]))
        unmatched = list(got)
        for w in want:
            for g in unmatched:
                if exprs_equal(g, w):
                    unmatched.remove(g)
                    break
            else:
                return False
        return not unmatched
    if ptype == "system":
        got = _system_dict(result, expected["vars"])
        want = {sp.Symbol(k): sp.sympify(v) for k, v in expected["answer"].items()}
        return set(map(str, got)) == set(map(str, want)) and all(exprs_equal(got[k], want[k]) for k in want)
    if ptype == "derivative":
        return exprs_equal(to_sympy(result), expected["answer"])
    if ptype == "integral":
        got = to_sympy(result)
        if isinstance(got, list) or got.has(sp.Integral):
            return False
        return exprs_equal(sp.diff(got, var), expected["integrand"])
    if ptype == "limit":
        got, want = to_sympy(result), sp.sympify(expected["answer"])
        if got == want:
            return True
        return bool(want.is_finite) and exprs_equal(got, want)
    raise ValueError(f"type inconnu : {ptype}")


# ---------------------------------------------------------------- exécution

def _last_line_value(stdout: str):
    from sympy.parsing.sympy_parser import parse_expr
    lines = [l.strip() for l in stdout.strip().splitlines() if l.strip()]
    if not lines:
        return None
    return parse_expr(lines[-1])


def _on_alarm(*_):
    raise TimeoutError("timeout")


def main() -> None:
    req = json.loads(sys.stdin.read())
    real_stdout = sys.stdout
    out = {"status": "ok", "result": None, "result_latex": None, "correct": None, "stdout": "", "error": None}

    _set_limits(req.get("mem_mb", 2048), int(req.get("timeout", 10)) + 1)
    signal.signal(signal.SIGALRM, _on_alarm)
    import sympy  # noqa: F401  (pré-import avant d'exécuter le code)

    ns = {"__name__": "__main__", "__builtins__": _safe_builtins()}
    buf = io.StringIO()
    signal.alarm(int(req.get("timeout", 10)))
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            exec(compile(req["code"], "<model>", "exec"), ns)
        signal.alarm(0)
        result = ns.get("result")
        if result is None:
            result = _last_line_value(buf.getvalue())
        if result is None:
            out["status"] = "no_result"
        else:
            out["result"] = str(result)
            try:
                out["result_latex"] = sympy.latex(to_sympy(result) if not isinstance(result, dict) else result)
            except Exception:
                pass
            if req.get("expected"):
                out["correct"] = bool(check_answer(result, req["expected"]))
    except TimeoutError:
        out["status"], out["error"] = "timeout", "timeout"
    except MemoryError:
        out["status"], out["error"] = "error", "MemoryError"
    except BaseException as e:  # noqa: BLE001  (SystemExit inclus)
        out["status"], out["error"] = "error", f"{type(e).__name__}: {e}"[:500]
    finally:
        signal.alarm(0)
    if req.get("expected") and out["correct"] is None:
        out["correct"] = False
    out["stdout"] = buf.getvalue()[-2000:]
    real_stdout.write(MARKER + json.dumps(out) + "\n")
    real_stdout.flush()


if __name__ == "__main__":
    main()
