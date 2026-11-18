# Odanda Gör — RunPod Serverless GPU worker (MapAnything, Apache 2.0)
FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

RUN apt-get update && apt-get install -y --no-install-recommends build-essential git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN python -c 'import importlib.metadata as m; pkgs=[d.metadata["Name"]+"=="+d.version for d in m.distributions() if d.metadata["Name"].lower() in ("torch","torchvision","torchaudio")]; open("/tmp/constraints.txt","w").write("\n".join(pkgs)+"\n"); print("Pinned:", pkgs)' \
    && git clone --depth 1 https://github.com/facebookresearch/map-anything.git \
    && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cu128 -c /tmp/constraints.txt -e ./map-anything \
    && pip install --no-cache-dir -c /tmp/constraints.txt runpod==1.7.9 numpy \
    && python -c 'import torch; print("Torch:", torch.__version__, "CUDA:", torch.version.cuda); assert str(torch.version.cuda).startswith("12.8"), torch.version.cuda'

# Model ağırlıklarını imaja göm: soğuk başlangıçta indirme beklenmez
RUN python -c "from mapanything.models import MapAnything; MapAnything.from_pretrained('facebook/map-anything-apache')"

WORKDIR /app
COPY handler.py postprocess.py /app/

CMD ["python", "-u", "/app/handler.py"]
