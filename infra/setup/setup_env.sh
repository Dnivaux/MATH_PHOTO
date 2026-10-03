#!/usr/bin/env bash
# Phase 1 — environnement Python GPU (PyTorch Blackwell, vLLM, bitsandbytes, TRL) en une seule résolution.
# uv choisit la roue PyTorch adaptée au driver (--torch-backend=auto -> cu12.8+ / cu13, requis pour sm_120).
set -euo pipefail
cd "$(dirname "$0")/../.."

UV="uv"; uv --version >/dev/null 2>&1 || UV="mise x uv@latest -- uv"
[ -d .venv ] || $UV venv .venv --python 3.12
$UV pip install --python .venv/bin/python -e ".[gpu,dev]" --torch-backend=auto
.venv/bin/python -c "import torch, vllm, transformers, trl, peft, bitsandbytes as bnb; print('torch', torch.__version__, 'cuda', torch.version.cuda, '| vllm', vllm.__version__, '| transformers', transformers.__version__, '| trl', trl.__version__, '| peft', peft.__version__, '| bnb', bnb.__version__)"
echo "OK. Lancer ensuite : .venv/bin/python infra/setup/check_gpu.py"
