"""Bac à sable : exécute du code Python généré par un modèle dans un sous-processus isolé.

- python -I (pas de site utilisateur, pas de variables d'environnement Python), env vidé, cwd temporaire
- limites RLIMIT (mémoire, CPU, taille de fichier) + timeout mural côté parent (kill du groupe)
- analyse statique AST avant exécution (ast_check.py), puis liste blanche d'imports et builtins
  dangereux retirés à l'exécution (runner.py) : défense en profondeur
- timeout de 5 s par défaut (dossier, phase 5)
- réseau coupé si `unshare -rn` est disponible (namespaces utilisateur)
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

RUNNER = Path(__file__).with_name("runner.py")
MARKER = "__SANDBOX_RESULT__"


def _detect_unshare() -> list[str]:
    exe = shutil.which("unshare")
    if not exe:
        return []
    try:
        ok = subprocess.run([exe, "-rn", "true"], capture_output=True, timeout=5).returncode == 0
    except Exception:
        ok = False
    return [exe, "-rn"] if ok else []


_NET_PREFIX: list[str] | None = None


@dataclass
class ExecResult:
    status: str  # ok | error | timeout | no_result | rejected (analyse statique)
    result: str | None = None
    result_latex: str | None = None
    correct: bool | None = None
    stdout: str = ""
    error: str | None = None
    elapsed_ms: float = 0.0
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def run_code(code: str, expected: dict | None = None, timeout: float = 5.0, mem_mb: int = 2048,
             no_network: bool = True) -> ExecResult:
    """Exécute `code`. Si `expected` est fourni (champ `check` d'un problème), renvoie aussi `correct`."""
    import time

    from serving.sandbox.ast_check import check_code

    violations = check_code(code)
    if violations:
        return ExecResult("rejected", error="; ".join(violations)[:500], correct=False if expected else None)

    global _NET_PREFIX
    if _NET_PREFIX is None:
        _NET_PREFIX = _detect_unshare() if no_network else []
    req = json.dumps({"code": code, "expected": expected, "timeout": timeout, "mem_mb": mem_mb})
    cmd = [*(_NET_PREFIX if no_network else []), sys.executable, "-I", str(RUNNER)]
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="sbx-") as tmp:
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=tmp,
            env={"PATH": "/usr/bin:/bin", "HOME": tmp, "OMP_NUM_THREADS": "1"}, text=True,
            start_new_session=True,
        )
        try:
            out, err = proc.communicate(req, timeout=timeout + 5)  # marge : import de SymPy
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            return ExecResult("timeout", error="wall timeout", elapsed_ms=(time.perf_counter() - t0) * 1e3,
                              correct=False if expected else None)
    elapsed = (time.perf_counter() - t0) * 1e3
    for line in reversed(out.splitlines()):
        if line.startswith(MARKER):
            d = json.loads(line[len(MARKER):])
            return ExecResult(**d, elapsed_ms=elapsed)
    status = "timeout" if proc.returncode in (-signal.SIGXCPU, -signal.SIGKILL) else "error"
    return ExecResult(status, error=(err or out)[-500:] or f"exit {proc.returncode}", elapsed_ms=elapsed,
                      correct=False if expected else None)


def run_standalone(code: str, timeout: float = 5.0) -> tuple[bool, str]:
    """Test d'autonomie (métrique « code autonome ») : le code tourne-t-il seul, sans notre harnais,
    dans un Python standard, et affiche-t-il un résultat ? Renvoie (ok, dernière ligne affichée)."""
    from serving.sandbox.ast_check import check_code

    if check_code(code):
        return False, ""
    with tempfile.TemporaryDirectory(prefix="standalone-") as tmp:
        Path(tmp, "main.py").write_text(code)
        try:
            p = subprocess.run([*(_detect_unshare()), sys.executable, "-I", "main.py"], cwd=tmp, capture_output=True,
                               text=True, timeout=timeout + 5, env={"PATH": "/usr/bin:/bin", "HOME": tmp})
        except subprocess.TimeoutExpired:
            return False, ""
    lines = [l for l in p.stdout.strip().splitlines() if l.strip()]
    return p.returncode == 0 and bool(lines), (lines[-1] if lines else "")


def run_many(codes_and_expected: list[tuple[str, dict | None]], timeout: float = 5.0, workers: int | None = None
             ) -> list[ExecResult]:
    """Exécute un lot en parallèle (threads : chaque exécution est déjà un sous-processus)."""
    from concurrent.futures import ThreadPoolExecutor

    workers = workers or max(2, (os.cpu_count() or 4) - 2)
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(lambda ce: run_code(ce[0], ce[1], timeout=timeout), codes_and_expected))
