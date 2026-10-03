#!/usr/bin/env bash
# Phase 1 — llama.cpp compilé avec CUDA pour la 5090 (sm_120), plus un venv dédié à la conversion GGUF.
# Prérequis (Arch / Omarchy) : sudo pacman -S cuda   (CUDA 13.x dans /opt/cuda, compilateur hôte gcc15)
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p third_party
[ -d third_party/llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp third_party/llama.cpp
cd third_party/llama.cpp

# Équivalent de /etc/profile.d/cuda.sh, qui dépend de append_path (défini seulement dans /etc/profile)
if [ -x /opt/cuda/bin/nvcc ]; then
  export CUDA_PATH=/opt/cuda PATH="/opt/cuda/bin:$PATH"
  export NVCC_CCBIN="${NVCC_CCBIN:-/usr/bin/g++-15}"
fi
if command -v nvcc >/dev/null; then
  HOST_CXX="${NVCC_CCBIN:-$(command -v g++-15 || command -v g++)}"
  echo "nvcc $(nvcc --version | tail -1) ; compilateur hôte $HOST_CXX"
  cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120 -DCMAKE_CUDA_HOST_COMPILER="$HOST_CXX" \
        -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
  cmake --build build -j"$(nproc)" --target llama-cli llama-server llama-quantize llama-imatrix llama-bench
else
  # Pas de nvcc sur l'hôte (sudo pacman -S cuda) : build dans un conteneur CUDA 13.0, puis copie des
  # bibliothèques CUDA à côté des binaires (rpath), qui tournent ensuite directement sur l'hôte.
  echo "nvcc introuvable : build CUDA dans un conteneur nvidia/cuda"
  docker build -q -t llamacpp-builder ../../infra/llamacpp
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/src" -w /src llamacpp-builder bash -c '
    cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=120 -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF \
          -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON -DCMAKE_INSTALL_RPATH="\$ORIGIN:\$ORIGIN/../cuda-libs" &&
    cmake --build build -j$(nproc) --target llama-cli llama-server llama-quantize llama-imatrix llama-bench &&
    mkdir -p build/cuda-libs &&
    cp -L /usr/local/cuda/lib64/libcudart.so.13 /usr/local/cuda/lib64/libcublas.so.13 /usr/local/cuda/lib64/libcublasLt.so.13 build/cuda-libs/'
fi

# venv séparé pour convert_hf_to_gguf.py (ses dépendances épinglent torch/transformers différemment)
UV="uv"; uv --version >/dev/null 2>&1 || UV="mise x uv@latest -- uv"
[ -d ../../.venv-llamacpp ] || $UV venv ../../.venv-llamacpp --python 3.12
$UV pip install --python ../../.venv-llamacpp/bin/python -r requirements/requirements-convert_hf_to_gguf.txt \
    --index-strategy unsafe-best-match

# Test minimal : un petit GGUF, toutes les couches sur le GPU.
TEST=../../models/gguf/test-qwen2.5-0.5b-q4_k_m.gguf
mkdir -p ../../models/gguf
[ -f "$TEST" ] || ../../.venv/bin/hf download Qwen/Qwen2.5-0.5B-Instruct-GGUF qwen2.5-0.5b-instruct-q4_k_m.gguf \
    --local-dir ../../models/gguf && mv ../../models/gguf/qwen2.5-0.5b-instruct-q4_k_m.gguf "$TEST"
./build/bin/llama-bench -m "$TEST" -ngl 99 -p 256 -n 64
echo "Si la colonne backend affiche CUDA avec des t/s élevés : llama.cpp fonctionne sur la 5090."
