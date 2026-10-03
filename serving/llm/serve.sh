#!/usr/bin/env bash
# Sert un modèle derrière une API compatible OpenAI (port 8000 par défaut, 8090 pour les GGUF).
#   serving/llm/serve.sh math-1.5b | math-7b | qwen3-0.6b | qwen3-1.7b | qwen3-8b | teacher-ft | teacher-ft-spec
#   serving/llm/serve.sh local <dossier> <nom>       # n'importe quel modèle HF local (distillé, pruné...)
#   serving/llm/serve.sh gguf <fichier.gguf> <nom>   # llama-server (CPU par défaut, comme sur l'appareil)
# Un seul modèle à la fois sur la 5090 pendant le week-end : Ctrl-C avant d'en lancer un autre.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${PORT:-8000}"
VLLM=(.venv/bin/vllm serve)
COMMON=(--port "$PORT" --max-model-len 4096 --gpu-memory-utilization "${GPU_UTIL:-0.85}")

case "${1:-}" in
  math-1.5b)  exec "${VLLM[@]}" Qwen/Qwen2.5-Math-1.5B-Instruct --served-model-name qwen-math-1.5b "${COMMON[@]}" ;;
  math-7b)    exec "${VLLM[@]}" Qwen/Qwen2.5-Math-7B-Instruct --served-model-name qwen-math-7b "${COMMON[@]}" ;;
  qwen3-0.6b) exec "${VLLM[@]}" Qwen/Qwen3-0.6B --served-model-name qwen3-0.6b "${COMMON[@]}" ;;
  qwen3-1.7b) exec "${VLLM[@]}" Qwen/Qwen3-1.7B --served-model-name qwen3-1.7b "${COMMON[@]}" ;;
  qwen3-8b)   exec "${VLLM[@]}" Qwen/Qwen3-8B --served-model-name qwen3-8b "${COMMON[@]}" ;;
  teacher-ft) exec "${VLLM[@]}" models/teacher-ft --served-model-name teacher-ft "${COMMON[@]}" ;;
  teacher-ft-fp8)  # quantization serveur à la volée (dossier : AWQ / FP8), native sur Blackwell
              exec "${VLLM[@]}" models/teacher-ft --served-model-name teacher-ft --quantization fp8 "${COMMON[@]}" ;;
  teacher-ft-spec) # décodage spéculatif : le 1,5B distillé comme brouillon
              DRAFT="${DRAFT:-models/math-1.5b-distill}"
              exec "${VLLM[@]}" models/teacher-ft --served-model-name teacher-ft "${COMMON[@]}" \
                   --speculative-config "{\"model\": \"$DRAFT\", \"num_speculative_tokens\": ${SPEC_K:-5}}" ;;
  teacher-ft-ngram) # repli si le brouillon est refusé (taille de vocabulaire 7B ≠ 1,5B)
              exec "${VLLM[@]}" models/teacher-ft --served-model-name teacher-ft "${COMMON[@]}" \
                   --speculative-config '{"method": "ngram", "num_speculative_tokens": 5, "prompt_lookup_max": 4}' ;;
  local)      exec "${VLLM[@]}" "$2" --served-model-name "$3" "${COMMON[@]}" ;;
  gguf)       exec third_party/llama.cpp/build/bin/llama-server -m "$2" --alias "$3" --port "${PORT_GGUF:-8090}" \
                   --jinja -c 4096 -ngl "${NGL:-0}" -t "${THREADS:-8}" --parallel 4 ;;
  *) sed -n 2,7p "$0"; exit 1 ;;
esac
