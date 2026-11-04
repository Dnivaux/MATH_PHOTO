# Photo → Maths

Photo d'un exercice → LaTeX → résultat **calculé et vérifié** (SymPy / code Python exécuté) → explication en français.
Les LLM traduisent et rédigent ; ils ne calculent jamais le résultat eux-mêmes. Voir le dossier projet et `docs/WEEKEND.md`.

```
datagen/      générateur SymPy (équations, systèmes, dérivées, primitives, limites) + jeux figés
eval/         banc d'évaluation unique : code, fidélité des explications, OCR, synthèse MLflow
training/     llm/ (données filtrées, QLoRA/SFT, fusion, pruning, GGUF, registry) · ocr/ (images synthétiques)
serving/      gateway/ (contrat, factice, réelle, modèles, clés et usage) · sandbox/ (AST + exécution) · llm/ · fetch_models.py
common/       config, prompts, client LLM, MLflow
infra/        setup GPU (PyTorch Blackwell, vLLM, bitsandbytes, llama.cpp), image MLflow
scripts/      maintenance ponctuelle (mlflow_hygiene.py)
.github/      CI : ruff, pytest, image de la gateway, app mobile
docs/api/     contrat v1 généré (OpenAPI, JSON Schema, exemples)
```

```bash
make infra-up && make env && make env-check   # infra + environnement GPU
make test                                     # 47 tests (bac à sable, générateur, fidélité, gateway, usage)
make mock                                     # gateway factice :8100, Authorization: Bearer dev-token
make up                                       # stack complète en une commande (modèles champion du registry)
make up-ci                                    # même stack sans GPU (faux LLM)
make help                                     # toutes les commandes
```

## Gateway

| Endpoint | Rôle |
|---|---|
| `POST /v1/solve` | LaTeX → résultat vérifié, étapes SymPy, code exécuté (ordinateur) |
| `POST /v1/explain` | explication rédigée par le serveur (mode léger) |
| `GET /v1/models/{client}/latest?role=explainer` | manifeste du `champion` du registry (URL, SHA-256, taille) |
| `GET /v1/models/files/...` | fichier du modèle (reprise de téléchargement par `Range`) |
| `/admin/...` | utilisateurs, clés hachées, usage par utilisateur (jeton `GATEWAY_ADMIN_TOKEN`) |

```bash
ADMIN=...   # GATEWAY_ADMIN_TOKEN, dans .env
curl -X POST localhost:8100/admin/users -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"name": "dae"}'
curl -X POST localhost:8100/admin/users/dae/keys -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d '{"kind": "device", "label": "Pixel 7"}'
curl "localhost:8100/admin/usage?hours=24" -H "Authorization: Bearer $ADMIN"
```

Mesures sur téléphone → MLflow : `eval/device_bench.py` (protocole en tête du fichier).
