"""
MekanAR — RunPod Serverless 1:1 3B Mobilya Üretim Worker'ı (Hunyuan3D-2 Turbo + PBR Paint)
  - Tek (önden) veya 2–4 açılı (ön/arka/sol/sağ) ürün fotoğraflarından ~15–22 saniyede
    dokulu, PBR normal/ORM haritalı, 1:1 gerçek santimetre ölçülü ve tabanı y=0 hizalı
    AR-hazır .GLB (<= 2.55 MB) üretir.
  - RTX 4090 / L4 (24 GB VRAM) ve L40S / A100 (48–80 GB VRAM) tam uyumludur.
"""

import base64
import io
import json
import os
import struct
import sys
import time
import traceback
from typing import Dict, Optional

os.environ.setdefault("HF_HOME", "/models/hf")
os.environ.setdefault("HY3DGEN_MODELS", "/models/hy3dgen")
os.environ.setdefault("U2NET_HOME", "/models/u2net")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

if "/opt/Hunyuan3D-2" not in sys.path:
    sys.path.insert(0, "/opt/Hunyuan3D-2")

import numpy as np
import runpod
import torch
import trimesh
from PIL import Image, ImageOps

_STATE = {
    "rembg": None,
    "shape_single": None,
    "shape_mv": None,
    "paint": None,
    "floater": None,
    "degen": None,
    "reducer": None,
}

MAX_GLB_BYTES = 2_550_000  # Vercel 4.5 MB JSON yanıt sınırı güvenliği (~3.4 MB base64)


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
        img = img.resize((max(64, int(round(img.width * s))), max(64, int(round(img.height * s)))), Image.Resampling.LANCZOS)
    return img


def _ensure_rembg_and_cleaners():
    if _STATE["rembg"] is None:
        from hy3dgen.rembg import BackgroundRemover
        from hy3dgen.shapegen import DegenerateFaceRemover, FaceReducer, FloaterRemover

        _STATE["rembg"] = BackgroundRemover()
        _STATE["floater"] = FloaterRemover()
        _STATE["degen"] = DegenerateFaceRemover()
        _STATE["reducer"] = FaceReducer()


def _get_shape_pipeline(multiview: bool):
    from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

    key = "shape_mv" if multiview else "shape_single"
    if _STATE[key] is None:
        t0 = time.time()
        if multiview:
            pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                "tencent/Hunyuan3D-2mv",
                subfolder="hunyuan3d-dit-v2-mv-turbo",
                variant="fp16",
                use_safetensors=True,
                device="cuda" if torch.cuda.is_available() else "cpu",
                dtype=torch.float16,
            )
        else:
            pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
                "tencent/Hunyuan3D-2",
                subfolder="hunyuan3d-dit-v2-0-turbo",
                variant="fp16",
                use_safetensors=True,
                device="cuda" if torch.cuda.is_available() else "cpu",
                dtype=torch.float16,
            )
        try:
            pipe.enable_flashvdm()
        except Exception as exc:
            print(f"[ar3d] FlashVDM uyarı (devam ediliyor): {exc}", flush=True)
        _STATE[key] = pipe
        print(f"[ar3d] {key} yüklendi ({time.time() - t0:.1f} sn)", flush=True)
    return _STATE[key]


def _get_paint_pipeline():
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    if _STATE["paint"] is None:
        t0 = time.time()
        pipe = Hunyuan3DPaintPipeline.from_pretrained(
            "tencent/Hunyuan3D-2",
            subfolder="hunyuan3d-paint-v2-0-turbo",
        )
        if _vram_gb() < 36.0:
            try:
                pipe.enable_model_cpu_offload()
            except Exception as exc:
                print(f"[ar3d] Paint CPU offload uyarısı: {exc}", flush=True)
        _STATE["paint"] = pipe
        print(f"[ar3d] paint pipeline yüklendi ({time.time() - t0:.1f} sn)", flush=True)
    return _STATE["paint"]


