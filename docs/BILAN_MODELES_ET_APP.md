# Bilan : modèles créés et modifiés, app mobile, reste à faire

Document de préparation de la soutenance. Toutes les valeurs viennent des runs MLflow (expérience
`mathapp-weekend`, 43 runs du 3 au 4 octobre 2026), du registry MLflow et de la branche `origin/app-mobile`
(état du 20 octobre 2026). Chaque section renvoie à la phase correspondante du dossier projet.

---

## 1. Ce qu'il faut retenir (une diapo)

- **Règle centrale tenue** : aucun LLM ne donne un résultat. Le code produit par le LLM est exécuté dans un bac
  à sable, la gateway recalcule la solution avec SymPy et compare. L'explication est rédigée à partir d'étapes
  SymPy, puis chaque égalité est revérifiée (sur le serveur et sur le téléphone).
- **5 modèles au registry**, chacun avec sa lignée (modèle parent, hash SHA-256 des données, run d'évaluation) :

| Modèle (registry) | Point de départ | Transformation | Résultat clé | Alias |
|---|---|---|---|---|
| `math-7b-teacher` | Qwen2.5-Math-7B-Instruct | QLoRA r=16 (problème → code SymPy) | 100 % juste, **1,4 s au lieu de 3,5 s**, 82 tokens au lieu de 314 | champion |
| `math-1.5b-distill` | Qwen2.5-Math-1.5B-Instruct | Distillation par séquence depuis `teacher-ft` | 100 % juste, **0,43 s** (8 fois plus rapide que le 7B brut) | champion |
| `explainer-0.6b` | Qwen3-0.6B | Distillation d'explications françaises vérifiées (3 niveaux) | Acceptation au lycée **84 % → 97,2 %** | champion |
| `explainer-0.6b-gguf` | `explainer-0.6b` | GGUF Q4_K_M avec matrice d'importance | 378 Mo, 92 tok/s sur CPU, ≥ 94,4 % aux 3 niveaux | **champion (distribué au téléphone depuis le 4 nov.)** |
| `explainer-0.6b-p20-gguf` | `explainer-0.6b` | Pruning 20 % des couches + LoRA de réparation + GGUF Q4_K_M | 324 Mo, 109 tok/s, mais 82 % au collège | ancien champion (4 oct.) |

- **Chaîne de compression complète sur l'explicateur** : 1 148 Mo (bf16) → 324 Mo (÷ 3,5), avec 2 points
  d'acceptation perdus au lycée par rapport au modèle distillé (97,2 → 95,2 %), et un modèle encore meilleur que la baseline brute.
- **App Android fonctionnelle** (collègue) : photo → OCR embarqué → calcul exact local ou escalade → explication
  rédigée sur le téléphone par notre modèle prunée Q4 → graphe interactif. Branche pas encore fusionnée.
- **Décision corrigée** : réévaluée sur les trois niveaux à la température réelle, la version prunée tombe à
  82 % au collège, contre 94,8 % pour la non prunée. La non prunée a été promue le 4 novembre (section 4.5).
- **OCR : pix2tex remplacé par pix2text-mfr.** Sur 300 images synthétiques « façon photo », pix2tex (dans l'app)
  ne lit juste que 17 % des formules. pix2text-mfr (MIT, ONNX, même moteur que l'app) en lit 95,7 %, sa version 1.5
  100 % des limites, sur CPU en ~0,2 s. Quand les deux lisent la même formule (87 % des cas), elle est juste 261 fois sur 262.

---

## 2. Socle : environnement, données, banc d'évaluation (phases 0, 1, 2)

### 2.1 Environnement validé sur la RTX 5090 (run `env-check`)

| Outil | Version | Test | Mesure |
|---|---|---|---|
| PyTorch | 2.13.0+cu132 (CUDA 13.2, capability 12.0) | matmul bf16 | 156,6 TFLOPS |
| bitsandbytes | 0.50.2 | forward NF4, `PagedAdamW8bit` | OK |
| vLLM | 0.30.0 | Qwen2.5-0.5B | 34 286 tok/s (chargement 86 s) |
| llama.cpp | build CUDA sm_120 | prompt / génération | 46 398 / 1 062 tok/s |

Coche le point « Compatibilité PyTorch, vLLM, bitsandbytes, llama.cpp avec la 5090 » du dossier.

### 2.2 Infra de suivi

`docker compose` : MLflow (backend Postgres, artefacts sur MinIO). Chaque script appelle `common/tracking.py` :
un run par étape, tags `stage` (data, train, prune, quantize, eval, register), `parent`, hash des données.

### 2.3 Données générées (toutes vérifiées par SymPy)

| Run | Contenu | Volume | Contrôles |
|---|---|---|---|
| `data-eval` | Jeu d'évaluation figé v1 : 5 types (dérivée, équation, intégrale, limite, système) × 50, 3 difficultés | 250 problèmes | 0 doublon, 0 étape fausse, 0 code de référence faux |
| `data-train` | Pool d'entraînement disjoint | 15 000 problèmes | 0 fuite avec l'éval (`leak_with_eval = 0`) |
| `gen-code-qwen-math-7b` | 4 000 problèmes × 8 échantillons du 7B brut (T=0,8), 2 gardés par problème | **7 978 paires** problème → code | 98,6 % des échantillons justes, filtrés par exécution |
| `gen-code-teacher-ft` | 6 000 problèmes × 4 échantillons de `teacher-ft` | **11 793 paires** | 99,97 % justes |
| `gen-explain-qwen3-8b` | 3 000 problèmes × 2 échantillons × 3 niveaux par Qwen3-8B | **8 567 explications** (2 774 / 2 810 / 2 983) | 95,2 % acceptées : chaque égalité vérifiée et aucun nombre inventé |
| `training/ocr/make_synthetic.py` | Images de formules rendues (polices CM, STIX…) | 301 images | Pas encore de run MLflow |

### 2.4 Module `eval/` (un seul banc pour tous les modèles)

- **Code** : exactitude d'exécution, taux d'exécution, code autonome, pass@k, détail par type et par difficulté,
  latence p50 / p95, débit, tokens.
- **Explication** : fidélité (égalités vérifiées), hallucination (nombres absents des étapes), taux
  d'acceptation (les deux à la fois), présence de la réponse finale, par niveau et par type.
- Tests CI avec un « oracle » factice (`ci-oracle-code`, `ci-oracle-explain`) : 100 % attendu, ce qui valide le
  banc lui-même.

---

## 3. Baselines (phase 2) : les modèles bruts

### 3.1 Code (problème → programme SymPy), jeu figé de 250 problèmes, greedy

| Modèle | Exactitude | Latence p50 | Tokens générés |
|---|---|---|---|
| Qwen2.5-Math-1.5B-Instruct | 98,0 % (100 % au second passage) | 1,23 s | 297 |
| Qwen2.5-Math-7B-Instruct | 99,6 % | 3,49 s | 314 |
| Qwen2.5-Math-7B, 4 échantillons à T=0,7 | pass@1 98,8 %, **pass@4 100 %** | 7,45 s | 308 |

**Effet plafond** : le jeu v1 est trop facile, tous les modèles sont entre 98 et 100 %. Les gains se lisent donc
sur la **latence et la longueur des réponses**, pas sur l'exactitude. Les deux passages greedy du 1,5B
(98 % puis 100 %) montrent un bruit de ±2 points sur 250 problèmes : à dire en soutenance.

### 3.2 Explication en français (étapes SymPy → texte), acceptation par niveau

| Modèle | Collège | Lycée | Supérieur | Fidélité lycée | Latence p50 |
|---|---|---|---|---|---|
| Qwen3-0.6B | 75,6 % | 84,0 % | 68,4 % | 96,2 % | 0,29 s |
| Qwen3-1.7B | 95,6 % | 89,2 % | 86,4 % | 97,3 % | 0,89 s |
| Qwen3-8B (enseignant) | 88,4 % | 90,0 % | 98,8 % | 97,8 % | 3,98 s |

Le 0,6B brut échoue surtout sur les limites au collège (8 % accepté) et les systèmes. C'est la réponse au point
du dossier « qualité du français de Qwen3-0.6B face à Qwen3-1.7B » : brut, le 1,7B est meilleur ; distillé, le
0,6B le dépasse (section 4.3).

---

## 4. Chaîne d'optimisation (phase 3) : modèle par modèle

### 4.1 `teacher-ft` : QLoRA du Qwen2.5-Math-7B (phase 3B, étape 1)

| Paramètre | Valeur |
|---|---|
| Quantization du modèle de base | NF4, double quantization, calcul en bf16 |
| LoRA | r = 16, sur `code_7b_raw.jsonl` (7 978 paires filtrées par exécution) |
| Entraînement | 2 époques, lr 2e-4 cosine, batch 8 × 2 (accumulation), `paged_adamw_8bit`, gradient checkpointing |
| Coût | **67 min, 10,9 Go de VRAM en pic** |
| Pertes | train 0,041, eval 0,042, précision token 98,3 % |
| Adaptateur | 88 Mo (registry `math-7b-teacher` v1) |

| Mesure | 7B brut | teacher-ft | Gain |
|---|---|---|---|
| Exactitude greedy | 99,6 % | 100 % | +0,4 pt |
| pass@1 / pass@4 (T=0,7) | 98,8 / 100 % | 100 / 100 % | |
| Latence p50 | 3,49 s | 1,40 s | **÷ 2,5** |
| Tokens générés | 314 | 82 | **− 74 %** |

**Message** : le LoRA n'apprend presque rien sur la justesse (déjà au plafond), mais il apprend le **format** :
du code direct sans prose autour. La latence et le coût GPU baissent d'autant.

### 4.2 `math-1.5b-distill` : distillation par séquence (phase 3B, étape 3)

- Données : 11 793 codes de `teacher-ft`, gardés seulement s'ils donnent le bon résultat.
- Fine-tuning complet du 1,5B : 2 époques, lr 1e-5, **9,9 min, 13,2 Go**.

| Mesure | 1,5B brut | 1,5B distillé | 7B brut |
|---|---|---|---|
| Exactitude | 98 % | **100 %** | 99,6 % |
| Latence p50 | 1,23 s | **0,43 s** | 3,49 s |
| Tokens | 297 | 85 | 314 |

Deux usages prévus par le dossier : LLM de maths local de l'app de bureau, et modèle brouillon pour le décodage
spéculatif du 7B (non testé, étape 8.5).

### 4.3 `explainer-0.6b` : distillation d'explications françaises (phase 3C, étape 1)

- Données : 8 567 explications de Qwen3-8B en 3 niveaux, double filtre (égalités vérifiées et aucun nombre
  inventé, un nombre issu d'un calcul vérifié par SymPy étant accepté).
- Fine-tuning complet de Qwen3-0.6B : 2 époques, lr 2e-5, **14,7 min, 6,4 Go**.

| Mesure | 0,6B brut | 0,6B distillé | Qwen3-8B (enseignant brut) |
|---|---|---|---|
| Acceptation collège / lycée / supérieur | 75,6 / 84,0 / 68,4 % | **98,0 / 97,2 / 99,6 %** | 88,4 / 90,0 / 98,8 % |
| Fidélité collège / lycée / supérieur | 81,3 / 96,2 / 70,6 % | 99,3 / 99,4 / 100 % | 96,3 / 97,8 / 99,5 % |
| Hallucinations | 0,03 à 0,14 % | 0 % | 0 à 0,05 % |
| Latence p50 | 0,29 s | 0,75 s | 3,98 s |
| Tokens | 68 | 157 | 160 |

**Message fort** : l'élève de 0,6B dépasse son enseignant de 8B, parce qu'il n'apprend que les sorties
filtrées de l'enseignant (*rejection sampling*). Il est aussi plus long et plus complet que le 0,6B brut, qui
répondait trop court (68 tokens) et oubliait souvent la réponse finale.

### 4.4 Pruning 20 % + LoRA de réparation (phase 3C, étapes 2 et 4)

**Pruning (run `prune-qwen3-0.6b-pruned20`)** : méthode ShortGPT, *Block Influence* calculée sur 256 exemples de
calibration. 28 → 22 couches, couches retirées : **11, 12, 13, 14, 15 et 25**. 596 M → 502 M paramètres.

**Réparation (run `repair-pruned20`)** : LoRA r = 32, 1 époque sur les mêmes explications, lr 2e-4,
**6,7 min, 3,1 Go**, puis fusion.

| Étape | Params | Acceptation collège / lycée / supérieur | Fidélité lycée | Latence p50 | Tokens |
|---|---|---|---|---|---|
| Distillé | 596 M | 98,0 / 97,2 / 99,6 % | 99,4 % | 0,75 s | 157 |
| Pruné, avant réparation | 502 M | 26,4 / 17,6 / 32,0 % | 44,5 % | 4,98 s | 642 |
| Pruné et réparé | 502 M | 93,6 / 96,4 / 98,8 % | 99,2 % | 0,61 s | 159 |

**Messages** :
- Juste après le pruning, le modèle s'effondre : il boucle (642 tokens en moyenne, 4 fois plus) et n'est plus
  accepté qu'une fois sur six au lycée. 7 minutes de LoRA suffisent à le réparer.
- Le niveau collège souffre le plus (− 4,4 points).
- 21 % des couches retirées ne donnent que 16 % de paramètres en moins : la matrice d'embeddings (vocabulaire de
  ~152 000 tokens × 1 024) pèse environ un quart du modèle et n'est pas touchée. C'est l'argument pour le
  pruning du vocabulaire prévu au dossier (non fait).

### 4.5 Quantization GGUF (phase 3C, étape 5 ; sujet embarqué niveau 2)

Conversion `convert_hf_to_gguf`, matrice d'importance (`llama-imatrix`) calculée sur des explications
françaises, puis `llama-quantize`. Débits mesurés sur le CPU du PC, 4 threads (le téléphone reste à mesurer).

| Format | Taille non prunée | Taille prunée | Génération non prunée | Génération prunée | Prompt prunée |
|---|---|---|---|---|---|
| F16 | 1 143 Mo | 963 Mo | 38 tok/s | 44 tok/s | 4 152 tok/s |
| Q8_0 | 610 Mo | 514 Mo | 52 tok/s | 61 tok/s | 6 030 tok/s |
| **Q4_K_M** | 378 Mo | **324 Mo** | 92 tok/s | **109 tok/s** | 8 171 tok/s |

Qualité des Q4_K_M sur le jeu figé (lycée, servis par llama.cpp, greedy) :

| Modèle | Acceptation lycée | Fidélité | Latence p50 (CPU, 4 requêtes en parallèle) |
|---|---|---|---|
| Q4_K_M prunée | 95,2 % | 99,4 % | 6,0 s |
| Q4_K_M non prunée (2 runs) | 94,8 et 95,6 % | 99,6 % | 7,0 à 7,4 s |

**Décision du 4 octobre** : au lycée, la version prunée Q4_K_M perd moins d'un point face à la non prunée, mais
pèse 14 % de moins et génère 19 % plus vite. Elle reçoit l'alias `champion` et c'est elle que l'app embarque.

**Remise en cause le 4 novembre** : évaluées sur les trois niveaux et à T = 0,3 (la température réelle du
téléphone et de la gateway), les deux versions ne se valent plus :

| GGUF Q4_K_M | T | Collège | Lycée | Supérieur |
|---|---|---|---|---|
| Prunée (champion) | 0,3 | **82,0 %** | 92,4 % | 98,0 % |
| Prunée | 0 | 84,4 % | 93,2 % | 99,2 % |
| Non prunée | 0,3 | **94,8 %** | 94,4 % | 98,8 % |
| Non prunée | 0 | 94,8 % | 95,6 % | 98,8 % |

Le pruning et la quantization se cumulent au collège : − 12,8 points. Le choix initial reposait sur un seul
niveau, où l'écart était dans le bruit de mesure (± 2 points entre deux runs identiques). **Leçon pour la
soutenance** : une règle de promotion doit porter sur le pire cas (le minimum sur les niveaux), et l'évaluation
doit se faire dans les conditions réelles d'inférence. **La non prunée a été promue** (`champion`, + 54 Mo) : il
a suffi de déplacer l'alias dans le registry, et la gateway la distribue aux téléphones sans nouvelle version de
l'app.

### 4.6 Courbe à montrer en soutenance (explicateur, lycée)

```
                    taille      acceptation lycée
brut bf16          1 148 Mo        84,0 %
distillé bf16      1 148 Mo        97,2 %   ← distillation : + 13 pts
pruné (sans LoRA)  ~1 000 Mo        17,6 %   ← le pruning casse
pruné + réparé     ~1 000 Mo        96,4 %   ← la LoRA répare
pruné Q4_K_M          324 Mo        95,2 %   ← quantization : ÷ 3 en taille, − 1 pt (greedy)
                                   92,4 %   ← à T = 0,3 ; collège : 82,0 %
```

### 4.7 Bugs trouvés et corrigés grâce au banc (bons exemples pour la soutenance)

| Bug | Comment on l'a vu | Correction |
|---|---|---|
| Extraction du code | Le 7B tombait à 94 % : il ajoute un bloc « Output » après son programme, et c'est ce bloc qui était exécuté | `extract_code` garde le dernier bloc qui ressemble à un programme, plus un test |
| Filtre d'hallucination trop strict | Les calculs intermédiaires justes du collège étaient rejetés (1,7B à 65 %) | Un nombre issu d'un calcul vérifié par SymPy est accepté (1,7B : 95 %) ; les baselines ont été re-notées |
| transformers 5 → llama.cpp | Conversion GGUF impossible (`extra_special_tokens` en liste) | `to_gguf.sh` convertit depuis une copie du tokenizer réécrite au format v4 |
| MLflow + MinIO | Upload > 500 Mo en échec (URL présignées vers `minio:9000`) | Multipart désactivé dans `common/config.py` |
| CUDA sur Arch | `nvcc` introuvable pour FlashInfer et llama.cpp | Chemins CUDA ajoutés dans les scripts |

---

### 4.8 OCR : quel modèle sur le téléphone ? (phase 2, étape 9)

300 images synthétiques (formules rendues en plusieurs polices, puis perspective, flou, bruit, ombres), même mise en
forme canonique pour tous les modèles (`serving/ocr/text.py`, aussi utilisée par le service OCR du serveur) :

| Modèle | Licence | Rôle | Équivalence | Équations | Dérivées | Intégrales | Limites | p50 |
|---|---|---|---|---|---|---|---|---|
| pix2tex, 25 M | MIT | dans l'app aujourd'hui | 17,3 % | 26,0 % | 3,8 % | 18,3 % | 22,7 % | 350 ms (CPU) |
| PP-FormulaNet+-S | Apache-2.0 | candidat | 21,7 % | 26,0 % | 21,5 % | 13,4 % | 27,3 % | 211 ms (CPU) |
| PP-FormulaNet-S | Apache-2.0 | candidat | 29,0 % | 38,4 % | 22,8 % | 19,5 % | 37,9 % | 190 ms (CPU) |
| **pix2text-mfr** | MIT | **téléphone** | **95,7 %** | 100 % | 97,5 % | 87,8 % | 98,5 % | 197 ms (CPU, ONNX 4 fils) |
| **pix2text-mfr 1.5** | MIT | **téléphone** | 89,7 % | 98,6 % | 89,9 % | 73,2 % | **100 %** | 224 ms (CPU, ONNX 4 fils) |
| TexTeller | Apache-2.0 | serveur | 89,3 % | 94,5 % | 83,5 % | 87,8 % | 92,4 % | 155 ms (GPU) |

Écartés sans mesure : Texo (licence AGPL, incompatible avec l'app), UniMERNet-tiny (441 Mo).

**Vote à deux lecteurs.** Les deux pix2text-mfr lisent la même formule sur 262 images sur 300, et elle est alors
juste 261 fois. Sur les limites : accord 65 fois sur 66, toujours juste. En cas de désaccord, l'app demande au
serveur (TexTeller) ou à l'utilisateur. Au moins l'un des deux a raison sur 295 images sur 300.

**Ce que le banc a appris.** Les modèles écrivent la même formule de façons différentes : `\operatorname*{l i m}`,
`\underset{x\to 0}{\lim}`, `\mathrm{s i n}` (pix2text-mfr), formule encadrée par `\boxed{…}` ou un tableau d'une
case (TexTeller). Sans mise en forme commune, pix2text-mfr était à 0 % sur les limites et TexTeller à 70 % : on
aurait écarté le meilleur modèle pour une question d'écriture. Les runs d'avant sont tagués `invalid`.

**Quantization des lecteurs embarqués (sujet embarqué niveau 2).** Fichiers réellement embarqués, lus par
`serving/ocr/trocr_onnx.py` (référence du JavaScript de l'app), CPU 4 fils :

| Lecteur | Précision | Taille | Équivalence | Limites | Intégrales | p50 |
|---|---|---|---|---|---|---|
| pix2text-mfr | FP32 | 117,6 Mo | 95,3 % | 98,5 % | 86,6 % | 188 ms |
| pix2text-mfr | FP16 | 59,2 Mo | 95,3 % | 98,5 % | 86,6 % | 205 ms |
| pix2text-mfr | **INT8 dynamique (déployé)** | **32,0 Mo** | **95,7 %** | 100 % | 87,8 % | **85 ms** |
| pix2text-mfr 1.5 | FP32 | 119,5 Mo | 89,7 % | 100 % | 72,0 % | 211 ms |
| pix2text-mfr 1.5 | FP16 | 60,3 Mo | 89,7 % | 100 % | 72,0 % | 247 ms |
| pix2text-mfr 1.5 | **INT8 dynamique (déployé)** | **32,5 Mo** | 87,7 % | 98,5 % | 68,3 % | **99 ms** |

INT8 : taille ÷ 3,7, temps ÷ 2,2, sans perte pour la v1 (−2 points pour la 1.5). FP16 n'apporte rien sur CPU
(pas de calcul float16 natif) et ne tourne pas en WASM : écarté. Runs MLflow `role = quantization`.

**Dans l'app (4 novembre).** pix2tex remplacé par les deux lecteurs INT8 (65 Mo dans l'APK). Vote : les deux
lectures sont comparées à l'écriture près (`ocrKey` : sans espaces, `\left`/`\right` ni accolades de
regroupement). Banc : accord sur 267 images sur 300, toutes justes ; en cas de désaccord, relecture serveur
(TexTeller) ou choix de l'utilisateur, les deux lectures affichées. JavaScript validé contre Python dans
Chromium (`npm run harness`) : 22 lectures sur 24 identiques au caractère près, les 2 autres même formule ;
0,6 à 1,1 s par lecteur en WASM sur un fil (PC). Sur les photos de test du collègue, là où pix2tex produisait
du charabia, les deux lecteurs lisent juste.

**Limites du banc.** Les 66 limites ne couvrent que trois familles (fraction rationnelle en x→∞ et en x→a,
sin(kx)/x). Suites, limites à droite, ln, exp, racines restent à ajouter, et les vraies photos à prendre.

## 5. Hygiène MLflow

**Fait le 4 novembre** avec `make mlflow-hygiene APPLY=1` (`scripts/mlflow_hygiene.py`) : runs tagués `invalid`
avec leur raison (rien n'est supprimé), alias rangés, hash des GGUF en tags. Restent à vérifier : `baseline-math-7b`
et `baseline-qwen3-8b-v2`, tagués `invalid` à la main sans raison notée. Détail des problèmes traités :

| Run ou objet | Problème | Action |
|---|---|---|
| `baseline-qwen3-0.6b` et `baseline-qwen3-1.7b` (1er run de chaque) | Notés avec l'ancien filtre d'hallucination | Taguer `invalid` |
| `baseline-math-1.5b-pass4` | Lancé avec n = 1 à T = 0 : c'est un second run greedy, pas un pass@4 | Renommer ou taguer `invalid`, relancer avec `make eval-passk` |
| `baseline-math-7b` | Tagué `invalid`, alors que son 99,6 % est le chiffre cité partout | Vérifier pourquoi ; le relancer si besoin |
| `baseline-qwen3-8b-v2` | Tagué `invalid`, c'est pourtant la seule mesure de l'enseignant | Vérifier, relancer si besoin |
| `qlora-7b-r16` en double | Le callback MLflow de Hugging Face et notre `tracking.py` loggent chacun un run | Garder celui qui porte le tag `parent`, désactiver `report_to=mlflow` ou notre run |
| `register-math-1.5b-distill`, `register-explainer-0.6b` FAILED | Première tentative (upload > 500 Mo) | Supprimer ou taguer `invalid` |
| `explainer-0.6b-p20-gguf` | Porte à la fois `challenger` et `champion` sur la v1 | Retirer `challenger` après la promotion |
| Expérience `Default` | Vide | Rien, ou la supprimer |
| Évals GGUF à T = 0, gateway et téléphone à T = 0,3 | Les chiffres GGUF ne reflètent pas exactement ce que voit l'utilisateur | Fait : relancées à 0,3 sur les 3 niveaux (section 4.5) |

---

## 6. App mobile du collègue (branche `origin/app-mobile`)

Deux commits, 128 fichiers, tout dans `clients/mobile/` : le 8 octobre (première version) et le 20 octobre
(« Finished mobile app »). La branche n'est **pas fusionnée** dans `master`.

### 6.1 Évolution entre les deux versions

| | 8 octobre | 20 octobre (version actuelle) |
|---|---|---|
| OCR | Texo (20 M paramètres, transformers.js) | **pix2tex** (licence MIT) exporté par nos soins en ONNX, poids INT8 |
| Calcul | CortexJS + **Pyodide/SymPy sur le téléphone** | CortexJS seul pour les cas simples, serveur pour le reste |
| Explication | Serveur seulement (`/v1/explain`) | **LLM embarqué : notre `explainer-0.6b-p20` Q4_K_M via `llama.rn`**, serveur en mode léger |
| APK | ~120 Mo d'assets | ~45 Mo d'assets, modèle d'explication téléchargé à part (~340 Mo) |

La seconde version s'aligne sur le dossier : pas de Python sur le téléphone, explication rédigée localement.

### 6.2 Ce que fait l'app aujourd'hui

| Étape | Implémentation | Lien avec notre travail |
|---|---|---|
| Photo | `react-native-vision-camera`, cadre redimensionnable, galerie avec recadrage | La photo ne quitte pas le téléphone, sauf escalade |
| OCR | pix2tex → ONNX (encodeur, décodeur, *resizer*), quantization INT8 dynamique, onnxruntime-web (WASM) dans une WebView. 32 Mo. Prétraitement identique à Pillow, décodage glouton, **score de confiance** | Script `scripts/pix2tex/export_onnx.py`, validé contre PyTorch |
| Cas simples | CortexJS : arithmétique, fractions, puissances, racines, équations du 1er degré. Étapes **au format de notre générateur** | Même format que `datagen` |
| Escalade | `POST /v1/solve` avec les raisons du contrat v1 : `invalid_latex`, `out_of_local_scope`, `ocr_low_confidence` (seuil 0,9 réglable), `user_request` | Notre `serving/gateway/schema.py` |
| Hors ligne | File d'attente, envoi au retour du réseau | |
| Explication | `llama.rn` 0.9.7, contexte 2 048, 4 threads CPU, mmap. Modèle téléchargé, **SHA-256 vérifié**, libéré une minute après le passage en arrière-plan. **Prompt identique à `common/prompts.py`** (un test compare avec la sortie Python) | Notre modèle champion |
| Vérification de l'explication | Portage en TypeScript de `eval/faithfulness.py` : égalités revérifiées, nombres absents signalés | Notre filtre de fidélité |
| Modes | complet / léger, recommandation selon la RAM (léger sous 6 Go) | Dossier |
| Graphe | Interactif, courbes compilées par CortexJS (déplacer, pincer, toucher) | |
| Calculatrice | MathLive (saisie 2D) + clavier maison, aperçu en direct | En plus du dossier |
| Stockage | SQLite (`op-sqlite`) : réglages, historique, file, mesures locales | |
| Écrans | Caméra, Calculatrice, Historique, Solution, Réglages (avec outils de développement) | |
| Tests | Jest (moteur CortexJS, fidélité, prompt, OCR, clavier), bancs navigateur ; `scripts/dev_gateway.py` : gateway SymPy seule, sans GPU | |

### 6.3 Limites relevées dans la branche

- **OCR sur vraies photos très mauvais**, d'après les échantillons du collègue (`samples.json`) :
  - « 3x − 7 = 11 » photographié → lecture fausse, confiance 0,834 (escaladé, correct) ;
  - « 2/3 + 5/6 » photographié → `\frac{2}{3}\underline{F}`, **confiance 0,922 > seuil 0,9** : formule fausse
    **non escaladée** ;
  - même sur des rendus propres, `x` devient souvent `X` ou `\chi`.

  Le score de confiance seul ne suffit pas : il faut calibrer le seuil sur la planche de photos, et surtout
  fine-tuner l'OCR (phase 3A).
- **Pas encore** : YOLO (l'utilisateur cadre lui-même la formule), télémétrie vers la gateway, appairage avec
  l'ordinateur, endpoint `GET /v1/models/android/latest` (l'app l'appelle déjà, la gateway ne l'a pas).
- **Pas de mesure sur le téléphone** dans la branche (RAM, tok/s, latence de l'OCR) : indispensable pour le
  niveau 2 du sujet embarqué.
- ~~Nom `PhotomathClone`~~ : renommé le 4 novembre en `PhotoMaths` (`com.photomaths`, « Photo → Maths »), APK
  recompilé et vérifié.

---

## 7. Où en est-on par rapport aux grilles

| Grille | Exigence | État | Commentaire |
|---|---|---|---|
| MLOps 0 | `docker compose up` lance tout | 🟢 Fait | `make up` : infra, vLLM (7B + LoRA du registry), explicateur GGUF, gateway. `make up-ci` sans GPU |
| MLOps 1 | Déploiement auto sur une VM | 🟡 Écrit | `.github/workflows/deploy.yml` : après une CI verte, le runner de la VM déploie le commit testé, vérifie (santé + résolution) et revient au commit précédent si la vérification échoue. À lancer : `make vm-up` |
| MLOps 1 | Token dans le header | 🟢 Fait | `Authorization: Bearer`, clés par utilisateur et par appareil stockées hachées, révocables |
| MLOps 1 | Suivi d'usage par utilisateur | 🟢 Fait | Table `usage`, `GET /admin/usage`, tableau de bord Grafana provisionné (usage par utilisateur, coût GPU estimé) |
| MLOps 2 | Terraform | 🟡 Écrit | `infra/terraform` (OpenTofu, libvirt/KVM) : VM Ubuntu 24.04, Docker, stack en profil ci, runner GitHub. Validation après installation de libvirt |
| MLOps 2 | Test de charge | 🟢 Fait | Locust par paliers (`make load-test`, runs `load-*` dans MLflow). Deux goulots trouvés et corrigés : bac à sable limité à 2 cœurs, OCR serveur qui bloquait les fils de la gateway. Capacité : 64 utilisateurs simultanés, /v1/solve p95 1,7 s |
| MLOps 2 | Interface utilisateur | 🟢 Fait | App Android du collègue |
| MLOps 2 | Data drift | 🟢 Fait | Evidently (`make drift`) : formules reçues face aux données d'entraînement, et fenêtre courante face à la précédente. Démonstration : trafic normal, aucune dérive ; trafic de limites seulement, 6 colonnes sur 6 en dérive |
| MLOps 2 | MLflow pour versionner et mettre en prod | 🟢 Fait | Tracking, registry, alias, lignée. La stack sert les `champion` du registry, et `GET /v1/models` les distribue aux téléphones avec leur SHA-256 |
| MLOps 3 | Quantization | 🟢 Fait (LLM) | GGUF F16 / Q8_0 / Q4_K_M avec imatrix. AWQ / FP8 du 7B serveur : à faire |
| MLOps 3 | Canary, scaling, Kubernetes | 🔴 À faire | |
| MLOps 3 | Prompt injection | 🟡 Partiel | Bac à sable dans un conteneur dédié (réseau interne seul, lecture seule, sans capability) + AST, liste blanche, rlimits, 9 tests d'attaque ; pas de Prompt Guard / Llama Guard |
| MLOps 3 | Améliorations libres | 🟢 Fait en partie | Distillation, pruning, vérification déterministe des résultats |
| Embarqué 1 | Packager un modèle | 🟢 Fait | OCR ONNX et LLM GGUF dans l'app Android |
| Embarqué 2 | Quantizations comparées + meilleure déployée | 🟡 Presque | LLM : F16 / Q8_0 / Q4_K_M. OCR : FP32 / FP16 / INT8 dynamique comparés, INT8 déployé (section 4.8). Reste : mesures sur le téléphone |

Les éléments de la phase 3 non réalisés : YOLO, toute la chaîne OCR, décodage spéculatif, recherche r = 8 / 32,
pruning du 1,5B, pruning de la largeur et du vocabulaire du 0,6B, AWQ du 7B, DAG Airflow (les étapes sont
aujourd'hui des cibles `make`), versionnement DVC.

---

### 7.1 Test de charge (4 novembre)

Locust (`infra/load/locustfile.py`) : des téléphones simulés, 8 résolutions pour 1 relecture OCR et 1 vérification
de modèle, 1 à 3 s entre deux requêtes. Un run MLflow par palier (`eval/load_test.py`).

| Utilisateurs | Avant correction : req/s, p95 /v1/solve | Après : req/s, p95 /v1/solve |
|---|---|---|
| 16 | 5,2 req/s, 1,6 s | — |
| 32 | 9,1 req/s, 3,1 s | 10,5 req/s, 1,6 s |
| 64 | 5,9 req/s, 13,3 s | **16,6 req/s, 1,7 s** (OCR asynchrone : 2,4 s) |
| 128 | 5,5 req/s, 27,6 s | 22,9 req/s, 3,1 s (3,5 % d'échecs : OCR saturé) |

Goulots, trouvés avec `docker stats` et les étapes mesurées par Prometheus :
1. **Bac à sable** à 215 % de CPU, limité à 2 cœurs (un Python + SymPy par exécution) : passé à 8 (`SANDBOX_CPUS`).
2. **OCR serveur** (TexTeller sur CPU, une photo à la fois, ~1 photo/s) : ses requêtes en attente occupaient les
   fils de la gateway, jusqu'à ralentir `/v1/models` à 3,7 s. Appel rendu asynchrone : les résolutions ne
   l'attendent plus. Reste à multiplier les instances OCR (montée en charge, MLOps 3).
3. Ensuite : le GPU (99 % d'utilisation à 128 utilisateurs).

### 7.2 Détection de dérive (4 novembre)

`eval/drift.py` (Evidently), alimenté par `GET /admin/usage/rows` : la gateway garde pour chaque résolution les
caractéristiques de la formule (longueur, variables, fractions, puissance, fonctions ; `serving/gateway/features.py`),
jamais la formule. Deux comparaisons, un run MLflow et un rapport HTML chacune :

| Scénario | Entrées face à l'entraînement | Production, fenêtre courante face à la précédente |
|---|---|---|
| Trafic normal (jeu d'évaluation) | 0 colonne sur 6 (distances 0,003 à 0,097, seuil 0,1) | — |
| Limites seulement (`LOAD_TYPES=limit`) | **6 sur 6** (type : distance 0,65) | — |
| 128 utilisateurs face à 64 | 0 sur 6 | latence seule (KS p = 8e-8) : juste, la charge a doublé |

Bug du script trouvé en route : avec beaucoup de données, Evidently donne une distance (dérive si grande), pas
une p-value (dérive si petite). Lecture corrigée, run précédent tagué `invalid`.

## 8. Reste à faire, par priorité

**Fait le 4 novembre** : `GET /v1/models/{client}/latest`, hygiène MLflow, évals à la température réelle et
promotion de la non prunée, stack complète en une commande servie depuis le registry, clés hachées et usage
par utilisateur, bac à sable en conteneur isolé, Prometheus et Grafana, CI GitHub Actions (tests et APK),
fusion et renommage de l'app, baselines OCR sur images synthétiques, outil de mesure sur téléphone.

### Priorité 1 : avant la soutenance, pour une démo crédible

1. **Test de bout en bout** : téléphone → `make up` sur le PC, avec une vraie photo.
2. **Mesurer sur le téléphone** avec `eval/device_bench.py` : RAM en pic, tok/s, latences OCR et explication,
   prunée et non prunée, Q4_K_M et Q8_0 (sujet embarqué niveau 2).
3. **Photos de la planche** (50 formules) : `eval/ocr_bench.py` sur photos réelles, calibration du seuil de
   confiance (courbe exactitude / taux d'escalade).
4. **OCR** : ~~deux pix2text-mfr INT8 dans l'app, vote, comparaison FP32 / FP16 / INT8~~ (fait le 4 novembre).
   Reste : élargir les limites du banc (suites, x→0⁺, ln, exp, racines), temps de lecture sur le téléphone.

### Priorité 2 : points de la grille MLOps encore à zéro

5. **Déploiement automatique sur une VM** (niveau 1) : runner GitHub auto-hébergé + `make up`, puis
   **Terraform `libvirt`** (niveau 2). Repli prévu au dossier : Docker sur l'hôte.
6. **Test de charge Locust**, **data drift** (Evidently), DCGM exporter (GPU) dans Grafana.

### Priorité 3 : compléter la chaîne d'optimisation

7. **Jeu d'évaluation v2** plus difficile (500 problèmes, avec les types locaux et des cas durs).
8. **Décodage spéculatif** (7B + 1,5B distillé en brouillon, étape 8.5).
9. Réparation plus longue du modèle pruné (le collège y perd le plus), puis pruning du vocabulaire du 0,6B.
10. AWQ / FP8 du 7B pour le serveur.

### Priorité 4 : si le temps le permet

Canary dans la gateway, guardrails, Airflow, DVC, YOLO, app de bureau, « Vérifier ma copie ».

---

## 9. Proposition de déroulé pour la partie modèles de la présentation

1. **Le problème** : un LLM qui calcule se trompe ; chez nous, il traduit et rédige, SymPy calcule et vérifie.
2. **Le banc avant tout** : jeu figé, métriques objectives, tout dans MLflow (montrer la liste des runs).
3. **Baselines** : tous les modèles de code sont au plafond, donc on optimise la vitesse ; le 0,6B brut est
   faible en explication.
4. **QLoRA du 7B** : même justesse, 2,5 fois plus rapide, parce qu'il apprend le format.
5. **Distillation** : le 1,5B fait 100 % en 0,4 s ; le 0,6B dépasse son enseignant de 8B.
6. **Pruning + réparation** : effondrement à 17,6 %, réparation à 96,4 % en 7 minutes.
7. **Quantization** : courbe de la section 4.6, de 1 148 à 324 Mo pour 2 points perdus.
8. **Registry et lignée** : chaque modèle connaît ses données et son parent ; le champion part sur le téléphone.
9. **Démo app** : photo, calcul local, escalade, explication rédigée hors ligne, graphe.
10. **Limites honnêtes** : effet plafond du jeu v1, OCR non entraîné, mesures sur téléphone à faire, et la
    promotion de la prunée remise en cause par l'éval sur trois niveaux (un bon exemple de MLOps : la mesure
    corrige la décision).
