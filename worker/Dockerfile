FROM ghcr.io/coskunerberke/mobilya-ar-worker:cu128-gs
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

WORKDIR /app
COPY handler.py postprocess.py splat_trainer.py /app/

CMD ["python", "-u", "/app/handler.py"]
