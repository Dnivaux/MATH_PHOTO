#!/usr/bin/env bash
# llama-bench pour Android arm64 (NDK), pour mesurer les GGUF sur le téléphone par adb (eval/device_kernels.py).
# Même llama.cpp que le PC (third_party/llama.cpp), CPU seul comme l'app (llama.rn, n_gpu_layers = 0).
#   infra/setup/build_llamacpp_android.sh        -> third_party/llama.cpp/build-android/bin/llama-bench
set -euo pipefail
cd "$(dirname "$0")/../.."
NDK="${ANDROID_NDK_HOME:-$(ls -d "$HOME"/Android/Sdk/ndk/* | sort -V | tail -1)}"
B=third_party/llama.cpp/build-android
cmake -S third_party/llama.cpp -B "$B" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-28 \
  -DCMAKE_C_FLAGS="-march=armv8.7a" -DCMAKE_CXX_FLAGS="-march=armv8.7a" \
  -DGGML_OPENMP=OFF -DGGML_LLAMAFILE=OFF -DLLAMA_CURL=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$B" --target llama-bench -j "$(nproc)"
echo "$B/bin/llama-bench"
