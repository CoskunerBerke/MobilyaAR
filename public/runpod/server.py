"""
MekanAR Oda Sunucusu v6.0.0 (IKEA Kreativ tarzı + Çoklu Açı 3D Oda Modelleme)

Özellikler:
  - /analyze-room     : Apple Depth Pro metrik derinlik & lens odak uzaklığı + SegFormer zemin maskesi + RANSAC zemin düzlemi
  - /reconstruct-room : 2-6 fotoğrafla çoklu açı SIFT+RANSAC+Manhattan hizalama, Winner-Take-All zemin dokusu, temiz duvarlar ve katı 3D eşyalar
  - /erase-object     : SegFormer tek dokunuşla eşya tespiti + LaMa GPU inpainting + otomatik yeniden oda analizi
  - /generate-3d      : Hunyuan3D-2 (veya Hunyuan3D-2mv) ile 48GB GPU üzerinde gerçek ölçülü, y=0 tabanlı PBR .GLB üretimi
  - /upload-glb       : Doğrudan CAD .GLB yükleme ve barındırma
  - /admin/reload     : ORIGIN_URL üzerinden uzaktan sıfır müdahaleli güncelleme
"""

import base64
import io
import json
import math
import os
import re
import struct
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, ImageOps
from pydantic import BaseModel

VERSION = "6.0.0"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
HF_CACHE_DIR = Path(os.environ.get("HF_HOME", str(WORKSPACE_DIR / "hf_cache")))
MODELS_OUT_DIR = WORKSPACE_DIR / "generated_models"
HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
MODELS_OUT_DIR.mkdir(parents=True, exist_ok=True)
ORIGIN_URL = os.environ.get("ORIGIN_URL", "").rstrip("/")

LAMA_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"
LAMA_PATH = HF_CACHE_DIR / "big-lama.pt"

