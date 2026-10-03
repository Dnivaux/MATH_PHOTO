"""Tests d'attaque du bac à sable (dossier, phase 5, point 6)."""

import pytest

from serving.sandbox import run_code, run_standalone

EXP = {"type": "equation", "answer": "[2, 3]", "var": "x"}
GOOD = "from sympy import *\nx = symbols('x')\nresult = solve(x**2 - 5*x + 6, x)\nprint(result)"


def test_correct_code():
    r = run_code(GOOD, EXP)
    assert r.status == "ok" and r.correct


def test_wrong_answer():
    assert run_code("result = [2]", EXP).correct is False


@pytest.mark.parametrize("code", [
    "import os\nos.system('id')",
    "import subprocess",
    "import socket",
    "from os import path",
    "result = open('/etc/passwd').read()",
    "result = eval('1+1')",
    "result = ().__class__.__bases__[0].__subclasses__()",
    "import sympy\nresult = getattr(sympy, 'sys')",
    "__import__('os')",
])
def test_rejected_by_static_analysis(code):
    r = run_code(code, EXP)
    assert r.status == "rejected" and r.correct is False


def test_infinite_loop_times_out():
    r = run_code("while True:\n    pass", EXP, timeout=2)
    assert r.status == "timeout"


def test_memory_bomb():
    r = run_code("a = [0] * (10**10)", EXP)
    assert r.status == "error" and "MemoryError" in r.error


def test_autonomy():
    ok, last = run_standalone(GOOD)
    assert ok and last == "[2, 3]"
    assert run_standalone("result = 1")[0] is False  # n'affiche rien
