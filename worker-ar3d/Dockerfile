# Stage 1: CUDA 12.4 Devel ile Hunyuan3D-2.1 custom_rasterizer (CUDA) ve mesh_inpaint_processor (C++) derleme
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
    libeigen3-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pybind11==2.13.4 ninja==1.11.1.1 wheel setuptools==69.5.1

WORKDIR /opt
RUN git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git /opt/Hunyuan3D-2.1

RUN mkdir -p /opt/wheels
WORKDIR /opt/Hunyuan3D-2.1/hy3dpaint/custom_rasterizer
RUN CUDA_NVCC_FLAGS="-allow-unsupported-compiler" \
    pip wheel --no-cache-dir --no-build-isolation --no-deps -w /opt/wheels .

WORKDIR /opt/Hunyuan3D-2.1/hy3dpaint/DifferentiableRenderer
RUN bash compile_mesh_painter.sh && ls -la mesh_inpaint_processor*.so

# Stage 2: Hafif CUDA 12.4 Runtime + Ön-Gömülü Hunyuan3D-2.1 Full PBR (Albedo + Metallic + Roughness)
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYOPENGL_PLATFORM=egl
ENV HF_HOME=/models/hf
ENV HY3DGEN_MODELS=/models/hy3d21
ENV U2NET_HOME=/models/u2net

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libgl1 \
    libglib2.0-0 \
    libegl1 \
    libopengl0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/Hunyuan3D-2.1 /opt/Hunyuan3D-2.1
COPY --from=builder /opt/wheels /opt/wheels

