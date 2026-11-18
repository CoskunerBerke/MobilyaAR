"""
Odanda Gör — RunPod Serverless GPU worker
Gerçek oda 3D taraması: Meta MapAnything (facebook/map-anything-apache, Apache 2.0) ile
4–40 fotoğraf / video karesinden metrik 3D nokta bulutu, zemin düzlemi ve doluluk haritası çıkarır.

Girdi  (job["input"]):  {"images": ["<base64 jpeg>", ...]}
Çıktı:                   {"ok": true, "points": "<b64 int16 mm xyz>", "colors": "<b64 uint8 rgb>", ...}
"""

import base64
import os
import tempfile
import time

os.environ.setdefault("HF_HOME", "/models/hf")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import numpy as np
import runpod
import torch

from postprocess import build_room_payload

MODEL_ID = os.environ.get("MAPANYTHING_MODEL", "facebook/map-anything-apache")
MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "40"))
_MODEL = None


def get_model():
    global _MODEL
    if _MODEL is None:
        from mapanything.models import MapAnything

        t0 = time.time()
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _MODEL = MapAnything.from_pretrained(MODEL_ID).to(device).eval()
        print(f"[worker] {MODEL_ID} loaded on {device} in {time.time() - t0:.1f}s", flush=True)
    return _MODEL


def _to_np(x):
    if isinstance(x, torch.Tensor):
        return x.detach().float().cpu().numpy()
    return np.asarray(x)


def handler(job):
    t_start = time.time()
    inp = job.get("input") or {}
    images = inp.get("images") or []
    if len(images) < 4:
        return {"ok": False, "error": "En az 4 fotoğraf veya video karesi gerekli."}
    images = images[:MAX_IMAGES]

    from mapanything.utils.image import load_images

    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, b64 in enumerate(images):
            if "," in b64[:100]:
                b64 = b64.split(",", 1)[1]
            p = os.path.join(tmp, f"{i:03d}.jpg")
            with open(p, "wb") as f:
                f.write(base64.b64decode(b64))
            paths.append(p)

        views = load_images(paths)
        model = get_model()
        t_inf = time.time()
        with torch.no_grad():
            preds = model.infer(
                views,
                memory_efficient_inference=True,
                use_amp=True,
                amp_dtype="bf16",
                apply_mask=True,
                mask_edges=True,
                apply_confidence_mask=True,
                confidence_percentile=15,
            )
        infer_s = time.time() - t_inf

    pts_list, col_list, cam_list = [], [], []
    for pred in preds:
        pts = _to_np(pred["pts3d"])[0].reshape(-1, 3)
        img = _to_np(pred["img_no_norm"])[0].reshape(-1, 3)
        if img.max() <= 1.5:
            img = img * 255.0
        mask = _to_np(pred["mask"])[0].reshape(-1) > 0.5
        pts_list.append(pts[mask])
        col_list.append(np.clip(img[mask], 0, 255).astype(np.uint8))
        cam_list.append(_to_np(pred["camera_poses"])[0])

    payload = build_room_payload(
        np.concatenate(pts_list, axis=0),
        np.concatenate(col_list, axis=0),
        np.stack(cam_list, axis=0),
    )
    payload["stats"].update(
        {
            "views": len(images),
            "inferSec": round(infer_s, 2),
            "totalSec": round(time.time() - t_start, 2),
            "model": MODEL_ID,
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        }
    )
    return payload


if __name__ == "__main__":
    # Soğuk başlangıcı kısaltmak için modeli handler'dan önce belleğe al
    get_model()
    runpod.serverless.start({"handler": handler})
