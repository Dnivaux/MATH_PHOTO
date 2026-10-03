# Dossier projet complet — Photo → Maths : OCR, LLM embarqués et MLOps

Oct 2, 2026 · @Dnivaux

## Résumé et positionnement

L'utilisateur photographie une opération ou une équation. L'app la reconnaît, calcule le résultat de façon vérifiée, trace le graphe si c'est une fonction et explique le raisonnement en français. La version ordinateur fournit en plus le script Python exécuté, copiable et exportable. Les cas simples sont traités sur l'appareil, hors ligne ; les cas complexes escaladent vers un serveur GPU (RTX 5090).

Ce dossier réunit le plan projet par phases et l'audit technique (modèles, logiciels, matériel). Le projet est noté sur MLOps : chaque optimisation (LoRA, distillation, pruning, quantization) est une étape d'un pipeline reproductible, tracée dans MLflow, versionnée, déployable et monitorée, jamais une expérience isolée dans un notebook.

**Règle centrale : les LLM traduisent et rédigent, le calcul est toujours fait par un moteur déterministe ou par du code Python exécuté.** Un LLM ne produit jamais un résultat lui-même. L'explication est rédigée à partir d'étapes déjà calculées par SymPy, et chacune de ses égalités est revérifiée.

**Positionnement** : un « Photomath pour développeurs et étudiants scientifiques ». Les différences avec les apps existantes sont le code Python exporté, le fonctionnement hors ligne, la vérification systématique des résultats et des explications, le mode « Vérifier ma copie », et une chaîne entièrement industrialisée sur des modèles open source.

**Fil rouge** : chaque optimisation est jugée sur l'exactitude, la vitesse et la mémoire sur l'appareil, et le taux d'escalade vers le serveur (donc le coût).

**Hors périmètre** : federated learning (étudié en perspective seulement), géométrie avec figures, démonstrations, problèmes longs en langage naturel, reconnaissance vocale.

## Architecture : trois versions

Le système existe en trois versions qui partagent le même serveur et la même chaîne de modèles.

|  | Téléphone | Ordinateur | Serveur (VM sur le PC 5090) |
| --- | --- | --- | --- |
| Public | Grand public, réponse rapide | Étudiants scientifiques, développeurs | Filet de sécurité des deux clients |
| Entrée | Photo | Photo reçue du téléphone, glisser-déposer, capture d'écran, saisie LaTeX | Image ou LaTeX escaladé |
| Détection + OCR | YOLO nano + OCR distillé, INT8 | Mêmes modèles, FP16 | TexTeller, Qwen2.5-VL-7B |
| Calcul local | Moteur déterministe (cas simples) | Moteur déterministe + LLM de maths + Python local (Pyodide) | Qwen2.5-Math-7B + bac à sable Docker |
| Explication | LLM de raisonnement local | LLM de raisonnement local | Renvoie les étapes SymPy ; explication serveur seulement pour le mode léger |
| Code Python affiché | Non | Oui : copiable, `.py`, `.ipynb`, VS Code | Fourni à l'ordinateur |
| Graphe | Interactif, calculé en JavaScript | Matplotlib (SVG) ou interactif JavaScript | Matplotlib (SVG) |
| Hors ligne | Cas simples | Cas simples et complexes | — |

**Pourquoi pas de code Python sur le téléphone** : peu utile sur mobile, et le retirer supprime le LLM de code et Pyodide de l'appareil, soit environ 1 Go de stockage et de RAM économisés. Pic de RAM sous 1 Go, app utilisable sur des téléphones modestes.

