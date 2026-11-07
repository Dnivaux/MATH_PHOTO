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

### OCR dans l'app : pix2text-mfr v1 + 1.5 INT8 (4 novembre)

- Export : `clients/mobile/scripts/p2t_mfr/export.py` (révisions Hugging Face figées, FP32 / FP16 / INT8, SHA-256
  dans `config.json`, reproductible au bit près). Référence Python : `serving/ocr/trocr_onnx.py`, identique à
  transformers sur 20 images sur 20.
- Quantization (300 images) : v1 INT8 95,7 % pour 32 Mo et 85 ms, contre 95,3 % / 118 Mo / 188 ms en FP32 ;
  1.5 INT8 87,7 % (FP32 89,7 %). FP16 : même précision que FP32, pas plus rapide sur CPU, écarté.
- App : `ocrSource.ts` réécrit (bicubique type Pillow, décodeur sans cache, détokenisation ByteLevel), deux
  lecteurs l'un après l'autre ; `ocrKey` compare les lectures ; désaccord → serveur, sinon les deux lectures
  proposées (« Prendre celle-ci »). `normalizeOcrLatex` reprend les règles de `canonicalize` : les 600 lectures
  justes du banc sont toutes comprises par CortexJS avec le bon type.
- Banc navigateur : `npm run harness` (Chromium sans écran) : 22/24 identiques à Python, 24/24 même formule.
- CI (`apk.yml`) : export INT8 au lieu de pix2tex. APK : 142 Mo.
- À faire : temps de lecture sur le S24 Ultra (deux lecteurs en série, ~1,5 s sur PC).

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

## Outils MLOps (4 novembre, suite)

- **Test de charge** : `make load-test` (Locust par paliers, runs `load-*`). Capacité 64 utilisateurs simultanés
  (16,6 req/s, /v1/solve p95 1,7 s) après deux corrections : bac à sable 2 → 8 cœurs, appel OCR serveur
  asynchrone. Prochain goulot : OCR serveur (TexTeller CPU, ~1 photo/s), puis le GPU.
- **Dérive** : `make drift` (Evidently, runs `drift-entrees` / `drift-production`). Validé : trafic normal sans
  dérive, trafic de limites seulement en dérive sur 6 colonnes sur 6. Nouveau : `GET /admin/usage/rows`,
  caractéristiques de formule dans l'usage, `GATEWAY_ADMIN_TOKEN` dans `.env`.
- **VM + déploiement** : `infra/terraform` (OpenTofu, libvirt) et `.github/workflows/deploy.yml` (runner
  auto-hébergé, vérification, retour arrière). Écrits, pas encore lancés : attend `sudo pacman -S qemu-base libvirt
  dnsmasq opentofu cdrtools`.
- **OCR, captures** : `GATEWAY_OCR_CAPTURE_DIR` (développement) garde les photos relues par le serveur. Les 4
  premières : photos d'écran (moiré) et morceaux de lignes voisines dans le cadre. Pistes : lisser avant lecture,
  effacer ce qui touche le bord, relecture serveur en parallèle du second lecteur.

## OCR : banc de vraies photos et manuscrit (7 novembre)

Objectif : un OCR bien meilleur sur papier, écran et manuscrit, côté téléphone et serveur.

- Les 44 images gardées par le serveur le 4 novembre ne comptent que 4 vraies photos (écran) ; le reste vient du test
  de charge. Erreurs réelles : point de numérotation lu `-` ou `\therefore`, parenthèse effacée par le moiré.
- **Mode collecte** : app → Outils de développement → OCR → Collecte (Papier / Écran / Manuscrit). Chaque scan envoie
  la zone recadrée et les deux lectures du téléphone à `POST /v1/ocr/collect` (seulement si `OCR_CAPTURE_DIR`).
  `make ocr-collect-import` range les scans dans `data/ocr/real/<condition>/` et les rattache à la formule de la
  planche la plus proche (rattachements douteux listés, `checked_by_hand: true` après correction).
- **Manuscrit public** : `scripts/ocr_unimer_subset.py` (UniMER-Test, Apache 2.0) → `data/ocr/unimer/hwe300`,
  300 formules manuscrites du périmètre de l'app.

