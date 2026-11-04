# Gateway FastAPI (et faux LLM du profil ci). CPU seulement : le GPU est dans le conteneur vLLM.
# Contexte de build : la racine du dépôt (docker compose s'en charge).
FROM python:3.12-slim

# Mêmes versions que le venv d'entraînement ; mlflow-skinny suffit pour lire le registry.
RUN pip install --no-cache-dir \
      "sympy==1.14.0" "lark==1.2.2" "antlr4-python3-runtime==4.11.*" "pydantic==2.13.5" \
      "fastapi==0.136.3" "uvicorn[standard]==0.54.0" "httpx>=0.27" "openai==3.24.0" \
      "mlflow-skinny==3.16.1" "boto3>=1.34" "python-dotenv>=1.0" "tqdm>=4.66" \
      "sqlalchemy==2.1.3" "psycopg2-binary==2.9.*" "prometheus-client==0.26.0"

WORKDIR /app
COPY common common
COPY datagen datagen
COPY eval eval
COPY serving serving
ENV PYTHONPATH=/app MODEL_CACHE=/cache PYTHONUNBUFFERED=1

# Utilisateur non root ; /cache appartient à app pour que le volume nommé hérite des droits.
RUN useradd --create-home app && mkdir /cache && chown app /cache
USER app

EXPOSE 8100
CMD ["uvicorn", "serving.gateway.app:app", "--host", "0.0.0.0", "--port", "8100"]
