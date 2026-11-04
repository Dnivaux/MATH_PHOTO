# Suivi du projet

Runbook du week-end 1 : `docs/WEEKEND.md`. Bilan pour la soutenance : `docs/BILAN_MODELES_ET_APP.md`.
Ce fichier donne l'avancement et la suite immédiate.

## Avancement des étapes

| # | Étape | État | Résultat / remarque |
|---|---|---|---|
| 1 | Environnement (CUDA, venv, llama.cpp, env-check) | ✅ Fait | env-check OK : bf16 156 TFLOPS, vLLM 34 k tok/s, llama.cpp CUDA 1 060 tok/s |
| 2 | Contrat d'API avec le collègue | ✅ Fait | L'app (`origin/app-mobile`) suit le contrat v1 : escalade, modes complet / léger, `/v1/models` |
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
| 7 | Livraison au collègue (7.7) | ✅ Prêt | GGUF prunée Q4_K_M + non prunée, prompt `common/prompts.py`. Registry : `explainer-0.6b-p20-gguf` v1 @champion |
| 8 | Vraie gateway (8.1 – 8.3) | ✅ Fait | teacher-ft sur vLLM :8000, gateway :8100, `/v1/solve` testé avec curl |
| 8 | Explication côté serveur (8.4, option) | ✅ Fait (compose) | Service `explainer` (llama.cpp, GGUF champion) dans `make up` |
| 8 | Décodage spéculatif (8.5) | ⏳ À faire | |
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

**Complément du 4 novembre : GGUF évalués sur les 3 niveaux.** Les runs du 4 octobre étaient au lycée seul et en
greedy, alors que le téléphone et la gateway échantillonnent à T = 0,3.

| GGUF Q4_K_M | T | Acceptation collège / lycée / supérieur | Fidélité collège | Run |
|---|---|---|---|---|
| Prunée (champion actuel) | 0,3 | **82,0** / 92,4 / 98,0 | 95,6 % | `gguf-p20-q4km-t03` (CPU, p50 4,1 s) |
| Prunée | 0 | 84,4 / 93,2 / 99,2 | 95,8 % | `gguf-p20-q4km-t0-gpu` |
| Non prunée | 0,3 | **94,8** / 94,4 / 98,8 | 99,4 % | `gguf-q4km-t03-gpu` |
| Non prunée | 0 | 94,8 / 95,6 / 98,8 | 99,0 % | `gguf-q4km-t0-gpu` |

Pruning et quantization se cumulent au collège (− 12,8 pts contre la non prunée). La promotion de la prunée
reposait sur le lycée seul, où l'écart est dans le bruit (± 2 pts entre deux runs identiques). **Proposition :
promouvoir `explainer-0.6b-gguf` v1 en champion** (+ 54 Mo, ~16 % de tok/s en moins). Règle de promotion à
écrire : le minimum sur les trois niveaux, pas le lycée seul.

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
- Le niveau collège souffre le plus du pruning (−4,4 pts), et bien plus une fois quantifié (voir ci-dessus).
- Le format `$$...$$` apparaît dans des explications : vérifier le rendu dans l'app.

### Hygiène MLflow : faite le 4 novembre

