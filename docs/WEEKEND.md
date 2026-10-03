# Week-end 1 : runbook

Objectif : environnement validé, données générées, baselines mesurées, un premier LoRA, une première distillation, un premier pruning, un serveur qui répond et l'OCR testé. Tout est tracé dans MLflow (http://localhost:5000, expérience `photo-maths`).

Toutes les commandes se lancent depuis la racine du dépôt. Prévoir deux terminaux : **T1** pour le serveur de modèles (un seul à la fois sur la 5090) et **T2** pour les scripts.

---

## 0. Revue du plan face au dossier projet

Le plan du week-end correspond au **bloc 1 (phases 0, 1, 2)** et à une **première passe de la phase 3** du dossier. Il est cohérent. Les écarts ci-dessous sont déjà intégrés au code.

| # | Point du dossier | Plan initial du week-end | Ajustement retenu |
|---|---|---|---|
| 1 | Monorepo `eval/`, `training/`, `serving/`, `infra/`… (phase 0) | Non précisé | Dépôt organisé selon le dossier |
| 2 | L'explication est rédigée **sur l'appareil**. Le serveur renvoie résultat, étapes SymPy et code ; `/v1/explain` sert seulement au mode léger | Contrat de réponse seul | Contrat v1 : `/v1/solve`, `/v1/explain`, `/health` |
| 3 | L'escalade est décidée par le client, pour 5 raisons | « raison de l'escalade » | La raison est envoyée par le client (`escalation.reason`) et renvoyée telle quelle ; les erreurs serveur sont à part (`error.code`) |
| 4 | Auth `Authorization: Bearer` (phase 7) | Absente | Déjà exigée par la gateway factice : l'app l'intègre dès le premier jour |
| 5 | Le code affiché est **exactement** le code exécuté, autonome, et finit par le résultat | Code renvoyé | Prompt imposant `print(result)` ; la gateway ne réécrit jamais le code ; métrique « code autonome » ajoutée |
| 6 | Bac à sable : analyse statique AST, timeout 5 s, tests d'attaque en CI (phase 5) | Sous-processus avec liste blanche | AST, puis liste blanche à l'exécution, rlimits, réseau coupé (`unshare`), timeout 5 s, 9 tests d'attaque. Le conteneur dédié reste pour la phase 5 |
| 7 | Auto-correction : 2 tentatives (phase 5) | Absente | `pipeline.solve` renvoie l'erreur au LLM, 3 essais au total |
| 8 | Métriques : code autonome, hallucination, pass@k, détail par difficulté (phase 2) | Exactitude et fidélité | Toutes ajoutées à `eval/run_eval.py` |
| 9 | Jeux figés : 500 problèmes étiquetés `local` / `serveur`, 300 listes d'étapes | 200 à 300 problèmes | v1 = 250 problèmes, avec un champ `route`. Ils servent aussi d'éval pour l'explication. La v2 à 500 se fera dans une nouvelle version, sans toucher à la v1 |
| 10 | Baselines d'explication : **Qwen3-0.6B et Qwen3-1.7B** (point à valider : le français du 0,6B) | Absentes | Ajoutées samedi soir (≈ 20 min) |
| 11 | Explications en **3 niveaux** ; filtre « chaque égalité vérifiée **et** aucun nombre absent des étapes » | 1 niveau, égalités | 3 niveaux générés dès dimanche, double filtre |
| 12 | Tableau des modèles serveur : `teacher-ft` enseignant du LLM de raisonnement | Qwen3-8B / Qwen2.5-7B-Instruct pour le français | Le plan du week-end a raison : **mettre le dossier à jour** (enseignant multilingue pour l'explication, Qwen2.5-Math pour le code) |
| 13 | Pruning type **ShortGPT**, 30 à 50 % pour le 0,6B (couches, largeur, vocabulaire) | 20 % des couches | 20 % des couches par *Block Influence* : première marche. Garder aussi le GGUF du 0,6B non pruné comme point de comparaison et filet de sécurité |
| 14 | Quantization Q8_0 à Q4_K_M **avec matrice d'importance** | Q4_K_M | Q8_0 et Q4_K_M, imatrix calculée sur les explications françaises |
| 15 | Registry : alias `champion` / `challenger`, lignée (phase 3D) | « registry » | Chaque modèle entre en `challenger`, avec les tags `parent` et hash des données |
| 16 | QLoRA : recherche r = 8 / 16 / 32 | Un QLoRA | r = 16 la nuit. Les deux autres rangs plus tard (ou en LoRA bf16, plus rapide sur 32 Go) |
| 17 | OCR : 200 à 500 vraies photos ; exact, équivalence, taux d'erreur par token | 50 photos | 50 photos d'une **planche imprimée déjà étiquetée** (aucune saisie). Les trois métriques sont implémentées |
| 18 | MinIO dans le compose | — | Les images MinIO officielles ont été retirées (Docker Hub et quay) : on utilise l'image Chainguard du même binaire. À noter pour DVC |

**Hors dossier, ajouté** : la gateway recalcule la solution de façon déterministe (SymPy) et la compare au résultat du code du LLM. Le champ `result.verified` en découle, et un désaccord donne `status: "unverified"` avec `error.code = answer_mismatch`. C'est l'application directe de la règle centrale du dossier.

**Risque de planning** : le dimanche est très chargé. Si le temps manque, couper dans cet ordre : décodage spéculatif, imatrix, TexTeller sur les photos, niveaux collège et supérieur. Ne jamais couper le **GGUF** ni la **gateway factice** : ce sont les livrables qui débloquent le collègue.

---

## Déjà fait et testé (vendredi soir)

- Infra `docker compose` : MLflow 3.16 + Postgres 16 + MinIO. Runs, datasets, registry et alias vérifiés de bout en bout.
- Générateur SymPy (5 types, 3 difficultés, étapes vérifiées, code de référence) et `from_latex` pour le serveur.
- **Jeu d'évaluation figé** `data/eval/problems_v1.jsonl` : 250 problèmes, tests de données OK, tracé dans MLflow (`data-eval`).
- Pool d'entraînement `data/train/pool_v1.jsonl` (15 000 problèmes, disjoint de l'éval).
- Bac à sable, vérification de fidélité (180/180 explications justes acceptées, explications fausses rejetées), banc `eval/`.
- Contrat d'API v1, gateway factice, gateway réelle, faux LLM pour la CI.
- 300 images OCR synthétiques et planche de 50 formules à imprimer (`data/ocr/real/planche_a_imprimer.pdf`).
- `make test` : 38 tests verts.

