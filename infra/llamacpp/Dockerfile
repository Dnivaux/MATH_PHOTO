# Image de build de llama.cpp avec CUDA (utilisée quand nvcc n'est pas installé sur l'hôte).
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends cmake build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
