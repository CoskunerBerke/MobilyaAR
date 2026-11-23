# Hızlı Delta Katmanı: Ön-derlenmiş Hunyuan3D-2.1 Full PBR taban imajı üzerine
#   1) textureGenPipeline.py upstream image_prompt listesi yaması
#   2) facebook/dinov2-giant fp16 (~2.1 GB) düşük RAM'li ön-gömme (çalışma anında 4.3 GB indirme sıfırlanır)
#   3) Güncel handler.py (doğrudan R2 2K PBR)
FROM ghcr.io/coskunerberke/mobilya-ar-worker@sha256:f1d78535bfd5d2a2ddd9f30e7033bcf39ea39cbe3679356bccab90c63873047b
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

# 1) textureGenPipeline.py: liste girişinde UnboundLocalError düzeltmesi
RUN python - <<'PY'
tp = "/opt/Hunyuan3D-2.1/hy3dpaint/textureGenPipeline.py"
txt = open(tp, "r", encoding="utf-8").read()
old = '''        if isinstance(image_path, str):
            image_prompt = Image.open(image_path)
        elif isinstance(image_path, Image.Image):
            image_prompt = image_path'''
new = '''        image_prompt = image_path
        if isinstance(image_path, str):
            image_prompt = Image.open(image_path)
        elif isinstance(image_path, Image.Image):
            image_prompt = image_path'''
if "image_prompt = image_path" not in txt.split("if not isinstance(image_prompt")[0]:
    assert old in txt, "image_prompt block not found"
    txt = txt.replace(old, new, 1)
    open(tp, "w", encoding="utf-8").write(txt)
print("TEXTURE_PIPELINE_PATCH_OK", flush=True)
PY

# 2) facebook/dinov2-giant ağırlıklarını doğrudan safetensors üzerinden fp16 (~2.1 GB) olarak göm
RUN mkdir -p /models/dinov2-giant && python - <<'PY'
import os
import torch
from huggingface_hub import snapshot_download
from safetensors.torch import load_file, save_file

snapshot_download(
    repo_id="facebook/dinov2-giant",
    local_dir="/models/dinov2-giant",
    allow_patterns=["config.json", "preprocessor_config.json", "model.safetensors"],
)
st_path = "/models/dinov2-giant/model.safetensors"
sd = load_file(st_path, device="cpu")
sd16 = {k: (v.half() if v.is_floating_point() and v.dtype == torch.float32 else v) for k, v in sd.items()}
save_file(sd16, st_path)
print(f"DINOV2_GIANT_FP16_READY: {os.path.getsize(st_path)/1e6:.1f} MB", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
