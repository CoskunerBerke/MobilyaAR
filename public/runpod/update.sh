#!/usr/bin/env bash
set -e
ORIGIN_URL="${1:-https://stephanie-kinda-assessment-points.trycloudflare.com}"
echo "MekanAR Oda Sunucusu v4.1.0 başlatılıyor..."
mkdir -p /workspace/hf_cache /workspace/generated_models
export HF_HOME=/workspace/hf_cache

if ! python3 -c "import cv2" >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 > /dev/null || true
fi

pip install -q -U "transformers>=4.51" accelerate safetensors fastapi uvicorn opencv-python-headless pillow
curl -fsSL "${ORIGIN_URL}/runpod/server.py" -o /workspace/server.py
pkill -f "/workspace/server.py" || true
sleep 1
nohup env HF_HOME=/workspace/hf_cache WORKSPACE_DIR=/workspace ORIGIN_URL="${ORIGIN_URL}" python3 /workspace/server.py > /workspace/server.log 2>&1 &

HEALTH_OK=0
for _ in 1 2 3 4 5 6 7 8; do
  if HEALTH_OUT=$(curl -fsS http://127.0.0.1:8000/health 2>/dev/null); then
    echo "$HEALTH_OUT"
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [ "$HEALTH_OK" -ne 1 ]; then
  echo "HATA - log:"
  tail -n 30 /workspace/server.log || true
  exit 1
fi
echo ""

if [ -d "/workspace/Hunyuan3D-2" ] && ! python3 -c "import hy3dgen, custom_rasterizer, trimesh, rembg, diffusers" >/dev/null 2>&1; then
  echo "Hunyuan3D-2 paketleri arka planda geri yükleniyor (/workspace/hy3d_restore.log)..."
  nohup bash -lc '
    export DEBIAN_FRONTEND=noninteractive
    export CUDA_HOME=/usr/local/cuda
    export PATH=$CUDA_HOME/bin:$PATH
    export LD_LIBRARY_PATH=$CUDA_HOME/lib64:$LD_LIBRARY_PATH
    export TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9"
    (command -v g++ >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq build-essential > /dev/null)) &&
    pip install -q scipy trimesh pygltflib timm rembg onnxruntime diffusers einops omegaconf pybind11 xatlas tqdm &&
    (pip install -q pymeshlab || true) &&
    pip install -q --no-build-isolation --no-deps -e /workspace/Hunyuan3D-2 &&
    pip install -q --no-build-isolation --no-deps /workspace/Hunyuan3D-2/hy3dgen/texgen/custom_rasterizer &&
    pip install -q --no-build-isolation --no-deps /workspace/Hunyuan3D-2/hy3dgen/texgen/differentiable_renderer &&
    touch /workspace/.hy3d_ready
  ' > /workspace/hy3d_restore.log 2>&1 &
fi

echo "v4.1.0 hazır (/analyze-room ve /erase-object aktif)."
