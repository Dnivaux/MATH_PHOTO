"""Analyse statique du code avant exécution (dossier, phase 5, point 3).

Refuse : imports hors liste blanche, exec/eval/open/__import__/compile/globals/getattr..., attributs « dunder ».
Même règles à reproduire côté ordinateur avant Pyodide (code partagé, phase 6).
"""

from __future__ import annotations

import ast

from serving.sandbox.runner import ALLOWED_MODULES

FORBIDDEN_CALLS = {
    "exec", "eval", "open", "__import__", "compile", "globals", "locals", "vars", "getattr", "setattr",
    "delattr", "input", "breakpoint", "help", "memoryview", "exit", "quit",
}


def check_code(code: str) -> list[str]:
    """Renvoie la liste des violations (vide si le code est accepté)."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"syntaxe : {e.msg} (ligne {e.lineno})"]
    errors = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_MODULES:
                    errors.append(f"import interdit : {a.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.level or (node.module or "").split(".")[0] not in ALLOWED_MODULES:
                errors.append(f"import interdit : {node.module}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_CALLS:
            errors.append(f"nom interdit : {node.id}")
        elif isinstance(node, ast.Attribute) and node.attr.startswith("__") and node.attr.endswith("__"):
            errors.append(f"attribut dunder interdit : {node.attr}")
        elif isinstance(node, ast.Name) and node.id.startswith("__") and node.id.endswith("__") and node.id != "__name__":
            errors.append(f"nom dunder interdit : {node.id}")
    return errors