`make mlflow-hygiene APPLY=1` (`scripts/mlflow_hygiene.py`, idempotent, rien n'est supprimé) : 6 runs tagués
`invalid` avec un tag `invalid_reason` (anciennes baselines, faux pass@4, enregistrements FAILED, doublon du
QLoRA), alias `challenger` retiré de `explainer-0.6b-p20-gguf`, SHA-256 et taille posés en tags des GGUF.
Restent tagués `invalid` à la main, sans raison notée : `baseline-math-7b` et `baseline-qwen3-8b-v2` (à vérifier).

---

## Session du 4 novembre

| Sujet | État | Détail |
|---|---|---|
| Bilan pour la soutenance | ✅ | `docs/BILAN_MODELES_ET_APP.md` |
| `GET /v1/models/{client}/latest` | ✅ | Manifeste du `champion` (URL, SHA-256, taille), fichier servi par la gateway (`Range` OK). Hash identique à celui attendu par l'app. Gateway réelle et factice |
| Stack en une commande (niveau 0) | ✅ | `make up` : `model-fetch` récupère les champions du registry, vLLM v0.30.0 sert le 7B + LoRA `teacher-ft`, llama.cpp sert l'explicateur, gateway. `make up-ci` : faux LLM, sans GPU |
| teacher-ft servi par la stack | ✅ | `teacher-ft-compose-lora` : 100 %, 1,51 s (fusionné : 1,40 s ; surcoût du LoRA ≈ 8 %) |
| Clés hachées + usage par utilisateur (niveau 1) | ✅ | `serving/gateway/usage.py`, `/admin` (jeton `GATEWAY_ADMIN_TOKEN`), Postgres en conteneur, SQLite en local |
| CI GitHub Actions | ✅ écrite | `.github/workflows/ci.yml` : ruff + pytest, image de la gateway + test de fumée, app mobile (tsc, 95 tests Jest, ESLint), vérifiés en local |
| Mesures téléphone → MLflow | ✅ outil | `eval/device_bench.py` (export de l'app + RAM par `adb`) ; reste à faire les mesures |
| Température de l'explicateur | ✅ | Évals refaites à T = 0,3 (celle du téléphone) : voir le complément ci-dessus |

Limite découverte : dans le conteneur de la gateway, `unshare -rn` est refusé, donc le code exécuté n'a pas de
coupure réseau (AST, liste blanche d'imports et rlimits restent actifs). Parade : conteneur de bac à sable dédié
avec `network_mode: none` (phase 5).

---

## Session du 4 novembre (suite, après la fusion de `app-mobile`)

| Sujet | État | Détail |
|---|---|---|
| Champion de l'explicateur | ✅ | `explainer-0.6b-gguf` v1 (non prunée) promue ; `EXPLAINER_REGISTRY` dans `.env`. `/v1/models` distribue `7b5772d7…` |
| Renommage de l'app | ✅ | `PhotomathClone` → `PhotoMaths`, paquet `com.photomaths`, nom affiché « Photo → Maths ». APK compilé en local (121 Mo, `aapt` vérifié), 95 tests Jest |
| CI de l'APK | ✅ écrite | `.github/workflows/apk.yml` : à la main ou sur un tag `v*` (release GitHub). Signé avec la clé de debug |
| Bac à sable en conteneur dédié | ✅ | Service `sandbox` : réseau interne seulement (Internet, Postgres, MLflow injoignables, vérifié), lecture seule, `cap_drop: ALL`, `pids_limit`, 3 Go. AST refaite côté gateway |
| Monitoring | ✅ | `GET /metrics`, Prometheus :9090, Grafana :3000 provisionné : trafic, latence p95 par étape, raisons d'escalade, usage par utilisateur (SQL), coût GPU estimé, vLLM. 12 panneaux vérifiés par l'API |
| Compose | ✅ | Une gateway par profil (`gateway` / `gateway-ci`) : le profil `ci` ne relance plus vLLM |
| Baselines OCR (synthétique, 300 images) | ✅ | Voir ci-dessous |

### OCR : comparaison de modèles (étape 9, images synthétiques « façon photo », 300 images)

Même mise en forme canonique pour tous (`serving/ocr/text.py`). Runs du 4 novembre, après correction :

| Modèle | Équivalence | Limites | Erreur par token | p50 | Run |
|---|---|---|---|---|---|
| pix2tex (dans l'app) | 17,3 % | 22,7 % | 188 % | 350 ms (CPU) | `db7d5eff` |
| PP-FormulaNet+-S | 21,7 % | 27,3 % | 222 % | 211 ms (CPU) | `e340dcf0` |
| PP-FormulaNet-S | 29,0 % | 37,9 % | — | 190 ms (CPU) | `7aebb472` |
| **pix2text-mfr** | **95,7 %** | 98,5 % | 4,9 % | 197 ms (CPU) | `c67f7b53` |
| **pix2text-mfr 1.5** | 89,7 % | **100 %** | 6,3 % | 224 ms (CPU) | `c3477b77` |
| TexTeller (serveur) | 89,3 % | 92,4 % | 32 % | 155 ms (GPU) | `8c2c2bb1` |

Vote des deux pix2text-mfr : accord sur 262 images sur 300, dont 261 justes ; limites : 65 accords sur 66, tous justes.
Décision : pix2text-mfr v1 + 1.5 sur le téléphone, désaccord → TexTeller (serveur) ou choix de l'utilisateur.

Bugs du banc corrigés : délimiteurs `\[ \]` de TexTeller ; écritures équivalentes (`\operatorname*{l i m}`,
`\underset{…}{\lim}`, `\mathrm{s i n}`, `\boxed{…}`, tableau d'une case, `=` parasite en tête) comptées comme fausses.
Tous les runs d'avant sont tagués `invalid`. Tests : `tests/test_ocr_bench.py`.

Limite : 3 familles de limites seulement dans le banc ; vraies photos pas encore prises.

---

## Premier test sur téléphone (S24 Ultra, 4 novembre)

| Constat | Correction |
|---|---|
| L'aperçu caméra continue de bouger pendant la lecture | La photo prise reste affichée (caméra en pause) tant que la formule lue est à l'écran ; le déclencheur relance l'aperçu |
| Formule quadratique lue en charabia par pix2tex (`\begin{array}… \hat{U}…`), le serveur ne reçoit que ce LaTeX | **OCR serveur** : service `ocr` (TexTeller, CPU, ~0,7 s), branché dans la gateway (`OCR_URL`). Quand l'app escalade pour `ocr_low_confidence`, `invalid_latex` ou `user_request`, elle envoie aussi la zone recadrée ; la gateway essaie d'abord la relecture serveur, puis la lecture du client. `problem.latex_source = server_ocr` dans la réponse |
| | Test : LaTeX dégénéré + photo de `-3x²+23x-30=0` → relu, résolu et vérifié en 1,9 s. La photo de la capture est relue `x= \frac{-b \pm \sqrt{b^{2}-4ac}}{2a}` (hors périmètre : paramètres a, b, c), et l'app affiche maintenant ce que le serveur a lu |

| Plantage au clic sur « Résoudre » (S24 Ultra, Snapdragon 8 Gen 3) : `UnsatisfiedLinkError: libcdsprpc.so` | `llama.rn` charge sa variante Hexagon / OpenCL sur Snapdragon 8 Gen 1+, qui exige `<uses-native-library>` pour `libcdsprpc.so` et `libOpenCL.so` dans le manifeste (`required="false"`). Invisible sur un téléphone sans Snapdragon |

| pix2tex affiche du charabia (`\mathfrak{c}_{*}…`) : incompréhensible pour un utilisateur | **Relecture serveur dès le scan** : `POST /v1/ocr` (TexTeller). Si la lecture du téléphone est douteuse (confiance < seuil, `looksGarbled`, ou formule illisible pour CortexJS), la carte affiche « le serveur relit la photo… » puis la formule de TexTeller, marquée « Lue par le serveur ». Hors connexion, une lecture absurde n'est jamais montrée : « Formule illisible », avec « Saisir la formule » / « Reprendre ». `looksGarbled` testé sur les vraies sorties des essais |

La photo ne quitte le téléphone que dans ces cas d'escalade, et n'est gardée qu'en mémoire.

---

## Suite

Relancer : `make up` (tout), ou `make infra-up` seul pour entraîner. Gateway sur :8100, jeton `dev-token`.

### Priorité 1
1. Pointer l'app sur la gateway du PC (`make up`, puis `http://<ip-du-PC>:8100` dans Réglages) et tester avec une vraie photo.
2. Mesures sur le téléphone (`eval/device_bench.py`) : non prunée (champion) et prunée, Q4_K_M et Q8_0.
3. Photos de la planche (`data/ocr/real/planche_a_imprimer.pdf`, 50 formules) → `eval/ocr_bench.py` sur `data/ocr/real`,
   calibration du seuil de confiance (0,9 laisse passer des lectures fausses).
4. OCR : pix2text-mfr v1 + 1.5 dans l'app (export INT8, décodeur TrOCR dans `ocrSource.ts`, même mise en forme
   que `serving/ocr/text.py` côté TypeScript, vote). Élargir le générateur de limites (suites, x→0⁺, ln, exp, racines).

### Priorité 2 (grille MLOps)
- Déploiement automatique sur une VM (runner auto-hébergé + `make up`), puis Terraform `libvirt` (demande sudo, IOMMU).
- Test de charge Locust, drift (Evidently), DCGM exporter pour le GPU dans Grafana.

### Priorité 3
- OCR phase 3A, jeu d'évaluation v2 plus dur, décodage spéculatif (8.5), pruning du vocabulaire, AWQ / FP8.
- Baselines explication en `-v2` (5.7). `logs_distill.txt` : le commiter comme `logs_qlora.txt`.
