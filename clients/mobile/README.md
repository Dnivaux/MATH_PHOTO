# App téléphone (React Native, Android)

Client mobile de Photo → Maths, aligné sur le dossier projet (« Version téléphone »).

| Étape | Sur le téléphone | Détail |
|---|---|---|
| Photo | `react-native-vision-camera`, cadre redimensionnable, galerie avec recadrage | photo ~2 Mpx, elle ne quitte pas le téléphone |
| OCR | **pix2tex** (MIT) exporté en ONNX, poids INT8, sur onnxruntime-web (WASM) | 32 Mo, score de confiance par formule |
| Cas simples | **CortexJS** : arithmétique, fractions, puissances, racines, équation du premier degré | exact, hors ligne, étapes au format du générateur du serveur |
| Cas complexes | gateway `POST /v1/solve` : second degré, systèmes, dérivées, primitives, limites | hors ligne : mis en file d'attente, envoyés au retour du réseau |
| Explication | **LLM de raisonnement** Qwen3-0.6B distillé (GGUF Q4_K_M) via `llama.rn` | mode complet ; en mode léger `POST /v1/explain` |
| Vérification | chaque égalité de l'explication est revérifiée (portage de `eval/faithfulness.py`) | nombres absents des étapes signalés |
| Graphe | interactif, courbes compilées en JavaScript par CortexJS | déplacer, pincer, toucher pour lire une valeur |
| Calculatrice | MathLive (saisie en 2D) + clavier de l'app | aperçu du résultat en direct |
| Stockage | SQLite (`op-sqlite`) : réglages, historique, file d'attente, mesures | |

Le téléphone n'affiche pas de code Python et n'embarque pas Pyodide (dossier : RAM sous 1 Go).

**Escalade** (contrat v1, `serving/gateway/schema.py`) : `invalid_latex`, `out_of_local_scope`, `ocr_low_confidence`
(confiance OCR sous le seuil réglable), `user_request` (« Faire vérifier par le serveur »). L'app envoie
`client.mode` = `complet` ou `leger` (recommandation selon la RAM : léger sous 6 Go).

## Construire l'APK

Prérequis : Node 18+, JDK 17, SDK Android (platform 34, build-tools 34.0.0, NDK 26.1.10909125, CMake 3.22.1),
`android/local.properties` avec `sdk.dir=…`, et `uv` pour l'export de l'OCR.

```bash
npm install
(cd scripts/pix2tex && uv run export_onnx.py)   # une fois : poids pix2tex -> ONNX INT8, validé contre PyTorch
npm run engine-assets                            # copie ~45 Mo dans android/app/src/main/assets/engine/
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

`npm run engine-assets` copie depuis `node_modules` (versions figées) et depuis l'export pix2tex : CortexJS,
onnxruntime-web, KaTeX, MathLive, CMU Serif (police des explications) et le modèle OCR. Aucune page ne charge de
script distant.

### Modèle d'explication

Il n'est pas dans l'APK (environ 340 Mo). Réglages → Modèle d'explication → Installer : l'app le demande à la
gateway (`GET /v1/models/android/latest?role=explainer`, pas encore dans la gateway) ou à l'adresse directe des
réglages développeur, puis vérifie son SHA-256. Copie manuelle :

```bash
adb push explainer-0.6b-p20-q4_k_m.gguf /sdcard/Android/data/com.photomathclone/files/models/explainer.gguf
```

Le prompt est celui de l'entraînement (`common/prompts.py`, gabarit Qwen3 sans thinking) ; un test le compare
à la sortie Python.

## Tests

```bash
npm test                  # moteur (CortexJS réel), fidélité, prompt, OCR, touches
npx tsc --noEmit -p .
npm run lint
node scripts/build-harness.mjs && node scripts/build-ui-harness.mjs   # bancs navigateur (OCR JS = Python, pages)
```

Gateway de test : la factice du dépôt (`make mock`) renvoie toujours le même exemple, quelle que soit la formule
(l'app écarte alors la réponse : « le serveur a répondu pour une autre formule »). Pour tester avec de vraies
réponses sans GPU, `scripts/dev_gateway.py` résout chaque problème avec `datagen/from_latex.py` (SymPy seul, réponses
marquées « non confirmées ») :

```bash
PYTHONPATH=../../MATH_PHOTO uv run --no-project --python 3.12 --with sympy --with lark --with 'antlr4-python3-runtime==4.11.*' --with pydantic --with fastapi --with 'uvicorn[standard]' uvicorn --app-dir scripts dev_gateway:app --port 8100
```

Puis `adb reverse tcp:8100 tcp:8100` et `http://localhost:8100` dans Réglages → Outils de développement
(émulateur : `http://10.0.2.2:8100` sans `adb reverse`).

## Organisation

```
src/theme/             tokens (clair / sombre), contrastes AA vérifiés
src/components/ui/     en-tête, boutons, puces, bandeaux, snackbar (Material 3)
src/engine/            moteur embarqué (WebView cachée)
  mathSource.ts          analyse, calcul exact, étapes, vérification des explications (CortexJS)
  ocrSource.ts           OCR pix2tex : éclairage, rééchantillonnage identique à Pillow, décodage glouton
src/explain/           explainer : prompt, modèle (téléchargement, SHA-256), llama.rn
src/pipeline/          résolution, explication, file d'attente hors ligne
src/components/solution/ page de solution (une WebView : résultat encadré, démarche, graphe, explication)
src/storage/db.ts      SQLite
scripts/pix2tex/       export ONNX de pix2tex et images de test
```

## Limites connues

- pix2tex de départ, non fine-tuné sur des photos : il se trompe sur les photos difficiles, mais sa confiance
  baisse alors, ce qui déclenche le contrôle par le serveur. Le modèle distillé de la phase 3A le remplacera sans
  changer l'app (même format de fichiers). Le seuil de confiance est à calibrer sur la planche de 50 photos.
- Pas encore : YOLO (l'élève cadre la formule), télémétrie vers la gateway (mesures locales seulement),
  appairage avec l'ordinateur, endpoint `/v1/models` côté gateway.