---

## Samedi

### 1. Environnement (2–3 h)

```bash
sudo pacman -S cuda                 # CUDA 13.3 (/opt/cuda), compilateur hôte gcc15 ; nécessaire pour llama.cpp
make infra-up                       # si l'infra n'est pas déjà lancée
make env                            # .venv : torch 2.13+cu132, vLLM 0.30, bitsandbytes 0.50, TRL 1.14 (≈ 10 Go)
make llamacpp                       # llama.cpp CUDA sm_120 + .venv-llamacpp + llama-bench sur un petit GGUF
make env-check                      # torch (sm_120, matmul bf16, SDPA), bnb NF4 + AdamW 8 bits, vLLM, llama.cpp
make test
```

**C'est fini quand** `env-check` affiche OK pour les 4 outils et que le run `env-check` est dans MLflow.
**Si un outil bloque** : PyTorch → vérifier que `torch.cuda.get_arch_list()` contient `sm_120`. vLLM → essayer `--enforce-eager`. bitsandbytes → plan B : LoRA bf16 au lieu de QLoRA (le 7B tient dans 32 Go). llama.cpp → `NVCC_CCBIN=/usr/bin/g++-15`.

### 2. Contrat d'API avec le collègue (30 min)

```bash
make contract                       # docs/api/openapi.json, *.schema.json, example_request/response.json
make mock                           # gateway factice sur :8100, jeton « dev-token »
curl -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
     -d '{"latex":"2x^2-3x-5=0","want_code":true,"escalation":{"reason":"out_of_local_scope"}}' localhost:8100/v1/solve
```

