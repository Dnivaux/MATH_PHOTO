FROM python:3.12-slim
ARG MLFLOW_VERSION=3.16.1
RUN pip install --no-cache-dir "mlflow==${MLFLOW_VERSION}" psycopg2-binary boto3
EXPOSE 5000
