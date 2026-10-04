# Suivi du week-end 1

Runbook complet : `docs/WEEKEND.md`. Ce fichier donne l'avancement et la suite immédiate.

## Avancement des étapes

| # | Étape | État | Résultat / remarque |
|---|---|---|---|
| 1 | Environnement (CUDA, venv, llama.cpp, env-check) | ✅ Fait | env-check OK : bf16 156 TFLOPS, vLLM 34 k tok/s, llama.cpp CUDA 1 060 tok/s |
| 2 | Contrat d'API avec le collègue | ⏳ À faire | `make mock`, valider `docs/api/example_response.json` |
| 3 | Données et banc d'évaluation | ✅ Fait | Éval v1 figée (250 problèmes), pool de 15 000 |
| 4 | Baselines code | ✅ Fait | 1,5B : 100 % (1,2 s) ; 7B : 99,6 % (3,5 s), pass@4 100 %. **Effet plafond** : jeu v1 trop facile |
| 4 | Baselines explication | ✅ Fait (à relancer en `-v2`) | Re-noté : 0,6B 69–82 %, 1,7B 88–95 % selon le niveau |
| 4 | Données du LoRA | ✅ Fait | `data/sft/code_7b_raw.jsonl` : 7 978 exemples |
| 4 | QLoRA 7B de nuit | 🔄 En cours | Essai 4.6 a), puis lancement 4.6 b) |
| 5 | Éval du LoRA, données de distillation, explications FR (Qwen3-8B) | ⏳ À faire | Dimanche matin |
| 6 | Distillations (Math-1,5B et Qwen3-0,6B) | ⏳ À faire | |
| 7 | Pruning, réparation, GGUF Q8_0 / Q4_K_M | ⏳ À faire | |
| 8 | Test de la vraie gateway (+ décodage spéculatif) | ⏳ À faire | |
| 9 | OCR (pix2tex / TexTeller) | ⏳ À faire | Il faut d'abord imprimer et photographier la planche |
| 10 | Rapport et commit | ⏳ À faire | |

### Bugs corrigés pendant l'étape 4 (à garder pour le rapport)

| Bug | Symptôme | Correction |
|---|---|---|
| CUDA hors du PATH (Arch : `/opt/cuda`) | `append_path` introuvable ; FlashInfer : `Could not find nvcc` | Exports CUDA dans `build_llamacpp.sh` et `serve.sh` |
| Extraction du code | 7B à 94 % : il ajoute un bloc « Output » après le programme, et c'est ce bloc qui était exécuté | `extract_code` garde le dernier bloc qui ressemble à un programme, plus un test |
| Filtre d'hallucination trop strict | Les calculs intermédiaires justes du niveau collège étaient rejetés (1,7B : 65 %) | Un nombre issu d'un calcul vérifié par SymPy est accepté (1,7B : 95 %) |
| API transformers 5 | `warmup_ratio` inconnu | `warmup_steps=0.03` (un float < 1 est un ratio) |

Runs MLflow à taguer `invalid` : `baseline-math-7b*` d'avant le correctif, `baseline-qwen3-*` sans `-v2`.

---

## Suite de l'étape 4, à partir de 4.6 b)

### 4.6 b) Lancer le QLoRA de nuit

Prérequis : l'essai 4.6 a) est passé (pas d'OOM, la loss baisse, `gpu_peak_gb` est nettement sous 32 Go), et vLLM est arrêté.

```bash
rm -rf models/test-qlora
nohup .venv/bin/python -m training.llm.sft --base Qwen/Qwen2.5-Math-7B-Instruct \
  --data data/sft/code_7b_raw.jsonl --method qlora --r 16 --epochs 2 \
  --out models/teacher-ft-lora --run-name qlora-7b-r16 > logs_qlora.txt 2>&1 &
```

- `nohup … &` : l'entraînement continue même si tu fermes le terminal.
- La sortie va dans `logs_qlora.txt`.

### 4.6 c) Vérifier que ça tourne (5 min)

```bash
tail -f logs_qlora.txt          # Ctrl-C quitte l'affichage, pas l'entraînement
nvidia-smi                      # un process python, plusieurs Go de VRAM, GPU proche de 100 %
```

Dans MLflow, run `qlora-7b-r16`, onglet **Model metrics** :
- `loss` (train) doit descendre puis se stabiliser ;
- `eval_loss` (toutes les 100 étapes) doit suivre. Si elle remonte alors que la loss de train baisse, c'est du **surapprentissage** ;
- `learning_rate` doit monter pendant le warmup, puis décroître en cosinus.

Durée estimée : 2 à 4 h. La barre de progression de `logs_qlora.txt` affiche le temps restant.

### 4.6 d) Avant d'aller dormir

- [ ] La loss baisse sur les 50 à 100 premières étapes.
- [ ] Pas de `CUDA out of memory` dans `logs_qlora.txt`.
- [ ] Les conteneurs `appwolof` restent arrêtés : ils reprendraient de la VRAM.
- [ ] Commit du code corrigé :
  ```bash
  git add -A && git commit -m "Étape 4 : baselines, correctifs extraction, fidélité, transformers 5"
  ```

### 4.6 e) Le matin, contrôle de fin

```bash
tail -n 5 logs_qlora.txt        # doit finir par « modèle sauvé dans models/teacher-ft-lora »
ls models/teacher-ft-lora       # adapter_model.safetensors, adapter_config.json, lineage.json
```

À relever dans MLflow : la loss finale, l'`eval_loss` finale, `train_runtime_min` et `gpu_peak_gb`.

### En cas de problème

| Symptôme | Action |
|---|---|
| `CUDA out of memory` | Ajouter `--bs 1 --grad-accum 16` (même batch effectif, moins de mémoire) |
| Loss à `nan` | Baisser le learning rate : `--lr 1e-4` |
| Le process a disparu | `tail -n 50 logs_qlora.txt`, puis me coller l'erreur |
| Trop lent (> 6 h prévues) | Arrêter (`pkill -f training.llm.sft`) et relancer avec `--epochs 1` |

### Ensuite : étape 5 (dimanche matin)

Fusionner le LoRA (`merge_lora`), servir `teacher-ft`, puis le comparer à `baseline-math-7b`. Ne t'attends pas à un gain d'exactitude sur la v1 (effet plafond) : regarde plutôt la latence, la longueur des réponses et le taux de code autonome.

Puis générer les données de distillation et les explications françaises avec Qwen3-8B. Le détail est dans `docs/WEEKEND.md`, §5.
