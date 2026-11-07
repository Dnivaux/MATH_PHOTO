# Service OCR serveur : TexTeller. Contexte de build : la racine du dépôt.
# TORCH_INDEX : roues CUDA (GPU, par défaut dans docker compose) ou .../whl/cpu (image légère, sans GPU).
FROM python:3.12-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu132

# torch, puis texteller sans ses dépendances d'application (ray, streamlit, click : serveur et démo du paquet) ;
# on garde ce que importe texteller.api. scipy : nettoyage de la photo (serving/ocr/preprocess.py).
RUN pip install --no-cache-dir --index-url ${TORCH_INDEX} "torch==2.15.0" "torchvision==0.29.2" \
 && pip install --no-cache-dir "transformers==4.47.0" "opencv-python-headless>=4.11" "pyclipper>=1.3" "shapely>=2.1" \
      "optimum==2.1.0" "optimum-onnx==0.1.0" "onnxruntime==1.31.1" "colorama==0.4.6" "wget==3.2" \
      "fastapi==0.136.3" "uvicorn[standard]==0.54.0" "pydantic==2.13.5" "pillow>=11" "scipy>=1.14" \
 && pip install --no-cache-dir --no-deps "texteller==1.0.2" \
 && python -c "from texteller import img2latex, load_model, load_tokenizer"

WORKDIR /app
COPY serving/__init__.py serving/__init__.py
COPY serving/ocr serving/ocr
ENV PYTHONPATH=/app PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 HF_HOME=/hf
RUN useradd --create-home app
USER app

EXPOSE 8300
CMD ["uvicorn", "serving.ocr.service:app", "--host", "0.0.0.0", "--port", "8300"]
