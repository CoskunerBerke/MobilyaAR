"""
MekanAR — RunPod Serverless 1:1 3B Mobilya Üretim Worker'ı (Hunyuan3D-2.1 Full PBR · 2K)
  - Temiz arka plan + stüdyo zemin gölgesi filtresi -> ham beyaz mesh üzerinde otomatik zemin
    katmanı temizliği (UV atlasının %100'ü yalnızca mobilyaya ayrılır -> sıfır doku taşması!).
  - Hunyuan3D-2.1 Paint PBR + RealESRGAN x4 (downsample=False -> gerçek 2048x2048 2K Albedo,
    Roughness, Metallic, Normal) + yumuşak vertex NORMAL'ları (gerçekçi AR ışıklandırması!).
  - Doğrudan Cloudflare R2'ye 2K PBR .GLB yükler (Vercel 4.5 MB sınırına hiç takılmaz!).
"""

import base64
import gc
import io
import json
import os
import struct
import sys
import tempfile
import time
import traceback
from typing import Dict, List, Optional

os.environ.setdefault("HF_HOME", "/models/hf")
os.environ.setdefault("HY3DGEN_MODELS", "/models/hy3d21")
os.environ.setdefault("U2NET_HOME", "/models/u2net")
os.environ.setdefault("PYOPENGL_PLATFORM", "egl")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

HY3D_ROOT = "/opt/Hunyuan3D-2.1"
for p in (HY3D_ROOT, f"{HY3D_ROOT}/hy3dshape", f"{HY3D_ROOT}/hy3dpaint"):
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from torchvision_fix import apply_fix

    apply_fix()
except Exception as exc:
    print(f"[ar3d-21] torchvision_fix uyarı: {exc}", flush=True)

import cv2
import numpy as np
import requests
import runpod
import torch
import trimesh
from PIL import Image, ImageOps

MODEL_DIR = "/models/hy3d21"
MAX_FALLBACK_BASE64_BYTES = 2_550_000

_STATE = {
    "rembg": None,
    "shape": None,
    "paint": None,
}


def _vram_gb() -> float:
    if not torch.cuda.is_available():
        return 0.0
    try:
        return float(torch.cuda.get_device_properties(0).total_memory) / (1024.0 ** 3)
    except Exception:
        return 0.0


def _decode_image(data_str: str) -> Image.Image:
    raw = data_str.split(",", 1)[1] if "," in data_str[:120] else data_str
    img = Image.open(io.BytesIO(base64.b64decode(raw)))
    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > 1024:
        s = 1024.0 / float(max(img.size))
        img = img.resize(
            (max(64, int(round(img.width * s))), max(64, int(round(img.height * s)))),
            Image.Resampling.LANCZOS,
        )
    return img


def _ensure_rembg():
    if _STATE["rembg"] is None:
        from hy3dshape.rembg import BackgroundRemover

        _STATE["rembg"] = BackgroundRemover()
    return _STATE["rembg"]


