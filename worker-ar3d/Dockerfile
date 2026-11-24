# Stüdyo 2K PBR Kalite Katmanı (0 MB ekstra ağırlık — sadece 20 KB kod yaması!):
#   1) textureGenPipeline.py: save_mesh(..., downsample=False) -> gerçek 2048x2048 2K PBR koruma!
#   2) handler.py: sıkı rembg stüdyo gölge temizliği + boyama öncesi zemin levhası temizliği +
#      yumuşak vertex NORMAL üretimi + gerçek kumaş/ahşap dielektrik PBR kalibrasyonu!
FROM ghcr.io/coskunerberke/mobilya-ar-worker@sha256:283b887d1e3beaaa66cb706c3fd84dd9eb39defa9a07e1d2f5ac0f8779749c44
LABEL org.opencontainers.image.source="https://github.com/CoskunerBerke/MobilyaAR"

RUN python - <<'PY'
tp = "/opt/Hunyuan3D-2.1/hy3dpaint/textureGenPipeline.py"
txt = open(tp, "r", encoding="utf-8").read()
txt = txt.replace(
    "self.render.save_mesh(output_mesh_path, downsample=True)",
    "self.render.save_mesh(output_mesh_path, downsample=False)",
)
open(tp, "w", encoding="utf-8").write(txt)
assert "downsample=False" in open(tp, "r", encoding="utf-8").read()
print("2K_NO_DOWNSAMPLE_PATCH_OK", flush=True)
PY

WORKDIR /app
COPY handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
