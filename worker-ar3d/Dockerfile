# 2 MB sistem kütüphanesi katmanı (Open3D -> libusb-1.0-0) + tam kapsamlı import doğrulaması
FROM ghcr.io/coskunerberke/mobilya-ar-worker@sha256:b5fe42f4d05ca556aef1ba40927abf5719e69101aa7b893c018c451edd974290
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    libxi6 \
    libxkbcommon-x11-0 \
    && rm -rf /var/lib/apt/lists/*

# Tüm PBR / Open3D / PyMeshLab / xatlas / CuPy / RealESRGAN modüllerini derleme anında test et!
RUN python - <<'PY'
import sys
sys.path.insert(0, "/opt/Hunyuan3D-2.1")
sys.path.insert(0, "/opt/Hunyuan3D-2.1/hy3dshape")
sys.path.insert(0, "/opt/Hunyuan3D-2.1/hy3dpaint")
from torchvision_fix import apply_fix
apply_fix()
import open3d
import pymeshlab
import xatlas
import cupy
import trimesh
import custom_rasterizer
import DifferentiableRenderer.mesh_inpaint_processor
from utils.simplify_mesh_utils import remesh_mesh
from utils.uvwrap_utils import mesh_uv_wrap
from utils.pipeline_utils import ViewProcessor
from utils.image_super_utils import imageSuperNet
from utils.multiview_utils import multiviewDiffusionNet
from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
print("FULL_RUNTIME_IMPORT_TEST_OK", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
