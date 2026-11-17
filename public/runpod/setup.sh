#!/usr/bin/env bash
set -e

ORIGIN_URL="${1:-https://stephanie-kinda-assessment-points.trycloudflare.com}"

echo "============================================================"
echo "🚀 MekanAR RunPod 48GB GPU Kurulumu Başlıyor..."
echo "Kaynak: ${ORIGIN_URL}"
echo "============================================================"

mkdir -p /workspace/hf_cache /workspace/generated_models
export DEBIAN_FRONTEND=noninteractive
export HF_HOME=/workspace/hf_cache
export CUDA_HOME=/usr/local/cuda
export PATH=$CUDA_HOME/bin:$PATH
export LD_LIBRARY_PATH=$CUDA_HOME/lib64:$LD_LIBRARY_PATH
export TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9"

echo "[1/4] Sistem paketleri kontrol ediliyor..."
apt-get update -qq
apt-get install -y -qq git build-essential cmake ninja-build libgl1 libglib2.0-0 curl > /dev/null

echo "[2/4] 3D Oda Derinlik & Yüzey Analiz kütüphaneleri kuruluyor..."
pip install -q --upgrade fastapi uvicorn pillow opencv-python-headless scipy trimesh pygltflib "transformers>=4.51" accelerate safetensors timm rembg onnxruntime

echo "[3/4] MekanAR GPU API Sunucusu (Port 8000) indiriliyor ve başlatılıyor..."
curl -fsSL "${ORIGIN_URL}/runpod/server.py" -o /workspace/server.py

pkill -f "/workspace/server.py" || true
sleep 1
nohup env HF_HOME=/workspace/hf_cache WORKSPACE_DIR=/workspace ORIGIN_URL="${ORIGIN_URL}" python3 /workspace/server.py > /workspace/server.log 2>&1 &
sleep 3

echo "✅ Port 8000 API Sunucusu Başlatıldı! Durum kontrolü:"
curl -s http://127.0.0.1:8000/health || true
echo ""

echo "[4/4] Tencent Hunyuan3D-2 (48GB Yüksek Kaliteli PBR 3D Üretim Motoru) kuruluyor..."
pip install -q diffusers einops omegaconf pybind11 xatlas tqdm
pip install -q pymeshlab || true

if [ ! -d "/workspace/Hunyuan3D-2" ]; then
  git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2.git /workspace/Hunyuan3D-2
fi

cd /workspace/Hunyuan3D-2
pip install -q --no-build-isolation --no-deps -e .

echo "   -> custom_rasterizer CUDA çekirdeği derleniyor (RTX A6000 SM 8.6)..."
cd /workspace/Hunyuan3D-2/hy3dgen/texgen/custom_rasterizer
pip install -q --no-build-isolation --no-deps .

echo "   -> differentiable_renderer C++ modülü derleniyor..."
cd /workspace/Hunyuan3D-2/hy3dgen/texgen/differentiable_renderer
pip install -q --no-build-isolation --no-deps .

touch /workspace/.hy3d_ready

echo "============================================================"
echo "✅✅ KURULUM %100 TAMAMLANDI!"
echo "🟢 Canlı RunPod GPU API Adresiniz (Port 8000) HAZIR!"
echo "Logları izlemek isterseniz: tail -f /workspace/server.log"
echo "============================================================"