À valider ensemble, en partant de `docs/api/example_response.json` :
- les champs `problem`, `result` (`latex`, `sympy`, `verified`), `steps[]` (`text_fr`, `latex`), `code` (`source`, `stdout`, `attempts`), `escalation`, `error`, `timings` ;
- les statuts `ok` / `unverified` / `error`, et l'affichage associé côté app ;
- les raisons d'escalade (client) et les codes d'erreur (serveur) ;
- les scénarios de test via l'en-tête `X-Mock-Scenario: unverified | error | slow`.

Le contrat se change **dans `serving/gateway/schema.py` uniquement**, puis `make contract`. Pour exposer la gateway factice au collègue : Tailscale, ou `cloudflared tunnel --url http://localhost:8100`.

### 3. Données et banc d'évaluation (3–4 h, en grande partie fait)

```bash
make data-eval                      # refuse d'écraser la v1 : le jeu est figé
make data-train
```

À relire : quelques problèmes de chaque type (`head -c 3000 data/eval/problems_v1.jsonl`), et les runs `data-eval` / `data-train` dans MLflow (rapport de données, hash).

### 4. Soirée : baselines, puis lancement de nuit

Baselines code (≈ 5 min chacune ; T1 sert, T2 évalue) :

```bash
# T1                                   # T2
make serve-math-1.5b                   make eval-code NAME=baseline-math-1.5b && make eval-passk NAME=baseline-math-1.5b-pass4
make serve-math-7b                     make eval-code NAME=baseline-math-7b   && make eval-passk NAME=baseline-math-7b-pass4
```

Baselines explication (point à valider du dossier : le français du 0,6B face au 1,7B) :

```bash
make serve-qwen3-0.6b                  make eval-explain NAME=baseline-qwen3-0.6b
make serve-qwen3-1.7b                  make eval-explain NAME=baseline-qwen3-1.7b
```

Données du LoRA, avec le 7B servi (≈ 1 h ; 4 000 problèmes × 8 codes, filtrés par exécution et autonomie) :

```bash
make serve-math-7b                     .venv/bin/python -m training.llm.gen_code_data --model qwen-math-7b \
                                           --n-problems 4000 --k 8 --out data/sft/code_7b_raw.jsonl
```

Regarder `problems_solved_pct` et `solved_pct.<type>` dans MLflow : les types faibles sont ceux où le LoRA a le plus à apporter. **Avant la nuit**, arrêter vLLM (T1) puis lancer :

```bash
nohup .venv/bin/python -m training.llm.sft --base Qwen/Qwen2.5-Math-7B-Instruct \
  --data data/sft/code_7b_raw.jsonl --method qlora --r 16 --epochs 2 \
  --out models/teacher-ft-lora --run-name qlora-7b-r16 > logs_qlora.txt 2>&1 &
```

Faire d'abord un essai de 2 minutes (`--epochs 0.02`) pour vérifier qu'il n'y a pas d'OOM et que la loss descend.

## Dimanche

### 5. Matin : évaluation et données de distillation (2–3 h)

```bash
.venv/bin/python -m training.llm.merge_lora --adapter models/teacher-ft-lora --out models/teacher-ft
make serve-teacher-ft                  make eval-code NAME=teacher-ft-r16 ROLE=teacher-ft
                                       make eval-passk NAME=teacher-ft-r16-pass4 ROLE=teacher-ft
# comparer teacher-ft-r16 et baseline-math-7b dans MLflow, puis :
.venv/bin/python -m training.llm.register --dir models/teacher-ft-lora --name math-7b-teacher \
    --alias challenger --eval-run <run_id de teacher-ft-r16>
# s'il bat le 7B brut : MlflowClient().set_registered_model_alias("math-7b-teacher", "champion", <version>)

# toujours avec teacher-ft servi : données de distillation du 1,5B
.venv/bin/python -m training.llm.gen_code_data --model teacher-ft --n-problems 6000 --k 4 \
    --out data/sft/code_teacher_ft.jsonl
```

