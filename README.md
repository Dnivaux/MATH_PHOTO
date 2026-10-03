# Photo → Maths

Photo d'un exercice → LaTeX → résultat **calculé et vérifié** (SymPy / code Python exécuté) → explication en français.
Les LLM traduisent et rédigent ; ils ne calculent jamais le résultat eux-mêmes. Voir le dossier projet et `docs/WEEKEND.md`.

```
datagen/      générateur SymPy (équations, systèmes, dérivées, primitives, limites) + jeux figés
eval/         banc d'évaluation unique : code, fidélité des explications, OCR, synthèse MLflow
training/     llm/ (données filtrées, QLoRA/SFT, fusion, pruning, GGUF, registry) · ocr/ (images synthétiques)
serving/      gateway/ (contrat d'API, factice, réelle) · sandbox/ (AST + exécution isolée) · llm/ (vLLM, llama-server)
common/       config, prompts, client LLM, MLflow
infra/        setup GPU (PyTorch Blackwell, vLLM, bitsandbytes, llama.cpp), image MLflow
docs/api/     contrat v1 généré (OpenAPI, JSON Schema, exemples)
```

```bash
make infra-up && make env && make env-check   # infra + environnement GPU
make test                                     # 38 tests (bac à sable, générateur, fidélité, gateway)
make mock                                     # gateway factice :8100, Authorization: Bearer dev-token
make help                                     # toutes les commandes
```
