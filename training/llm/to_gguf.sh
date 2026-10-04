#!/usr/bin/env bash
# Conversion GGUF + quantization (dossier, 3B/3C) : F16 -> Q8_0 et Q4_K_M, avec matrice d'importance
# calculée sur les données du modèle (explications françaises ou codes), puis mesure et log MLflow.
#   training/llm/to_gguf.sh models/qwen3-0.6b-pruned20-repaired explainer-0.6b-p20 data/sft/explain_fr.jsonl
set -euo pipefail
cd "$(dirname "$0")/../.."
MODEL_DIR="$1"; NAME="$2"; CALIB="${3:-}"
LLAMA=third_party/llama.cpp; BIN=$LLAMA/build/bin; OUT=models/gguf/$NAME
mkdir -p "$OUT"

# transformers 5 écrit `extra_special_tokens` en liste ; le transformers 4 de .venv-llamacpp attend un dict.
# Copie de travail (liens vers les poids) avec la clé v4 `additional_special_tokens`.
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
for f in "$MODEL_DIR"/*; do ln -s "$(realpath "$f")" "$STAGE/"; done
rm "$STAGE/tokenizer_config.json"
.venv/bin/python - "$MODEL_DIR/tokenizer_config.json" "$STAGE/tokenizer_config.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
if isinstance(cfg.get("extra_special_tokens"), list):
    cfg["additional_special_tokens"] = cfg.pop("extra_special_tokens")
json.dump(cfg, open(sys.argv[2], "w"), ensure_ascii=False, indent=2)
PY

.venv-llamacpp/bin/python $LLAMA/convert_hf_to_gguf.py "$STAGE" --outtype f16 --outfile "$OUT/$NAME-f16.gguf"

IMATRIX=()
if [ -n "$CALIB" ]; then  # texte de calibration : prompts + complétions du jeu SFT
  .venv/bin/python - "$CALIB" "$OUT/calib.txt" <<'PY'
import json, random, sys
rows = [json.loads(l) for l in open(sys.argv[1])]
random.Random(0).shuffle(rows)
with open(sys.argv[2], "w") as f:
    for r in rows[:400]:
        f.write(r["messages"][-1]["content"] + "\n" + r["completion"] + "\n\n")
PY
  $BIN/llama-imatrix -m "$OUT/$NAME-f16.gguf" -f "$OUT/calib.txt" -o "$OUT/imatrix.gguf" -ngl 99 --chunks 100
  IMATRIX=(--imatrix "$OUT/imatrix.gguf")
fi
$BIN/llama-quantize "$OUT/$NAME-f16.gguf" "$OUT/$NAME-q8_0.gguf" Q8_0
$BIN/llama-quantize "${IMATRIX[@]}" "$OUT/$NAME-f16.gguf" "$OUT/$NAME-q4_k_m.gguf" Q4_K_M

# Vitesse sur CPU, 4 threads : ordre de grandeur d'un téléphone (la vraie mesure se fait sur l'appareil).
for q in f16 q8_0 q4_k_m; do
  $BIN/llama-bench -m "$OUT/$NAME-$q.gguf" -ngl 0 -t 4 -p 256 -n 64 -o json > "$OUT/bench-$q.json"
done
.venv/bin/python -m training.llm.log_gguf --dir "$OUT" --name "$NAME" --parent "$MODEL_DIR"
