# Canary : à tester sur la machine GPU

## Ce qui a été ajouté

La gateway envoie une part des `/v1/solve` à `math-1.5b-distill` (10 % au démarrage), le reste au 7B + LoRA. Si le
challenger ne répond pas, le champion prend le relais. `make canary-check` compare les deux sur le trafic réel et décide :

| Décision | Quand | Effet avec `ARGS=--apply` |
|---|---|---|
| `advance` | le challenger tient la comparaison | palier suivant : 10, 25, 50, puis 100 % |
| `hold` | moins de 30 requêtes par variante | rien ne change |
| `rollback` | plus de 2 pts de résolutions vérifiées perdus, p95 LLM supérieure à 1,2 fois celle du champion, ou plus de 1 % de replis | part ramenée à 0 |

Déjà validé sans GPU : 72 tests verts, `rollback` avec un challenger faux, `advance` avec un challenger correct.
**Pas encore testé : les vrais modèles, notamment le 7B et le 1,5B ensemble en mémoire.**

## À faire

### 1. Préparer

```bash
git pull
```

Dans le `.env` :

- `GATEWAY_ADMIN_TOKEN` ne doit pas être vide ;
- si `GPU_UTIL` y figure, sa valeur ne doit pas dépasser `0.60`.

### 2. Démarrer

```bash
make up
```

Le challenger attend que le 7B soit prêt : compter plusieurs minutes. `vllm-canary` doit finir `healthy` :

```bash
docker compose --profile gpu ps
```

S'il plante, c'est sûrement la mémoire GPU. Regarder les logs, baisser `GPU_UTIL` ou `CANARY_GPU_UTIL` dans le `.env`, puis
relancer `make up` :

```bash
docker compose --profile gpu logs --tail 50 vllm-canary
```

### 3. Tester à 10 %

```bash
make load-test USERS="8" DURATION=300
```

```bash
make canary-check HOURS=0.09
```

Attendu : `advance`, le challenger à environ 100 % de résolutions vérifiées et plus rapide que le 7B.

### 4. Monter par paliers

Appliquer la décision :

```bash
make canary-check HOURS=0.09 ARGS=--apply
```

Puis, à chaque palier (25, 50, 100 %), relancer le test de charge et cette commande. Pendant ce temps, capturer la ligne
« Canary » de Grafana (http://localhost:3000) pour la présentation.

### 5. Montrer le retour arrière automatique

Sans GPU, avec un challenger volontairement faux :

```bash
make infra-down
```

```bash
FAKE_BAD_MODEL=math-1.5b-distill CANARY_WEIGHT=0.25 docker compose --profile ci up -d --build
```

```bash
LOAD_SKIP=ocr,models make load-test USERS="8" DURATION=120
```

```bash
make canary-check HOURS=0.05 ARGS=--apply
```

Attendu : `rollback` et une part ramenée à 0.

## Retour arrière manuel

```bash
curl -X PUT localhost:8100/admin/canary -H "Authorization: Bearer $(grep '^GATEWAY_ADMIN_TOKEN=' .env | cut -d= -f2)" -H 'Content-Type: application/json' -d '{"weight": 0}'
```

## À savoir

- Un redémarrage de la gateway remet la part à `CANARY_WEIGHT` : après un retour arrière, mettre aussi cette variable à 0
  dans le `.env`.
- Une part à 100 % envoie tout le trafic au 1,5B, mais ne change pas le champion. Pour que ce soit définitif, modifier
  `VLLM_MODEL` et son service.
- Le résultat affiché vient toujours de SymPy : un mauvais challenger ne provoque qu'un avertissement « non vérifié ».

## À renvoyer

La sortie de chaque `make canary-check`, pour mettre à jour `SUIVI.md`, `CHIFFRES_CLES.md` et la présentation.