| Lecteur (hwe300, manuscrit) | Formules justes | Erreur par token |
|---|---|---|
| pix2text-mfr v1 INT8 (téléphone) | 78,0 % | 11,2 % |
| pix2text-mfr 1.5 INT8 (téléphone) | 68,3 % | 19,8 % |
| TexTeller (serveur, GPU) | 98,3 % (possible recouvrement avec son entraînement) | 0,3 % |

Vote du téléphone : accord sur 205 images sur 300, dont 192 justes (contre 100 % sur l'imprimé synthétique).
Chaîne actuelle (accord → téléphone, sinon serveur) : 94,7 % ; hors connexion : 78 %.

## Grilles « embarqué » et « MLOps » : ce qui manquait (7 novembre, soir)

### Embarqué, niveau 2 : quantifié contre non quantifié, mesuré sur la cible (S24 Ultra, Snapdragon 8 Gen 3)

Précision : runs `gguf-*-t03-gpu` (même GGUF, T = 0,3, 3 niveaux). Vitesse et RAM : `make device-llm`
(`eval/device_kernels.py`, llama-bench Android par adb, réglages de l'app : 4 fils, CPU, lots de 256), run
`device-llm-s24-ultra`, détail dans `eval/results/device-llm-s24-ultra.json`. Temps d'une explication estimé pour
un prompt de 250 jetons et 157 jetons générés.

| GGUF | Acceptation collège / lycée / sup. | Fichier | RAM en pic | Prompt | Génération | Explication |
|---|---|---|---|---|---|---|
| Non prunée F16 | 96,4 / 94,4 / 99,2 | 1 192 Mo | 1 228 Mo | 25 tok/s | 14,4 tok/s | ~20,7 s |
| Non prunée Q8_0 | 96,4 / 95,2 / 99,2 | 634 Mo | 1 296 Mo | 437 tok/s | 61,0 tok/s | ~3,1 s |
| **Non prunée Q4_K_M (champion)** | 94,8 / 94,4 / 98,8 | 391 Mo | 835 Mo | 286 tok/s | 65,9 tok/s | ~3,3 s |
| Prunée F16 | 90,8 / 94,0 / 98,0 | 1 003 Mo | 1 041 Mo | 30 tok/s | 16,1 tok/s | ~18,1 s |
| Prunée Q8_0 | 92,0 / 95,2 / 98,4 | 533 Mo | 1 097 Mo | 559 tok/s | 74,5 tok/s | ~2,6 s |
| Prunée Q4_K_M | 82,0 / 92,4 / 98,0 | 333 Mo | 718 Mo | 330 tok/s | 73,1 tok/s | ~2,9 s |

- F16 est inutilisable sur le téléphone (6 à 7 fois plus lent) : la quantization est indispensable, pas un bonus.
- Q8_0 et Q4_K_M ont la même vitesse de bout en bout (noyaux int8 / i8mm de l'ARM pour le prompt) ; Q8_0 gagne
  1,6 pt au collège, mais coûte +243 Mo à télécharger et +460 Mo de RAM (poids réarrangés pour l'ARM).
- La prunée gagne ~10 % de vitesse mais perd jusqu'à 12,8 pts au collège en Q4 : pas rentable.
- **Décision à prendre** : garder Q4_K_M (taille, RAM partagée avec l'OCR et la WebView, téléphones à 8 Go) ou
  promouvoir Q8_0 (meilleure précision au même temps sur un haut de gamme).

OCR (`make device-ocr` : page `clients/mobile/scripts/engine-harness/bench.html` dans Chrome sur le téléphone, même
code onnxruntime-web WASM que la WebView ; 12 images × 3 passes ; run `device-ocr-s24-ultra`) :

| pix2text-mfr | Fichiers | Chargement (2 lecteurs) | Lecture p50 v1 / 1.5 | Les deux lecteurs | PC (Chromium) v1 |
|---|---|---|---|---|---|
| FP32 | 2 × 113 Mo | 8,6 s | 2,55 / 2,84 s | 5,2 s | 1,00 s |
| **INT8** | 2 × 31 Mo | 3,6 s | 2,44 / 2,72 s | 4,9 s | 0,68 s |

Sur le téléphone, l'INT8 ne gagne que 4 % de temps de lecture (32 % sur PC) : WASM sur un seul fil, sans noyau int8
efficace sur ARM. Son gain est la taille (÷ 3,7) et le chargement (÷ 2,4), à précision égale (95,7 % contre 95,3 %).
**Constat** : ~5 s pour les deux lecteurs, l'OCR est le poste le plus lent de l'app. Pistes : cache KV du décodeur
(aujourd'hui une passe complète par jeton), ORT natif (onnxruntime-react-native, XNNPACK) au lieu du WASM, ou un
seul lecteur quand sa confiance est haute.

### MLOps, niveau 1 et 2 : VM créée par OpenTofu, déploiement continu

- `make vm-prepare && make vm-up` : VM Ubuntu 24.04 (8 vCPU, 12 Go) créée par OpenTofu sur libvirt, Docker, dépôt
  cloné, stack en profil `ci`, runner GitHub auto-hébergé (`photo-maths-staging`, en ligne).
- `deploy.yml` (run 42401292218) : commit testé, stack reconstruite, vérification (santé + résolution de
  `-3x²+23x-30=0` → `x ∈ {5/3 ; 6}`) : **succès**. Le retour arrière a aussi été vu en vrai sur les deux échecs
  d'avant.
- Corrections : écran SPICE absent de `qemu-base` (VNC local), pare-feu `ufw` + `FORWARD` de Docker (README),
  `SANDBOX_CPUS=8` > 4 vCPU (VM à 8 vCPU), `data/` créé par Docker en root, `build_sets` sans pandas
  (`--no-mlflow`). Les deux derniers sont dans `deploy.yml` et `cloud-init` : **à pousser** pour que le prochain
  déploiement automatique les prenne.

### MLOps, niveau 1 : test de charge en production (VM de staging)

`LOAD_SKIP=ocr,models make load-test HOST=http://192.168.122.171:8100 ENV=staging USERS="1 4 8 16 32 64"`
(runs `load-staging-*u`). Profil `ci` : faux LLM, donc on mesure la gateway, l'authentification, l'usage en
Postgres et le bac à sable qui exécute et vérifie le code ; OCR serveur et registry absents de la VM.

| Utilisateurs | req/s | Échecs | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 1 | 0,4 | 0 % | 260 ms | 340 ms | 340 ms |
| 8 | 3,0 | 0 % | 260 ms | 330 ms | 410 ms |
| 16 | 5,9 | 0 % | 270 ms | 350 ms | 430 ms |
| 32 | 11,1 | 0 % | 280 ms | 450 ms | 690 ms |
| 64 | 21,1 | 0 % | 450 ms | 1 300 ms | 2 100 ms |

Capacité : au moins 64 utilisateurs simultanés sous le budget (p95 ≤ 5 s), 0 échec sur 2 533 requêtes. La latence
décolle à 64 (bac à sable sur 8 vCPU). Sur le PC avec le vrai 7B : 64 utilisateurs, 16,6 req/s, p95 1,7 s.

## Suite

Relancer : `make up` (tout), ou `make infra-up` seul pour entraîner. Gateway sur :8100, jeton `dev-token`.

### Priorité 1 : soutenance
1. Présentation : les deux grilles critère par critère (section « Grilles » ci-dessus, `docs/BILAN_MODELES_ET_APP.md`).
2. Décider du champion de l'explicateur : Q4_K_M (actuel) ou Q8_0 (voir le tableau mesuré sur le S24 Ultra).
3. Pousser `deploy.yml` / `cloud-init` corrigés, puis vérifier que le déploiement automatique part seul après la CI.

### Priorité 2 (si le temps le permet)
- OCR sur le téléphone : cache KV du décodeur ou ORT natif (~5 s aujourd'hui pour les deux lecteurs).
- Photos de la planche (`data/ocr/real/planche_a_imprimer.pdf`) → `eval/ocr_bench.py`, calibration du seuil de confiance.
- Canary de `math-1.5b-distill` derrière la gateway (grille MLOps 3), DCGM exporter pour le GPU dans Grafana.

### Priorité 3
- OCR phase 3A, jeu d'évaluation v2 plus dur, décodage spéculatif (8.5), pruning du vocabulaire, AWQ / FP8.
- Baselines explication en `-v2` (5.7). `logs_distill.txt` : le commiter comme `logs_qlora.txt`.
