# Stage 1: CUDA 12.4 Devel ile custom_rasterizer (CUDA) ve differentiable_renderer (C++) AOT wheel derleme
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV CUDA_HOME=/usr/local/cuda
ENV PATH=${CUDA_HOME}/bin:${PATH}
ENV LD_LIBRARY_PATH=${CUDA_HOME}/lib64:${LD_LIBRARY_PATH}
ENV TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    build-essential \
    cmake \
    ninja-build \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pybind11 ninja wheel setuptools

WORKDIR /opt
RUN git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2.git /opt/Hunyuan3D-2

RUN mkdir -p /opt/wheels
WORKDIR /opt/Hunyuan3D-2/hy3dgen/texgen/custom_rasterizer
RUN pip wheel --no-cache-dir --no-build-isolation --no-deps -w /opt/wheels .

WORKDIR /opt/Hunyuan3D-2/hy3dgen/texgen/differentiable_renderer
RUN python setup.py build_ext --inplace \
    && pip wheel --no-cache-dir --no-build-isolation --no-deps -w /opt/wheels .

# Stage 2: Hafif CUDA 12.4 Runtime + Ön-Gömülü Hunyuan3D-2 Turbo Modelleri (Hızlı FlashBoot)
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV HF_HOME=/models/hf
ENV HY3DGEN_MODELS=/models/hy3dgen
ENV U2NET_HOME=/models/u2net

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libegl1 \
    libopengl0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/Hunyuan3D-2 /opt/Hunyuan3D-2
COPY --from=builder /opt/wheels /opt/wheels

RUN pip install --no-cache-dir \
    runpod \
    huggingface_hub \
    safetensors \
    diffusers==0.31.0 \
    transformers==4.46.3 \
    accelerate==1.1.1 \
    einops \
    omegaconf \
    pybind11 \
    tqdm \
    timm \
    scipy \
    pillow \
    opencv-python-headless \
    trimesh \
    pygltflib \
    pymeshlab \
    xatlas \
    rembg \
    onnxruntime \
    && pip install --no-cache-dir --no-deps /opt/wheels/*.whl \
    && pip install --no-cache-dir --no-build-isolation --no-deps -e /opt/Hunyuan3D-2 \
    && rm -rf /opt/wheels

# Modelleri imaj içine göm: gereksiz .ckpt ve 7GB kopya unet .bin hariç, UNet/Encoder fp16 sıkıştırmalı!
RUN mkdir -p /models/hy3dgen /models/hf /models/u2net && python - <<'PY'
import os
import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file, save_file
from rembg import new_session

snapshot_download(
    repo_id="tencent/Hunyuan3D-2",
    local_dir="/models/hy3dgen/tencent/Hunyuan3D-2",
    allow_patterns=[
        "hunyuan3d-dit-v2-0-turbo/**",
        "hunyuan3d-vae-v2-0-turbo/**",
        "hunyuan3d-delight-v2-0/**",
        "hunyuan3d-paint-v2-0-turbo/**",
    ],
    ignore_patterns=[
        "*.ckpt",
        "*.md",
        ".gitattributes",
        "hunyuan3d-paint-v2-0-turbo/unet/diffusion_pytorch_model.bin",
    ],
)

snapshot_download(
    repo_id="tencent/Hunyuan3D-2mv",
    local_dir="/models/hy3dgen/tencent/Hunyuan3D-2mv",
    allow_patterns=["hunyuan3d-dit-v2-mv-turbo/**"],
    ignore_patterns=["*.ckpt", "*.md", ".gitattributes"],
)

# Büyük fp32 UNet / encoder ağırlıklarını fp16'ya sıkıştır (VAE fp32 korunur -> sıfır taşma!)
fp16_targets = [
    "/models/hy3dgen/tencent/Hunyuan3D-2/hunyuan3d-delight-v2-0/unet/diffusion_pytorch_model.safetensors",
    "/models/hy3dgen/tencent/Hunyuan3D-2/hunyuan3d-delight-v2-0/text_encoder/model.safetensors",
    "/models/hy3dgen/tencent/Hunyuan3D-2/hunyuan3d-paint-v2-0-turbo/unet/diffusion_pytorch_model.safetensors",
    "/models/hy3dgen/tencent/Hunyuan3D-2/hunyuan3d-paint-v2-0-turbo/image_encoder/model.safetensors",
]
for path in fp16_targets:
    if os.path.exists(path):
        sd = load_file(path, device="cpu")
        sd16 = {k: (v.half() if v.is_floating_point() and v.dtype == torch.float32 else v) for k, v in sd.items()}
        save_file(sd16, path)
        print(f"fp16 compressed: {path} -> {os.path.getsize(path)/1e6:.1f} MB", flush=True)

# Arka plan temizleyici (u2net) önbelleğini göm
new_session("u2net")
print("ALL HUNYUAN3D-2 TURBO MODELS READY", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