def _clean_studio_background(rembg, rgb_img: Image.Image) -> Image.Image:
    """
    rembg çıktısındaki yarı saydam stüdyo zemin gölgelerini keskinleştirip atar;
    böylece 3B şekil üretici mobilya ayaklarının altına sahte beyaz zemin levhası çizmez.
    """
    rgba = rembg(rgb_img).convert("RGBA")
    arr = np.array(rgba)
    alpha = arr[:, :, 3]

    # Zayıf gölge piksellerini temizle (stüdyo zemin gölgeleri genelde alpha 20..195 arası olur)
    hard_mask = (alpha >= 205).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    hard_mask = cv2.morphologyEx(hard_mask, cv2.MORPH_OPEN, kernel)

    # Sadece en büyük bağlı bileşeni (mobilyanın kendisini) koru -> kopuk gölge adalarını sil
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(hard_mask, connectivity=8)
    if num_labels > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        main_label = 1 + int(np.argmax(areas))
        keep = (labels == main_label).astype(np.uint8) * 255
        # Küçük 1 px kenar yumuşatması
        keep = cv2.GaussianBlur(keep, (3, 3), 0)
        arr[:, :, 3] = np.where(keep > 120, alpha, 0)
    else:
        arr[:, :, 3] = np.where(alpha >= 205, alpha, 0)

    # Sıkı kırp ve temiz %10 çerçeve ile kareye ortala (Hunyuan3D Shape için en yüksek detay!)
    ys, xs = np.where(arr[:, :, 3] > 20)
    if len(xs) > 50 and len(ys) > 50:
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        crop = Image.fromarray(arr[y0:y1, x0:x1], mode="RGBA")
        side = int(round(max(crop.width, crop.height) * 1.18))
        side = max(256, min(1024, side))
        sc = (side * 0.84) / float(max(crop.width, crop.height))
        nw, nh = max(16, int(round(crop.width * sc))), max(16, int(round(crop.height * sc)))
        crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
        out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        out.paste(crop, ((side - nw) // 2, (side - nh) // 2), crop)
        return out

    return Image.fromarray(arr, mode="RGBA")


def _strip_floor_sheet_from_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """
    UV açma ve PBR boyamadan ÖNCE şekil çıktısında kalan olası ince stüdyo zemin levhasını
    temizler. Böylece 2K UV dokusunun %100'ü yalnızca mobilyanın kendisine ayrılır!
    """
    try:
        if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) < 500:
            return mesh
        pts = np.asarray(mesh.vertices, dtype=np.float32)
        faces = np.asarray(mesh.faces, dtype=np.int64)
        ys = pts[:, 1]
        ymin, ymax = float(ys.min()), float(ys.max())
        h = ymax - ymin
        if h < 1e-4:
            return mesh

        # Mobilya gövdesinin (en alt %10'un üstündeki kısım) X-Z kapladığı alanı ölç
        body_pts = pts[ys > ymin + h * 0.12]
        if len(body_pts) < 100:
            return mesh
        bx0, bx1 = float(body_pts[:, 0].min()), float(body_pts[:, 0].max())
        bz0, bz1 = float(body_pts[:, 2].min()), float(body_pts[:, 2].max())
        bw, bd = bx1 - bx0, bz1 - bz0
        total_w = float(pts[:, 0].max() - pts[:, 0].min())
        total_d = float(pts[:, 2].max() - pts[:, 2].min())

        # Eğer en alt dilim gövdeden belirgin biçimde taşıyorsa zemin levhası vardır -> temizle!
        if total_w > bw * 1.18 or total_d > bd * 1.18:
            v0, v1, v2 = pts[faces[:, 0]], pts[faces[:, 1]], pts[faces[:, 2]]
            tri_y_max = np.maximum(np.maximum(v0[:, 1], v1[:, 1]), v2[:, 1])
            tri_cx = (v0[:, 0] + v1[:, 0] + v2[:, 0]) / 3.0
            tri_cz = (v0[:, 2] + v1[:, 2] + v2[:, 2]) / 3.0
            n = np.cross(v1 - v0, v2 - v0)
            ny = np.abs(n[:, 1]) / (np.linalg.norm(n, axis=1) + 1e-12)

            outside = (
                (tri_cx < bx0 - bw * 0.03)
                | (tri_cx > bx1 + bw * 0.03)
                | (tri_cz < bz0 - bd * 0.03)
                | (tri_cz > bz1 + bd * 0.03)
            )
            is_sheet = (tri_y_max < ymin + h * 0.06) & (outside | (ny > 0.82))
            removed = int(is_sheet.sum())
            if 0 < removed < len(faces) * 0.5:
                cleaned = mesh.submesh([~is_sheet], append=True)
                print(
                    f"[ar3d-21] Boyama öncesi zemin levhası temizlendi: -{removed} yüzey (kalan {len(cleaned.faces)})",
                    flush=True,
                )
                return cleaned
    except Exception as exc:
        print(f"[ar3d-21] Zemin filtresi uyarı (devam): {exc}", flush=True)
    return mesh


def _get_shape_pipeline():
    if _STATE["shape"] is None:
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        t0 = time.time()
        ckpt = os.path.join(MODEL_DIR, "hunyuan3d-dit-v2-1", "model.fp16.ckpt")
        cfg = os.path.join(MODEL_DIR, "hunyuan3d-dit-v2-1", "config.yaml")
        pipe = Hunyuan3DDiTFlowMatchingPipeline.from_single_file(
            ckpt_path=ckpt,
            config_path=cfg,
            device="cuda" if torch.cuda.is_available() else "cpu",
            dtype=torch.float16,
            use_safetensors=False,
        )
        _STATE["shape"] = pipe
        print(f"[ar3d-21] Shape v2.1 yüklendi ({time.time() - t0:.1f} sn)", flush=True)
    return _STATE["shape"]


def _get_paint_pipeline():
    if _STATE["paint"] is None:
        from textureGenPipeline import Hunyuan3DPaintConfig, Hunyuan3DPaintPipeline

        t0 = time.time()
        high_vram = _vram_gb() >= 36.0
        conf = Hunyuan3DPaintConfig(max_num_view=6, resolution=768 if high_vram else 512)
        conf.multiview_pretrained_path = MODEL_DIR
        conf.multiview_cfg_path = os.path.join(HY3D_ROOT, "hy3dpaint", "cfgs", "hunyuan-paint-pbr.yaml")
        conf.custom_pipeline = os.path.join(HY3D_ROOT, "hy3dpaint", "hunyuanpaintpbr")
        conf.realesrgan_ckpt_path = os.path.join(HY3D_ROOT, "hy3dpaint", "ckpt", "RealESRGAN_x4plus.pth")
        if os.path.isdir("/models/dinov2-giant"):
            conf.dino_ckpt_path = "/models/dinov2-giant"
        conf.render_size = 2048
        conf.texture_size = 2048
        pipe = Hunyuan3DPaintPipeline(conf)
        _STATE["paint"] = pipe
        print(
            f"[ar3d-21] Paint PBR v2.1 yüklendi (res={conf.resolution}, vram={_vram_gb():.1f}GB, {time.time() - t0:.1f} sn)",
            flush=True,
        )
    return _STATE["paint"]


def _resize_pil(im: Image.Image, max_side: int) -> Image.Image:
    if max(im.size) <= max_side:
        return im
    s = float(max_side) / float(max(im.size))
    return im.resize(
        (max(64, int(round(im.width * s))), max(64, int(round(im.height * s)))),
        Image.Resampling.LANCZOS,
    )


def _encode_jpg(im: Image.Image, q: int) -> bytes:
    b = io.BytesIO()
    im.convert("RGB").save(b, format="JPEG", quality=q, optimize=True)
    return b.getvalue()


def _compute_smooth_vertex_normals(pts: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """
    Açı/alan ağırlıklı yumuşak vertex normal vektörleri üretir.
    AR (ARKit / ARCore / WebXR) ışıklandırmasının plastik/düz görünmemesi için ZORUNLUDUR!
    """
    normals = np.zeros_like(pts, dtype=np.float64)
    v0 = pts[faces[:, 0]].astype(np.float64)
    v1 = pts[faces[:, 1]].astype(np.float64)
    v2 = pts[faces[:, 2]].astype(np.float64)
    fn = np.cross(v1 - v0, v2 - v0)
    np.add.at(normals, faces[:, 0], fn)
    np.add.at(normals, faces[:, 1], fn)
    np.add.at(normals, faces[:, 2], fn)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    bad = lengths[:, 0] < 1e-12
    normals = np.divide(normals, np.where(lengths < 1e-12, 1.0, lengths))
    normals[bad] = [0.0, 1.0, 0.0]
    return normals.astype(np.float32)


def _build_pbr_glb_from_obj(
    obj_path: str,
    width_cm: Optional[float],
    depth_cm: Optional[float],
    height_cm: Optional[float],
    tex_max_side: int = 2048,
    jpg_q: int = 92,
):
    """
    Hunyuan3D-2.1 Paint PBR çıktısı (.obj + 2K Albedo + Metallic + Roughness + opsiyonel Normal)
    dosyalarını doğrudan 1:1 gerçek cm ölçülü, y=0 tabanlı, YUMUŞAK VERTEX NORMAL'lı ve
    mobilya PBR kalibrasyonlu ikili .GLB olarak paketler.
    """
    base_no_ext = os.path.splitext(obj_path)[0]
    albedo_path = f"{base_no_ext}.jpg"
    metallic_path = f"{base_no_ext}_metallic.jpg"
    roughness_path = f"{base_no_ext}_roughness.jpg"
    normal_path = f"{base_no_ext}_normal.jpg"

    mesh = trimesh.load(obj_path, force="mesh", process=False)
    pts = np.asarray(mesh.vertices, dtype=np.float32).copy()
    faces = np.asarray(mesh.faces, dtype=np.uint32).copy()
    uvs = None
    if hasattr(mesh.visual, "uv") and mesh.visual.uv is not None:
        uvs = np.asarray(mesh.visual.uv, dtype=np.float32).copy()
        # OBJ UV (alt-sol orijin) -> glTF 2.0 UV (üst-sol orijin)
        uvs[:, 1] = 1.0 - uvs[:, 1]

    # Ölçek ve eksen hizalama (doğrudan vertex koordinatlarına işlenir -> sıfır node-matrix hatası!)
    pmin, pmax = pts.min(axis=0), pts.max(axis=0)
    ext = pmax - pmin
    tw = (float(width_cm) / 100.0) if (width_cm and float(width_cm) > 5) else 0.0
    td = (float(depth_cm) / 100.0) if (depth_cm and float(depth_cm) > 5) else 0.0
    th = (float(height_cm) / 100.0) if (height_cm and float(height_cm) > 5) else 0.0

    # Uzun yatay eksen hedef genişlikle uyuşmuyorsa 90° Y etrafında döndür
    if tw > 0 and td > 0 and (
        (tw > td * 1.15 and ext[2] > ext[0] * 1.15)
        or (td > tw * 1.15 and ext[0] > ext[2] * 1.15)
    ):
        old_x = pts[:, 0].copy()
        pts[:, 0] = pts[:, 2]
        pts[:, 2] = -old_x
        pmin, pmax = pts.min(axis=0), pts.max(axis=0)
        ext = pmax - pmin

    if tw > 0 and td > 0 and th > 0 and ext[0] > 1e-4 and ext[1] > 1e-4 and ext[2] > 1e-4:
        sx, sy, sz = tw / float(ext[0]), th / float(ext[1]), td / float(ext[2])
        base_s = sorted([sx, sy, sz])[1]
        clamp = lambda v: max(base_s * 0.84, min(base_s * 1.18, v))
        pts[:, 0] *= clamp(sx)
        pts[:, 1] *= clamp(sy)
        pts[:, 2] *= clamp(sz)
    elif tw > 0 and ext[0] > 1e-4:
        pts *= tw / float(ext[0])
    elif th > 0 and ext[1] > 1e-4:
        pts *= th / float(ext[1])

    pmin, pmax = pts.min(axis=0), pts.max(axis=0)
    pts[:, 0] -= (pmin[0] + pmax[0]) * 0.5
    pts[:, 1] -= pmin[1]
    pts[:, 2] -= (pmin[2] + pmax[2]) * 0.5

    fmin, fmax = pts.min(axis=0), pts.max(axis=0)
    fext = fmax - fmin
    w_cm = max(1, int(round(float(fext[0]) * 100.0)))
    h_cm = max(1, int(round(float(fext[1]) * 100.0)))
    d_cm = max(1, int(round(float(fext[2]) * 100.0)))

    # Yumuşak vertex normal'larını hesapla (kumaş ve kolçaklarda gerçek oda ışığı!)
    v_normals = _compute_smooth_vertex_normals(pts, faces)

    # Sıfırdan temiz glTF 2.0 ikili .GLB inşa et
    def pad4(n: int) -> int:
        return (4 - (n % 4)) % 4

    bin_buf = bytearray()
    bvs = []
    accessors = []

    def push_bv(data: bytes, target: Optional[int] = None) -> int:
        p = pad4(len(bin_buf))
        if p:
            bin_buf.extend(b"\x00" * p)
        off = len(bin_buf)
        bin_buf.extend(data)
        entry = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target is not None:
            entry["target"] = target
        bvs.append(entry)
        return len(bvs) - 1

    pos_bv = push_bv(pts.astype(np.float32).tobytes(), 34962)
    pos_acc = len(accessors)
    accessors.append(
        {
            "bufferView": pos_bv,
            "componentType": 5126,
            "count": len(pts),
            "type": "VEC3",
            "min": [float(v) for v in fmin],
            "max": [float(v) for v in fmax],
        }
    )

    norm_bv = push_bv(v_normals.astype(np.float32).tobytes(), 34962)
    norm_acc = len(accessors)
    accessors.append(
        {
            "bufferView": norm_bv,
            "componentType": 5126,
            "count": len(v_normals),
            "type": "VEC3",
        }
    )

    attrs = {"POSITION": pos_acc, "NORMAL": norm_acc}
    if uvs is not None and len(uvs) == len(pts):
        uv_bv = push_bv(uvs.astype(np.float32).tobytes(), 34962)
        uv_acc = len(accessors)
        accessors.append(
            {
                "bufferView": uv_bv,
                "componentType": 5126,
                "count": len(uvs),
                "type": "VEC2",
            }
        )
        attrs["TEXCOORD_0"] = uv_acc

    idx_bv = push_bv(faces.astype(np.uint32).tobytes(), 34963)
    idx_acc = len(accessors)
    accessors.append(
        {
            "bufferView": idx_bv,
            "componentType": 5125,
            "count": int(faces.size),
            "type": "SCALAR",
        }
    )

    images = []
    textures = []

    def push_tex(pil_img: Image.Image, name: str, q: int) -> int:
        jb = _encode_jpg(pil_img, q)
        bv_i = push_bv(jb)
        im_i = len(images)
        images.append({"name": name, "mimeType": "image/jpeg", "bufferView": bv_i})
        t_i = len(textures)
        textures.append({"sampler": 0, "source": im_i})
        return t_i

    albedo_pil = _resize_pil(Image.open(albedo_path).convert("RGB"), tex_max_side)
    tw_px, th_px = albedo_pil.size
    albedo_tex = push_tex(albedo_pil, "pbr_albedo_2k", jpg_q)

    # Gerçek Hunyuan3D-2.1 Roughness & Metallic + mobilya dielektrik kalibrasyonu
    # (Kumaş/ahşapta gürültülü %20-30 metaliklik değerlerini 0'a indirir -> plastik/gri parlaklık YOK!)
    rgb_f = np.asarray(albedo_pil, dtype=np.float32) / 255.0
    lum = 0.2126 * rgb_f[:, :, 0] + 0.7152 * rgb_f[:, :, 1] + 0.0722 * rgb_f[:, :, 2]
    ao_u8 = np.clip(np.round(((lum ** 0.35) * 0.55 + 0.45) * 255.0), 115, 255).astype(np.uint8)

    if os.path.exists(roughness_path):
        r_raw = np.asarray(
            Image.open(roughness_path).convert("L").resize((tw_px, th_px), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )
        # Mobilya kumaş/ahşap doğal matlık aralığı (0.55..0.95)
        rough_u8 = np.clip(np.round(r_raw * 0.75 + 75.0), 135, 245).astype(np.uint8)
    else:
        rough_u8 = np.clip(np.round((0.86 - lum * 0.12) * 255.0), 165, 238).astype(np.uint8)

    if os.path.exists(metallic_path):
        m_raw = np.asarray(
            Image.open(metallic_path).convert("L").resize((tw_px, th_px), Image.Resampling.LANCZOS),
            dtype=np.float32,
        )
        # Yalnızca gerçekten parlak metal (> 150) bölgeleri metalik bırak; kumaş & ahşap = 0!
        metal_u8 = np.where(m_raw > 150.0, np.clip((m_raw - 150.0) * 2.2, 0, 230), 0.0).astype(np.uint8)
    else:
        metal_u8 = np.zeros((th_px, tw_px), dtype=np.uint8)

    orm_pil = Image.fromarray(np.stack([ao_u8, rough_u8, metal_u8], axis=-1), mode="RGB")
    orm_tex = push_tex(orm_pil, "pbr_orm_2k", max(84, jpg_q - 3))

    if os.path.exists(normal_path):
        norm_pil = Image.open(normal_path).convert("RGB").resize((tw_px, th_px), Image.Resampling.LANCZOS)
    else:
        gy, gx = np.gradient(lum)
        nx, ny, nz = -gx * 1.8, -gy * 1.8, np.ones_like(lum)
        inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
        norm_arr = np.stack(
            [
                np.clip(np.round((nx * inv * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8),
                np.clip(np.round((ny * inv * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8),
                np.clip(np.round((nz * inv * 0.5 + 0.5) * 255.0), 128, 255).astype(np.uint8),
            ],
            axis=-1,
        )
        norm_pil = Image.fromarray(norm_arr, mode="RGB")
    norm_tex = push_tex(norm_pil, "pbr_normal_2k", max(84, jpg_q - 4))

    has_real_metal = bool(metal_u8.max() > 30)
    gltf = {
        "asset": {"version": "2.0", "generator": "MekanAR Hunyuan3D-2.1 2K PBR"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "MekanAR_Furniture", "mesh": 0}],
        "meshes": [
            {
                "name": "FurnitureMesh",
                "primitives": [{"attributes": attrs, "indices": idx_acc, "material": 0, "mode": 4}],
            }
        ],
        "materials": [
            {
                "name": "MekanAR_PBR_21_2K",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "baseColorTexture": {"index": albedo_tex},
                    "metallicFactor": 1.0 if has_real_metal else 0.0,
                    "roughnessFactor": 1.0,
                    "metallicRoughnessTexture": {"index": orm_tex},
                },
                "normalTexture": {"index": norm_tex, "scale": 0.55},
                "occlusionTexture": {"index": orm_tex, "strength": 0.85},
            }
        ],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "textures": textures,
        "images": images,
        "accessors": accessors,
        "bufferViews": bvs,
        "buffers": [{"byteLength": 0}],
    }

    p_end = pad4(len(bin_buf))
    if p_end:
        bin_buf.extend(b"\x00" * p_end)
    gltf["buffers"][0]["byteLength"] = len(bin_buf)

    new_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    jp = pad4(len(new_json))
    if jp:
        new_json += b" " * jp

    total = 12 + 8 + len(new_json) + 8 + len(bin_buf)
    out = bytearray()
    out.extend(struct.pack("<III", 0x46546C67, 2, total))
    out.extend(struct.pack("<II", len(new_json), 0x4E4F534A))
    out.extend(new_json)
    out.extend(struct.pack("<II", len(bin_buf), 0x004E4942))
    out.extend(bin_buf)
    return bytes(out), w_cm, d_cm, h_cm, (tw_px, th_px)


def handler(job):
    t_start = time.time()
    try:
        inp = job.get("input") or {}
        raw_images = inp.get("images")

        imgs_dict: Dict[str, str] = {}
        if isinstance(raw_images, dict):
            for k in ("front", "back", "left", "right"):
                if isinstance(raw_images.get(k), str) and raw_images.get(k):
                    imgs_dict[k] = raw_images[k]
        elif isinstance(raw_images, list) and raw_images:
            for k, v in zip(("front", "back", "left", "right"), raw_images):
                if isinstance(v, str) and v:
                    imgs_dict[k] = v

        if "front" not in imgs_dict:
            return {"ok": False, "error": "En az 1 önden ('front') ürün fotoğrafı gereklidir."}

        width_cm = inp.get("width_cm")
        depth_cm = inp.get("depth_cm")
        height_cm = inp.get("height_cm")
        product_id = inp.get("product_id")
        r2_put_url = inp.get("r2_put_url")
        r2_public_url = inp.get("r2_public_url")

        rembg = _ensure_rembg()
        front_clean = _clean_studio_background(rembg, _decode_image(imgs_dict["front"]))

        low_vram = _vram_gb() < 36.0

        # 1) Şekil Üretimi: Hunyuan3D-2.1 Full (40 adım, octree 384)
        shape_pipe = _get_shape_pipeline()
        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cuda")

        t_shape = time.time()
        with torch.no_grad():
            mesh = shape_pipe(
                image=front_clean,
                num_inference_steps=40,
                guidance_scale=7.5,
                octree_resolution=384,
                num_chunks=20000,
                generator=torch.manual_seed(42),
                output_type="trimesh",
            )[0]
        shape_sec = round(time.time() - t_shape, 2)

        # UV açma ve boyamadan ÖNCE olası stüdyo zemin levhasını temizle!
        mesh = _strip_floor_sheet_from_mesh(mesh)

        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cpu")
            gc.collect()
            torch.cuda.empty_cache()

        # 2) Gerçek 2K PBR Boyama: Hunyuan3D-2.1 Paint PBR + RealESRGAN x4 (downsample=False!)
        with tempfile.TemporaryDirectory(prefix="hy3d21_") as tmpdir:
            raw_mesh_path = os.path.join(tmpdir, "white_mesh.glb")
            out_obj_path = os.path.join(tmpdir, "textured_mesh.obj")
            mesh.export(raw_mesh_path)

            paint_pipe = _get_paint_pipeline()
            t_paint = time.time()
            with torch.no_grad():
                paint_pipe(
                    mesh_path=raw_mesh_path,
                    image_path=front_clean,
                    output_mesh_path=out_obj_path,
                    use_remesh=True,
                    save_glb=False,
                )
            paint_sec = round(time.time() - t_paint, 2)

            if low_vram and torch.cuda.is_available():
                gc.collect()
                torch.cuda.empty_cache()

            use_direct_r2 = bool(r2_put_url and r2_public_url)
            if use_direct_r2:
                final_glb, w_cm, d_cm, h_cm, tex_wh = _build_pbr_glb_from_obj(
                    out_obj_path,
                    width_cm=width_cm,
                    depth_cm=depth_cm,
                    height_cm=height_cm,
                    tex_max_side=2048,
                    jpg_q=92,
                )
                put_res = requests.put(
                    r2_put_url,
                    data=final_glb,
                    headers={"Content-Type": "model/gltf-binary"},
                    timeout=90,
                )
                if not put_res.ok:
                    raise RuntimeError(f"R2 doğrudan yükleme başarısız ({put_res.status_code}): {put_res.text[:200]}")

                total_sec = round(time.time() - t_start, 2)
                gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
                print(
                    f"[ar3d-21] R2 DIRECT 2K OK: shape={shape_sec}s paint={paint_sec}s total={total_sec}s "
                    f"tex={tex_wh[0]}x{tex_wh[1]} size={len(final_glb)/1024:.0f}KB dims={w_cm}x{d_cm}x{h_cm}cm gpu={gpu_name}",
                    flush=True,
                )
                return {
                    "ok": True,
                    "r2DirectSaved": True,
                    "productId": product_id,
                    "glbUrl": r2_public_url,
                    "widthCm": w_cm,
                    "depthCm": d_cm,
                    "heightCm": h_cm,
                    "dimensionsCm": f"{w_cm} × {d_cm} × {h_cm} cm",
                    "sizeKB": round(len(final_glb) / 1024.0, 1),
                    "texSize": f"{tex_wh[0]}x{tex_wh[1]}",
                    "shapeSec": shape_sec,
                    "paintSec": paint_sec,
                    "elapsedSec": total_sec,
                    "model": "Hunyuan3D-2.1 Studio 2K PBR",
                    "gpu": gpu_name,
                }

            final_glb, w_cm, d_cm, h_cm, tex_wh = _build_pbr_glb_from_obj(
                out_obj_path, width_cm=width_cm, depth_cm=depth_cm, height_cm=height_cm, tex_max_side=1024, jpg_q=88
            )
            if len(final_glb) > MAX_FALLBACK_BASE64_BYTES:
                final_glb, w_cm, d_cm, h_cm, tex_wh = _build_pbr_glb_from_obj(
                    out_obj_path, width_cm=width_cm, depth_cm=depth_cm, height_cm=height_cm, tex_max_side=768, jpg_q=82
                )

            total_sec = round(time.time() - t_start, 2)
            gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
            return {
                "ok": True,
                "glbBase64": base64.b64encode(final_glb).decode("ascii"),
                "widthCm": w_cm,
                "depthCm": d_cm,
                "heightCm": h_cm,
                "dimensionsCm": f"{w_cm} × {d_cm} × {h_cm} cm",
                "sizeKB": round(len(final_glb) / 1024.0, 1),
                "texSize": f"{tex_wh[0]}x{tex_wh[1]}",
                "shapeSec": shape_sec,
                "paintSec": paint_sec,
                "elapsedSec": total_sec,
                "model": "Hunyuan3D-2.1 Studio PBR",
                "gpu": gpu_name,
            }
    except Exception as exc:
        traceback.print_exc()
        return {"ok": False, "error": f"Hunyuan3D-2.1 PBR üretim hatası ({type(exc).__name__}): {exc}"}


if __name__ == "__main__":
    _ensure_rembg()
    _get_shape_pipeline()
    if _vram_gb() >= 36.0:
        _get_paint_pipeline()
    runpod.serverless.start({"handler": handler})
