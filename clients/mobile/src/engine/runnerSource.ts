/**
 * Code Python chargé une fois dans Pyodide. Il exécute le code SymPy
 * (gabarit ou serveur) après une analyse AST, puis renvoie un JSON :
 *   { ok, steps:[{label, latex}], result_latex, numeric_latex, plot, error }
 * plot = { var, range?, curves:[{label, js, latex}], points:[{label, x, y}] }
 */
export const RUNNER_SOURCE = String.raw`
import ast, json, time, traceback, io

_ALLOWED_MODULES = {"sympy", "math", "fractions", "itertools", "functools", "numpy"}
_FORBIDDEN_NAMES = {
    "eval", "exec", "open", "compile", "__import__", "globals", "locals", "vars",
    "getattr", "setattr", "delattr", "input", "breakpoint", "exit", "quit", "help",
    "memoryview", "js", "pyodide", "os", "sys", "subprocess", "socket",
}

class UnsafeCodeError(Exception):
    pass

def _check_code(code):
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in _ALLOWED_MODULES:
                    raise UnsafeCodeError("import interdit : " + a.name)
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in _ALLOWED_MODULES:
                raise UnsafeCodeError("import interdit : " + str(node.module))
        elif isinstance(node, ast.Name) and node.id in _FORBIDDEN_NAMES:
            raise UnsafeCodeError("nom interdit : " + node.id)
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise UnsafeCodeError("attribut interdit : " + node.attr)
    return tree

def _tex(v):
    import sympy
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return r"\text{Vrai}" if v else r"\text{Faux}"
    if isinstance(v, (list, tuple, set)):
        return r",\ ".join(_tex(x) for x in v)
    return sympy.latex(v)

def _numeric(result):
    import sympy
    try:
        if isinstance(result, sympy.Basic) and result.is_number and not result.is_Integer and result.is_finite:
            n = sympy.N(result, 10)
            if n != result:
                return sympy.latex(n)
    except Exception:
        pass
    return None

def _plot_data(exprs, var, rng, points):
    """Courbes pour le graphe interactif : expressions traduites en JavaScript
    (le téléphone recalcule les points à chaque zoom / déplacement)."""
    import sympy
    from sympy.printing.jscode import jscode
    curves = []
    for label, e in exprs:
        e = sympy.sympify(e)
        if e.free_symbols - {var}:
            continue
        try:
            js = jscode(e)
        except Exception:
            continue
        if "//" in js or "\n" in js:
            continue
        curves.append({"label": str(label), "js": js, "latex": sympy.latex(e)})
    if not curves:
        return None
    out = {"var": str(var), "curves": curves, "points": []}
    if rng:
        try:
            out["range"] = [float(rng[0]), float(rng[1])]
        except Exception:
            pass
    for p in (points or []):
        try:
            out["points"].append({"label": str(p[0]), "x": float(p[1]), "y": float(p[2])})
        except Exception:
            pass
    return out

def run_user_code(code, want_plot=False):
    t0 = time.time()
    out = {"ok": False, "steps": [], "result_latex": None, "numeric_latex": None, "plot": None, "error": None}
    try:
        _check_code(code)
        ns = {"__name__": "__sympy_task__"}
        exec(compile(code, "<code>", "exec"), ns)
        if "result" not in ns:
            raise ValueError("le code doit définir la variable result")
        result = ns["result"]
        out["steps"] = [{"label": str(l), "latex": _tex(v)} for (l, v) in ns.get("steps", [])]
        out["result_latex"] = ns.get("result_latex") or _tex(result)
        out["numeric_latex"] = _numeric(result)
        if ns.get("plot_exprs") and ns.get("plot_var") is not None:
            try:
                out["plot"] = _plot_data(ns["plot_exprs"], ns["plot_var"], ns.get("plot_range"), ns.get("plot_points"))
            except Exception as e:
                out["plot_error"] = repr(e)
        out["ok"] = True
    except Exception as e:
        tb = traceback.format_exc().strip().splitlines()
        out["error"] = type(e).__name__ + ": " + str(e)
        out["traceback"] = "\n".join(tb[-6:])
    out["ms"] = round((time.time() - t0) * 1000)
    return json.dumps(out)
`;
