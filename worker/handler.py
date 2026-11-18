"""
Odanda Gör — RunPod Serverless GPU worker
Gerçek oda 3D taraması: Meta MapAnything (facebook/map-anything-apache, Apache 2.0) ile
4–40 fotoğraf / video karesinden katı TSDF + Surface Nets 3D oda yüzeyi,
zemin düzlemi, 10 cm doluluk haritası ve HD kamera derinlik maskeleri çıkarır.

Girdi  (job["input"]):  {"images": ["<base64 jpeg>", ...]}
Çıktı:                   {"ok": true, "mesh": {...}, "keyframes": [...], ...}
"""

import base64
import os
import tempfile
import time
import traceback

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

    try:
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
                    apply_confidence_mask=False,
                )
            infer_s = time.time() - t_inf

        views_data = []
        for pred in preds:
            pts = _to_np(pred["pts3d"])[0]  # (H, W, 3)
            H, W = pts.shape[:2]
            img = _to_np(pred["img_no_norm"])[0]
            if img.ndim == 3 and img.shape[0] == 3 and img.shape[-1] != 3:
                img = np.transpose(img, (1, 2, 0))
            if img.max() <= 1.5:
                img = img * 255.0
            rgb_u8 = np.clip(img, 0, 255).astype(np.uint8)
            mask = _to_np(pred["mask"])[0].reshape(H, W) > 0.5
            pose = _to_np(pred["camera_poses"])[0]  # (4, 4) cam2world RDF
            if "depth_z" in pred:
                depth_z = _to_np(pred["depth_z"])[0].reshape(H, W)
            else:
                depth_z = ((pts - pose[:3, 3]) @ pose[:3, 2]).astype(np.float32)
            if "intrinsics" in pred:
                K = _to_np(pred["intrinsics"])[0]
            else:
                f = 0.85 * max(H, W)
                K = np.array([[f, 0, W / 2.0], [0, f, H / 2.0], [0, 0, 1.0]], dtype=np.float32)
            views_data.append(
                {
                    "pts3d": pts,
                    "rgb": rgb_u8,
                    "mask": mask,
                    "depth_z": depth_z,
                    "K": K,
                    "pose": pose,
                }
            )

        payload = build_room_payload(views_data, enable_gs=True)
        if payload.get("ok"):
            payload["stats"].update(
                {
                    "views": len(images),
                    "inferSec": round(infer_s, 2),
                    "totalSec": round(time.time() - t_start, 2),
                    "model": MODEL_ID,
                    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
                }
            )
            print(
                f"[worker] Tamamlandı: views={len(images)} infer={infer_s:.1f}s "
                f"gs={payload['stats'].get('gsSec', 0)}s splats={payload['stats'].get('splatCount', 0)} "
                f"total={payload['stats']['totalSec']}s",
                flush=True,
            )
        return payload
    except Exception as exc:
        traceback.print_exc()
        return {"ok": False, "error": f"3D oda hesaplama hatası ({type(exc).__name__}): {exc}"}


if __name__ == "__main__":
    get_model()
    runpod.serverless.start({"handler": handler})
