# Odanda Gör — RunPod Serverless GPU worker (MapAnything, Apache 2.0)
FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

RUN apt-get update && apt-get install -y --no-install-recommends build-essential git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 https://github.com/facebookresearch/map-anything.git \
    && pip install --no-cache-dir -e ./map-anything \
    && pip install --no-cache-dir runpod==1.7.9 numpy

# Model ağırlıklarını imaja göm: soğuk başlangıçta indirme beklenmez
RUN python -c "from mapanything.models import MapAnything; MapAnything.from_pretrained('facebook/map-anything-apache')"

WORKDIR /app
COPY handler.py postprocess.py /app/

CMD ["python", "-u", "/app/handler.py"]