Explications françaises, enseignant multilingue (Qwen3-8B, mode thinking coupé) :

```bash
make serve-qwen3-8b                    .venv/bin/python -m training.llm.gen_explanations --model qwen3-8b \
                                           --n-problems 3000 --out data/sft/explain_fr.jsonl
```

Viser au moins 3 000 explications acceptées (`accept_rate_pct`, `texts_with_hallucination_pct` dans MLflow). Si le taux d'acceptation est bas, lire les `failures` : en général, l'enseignant reformule une égalité.

### 6. Distillations (2–3 h de GPU, enchaînées)

```bash
# arrêter vLLM, puis :
.venv/bin/python -m training.llm.sft --base Qwen/Qwen2.5-Math-1.5B-Instruct --data data/sft/code_teacher_ft.jsonl \
  --method full --lr 1e-5 --epochs 2 --out models/math-1.5b-distill --run-name distill-math-1.5b \
  --parent math-7b-teacher && \
.venv/bin/python -m training.llm.sft --base Qwen/Qwen3-0.6B --data data/sft/explain_fr.jsonl \
  --method full --lr 2e-5 --epochs 2 --out models/qwen3-0.6b-explain --run-name distill-qwen3-0.6b

serving/llm/serve.sh local models/math-1.5b-distill math-1.5b-distill   # T1
make eval-code NAME=distill-math-1.5b ROLE=distilled                    # T2
serving/llm/serve.sh local models/qwen3-0.6b-explain qwen3-0.6b-explain
make eval-explain NAME=distill-qwen3-0.6b ROLE=distilled
```

### 7. Après-midi : pruning et quantization (2 h)

```bash
.venv/bin/python -m training.llm.prune_layers --model models/qwen3-0.6b-explain --ratio 0.2 \
  --calib data/sft/explain_fr.jsonl --out models/qwen3-0.6b-pruned20
serving/llm/serve.sh local models/qwen3-0.6b-pruned20 pruned20          # T1
make eval-explain NAME=pruned20-avant-repair ROLE=pruned               # T2 (mesure la casse avant réparation)
# LoRA de réparation (1 époque), puis fusion :
.venv/bin/python -m training.llm.sft --base models/qwen3-0.6b-pruned20 --data data/sft/explain_fr.jsonl \
  --method lora --r 32 --epochs 1 --out models/qwen3-0.6b-pruned20-lora --run-name repair-pruned20
.venv/bin/python -m training.llm.merge_lora --adapter models/qwen3-0.6b-pruned20-lora --out models/qwen3-0.6b-pruned20-repaired
serving/llm/serve.sh local models/qwen3-0.6b-pruned20-repaired pruned20-repaired
make eval-explain NAME=pruned20-repaired ROLE=pruned

# GGUF : F16 -> Q8_0 et Q4_K_M (imatrix), bench CPU, registry
training/llm/to_gguf.sh models/qwen3-0.6b-explain           explainer-0.6b     data/sft/explain_fr.jsonl
training/llm/to_gguf.sh models/qwen3-0.6b-pruned20-repaired explainer-0.6b-p20 data/sft/explain_fr.jsonl
# Évaluer le GGUF tel qu'il tournera sur le téléphone (llama-server, CPU) :
serving/llm/serve.sh gguf models/gguf/explainer-0.6b-p20/explainer-0.6b-p20-q4_k_m.gguf explainer-q4
.venv/bin/python -m eval.run_eval explain --base-url http://localhost:8090/v1 --run-name gguf-p20-q4km \
  --role quantized --no-think --concurrency 4 --extra-tags '{"quant":"Q4_K_M"}'
```