# Önce setuptools==69.5.1 (basicsr uyumu için), sonra Hunyuan3D-2.1 + PBR + RealESRGAN bağımlılıkları
RUN pip install --no-cache-dir setuptools==69.5.1 wheel \
    && pip install --no-cache-dir \
    runpod \
    requests \
    huggingface-hub==0.30.2 \
    safetensors==0.4.4 \
    diffusers==0.30.0 \
    transformers==4.46.0 \
    accelerate==1.1.1 \
    pytorch-lightning==1.9.5 \
    einops==0.8.0 \
    omegaconf==2.3.0 \
    pyyaml==6.0.2 \
    pybind11==2.13.4 \
    tqdm \
    timm \
    torchdiffeq \
    psutil \
    "numpy<2" \
    scipy \
    scikit-image \
    pillow \
    opencv-python-headless \
    imageio \
    trimesh==4.4.7 \
    pygltflib \
    pymeshlab \
    xatlas \
    open3d \
    rembg==2.0.65 \
    onnxruntime \
    cupy-cuda12x \
    addict \
    future \
    lmdb \
    yapf \
    && pip install --no-cache-dir --no-build-isolation --no-deps basicsr==1.4.2 realesrgan==0.3.0 \
    && pip install --no-cache-dir --no-deps /opt/wheels/*.whl \
    && rm -rf /opt/wheels

# bpy bağımlılığını opsiyonel yap (Python GLB PBR paketleyici kullanıyoruz) ve yerel model yollarını yamala
RUN python - <<'PY'
# 1) mesh_utils.py: bpy'yi opsiyonel yap
mu = "/opt/Hunyuan3D-2.1/hy3dpaint/DifferentiableRenderer/mesh_utils.py"
txt = open(mu, "r", encoding="utf-8").read()
txt = txt.replace("import bpy", "try:\n    import bpy\nexcept ImportError:\n    bpy = None", 1)
open(mu, "w", encoding="utf-8").write(txt)

# 2) multiview_utils.py: yerel /models/hy3d21 dizininden internetsiz anında yükle
mv = "/opt/Hunyuan3D-2.1/hy3dpaint/utils/multiview_utils.py"
mtxt = open(mv, "r", encoding="utf-8").read()
old_dl = '''        model_path = huggingface_hub.snapshot_download(
            repo_id=config.multiview_pretrained_path,
            allow_patterns=["hunyuan3d-paintpbr-v2-1/*"],
        )'''
new_dl = '''        if os.path.isdir(config.multiview_pretrained_path):
            model_path = config.multiview_pretrained_path
        else:
            model_path = huggingface_hub.snapshot_download(
                repo_id=config.multiview_pretrained_path,
                allow_patterns=["hunyuan3d-paintpbr-v2-1/*"],
            )'''
assert old_dl in mtxt, "multiview_utils snapshot_download block not found"
mtxt = mtxt.replace(old_dl, new_dl, 1)
open(mv, "w", encoding="utf-8").write(mtxt)

# 3) textureGenPipeline.py: upstream bug fix (len(enhance_images) == 2 yerine tüm 6 açıyı yeniden boyutlandır!)
tp = "/opt/Hunyuan3D-2.1/hy3dpaint/textureGenPipeline.py"
tptxt = open(tp, "r", encoding="utf-8").read()
tptxt = tptxt.replace("for i in range(len(enhance_images)):", 'for i in range(len(enhance_images["albedo"])):')
open(tp, "w", encoding="utf-8").write(tptxt)
print("PATCHES_OK", flush=True)
PY

# RealESRGAN x4 süper çözünürlük ağırlığını göm (64 MB)
RUN mkdir -p /opt/Hunyuan3D-2.1/hy3dpaint/ckpt \
    && curl -fSL -o /opt/Hunyuan3D-2.1/hy3dpaint/ckpt/RealESRGAN_x4plus.pth \
       https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth

# Hunyuan3D-2.1 Full PBR ağırlıklarını imaj içine göm (FlashBoot için sıfır indirme beklemesi!)
RUN mkdir -p /models/hy3d21 /models/hf /models/u2net && python - <<'PY'
import os
import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file, save_file
from rembg import new_session

snapshot_download(
    repo_id="tencent/Hunyuan3D-2.1",
    local_dir="/models/hy3d21",
    allow_patterns=[
        "hunyuan3d-dit-v2-1/**",
        "hunyuan3d-vae-v2-1/**",
        "hunyuan3d-paintpbr-v2-1/**",
    ],
    ignore_patterns=["*.md", ".gitattributes"],
)

# Büyük fp32 paintpbr UNet/Encoder ağırlıklarını fp16'ya sıkıştır (VAE fp32 korunur -> sıfır taşma!)
bin_targets = [
    "/models/hy3d21/hunyuan3d-paintpbr-v2-1/unet/diffusion_pytorch_model.bin",
    "/models/hy3d21/hunyuan3d-paintpbr-v2-1/text_encoder/pytorch_model.bin",
]
for path in bin_targets:
    if os.path.exists(path):
        sd = torch.load(path, map_location="cpu", weights_only=True)
        sd16 = {k: (v.half() if torch.is_tensor(v) and v.is_floating_point() and v.dtype == torch.float32 else v) for k, v in sd.items()}
        torch.save(sd16, path)
        print(f"fp16 compressed bin: {path} -> {os.path.getsize(path)/1e6:.1f} MB", flush=True)

st_path = "/models/hy3d21/hunyuan3d-paintpbr-v2-1/image_encoder/model.safetensors"
if os.path.exists(st_path):
    sd = load_file(st_path, device="cpu")
    sd16 = {k: (v.half() if v.is_floating_point() and v.dtype == torch.float32 else v) for k, v in sd.items()}
    save_file(sd16, st_path)
    print(f"fp16 compressed safetensors: {st_path} -> {os.path.getsize(st_path)/1e6:.1f} MB", flush=True)

new_session("u2net")
print("ALL HUNYUAN3D-2.1 FULL PBR MODELS READY", flush=True)
PY

# Derleme anı doğrulama testi: tüm kritik kütüphanelerin eksiksiz import edildiğini kanıtla
RUN python - <<'PY'
import sys
sys.path.insert(0, "/opt/Hunyuan3D-2.1")
sys.path.insert(0, "/opt/Hunyuan3D-2.1/hy3dshape")
sys.path.insert(0, "/opt/Hunyuan3D-2.1/hy3dpaint")
from torchvision_fix import apply_fix
apply_fix()
import custom_rasterizer
import DifferentiableRenderer.mesh_inpaint_processor
from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
from hy3dshape.rembg import BackgroundRemover
from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet
print("BUILD_SMOKE_TEST_OK", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
