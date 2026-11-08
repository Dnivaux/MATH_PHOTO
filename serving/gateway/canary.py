"""Canary du modèle de code (grille MLOps 3) : une part du trafic de /v1/solve va au challenger.

Tirage à chaque requête : le résultat affiché vient de SymPy, seul `verified` peut changer d'un appel à l'autre.
La part vit en mémoire (un seul processus uvicorn) : CANARY_WEIGHT au démarrage, puis PUT /admin/canary.
"""

from __future__ import annotations

import os
import random

_weight = float(os.getenv("CANARY_WEIGHT", "0"))


def weight() -> float:
    return _weight


def set_weight(value: float) -> None:
    global _weight
    _weight = value


class Route:
    """Variante tirée pour une requête, avec repli sur le champion si le canary ne répond pas."""

    def __init__(self, champion, canary=None, draw=random.random):
        self._champion, self._canary = champion, canary
        self.variant = "canary" if canary is not None and draw() < _weight else "champion"
        self.fell_back = False

    def __call__(self, messages: list[dict]) -> str:
        if self.variant == "champion" or self.fell_back:
            return self._champion(messages)
        try:
            return self._canary(messages)
        except Exception:  # noqa: BLE001  (challenger injoignable : l'utilisateur ne doit pas le voir)
            self.fell_back = True
            return self._champion(messages)