**Pourquoi l'explication est rédigée sur l'appareil** : le serveur fait le travail difficile mais court (lire l'image, générer et exécuter le code) et renvoie le résultat et les étapes. L'explication, la partie la plus longue en tokens, est générée sur l'appareil. La charge GPU du serveur baisse fortement, ce qui se mesure au test de charge.

**Escalade vers le serveur** si au moins une condition est vraie :

- confiance de l'OCR sous un seuil, ou LaTeX invalide ;
- problème hors du périmètre local (équation de degré 2 ou plus, système, intégrale, limite, graphe complexe sur téléphone) ;
- code local en échec après 2 tentatives (ordinateur) ;
- appareil trop faible (mode léger, ou moins de 6 Go de RAM) ;
- demande de l'utilisateur.

Les seuils sont calibrés sur le jeu d'évaluation étiqueté et ajustables à distance par la gateway.

## Correspondance avec les grilles

Le plan couvre les quatre niveaux MLOps, les cinq options du niveau 2, toutes les améliorations listées au niveau 3, et les deux niveaux du sujet embarqué.

| Grille | Niveau | Exigence | Où c'est traité |
| --- | --- | --- | --- |
| MLOps | 0 | Lancement en une commande, en conteneurs | Phase 4 : `docker compose up` |
| MLOps | 1 | Déploiement automatique sur une VM | Phases 4 et 8 : VM KVM créée sur le PC, pipeline CD |
| MLOps | 1 | Token dans le header HTTP | Phase 7 : `Authorization: Bearer`, clés hachées, clés d'appareil |
| MLOps | 1 | Suivi d'usage par utilisateur | Phase 7 : table d'usage + dashboard Grafana, transferts téléphone → ordinateur inclus |
| MLOps | 2 | VM créée par Terraform | Phase 4 : provider `libvirt` |
| MLOps | 2 | Test de charge | Phase 10 : Locust |
| MLOps | 2 | Interface utilisateur | Phase 6 : app mobile et app de bureau |
| MLOps | 2 | Détection de data drift | Phase 9 : drift des images, des types de problèmes, de la confiance OCR |
| MLOps | 2 | MLflow pour versionner et mettre à jour en prod | Phases 2, 3, 11 : registry, alias `champion` / `challenger`, modèles téléchargés par les clients |
| MLOps | 3 | Quantization | Phase 3 : OCR INT8, LLM GGUF, serveur AWQ / FP8 |
| MLOps | 3 | Canary deployment | Phase 11 : routage pondéré dans la gateway, distribution progressive des modèles clients |
| MLOps | 3 | Scaling horizontal | Phase 11 : réplicas de la gateway et du bac à sable |
| MLOps | 3 | Protection contre le prompt injection | Phase 7 : texte malveillant dans l'image, guardrails, analyse statique, bac à sable |
| MLOps | 3 | Kubernetes | Phase 11 : k3s (bonus) |
| MLOps | 3 | Améliorations libres | Décodage spéculatif, cache sémantique, apprentissage actif, tableau de bord des coûts, distillation et pruning |
| Embarqué | 1 | Packager un modèle | Phase 6 : OCR et LLM de raisonnement dans l'app Android |
| Embarqué | 2 | Quantizations + comparaison + déploiement du meilleur | Phase 3 : FP32 / FP16 / INT8 dynamique / INT8 statique / QAT pour l'OCR, Q8 à Q4 pour le LLM, mesurés sur le téléphone |

## Version téléphone

Trois modèles tournent sur le téléphone, dont un seul LLM. Le résultat est toujours vérifié, l'explication toujours rédigée localement (sauf en mode léger).

**Pipeline**

1. **Photo** : capture, recadrage, redressement.
2. **Détection** : YOLO nano repère les zones de formule (une ou plusieurs par photo).
3. **OCR** : modèle distillé (taille pix2tex), LaTeX et score de confiance par formule.
4. **Validation** : le LaTeX doit pouvoir être parsé.
5. **Cas simple** : CortexJS Compute Engine calcule le résultat exact et produit les étapes.
6. **Cas complexe** : envoi au serveur, qui renvoie le résultat vérifié et les étapes SymPy.
7. **Explication** : le LLM de raisonnement rédige le raisonnement en français, au niveau choisi (collège, lycée, supérieur).
8. **Affichage** : LaTeX modifiable, résultat, explication, graphe interactif, bouton « envoyer vers l'ordinateur ».

**Types de problèmes**

| Type | Exemple | Traitement |
| --- | --- | --- |
| Arithmétique | 3 × 47 + 12 / 4 | Local |
| Fractions, puissances, racines | (2/3)² + √18 | Local |
| Équation du premier degré | 3x − 7 = 11 | Local |
| Équation de degré 2 ou plus | 2x² − 3x − 5 = 0 | Serveur |
| Système d'équations | 2x + y = 5, x − y = 1 | Serveur |
| Analyse | dérivée, intégrale, limite | Serveur |
| Fonction à tracer | f(x) = sin(x)/x | Tracé local, analyse (racines, extremums) par le serveur |

**Modèles embarqués** (estimations, à mesurer sur l'appareil)

| Rôle | Modèle de départ | Optimisations | Format final | Runtime | RAM |
| --- | --- | --- | --- | --- | --- |
| Détection des formules | YOLOv8n ou YOLO11n | Fine-tuning, quantization INT8 | ONNX | ONNX Runtime Mobile | 20–50 Mo |
| OCR image → LaTeX | pix2tex (environ 25M paramètres) | Fine-tuning photos, distillation depuis TexTeller, pruning structuré, QAT INT8 | ONNX (encodeur + décodeur) | ONNX Runtime Mobile | 30–80 Mo |
| LLM de raisonnement | Qwen3-0.6B | Distillation d'explications françaises vérifiées, pruning structuré agressif, vocabulaire réduit, LoRA de réparation, quantization | GGUF Q4\_K\_M | llama.cpp via `llama.rn` | 0,3–0,5 Go |

**Pas de LLM pour le calcul** : CortexJS est exact à 100 %, instantané et ne coûte presque rien en mémoire.

**Deux modes d'installation** : « léger » (sans LLM, explications demandées au serveur) et « complet » (LLM de raisonnement local, explications hors ligne pour les cas simples). L'app recommande selon la RAM et l'espace libre.

**Hors ligne** : cas simples résolus et expliqués localement ; cas complexes mis en file d'attente et envoyés au retour du réseau.

**Télémétrie anonymisée** vers la gateway : décision locale ou serveur, raison de l'escalade, latence, confiance OCR, type de problème. Les photos ne quittent l'appareil que lors d'une escalade ou d'un envoi vers l'ordinateur.

## Version ordinateur et liaison avec le téléphone

L'app de bureau (Windows, macOS, Linux) ajoute le LLM de maths local et le code Python exécuté et copiable. Elle reçoit les photos prises avec le téléphone.

### Pipeline

1. **Entrée** : photo reçue du téléphone, glisser-déposer, capture d'écran d'une zone, ou saisie LaTeX.
2. **Détection et OCR** : mêmes modèles que le téléphone, en FP16.
3. **Cas simple** : moteur déterministe, code Python généré par gabarit à partir de l'arbre d'expression.
4. **Cas complexe** : le LLM de maths local génère le code SymPy.
5. **Exécution locale** dans Pyodide, 2 tentatives de correction au maximum, sinon escalade.
6. **Explication** : LLM de raisonnement local, à partir des étapes vérifiées.
7. **Affichage** : résultat, **code exact qui a été exécuté** (copier, modifier et relancer, export `.py` et `.ipynb`, ouverture dans VS Code), graphe, explication.

### Modèles

| Rôle | Modèle | Format | Runtime | RAM / VRAM |
| --- | --- | --- | --- | --- |
| Détection + OCR | Mêmes que le téléphone | ONNX FP16 | `onnxruntime-node` | 100–200 Mo |
| LLM de maths (standard) | Qwen2.5-Math-1.5B-Instruct distillé et pruné | GGUF Q4\_K\_M ou Q5\_K\_M | `node-llama-cpp` | 1–1,5 Go |
| LLM de maths (GPU d'au moins 8 Go) | Qwen2.5-Math-7B `teacher-ft` | GGUF Q4\_K\_M | `node-llama-cpp` (CUDA, Metal, Vulkan) | 5–6 Go VRAM |
| LLM de raisonnement | Même modèle que le téléphone | GGUF Q4\_K\_M | `node-llama-cpp` | 0,3–0,5 Go |

L'app détecte le matériel au premier lancement et propose le modèle de maths adapté, ou aucun (tout passe alors par le serveur).

### Règles sur le code affiché

- C'est exactement le code qui a été exécuté, jamais une version réécrite après coup.
- Il est autonome : imports inclus, aucune dépendance à l'environnement d'exécution, exécutable tel quel.
- Il est lisible et commenté, avec le résultat attendu en commentaire final.
- Son autonomie est vérifiée en CI : exécuté dans un Python standard, il doit donner le même résultat.

### Exécution Python locale

- **Retenu : Pyodide dans un worker Electron.** Isolation naturelle (pas d'accès aux fichiers ni au réseau), même comportement sur les trois systèmes, aucune installation de Python.
- **Alternative** : Python autonome embarqué dans un sous-processus, plus rapide, mais isolation à construire.
- Dans les deux cas : analyse statique avec liste blanche d'imports, timeout, limite mémoire.

### Liaison téléphone ↔ ordinateur

**Appairage** : l'app de bureau affiche un QR code contenant un jeton à usage unique valable quelques minutes. Le téléphone le scanne ; les deux appareils sont liés au même compte et reçoivent chacun une clé d'appareil révocable. La liste des appareils liés est gérable dans les deux apps.

| Canal | Quand | Fonctionnement | Avantages |
| --- | --- | --- | --- |
| Relais par le serveur (principal) | Toujours, y compris sur des réseaux différents | Le téléphone dépose la photo dans la boîte de réception de l'utilisateur sur la gateway ; l'app de bureau est notifiée en temps réel par WebSocket | Marche partout, réutilise l'authentification et le suivi d'usage |
| Direct en réseau local (secours) | Même Wi-Fi, ou serveur indisponible | Découverte mDNS, WebSocket direct chiffré (TLS, certificat épinglé à l'appairage) | Aucune dépendance au serveur, plus rapide |

**Ce qui est transféré** : la photo brute ou directement le résultat déjà calculé (LaTeX, résultat, étapes) ; un problème ou une série (page d'exercices) ; synchronisation de l'historique en option.

**Sécurité** : boîte de réception chiffrée au repos, photos supprimées après réception ou après 24 heures, chaque transfert compté dans l'usage de l'utilisateur. Endpoints : `POST /v1/inbox`, `GET /v1/inbox`, `WS /v1/inbox/stream`, `POST /v1/devices/pair`, `DELETE /v1/devices/{id}`.

## Modèles serveur et enseignants

Chaque modèle serveur répond aux requêtes escaladées en production et sert d'enseignant pour distiller les modèles des clients.

| Rôle | Modèle | Usage en production | Usage comme enseignant | Service | VRAM estimée |
| --- | --- | --- | --- | --- | --- |
| OCR de formules | TexTeller (ou UniMERNet) | OCR des photos escaladées | Pseudo-étiquettes pour l'OCR embarqué | PyTorch derrière FastAPI | 1–2 Go |
| Lecture d'image difficile | Qwen2.5-VL-7B-Instruct | Photos illisibles pour l'OCR, contexte autour de la formule | Vérification croisée des pseudo-étiquettes | vLLM, AWQ 4 bits | 7–9 Go |
| Génération de code | Qwen2.5-Math-7B-Instruct + LoRA (`teacher-ft`) | Code SymPy des cas escaladés | Distillation du LLM de maths ordinateur et du LLM de raisonnement | vLLM, AWQ 4 bits ou FP8 | 6–8 Go |
| Modèle brouillon | Qwen2.5-Math-1.5B distillé | Décodage spéculatif pour accélérer le 7B | — | vLLM (speculative decoding) | 1–2 Go |
| Explication (mode léger) | LLM de raisonnement, version serveur | Explications pour les clients sans LLM local | — | vLLM ou llama.cpp | moins de 1 Go |
| Guardrails | Prompt Guard (entrée), Llama Guard 3 1B (sortie) | Filtrage injection et contenu | — | Transformers | 1–3 Go |
| Drift | multilingual-e5-small | Embeddings pour le monitoring | — | Sentence-Transformers | moins de 1 Go |

**Budget VRAM** : environ 17 à 26 Go avec les modèles quantifiés, dans les 32 Go de la 5090, avec une marge pour le cache KV de vLLM. Si la marge manque, Qwen2.5-VL est chargé à la demande ou remplacé par sa version 3B.

**Pendant l'entraînement**, la production est arrêtée ou réduite : la distillation et les LoRA occupent tout le GPU.

**Le Qwen2.5-Math-1.5B distillé a deux usages** : LLM de maths local de l'app de bureau, et modèle brouillon qui accélère le serveur. Le travail de distillation sert donc deux fois.

## Phase 0 — Cadrage

1. **Imprimé ou manuscrit** : imprimé (manuels, énoncés, écran) pour le MVP, manuscrit en extension.
2. **Niveau visé** : collège, lycée et début du supérieur (arithmétique à intégrales simples).
3. **Métriques cibles** (détaillées en phase 2) : exactitude de l'OCR, exactitude finale, fidélité des explications, autonomie du code, latence, RAM, stockage, taux d'escalade.
4. **Cibles matérielles** : téléphone Android de 6 à 8 Go de RAM, ordinateur portable sans GPU dédié, PC 5090 pour l'entraînement et le serveur.
5. **Validation de la compatibilité** des outils avec la 5090 (PyTorch, vLLM, bitsandbytes, llama.cpp) dès la première semaine.
6. **Monorepo** : `data/`, `training/ocr/`, `training/llm/`, `eval/`, `serving/gateway/`, `serving/llm/`, `serving/sandbox/`, `clients/shared/` (logique TypeScript commune), `clients/mobile/`, `clients/desktop/`, `infra/terraform/`, `infra/k8s/`, `pipelines/airflow/`, `monitoring/`, `loadtest/`, `docs/`.
7. **Qualité dès le départ** : pre-commit (ruff, mypy, eslint), pytest, Vitest, conventions de commit, README, CI de lint et de tests.

**Livrable** : note de cadrage, dépôt initialisé, compatibilité GPU validée.

## Phase 1 — Données

Le domaine mathématique permet de générer des données parfaitement étiquetées en quantité illimitée, car SymPy connaît toujours la bonne réponse.

| Usage | Source | Contenu |
| --- | --- | --- |
| OCR imprimé | im2latex-100k | Formules imprimées et leur LaTeX |
| OCR manuscrit (extension) | CROHME, MathWriting | Formules manuscrites |
| OCR synthétique | Générateur maison : SymPy → LaTeX → rendu image, plusieurs polices et fonds | Volume illimité |
| Augmentation | Perspective, flou, bruit, éclairage inégal, ombres, papier quadrillé | Imiter les photos de téléphone |
| OCR réel | 200 à 500 photos prises au téléphone, étiquetées à la main | Jeu de test principal |
| Détection | Formules insérées dans des pages synthétiques, jeux publics de détection de formules | Boîtes englobantes pour YOLO |
| Copies d'élèves (Vérifier ma copie) | Résolutions multi-lignes générées par SymPy, avec erreurs injectées volontairement | Lignes et position de l'erreur |
| LLM de maths | Générateur de problèmes par type + solutions SymPy, sous-ensembles de MATH et GSM8K | Paires problème → code SymPy, filtrées par exécution |
| LLM de raisonnement | Étapes SymPy → explications françaises générées par l'enseignant, en 3 niveaux | Paires étapes → texte, chaque égalité vérifiée |
| Calibration quantization | 500 photos réelles, corpus de problèmes | Calibration INT8 et matrice d'importance GGUF |
| Drift | Échantillon de référence figé | Comparaison avec la production |

**Jeux d'évaluation figés** (jamais vus à l'entraînement) :

- 500 images (moitié synthétiques, moitié vraies photos), étiquetées par type et difficulté ;
- 500 problèmes avec solution de référence, étiquetés « local » ou « serveur » attendu ;
- 300 listes d'étapes avec explication de référence, pour le LLM de raisonnement ;
- 200 copies avec erreur localisée, pour Vérifier ma copie ;
- un jeu d'attaques (images piégées, LaTeX et code malveillants).

**Gouvernance** : versionnement DVC sur MinIO ; tests de données (LaTeX compilable, doublons, fuite entre entraînement et évaluation, distribution par type) ; vérification des licences de chaque dataset et de l'usage des sorties des modèles enseignants.

**Livrable** : générateurs versionnés, datasets DVC, rapport de qualité des données.

## Phase 2 — Banc d'évaluation

Le banc est construit avant toute optimisation. L'évaluation est objective : un résultat est juste ou faux, sans LLM-as-judge pour la partie calcul.

| Composant | Métrique | Mesure |
| --- | --- | --- |
| Détection | mAP@0.5 | Zones de formule correctement détectées |
| OCR | Expression exacte (%) | LaTeX prédit identique au LaTeX attendu, après normalisation |
| OCR | Équivalence mathématique (%) | Expressions égales selon SymPy, même écrites différemment |
| OCR | Taux d'erreur par token (%) | Distance d'édition sur les tokens LaTeX |
| LLM de maths | Exactitude d'exécution (%) | Le code s'exécute et donne la solution de référence |
| LLM de maths | Taux d'exécution (%) | Le code s'exécute sans erreur |
| LLM de maths | Code autonome (%) | Le code affiché tourne seul dans un Python standard |
| Modèle brouillon | Taux d'acceptation (%), accélération | Tokens acceptés par le 7B en décodage spéculatif |
| LLM de raisonnement | Fidélité (%) | Chaque égalité du texte correspond à une étape SymPy |
| LLM de raisonnement | Hallucination (%) | Nombres ou expressions absents des étapes fournies |
| LLM de raisonnement | Clarté (1–10) par niveau | LLM-as-judge, seule métrique subjective |
| Vérifier ma copie | Localisation de l'erreur (%) | Bonne ligne identifiée |
| Bout en bout | Exactitude finale (%) | Photo → bon résultat affiché |
| Système | Latence p50 / p95 (ms) | Locale, serveur, par étape |
| Système | Taux d'escalade (%) | Requêtes envoyées au serveur |
| Embarqué | Taille (Mo), RAM en pic (Mo), temps d'inférence (ms), tokens/s | Mesurés sur le téléphone et l'ordinateur cibles |
| Embarqué | Batterie et température | Pendant une série de résolutions avec explication |

**Mise en place**

1. MLflow (backend Postgres, artefacts sur MinIO) dans le `docker compose`.
2. Un module `eval/` unique, appelé à la fin de chaque étape du pipeline, qui loggue toutes les métriques dans MLflow.
3. **Baselines** : pix2tex brut, TexTeller, Qwen2.5-VL-7B en OCR direct ; Qwen2.5-Math-1.5B et 7B bruts ; Qwen3-0.6B et Qwen3-1.7B bruts pour l'explication.
4. **Bancs embarqués** : écran de debug dans chaque app, qui mesure temps, RAM, tokens/s et exporte les résultats.

**Livrable** : tableau des baselines dans MLflow, module d'évaluation testé.

## Phase 3 — Chaîne d'optimisation

Chaque chaîne est un DAG Airflow. Chaque tâche lit un modèle du registry MLflow, le transforme, l'évalue avec le module de la phase 2 et enregistre une nouvelle version avec sa lignée (données, paramètres, modèle parent). L'ordre compte : chaque étape dégrade un peu le modèle, la suivante doit pouvoir le réparer.

**Vue d'ensemble**

| Modèle | Cible | Spécialisation | Distillation | Pruning | Réparation | Quantization | Métrique de contrôle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| YOLO détection | Téléphone, ordinateur | Fine-tuning sur formules dans des pages | — | Optionnel (canaux) | — | FP16 / INT8 statique | mAP@0.5, latence |
| OCR pix2tex | Téléphone, ordinateur | Fine-tuning synthétique puis vraies photos | Pseudo-étiquettes TexTeller filtrées | Têtes et canaux de l'encodeur | Court réentraînement | FP16, INT8 dynamique, INT8 statique, QAT | Équivalence mathématique |
| Qwen2.5-Math-7B | Serveur, ordinateur avec GPU | QLoRA problème → code | — | — | — | AWQ / FP8 (serveur), GGUF Q4 (ordinateur) | Exactitude d'exécution |
| Qwen2.5-Math-1.5B | Ordinateur, brouillon serveur | — | Codes de l'enseignant filtrés par exécution ; logits en option | 10 à 30 % des couches | LoRA puis fusion | GGUF Q8\_0 à Q4\_K\_M | Exactitude, taux d'acceptation |
| Qwen3-0.6B | Téléphone, ordinateur | — | Explications françaises vérifiées, 3 niveaux | Couches + largeur (30 à 50 %), vocabulaire réduit | LoRA puis fusion | GGUF Q8\_0 à Q4\_K\_M | Fidélité, hallucination |

### 3A — Détection et OCR

1. **YOLO** : fine-tuning sur des formules insérées dans des pages, export ONNX, comparaison FP16 / INT8.
2. **OCR, fine-tuning** : pix2tex sur données synthétiques augmentées, puis sur vraies photos.
3. **OCR, distillation** : TexTeller annote un grand volume d'images non étiquetées ; pseudo-étiquettes gardées seulement si le LaTeX compile et concorde avec Qwen2.5-VL ; l'élève est réentraîné dessus.
4. **OCR, pruning** structuré (torch-pruning) puis court réentraînement.
5. **OCR, quantization** (cœur du sujet embarqué) : export ONNX de l'encodeur et du décodeur, comparaison FP32, FP16, INT8 dynamique, INT8 statique (calibration sur 500 photos réelles), QAT.
6. **Mesure sur le téléphone** et déploiement du meilleur compromis.

### 3B — LLM de maths

1. **LoRA serveur** : QLoRA de Qwen2.5-Math-7B-Instruct sur problème → code SymPy, recherche légère d'hyperparamètres (rang 8/16/32). Résultat : `teacher-ft`.
2. **Option** : renforcement par exécution (GRPO), la récompense étant « le code donne le bon résultat ».
3. **Distillation vers 1,5B** : par séquence (codes de l'enseignant gardés s'ils donnent le bon résultat) ; par logits en option (même tokenizer).
4. **Pruning** : suppression de couches redondantes (type ShortGPT), test à 10, 20 et 30 %.
5. **LoRA de réparation**, fusion.
6. **Quantization** : GGUF Q8\_0 à Q4\_K\_M avec matrice d'importance mathématique ; AWQ / FP8 pour le 7B serveur.
7. **Deux variantes possibles** du 1,5B : une pour l'ordinateur (qualité), une pour le décodage spéculatif (un pruning trop fort fait chuter le taux d'acceptation).

### 3C — LLM de raisonnement

La tâche est très étroite : transformer des étapes déjà calculées (JSON) en texte français. Elle supporte une optimisation agressive.

1. **Distillation** : l'enseignant génère des explications en 3 niveaux à partir des étapes SymPy ; ne sont gardées que celles dont chaque égalité est vérifiée et dont tous les nombres figurent dans les étapes.
2. **Pruning structuré** : couches et largeur, taux de 30 à 50 %.
3. **Pruning du vocabulaire** : Qwen3 a environ 150 000 tokens ; ne garder que le français, la notation mathématique, le LaTeX et les chiffres. Sur un 0,6B, la matrice d'embeddings pèse une part importante des paramètres, donc le gain est fort.
4. **LoRA de réparation**, fusion.
5. **Quantization** GGUF Q8\_0 à Q4\_K\_M, mesurée sur le téléphone.
6. **Limite assumée** : le modèle ne sait faire que ça ; l'app ne lui envoie jamais autre chose qu'une liste d'étapes.

### 3D — Sélection et promotion

1. Tableau final par modèle : exactitude, taille, RAM, vitesse, taux d'escalade. Courbe étape par étape (brut → distillé → pruné → réparé → quantifié).
2. Règle de promotion écrite et automatisée par modèle (exemple OCR : meilleure exactitude sous 80 Mo et sous 300 ms sur le téléphone).
3. Le gagnant reçoit l'alias `challenger`, puis `champion` après le canary.

**Règles communes** : pruning structuré uniquement pour les LLM (llama.cpp ne tire aucun gain du non structuré) ; toute donnée d'enseignant filtrée par exécution ou vérification SymPy.

**Livrable** : DAG Airflow reproductibles, tableaux et courbes comparatifs, modèles versionnés avec leur lignée.

## Phase 4 — Infra serveur (niveaux 0, 1 et 2)

Le serveur tourne sur le PC 5090, dans une VM créée par Terraform : on garde la puissance gratuite, la production est isolée de la machine personnelle, et les niveaux 1 et 2 sont cochés.

**4.1 VM de production**

1. Prérequis : IOMMU activé, KVM/libvirt sous Linux, GPU lié à VFIO pour le passthrough (une demi-journée à une journée de configuration).
2. **Terraform, provider `libvirt`** : crée la VM (CPU, RAM, disque, réseau, GPU en passthrough) à partir d'une image cloud Ubuntu.
3. **cloud-init** : Docker, driver NVIDIA, NVIDIA Container Toolkit.
4. **Exposition sans ouvrir de port** : Cloudflare Tunnel (URL publique HTTPS) pour les apps, Tailscale pour l'administration.
5. Environnements `staging` et `prod` (deux VM, ou deux stacks si la RAM est juste).
6. **Repli** si le passthrough échoue : Docker directement sur l'hôte. Le niveau 1 reste probablement valide (à confirmer par le prof), seule l'option Terraform du niveau 2 est perdue.

**4.2 Stack Docker (niveau 0)**

`docker compose up` démarre :

- **vLLM** : Qwen2.5-Math-7B `teacher-ft` (AWQ) avec le 1,5B en brouillon spéculatif, et Qwen2.5-VL-7B, chargés depuis le registry MLflow (alias `champion`) ;
- **Service OCR** : TexTeller derrière FastAPI ;
- **Gateway FastAPI** : `POST /v1/solve` (image ou LaTeX, streaming SSE, renvoie résultat + étapes + code), `POST /v1/explain` (mode léger), `POST /v1/check` (Vérifier ma copie), `GET /v1/models/{client}/latest`, `POST /v1/feedback`, `POST /v1/corrections`, endpoints d'appairage et de boîte de réception, `GET /health`, `GET /metrics` ;
- **Bac à sable**, **Postgres**, **Redis**, **MLflow**, **MinIO**, **Airflow**, **Label Studio**, **Prometheus**, **Grafana**.

Un profil `docker compose --profile ci` remplace les modèles GPU par un petit modèle factice pour la CI.

**Livrable** : `terraform apply` crée la VM, `docker compose up` démarre tout le système.

## Phase 5 — Bac à sable d'exécution

Exécuter du code généré par un LLM est le premier risque de sécurité du projet.

1. **Conteneur dédié** : Python, SymPy, NumPy, Matplotlib uniquement ; utilisateur non root ; système de fichiers en lecture seule sauf un `/tmp` limité.
2. **Isolation** : aucun réseau, limites CPU et mémoire, timeout de 5 secondes, nombre de processus limité ; gVisor en option.
3. **Analyse statique AST** avant exécution : imports hors liste blanche refusés, ainsi que `exec`, `eval`, `open`, `__import__`, `os`, `subprocess` et les attributs « dunder ».
4. **Auto-correction** : en cas d'erreur, le message est renvoyé au LLM (2 tentatives au maximum), puis échec propre.
5. **Sorties** : résultat structuré (JSON), graphe SVG, étapes intermédiaires SymPy.
6. **Tests d'attaque** en CI : boucles infinies, bombes mémoire, tentatives réseau, accès fichiers, évasion.
7. **Même analyse statique côté ordinateur** avant exécution dans Pyodide (code partagé).

**Livrable** : service bac à sable testé, rapport des attaques bloquées.

## Phase 6 — Développement des clients

Les deux clients sont en TypeScript et React. La logique commune (parsing LaTeX, gabarits de code, client de la gateway, appairage, analyse statique) vit dans `clients/shared/`.

**Étapes**

1. **Paquet commun** : client de la gateway, modèles de données, gabarits de code Python, logique d'escalade.
2. **App téléphone** : capture, YOLO + OCR, moteur déterministe, LLM de raisonnement, graphe interactif, historique, mode léger / complet.
3. **App ordinateur** : réception de photos, capture d'écran, LLM de maths, Pyodide, éditeur de code, exports.
4. **Liaison** : appairage par QR code, relais serveur, réseau local.
5. **Gestion des modèles** : téléchargement depuis `/v1/models/{client}/latest`, vérification du hash, mise à jour quand le registry promeut une version : lien direct entre MLflow et les appareils.
6. **Calibration de l'escalade** sur le jeu étiqueté (courbe exactitude finale / taux d'escalade).

**Téléphone (React Native, Android en priorité)**

| Fonction | Logiciel |
| --- | --- |
| Framework | React Native + TypeScript (Expo en « dev build » ou React Native CLI) |
| Caméra, scan du QR code | `react-native-vision-camera` |
| Inférence YOLO + OCR | `onnxruntime-react-native` (CPU, NNAPI, QNN selon l'appareil) |
| LLM de raisonnement | `llama.rn` (llama.cpp) |
| Calcul déterministe | CortexJS Compute Engine |
| Rendu et édition du LaTeX | MathLive ou KaTeX |
| Graphe interactif | `react-native-svg`, points calculés par CortexJS, curseurs sur les paramètres |
| Stockage local | SQLite (`op-sqlite` ou `expo-sqlite`) |
| Fichiers modèles | `react-native-fs` |
| Liaison | WebSocket (relais), `react-native-zeroconf` (mDNS) |
| Tests | Jest, Detox |

**Ordinateur (Electron, Windows, macOS, Linux)**

| Fonction | Logiciel |
| --- | --- |
| Framework | Electron + React + TypeScript, Vite |
| Inférence YOLO + OCR | `onnxruntime-node` |
| LLM de maths et de raisonnement | `node-llama-cpp` (CUDA, Metal, Vulkan) |
| Exécution Python | Pyodide dans un worker (SymPy, NumPy, Matplotlib) |
| Calcul déterministe | CortexJS Compute Engine |
| Éditeur de code | Monaco Editor (coloration, copier, modifier et relancer) |
| Export | `.py`, `.ipynb` (JSON généré par l'app), ouverture dans VS Code |
| Capture d'écran | API `desktopCapturer` d'Electron |
| Liaison | Serveur WebSocket local, `bonjour-service` (mDNS), `qrcode` |
| Packaging et mises à jour | electron-builder, electron-updater |
| Tests | Vitest, Playwright |

Les modèles ne sont inclus dans aucun installeur : ils sont téléchargés au premier lancement et mis à jour depuis le registry sans republier les apps.

**Livrable** : APK Android, installeurs de bureau, courbe de calibration de l'escalade, démo téléphone → ordinateur.

## Phase 7 — Sécurité (niveaux 1 et 3)

1. **Authentification** : clés API par utilisateur et clés par appareil, stockées hachées, envoyées dans `Authorization: Bearer <token>`. Sans clé valide : 401. Endpoints admin pour créer, révoquer et lister les clés.
2. **Suivi d'usage par utilisateur** : chaque requête est logguée (utilisateur, appareil, horodatage, type de problème, local ou serveur, tokens, temps GPU, versions des modèles, succès, transferts téléphone → ordinateur) ; dashboard Grafana par utilisateur.
3. **Rate limiting et quotas** par clé via Redis (429 au-delà), quota spécifique pour les requêtes coûteuses (vision, explication serveur).
4. **Prompt injection par l'image** : une photo peut contenir du texte du type « ignore tes instructions ». Défense en profondeur :
   - le LLM ne reçoit que le LaTeX extrait, encadré comme donnée ;
   - Prompt Guard sur le texte extrait ;
   - analyse statique et bac à sable neutralisent tout code malveillant même si l'injection passe ;
   - Llama Guard sur les sorties texte.
5. **Jeu de tests d'attaque** en CI, avec taux de blocage et taux de faux positifs.
6. **Validation des entrées** : taille et format d'image, longueur du LaTeX.
7. **Secrets et transport** : HTTPS via Cloudflare Tunnel, TLS épinglé entre téléphone et ordinateur, secrets dans GitHub Secrets, aucune donnée personnelle dans les logs, photos supprimées après traitement.

**Livrable** : démo d'une requête refusée sans token et d'une image piégée neutralisée, dashboard d'usage.

## Phase 8 — CI/CD (niveaux 1 et 2)

1. **CI à chaque push** (GitHub Actions) : lint, tests unitaires et d'intégration (profil sans GPU), tests du bac à sable et de sécurité, **test d'autonomie du code**, build des images Docker, scan Trivy, push sur GHCR.
2. **CD** : runner GitHub Actions auto-hébergé sur le PC, déploiement sur `staging` à chaque merge sur `main`, puis sur `prod` après validation manuelle.
3. **Tests de fumée** après déploiement (`/health` et une résolution réelle) ; rollback automatique en cas d'échec.
4. **CI des modèles** : une nouvelle version dans le registry déclenche l'évaluation complète ; elle n'obtient l'alias `challenger` que si elle bat le `champion` sur le jeu figé.
5. **CI des clients** : build de l'APK et des installeurs de bureau, tests Detox et Playwright, publication en release.
6. **Infra as code** : `terraform plan` en CI, `apply` sur validation.

**Livrable** : un push sur `main` déploie sans intervention ; une régression de modèle est bloquée automatiquement.

## Phase 9 — Monitoring et data drift (niveau 2)

1. **Métriques système** (Prometheus + Grafana) : requêtes/s, latence p50/p95/p99 par étape (OCR, LLM, bac à sable), erreurs, utilisation et mémoire GPU (DCGM exporter), taux d'acceptation du décodage spéculatif, taux de succès du cache.
2. **Métriques métier** : taux d'escalade global et par raison, taux de réussite de l'exécution, tentatives d'auto-correction, corrections de LaTeX par les utilisateurs, feedback négatif, répartition téléphone / ordinateur / serveur.
3. **Data drift** avec Evidently :
   - **images** : luminosité, contraste, netteté, résolution, embeddings de l'encodeur OCR (détecte par exemple un afflux de manuscrit) ;
   - **problèmes** : distribution des types et de la complexité des expressions ;
   - **performance** : baisse de la confiance OCR, hausse des corrections utilisateurs.
4. **Rapport de drift quotidien** par un DAG Airflow, alerte au-delà d'un seuil.
5. **Boucle de réentraînement** : une alerte déclenche la chaîne OCR avec les corrections validées (apprentissage actif) ; le nouveau modèle arrive en `challenger`, jamais directement en prod.
6. **Démo** : lot de photos manuscrites ou très sombres pour montrer la détection.

## Phase 10 — Test de charge (niveau 2)

1. **Scénarios Locust** : mélange réaliste (avec ou sans image, avec ou sans explication serveur, transferts vers l'ordinateur), montée de 1 à 200 utilisateurs, endurance de 30 minutes.
2. **Mesures** : débit maximal, latence p95 par étape, taux d'erreur, saturation du GPU et du bac à sable.
3. **Comparaisons** : 7B en BF16 contre AWQ, avec et sans décodage spéculatif, avec et sans cache sémantique, avec et sans guardrails, une contre plusieurs réplicas du bac à sable.
4. **Impact de l'architecture hybride** : capacité du serveur selon le taux d'escalade, et selon que l'explication est rédigée côté client ou côté serveur.

**Livrable** : rapport de charge avec graphes et recommandations de dimensionnement.

## Phase 11 — Améliorations niveau 3

1. **Canary deployment** : la gateway envoie 5 %, puis 25 %, puis 100 % du trafic au `challenger`, compare automatiquement exactitude, latence, erreurs et feedback, puis promeut ou annule selon des seuils écrits. Même principe pour les modèles clients, distribués à une fraction des appareils.
2. **Shadow deployment** (option) : le `challenger` reçoit une copie du trafic sans que l'utilisateur voie sa réponse.
3. **Scaling horizontal** : réplicas de la gateway et du bac à sable (sans état) derrière un load balancer.
4. **Kubernetes** (bonus) : k3s dans la VM, Deployments, Services, Ingress, HPA, canary via Argo Rollouts.
5. **Déjà couverts** : quantization (phase 3), protection contre le prompt injection (phase 7), décodage spéculatif (phase 4).

## Fonctionnalités retenues

Six améliorations s'ajoutent au socle, à développer après le MVP.

| Fonctionnalité | Description | Technique | Intérêt pour la note |
| --- | --- | --- | --- |
| Vérifier ma copie | L'élève photographie sa propre résolution ; l'app indique la ligne exacte de l'erreur et l'explique | Détection et OCR multi-lignes ; SymPy vérifie l'équivalence de chaque ligne avec la précédente ; le LLM de raisonnement explique l'erreur | Différenciateur produit fort, réutilise tout le pipeline |
| Cache sémantique serveur | Un problème déjà résolu est servi sans GPU | LaTeX normalisé en forme canonique SymPy, haché, stocké dans Redis avec TTL | Taux de succès et GPU économisé, mesurables |
| Niveau d'explication réglable | Collège, lycée ou supérieur | Paramètre du prompt du LLM de raisonnement, intégré aux données de distillation | Distillation conditionnée |
| Graphe interactif | Curseurs sur les paramètres (a, b, c dans ax² + bx + c) | Points recalculés en local par CortexJS, rendu SVG | Calcul entièrement local |
| Boucle d'apprentissage actif | Les corrections de LaTeX des utilisateurs améliorent l'OCR | Corrections collectées avec consentement, validées dans Label Studio, versionnées DVC, réentraînement par Airflow, promotion en `challenger` | Boucle MLOps complète, liée au drift |
| Tableau de bord des coûts | Temps GPU par utilisateur, économies dues au local et au cache | Métriques Prometheus, dashboard Grafana, coût en équivalent cloud | Argument économique chiffré |

**Ordre conseillé** : cache sémantique et tableau de bord des coûts (rapides, très visibles), puis niveau d'explication et graphe interactif, puis apprentissage actif, et enfin Vérifier ma copie (la plus ambitieuse, car elle demande un OCR multi-lignes fiable).

**Pistes écartées pour l'instant** : exercices similaires générés, comparaison CPU / GPU / NPU sur le téléphone, mesure de batterie détaillée (à ajouter si le temps le permet).

## Stack serveur, MLOps et entraînement

**Serveur et MLOps** (tout conteneurisé dans la VM de production)

| Couche | Logiciel | Rôle | Niveau |
| --- | --- | --- | --- |
| Virtualisation | KVM / libvirt, VFIO | VM de production sur le PC, GPU en passthrough | 1 |
| Infra as code | Terraform + provider `libvirt`, cloud-init | Création et configuration de la VM | 2 |
| Conteneurs | Docker, Docker Compose, NVIDIA Container Toolkit | Lancement en une commande, accès GPU | 0 |
| Orchestration (bonus) | k3s, Helm, Argo Rollouts | Kubernetes, HPA, canary | 3 |
| Exposition | Cloudflare Tunnel, Tailscale | HTTPS sans port ouvert, administration | 1 |
| Gateway | FastAPI, Uvicorn, Pydantic | API, auth, routage canary, cache, orchestration | 1, 3 |
| Service LLM | vLLM | 7B math (spéculatif avec le 1,5B), Qwen2.5-VL | — |
| Service OCR | TexTeller, FastAPI | OCR serveur | — |
| Bac à sable | Conteneur Python minimal, gVisor (option), analyse AST | Exécution isolée | 3 |
| Base de données | PostgreSQL | Utilisateurs, clés, appareils, usage, feedback, backend MLflow | 1 |
| Cache et quotas | Redis | Rate limiting, cache sémantique | 1, 3 |
| Stockage d'objets | MinIO | Artefacts MLflow, données DVC, modèles clients, boîte de réception | 2 |
| Versionnement modèles | MLflow | Tracking, registry, alias `champion` / `challenger` | 2 |
| Versionnement données | DVC | Datasets reproductibles | 2 |
| Pipelines | Apache Airflow | Entraînement, évaluation, drift, réentraînement | 2 |
| Annotation | Label Studio | Validation des corrections utilisateurs | 2 |
| Monitoring | Prometheus, Grafana, DCGM exporter | Système, GPU, métier, usage, coûts | 1, 2 |
| Data drift | Evidently | Images, types de problèmes, confiance OCR | 2 |
| Guardrails | Prompt Guard, Llama Guard | Injection et filtrage de sortie | 3 |
| Test de charge | Locust | Montée en charge, endurance | 2 |
| CI/CD | GitHub Actions (runner auto-hébergé), GHCR | Tests, build, déploiement, rollback | 1 |
| Sécurité des images | Trivy | Scan de vulnérabilités | — |
| Qualité | ruff, mypy, pytest, eslint, pre-commit | Lint, typage, tests | — |

**Entraînement et optimisation** (sur le PC 5090, Linux)

| Étape | Outils |
| --- | --- |
| Socle | PyTorch (version compatible Blackwell), CUDA, Transformers, Datasets, Accelerate |
| Détection | Ultralytics |
| OCR | Dépôt pix2tex (LaTeX-OCR), TexTeller |
| LoRA / QLoRA | PEFT, TRL, bitsandbytes, Unsloth (option) |
| Distillation | TRL (SFT, GKD pour les logits), vLLM pour la génération en batch |
| Renforcement (option) | TRL (GRPO) |
| Pruning LLM | Suppression de couches type ShortGPT, LLM-Pruner (largeur), script maison de réduction du vocabulaire |
| Pruning vision | torch-pruning |
| Quantization LLM | llama.cpp (`convert_hf_to_gguf`, `llama-quantize`, `llama-imatrix`) |
| Quantization serveur | AutoAWQ ou llm-compressor |
| Quantization vision | ONNX Runtime quantization, PyTorch QAT |
| Évaluation | Module `eval/` maison, SymPy, lm-evaluation-harness, LLM-as-judge |
| Suivi et orchestration | MLflow, DVC, Airflow |
| Génération de données (option) | Modèles cloud peu chers via OmniRoute, toujours filtrés par exécution et vérification SymPy |

## Matériel, stockage et RAM

Toutes les valeurs sont des estimations, à mesurer sur les builds réels et à intégrer au tableau comparatif.

**Matériel**

| Équipement | Rôle |
| --- | --- |
| PC RTX 5090 (32 Go VRAM), Linux | Entraînement, VM de production, runner CI, test de l'app de bureau avec le 7B |
| Téléphone Android de 6 à 8 Go de RAM | Cible principale, démo |
| Téléphone de 4 Go (si disponible) | Test du mode léger |
| Ordinateur portable sans GPU dédié | Test de l'app de bureau avec le 1,5B |

**Téléphone**

| Composant | Stockage | RAM |
| --- | --- | --- |
| App (React Native, ONNX Runtime, llama.cpp, caméra) | 50–80 Mo | 150–250 Mo |
| YOLO nano INT8 | 3–6 Mo | 20–50 Mo |
| OCR distillé INT8 | 20–30 Mo | 30–80 Mo |
| LLM de raisonnement optimisé, Q4 | 0,2–0,3 Go | 0,3–0,5 Go |
| **Total mode complet** | **0,3–0,45 Go** | **pic de 0,5–0,9 Go** |
| **Total mode léger** | **75–120 Mo** | **200–380 Mo** |

Pour comparaison, la première architecture (LLM de code et Pyodide sur le téléphone, modèles bruts) estimait 1,6 à 1,8 Go de stockage et un pic de RAM de 2 Go : la nouvelle répartition divise l'empreinte par trois à quatre.

**Ordinateur**

| Configuration | Stockage | RAM / VRAM |
| --- | --- | --- |
| App + Pyodide + OCR + LLM de raisonnement | 0,5–0,7 Go | 1–1,5 Go |
| + LLM de maths 1,5B (Q4/Q5) | + 0,8–1,1 Go | + 1–1,5 Go |
| + LLM de maths 7B (Q4), GPU dédié | + 4,5–5 Go | + 5–6 Go de VRAM |

**Leviers si la RAM manque** : contexte limité à 1 024 tokens, cache KV quantifié en Q8, pruning supplémentaire, quantization Q3\_K\_M, mode léger.

## Phase 12 — Rapport et soutenance

1. **Rapport** : architecture à trois versions, règle « les LLM traduisent, Python calcule », tableaux et courbes des chaînes d'optimisation, courbe exactitude / taux d'escalade, empreinte mémoire avant et après, sécurité du bac à sable, rapport de charge, drift, coûts, limites, perspectives (federated learning, manuscrit, géométrie).
2. **Schémas** : architecture globale, parcours d'une requête, DAG d'entraînement, pipeline CI/CD, défense en profondeur, liaison téléphone ↔ ordinateur.
3. **Scénario de démo** (10 à 12 minutes) :
   - opération simple en mode avion sur le téléphone : résultat et explication instantanés ;
   - équation du second degré : escalade, résultat, explication rédigée sur le téléphone, graphe interactif ;
   - envoi vers l'ordinateur : code Python affiché, copié dans un terminal, même résultat ;
   - Vérifier ma copie sur une résolution avec une erreur ;
   - image piégée neutralisée, requête sans token refusée ;
   - dashboards d'usage, de coûts et de drift ;
   - push qui déclenche le déploiement, canary en cours.
4. **Vidéo de secours** de la démo complète.

## Planning et jalons

Blocs classés par priorité, à caler sur la durée réelle du projet. À la fin du bloc 3, une démo complète existe déjà (jalon MVP).

1. **Bloc 1 — Socle** : phases 0, 1, 2 ; stack Docker avec modèles bruts ; bac à sable.
2. **Bloc 2 — Téléphone** : OCR fine-tuné et quantifié, moteur déterministe, escalade, LLM de raisonnement brut.
3. **Bloc 3 — Production** : VM Terraform, sécurité, CI/CD. **Jalon MVP.**
4. **Bloc 4 — Optimisation complète** : phase 3 entière (distillation, pruning, LoRA, quantization, promotion).
5. **Bloc 5 — Ordinateur et liaison** : app de bureau, Pyodide, LLM de maths, appairage, relais.
6. **Bloc 6 — Exploitation** : drift, charge, cache sémantique, tableau de bord des coûts.
7. **Bloc 7 — Niveau 3 et fonctionnalités** : canary, scaling, niveau d'explication, graphe interactif, apprentissage actif, Vérifier ma copie, Kubernetes en bonus.
8. **Bloc 8 — Finalisation** : phase 12.

## Risques et parades

| Risque | Impact | Parade |
| --- | --- | --- |
| Passthrough GPU difficile | VM sans GPU | Tester en premier ; repli sur Docker directement sur l'hôte |
| Outils incompatibles avec la 5090 | Blocage de l'entraînement | Validation dès la semaine 1, versions récentes, images Docker NVIDIA officielles |
| PC éteint le jour J | Démo serveur impossible | PC testé la veille, vidéo de secours, le mode local fonctionne seul |
| VRAM insuffisante | Lenteur ou crash | AWQ, Qwen2.5-VL à la demande ou en 3B |
| OCR faible sur vraies photos | Exactitude finale basse | Augmentations réalistes, vraies photos, escalade vers le modèle vision, correction manuelle du LaTeX |
| Code généré souvent en échec | Mauvaise expérience | Auto-correction, filtrage par exécution, option GRPO |
| Explication avec étapes fausses | Crédibilité | Étapes calculées par SymPy, vérification de chaque égalité |
| Pruning qui détruit un modèle | Résultat inutilisable | Taux progressifs, LoRA de réparation, présenter un résultat négatif mesuré si besoin |
| Évasion du bac à sable | Faille de sécurité | Analyse statique, conteneur sans réseau, gVisor, VM isolée |
| mDNS bloqué sur le Wi-Fi de l'école | Liaison locale impossible | Relais serveur en canal principal |
| Périmètre trop large | Rien de fini | Respecter l'ordre des blocs ; app de bureau et fonctionnalités après le MVP |

## Points à valider

- [ ] Compatibilité de PyTorch, vLLM, bitsandbytes et llama.cpp avec la 5090.
- [ ] Passthrough GPU dans la VM KVM.
- [ ] Confirmation par le prof qu'une VM sur le PC personnel satisfait le niveau 1.
- [ ] Export ONNX de pix2tex et boucle de décodage côté app.
- [ ] Qualité du français de Qwen3-0.6B face à Qwen3-1.7B avant la distillation.
- [ ] Pyodide + SymPy dans un worker Electron : chargement et performances.
- [ ] Décodage spéculatif dans vLLM : taux d'acceptation et gain réel.
- [ ] Périmètre de l'app de bureau pour la soutenance : complète, ou limitée à la réception de photos et au code Python.
- [ ] Imprimé seulement, ou manuscrit aussi.
- [ ] Durée du projet et taille de l'équipe.
- [ ] Licences des datasets et des modèles enseignants.