app = FastAPI(title="MekanAR Room Server", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

M = {
    "depth_proc": None,
    "depth_model": None,
    "seg_proc": None,
    "seg_model": None,
    "lama": None,
    "hy3d_shape_single": None,
    "hy3d_shape_mv": None,
    "hy3d_paint": None,
    "hy3d_rembg": None,
    "hy3d_ready": False,
}
_MODEL_LOCK = threading.Lock()
_LAMA_LOCK = threading.Lock()
_HY3D_LOCK = threading.Lock()

FLOOR_LABELS = {"floor", "flooring", "rug", "carpet", "mat"}
STRUCTURAL_LABELS = {"wall", "floor", "flooring", "ceiling", "windowpane", "door"}
MOVABLE_OBJECT_LABELS = {
    "sofa",
    "armchair",
    "chair",
    "swivel chair",
    "table",
    "coffee table",
    "desk",
    "bed",
    "cabinet",
    "chest of drawers",
    "buffet",
    "sideboard",
    "shelf",
    "bookcase",
    "wardrobe",
    "closet",
    "ottoman",
    "stool",
    "bench",
    "cushion",
    "pillow",
    "blanket",
    "apparel",
    "clothes",
    "lamp",
    "chandelier",
    "light",
    "sconce",
    "plant",
    "pot",
    "flower",
    "vase",
    "television receiver",
    "monitor",
    "computer",
    "crt screen",
    "screen",
    "laptop",
    "book",
    "bag",
    "box",
    "basket",
    "toy",
    "bottle",
    "plate",
    "tray",
    "fan",
    "radiator",
    "heater",
    "clock",
    "painting",
    "poster",
    "mirror",
    "curtain",
    "drape",
    "blind",
    "person",
}
FURNITURE_KIND_MAP = {
    "bed": "bed",
    "sofa": "sofa",
    "armchair": "armchair",
    "ottoman": "armchair",
    "bench": "armchair",
    "desk": "desk",
    "table": "table",
    "coffee table": "coffee_table",
    "chair": "chair",
    "swivel chair": "chair",
    "stool": "chair",
    "bookcase": "bookcase",
    "shelf": "bookcase",
    "cabinet": "cabinet",
    "chest of drawers": "cabinet",
    "buffet": "cabinet",
    "sideboard": "cabinet",
    "wardrobe": "cabinet",
    "closet": "cabinet",
    "television receiver": "tv",
}
FURNITURE_SIZE_BOUNDS = {
    "bed": (0.85, 2.20, 0.42, 1.15, 1.60, 2.25),
    "sofa": (1.30, 2.80, 0.68, 1.05, 0.75, 1.45),
    "armchair": (0.55, 1.15, 0.55, 1.05, 0.55, 1.05),
    "desk": (0.90, 2.00, 0.70, 0.85, 0.50, 0.90),
    "table": (0.85, 2.20, 0.70, 0.85, 0.65, 1.25),
    "coffee_table": (0.55, 1.40, 0.32, 0.55, 0.45, 0.95),
    "chair": (0.45, 0.72, 0.68, 1.15, 0.45, 0.72),
    "bookcase": (0.55, 1.80, 0.90, 2.25, 0.26, 0.50),
    "cabinet": (0.55, 1.80, 0.65, 2.20, 0.32, 0.68),
    "tv": (0.75, 1.65, 0.48, 1.05, 0.08, 0.25),
}

LABEL_TR = {
    "sofa": "Koltuk",
    "armchair": "Berjer",
    "chair": "Sandalye",
    "swivel chair": "Döner Sandalye",
    "table": "Masa",
    "coffee table": "Orta Sehpa",
    "desk": "Çalışma Masası",
    "bed": "Yatak",
    "cabinet": "Dolap",
    "chest of drawers": "Şifonyer",
    "buffet": "Konsol",
    "sideboard": "Konsol",
    "shelf": "Raf",
    "bookcase": "Kitaplık",
    "wardrobe": "Gardırop",
    "closet": "Dolap",
    "ottoman": "Puf",
    "stool": "Tabure",
    "bench": "Bank",
    "cushion": "Yastık",
    "pillow": "Yastık",
    "blanket": "Örtü",
    "apparel": "Kıyafet",
    "clothes": "Kıyafet",
    "lamp": "Lamba",
    "plant": "Bitki",
    "pot": "Saksı",
    "vase": "Vazo",
    "television receiver": "Televizyon",
    "monitor": "Monitör",
    "computer": "Bilgisayar",
    "crt screen": "Ekran",
    "screen": "Ekran",
    "laptop": "Dizüstü",
    "book": "Kitap",
    "bag": "Çanta",
    "box": "Kutu",
    "basket": "Sepet",
    "person": "Kişi",
}


def load_models():
    if M["depth_model"] is not None and M["seg_model"] is not None:
        return
    with _MODEL_LOCK:
        if M["depth_model"] is not None and M["seg_model"] is not None:
            return
        from transformers import (
            DepthProForDepthEstimation,
            DepthProImageProcessorFast,
            SegformerForSemanticSegmentation,
            SegformerImageProcessor,
        )

        t0 = time.time()
        M["depth_proc"] = DepthProImageProcessorFast.from_pretrained("apple/DepthPro-hf")
        M["depth_model"] = DepthProForDepthEstimation.from_pretrained("apple/DepthPro-hf").to(DEVICE).eval()
        seg_id = "nvidia/segformer-b5-finetuned-ade-640-640"
        M["seg_proc"] = SegformerImageProcessor.from_pretrained(seg_id)
        M["seg_model"] = SegformerForSemanticSegmentation.from_pretrained(seg_id).to(DEVICE).eval()
        print(f"[v{VERSION}] DepthPro + SegFormer loaded in {time.time() - t0:.1f}s", flush=True)


def load_lama():
    if M["lama"] is not None:
        return M["lama"]
    with _LAMA_LOCK:
        if M["lama"] is not None:
            return M["lama"]
        t0 = time.time()
        if not LAMA_PATH.exists() or LAMA_PATH.stat().st_size < 100_000_000:
            tmp_path = LAMA_PATH.with_suffix(".pt.tmp")
            print(f"[v{VERSION}] Downloading big-lama.pt to {LAMA_PATH}...", flush=True)
            req = urllib.request.Request(LAMA_URL, headers={"User-Agent": "mekanar/4.1"})
            with urllib.request.urlopen(req, timeout=180) as resp, open(tmp_path, "wb") as out_f:
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    out_f.write(chunk)
            tmp_path.replace(LAMA_PATH)
        lama_model = torch.jit.load(str(LAMA_PATH), map_location=DEVICE)
        lama_model.eval()
        M["lama"] = lama_model
        print(f"[v{VERSION}] LaMa TorchScript loaded in {time.time() - t0:.1f}s", flush=True)
        return lama_model


def decode_image(data: str, mode: str = "RGB") -> Image.Image:
    if data.startswith("http://") or data.startswith("https://"):
        req = urllib.request.Request(data, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
    else:
        if data.startswith("data:"):
            data = data.split(",", 1)[1]
        raw = base64.b64decode(data)
    img = Image.open(io.BytesIO(raw))
    img = ImageOps.exif_transpose(img)
    return img.convert(mode)


def png_data_url(arr: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def jpeg_data_url(img: Image.Image, quality: int = 92) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, subsampling=0)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def ransac_plane(pts: np.ndarray, iters: int = 600, thresh: float = 0.025):
    """pts: Nx3 (OpenCV kamera ekseni: x sağ, y aşağı, z ileri). Döner: n (birim), d, inlier_ratio"""
    rng = np.random.default_rng(0)
    n_pts = pts.shape[0]
    best_inl = None
    best_count = 0
    for _ in range(iters):
        idx = rng.choice(n_pts, 3, replace=False)
        p0, p1, p2 = pts[idx]
        n = np.cross(p1 - p0, p2 - p0)
        ln = np.linalg.norm(n)
        if ln < 1e-8:
            continue
        n = n / ln
        # Zemin normali kabaca "yukarı" (OpenCV'de -y) bakmalı: dik duvarları ele
        if abs(n[1]) < 0.5:
            continue
        d = -float(n @ p0)
        inl = np.abs(pts @ n + d) < thresh
        c = int(inl.sum())
        if c > best_count:
            best_count = c
            best_inl = inl
    if best_inl is None or best_count < 50:
        return None
    P = pts[best_inl]
    centroid = P.mean(axis=0)
    _, _, vh = np.linalg.svd(P - centroid, full_matrices=False)
    n = vh[-1]
    n = n / np.linalg.norm(n)
    d = -float(n @ centroid)
    if d < 0:
        n, d = -n, -d
    return n, d, float(best_inl.mean())


def run_segformer(img: Image.Image) -> tuple[np.ndarray, dict]:
    W, H = img.size
    with torch.no_grad():
        s_in = M["seg_proc"](images=img, return_tensors="pt").to(DEVICE)
        logits = M["seg_model"](**s_in).logits
        logits = torch.nn.functional.interpolate(logits, size=(H, W), mode="bilinear", align_corners=False)
        seg = logits.argmax(1)[0].cpu().numpy()
    return seg, M["seg_model"].config.id2label


def _estimate_calibrated_view(
    img: Image.Image,
    max_edge: int = 1600,
    seg: Optional[np.ndarray] = None,
    exif_focal_35mm: Optional[float] = None,
    allow_floor_fallback: bool = False,
) -> dict:
    load_models()
    W, H = img.size
    if max(W, H) > max_edge:
        s = max_edge / max(W, H)
        img = img.resize((round(W * s), round(H * s)), Image.Resampling.LANCZOS)
        W, H = img.size
        seg = None

    with torch.no_grad():
        inp = M["depth_proc"](images=img, return_tensors="pt").to(DEVICE)
        out = M["depth_model"](**inp)
    post = M["depth_proc"].post_process_depth_estimation(out, target_sizes=[(H, W)])[0]
    depth = post["predicted_depth"].float().cpu().numpy()
    fl = post.get("focal_length")
    fov = post.get("field_of_view")
    focal_px = float(fl.item()) if fl is not None else None
    fov_deg = float(fov.item()) if fov is not None else None
    if not focal_px or not np.isfinite(focal_px):
        if fov_deg:
            focal_px = (W / 2) / math.tan(math.radians(fov_deg) / 2)
        else:
            raise HTTPException(500, "Odak uzaklığı hesaplanamadı")

    f35 = exif_focal_35mm
    if f35 is None:
        try:
            exif = img.getexif()
            if exif:
                exif_ifd = exif.get_ifd(0x8769)
                val = exif_ifd.get(41989) or exif.get(41989)
                if val is not None:
                    f35 = float(val)
        except Exception:
            f35 = None
    if f35 is not None and 10.0 <= float(f35) <= 85.0:
        f_exif = math.hypot(W, H) * (float(f35) / 43.266615)
        alpha = float(np.clip(f_exif / focal_px, 0.65, 1.45))
        depth = depth * alpha
        focal_px = focal_px * alpha

    if seg is None or seg.shape != (H, W):
        seg, id2label = run_segformer(img)
    else:
        id2label = M["seg_model"].config.id2label

    floor_mask = np.zeros((H, W), dtype=bool)
    erasable_objects: List[dict] = []
    total_px = float(W * H)
    for uid in np.unique(seg):
        lbl = id2label.get(int(uid), "").strip().lower()
        mask_u = seg == uid
        if lbl in FLOOR_LABELS:
            floor_mask |= mask_u
        elif lbl and lbl not in STRUCTURAL_LABELS:
            area_ratio = float(mask_u.sum()) / total_px
            if area_ratio >= 0.008:
                ys_u, xs_u = np.where(mask_u)
                erasable_objects.append(
                    {
                        "label": LABEL_TR.get(lbl, lbl.title()),
                        "u": round(float(xs_u.mean()) / W, 3),
                        "v": round(float(ys_u.mean()) / H, 3),
                        "areaRatio": round(area_ratio, 4),
                    }
                )
    erasable_objects.sort(key=lambda x: x["areaRatio"], reverse=True)

    fx = fy = focal_px
    cx, cy = W / 2.0, H / 2.0
    step = max(1, round(max(W, H) / 400))
    ys, xs = np.mgrid[0:H:step, 0:W:step]
    z = depth[ys, xs]
    fm = floor_mask[ys, xs] & np.isfinite(z) & (z > 0.3) & (z < 12)
    X = (xs - cx) / fx * z
    Y = (ys - cy) / fy * z
    pts = np.stack([X, Y, z], axis=-1)[fm]

    plane = ransac_plane(pts) if pts.shape[0] >= 200 else None
    if plane is None:
        if not allow_floor_fallback:
            if pts.shape[0] < 200:
                raise HTTPException(
                    422, "Fotoğrafta yeterince zemin görünmüyor. Zemini daha çok gösteren bir fotoğraf çekin."
                )
            raise HTTPException(422, "Zemin düzlemi bulunamadı. Daha aydınlık ve zemini gösteren bir fotoğraf çekin.")
        n = np.array([0.0, -1.0, 0.0], dtype=np.float64)
        d = 1.45
        inlier_ratio = 0.0
    else:
        n, d, inlier_ratio = plane

    gh, gw = ys.shape
    seg_g = seg[ys, xs]
    valid_z = np.isfinite(z) & (z > 0.3) & (z < 14.0)
    wy = d + (n[0] * X + n[1] * Y + n[2] * z)

    def seg_label_mask(target_labels: set[str]) -> np.ndarray:
        m = np.zeros((gh, gw), dtype=bool)
        for uid_val in np.unique(seg_g):
            if id2label.get(int(uid_val), "").strip().lower() in target_labels:
                m |= seg_g == uid_val
        return m & valid_z

    scale_factor = 1.0
    ceil_m = seg_label_mask({"ceiling"})
    ceil_cov = float(ceil_m.sum()) / float(gh * gw)

    if ceil_cov >= 0.015:
        h_ceil = float(np.median(wy[ceil_m]))
        if 2.42 <= h_ceil <= 3.05:
            scale_factor = 1.0
        elif 1.50 <= h_ceil < 2.42:
            scale_factor = float(np.clip(2.60 / h_ceil, 1.0, 1.38))
        elif 3.05 < h_ceil <= 4.20:
            scale_factor = float(np.clip(2.85 / h_ceil, 0.76, 1.0))
    else:
        cues: List[tuple] = []

        def add_grounded_cue(
            labels: set[str],
            h_min: float,
            h_max: float,
            h_target: float,
            weight: float,
            min_cov: float = 0.015,
            low_pct: float = 8.0,
            low_max: float = 0.24,
            high_pct: float = 88.0,
        ):
            m = seg_label_mask(labels)
            if float(m.sum()) / float(gh * gw) < min_cov:
                return
            my, _ = np.where(m)
            if my.min() <= int(0.04 * gh):
                return
            vals = wy[m]
            if float(np.percentile(vals, low_pct)) < low_max:
                hv = float(np.percentile(vals, high_pct))
                if h_min <= hv <= h_max:
                    cues.append((h_target / hv, weight))

        add_grounded_cue({"door"}, 1.35, 2.75, 2.06, 3.0, min_cov=0.012, low_pct=10.0, low_max=0.25, high_pct=95.0)

        win_m = seg_label_mask({"windowpane"})
        if float(win_m.sum()) / float(gh * gw) >= 0.02:
            sill_h = float(np.percentile(wy[win_m], 6.0))
            if 0.48 <= sill_h <= 1.08:
                cues.append((0.88 / sill_h, 1.6))

        add_grounded_cue({"sofa", "armchair"}, 0.52, 1.15, 0.85, 1.4)
        add_grounded_cue({"coffee table"}, 0.24, 0.58, 0.43, 1.2)
        add_grounded_cue({"desk", "table"}, 0.52, 0.98, 0.75, 1.5)
        add_grounded_cue({"chair", "swivel chair"}, 0.62, 1.18, 0.88, 1.0)

        if 0.68 <= d < 1.32:
            cues.append((1.38 / d, 2.0))
        elif d > 1.85:
            cues.append((1.65 / d, 1.5))

        if cues:
            w_sum = sum(w for _, w in cues)
            scale_factor = float(np.clip(sum(r * w for r, w in cues) / w_sum, 0.80, 1.36))

    if abs(scale_factor - 1.0) > 1e-4:
        depth = depth * scale_factor
        d = d * scale_factor
        if pts.shape[0] > 0:
            pts[:, 2] = pts[:, 2] * scale_factor

    cam_height = d
    up = n / np.linalg.norm(n)
    fwd_cv = np.array([0.0, 0.0, 1.0])
    f_h = fwd_cv - (fwd_cv @ up) * up
    f_h /= np.linalg.norm(f_h)
    Zw = -f_h
    Yw = up
    Xw = np.cross(Yw, Zw)
    R = np.stack([Xw, Yw, Zw], axis=0)
    right = R @ np.array([1.0, 0.0, 0.0])
    cam_up = R @ np.array([0.0, -1.0, 0.0])
    back = R @ np.array([0.0, 0.0, -1.0])
    pitch_down_deg = math.degrees(math.asin(float(np.clip(-(fwd_cv @ up), -1, 1))))
    roll_deg = math.degrees(math.atan2(float(right[1]), float(cam_up[1])))

    return {
        "img": img,
        "W": W,
        "H": H,
        "depth": depth,
        "focal_px": focal_px,
        "seg": seg,
        "id2label": id2label,
        "floor_mask": floor_mask,
        "erasable_objects": erasable_objects,
        "pts": pts,
        "n": n,
        "cam_height": cam_height,
        "inlier_ratio": inlier_ratio,
        "scale_factor": scale_factor,
        "R": R,
        "right": right,
        "cam_up": cam_up,
        "back": back,
        "pitch_down_deg": pitch_down_deg,
        "roll_deg": roll_deg,
    }


def analyze_pil_image(
    img: Image.Image,
    seg: Optional[np.ndarray] = None,
    exif_focal_35mm: Optional[float] = None,
) -> dict:
    t0 = time.time()
    v = _estimate_calibrated_view(
        img, max_edge=1600, seg=seg, exif_focal_35mm=exif_focal_35mm, allow_floor_fallback=False
    )
    W, H = v["W"], v["H"]
    fx = fy = v["focal_px"]
    depth = v["depth"]
    floor_mask = v["floor_mask"]

    # 5) Örtme için derinlik haritası (16-bit mm, R=yüksek bayt, G=düşük bayt, B=zemin)
    dw = 512 if W >= H else round(512 * W / H)
    dh = round(dw * H / W)
    d_small = cv2.resize(depth, (dw, dh), interpolation=cv2.INTER_NEAREST)
    f_small = cv2.resize(floor_mask.astype(np.uint8), (dw, dh), interpolation=cv2.INTER_NEAREST)
    mm = np.clip(np.nan_to_num(d_small, nan=0.0) * 1000.0, 0, 65535).astype(np.uint16)
    rgb = np.stack([(mm >> 8).astype(np.uint8), (mm & 255).astype(np.uint8), (f_small * 255).astype(np.uint8)], -1)

    pts = v["pts"]
    floor_depth_med = float(np.median(pts[:, 2])) if pts.shape[0] > 0 else 2.0

    return {
        "ok": True,
        "version": VERSION,
        "elapsedMs": round((time.time() - t0) * 1000),
        "imageWidth": W,
        "imageHeight": H,
        "focalPx": v["focal_px"],
        "vfovDeg": math.degrees(2 * math.atan((H / 2) / fy)),
        "hfovDeg": math.degrees(2 * math.atan((W / 2) / fx)),
        "cameraHeightM": v["cam_height"],
        "pitchDownDeg": v["pitch_down_deg"],
        "rollDeg": v["roll_deg"],
        "cameraBasis": {
            "right": v["right"].tolist(),
            "up": v["cam_up"].tolist(),
            "back": v["back"].tolist(),
        },
        "floorInlierRatio": v["inlier_ratio"],
        "floorCoverage": float(floor_mask.mean()),
        "floorDepthMedianM": floor_depth_med,
        "scaleFactor": round(v["scale_factor"], 3),
        "erasableObjects": v["erasable_objects"][:10],
        "depthMap": png_data_url(rgb),
        "depthMapWidth": dw,
        "depthMapHeight": dh,
    }


def run_lama_inpaint(pil_img: Image.Image, mask_u8: np.ndarray) -> Image.Image:
    """Runs big-lama TorchScript model on (RGB image, uint8 binary mask) with 8-modulo symmetric padding."""
    lama = load_lama()
    W, H = pil_img.size
    img_np = np.asarray(pil_img.convert("RGB"), dtype=np.float32) / 255.0
    img_chw = np.transpose(img_np, (2, 0, 1))
    mask_bin = (mask_u8 > 0).astype(np.float32)[None, ...]

    pad_h = (8 - (H % 8)) % 8
    pad_w = (8 - (W % 8)) % 8
    if pad_h > 0 or pad_w > 0:
        img_chw = np.pad(img_chw, ((0, 0), (0, pad_h), (0, pad_w)), mode="symmetric")
        mask_bin = np.pad(mask_bin, ((0, 0), (0, pad_h), (0, pad_w)), mode="symmetric")

    img_t = torch.from_numpy(img_chw).unsqueeze(0).to(DEVICE)
    mask_t = (torch.from_numpy(mask_bin).unsqueeze(0).to(DEVICE) > 0).float()

    with torch.inference_mode():
        inpainted = lama(img_t, mask_t)
        res = inpainted[0, :, :H, :W].permute(1, 2, 0).detach().float().cpu().numpy()

    res_u8 = np.clip(res * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(res_u8, mode="RGB")


def enhance_and_ground_glb(
    glb_bytes: bytes,
    width_cm: Optional[float] = None,
    depth_cm: Optional[float] = None,
    height_cm: Optional[float] = None,
) -> bytes:
    import trimesh

    scene = trimesh.load(io.BytesIO(glb_bytes), file_type="glb", force="scene")
    bounds = scene.bounds
    if bounds is not None:
        extents = bounds[1] - bounds[0]
        if height_cm and height_cm > 5 and extents[1] > 1e-4:
            scene.apply_scale((height_cm / 100.0) / float(extents[1]))
        elif width_cm and width_cm > 5 and extents[0] > 1e-4:
            scene.apply_scale((width_cm / 100.0) / float(extents[0]))

        b2 = scene.bounds
        center_x = (b2[0][0] + b2[1][0]) * 0.5
        min_y = b2[0][1]
        center_z = (b2[0][2] + b2[1][2]) * 0.5
        scene.apply_translation([-center_x, -min_y, -center_z])

    out_bytes = scene.export(file_type="glb")
    if isinstance(out_bytes, str):
        out_bytes = out_bytes.encode("latin1")
    return add_pbr_maps_to_glb_bytes(out_bytes)


def add_pbr_maps_to_glb_bytes(glb_buf: bytes) -> bytes:
    try:
        if len(glb_buf) < 28:
            return glb_buf
        magic, version, _ = struct.unpack_from("<III", glb_buf, 0)
        if magic != 0x46546C67 or version != 2:
            return glb_buf
        json_len, json_type = struct.unpack_from("<II", glb_buf, 12)
        if json_type != 0x4E4F534A:
            return glb_buf
        gltf = json.loads(glb_buf[20 : 20 + json_len].decode("utf-8"))
        orig_bin = bytearray(glb_buf[20 + json_len + 8 :])

        def pad4(n: int) -> int:
            return (4 - (n % 4)) % 4

        if not gltf.get("materials") or not gltf.get("images") or not gltf.get("bufferViews"):
            return glb_buf

        mat0 = gltf["materials"][0]
        pbr = mat0.setdefault("pbrMetallicRoughness", {})
        base_info = pbr.get("baseColorTexture")
        if not base_info or "normalTexture" in mat0:
            return glb_buf

        tex_idx = base_info["index"]
        img_idx = gltf["textures"][tex_idx]["source"]
        bv = gltf["bufferViews"][gltf["images"][img_idx]["bufferView"]]
        raw_img = bytes(orig_bin[bv["byteOffset"] : bv["byteOffset"] + bv["byteLength"]])

        pil_tex = Image.open(io.BytesIO(raw_img)).convert("RGB")
        w, h = min(2048, pil_tex.width), min(2048, pil_tex.height)
        rgb = np.asarray(pil_tex.resize((w, h), Image.Resampling.LANCZOS)).astype(np.float32) / 255.0

        lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
        ao = np.clip((lum**0.38) * 0.84 + 0.20, 0.36, 1.0)
        rough = np.clip(0.86 - lum * 0.16, 0.62, 0.92)
        orm = np.stack(
            [
                np.round(ao * 255).astype(np.uint8),
                np.round(rough * 255).astype(np.uint8),
                np.zeros_like(ao, dtype=np.uint8),
            ],
            axis=-1,
        )

        gy, gx = np.gradient(lum)
        nx, ny, nz = -gx * 2.6, -gy * 2.6, np.ones_like(lum)
        inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
        norm_map = np.stack(
            [
                np.clip(np.round((nx * inv * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8),
                np.clip(np.round((ny * inv * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8),
                np.clip(np.round((nz * inv * 0.5 + 0.5) * 255), 128, 255).astype(np.uint8),
            ],
            axis=-1,
        )

        def encode_jpg(arr: np.ndarray, q: int = 91) -> bytes:
            b = io.BytesIO()
            Image.fromarray(arr, mode="RGB").save(b, format="JPEG", quality=q)
            return b.getvalue()

        def append_tex(jpg_bytes: bytes, name: str) -> int:
            p = pad4(len(orig_bin))
            if p:
                orig_bin.extend(b"\x00" * p)
            offset = len(orig_bin)
            orig_bin.extend(jpg_bytes)
            gltf["bufferViews"].append(
                {"buffer": 0, "byteOffset": offset, "byteLength": len(jpg_bytes)}
            )
            gltf["images"].append(
                {
                    "name": name,
                    "mimeType": "image/jpeg",
                    "bufferView": len(gltf["bufferViews"]) - 1,
                }
            )
            gltf.setdefault(
                "samplers",
                [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
            )
            gltf["textures"].append({"sampler": 0, "source": len(gltf["images"]) - 1})
            return len(gltf["textures"]) - 1

        norm_idx = append_tex(encode_jpg(norm_map, 90), "pbr_normal")
        orm_idx = append_tex(encode_jpg(orm, 90), "pbr_orm")

        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 1.0
        pbr["metallicRoughnessTexture"] = {"index": orm_idx}
        mat0["normalTexture"] = {"index": norm_idx, "scale": 0.9}
        mat0["occlusionTexture"] = {"index": orm_idx, "strength": 0.88}

        p_end = pad4(len(orig_bin))
        if p_end:
            orig_bin.extend(b"\x00" * p_end)
        gltf["buffers"][0]["byteLength"] = len(orig_bin)

        new_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        jp = pad4(len(new_json))
        if jp:
            new_json += b" " * jp

        total = 12 + 8 + len(new_json) + 8 + len(orig_bin)
        out = bytearray()
        out.extend(struct.pack("<III", 0x46546C67, 2, total))
        out.extend(struct.pack("<II", len(new_json), 0x4E4F534A))
        out.extend(new_json)
        out.extend(struct.pack("<II", len(orig_bin), 0x004E4942))
        out.extend(orig_bin)
        return bytes(out)
    except Exception:
        traceback.print_exc()
        return glb_buf


def ensure_hunyuan3d():
    if M["hy3d_ready"] and M["hy3d_paint"] is not None:
        return
    with _HY3D_LOCK:
        if M["hy3d_ready"] and M["hy3d_paint"] is not None:
            return
        hy_dir = str(WORKSPACE_DIR / "Hunyuan3D-2")
        if not os.path.isdir(hy_dir):
            raise HTTPException(503, "Hunyuan3D-2 bu pod üzerinde kurulu değil.")
        if hy_dir not in sys.path:
            sys.path.insert(0, hy_dir)

        from hy3dgen.rembg import BackgroundRemover
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        M["hy3d_rembg"] = BackgroundRemover()
        M["hy3d_shape_single"] = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2")
        M["hy3d_shape_mv"] = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            "tencent/Hunyuan3D-2mv",
            subfolder="hunyuan3d-dit-v2-mv",
            variant="fp16",
        )
        M["hy3d_paint"] = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
        M["hy3d_ready"] = True


class AnalyzeRequest(BaseModel):
    image: str
    exifFocal35mm: Optional[float] = None


class EraseRequest(BaseModel):
    image: str
    tapU: Optional[float] = None
    tapV: Optional[float] = None
    brushMask: Optional[str] = None
    exifFocal35mm: Optional[float] = None


class Generate3DRequest(BaseModel):
    images: Dict[str, str]
    name: Optional[str] = "mobilya"
    width_cm: Optional[float] = None
    depth_cm: Optional[float] = None
    height_cm: Optional[float] = None


class UploadGlbRequest(BaseModel):
    name: Optional[str] = "cad-urun"
    glbBase64: str


class ReconstructRoomRequest(BaseModel):
    images: List[str]
    exifFocals: Optional[List[Optional[float]]] = None


@app.get("/health")
def health():
    hy3d_installed = (WORKSPACE_DIR / ".hy3d_ready").exists() or M["hy3d_ready"]
    models_list = sorted([p.name for p in MODELS_OUT_DIR.glob("*.glb")])
    return {
        "status": "ok",
        "version": VERSION,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "models_loaded": M["depth_model"] is not None,
        "lama_loaded": M["lama"] is not None,
        "hy3d_ready": bool(hy3d_installed),
        "generated_models": models_list,
    }


@app.post("/admin/reload")
def admin_reload():
    """Sunucu kodunu sabit kaynak adresinden (ORIGIN_URL) yeniden indirip yeniden başlatır."""
    if not ORIGIN_URL:
        raise HTTPException(400, "ORIGIN_URL tanımlı değil")
    req = urllib.request.Request(ORIGIN_URL + "/runpod/server.py", headers={"User-Agent": "mekanar"})
    code = urllib.request.urlopen(req, timeout=30).read()
    compile(code, "server.py", "exec")
    with open(os.path.abspath(__file__), "wb") as f:
        f.write(code)

    def restart():
        time.sleep(0.6)
        os.execv(sys.executable, [sys.executable] + sys.argv)

    threading.Thread(target=restart, daemon=True).start()
    return {"ok": True, "restarting": True}


def resolve_public_base_url(request: Request) -> str:
    xf_host = request.headers.get("x-forwarded-host")
    if xf_host:
        proto = request.headers.get("x-forwarded-proto", "https").split(",")[0].strip()
        return f"{proto}://{xf_host.split(',')[0].strip()}".rstrip("/")
    pod_id = os.environ.get("RUNPOD_POD_ID", "").strip()
    if pod_id:
        return f"https://{pod_id}-8000.proxy.runpod.net"
    base_url = str(request.base_url).rstrip("/")
    if "http://" in base_url and "proxy.runpod.net" in base_url:
        base_url = base_url.replace("http://", "https://")
    return base_url


@app.post("/upload-glb")
def upload_glb(req: UploadGlbRequest, request: Request):
    data_str = req.glbBase64
    if data_str.startswith("data:"):
        data_str = data_str.split(",", 1)[1]
    try:
        raw = base64.b64decode(data_str)
    except Exception:
        raise HTTPException(400, "Geçersiz base64 GLB verisi.")
    if len(raw) < 20 or struct.unpack_from("<I", raw, 0)[0] != 0x46546C67:
        raise HTTPException(400, "Geçerli bir binary .GLB dosyası değil.")

    slug = re.sub(r"[^a-z0-9_-]+", "-", (req.name or "cad-urun").lower()).strip("-") or "cad-urun"
    filename = f"{slug}-{int(time.time())}.glb"
    (MODELS_OUT_DIR / filename).write_bytes(raw)
    base_url = resolve_public_base_url(request)

    return {
        "ok": True,
        "filename": filename,
        "glbUrl": f"{base_url}/models/{filename}",
        "sizeKB": round(len(raw) / 1024, 1),
    }


@app.get("/models/{filename}")
def serve_generated_model(filename: str):
    safe_name = os.path.basename(filename)
    file_path = MODELS_OUT_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model bulunamadı")
    return FileResponse(
        path=str(file_path),
        media_type="model/gltf-binary",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
    )


def _rot2(yaw: float) -> np.ndarray:
    c, s = math.cos(yaw), math.sin(yaw)
    return np.array([[c, -s], [s, c]], dtype=np.float64)


def _apply_se2_points(pts3: np.ndarray, yaw: float, tx: float, tz: float) -> np.ndarray:
    out = pts3.copy()
    R2 = _rot2(yaw)
    out[..., [0, 2]] = pts3[..., [0, 2]] @ R2.T + np.array([tx, tz], dtype=pts3.dtype)
    return out


def _compose_se2(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    yaw_a, txa, tza = a
    yaw_b, txb, tzb = b
    t = _rot2(yaw_a) @ np.array([txb, tzb], dtype=np.float64) + np.array([txa, tza], dtype=np.float64)
    return (yaw_a + yaw_b, float(t[0]), float(t[1]))


def _invert_se2(p: tuple[float, float, float]) -> tuple[float, float, float]:
    yaw, tx, tz = p
    t = -(_rot2(-yaw) @ np.array([tx, tz], dtype=np.float64))
    return (-yaw, float(t[0]), float(t[1]))


def _register_se2_pair(
    pts_a: np.ndarray,
    des_a: Optional[np.ndarray],
    pts_b: np.ndarray,
    des_b: Optional[np.ndarray],
) -> Optional[tuple[float, float, float, int]]:
    if des_a is None or des_b is None or len(des_a) < 12 or len(des_b) < 12:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    knn = matcher.knnMatch(des_a, des_b, k=2)
    pa_list, pb_list = [], []
    for pair in knn:
        if len(pair) < 2:
            continue
        m1, m2 = pair
        if m1.distance < 0.76 * m2.distance:
            p1 = pts_a[m1.queryIdx]
            p2 = pts_b[m1.trainIdx]
            if abs(float(p1[1] - p2[1])) < 0.25:
                pa_list.append([p1[0], p1[2]])
                pb_list.append([p2[0], p2[2]])
    if len(pa_list) < 10:
        return None

    pa = np.asarray(pa_list, dtype=np.float64)
    pb = np.asarray(pb_list, dtype=np.float64)
    M_pts = pa.shape[0]
    rng = np.random.default_rng(42)
    best_inl = None
    best_cnt = 0

    for _ in range(800):
        i0, i1 = rng.integers(0, M_pts, size=2)
        if i0 == i1:
            continue
        va = pa[i1] - pa[i0]
        vb = pb[i1] - pb[i0]
        la, lb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
        if la < 0.25 or lb < 0.25:
            continue
        if abs(la - lb) / max(la, lb) > 0.22:
            continue
        yaw = math.atan2(va[1], va[0]) - math.atan2(vb[1], vb[0])
        R2 = _rot2(yaw)
        t = pa[i0] - R2 @ pb[i0]
        if math.hypot(float(t[0]), float(t[1])) > 4.2:
            continue
        err = np.linalg.norm((pb @ R2.T + t) - pa, axis=1)
        inl = err < 0.24
        cnt = int(inl.sum())
        if cnt > best_cnt:
            best_cnt = cnt
            best_inl = inl

    if best_inl is None or best_cnt < 10:
        return None

    A_in = pa[best_inl]
    B_in = pb[best_inl]
    ca = A_in.mean(axis=0)
    cb = B_in.mean(axis=0)
    U, _, Vt = np.linalg.svd((B_in - cb).T @ (A_in - ca))
    R2 = Vt.T @ U.T
    if np.linalg.det(R2) < 0:
        Vt[-1, :] *= -1
        R2 = Vt.T @ U.T
    t = ca - R2 @ cb
    if math.hypot(float(t[0]), float(t[1])) > 3.8:
        return None
    yaw = math.atan2(float(R2[1, 0]), float(R2[0, 0]))
    final_cnt = int((np.linalg.norm((pb @ R2.T + t) - pa, axis=1) < 0.24).sum())
    if final_cnt < 10:
        return None
    return (yaw, float(t[0]), float(t[1]), final_cnt)


def _estimate_room_manhattan_angle(views: List[dict], poses: List[tuple[float, float, float]]) -> float:
    hist = np.zeros(180, dtype=np.float64)
    for v, pose in zip(views, poses):
        seg = v["seg"]
        id2label = v["id2label"]
        H, W = v["H"], v["W"]
        step = max(2, round(max(H, W) / 160))
        P_glob = _apply_se2_points(v["P_lvl"], *pose)

        wall_m = np.zeros((H, W), dtype=bool)
        for uid_val in np.unique(seg):
            if id2label.get(int(uid_val), "").strip().lower() == "wall":
                wall_m |= seg == uid_val
        wall_m &= (~v["edge_bad"]) & np.isfinite(v["depth"]) & (v["depth"] > 0.40) & (v["depth"] < 5.2)

        ys = np.arange(step, H - step, step)
        xs = np.arange(step, W - step * 2, step)
        if len(ys) < 2 or len(xs) < 2:
            continue
        p0 = P_glob[np.ix_(ys, xs)]
        p1 = P_glob[np.ix_(ys, xs + step)]
        m_ok = wall_m[np.ix_(ys, xs)] & wall_m[np.ix_(ys, xs + step)]
        dx = p1[..., 0] - p0[..., 0]
        dz = p1[..., 2] - p0[..., 2]
        seg_len = np.hypot(dx, dz)
        m_ok &= (seg_len > 0.02) & (seg_len < 0.45)
        if not np.any(m_ok):
            continue
        ang = np.mod(np.arctan2(dz[m_ok], dx[m_ok]), math.pi / 2.0)
        bins = np.clip((ang / (math.pi / 2.0) * 180.0).astype(int), 0, 179)
        np.add.at(hist, bins, seg_len[m_ok])

    if hist.sum() < 1e-3:
        return 0.0
    kernel = np.array([1, 2, 3, 2, 1], dtype=np.float64)
    ext = np.concatenate([hist[-2:], hist, hist[:2]])
    smooth = np.convolve(ext, kernel, mode="valid")
    best_bin = int(np.argmax(smooth))
    theta = (best_bin + 0.5) / 180.0 * (math.pi / 2.0)
    if theta > math.pi / 4.0:
        theta -= math.pi / 2.0
    return float(theta)


def _extract_wall_axis_samples(v: dict, pose: tuple[float, float, float]) -> tuple[np.ndarray, np.ndarray]:
    seg = v["seg"]
    id2label = v["id2label"]
    H, W = v["H"], v["W"]
    step = max(2, round(max(H, W) / 150))
    P_glob = _apply_se2_points(v["P_lvl"], *pose)

    wall_m = np.zeros((H, W), dtype=bool)
    for uid_val in np.unique(seg):
        if id2label.get(int(uid_val), "").strip().lower() == "wall":
            wall_m |= seg == uid_val
    wall_m &= (~v["edge_bad"]) & np.isfinite(v["depth"]) & (v["depth"] > 0.40) & (v["depth"] < 5.0)

    ys = np.arange(step, H - step, step)
    xs = np.arange(step, W - step * 2, step)
    if len(ys) < 2 or len(xs) < 2:
        return np.empty(0, dtype=np.float64), np.empty(0, dtype=np.float64)

    p0 = P_glob[np.ix_(ys, xs)]
    p1 = P_glob[np.ix_(ys, xs + step)]
    m_ok = wall_m[np.ix_(ys, xs)] & wall_m[np.ix_(ys, xs + step)]
    dx = np.abs(p1[..., 0] - p0[..., 0])
    dz = np.abs(p1[..., 2] - p0[..., 2])
    seg_len = np.hypot(dx, dz)
    m_ok &= (seg_len > 0.015) & (seg_len < 0.40)
    if not np.any(m_ok):
        return np.empty(0, dtype=np.float64), np.empty(0, dtype=np.float64)

    x_const = p0[..., 0][m_ok & (dx < 0.35 * seg_len)]
    z_const = p0[..., 2][m_ok & (dz < 0.35 * seg_len)]
    return x_const.astype(np.float64), z_const.astype(np.float64)


def _find_1d_wall_modes(vals: np.ndarray, bin_size: float = 0.08) -> List[float]:
    if vals.size < 25:
        return []
    lo = float(np.percentile(vals, 1.0)) - bin_size
    hi = float(np.percentile(vals, 99.0)) + bin_size
    n_bins = max(8, int(round((hi - lo) / bin_size)))
    hist, edges = np.histogram(vals, bins=n_bins, range=(lo, hi))
    centers = 0.5 * (edges[:-1] + edges[1:])
    kernel = np.array([1.0, 2.0, 3.0, 2.0, 1.0])
    smooth = np.convolve(hist.astype(np.float64), kernel, mode="same")
    max_v = float(smooth.max())
    if max_v <= 0:
        return []
    order = np.argsort(smooth)[::-1]
    peaks: List[float] = []
    for idx in order:
        if smooth[idx] < 0.22 * max_v:
            break
        c = float(centers[idx])
        if all(abs(c - p) >= 1.4 for p in peaks):
            peaks.append(c)
        if len(peaks) >= 3:
            break
    return sorted(peaks)


def _snap_views_to_manhattan_walls(
    views: List[dict],
    poses_rot: List[tuple[float, float, float]],
) -> List[tuple[float, float, float]]:
    if len(poses_rot) < 2:
        return poses_rot

    all_wx, all_wz = [], []
    per_view = []
    for v, p in zip(views, poses_rot):
        wx, wz = _extract_wall_axis_samples(v, p)
        per_view.append((wx, wz))
        if wx.size > 0:
            all_wx.append(wx)
        if wz.size > 0:
            all_wz.append(wz)

    ref_wx_peaks = _find_1d_wall_modes(per_view[0][0]) or (
        _find_1d_wall_modes(np.concatenate(all_wx)) if all_wx else []
    )
    ref_wz_peaks = _find_1d_wall_modes(per_view[0][1]) or (
        _find_1d_wall_modes(np.concatenate(all_wz)) if all_wz else []
    )

    shifts = np.linspace(-0.40, 0.40, 41)
    inv_2s2 = 1.0 / (2.0 * 0.11 * 0.11)
    snapped: List[tuple[float, float, float]] = [poses_rot[0]]

    for i in range(1, len(poses_rot)):
        wx, wz = per_view[i]
        dx_best = 0.0
        dz_best = 0.0

        if wx.size >= 20 and ref_wx_peaks:
            sample = wx[:: max(1, wx.size // 300)]
            peaks_arr = np.asarray(ref_wx_peaks, dtype=np.float64)[None, :]
            base_score = float(np.exp(-np.min((sample[:, None] - peaks_arr) ** 2, axis=1) * inv_2s2).mean())
            best_score = base_score
            for d_cand in shifts:
                sc = float(np.exp(-np.min(((sample + d_cand)[:, None] - peaks_arr) ** 2, axis=1) * inv_2s2).mean())
                if sc > best_score + 0.015:
                    best_score = sc
                    dx_best = float(d_cand)

        if wz.size >= 20 and ref_wz_peaks:
            sample = wz[:: max(1, wz.size // 300)]
            peaks_arr = np.asarray(ref_wz_peaks, dtype=np.float64)[None, :]
            base_score = float(np.exp(-np.min((sample[:, None] - peaks_arr) ** 2, axis=1) * inv_2s2).mean())
            best_score = base_score
            for d_cand in shifts:
                sc = float(np.exp(-np.min(((sample + d_cand)[:, None] - peaks_arr) ** 2, axis=1) * inv_2s2).mean())
                if sc > best_score + 0.015:
                    best_score = sc
                    dz_best = float(d_cand)

        snapped.append(_compose_se2((0.0, dx_best, dz_best), poses_rot[i]))

    return snapped


def _synthesize_base_floor_canvas(
    bare_floor_rgb: np.ndarray,
    tw: int,
    th: int,
    along_x: bool,
    room_w: float,
    room_d: float,
) -> np.ndarray:
    rng = np.random.default_rng(17)
    base_col = np.clip(bare_floor_rgb.astype(np.float64), 35.0, 238.0)
    canvas = np.zeros((th, tw, 3), dtype=np.float64)
    plank_m = 0.15
    span_m = room_d if along_x else room_w
    px_per_plank = max(8, int(round((th if along_x else tw) * (plank_m / max(span_m, 1.5)))))

    if along_x:
        n_planks = (th + px_per_plank - 1) // px_per_plank
        for pi in range(n_planks):
            y0 = pi * px_per_plank
            y1 = min(th, y0 + px_per_plank)
            tone = 1.0 + rng.uniform(-0.045, 0.045)
            col = np.clip(base_col * tone, 0, 255)
            canvas[y0:y1, :, :] = col[None, None, :]
            if y1 < th:
                canvas[y1 - 1 : y1, :, :] = col[None, None, :] * 0.91
            joint_x = int(rng.uniform(0.15, 0.85) * tw)
            canvas[y0:y1, max(0, joint_x - 1) : min(tw, joint_x + 1), :] *= 0.92
    else:
        n_planks = (tw + px_per_plank - 1) // px_per_plank
        for pi in range(n_planks):
            x0 = pi * px_per_plank
            x1 = min(tw, x0 + px_per_plank)
            tone = 1.0 + rng.uniform(-0.045, 0.045)
            col = np.clip(base_col * tone, 0, 255)
            canvas[:, x0:x1, :] = col[None, None, :]
            if x1 < tw:
                canvas[:, x1 - 1 : x1, :] = col[None, None, :] * 0.91
            joint_y = int(rng.uniform(0.15, 0.85) * th)
            canvas[max(0, joint_y - 1) : min(th, joint_y + 1), x0:x1, :] *= 0.92

    grain = rng.normal(0.0, 2.2, size=(th, tw, 1))
    canvas = np.clip(canvas + grain, 0, 255).astype(np.uint8)
    return canvas


def _bake_floor_texture_v6(
    floor_pts_3d: np.ndarray,
    views: List[dict],
    poses: List[tuple[float, float, float]],
    room_w: float,
    room_d: float,
) -> tuple[str, np.ndarray]:
    th, tw, _ = floor_pts_3d.shape
    plane_normal = np.array([0.0, 1.0, 0.0], dtype=np.float64)

    clutter_exclude = {
        "book", "bag", "box", "computer", "crt screen", "screen", "laptop",
        "bottle", "plate", "tray", "basket", "toy", "chair", "swivel chair",
        "coffee table", "table", "desk", "bed", "sofa", "armchair", "cabinet",
        "chest of drawers", "bookcase", "shelf", "person", "cushion", "pillow",
    }

    bare_samples = []
    view_floor_lums: List[Optional[float]] = []
    strict_masks: List[np.ndarray] = []

    for v in views:
        seg = v["seg"]
        id2label = v["id2label"]
        H, W = v["H"], v["W"]
        floor_m = np.zeros((H, W), dtype=np.uint8)
        bare_m = np.zeros((H, W), dtype=bool)
        clutter_m = np.zeros((H, W), dtype=np.uint8)

        for uid_val in np.unique(seg):
            lbl = id2label.get(int(uid_val), "").strip().lower()
            if lbl in FLOOR_LABELS:
                floor_m[seg == uid_val] = 1
                if lbl in {"floor", "flooring"}:
                    bare_m |= seg == uid_val
            elif lbl in clutter_exclude:
                clutter_m[seg == uid_val] = 1

        floor_er = cv2.erode(floor_m, np.ones((7, 7), np.uint8), iterations=1) > 0
        clutter_dil = cv2.dilate(clutter_m, np.ones((7, 7), np.uint8), iterations=1) > 0
        near_floor = (
            floor_er
            & (~clutter_dil)
            & (~v["edge_bad"])
            & np.isfinite(v["depth"])
            & (v["depth"] > 0.35)
            & (v["depth"] < 6.0)
            & (np.abs(v["P_lvl"][..., 1]) < 0.14)
        )
        strict_masks.append(near_floor)

        rgb = v["clean_bg_rgb"]
        lum_px = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
        if int(near_floor.sum()) >= 80:
            view_floor_lums.append(float(np.median(lum_px[near_floor])))
        else:
            view_floor_lums.append(None)

        bare_strict = bare_m & floor_er & (~v["furn_mask"]) & (~v["edge_bad"]) & (np.abs(v["P_lvl"][..., 1]) < 0.12)
        if int(bare_strict.sum()) >= 50:
            pts_col = rgb[bare_strict]
            if pts_col.shape[0] > 4000:
                pts_col = pts_col[:: max(1, pts_col.shape[0] // 2000)]
            bare_samples.append(pts_col)

    valid_lums = [lm for lm in view_floor_lums if lm is not None]
    target_lum = float(np.median(valid_lums)) if valid_lums else 148.0

    if bare_samples:
        bare_col = np.median(np.vstack(bare_samples), axis=0)
    else:
        any_floor = []
        for v, sm in zip(views, strict_masks):
            if int(sm.sum()) >= 40:
                any_floor.append(v["clean_bg_rgb"][sm][:: max(1, int(sm.sum()) // 800)])
        bare_col = np.median(np.vstack(any_floor), axis=0) if any_floor else np.array([178.0, 165.0, 148.0])

    base_canvas = _synthesize_base_floor_canvas(bare_col, tw, th, room_w >= room_d, room_w, room_d)

    accum_rgb = np.zeros((th, tw, 3), dtype=np.float64)
    accum_w = np.zeros((th, tw), dtype=np.float64)

    for v, pose, sm, v_lum in zip(views, poses, strict_masks, view_floor_lums):
        if not np.any(sm):
            continue
        yaw, tx, tz = pose
        R2 = _rot2(yaw)
        cam_xz = np.array([tx, tz], dtype=np.float64)
        cam_world = np.array([tx, v["cam_height"], tz], dtype=np.float64)

        vec_to_cam = cam_world - floor_pts_3d
        dist_cam = np.linalg.norm(vec_to_cam, axis=-1, keepdims=True)
        cos_v = np.sum((vec_to_cam / np.maximum(dist_cam, 1e-4)) * plane_normal, axis=-1)

        P_loc = np.empty_like(floor_pts_3d, dtype=np.float64)
        P_loc[..., [0, 2]] = (floor_pts_3d[..., [0, 2]] - cam_xz) @ R2
        P_loc[..., 1] = floor_pts_3d[..., 1] - v["cam_height"]
        P_cam = P_loc @ v["R"]

        Xc = P_cam[..., 0]
        Yc = P_cam[..., 1]
        Zc = P_cam[..., 2]
        W, H = v["W"], v["H"]
        f = v["focal_px"]
        u_px = Xc / np.maximum(Zc, 0.05) * f + W / 2.0
        v_px = Yc / np.maximum(Zc, 0.05) * f + H / 2.0

        valid = (
            (Zc > 0.25)
            & (cos_v > 0.18)
            & (u_px >= 2.0)
            & (u_px < W - 2.0)
            & (v_px >= 2.0)
            & (v_px < H - 2.0)
        )
        if not np.any(valid):
            continue

        ui = np.clip(np.round(u_px).astype(int), 0, W - 1)
        vi = np.clip(np.round(v_px).astype(int), 0, H - 1)
        d_meas = v["depth"][vi, ui]
        depth_ok = np.isfinite(d_meas) & (np.abs(d_meas - Zc) < np.maximum(0.22, 0.12 * Zc))
        valid &= sm[vi, ui] & depth_ok
        if not np.any(valid):
            continue

        gain = float(np.clip(target_lum / max(v_lum, 20.0), 0.78, 1.28)) if v_lum else 1.0
        img_norm = np.clip(v["clean_bg_rgb"].astype(np.float32) * gain, 0, 255)
        sampled = cv2.remap(
            img_norm,
            u_px.astype(np.float32),
            v_px.astype(np.float32),
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        ).astype(np.float64)

        raw_score = np.clip(cos_v / (np.maximum(Zc, 0.35) ** 1.4 + 0.25), 0.0, 5.0)
        w = np.where(valid, np.power(raw_score, 8.0), 0.0)
        accum_rgb += sampled * w[..., None]
        accum_w += w

    obs = accum_w > 1e-8
    if int(obs.sum()) < 30:
        out_u8 = base_canvas
    else:
        proj = np.where(obs[..., None], accum_rgb / np.maximum(accum_w[..., None], 1e-8), base_canvas.astype(np.float64))
        alpha = cv2.GaussianBlur(obs.astype(np.float32), (11, 11), 0)[..., None]
        out_u8 = np.clip(alpha * proj + (1.0 - alpha) * base_canvas.astype(np.float32), 0, 255).astype(np.uint8)

    url = jpeg_data_url(Image.fromarray(out_u8, mode="RGB"), quality=88)
    return url, bare_col


def _extract_wall_openings(
    views: List[dict],
    poses: List[tuple[float, float, float]],
    room_w: float,
    room_d: float,
    ceil_h: float,
) -> Dict[str, List[tuple[float, float, float, float, str]]]:
    hw, hd = room_w * 0.5, room_d * 0.5
    openings: Dict[str, List[tuple[float, float, float, float, str]]] = {
        "north": [], "south": [], "west": [], "east": []
    }
    wall_pts: Dict[str, Dict[str, List[tuple[float, float]]]] = {
        w_name: {"window": [], "door": []} for w_name in openings
    }

    for v, pose in zip(views, poses):
        seg = v["seg"]
        id2label = v["id2label"]
        step = max(2, round(max(v["H"], v["W"]) / 160))
        seg_s = seg[::step, ::step]
        d_s = v["depth"][::step, ::step]
        edge_s = v["edge_bad"][::step, ::step]
        p_s = _apply_se2_points(v["P_lvl"][::step, ::step], *pose)

        ok_base = np.isfinite(d_s) & (d_s > 0.40) & (d_s < 6.0) & (~edge_s)
        for uid_val in np.unique(seg_s):
            lbl = id2label.get(int(uid_val), "").strip().lower()
            if lbl in {"windowpane", "curtain", "drape", "blind"}:
                o_kind = "window"
            elif lbl == "door":
                o_kind = "door"
            else:
                continue

            m_u = (seg_s == uid_val) & ok_base
            if int(m_u.sum()) < 15:
                continue
            pts = p_s[m_u]
            px, py, pz = pts[:, 0], pts[:, 1], pts[:, 2]
            dn = np.abs(pz + hd)
            ds = np.abs(pz - hd)
            dw = np.abs(px + hw)
            de = np.abs(px - hw)
            dists = np.stack([dn, ds, dw, de], axis=-1)
            nearest = np.argmin(dists, axis=-1)
            min_d = np.min(dists, axis=-1)

            for idx_w, w_name in enumerate(("north", "south", "west", "east")):
                mw = (nearest == idx_w) & (min_d < 0.85) & (py >= 0.05) & (py <= ceil_h)
                if int(mw.sum()) < 12:
                    continue
                if w_name == "north":
                    us = (px[mw] + hw) / max(room_w, 0.5)
                elif w_name == "south":
                    us = (hw - px[mw]) / max(room_w, 0.5)
                elif w_name == "west":
                    us = (hd - pz[mw]) / max(room_d, 0.5)
                else:
                    us = (pz[mw] + hd) / max(room_d, 0.5)
                ys = py[mw]
                for u_val, y_val in zip(us.tolist(), ys.tolist()):
                    if 0.0 <= u_val <= 1.0:
                        wall_pts[w_name][o_kind].append((u_val, y_val))

    for w_name in openings:
        grid_n_u, grid_n_y = 28, 14
        for o_kind in ("door", "window"):
            pts_list = wall_pts[w_name][o_kind]
            if len(pts_list) < 25:
                continue
            arr = np.asarray(pts_list, dtype=np.float64)
            occ = np.zeros((grid_n_y, grid_n_u), dtype=np.uint8)
            ui = np.clip((arr[:, 0] * grid_n_u).astype(int), 0, grid_n_u - 1)
            yi = np.clip((arr[:, 1] / max(ceil_h, 1.0) * grid_n_y).astype(int), 0, grid_n_y - 1)
            occ[yi, ui] = 1
            occ = cv2.morphologyEx(occ, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            n_cc, cc = cv2.connectedComponents(occ, connectivity=8)
            for cid in range(1, n_cc):
                comp = cc == cid
                if int(comp.sum()) < 6:
                    continue
                cy_idx, cx_idx = np.where(comp)
                u0 = float(np.clip(cx_idx.min() / grid_n_u, 0.03, 0.94))
                u1 = float(np.clip((cx_idx.max() + 1) / grid_n_u, 0.06, 0.97))
                y0_raw = float(cy_idx.min() / grid_n_y * ceil_h)
                y1_raw = float((cy_idx.max() + 1) / grid_n_y * ceil_h)
                if (u1 - u0) < 0.08:
                    continue
                if o_kind == "door":
                    y0 = 0.0
                    y1 = float(np.clip(y1_raw, 1.92, min(ceil_h - 0.08, 2.38)))
                else:
                    y0 = float(np.clip(y0_raw, 0.45, ceil_h - 0.70))
                    y1 = float(np.clip(y1_raw, y0 + 0.55, ceil_h - 0.10))
                openings[w_name].append((u0, u1, y0, y1, o_kind))

    return openings


def _render_architectural_wall_texture(
    wall_rgb: np.ndarray,
    openings: List[tuple[float, float, float, float, str]],
    ceil_h: float,
    tw: int = 1024,
    th: int = 512,
) -> str:
    rng = np.random.default_rng(29)
    lum = float(0.2126 * wall_rgb[0] + 0.7152 * wall_rgb[1] + 0.0722 * wall_rgb[2])
    paint = wall_rgb.astype(np.float64).copy()
    if lum > 115.0 and lum < 204.0:
        scale = min(1.36, 202.0 / max(lum, 1e-3))
        paint = np.clip(paint * scale, 0.0, 238.0)

    # Doğal gün ışığı gradyanı + köşe ortam gölgelemesi (AO) + ince sıva dokusu
    y_norm = np.linspace(0.0, 1.0, th)[:, None, None]  # 0=tavan, 1=zemin
    v_grad = 1.03 - 0.08 * y_norm
    x_norm = np.linspace(0.0, 1.0, tw)[None, :, None]
    edge_d = np.minimum(x_norm, 1.0 - x_norm)
    corner_ao = 0.90 + 0.10 * np.clip(edge_d / 0.055, 0.0, 1.0)

    img = np.broadcast_to(paint[None, None, :], (th, tw, 3)).astype(np.float64) * v_grad * corner_ao
    grain = rng.normal(0.0, 1.4, size=(th, tw, 1))
    canvas = np.ascontiguousarray(np.clip(img + grain, 0, 255), dtype=np.uint8)

    # Üst kartonpiyer gölge çizgisi (~5 cm)
    crown_px = max(4, int(round(th * (0.05 / max(ceil_h, 1.5)))))
    canvas[:crown_px, :] = np.clip(paint * 0.94, 0, 255).astype(np.uint8)
    cv2.line(canvas, (0, crown_px), (tw - 1, crown_px), tuple(int(c * 0.84) for c in paint), 2)

    # Alt süpürgelik (8 cm)
    base_px = max(8, int(round(th * (0.08 / max(ceil_h, 1.5)))))
    baseboard_col = tuple(int(c) for c in np.clip(paint * 0.92 + np.array([16, 15, 13]), 180, 245))
    trim_edge_col = tuple(int(c) for c in np.clip(paint * 0.78, 120, 220))
    canvas[th - base_px :, :] = baseboard_col
    cv2.line(canvas, (0, th - base_px), (tw - 1, th - base_px), trim_edge_col, 2)

    # Mimari kapı ve pencere açıklıkları
    frame_col = (242, 242, 239)
    frame_shadow = (196, 194, 189)
    for u0, u1, y0, y1, kind in openings:
        px0 = max(6, int(round(u0 * tw)))
        px1 = min(tw - 7, int(round(u1 * tw)))
        py_top = max(crown_px + 4, int(round((1.0 - y1 / max(ceil_h, 1.5)) * th)))
        py_bot = min(th - 2, int(round((1.0 - y0 / max(ceil_h, 1.5)) * th)))
        if (px1 - px0) < 24 or (py_bot - py_top) < 24:
            continue

        if kind == "window":
            # Yumuşak gölgesiz beyaz PVC çerçeve + aydınlık gün ışığı camı + kayıtlar
            cv2.rectangle(canvas, (px0 - 3, py_top - 3), (px1 + 3, py_bot + 3), frame_shadow, 2)
            cv2.rectangle(canvas, (px0, py_top), (px1, py_bot), frame_col, -1)
            pad = max(6, min(12, (px1 - px0) // 18))
            gx0, gy0, gx1, gy1 = px0 + pad, py_top + pad, px1 - pad, py_bot - pad
            if gx1 > gx0 + 10 and gy1 > gy0 + 10:
                glass_t = np.linspace(0.0, 1.0, gy1 - gy0)[:, None, None]
                top_sky = np.array([232.0, 240.0, 247.0])
                bot_sky = np.array([247.0, 248.0, 246.0])
                glass_fill = np.clip((1.0 - glass_t) * top_sky + glass_t * bot_sky, 0, 255).astype(np.uint8)
                canvas[gy0:gy1, gx0:gx1] = glass_fill
                mid_x = (gx0 + gx1) // 2
                cv2.rectangle(canvas, (mid_x - 3, gy0), (mid_x + 3, gy1), frame_col, -1)
                cv2.rectangle(canvas, (gx0, gy0), (gx1, gy1), frame_shadow, 1)
        else:
            # Kapı açıklığı (süpürgeliği keser)
            py_bot = th - 1
            cv2.rectangle(canvas, (px0 - 2, py_top - 2), (px1 + 2, py_bot), frame_shadow, 2)
            cv2.rectangle(canvas, (px0, py_top), (px1, py_bot), frame_col, -1)
            pad = max(6, min(14, (px1 - px0) // 14))
            dx0, dy0, dx1, dy1 = px0 + pad, py_top + pad, px1 - pad, py_bot - 2
            if dx1 > dx0 + 12 and dy1 > dy0 + 12:
                door_fill = tuple(int(c) for c in np.clip(paint * 0.90 + 12, 170, 236))
                cv2.rectangle(canvas, (dx0, dy0), (dx1, dy1), door_fill, -1)
                cv2.rectangle(canvas, (dx0, dy0), (dx1, dy1), frame_shadow, 1)

    pil = Image.fromarray(canvas, mode="RGB")
    return jpeg_data_url(pil, quality=88)


def _extract_cuttable_objects(
    views: List[dict],
    poses: List[tuple[float, float, float]],
    room_w: float,
    room_d: float,
    ceil_h: float,
) -> List[dict]:
    hw, hd = room_w * 0.5, room_d * 0.5
    obs_list = []

    for v, pose in zip(views, poses):
        seg = v["seg"]
        id2label = v["id2label"]
        H, W = v["H"], v["W"]
        total_px = float(W * H)
        P_glob = _apply_se2_points(v["P_lvl"], *pose)
        rgb = v["rgb_u8"]

        for uid_val in np.unique(seg):
            lbl = id2label.get(int(uid_val), "").strip().lower()
            kind = FURNITURE_KIND_MAP.get(lbl)
            if not kind:
                continue
            class_m = (seg == uid_val).astype(np.uint8)
            n_cc, cc = cv2.connectedComponents(class_m, connectivity=8)
            for cid in range(1, n_cc):
                comp = cc == cid
                px_area = int(comp.sum())
                if px_area / total_px < 0.015:
                    continue
                mask_int = (
                    comp
                    & (~v["edge_bad"])
                    & np.isfinite(v["depth"])
                    & (v["depth"] > 0.35)
                    & (v["depth"] < 5.4)
                )
                pts_v = P_glob[mask_int]
                pts_v = pts_v[(pts_v[:, 1] >= 0.02) & (pts_v[:, 1] <= ceil_h)]
                if pts_v.shape[0] < 35:
                    continue
                center = np.median(pts_v, axis=0)
                med_col = np.median(rgb[mask_int], axis=0)
                obs_list.append(
                    {
                        "kind": kind,
                        "label": LABEL_TR.get(lbl, lbl.title()),
                        "area_px": px_area,
                        "pts": pts_v,
                        "center_xz": center[[0, 2]].copy(),
                        "color": med_col,
                    }
                )

    obs_list.sort(key=lambda o: o["area_px"], reverse=True)

    compat_group = {
        "sofa": "seat_big",
        "armchair": "seat_small",
        "bed": "bed",
        "desk": "work_table",
        "table": "work_table",
        "coffee_table": "coffee_table",
        "chair": "chair",
        "bookcase": "storage",
        "cabinet": "storage",
        "tv": "tv",
    }

    clusters: List[dict] = []
    for obs in obs_list:
        cg = compat_group.get(obs["kind"], obs["kind"])
        matched = None
        for cl in clusters:
            if cl["group"] != cg and obs["kind"] != cl["kind"]:
                continue
            if float(np.linalg.norm(obs["center_xz"] - cl["center_xz"])) < 0.95:
                matched = cl
                break
        if matched is None:
            clusters.append(
                {
                    "group": cg,
                    "kind": obs["kind"],
                    "label": obs["label"],
                    "area_px": obs["area_px"],
                    "pts_list": [obs["pts"]],
                    "colors": [obs["color"]],
                    "center_xz": obs["center_xz"],
                }
            )
        else:
            matched["pts_list"].append(obs["pts"])
            matched["colors"].append(obs["color"])
            all_p = np.vstack(matched["pts_list"])
            matched["center_xz"] = np.median(all_p[:, [0, 2]], axis=0)
            if obs["area_px"] > matched["area_px"]:
                matched["area_px"] = obs["area_px"]
                matched["kind"] = obs["kind"]
                matched["label"] = obs["label"]

    wall_hugging_kinds = {"bed", "sofa", "bookcase", "cabinet", "desk", "tv"}
    built: List[dict] = []

    for cl in clusters:
        pts = np.vstack(cl["pts_list"])
        if pts.shape[0] > 3500:
            pts = pts[:: max(1, pts.shape[0] // 2500)]
        x10, x90 = np.percentile(pts[:, 0], [10.0, 90.0])
        z10, z90 = np.percentile(pts[:, 2], [10.0, 90.0])
        h_raw = float(np.percentile(pts[:, 1], 92.0))

        cx = float(0.5 * (x10 + x90))
        cz = float(0.5 * (z10 + z90))
        ex = float(max(0.15, x90 - x10))
        ez = float(max(0.15, z90 - z10))

        # En yakın duvardan odaya bakan Manhattan yönü
        dists = [
            (abs(cz - (-hd)), 0.0, False),          # Kuzey duvarı -> +Z
            (abs(hd - cz), math.pi, False),         # Güney duvarı -> -Z
            (abs(cx - (-hw)), math.pi * 0.5, True), # Batı duvarı  -> +X
            (abs(hw - cx), -math.pi * 0.5, True),   # Doğu duvarı  -> -X
        ]
        nearest_dist, yaw, swap_xz = min(dists, key=lambda t: t[0])

        kind = cl["kind"]
        min_w, max_w, min_h, max_h, min_d, max_d = FURNITURE_SIZE_BOUNDS.get(
            kind, (0.5, 2.0, 0.5, 2.0, 0.4, 1.5)
        )
        raw_w = ez if swap_xz else ex
        raw_d = ex if swap_xz else ez
        w = float(np.clip(raw_w, min_w, max_w))
        d = float(np.clip(raw_d, min_d, max_d))
        h = float(np.clip(h_raw, min_h, min(max_h, ceil_h - 0.10)))

        # Yatakta derinlik (yatak boyu) genişlikten küçük çıktıysa uyumlu hale getir
        if kind == "bed" and d < w:
            w = float(np.clip(w, min_w, 1.75))

        span_x = (d if swap_xz else w) * 0.5
        span_z = (w if swap_xz else d) * 0.5

        if kind in wall_hugging_kinds and nearest_dist < 0.72:
            if abs(yaw) < 0.1:  # North (-hd)
                cz = max(cz, -hd + span_z + 0.05)
                if abs(cz - (-hd + span_z + 0.05)) < 0.35:
                    cz = -hd + span_z + 0.05
            elif abs(yaw - math.pi) < 0.1:  # South (+hd)
                cz = min(cz, hd - span_z - 0.05)
                if abs((hd - span_z - 0.05) - cz) < 0.35:
                    cz = hd - span_z - 0.05
            elif yaw > 0:  # West (-hw)
                cx = max(cx, -hw + span_x + 0.05)
                if abs(cx - (-hw + span_x + 0.05)) < 0.35:
                    cx = -hw + span_x + 0.05
            else:  # East (+hw)
                cx = min(cx, hw - span_x - 0.05)
                if abs((hw - span_x - 0.05) - cx) < 0.35:
                    cx = hw - span_x - 0.05

        cx = float(np.clip(cx, -hw + span_x + 0.04, hw - span_x - 0.04))
        cz = float(np.clip(cz, -hd + span_z + 0.04, hd - span_z - 0.04))

        if any(math.hypot(cx - b["center"][0], cz - b["center"][2]) < 0.65 for b in built):
            continue

        col_med = np.median(np.vstack(cl["colors"]), axis=0)
        r_c, g_c, b_c = [int(np.clip(round(val), 28, 238)) for val in col_med]

        built.append(
            {
                "id": f"obj-{len(built) + 1}",
                "kind": kind,
                "label": cl["label"],
                "center": [round(cx, 3), 0.0, round(cz, 3)],
                "size": [round(w, 3), round(h, 3), round(d, 3)],
                "yaw": round(yaw, 4),
                "colorHex": f"#{r_c:02x}{g_c:02x}{b_c:02x}",
            }
        )
        if len(built) >= 8:
            break

    return built


def _pick_spawn_xz(room_w: float, room_d: float, objects: List[dict]) -> List[float]:
    hw = max(0.35, room_w * 0.5 - 0.65)
    hd = max(0.35, room_d * 0.5 - 0.65)
    xs = np.linspace(-hw, hw, 7)
    zs = np.linspace(-hd, hd, 7)

    best_pt = [0.0, 0.0]
    best_score = -1e9
    for cx in xs:
        for cz in zs:
            min_clear = 2.5
            for obj in objects:
                ox, _, oz = obj["center"]
                ow, _, od = obj["size"]
                swap = abs(math.sin(obj["yaw"])) > 0.5
                hx = (od if swap else ow) * 0.5
                hz = (ow if swap else od) * 0.5
                dx = max(0.0, abs(float(cx) - ox) - hx)
                dz = max(0.0, abs(float(cz) - oz) - hz)
                d_edge = math.hypot(dx, dz)
                if dx <= 0.0 and dz <= 0.0:
                    d_edge = -0.5
                min_clear = min(min_clear, d_edge)
            score = min(min_clear, 0.9) - 0.25 * math.hypot(float(cx), float(cz))
            if score > best_score:
                best_score = score
                best_pt = [round(float(cx), 2), round(float(cz), 2)]
    return best_pt


def reconstruct_room_multiview(images: List[str], exif_focals: Optional[List[Optional[float]]] = None) -> dict:
    t0 = time.time()
    load_models()
    load_lama()
    if not images or len(images) < 2:
        raise HTTPException(400, "3D oda modellemesi için en az 2 farklı açıdan fotoğraf gereklidir.")

    imgs_in = images[:6]
    sift = cv2.SIFT_create(2500)
    views = []

    for i, img_str in enumerate(imgs_in):
        f35 = exif_focals[i] if exif_focals and i < len(exif_focals) else None
        pil = decode_image(img_str, "RGB")
        v = _estimate_calibrated_view(
            pil, max_edge=1024, exif_focal_35mm=f35, allow_floor_fallback=True
        )
        W, H = v["W"], v["H"]
        f = v["focal_px"]
        ys_full, xs_full = np.mgrid[0:H, 0:W]
        P_cv = np.stack(
            [(xs_full - W / 2.0) / f * v["depth"], (ys_full - H / 2.0) / f * v["depth"], v["depth"]],
            axis=-1,
        ).astype(np.float32)
        P_lvl = (P_cv @ v["R"].T) + np.array([0.0, v["cam_height"], 0.0], dtype=np.float32)
        v["P_lvl"] = P_lvl

        d_f32 = v["depth"].astype(np.float32)
        gx_d = cv2.Sobel(d_f32, cv2.CV_32F, 1, 0, ksize=3)
        gy_d = cv2.Sobel(d_f32, cv2.CV_32F, 0, 1, ksize=3)
        grad_d = np.hypot(gx_d, gy_d)
        edge_bad = grad_d > 0.14
        v["edge_bad"] = edge_bad

        rgb_u8 = np.asarray(v["img"], dtype=np.uint8)
        gray = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2GRAY)
        kps, des = sift.detectAndCompute(gray, None)
        kp_pts = []
        valid_des_idx = []
        if kps and des is not None:
            for ki, kp in enumerate(kps):
                kx = min(W - 1, max(0, int(round(kp.pt[0]))))
                ky = min(H - 1, max(0, int(round(kp.pt[1]))))
                d_val = float(v["depth"][ky, kx])
                pt = P_lvl[ky, kx]
                if (
                    0.40 < d_val < 5.2
                    and (not bool(edge_bad[ky, kx]))
                    and abs(float(pt[1])) < 3.2
                    and np.all(np.isfinite(pt))
                ):
                    kp_pts.append(pt)
                    valid_des_idx.append(ki)
        v["kp_pts"] = np.asarray(kp_pts, dtype=np.float64) if kp_pts else np.zeros((0, 3), dtype=np.float64)
        v["des"] = des[valid_des_idx] if valid_des_idx else None

        # SegFormer eşya maskesi -> LaMa temiz arka plan (maske dışı doğal 1024px korunur)
        furn_m = np.zeros((H, W), dtype=np.uint8)
        for uid_val in np.unique(v["seg"]):
            lbl = v["id2label"].get(int(uid_val), "").strip().lower()
            if lbl in MOVABLE_OBJECT_LABELS:
                furn_m[v["seg"] == uid_val] = 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))
        furn_dil = cv2.dilate(furn_m, kernel, iterations=1)
        v["furn_mask"] = furn_dil > 0

        if int(furn_dil.sum()) > 120:
            s_lama = min(1.0, 768.0 / max(W, H))
            lw, lh = max(64, round(W * s_lama)), max(64, round(H * s_lama))
            pil_small = v["img"].resize((lw, lh), Image.Resampling.BILINEAR)
            mask_small = cv2.resize(furn_dil, (lw, lh), interpolation=cv2.INTER_NEAREST)
            clean_small = run_lama_inpaint(pil_small, mask_small)
            inp_full = np.asarray(clean_small.resize((W, H), Image.Resampling.LANCZOS), dtype=np.float32)
            alpha = cv2.GaussianBlur(furn_dil.astype(np.float32), (9, 9), 0)[..., None]
            v["clean_bg_rgb"] = np.clip(
                alpha * inp_full + (1.0 - alpha) * rgb_u8.astype(np.float32), 0, 255
            ).astype(np.uint8)
        else:
            v["clean_bg_rgb"] = rgb_u8

        v["rgb_u8"] = rgb_u8
        views.append(v)

    N = len(views)
    # 2) İkili SIFT+RANSAC maksimum kapsayan ağaç (MST) hizalaması
    edges = []
    for i in range(N):
        for j in range(i + 1, N):
            res_ij = _register_se2_pair(views[i]["kp_pts"], views[i]["des"], views[j]["kp_pts"], views[j]["des"])
            if res_ij is not None:
                yaw, tx, tz, inl = res_ij
                edges.append((inl, i, j, (yaw, tx, tz)))

    poses: List[Optional[tuple[float, float, float]]] = [None] * N
    poses[0] = (0.0, 0.0, 0.0)
    registered = {0}

    while True:
        best_edge = None
        for inl, i, j, tf_ij in edges:
            if (i in registered) != (j in registered):
                if best_edge is None or inl > best_edge[0]:
                    best_edge = (inl, i, j, tf_ij)
        if best_edge is None:
            break
        _, i, j, tf_ij = best_edge
        if i in registered:
            poses[j] = _compose_se2(poses[i], tf_ij)
            registered.add(j)
        else:
            poses[i] = _compose_se2(poses[j], _invert_se2(tf_ij))
            registered.add(i)

    matched_views = len(registered)
    # Eşleşmeyen açılar varsa dairesel oda merkezi etrafına pürüzsüz yerleştir
    reg_pts = []
    for idx in registered:
        p_w = _apply_se2_points(views[idx]["P_lvl"][::8, ::8], *poses[idx])
        valid_p = p_w[np.isfinite(views[idx]["depth"][::8, ::8]) & (views[idx]["depth"][::8, ::8] < 5.2)]
        if len(valid_p) > 0:
            reg_pts.append(valid_p)
    est_center = np.median(np.vstack(reg_pts), axis=0) if reg_pts else np.array([0.0, 0.8, -2.2])
    est_rad = float(np.mean([math.hypot(poses[idx][1] - est_center[0], poses[idx][2] - est_center[2]) for idx in registered]))
    est_rad = max(1.8, min(3.8, est_rad if np.isfinite(est_rad) and est_rad > 0.5 else 2.2))

    for k in range(N):
        if poses[k] is None:
            ang = k * (2.0 * math.pi / N)
            cx_k = float(est_center[0] + est_rad * math.sin(ang))
            cz_k = float(est_center[2] + est_rad * math.cos(ang))
            yaw_k = math.atan2(cx_k - float(est_center[0]), cz_k - float(est_center[2]))
            poses[k] = (yaw_k, cx_k, cz_k)

    poses_f: List[tuple[float, float, float]] = [p for p in poses if p is not None]

    # 3) Manhattan duvar eksenine hizalama, duvar medyanı kilitleme & sıkı oda sınırları
    theta_room = _estimate_room_manhattan_angle(views, poses_f)
    poses_rot = [_compose_se2((-theta_room, 0.0, 0.0), p) for p in poses_f]
    poses_rot = _snap_views_to_manhattan_walls(views, poses_rot)

    wall_floor_xz = []
    wall_x_vals, wall_z_vals = [], []
    ceil_ys = []
    wall_top_ys = []
    for v, pose in zip(views, poses_rot):
        step = max(2, round(max(v["H"], v["W"]) / 140))
        seg_s = v["seg"][::step, ::step]
        d_s = v["depth"][::step, ::step]
        e_s = v["edge_bad"][::step, ::step]
        p_s = _apply_se2_points(v["P_lvl"][::step, ::step], *pose)
        ok = np.isfinite(d_s) & (d_s > 0.40) & (d_s < 5.2) & (~e_s)
        for uid_val in np.unique(seg_s):
            lbl = v["id2label"].get(int(uid_val), "").strip().lower()
            m_u = (seg_s == uid_val) & ok
            if not np.any(m_u):
                continue
            pts_u = p_s[m_u]
            if lbl in {"wall", "door"} or lbl in FLOOR_LABELS:
                wall_floor_xz.append(pts_u[:, [0, 2]])
                if lbl == "wall" and pts_u.shape[0] > 15:
                    wall_top_ys.append(float(np.percentile(pts_u[:, 1], 92)))
            elif lbl == "ceiling":
                valid_cy = pts_u[(pts_u[:, 1] > 2.05) & (pts_u[:, 1] < 3.65), 1]
                if len(valid_cy) > 10:
                    ceil_ys.append(valid_cy)

        wx_i, wz_i = _extract_wall_axis_samples(v, pose)
        if wx_i.size > 0:
            wall_x_vals.append(wx_i)
        if wz_i.size > 0:
            wall_z_vals.append(wz_i)

    if wall_floor_xz:
        all_xz = np.vstack(wall_floor_xz)
        x0, x1 = np.percentile(all_xz[:, 0], [6.0, 94.0])
        z0, z1 = np.percentile(all_xz[:, 1], [6.0, 94.0])
    else:
        x0, x1, z0, z1 = -2.0, 2.0, -2.0, 2.0

    # Duvar yoğunluk modları ile açık kapı/balkon taşmalarını sıkılaştır
    mid_x = 0.5 * (x0 + x1)
    mid_z = 0.5 * (z0 + z1)
    if wall_x_vals:
        x_modes = _find_1d_wall_modes(np.concatenate(wall_x_vals), bin_size=0.08)
        neg_x = [m for m in x_modes if m < mid_x - 0.85 and (x0 - 0.35) <= m <= (x0 + 0.75)]
        pos_x = [m for m in x_modes if m > mid_x + 0.85 and (x1 - 0.75) <= m <= (x1 + 0.35)]
        if neg_x:
            x0 = float(min(neg_x))
        if pos_x:
            x1 = float(max(pos_x))
    if wall_z_vals:
        z_modes = _find_1d_wall_modes(np.concatenate(wall_z_vals), bin_size=0.08)
        neg_z = [m for m in z_modes if m < mid_z - 0.85 and (z0 - 0.35) <= m <= (z0 + 0.75)]
        pos_z = [m for m in z_modes if m > mid_z + 0.85 and (z1 - 0.75) <= m <= (z1 + 0.35)]
        if neg_z:
            z0 = float(min(neg_z))
        if pos_z:
            z1 = float(max(pos_z))

    cx_room = float((x0 + x1) * 0.5)
    cz_room = float((z0 + z1) * 0.5)
    room_w = float(np.clip(x1 - x0, 2.5, 8.0))
    room_d = float(np.clip(z1 - z0, 2.5, 8.0))
    ceil_h = (
        float(np.clip(np.median(np.concatenate(ceil_ys)), 2.35, 3.25))
        if ceil_ys
        else float(np.clip((max(wall_top_ys) + 0.12) if wall_top_ys else 2.65, 2.45, 3.05))
    )

    poses_centered = [_compose_se2((0.0, -cx_room, -cz_room), p) for p in poses_rot]

    # 4) Pencere / aydınlatma yönü & temiz iç duvar boya rengi çıkarımı
    wall_samples = []
    bright_dirs = []
    for v, pose in zip(views, poses_centered):
        upper = v["rgb_u8"][: max(1, v["H"] // 2), :]
        lum = (0.2126 * upper[..., 0] + 0.7152 * upper[..., 1] + 0.0722 * upper[..., 2]).mean()
        fwd_glob = _apply_se2_points((np.array([[0.0, 0.0, 1.0]]) @ v["R"].T), pose[0], 0.0, 0.0)[0]
        bright_dirs.append(fwd_glob * float(lum))

        wall_m = np.zeros((v["H"], v["W"]), dtype=np.uint8)
        for uid_val in np.unique(v["seg"]):
            if v["id2label"].get(int(uid_val), "").strip().lower() == "wall":
                wall_m[v["seg"] == uid_val] = 1
        wall_er = cv2.erode(wall_m, np.ones((7, 7), np.uint8), iterations=1) > 0
        wall_ok = wall_er & (~v["edge_bad"]) & (~v["furn_mask"]) & (v["depth"] > 0.40) & (v["depth"] < 5.2)
        if int(wall_ok.sum()) >= 40:
            ws = v["rgb_u8"][wall_ok]
            wall_samples.append(ws[:: max(1, ws.shape[0] // 800)])

    wall_fallback = np.median(np.vstack(wall_samples), axis=0) if wall_samples else np.array([218.0, 215.0, 208.0])

    ldir = np.sum(bright_dirs, axis=0) if bright_dirs else np.array([1.0, 0.0, 1.0])
    ldir[1] = 0.0
    if np.linalg.norm(ldir) < 1e-4:
        ldir = np.array([1.0, 0.0, 0.6])
    ldir = ldir / np.linalg.norm(ldir)
    light_dir = np.array([float(ldir[0]), 2.1, float(ldir[2])], dtype=np.float64)
    light_dir = (light_dir / np.linalg.norm(light_dir)).tolist()

    # 5) 1024x1024 Temiz Zemin + 4 Mimari Duvar Dokusu
    hw, hd = room_w * 0.5, room_d * 0.5
    ft_x = np.linspace(-hw, hw, 1024, dtype=np.float64)
    ft_z = np.linspace(-hd, hd, 1024, dtype=np.float64)
    gx, gz = np.meshgrid(ft_x, ft_z)
    floor_pts = np.stack([gx, np.zeros_like(gx), gz], axis=-1)
    floor_tex, _ = _bake_floor_texture_v6(floor_pts, views, poses_centered, room_w, room_d)

    openings = _extract_wall_openings(views, poses_centered, room_w, room_d, ceil_h)
    wall_north = _render_architectural_wall_texture(wall_fallback, openings["north"], ceil_h, 1024, 512)
    wall_south = _render_architectural_wall_texture(wall_fallback, openings["south"], ceil_h, 1024, 512)
    wall_west = _render_architectural_wall_texture(wall_fallback, openings["west"], ceil_h, 1024, 512)
    wall_east = _render_architectural_wall_texture(wall_fallback, openings["east"], ceil_h, 1024, 512)

    # 6) Katı Mimari 3D Eşyalar + Açık Yerleşim Noktası (spawnXZ)
    existing_objects = _extract_cuttable_objects(views, poses_centered, room_w, room_d, ceil_h)
    spawn_xz = _pick_spawn_xz(room_w, room_d, existing_objects)

    # 7) Gerçek Fotoğraf Açı Kameraları
    cameras = []
    for i, (v, pose) in enumerate(zip(views, poses_centered)):
        yaw, tx, tz = pose
        cy, sy = math.cos(yaw), math.sin(yaw)

        def rot_basis_vec(vec: np.ndarray) -> List[float]:
            vx, vy, vz = float(vec[0]), float(vec[1]), float(vec[2])
            return [round(cy * vx - sy * vz, 5), round(vy, 5), round(sy * vx + cy * vz, 5)]

        cam_p = [round(float(tx), 3), round(float(v["cam_height"]), 3), round(float(tz), 3)]
        look_lvl = np.array([0.0, v["cam_height"], 0.0]) + (np.array([0.0, 0.0, 2.2]) @ v["R"].T)
        look_w = _apply_se2_points(look_lvl, *pose)
        vfov_deg = round(math.degrees(2.0 * math.atan((v["H"] / 2.0) / v["focal_px"])), 3)

        cameras.append(
            {
                "index": i,
                "label": f"Açı {i + 1}",
                "pos": cam_p,
                "lookAt": [round(float(x), 3) for x in look_w],
                "vfovDeg": vfov_deg,
                "imageWidth": int(v["W"]),
                "imageHeight": int(v["H"]),
                "basis": {
                    "right": rot_basis_vec(v["right"]),
                    "up": rot_basis_vec(v["cam_up"]),
                    "back": rot_basis_vec(v["back"]),
                },
                "photoUrl": jpeg_data_url(v["img"], quality=82),
                "cleanPhotoUrl": jpeg_data_url(Image.fromarray(v["clean_bg_rgb"], mode="RGB"), quality=82),
            }
        )

    return {
        "ok": True,
        "version": VERSION,
        "elapsedMs": round((time.time() - t0) * 1000),
        "viewCount": N,
        "matchedViews": matched_views,
        "roomWidthM": round(room_w, 2),
        "roomDepthM": round(room_d, 2),
        "ceilingHeightM": round(ceil_h, 2),
        "floorTexture": floor_tex,
        "wallTextures": {
            "north": wall_north,
            "south": wall_south,
            "west": wall_west,
            "east": wall_east,
        },
        "existingObjects": existing_objects,
        "spawnXZ": spawn_xz,
        "cameras": cameras,
        "lightDir": [round(float(x), 3) for x in light_dir],
    }


@app.post("/reconstruct-room")
def reconstruct_room(req: ReconstructRoomRequest):
    try:
        return reconstruct_room_multiview(req.images, req.exifFocals)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(500, f"3D modelleme hatası: {exc}")


@app.post("/analyze-room")
def analyze_room(req: AnalyzeRequest):
    img = decode_image(req.image, "RGB")
    return analyze_pil_image(img, exif_focal_35mm=req.exifFocal35mm)


@app.post("/erase-object")
def erase_object(req: EraseRequest):
    load_models()
    img = decode_image(req.image, "RGB")
    W, H = img.size
    if max(W, H) > 1600:
        s = 1600 / max(W, H)
        img = img.resize((round(W * s), round(H * s)), Image.Resampling.LANCZOS)
        W, H = img.size

    if req.brushMask:
        mask_pil = decode_image(req.brushMask, "L").resize((W, H), Image.Resampling.NEAREST)
        mask_arr = (np.asarray(mask_pil) > 127).astype(np.uint8)
        if mask_arr.sum() < 25:
            raise HTTPException(422, "Silinecek alan seçilmedi.")
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19))
        final_mask = cv2.dilate(mask_arr, kernel, iterations=1)
        erased_label = "Seçili Eşya"
    elif req.tapU is not None and req.tapV is not None:
        seg, id2label = run_segformer(img)
        px = min(W - 1, max(0, int(round(req.tapU * (W - 1)))))
        py = min(H - 1, max(0, int(round(req.tapV * (H - 1)))))

        uid = int(seg[py, px])
        lbl = id2label.get(uid, "").strip().lower()

        # Yapısal sınıf seçildiyse 24px yarıçap içinde en yakın eşya pikselini ara
        if not lbl or lbl in STRUCTURAL_LABELS:
            radius = 24
            y0, y1 = max(0, py - radius), min(H, py + radius + 1)
            x0, x1 = max(0, px - radius), min(W, px + radius + 1)
            patch = seg[y0:y1, x0:x1]
            best_dist = 1e9
            found = None
            for cand_uid in np.unique(patch):
                cand_lbl = id2label.get(int(cand_uid), "").strip().lower()
                if not cand_lbl or cand_lbl in STRUCTURAL_LABELS:
                    continue
                cys, cxs = np.where(patch == cand_uid)
                dists = (cys + y0 - py) ** 2 + (cxs + x0 - px) ** 2
                min_i = int(np.argmin(dists))
                if dists[min_i] <= radius * radius and dists[min_i] < best_dist:
                    best_dist = float(dists[min_i])
                    found = (int(cxs[min_i]) + x0, int(cys[min_i]) + y0, int(cand_uid), cand_lbl)
            if found is None:
                raise HTTPException(
                    422,
                    "Silinecek bir eşya bulunamadı. Kaldırmak istediğiniz koltuk, yatak veya eşyanın tam üzerine dokunun.",
                )
            px, py, uid, lbl = found

        class_mask = (seg == uid).astype(np.uint8)
        num_labels, cc = cv2.connectedComponents(class_mask, connectivity=8)
        comp_id = int(cc[py, px]) if num_labels > 1 else 0
        comp_mask = ((cc == comp_id) if comp_id > 0 else class_mask).astype(np.uint8)

        # Koltuk/yatak silinirken üzerindeki dokunan yastıklar havada kalmasın
        if lbl in {"sofa", "armchair", "bed"}:
            touch_zone = cv2.dilate(comp_mask, np.ones((11, 11), np.uint8), iterations=1) > 0
            for att_lbl in {"cushion", "pillow"}:
                for att_uid, att_name in id2label.items():
                    if att_name.strip().lower() == att_lbl:
                        att_m = (seg == int(att_uid)).astype(np.uint8)
                        n_att, cc_att = cv2.connectedComponents(att_m, connectivity=8)
                        for cid in range(1, n_att):
                            c_m = cc_att == cid
                            if np.any(c_m & touch_zone):
                                comp_mask[c_m] = 1

        # Eşya kenarlarını ve zeminindeki eski gölgeyi de temizlemek için genişlet + hafif aşağı kaydır
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (27, 27))
        dilated = cv2.dilate(comp_mask, kernel, iterations=1)
        M_down = np.float32([[1, 0, 0], [0, 1, 14]])
        down_shadow = cv2.warpAffine(dilated, M_down, (W, H), flags=cv2.INTER_NEAREST)
        final_mask = np.maximum(dilated, down_shadow)
        erased_label = LABEL_TR.get(lbl, lbl.title())
    else:
        raise HTTPException(400, "tapU/tapV veya brushMask gereklidir.")

    cleaned_pil = run_lama_inpaint(img, final_mask)
    cleaned_data_url = jpeg_data_url(cleaned_pil, quality=92)
    analysis = analyze_pil_image(cleaned_pil, exif_focal_35mm=req.exifFocal35mm)

    return {
        "ok": True,
        "cleanedImage": cleaned_data_url,
        "erasedLabel": erased_label,
        "analysis": analysis,
    }


@app.post("/generate-3d")
def generate_3d(req: Generate3DRequest, request: Request):
    t0 = time.time()
    if not req.images or "front" not in req.images:
        raise HTTPException(status_code=400, detail="En az 'front' fotoğrafı gereklidir.")

    ensure_hunyuan3d()
    rembg = M["hy3d_rembg"]
    cleaned_views: Dict[str, Image.Image] = {}
    for k in ["front", "back", "left", "right"]:
        if k in req.images and req.images[k]:
            rgb_pil = decode_image(req.images[k], "RGB")
            cleaned_views[k] = rembg(rgb_pil)

    if len(cleaned_views) >= 2 and ("back" in cleaned_views or "left" in cleaned_views):
        mesh = M["hy3d_shape_mv"](
            image=cleaned_views,
            num_inference_steps=35,
            octree_resolution=380,
            num_chunks=20000,
            generator=torch.manual_seed(42),
            output_type="trimesh",
        )[0]
    else:
        mesh = M["hy3d_shape_single"](
            image=cleaned_views["front"],
            num_inference_steps=35,
            octree_resolution=380,
            num_chunks=20000,
            generator=torch.manual_seed(42),
            output_type="trimesh",
        )[0]

    mesh = M["hy3d_paint"](mesh, image=cleaned_views["front"])

    raw_glb_io = io.BytesIO()
    mesh.export(raw_glb_io, file_type="glb")
    final_glb = enhance_and_ground_glb(
        raw_glb_io.getvalue(),
        width_cm=req.width_cm,
        depth_cm=req.depth_cm,
        height_cm=req.height_cm,
    )

    slug = re.sub(r"[^a-z0-9_-]+", "-", (req.name or "urun").lower()).strip("-") or "urun"
    filename = f"{slug}-{int(time.time())}.glb"
    (MODELS_OUT_DIR / filename).write_bytes(final_glb)
    base_url = resolve_public_base_url(request)

    return {
        "ok": True,
        "filename": filename,
        "glbUrl": f"{base_url}/models/{filename}",
        "sizeKB": round(len(final_glb) / 1024, 1),
        "elapsedSec": round(time.time() - t0, 1),
    }


if __name__ == "__main__":
    import uvicorn

    def _warmup():
        try:
            load_models()
            load_lama()
        except Exception:
            traceback.print_exc()

    threading.Thread(target=_warmup, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)
