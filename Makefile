# Photo → Maths — commandes du week-end. `make help` pour la liste.
PY := .venv/bin/python
SERVE := serving/llm/serve.sh

help:
	@grep -E '^[a-z0-9-]+:.*## ' Makefile | sed 's/:.*## /\t/' | column -t -s "$$(printf '\t')"

# ---- 1. Environnement
infra-up: ## MLflow + Postgres + MinIO (http://localhost:5000, console MinIO :9001)
	docker compose up -d --build
infra-down: ## arrête l'infra (les volumes sont conservés)
	docker compose down
env: ## venv GPU : PyTorch Blackwell, vLLM, bitsandbytes, TRL
	infra/setup/setup_env.sh
llamacpp: ## llama.cpp avec CUDA sm_120 (après `sudo pacman -S cuda`)
	infra/setup/build_llamacpp.sh
env-check: ## un test minimal par outil, résultat dans MLflow (run env-check)
	$(PY) infra/setup/check_gpu.py
test: ## tests unitaires (bac à sable, générateur, fidélité, gateway)
	$(PY) -m pytest -q

# ---- 2. Contrat d'API
contract: ## régénère docs/api/ et les exemples de la gateway factice
	$(PY) -m serving.gateway.export_contract
mock: ## gateway factice sur :8100 (jeton : dev-token)
	.venv/bin/uvicorn serving.gateway.mock:app --host 0.0.0.0 --port 8100

# ---- 3. Données
data-eval: ## jeu d'évaluation figé (250 problèmes)
	$(PY) -m datagen.build_sets eval --per-type 50
data-train: ## pool d'entraînement disjoint (15 000 problèmes)
	$(PY) -m datagen.build_sets train --per-type 3000

# ---- 4. Baselines (le serveur vLLM doit tourner : make serve-<modèle> dans un autre terminal)
serve-math-1.5b: ; $(SERVE) math-1.5b
serve-math-7b: ; $(SERVE) math-7b
serve-qwen3-0.6b: ; $(SERVE) qwen3-0.6b
serve-qwen3-1.7b: ; $(SERVE) qwen3-1.7b
serve-qwen3-8b: ; $(SERVE) qwen3-8b
serve-teacher-ft: ; $(SERVE) teacher-ft
eval-code: ## make eval-code NAME=baseline-7b ROLE=baseline  (greedy ; modèle servi sur :8000)
	$(PY) -m eval.run_eval code --run-name $(NAME) --role $(or $(ROLE),baseline)
eval-passk: ## make eval-passk NAME=baseline-7b-pass4  (4 échantillons à T=0.7)
	$(PY) -m eval.run_eval code --run-name $(NAME) --role $(or $(ROLE),baseline) --n 4 --temperature 0.7
eval-explain: ## make eval-explain NAME=baseline-qwen3-0.6b ROLE=baseline
	$(PY) -m eval.run_eval explain --run-name $(NAME) --role $(or $(ROLE),baseline) --levels college,lycee,superieur --no-think --temperature 0.3

# ---- 10. Fin
report: ## tableau de synthèse depuis MLflow
	$(PY) -m eval.report

.PHONY: help infra-up infra-down env llamacpp env-check test contract mock data-eval data-train eval-code eval-passk eval-explain report
