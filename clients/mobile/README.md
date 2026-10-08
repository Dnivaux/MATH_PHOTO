# App téléphone (React Native, Android)

Client mobile de Photo → Maths. Tout ce qui suit tourne **sur le téléphone, hors ligne** :

| Étape | Sur le téléphone | Détail |
|---|---|---|
| Photo | `react-native-vision-camera`, cadre redimensionnable, galerie avec recadrage | photo ~2 Mpx |
| OCR | **Texo** (20 M paramètres, ONNX, transformers.js / onnxruntime-web WASM) | modèle embarqué dans l'APK, ~0,7–1,7 s par formule |
| Validation, cas simples | CortexJS Compute Engine | exact, instantané |
| Cas courants | gabarits SymPy exécutés par Pyodide (Web Worker, délai max, analyse AST) | équations, inéquations, dérivées, intégrales, limites, sommes, mod, PGCD, PPCM, nCr, nPr, complexes… |
| Graphe | canvas interactif (déplacer, pincer pour zoomer, toucher pour lire une valeur) | courbes traduites en JavaScript par SymPy |
| Calculatrice | MathLive (saisie en 2D : fractions, puissances, racines) + clavier scientifique de l'app | produit du LaTeX pour le moteur |

**Escalade** vers la gateway (contrat v1, `serving/gateway/schema.py`) : `POST /v1/solve` quand le LaTeX est
invalide (`invalid_latex`), hors des gabarits (`out_of_local_scope`, ex. systèmes) ou si le code local échoue
(`local_code_failed`). `POST /v1/explain` pour l'explication (mode léger, en attendant le LLM de raisonnement
embarqué). Tout se règle dans l'écran ⚙︎.

## Construire l'APK

Prérequis : Node 18+, JDK 17, SDK Android (platform 34, build-tools 34.0.0, NDK 26.1.10909125, CMake 3.22.1),
`android/local.properties` avec `sdk.dir=…`.

```bash
npm install
npm run engine-assets     # télécharge ~120 Mo dans android/app/src/main/assets/engine/ (une fois)
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

`npm run engine-assets` embarque dans l'APK : le modèle OCR Texo (Hugging Face `alephpi/FormulaNet`, miroir GitHub),
transformers.js et son moteur WASM, CortexJS, Pyodide + SymPy, KaTeX et MathLive. Ces fichiers ne sont pas
versionnés (`.gitignore`). S'ils manquent, l'app les télécharge depuis le CDN au premier lancement.

## Tests

```bash
npm test                  # classification, gabarits, nettoyage de la sortie OCR, touches de la calculatrice
npx tsc --noEmit -p .
```

Avec la gateway factice du dépôt (`make mock`, port 8100, jeton `dev-token`) :
`adb reverse tcp:8100 tcp:8100`, puis URL `http://localhost:8100` dans ⚙︎.

## Organisation

```
src/engine/        moteur embarqué (WebView cachée)
  engineHtml.ts      page : CortexJS + Pyodide (Worker) + OCR, fichiers lus dans l'APK
  ocrSource.ts       OCR Texo : prétraitement (gris, correction d'éclairage, 384x384) + génération
  runnerSource.ts    runner Python : analyse AST, exécution, étapes, données du graphe
  templates.ts       classification + gabarits SymPy
  mathjsonToSympy.ts MathJSON (CortexJS) -> SymPy
  latexPreprocess.ts nettoyage du LaTeX (sortie OCR, d/dx)
  assets.ts          chemins des fichiers embarqués, repli CDN, lecture file:// dans les WebView
src/pipeline/solve.ts  local d'abord, puis escalade /v1/solve ; explication /v1/explain
src/services/api.ts    client du contrat v1
src/components/math/   calculatrice (MathLive + clavier), rendu KaTeX, graphe interactif
scripts/engine-assets.mjs
```

## Écarts avec le dossier (à discuter)

- **OCR** : Texo sert de modèle provisoire (même gabarit que le « pix2tex distillé » prévu). Il sera remplacé par
  le modèle distillé du projet en changeant `OCR_MODEL` dans `ocrSource.ts` (même format encodeur + décodeur
  ONNX). Licence de Texo : **AGPL-3.0**. Pas encore de score de confiance.
- **Pyodide sur le téléphone** : le dossier le réserve à l'ordinateur. Ici il permet de résoudre hors ligne
  bien plus que les cas « simples » (degré 2, dérivées, intégrales…) sans serveur. On peut le retirer et laisser
  ces cas au serveur si la RAM pose problème sur les petits téléphones.
- **Contrat v1** : les types `arithmetic`, `inequality`, `sum` et `expression` n'existent pas dans
  `ProblemType` ; `/v1/explain` n'est donc appelé que pour équation, dérivée, intégrale et limite.
- Pas encore : YOLO (l'utilisateur cadre la formule), LLM de raisonnement embarqué (`llama.rn`), SQLite,
  télémétrie, appairage avec l'ordinateur.
