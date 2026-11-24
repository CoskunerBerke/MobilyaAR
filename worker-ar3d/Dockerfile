# Stüdyo 2K PBR Kalite Katmanı + Garantili Open3D / libusb-1.0-0 Sistem Kütüphaneleri:
#   1) libusb-1.0-0, libxi6, libxkbcommon-x11-0 (Open3D ImportError kalıcı çözümü!)
#   2) textureGenPipeline.py: save_mesh(..., downsample=False) -> gerçek 2048x2048 2K PBR koruma!
#   3) Build-time tam import doğrulaması (open3d, pymeshlab, xatlas, cupy, Hunyuan3DPaintPipeline)
#   4) Güncel handler.py (2K PBR + R2 doğrudan yükleme + sıkı rembg temizliği)
FROM ghcr.io/coskunerberke/mobilya-ar-worker@sha256:283b887d1e3beaaa66cb706c3fd84dd9eb39defa9a07e1d2f5ac0f8779749c44
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libusb-1.0-0 \
    libxi6 \
    libxkbcommon-x11-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig

RUN python - <<'PY'
import sys
tp = "/opt/Hunyuan3D-2.1/hy3dpaint/textureGenPipeline.py"
txt = open(tp, "r", encoding="utf-8").read()
txt = txt.replace(
    "self.render.save_mesh(output_mesh_path, downsample=True)",
    "self.render.save_mesh(output_mesh_path, downsample=False)",
)
open(tp, "w", encoding="utf-8").write(txt)
assert "downsample=False" in open(tp, "r", encoding="utf-8").read()

# Derleme anında Open3D (libusb-1.0.so.0) ve tüm PBR pipeline importlarını kesin doğrula!
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
from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig
print("2K_PBR_AND_LIBUSB_OPEN3D_VERIFY_OK", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
