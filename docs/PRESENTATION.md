# Présentation : plan détaillé, slide par slide

Consigne du prof : pas de slide remplie de texte, seulement l'essentiel (chiffres clés, tableaux, graphiques).
Les chiffres viennent de `docs/CHIFFRES_CLES.md`. 12 slides ; les durées supposent un oral de 15 minutes, à
ajuster. Règle pour chaque slide : un titre qui dit le message, un seul visuel principal, au plus 3 chiffres en
gros, et le reste à l'oral.

**Fil conducteur** : 3 temps, avec une phrase de transition à chaque changement de partie.

1. **Le projet** (slides 1 à 3) : ce que fait l'app, comment elle est construite.
2. **Sujet Embarqué** (slides 4 à 6) : les modèles sur le téléphone, dans l'ordre du parcours : OCR, puis explication.
3. **Sujet MLOps** (slides 7 à 11) : comment on fabrique, déploie, teste et surveille les modèles.
4. **Bilan** (slide 12), puis la démo.

Pourquoi cet ordre : le jury note deux sujets, donc chacun a son bloc d'un seul tenant. Dans l'embarqué, on suit les
étapes de la slide de contexte (OCR puis explication). Les données et le banc d'évaluation ouvrent le bloc MLOps,
parce que tout le reste (registry, champion, déploiement) s'appuie dessus.

---

## Partie 1 : Le projet

### Slide 1 : Titre (15 s)

