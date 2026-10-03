#!/usr/bin/env bash
# Phase 9 — venv OCR séparé : TexTeller épingle transformers 4.x, incompatible avec transformers 5 (vLLM / TRL).
set -euo pipefail
cd "$(dirname "$0")/../.."
UV="uv"; uv --version >/dev/null 2>&1 || UV="mise x uv@latest -- uv"
[ -d .venv-ocr ] || $UV venv .venv-ocr --python 3.12
$UV pip install --python .venv-ocr/bin/python -e . pix2tex==0.1.4 texteller matplotlib --torch-backend=auto
.venv-ocr/bin/python -c "import torch; print('torch', torch.__version__, 'cuda ok' if torch.cuda.is_available() else 'CPU seulement')"
