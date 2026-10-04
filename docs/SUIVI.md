# Suivi du week-end 1

Runbook complet : `docs/WEEKEND.md`. Ce fichier donne l'avancement et la suite immédiate.

## Avancement des étapes

| # | Étape | État | Résultat / remarque |
|---|---|---|---|
| 1 | Environnement (CUDA, venv, llama.cpp, env-check) | ✅ Fait | env-check OK : bf16 156 TFLOPS, vLLM 34 k tok/s, llama.cpp CUDA 1 060 tok/s |
| 2 | Contrat d'API avec le collègue | ⏳ À faire | `make mock`, valider `docs/api/example_response.json` |
| 3 | Données et banc d'évaluation | ✅ Fait | Éval v1 figée (250 problèmes), pool de 15 000 |
| 4 | Baselines code | ✅ Fait | 1,5B : 98 % (1,2 s) ; 7B : 99,6 % (3,5 s), pass@4 100 %. **Effet plafond** : jeu v1 trop facile |
| 4 | Baselines explication | ✅ Fait (à relancer en `-v2`) | Re-noté, lycée : 0,6B 84 %, 1,7B 89 % d'acceptation |
| 4 | Données du LoRA | ✅ Fait | `data/sft/code_7b_raw.jsonl` : 7 978 exemples |
| 4 | QLoRA 7B de nuit | ✅ Fait | `models/teacher-ft-lora` (r=16, 2 époques) |
| 5 | Éval du LoRA | ✅ Fait | teacher-ft : 100 %, **1,4 s contre 3,5 s** (82 tokens contre 314). Registry : `math-7b-teacher` v1 @champion |
| 5 | Données de distillation | ✅ Fait | `code_teacher_ft.jsonl` : 11 793 ; `explain_fr.jsonl` : 8 567 (2 998 problèmes, ≈ 95 % acceptés, 0 `<think>`) |
| 6 | Distillation Math-1,5B | ✅ Fait | 100 %, **0,4 s** (contre 1,2 s pour la baseline), 85 tokens. 9,9 min, 13,2 Go. `math-1.5b-distill` v1 @champion |
| 6 | Distillation Qwen3-0,6B | ✅ Fait | Acceptation 98,0 / 97,2 / 99,6 % (contre 84 % au lycée pour la baseline), fidélité 99,4 %. `explainer-0.6b` v1 @champion |
| 7 | Pruning 20 % + réparation | ✅ Fait | 28 → 22 couches (retirées : 11–15, 25), 596 → 502 M. Avant réparation : 17,6 % au lycée ; après : 93,6 / 96,4 / 98,8 % |
| 7 | GGUF F16 / Q8_0 / Q4_K_M (imatrix) | ✅ Fait | `models/gguf/explainer-0.6b{,-p20}/` |
| 7 | Éval des GGUF (CPU) | ✅ Fait | Prunée Q4 : 95,2 % au lycée (−1,2 pt contre la version réparée), 109 contre 92 tok/s → on livre la prunée |
| 8 | Test de la vraie gateway (+ décodage spéculatif) | ⏳ À faire | |
| 9 | OCR (pix2tex / TexTeller) | ⏳ À faire | Il faut d'abord imprimer et photographier la planche |
| 10 | Rapport et commit | ⏳ À faire | |

### Chaîne de compression de l'explicateur (pour le rapport)

| Modèle | Params | Acceptation collège / lycée / supérieur | Fidélité lycée | Latence p50 | Tokens |
|---|---|---|---|---|---|
| baseline-qwen3-0.6b | 596 M | – / 84,0 / – | 96,2 % | 0,3 s | |
| distill-qwen3-0.6b | 596 M | 98,0 / 97,2 / 99,6 | 99,4 % | 0,75 s | 157 |
| pruned20 avant réparation | 502 M | 26,4 / 17,6 / 32,0 | 44,5 % | 4,98 s | 642 |
| pruned20 réparé (LoRA r=32, 1 époque, 6,7 min) | 502 M | 93,6 / 96,4 / 98,8 | 99,2 % | 0,61 s | 159 |
| GGUF Q4_K_M prunée (CPU, 324 Mo) | 502 M | – / 95,2 / – | 99,4 % | 6,0 s | 260 |
| GGUF Q4_K_M non prunée (CPU, 378 Mo) | 596 M | – / 94,8 – 95,6 / – | 99,6 % | 7,0 – 7,4 s | 259 |

### Bugs corrigés (à garder pour le rapport)