**Livrer au collègue** : `explainer-0.6b-p20-q4_k_m.gguf` (et la version non prunée, pour comparer), ainsi que le prompt `EXPLAIN_SYSTEM` / `EXPLAIN_USER` de `common/prompts.py`. L'app doit envoyer exactement ce format, avec `enable_thinking=False`. Il peut aussi récupérer le fichier depuis le registry (`models:/explainer-0.6b-p20-gguf@challenger`).

### 8. Test serveur (1–2 h)

```bash
make serve-teacher-ft                                                   # T1
VLLM_MODEL=teacher-ft .venv/bin/uvicorn serving.gateway.app:app --host 0.0.0.0 --port 8100   # remplace la factice
curl -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" \
     -d '{"latex":"\\int x e^{x} \\, dx","want_code":true}' localhost:8100/v1/solve
```

Vérifier `status: ok`, `result.verified: true`, `code.attempts`, `timings`. L'app du collègue pointe désormais vers la vraie gateway, sans rien changer.

Si le temps le permet, décodage spéculatif : `serving/llm/serve.sh teacher-ft-spec`. Si vLLM refuse le brouillon (vocabulaire 152 064 pour le 7B contre 151 936 pour le 1,5B), passer à `teacher-ft-ngram`. Relancer `make eval-code NAME=teacher-ft-spec`, comparer `latency_p50_s` et `throughput_tok_s`, et lire le taux d'acceptation dans `curl localhost:8000/metrics | grep spec_decode`.

### 9. OCR (1–2 h)

```bash
infra/setup/setup_ocr_env.sh                       # .venv-ocr (TexTeller impose transformers 4.x)
# imprimer data/ocr/real/planche_a_imprimer.pdf, photographier chaque formule au téléphone,
# copier les photos sous data/ocr/real/photo_01.jpg … photo_50.jpg (numéro = numéro sur la planche)
for m in pix2tex texteller; do for d in data/ocr/synthetic data/ocr/real; do
  .venv-ocr/bin/python -m eval.ocr_bench --model $m --data $d; done; done
```

Pas d'entraînement : il s'agit seulement des baselines (exact, équivalence SymPy, taux d'erreur par token, p50/p95 en ms).

### 10. Fin de week-end (30 min)

```bash
make test && make report            # tableau Markdown, aussi logué dans le run « weekend-summary »
git add -A && git commit -m "Week-end 1 : env, données, éval, LoRA, distillation, pruning, GGUF, gateway, OCR"
```

Point avec le collègue : contrat d'API (écarts constatés), GGUF (RAM et tokens/s mesurés sur son téléphone, à remonter dans MLflow), URL de la gateway.

---

## Repères

| Fichier | Rôle |
|---|---|
| `datagen/problems.py`, `datagen/from_latex.py`, `datagen/build_sets.py` | générateur SymPy, problème depuis un LaTeX, jeux figés |
| `serving/sandbox/` | analyse AST + exécution isolée + comparaison à la solution |
| `eval/faithfulness.py`, `eval/run_eval.py`, `eval/ocr_bench.py`, `eval/report.py` | banc d'évaluation unique |
| `common/prompts.py` | prompts code et explication, partagés par l'éval, les données et le serveur |
| `training/llm/` | `gen_code_data`, `gen_explanations`, `sft`, `merge_lora`, `prune_layers`, `to_gguf.sh`, `register` |
| `serving/gateway/` | `schema.py` (contrat), `mock.py`, `app.py`, `pipeline.py` |
| `serving/llm/serve.sh` | vLLM / llama-server pour chaque modèle |

Ordres de grandeur sur la 5090, **à mesurer** : génération 7B ≈ 2 000–5 000 tokens/s en lot ; QLoRA 7B sur 6 000 exemples × 2 époques ≈ 2–4 h ; SFT complet 1,5B ≈ 1 h ; 0,6B ≈ 20 min.
