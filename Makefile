# Photo → Maths — commandes du week-end. `make help` pour la liste.
PY := .venv/bin/python
SERVE := serving/llm/serve.sh

help:
	@grep -E '^[a-z0-9-]+:.*## ' Makefile | sed 's/:.*## /\t/' | column -t -s "$$(printf '\t')"

# ---- 1. Environnement
infra-up: ## MLflow + Postgres + MinIO (http://localhost:5000, console MinIO :9001)
	docker compose up -d --build
infra-down: ## arrête l'infra et la stack (les volumes sont conservés)
	docker compose --profile gpu --profile ci down
up: ## stack complète en une commande : infra + vLLM (champion du registry) + explicateur + gateway :8100
	docker compose --profile gpu up -d --build
up-ci: ## même stack sans GPU : faux LLM à la place des modèles
	docker compose --profile ci up -d --build
mlflow-hygiene: ## tague invalid les runs à écarter, range les alias (simulation ; APPLY=1 pour appliquer)
	$(PY) scripts/mlflow_hygiene.py $(if $(APPLY),--apply)
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

VIRSH := virsh -c qemu:///system
vm-prepare: ## une fois : pool de disques et réseau NAT par défaut de libvirt
	$(VIRSH) pool-info default >/dev/null 2>&1 || ($(VIRSH) pool-define-as default dir --target /var/lib/libvirt/images && $(VIRSH) pool-start default && $(VIRSH) pool-autostart default)
	$(VIRSH) net-info default | grep -q 'Active: *yes' || ($(VIRSH) net-start default && $(VIRSH) net-autostart default)
vm-up: ## VM de staging (OpenTofu + KVM) : Docker, stack en profil ci, runner GitHub (infra/terraform/README.md)
	cd infra/terraform && tofu init -input=false && tofu apply -auto-approve
vm-down: ## détruit la VM de staging
	cd infra/terraform && tofu destroy -auto-approve

drift: ## dérive des requêtes reçues (Evidently) ; HOURS=168, ARGS="--include-load --fail-on-drift"
	$(PY) -m eval.drift --hours $(or $(HOURS),168) $(ARGS)

load-test: ## test de charge par paliers (stack lancée : make up) ; USERS="1 4 8 16 32" DURATION=60 ; VM : HOST=http://<ip>:8100 ENV=staging
	$(PY) -m eval.load_test --users $(or $(USERS),1 4 8 16 32) --duration $(or $(DURATION),60) --host $(or $(HOST),http://localhost:8100) --env $(or $(ENV),local)

DEVICE ?= S24 Ultra
device-llm: ## vitesse et RAM des 6 GGUF sur le téléphone branché (llama-bench par adb) ; DEVICE="S24 Ultra"
	test -x third_party/llama.cpp/build-android/bin/llama-bench || infra/setup/build_llamacpp_android.sh
	$(PY) -m eval.device_kernels llm --device "$(DEVICE)"
device-ocr: ## vitesse de l'OCR INT8 / FP32 sur le téléphone (Chrome, même code WASM que l'app) ; DEVICE="S24 Ultra"
	mkdir -p eval/results && cd clients/mobile && node scripts/build-harness.mjs && node scripts/device-ocr-bench.mjs --out ../../eval/results/device-ocr.json
	$(PY) -m eval.device_kernels ocr --file eval/results/device-ocr.json --device "$(DEVICE)"

COLLECT_TMP := /tmp/photo-maths-collect
ocr-collect-import: ## scans du mode collecte de l'app -> data/ocr/real/<papier|ecran|manuscrit>/
	rm -rf $(COLLECT_TMP) && mkdir -p $(COLLECT_TMP)
	docker run --rm -v photo-maths_modelcache:/cache:ro -v $(COLLECT_TMP):/out alpine sh -c 'cp -r /cache/ocr-captures/collect/. /out/ && chown -R $(shell id -u):$(shell id -g) /out'
	$(PY) scripts/ocr_collect_import.py --src $(COLLECT_TMP)

.PHONY: help infra-up infra-down up up-ci mlflow-hygiene env llamacpp env-check test contract mock data-eval data-train eval-code eval-passk eval-explain report
