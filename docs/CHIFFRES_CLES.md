# Chiffres clés du projet Photo → Maths

Une page pour la soutenance, dans l'ordre des slides. Détail et historique : `docs/SUIVI.md` et
`docs/BILAN_MODELES_ET_APP.md`. Sources : MLflow (expérience `mathapp-weekend`, 122 runs au 7 novembre 2026), registry
MLflow, `eval/results/`. Projet commun aux sujets « Embarquer un modèle » et « MLOps ».

## 1. Le projet en trois chiffres

| | |
|---|---|
| Justesse des résultats | **100 %** sur le jeu figé (le LLM écrit du code SymPy, le bac à sable l'exécute, la gateway vérifie) |
| OCR embarqué | **95,7 %** des formules imprimées lues juste (pix2text-mfr INT8) ; quand les 2 lecteurs concordent : 261 justes sur 262 |
| Explication hors ligne | **~3,3 s** sur le S24 Ultra (Qwen3-0,6B distillé, GGUF Q4_K_M, 391 Mo) |

Règle centrale : aucun LLM ne donne un résultat. Il traduit (problème → code) ou rédige (étapes → texte), SymPy calcule
et chaque égalité de l'explication est revérifiée.

## 2. Données et banc d'évaluation

| Élément | Volume |
|---|---|
| Jeu d'évaluation figé v1 | 250 problèmes (5 types × 50, 3 difficultés), 0 doublon, 0 étape fausse |
| Pool d'entraînement | 15 000 problèmes, 0 fuite avec l'éval |
| Paires problème → code (7B brut, filtrées par exécution) | 7 978 |
| Paires problème → code (teacher-ft, distillation) | 11 793 (99,97 % justes) |
| Explications françaises vérifiées (Qwen3-8B, 3 niveaux) | 8 567 (95,2 % acceptées) |
| Runs MLflow | 122 ; 5 modèles au registry avec lignée (parent, SHA-256 des données, run d'éval) |
| Tests | 63 pytest + 115 Jest, CI GitHub Actions |

## 3. Modèles serveur : problème → code SymPy

| Modèle | Justesse | Latence p50 | Jetons générés |
|---|---|---|---|
| Qwen2.5-Math-7B brut | 99,6 % | 3,49 s | 314 |
| **teacher-ft** (QLoRA r=16, 67 min, 10,9 Go de VRAM) | **100 %** | **1,40 s** (÷ 2,5) | 82 (− 74 %) |
| Qwen2.5-Math-1,5B brut | 98,0 % | 1,23 s | 297 |
| **math-1.5b-distill** (distillation, 9,9 min) | **100 %** | **0,43 s** (÷ 8 contre le 7B brut) | 85 |

Message : le jeu est au plafond, donc le gain se lit sur la vitesse ; le LoRA apprend le format (du code sans prose).

## 4. Explicateur embarqué : chaîne de compression (acceptation au lycée)

| Étape | Taille | Acceptation lycée |
|---|---|---|
| Qwen3-0,6B brut (bf16) | 1 148 Mo | 84,0 % |
| Distillé depuis Qwen3-8B | 1 148 Mo | **97,2 %** (+ 13 pts ; dépasse l'enseignant 8B : 90,0 %) |
| Pruning 20 % des couches (28 → 22) | ~1 000 Mo | 17,6 % (effondrement) |
| + LoRA de réparation (6,7 min) | ~1 000 Mo | 96,4 % |
| GGUF Q4_K_M | 324 – 391 Mo | 92,4 – 95,2 % |

## 5. Embarqué, niveau 2 : quantization mesurée sur la cible (Samsung S24 Ultra, Snapdragon 8 Gen 3)

Précision : runs `gguf-*-t03-gpu` (T = 0,3, 3 niveaux). Vitesse et RAM : `make device-llm`, run `device-llm-s24-ultra`
(llama-bench par adb, réglages de l'app : 4 fils CPU). Explication : prompt de 250 jetons + 157 jetons générés.

| GGUF | Collège / lycée / sup. | Fichier | RAM en pic | Génération | Explication |
|---|---|---|---|---|---|
| Non prunée F16 | 96,4 / 94,4 / 99,2 | 1 192 Mo | 1 228 Mo | 14,4 tok/s | ~20,7 s |
| Non prunée Q8_0 | 96,4 / 95,2 / 99,2 | 634 Mo | 1 296 Mo | 61,0 tok/s | ~3,1 s |
| **Non prunée Q4_K_M (déployée)** | 94,8 / 94,4 / 98,8 | 391 Mo | 835 Mo | 65,9 tok/s | ~3,3 s |
| Prunée F16 | 90,8 / 94,0 / 98,0 | 1 003 Mo | 1 041 Mo | 16,1 tok/s | ~18,1 s |
| Prunée Q8_0 | 92,0 / 95,2 / 98,4 | 533 Mo | 1 097 Mo | 74,5 tok/s | ~2,6 s |
| Prunée Q4_K_M | 82,0 / 92,4 / 98,0 | 333 Mo | 718 Mo | 73,1 tok/s | ~2,9 s |

- Sans quantization, inutilisable : F16 6 à 7 fois plus lent.
- Q4_K_M : taille ÷ 3, RAM − 32 % contre Q8_0, même temps d'explication, − 1,6 pt au collège.
- Pruning : + 10 % de vitesse, mais − 12,8 pts au collège une fois quantifié → écarté (ancienne décision corrigée).

## 6. OCR

Choix du modèle (300 images synthétiques « façon photo », même mise en forme canonique pour tous) :

| Modèle | Formules justes | Rôle |
|---|---|---|
| pix2tex (dans la 1re version de l'app) | 17,3 % | remplacé |
| PP-FormulaNet+-S / PP-FormulaNet-S | 21,7 % / 29,0 % | écartés |
| **pix2text-mfr** | **95,7 %** | téléphone |
| **pix2text-mfr 1.5** | 89,7 % (100 % des limites) | téléphone (2e lecteur, vote) |
| TexTeller | 89,3 % | serveur (désaccord des 2 lecteurs) |

Manuscrit (UniMER, 300 formules) : 78,0 % sur le téléphone, 94,7 % avec la relecture serveur.

Quantization des lecteurs (précision : banc Python ; vitesse : `make device-ocr`, run `device-ocr-s24-ultra`, même code
WASM que l'app) :

| pix2text-mfr | Taille | Formules justes | Chargement (téléphone) | Lecture (téléphone) | Lecture (PC) |
|---|---|---|---|---|---|
| FP32 | 118 Mo | 95,3 % | 8,6 s | 2,55 s | 1,00 s |
| **INT8 dynamique (déployé)** | **32 Mo** | **95,7 %** | **3,6 s** | 2,44 s | 0,68 s |

Sur le téléphone, l'INT8 gagne la taille (÷ 3,7) et le chargement (÷ 2,4), presque pas le temps de lecture (− 4 %).
Les deux lecteurs prennent ~4,9 s : c'est le poste le plus lent de l'app.

## 7. MLOps

| Critère | Chiffre / preuve |
|---|---|
| Niveau 0 : une commande | `make up` : 10 conteneurs (vLLM 7B + LoRA, explicateur llama.cpp, gateway, bac à sable, OCR, MLflow, Postgres, MinIO, Prometheus, Grafana) |
| Niveau 1 : sécurité | Jeton Bearer, clés par utilisateur et appareil stockées hachées, révocables |
| Niveau 1 : usage par utilisateur | Table `usage` (Postgres), `/admin/usage`, tableau Grafana |
| Niveau 1 + 2 : VM | OpenTofu + libvirt : VM Ubuntu 24.04 (8 vCPU, 12 Go) en une commande (`make vm-up`), prête en ~2 min |
| Niveau 1 : déploiement continu | push → CI verte → runner de la VM → commit testé, stack reconstruite, vérification, retour arrière si échec (vu en vrai) |
| Niveau 2 : MLflow | 122 runs, 5 modèles au registry ; la stack sert les `champion`, `/v1/models` les distribue aux téléphones (SHA-256) |
| Niveau 2 : dérive | Evidently : trafic normal 0 colonne sur 6 en dérive ; trafic de limites seulement 6 sur 6 |
| Niveau 2 : interface | App Android (APK 142 Mo) |
| Niveau 3 : quantization | GGUF Q4_K_M (LLM), ONNX INT8 (OCR), voir sections 5 et 6 |
| Niveau 3 : canary | `math-1.5b-distill` contre le 7B + LoRA, paliers 10 → 25 → 50 → 100 % (`make canary-check`) : 100 % vérifiés à chaque palier, 0 repli ; p95 /v1/solve 1,5 s → 0,58 s à 8 utilisateurs (8 novembre) |
| Sécurité du code exécuté | Bac à sable en conteneur : réseau interne seul, lecture seule, `cap_drop: ALL`, AST + liste blanche, 9 tests d'attaque |

Test de charge (Locust, paliers d'une minute) :

| | Utilisateurs | req/s | p95 /v1/solve | Échecs |
|---|---|---|---|---|
| PC, vrai 7B, avant correction | 64 | 5,9 | 13,3 s | |
| PC, vrai 7B, après correction (bac à sable 2 → 8 cœurs, OCR asynchrone) | 64 | **16,6** | **1,7 s** | |
| PC, vrai 7B | 128 | 22,9 | 3,1 s | 3,5 % (OCR serveur saturé) |
| VM de staging (faux LLM) | 64 | 21,1 | 1,3 s | 0 sur 2 533 |

## 8. Limites (à dire)

- Jeu d'évaluation v1 trop facile (98 – 100 % partout) : ± 2 pts de bruit entre deux runs identiques.
- OCR : ~5 s sur le téléphone, 78 % en manuscrit hors ligne, vraies photos encore peu nombreuses.
- Non faits : Kubernetes, décodage spéculatif, AWQ / FP8 du 7B serveur. Canary fait, mais le 1,5B n'est pas encore
  champion en titre (`VLLM_MODEL`, alias MLflow) ; retour arrière automatique montré seulement sans GPU.
