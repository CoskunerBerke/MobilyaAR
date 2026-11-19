FROM ghcr.io/coskunerberke/mobilya-ar-worker:cu128
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

WORKDIR /app
COPY handler.py postprocess.py /app/

CMD ["python", "-u", "/app/handler.py"]
