"""Caractéristiques d'une formule pour le suivi de dérive (grille MLOps 2). Calculées de la même façon sur les
données d'entraînement (référence) et sur les requêtes reçues, sans garder la formule elle-même.
"""

from __future__ import annotations

import re

_COMMANDS = re.compile(r"\\[a-zA-Z]+")
_POWER = re.compile(r"\^\s*\{?\s*(\d+)")


def latex_features(latex: str | None) -> dict:
    s = latex or ""
    letters = set(re.findall(r"[a-zA-Z]", _COMMANDS.sub(" ", s)))
    powers = [int(p) for p in _POWER.findall(s)]
    return {
        "latex_len": len(re.sub(r"\s+", "", s)),
        "n_vars": len(letters - {"d", "e"}),           # d de dx, e de l'exponentielle
        "n_frac": s.count("\\frac"),
        "max_power": max(powers, default=1 if re.search(r"[a-zA-Z]", s) else 0),
        "n_functions": len(re.findall(r"\\(sin|cos|tan|ln|log|exp|sqrt)(?![a-zA-Z])", s)),
    }