- **Titre** : « Photo → Maths »
- **Sous-titre** : « Un modèle embarqué sur téléphone et sa mise en production »
- **Mise en page** : à gauche, titre, vos deux noms, formation, date ; à droite, une capture du téléphone (écran Solution
  avec la formule lue et l'explication).
- **À dire** : « On photographie un exercice de maths, l'app le lit, le résout et explique la démarche en français. »
- **À préparer** : capture de l'écran Solution sur le S24 Ultra (exemple : `-3x²+23x-30=0`).

### Slide 2 : Contexte et fonctionnement (1 min) — déjà faite

- **Visuel** : la slide existante « Contexte & Fonctionnement » : 4 cartes (Capture → OCR → Calcul et graphique →
  Explication IA), avec 2 niveaux (embarqué et serveur) pour l'OCR et l'explication.
- **À dire** :
  - Le LLM ne calcule jamais : il traduit le problème en code SymPy, qui est exécuté puis vérifié. Pour
    l'explication, un petit LLM rédige à partir des étapes de calcul, et chaque égalité est revérifiée.
  - Les 4 étapes de cette slide sont le plan de la partie embarquée : on va voir l'OCR, puis l'explication.
  - Projet commun : sujet Embarqué + sujet MLOps.
- **Option** : ajouter en bas une bande de 3 chiffres (**100 %** de résultats justes · **95,7 %** de formules lues
  par l'OCR du téléphone · **3,3 s** pour une explication hors ligne), seulement si la slide n'est pas trop chargée.

### Slide 3 : Architecture (1 min)

- **Titre** : « Le téléphone fait le maximum, le serveur prend le relais »
- **Visuel** : schéma en deux blocs.
  - **Téléphone** : OCR pix2text-mfr ×2 (ONNX INT8, 2 × 32 Mo) · calcul simple CortexJS · explicateur Qwen3-0,6B (GGUF
    Q4_K_M, 391 Mo) · vérification des égalités
  - **Serveur (RTX 5090)** : gateway (jeton) · vLLM Qwen2.5-Math-7B + LoRA · bac à sable SymPy · OCR TexTeller ·
    MLflow · Prometheus / Grafana
  - **Flèche « escalade »** du téléphone vers le serveur, annotée : problème hors portée, lecture douteuse, demande de
    l'utilisateur
  - **Flèche « modèle champion + SHA-256 »** du serveur vers le téléphone
- **À dire** : hors ligne, le téléphone lit, résout les cas simples et explique ; le reste passe par le serveur, et la
  photo ne quitte le téléphone qu'en cas d'escalade.
- **Transition** : « Commençons par ce qui tourne sur le téléphone. »

---

## Partie 2 : Sujet Embarqué

### Slide 4 : OCR, choisir le modèle puis le quantifier (1 min 45)

- **Titre** : « OCR : le bon modèle, puis 4 fois plus léger »
- **Mise en page** : deux panneaux côte à côte, puis un bandeau bleu en bas.
- **Panneau gauche, « 1 · Choisir le modèle »** : barres horizontales triées, formules lues juste sur 300 images
  « façon photo ».

  | Modèle | Score | Couleur |
  |---|---|---|
  | pix2tex (1re version de l'app) | 17,3 % | gris |
  | PP-FormulaNet+-S | 21,7 % | gris |
  | PP-FormulaNet-S | 29,0 % | gris |
  | TexTeller (serveur) | 89,3 % | couleur secondaire |
  | pix2text-mfr 1.5 (téléphone) | 89,7 % | couleur principale |
  | pix2text-mfr (téléphone) | **95,7 %** | couleur principale |

- **Panneau droit, « 2 · Quantifier en INT8 »** : en gros **32 Mo** (au lieu de 118 Mo), puis un petit tableau
  FP32 → INT8 : chargement 8,6 s → **3,6 s** · lecture d'une formule 2,55 s → 2,44 s · formules justes 95,3 % → 95,7 %.
  Encadré : « Vitesse de lecture : − 32 % sur PC, seulement − 4 % sur le téléphone ».
- **Bandeau en bas** : « Les 2 lecteurs du téléphone d'accord → juste **261 fois sur 262** »
- **À dire** :
  - On a comparé 6 modèles avec la même mise en forme du LaTeX (sans ça, le meilleur était à 0 % sur les limites).
  - Les deux meilleurs tiennent sur le téléphone ; on garde les deux, ils votent. S'ils ne sont pas d'accord, le
    serveur relit ou l'utilisateur choisit.
  - Quantifiés en INT8 : 4 fois plus petits, chargés 2 fois plus vite, sans perte de justesse. Mesuré avec le même
    code que l'app (onnxruntime-web dans Chrome sur le téléphone) : sur PC l'INT8 lit un tiers plus vite, sur le
    téléphone presque pas, parce que le WASM tourne sur un seul fil. Leçon : il faut mesurer sur la cible.
  - Limite : ~5 s pour les deux lecteurs, prochaine optimisation.
- **Transition** : « Après la lecture, l'explication : un LLM qu'il a fallu rendre assez petit pour le téléphone. »

### Slide 5 : Explicateur, la chaîne de compression (1 min 15)

- **Titre** : « Distiller, élaguer, réparer, quantifier »
- **Graphique** : barres ou escalier, acceptation des explications au lycée (%), avec la taille sous chaque barre.

  | Étape | Acceptation | Taille |
  |---|---|---|
  | Qwen3-0,6B brut | 84,0 % | 1 148 Mo |
  | Distillé (enseignant Qwen3-8B) | **97,2 %** | 1 148 Mo |
  | Pruning 20 % (28 → 22 couches) | **17,6 %** (barre rouge) | ~1 000 Mo |
  | + LoRA de réparation (6,7 min) | 96,4 % | ~1 000 Mo |
  | GGUF Q4_K_M | 95,2 % | 324 Mo |

- **Ligne pointillée horizontale** à 90 % : « enseignant Qwen3-8B »
- **À dire** : la distillation fait passer le 0,6B au-dessus de son enseignant 8B. Le pruning casse tout (17,6 %),
  7 minutes de LoRA réparent. Puis la quantization divise la taille par 3,5.

### Slide 6 : Explicateur, quantization mesurée sur le téléphone (1 min 30) ⭐

- **Titre** : « Sans quantization, le modèle est inutilisable sur le téléphone »
- **Graphique principal** : nuage de points.
  - Axe x : temps d'une explication sur le S24 Ultra (s), de 0 à 22
  - Axe y : acceptation au collège (%), de 80 à 100
  - Couleur : non prunée / prunée ; étiquette sur chaque point

  | Point | x (s) | y (%) |
  |---|---|---|
  | F16 | 20,7 | 96,4 |
  | Q8_0 | 3,1 | 96,4 |
  | **Q4_K_M (déployé, entouré)** | 3,3 | 94,8 |
  | Prunée F16 | 18,1 | 90,8 |
  | Prunée Q8_0 | 2,6 | 92,0 |
  | Prunée Q4_K_M | 2,9 | 82,0 |

- **Petit tableau à droite** (3 lignes seulement) :

  | | Fichier | RAM | Vitesse |
  |---|---|---|---|
  | F16 | 1 192 Mo | 1 228 Mo | 14 tok/s |
  | Q8_0 | 634 Mo | 1 296 Mo | 61 tok/s |
  | **Q4_K_M** | **391 Mo** | **835 Mo** | **66 tok/s** |

- **À dire** :
  - Mesuré sur le téléphone lui-même : llama-bench lancé par adb, avec les réglages de l'app (4 fils CPU).
  - F16 met 20 secondes : la quantization est obligatoire.
  - Q4 et Q8 vont aussi vite ; Q4 est 3 fois plus petit et prend 460 Mo de RAM en moins, pour 1,6 point de moins.
  - La version prunée gagne 10 % de vitesse mais perd 13 points au collège : on l'a retirée, c'est la mesure qui a
    corrigé notre première décision.
- **Transition** : « Ces modèles ne tombent pas du ciel : voyons comment on les fabrique, les versionne et les déploie. »

---

## Partie 3 : Sujet MLOps

### Slide 7 : Données et banc d'évaluation (1 min)

- **Titre** : « Chaque décision repose sur une mesure »
- **Visuel** : une frise horizontale en 4 cases : Génération (SymPy) → Entraînement → Évaluation (jeu figé) → Registry
  MLflow. Sous chaque case, un chiffre :
  - Génération : **15 000** problèmes, **0** fuite avec l'éval
  - Entraînement : **11 793** codes + **8 567** explications vérifiées
  - Évaluation : **250** problèmes figés, 5 types × 3 difficultés
  - Registry : **5** modèles avec leur lignée · **122** runs
- **À dire** : toutes les données sont générées et vérifiées par SymPy ; un seul banc note tous les modèles (y compris
  ceux du téléphone vus plus haut) ; chaque modèle du registry connaît son parent et le hash de ses données.
- **Option** : une petite capture de la liste des runs MLflow en fond.

### Slide 8 : Modèle serveur, QLoRA et distillation (1 min)

- **Titre** : « Même justesse, 8 fois plus rapide »
- **Graphique** : barres verticales, latence p50 en secondes.

  | Modèle | Latence | Couleur |
  |---|---|---|
  | 7B brut | 3,49 s | gris |
  | 7B + QLoRA (teacher-ft) | 1,40 s | couleur principale |
  | 1,5B brut | 1,23 s | gris |
  | 1,5B distillé | **0,43 s** | couleur principale, mise en avant |

- **Sous le graphique** : « Justesse 99,6 % → 100 % · jetons générés 314 → 82 »
- **À dire** : c'est l'étape « Calcul » de la slide de contexte, côté serveur. Tous les modèles étaient déjà entre 98
  et 100 % ; le gain se lit sur la vitesse. Le QLoRA (67 min, 10,9 Go de VRAM) apprend le format : du code direct, sans
  phrases autour. Le 1,5B distillé depuis ce 7B fait 100 % en 0,43 s.

### Slide 9 : De la commande unique au déploiement continu (1 min 15)

- **Titre** : « Une commande pour lancer, un push pour déployer »
- **Visuel** : pipeline horizontal en 5 cases :
  `git push` → CI GitHub (ruff, 63 pytest, 115 Jest, image Docker) → runner sur la VM → déploiement + vérification →
  ✅ en ligne / ↩️ retour au commit précédent
- **Sous le pipeline, 3 pictos** :
  - 🖥️ VM créée par OpenTofu en ~2 min (`make vm-up`)
  - 🔑 jeton par utilisateur, stocké haché, usage suivi
  - 📦 `make up` : 10 conteneurs
- **À dire** : en local, une commande lance tout, modèles compris (servis depuis le registry). La VM est décrite en
  OpenTofu ; chaque push qui passe la CI y est déployé et vérifié par une vraie résolution, sinon retour arrière, et
  on l'a vu fonctionner en vrai.

### Slide 10 : Test de charge (1 min)

- **Titre** : « 64 utilisateurs simultanés : de 13 s à 1,7 s »
- **Graphique** : courbes, latence p95 de `/v1/solve` (s) en fonction du nombre d'utilisateurs (axe x en échelle log).

  | Utilisateurs | Avant correction | Après correction | VM (faux LLM) |
  |---|---|---|---|
  | 16 | 1,6 s | – | 0,34 s |
  | 32 | 3,1 s | 1,6 s | 0,42 s |
  | 64 | **13,3 s** | **1,7 s** | 1,3 s |
  | 128 | 27,6 s | 3,1 s | – |

- **Annotation sur la courbe** : « bac à sable 2 → 8 cœurs + OCR serveur asynchrone »
- **À dire** : Locust par paliers, résultats dans MLflow. Le test a trouvé deux goulots, corrigés ; débit à 64
  utilisateurs : 5,9 → 16,6 req/s. Sur la VM : 0 échec sur 2 533 requêtes.

### Slide 11 : MLflow, monitoring et dérive (1 min)

- **Titre** : « On mesure en continu, et on revient sur nos décisions »
- **Mise en page** : deux captures côte à côte, et une bande de chiffres en bas.
  - À gauche : le registry MLflow, modèle `explainer-0.6b-gguf` avec l'alias `champion`
  - À droite : le tableau Grafana (trafic, latence p95 par étape, usage par utilisateur)
- **Bande en bas** : « Dérive (Evidently) : trafic normal **0/6** colonnes · trafic de limites seulement **6/6** »
- **À dire** : le téléphone télécharge le modèle `champion` avec son SHA-256 : changer de modèle revient à déplacer un
  alias, sans nouvelle version de l'app. C'est le lien entre les deux sujets. Exemple réel : la version prunée a été
  dé-promue après l'éval sur les 3 niveaux.

---

## Partie 4 : Bilan

### Slide 12 : Bilan et limites (1 min)

- **Titre** : « Bilan »
- **Mise en page** : deux colonnes de cases cochées, un mot par critère, puis 3 limites en bas.
  - **Embarqué** : ✅ modèles packagés (OCR + LLM) · ✅ quantization (GGUF Q4/Q8, ONNX INT8) · ✅ comparaison taille /
    précision / vitesse sur le téléphone · ✅ meilleur compromis déployé
  - **MLOps** : ✅ une commande · ✅ VM + déploiement continu · ✅ jeton + usage · ✅ test de charge · ✅ OpenTofu ·
    ✅ app mobile · ✅ dérive · ✅ MLflow · ✅ quantization
  - **Limites** : jeu d'évaluation trop facile (98 – 100 % partout) · OCR lent sur le téléphone (~5 s) · pas de
    canary ni de Kubernetes
- **Puis** : la démo (vidéo de 30 à 45 s, ou en direct).

---

## À préparer avant de faire les slides

| Élément | Comment | Slides |
|---|---|---|
| Capture de l'écran Solution | Sur le téléphone, `-3x²+23x-30=0` imprimé ou à l'écran | 1, 3 |
| Liste des runs MLflow | `make infra-up`, puis http://localhost:5000, expérience `mathapp-weekend` | 7 |
| Registry MLflow | http://localhost:5000 → Models → `explainer-0.6b-gguf` | 11 |
| Tableau Grafana | `make up`, `make load-test USERS="8" DURATION=60` pour avoir du trafic, puis http://localhost:3000 | 11 |
| Vidéo de démo | Enregistrement d'écran du téléphone : photo → lecture → solution → explication → graphe | 12 |
| Graphiques | Faits à partir des tableaux ci-dessus (slides 4, 5, 6, 8, 10) | |