| Bug | Symptôme | Correction |
|---|---|---|
| CUDA hors du PATH (Arch : `/opt/cuda`) | `append_path` introuvable ; FlashInfer : `Could not find nvcc` | Exports CUDA dans `build_llamacpp.sh` et `serve.sh` |
| Extraction du code | 7B à 94 % : il ajoute un bloc « Output » après le programme, et c'est ce bloc qui était exécuté | `extract_code` garde le dernier bloc qui ressemble à un programme, plus un test |
| Filtre d'hallucination trop strict | Les calculs intermédiaires justes du niveau collège étaient rejetés (1,7B : 65 %) | Un nombre issu d'un calcul vérifié par SymPy est accepté (1,7B : 95 %) |
| API transformers 5 | `warmup_ratio` inconnu | `warmup_steps=0.03` (un float < 1 est un ratio) |
| Upload MLflow > 500 Mo | `NameResolutionError` sur `minio:9000` (URL présignées internes à Docker) | `MLFLOW_ENABLE_PROXY_MULTIPART_UPLOAD=false` dans `common/config.py` |
| Tokenizer transformers 5 → llama.cpp | `AttributeError: 'list' object has no attribute 'keys'` à la conversion GGUF | `to_gguf.sh` convertit depuis une copie dont le `tokenizer_config.json` est réécrit au format v4 |

### Limites à signaler

- L'`eval_loss` des SFT est optimiste : `sft.py` découpe par ligne, alors qu'un problème apparaît plusieurs fois (k=4 pour le code, 3 niveaux pour les explications). La vraie mesure reste l'éval sur le jeu figé.
- Le niveau collège souffre le plus du pruning (−4,4 pts).
- Le format `$$...$$` apparaît dans des explications : vérifier le rendu dans l'app.

### Runs MLflow à taguer `invalid`

- `baseline-qwen3-0.6b` et `baseline-qwen3-1.7b` de l'ancien filtre (hallucinations 2,7 % et 4,5 %). Les re-notés : seulement une fois les `-v2` lancés.
- `register-math-1.5b-distill` en statut FAILED (première tentative).
- `baseline-math-1.5b-pass4` : sans `pass_at_4`, probablement lancé en greedy.

---

## Suite : à partir de 7.6

### 7.6 a) GGUF Q4_K_M prunée (celle qu'on veut livrer)

```bash
# T1 : llama-server sur CPU, port 8090. Attendre « server is listening »
serving/llm/serve.sh gguf models/gguf/explainer-0.6b-p20/explainer-0.6b-p20-q4_k_m.gguf explainer-q4
# T2
.venv/bin/python -m eval.run_eval explain --base-url http://localhost:8090/v1 --run-name gguf-p20-q4km \
  --role quantized --no-think --concurrency 4 --extra-tags '{"quant":"Q4_K_M"}'
```

### 7.6 b) GGUF Q4_K_M non prunée (pour comparer)

Ctrl-C dans T1, puis :
```bash
serving/llm/serve.sh gguf models/gguf/explainer-0.6b/explainer-0.6b-q4_k_m.gguf explainer-q4      # T1
.venv/bin/python -m eval.run_eval explain --base-url http://localhost:8090/v1 --run-name gguf-q4km \
  --role quantized --no-think --concurrency 4 --extra-tags '{"quant":"Q4_K_M"}'                    # T2
```

**Décision** : on compare `gguf-p20-q4km` à `pruned20-repaired`.
- Perte de 2 pts ou moins : on livre la prunée.
- Collège sous 90 % : on livre la non prunée.

Ne pas comparer la latence à vLLM : ici, c'est du CPU. La vitesse utile est dans les runs `gguf-explainer-0.6b*` (`cpu4t_tg_tok_s.*`).

### 7.7 Livrer au collègue

- Le `.gguf` Q4_K_M retenu, plus l'autre pour comparer.
- Le prompt `EXPLAIN_SYSTEM` / `EXPLAIN_USER` de `common/prompts.py`, à envoyer tel quel, avec `enable_thinking=False`.
- Il peut aussi récupérer le fichier depuis le registry : `models:/explainer-0.6b-p20-gguf@champion` (v1, passée en champion après la 7.6).

### Ensuite

- **Étape 8** : test de la vraie gateway et décodage spéculatif (`docs/WEEKEND.md` §8).
- **Étape 5.7**, si le temps le permet : relancer les baselines explication en `-v2`.
- **Commit** : corrections de `common/config.py`, de `to_gguf.sh` et de `SUIVI.md`.