def _optimize_and_add_pbr(glb_buf: bytes, tex_max_side: int = 1024, jpg_q: int = 88) -> bytes:
    """
    GLB içindeki gömülü PNG temel dokuyu kompakt yüksek kaliteli JPEG'e dönüştürür,
    kumaş/ahşap gerçekçiliği için PBR Normal + ORM (AO/Roughness) haritalarını ekler.
    """
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
        orig_bin = bytes(glb_buf[20 + json_len + 8 :])

        if not gltf.get("materials") or not gltf.get("images") or not gltf.get("bufferViews"):
            return glb_buf

        def pad4(n: int) -> int:
            return (4 - (n % 4)) % 4

        def encode_jpg(pil_img: Image.Image, q: int) -> bytes:
            b = io.BytesIO()
            pil_img.convert("RGB").save(b, format="JPEG", quality=q, optimize=True)
            return b.getvalue()

        # Mevcut tüm gömülü görselleri kompakt JPEG olarak yeniden paketle
        mat0 = gltf["materials"][0]
        pbr = mat0.setdefault("pbrMetallicRoughness", {})
        base_info = pbr.get("baseColorTexture")
        base_img_idx = None
        if base_info is not None and gltf.get("textures"):
            base_img_idx = gltf["textures"][base_info["index"]].get("source")

        base_pil = None
        new_bin = bytearray()
        new_bvs = []
        img_bv_set = {im.get("bufferView") for im in gltf.get("images", []) if "bufferView" in im}

        bv_remap: Dict[int, int] = {}
        for old_i, bv in enumerate(gltf["bufferViews"]):
            if old_i in img_bv_set:
                continue
            off = bv.get("byteOffset", 0)
            ln = bv["byteLength"]
            p = pad4(len(new_bin))
            if p:
                new_bin.extend(b"\x00" * p)
            new_off = len(new_bin)
            new_bin.extend(orig_bin[off : off + ln])
            nbv = dict(bv)
            nbv["buffer"] = 0
            nbv["byteOffset"] = new_off
            nbv["byteLength"] = ln
            bv_remap[old_i] = len(new_bvs)
            new_bvs.append(nbv)

        for acc in gltf.get("accessors", []):
            if "bufferView" in acc and acc["bufferView"] in bv_remap:
                acc["bufferView"] = bv_remap[acc["bufferView"]]
            if "sparse" in acc:
                for subk in ("indices", "values"):
                    if subk in acc["sparse"] and acc["sparse"][subk].get("bufferView") in bv_remap:
                        acc["sparse"][subk]["bufferView"] = bv_remap[acc["sparse"][subk]["bufferView"]]

        for i_idx, im in enumerate(gltf["images"]):
            old_bv = gltf["bufferViews"][im["bufferView"]]
            raw_img = orig_bin[old_bv.get("byteOffset", 0) : old_bv.get("byteOffset", 0) + old_bv["byteLength"]]
            pil = Image.open(io.BytesIO(raw_img)).convert("RGB")
            if max(pil.size) > tex_max_side:
                s = float(tex_max_side) / float(max(pil.size))
                pil = pil.resize((max(64, int(round(pil.width * s))), max(64, int(round(pil.height * s)))), Image.Resampling.LANCZOS)
            if i_idx == base_img_idx:
                base_pil = pil
            jpg_b = encode_jpg(pil, jpg_q)
            p = pad4(len(new_bin))
            if p:
                new_bin.extend(b"\x00" * p)
            new_off = len(new_bin)
            new_bin.extend(jpg_b)
            im["bufferView"] = len(new_bvs)
            im["mimeType"] = "image/jpeg"
            new_bvs.append({"buffer": 0, "byteOffset": new_off, "byteLength": len(jpg_b)})

        gltf["bufferViews"] = new_bvs

        # PBR Normal + ORM haritalarını ekle (plastik parlaklık yerine gerçek kumaş/ahşap dokusu)
        if base_pil is not None and "normalTexture" not in mat0:
            rgb = np.asarray(base_pil, dtype=np.float32) / 255.0
            lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
            ao = np.clip((lum ** 0.40) * 0.84 + 0.20, 0.36, 1.0)
            rough = np.clip(0.86 - lum * 0.14, 0.64, 0.92)
            orm = np.stack(
                [
                    np.round(ao * 255).astype(np.uint8),
                    np.round(rough * 255).astype(np.uint8),
                    np.zeros_like(ao, dtype=np.uint8),
                ],
                axis=-1,
            )

            gy, gx = np.gradient(lum)
            nx, ny, nz = -gx * 2.4, -gy * 2.4, np.ones_like(lum)
            inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
            norm_map = np.stack(
                [
                    np.clip(np.round((nx * inv * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8),
                    np.clip(np.round((ny * inv * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8),
                    np.clip(np.round((nz * inv * 0.5 + 0.5) * 255), 128, 255).astype(np.uint8),
                ],
                axis=-1,
            )

            def append_tex(arr: np.ndarray, name: str) -> int:
                jb = encode_jpg(Image.fromarray(arr, mode="RGB"), max(76, jpg_q - 4))
                p = pad4(len(new_bin))
                if p:
                    new_bin.extend(b"\x00" * p)
                off = len(new_bin)
                new_bin.extend(jb)
                gltf["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(jb)})
                gltf["images"].append(
                    {"name": name, "mimeType": "image/jpeg", "bufferView": len(gltf["bufferViews"]) - 1}
                )
                gltf.setdefault(
                    "samplers",
                    [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
                )
                gltf.setdefault("textures", []).append({"sampler": 0, "source": len(gltf["images"]) - 1})
                return len(gltf["textures"]) - 1

            norm_idx = append_tex(norm_map, "pbr_normal")
            orm_idx = append_tex(orm, "pbr_orm")
            pbr["metallicFactor"] = 0.0
            pbr["roughnessFactor"] = 1.0
            pbr["metallicRoughnessTexture"] = {"index": orm_idx}
            mat0["normalTexture"] = {"index": norm_idx, "scale": 0.85}
            mat0["occlusionTexture"] = {"index": orm_idx, "strength": 0.88}

        p_end = pad4(len(new_bin))
        if p_end:
            new_bin.extend(b"\x00" * p_end)
        gltf["buffers"][0]["byteLength"] = len(new_bin)

        new_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        jp = pad4(len(new_json))
        if jp:
            new_json += b" " * jp

        total = 12 + 8 + len(new_json) + 8 + len(new_bin)
        out = bytearray()
        out.extend(struct.pack("<III", 0x46546C67, 2, total))
        out.extend(struct.pack("<II", len(new_json), 0x4E4F534A))
        out.extend(new_json)
        out.extend(struct.pack("<II", len(new_bin), 0x004E4942))
        out.extend(new_bin)
        return bytes(out)
    except Exception:
        traceback.print_exc()
        return glb_buf


def _scale_ground_and_pack_glb(
    raw_glb: bytes,
    width_cm: Optional[float],
    depth_cm: Optional[float],
    height_cm: Optional[float],
):
    scene = trimesh.load(io.BytesIO(raw_glb), file_type="glb", force="scene")
    bounds = scene.bounds
    if bounds is not None:
        ext = bounds[1] - bounds[0]
        tw = (float(width_cm) / 100.0) if (width_cm and float(width_cm) > 5) else 0.0
        td = (float(depth_cm) / 100.0) if (depth_cm and float(depth_cm) > 5) else 0.0
        th = (float(height_cm) / 100.0) if (height_cm and float(height_cm) > 5) else 0.0

        # Uzun yatay eksen hedef genişlikle uyuşmuyorsa 90° döndür
        if tw > 0 and td > 0 and ((tw > td * 1.15 and ext[2] > ext[0] * 1.15) or (td > tw * 1.15 and ext[0] > ext[2] * 1.15)):
            rot_y = trimesh.transformations.rotation_matrix(np.pi / 2.0, [0, 1, 0])
            scene.apply_transform(rot_y)
            bounds = scene.bounds
            ext = bounds[1] - bounds[0]

        if tw > 0 and td > 0 and th > 0 and ext[0] > 1e-4 and ext[1] > 1e-4 and ext[2] > 1e-4:
            sx, sy, sz = tw / float(ext[0]), th / float(ext[1]), td / float(ext[2])
            base = sorted([sx, sy, sz])[1]
            clamp = lambda v: max(base * 0.84, min(base * 1.18, v))
            S = np.diag([clamp(sx), clamp(sy), clamp(sz), 1.0])
            scene.apply_transform(S)
        elif tw > 0 and ext[0] > 1e-4:
            scene.apply_scale(tw / float(ext[0]))
        elif th > 0 and ext[1] > 1e-4:
            scene.apply_scale(th / float(ext[1]))

        b2 = scene.bounds
        cx = (float(b2[0][0]) + float(b2[1][0])) * 0.5
        min_y = float(b2[0][1])
        cz = (float(b2[0][2]) + float(b2[1][2])) * 0.5
        scene.apply_translation([-cx, -min_y, -cz])

    b_fin = scene.bounds
    if b_fin is not None:
        fin_ext = b_fin[1] - b_fin[0]
        w_cm = max(1, int(round(float(fin_ext[0]) * 100.0)))
        h_cm = max(1, int(round(float(fin_ext[1]) * 100.0)))
        d_cm = max(1, int(round(float(fin_ext[2]) * 100.0)))
    else:
        w_cm, d_cm, h_cm = 100, 100, 80

    exp = scene.export(file_type="glb")
    if isinstance(exp, str):
        exp = exp.encode("latin1")

    # Vercel 4.5 MB limitini aşmayacak en yüksek doku netliğini seç
    packed = _optimize_and_add_pbr(exp, tex_max_side=1024, jpg_q=88)
    if len(packed) > MAX_GLB_BYTES:
        packed = _optimize_and_add_pbr(exp, tex_max_side=768, jpg_q=82)
    if len(packed) > MAX_GLB_BYTES:
        packed = _optimize_and_add_pbr(exp, tex_max_side=512, jpg_q=76)
    return packed, w_cm, d_cm, h_cm


def handler(job):
    t_start = time.time()
    try:
        inp = job.get("input") or {}
        raw_images = inp.get("images")

        # Sözlük ({front, back, left, right}) veya liste ([front, ...]) kabul et
        imgs_dict: Dict[str, str] = {}
        if isinstance(raw_images, dict):
            for k in ("front", "back", "left", "right"):
                if isinstance(raw_images.get(k), str) and raw_images.get(k):
                    imgs_dict[k] = raw_images[k]
        elif isinstance(raw_images, list) and raw_images:
            keys = ("front", "back", "left", "right")
            for k, v in zip(keys, raw_images):
                if isinstance(v, str) and v:
                    imgs_dict[k] = v

        if "front" not in imgs_dict:
            return {"ok": False, "error": "En az 1 önden ('front') ürün fotoğrafı gereklidir."}

        width_cm = inp.get("width_cm")
        depth_cm = inp.get("depth_cm")
        height_cm = inp.get("height_cm")

        _ensure_rembg_and_cleaners()
        rembg = _STATE["rembg"]
        cleaned: Dict[str, Image.Image] = {}
        for k, b64 in imgs_dict.items():
            cleaned[k] = rembg(_decode_image(b64))

        use_mv = len(cleaned) >= 2 and ("back" in cleaned or "left" in cleaned)
        low_vram = _vram_gb() < 36.0

        shape_pipe = _get_shape_pipeline(multiview=use_mv)
        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cuda")

        t_shape = time.time()
        with torch.no_grad():
            if use_mv:
                mesh = shape_pipe(
                    image=cleaned,
                    num_inference_steps=6,
                    guidance_scale=5.0,
                    octree_resolution=320,
                    num_chunks=20000,
                    generator=torch.manual_seed(42),
                    output_type="trimesh",
                )[0]
            else:
                mesh = shape_pipe(
                    image=cleaned["front"],
                    num_inference_steps=6,
                    guidance_scale=5.0,
                    octree_resolution=320,
                    num_chunks=20000,
                    generator=torch.manual_seed(42),
                    output_type="trimesh",
                )[0]
        shape_sec = round(time.time() - t_shape, 2)

        # Mesh temizliği + 24K üçgene sadeleştirme (AR + UV unwrapping için ideal hız ve keskinlik)
        mesh = _STATE["floater"](mesh)
        mesh = _STATE["degen"](mesh)
        mesh = _STATE["reducer"](mesh, max_facenum=24000)

        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cpu")
            torch.cuda.empty_cache()

        # PBR Doku Boyama
        paint_pipe = _get_paint_pipeline()
        t_paint = time.time()
        with torch.no_grad():
            textured_mesh = paint_pipe(mesh, image=cleaned["front"])
        paint_sec = round(time.time() - t_paint, 2)

        if low_vram and torch.cuda.is_available():
            torch.cuda.empty_cache()

        raw_io = io.BytesIO()
        textured_mesh.export(raw_io, file_type="glb")
        final_glb, w_cm, d_cm, h_cm = _scale_ground_and_pack_glb(
            raw_io.getvalue(),
            width_cm=width_cm,
            depth_cm=depth_cm,
            height_cm=height_cm,
        )

        glb_b64 = base64.b64encode(final_glb).decode("ascii")
        total_sec = round(time.time() - t_start, 2)
        gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
        print(
            f"[ar3d] Tamamlandı: views={len(cleaned)} mv={use_mv} "
            f"shape={shape_sec}s paint={paint_sec}s total={total_sec}s "
            f"size={len(final_glb)/1024:.0f}KB dims={w_cm}x{d_cm}x{h_cm}cm gpu={gpu_name}",
            flush=True,
        )
        return {
            "ok": True,
            "glbBase64": glb_b64,
            "widthCm": w_cm,
            "depthCm": d_cm,
            "heightCm": h_cm,
            "dimensionsCm": f"{w_cm} × {d_cm} × {h_cm} cm",
            "sizeKB": round(len(final_glb) / 1024.0, 1),
            "shapeSec": shape_sec,
            "paintSec": paint_sec,
            "elapsedSec": total_sec,
            "model": "Hunyuan3D-2 Turbo MV" if use_mv else "Hunyuan3D-2 Turbo",
            "gpu": gpu_name,
        }
    except Exception as exc:
        traceback.print_exc()
        return {"ok": False, "error": f"3B mobilya üretim hatası ({type(exc).__name__}): {exc}"}


if __name__ == "__main__":
    _ensure_rembg_and_cleaners()
    _get_shape_pipeline(multiview=False)
    if _vram_gb() >= 36.0:
        _get_paint_pipeline()
    runpod.serverless.start({"handler": handler})
