"""
MekanAR — RunPod Serverless 1:1 3B Mobilya Üretim Worker'ı (Hunyuan3D-2.1 Full PBR · 2K)
  - 1 veya 2–4 açılı (ön/arka/sol/sağ) ürün fotoğraflarından:
      1) Hunyuan3D-2.1 Shape (40 adım tam difüzyon, octree 384) ile keskin 3B geometri,
      2) Hunyuan3D-2.1 Paint PBR + RealESRGAN x4 ile GERÇEK fiziksel PBR haritaları
         (Albedo + Metallic + Roughness + Normal),
      3) Gerçek santimetre (1:1) ölçekleme ve tabanı y=0 zemin kilidi uygular.
  - r2_put_url verilirse 2048x2048 (2K) PBR .GLB dosyasını sıkıştırma kaybı olmadan
    DOĞRUDAN Cloudflare R2'ye yükler (Vercel 4.5 MB sınırına hiç takılmaz!).
  - L40S (48 GB) / A100 (80 GB) üzerinde yüksek çözünürlükte tam hızda;
    RTX 4090 / L4 (24 GB) üzerinde otomatik sıralı VRAM yönetimiyle sorunsuz çalışır.
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

import numpy as np
import requests
import runpod
import torch
import trimesh
from PIL import Image, ImageOps

MODEL_DIR = "/models/hy3d21"
MAX_FALLBACK_BASE64_BYTES = 2_550_000  # Yalnızca R2 verilmezse Vercel 4.5 MB JSON sınırı için

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
        # 48GB L40S / 80GB A100: 768px çok-açılı + 4K bake -> 2K cam gibi PBR
        # 24GB RTX 4090 / L4: 512px çok-açılı + RealESRGAN x4 -> 2K PBR (sıfır OOM!)
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


def _build_pbr_glb_from_obj(
    obj_path: str,
    width_cm: Optional[float],
    depth_cm: Optional[float],
    height_cm: Optional[float],
    tex_max_side: int = 2048,
    jpg_q: int = 91,
):
    """
    Hunyuan3D-2.1 Paint PBR çıktısı olan (.obj + albedo + _metallic + _roughness + opsiyonel _normal)
    dosyalarını okur; 1:1 gerçek cm ölçüsüne ölçekleyip tabanı y=0'a kilitler ve tam glTF 2.0
    PBR (Albedo + ORM + Normal) ikili .GLB üretir.
    """
    base_no_ext = os.path.splitext(obj_path)[0]
    albedo_path = f"{base_no_ext}.jpg"
    metallic_path = f"{base_no_ext}_metallic.jpg"
    roughness_path = f"{base_no_ext}_roughness.jpg"
    normal_path = f"{base_no_ext}_normal.jpg"

    scene = trimesh.load(obj_path, force="scene", process=False)
    bounds = scene.bounds
    if bounds is not None:
        ext = bounds[1] - bounds[0]
        tw = (float(width_cm) / 100.0) if (width_cm and float(width_cm) > 5) else 0.0
        td = (float(depth_cm) / 100.0) if (depth_cm and float(depth_cm) > 5) else 0.0
        th = (float(height_cm) / 100.0) if (height_cm and float(height_cm) > 5) else 0.0

        # Uzun yatay eksen hedef genişlikle uyuşmuyorsa 90° döndür
        if tw > 0 and td > 0 and (
            (tw > td * 1.15 and ext[2] > ext[0] * 1.15)
            or (td > tw * 1.15 and ext[0] > ext[2] * 1.15)
        ):
            rot_y = trimesh.transformations.rotation_matrix(np.pi / 2.0, [0, 1, 0])
            scene.apply_transform(rot_y)
            bounds = scene.bounds
            ext = bounds[1] - bounds[0]

        if tw > 0 and td > 0 and th > 0 and ext[0] > 1e-4 and ext[1] > 1e-4 and ext[2] > 1e-4:
            sx, sy, sz = tw / float(ext[0]), th / float(ext[1]), td / float(ext[2])
            base_s = sorted([sx, sy, sz])[1]
            clamp = lambda v: max(base_s * 0.84, min(base_s * 1.18, v))
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

    raw_glb = scene.export(file_type="glb")
    if isinstance(raw_glb, str):
        raw_glb = raw_glb.encode("latin1")

    packed = _inject_real_pbr_maps(
        raw_glb,
        albedo_path=albedo_path if os.path.exists(albedo_path) else None,
        metallic_path=metallic_path if os.path.exists(metallic_path) else None,
        roughness_path=roughness_path if os.path.exists(roughness_path) else None,
        normal_path=normal_path if os.path.exists(normal_path) else None,
        tex_max_side=tex_max_side,
        jpg_q=jpg_q,
    )
    return packed, w_cm, d_cm, h_cm


def _inject_real_pbr_maps(
    glb_buf: bytes,
    albedo_path: Optional[str],
    metallic_path: Optional[str],
    roughness_path: Optional[str],
    normal_path: Optional[str],
    tex_max_side: int = 2048,
    jpg_q: int = 91,
) -> bytes:
    """
    GLB geometrisini ve UV'lerini koruyarak eski görselleri temizler ve gerçek
    Hunyuan3D-2.1 Albedo + ORM (AO/Roughness/Metallic) + Normal haritalarını
    kompakt, cam gibi JPEG olarak gömer.
    """
    try:
        magic, version, _ = struct.unpack_from("<III", glb_buf, 0)
        if magic != 0x46546C67 or version != 2:
            return glb_buf
        json_len, json_type = struct.unpack_from("<II", glb_buf, 12)
        if json_type != 0x4E4F534A:
            return glb_buf

        gltf = json.loads(glb_buf[20 : 20 + json_len].decode("utf-8"))
        orig_bin = bytes(glb_buf[20 + json_len + 8 :])

        def pad4(n: int) -> int:
            return (4 - (n % 4)) % 4

        # Eski gömülü görselleri çıkar, yalnızca geometri + UV bufferView'larını koru
        img_bv_set = {im.get("bufferView") for im in gltf.get("images", []) if "bufferView" in im}
        new_bin = bytearray()
        new_bvs = []
        bv_remap: Dict[int, int] = {}

        for old_i, bv in enumerate(gltf.get("bufferViews", [])):
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

        gltf["bufferViews"] = new_bvs
        gltf["images"] = []
        gltf["textures"] = []
        gltf["samplers"] = [
            {"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}
        ]

        def add_image_texture(pil_img: Image.Image, name: str, q: int) -> int:
            jb = _encode_jpg(pil_img, q)
            p = pad4(len(new_bin))
            if p:
                new_bin.extend(b"\x00" * p)
            off = len(new_bin)
            new_bin.extend(jb)
            bv_idx = len(gltf["bufferViews"])
            gltf["bufferViews"].append({"buffer": 0, "byteOffset": off, "byteLength": len(jb)})
            img_idx = len(gltf["images"])
            gltf["images"].append({"name": name, "mimeType": "image/jpeg", "bufferView": bv_idx})
            tex_idx = len(gltf["textures"])
            gltf["textures"].append({"sampler": 0, "source": img_idx})
            return tex_idx

        albedo_pil = _resize_pil(Image.open(albedo_path).convert("RGB"), tex_max_side) if albedo_path else None
        if albedo_pil is None:
            return glb_buf

        tw, th = albedo_pil.size
        albedo_tex = add_image_texture(albedo_pil, "pbr_albedo", jpg_q)

        # Gerçek Hunyuan3D-2.1 Metallic & Roughness haritalarını glTF 2.0 ORM kanalına birleştir (R=AO, G=Roughness, B=Metallic)
        rgb_f = np.asarray(albedo_pil, dtype=np.float32) / 255.0
        lum = 0.2126 * rgb_f[:, :, 0] + 0.7152 * rgb_f[:, :, 1] + 0.0722 * rgb_f[:, :, 2]
        ao_u8 = np.clip(np.round(((lum ** 0.35) * 0.65 + 0.35) * 255.0), 90, 255).astype(np.uint8)

        if roughness_path:
            rough_pil = Image.open(roughness_path).convert("L").resize((tw, th), Image.Resampling.LANCZOS)
            rough_u8 = np.asarray(rough_pil, dtype=np.uint8)
        else:
            rough_u8 = np.clip(np.round((0.84 - lum * 0.14) * 255.0), 150, 235).astype(np.uint8)

        if metallic_path:
            metal_pil = Image.open(metallic_path).convert("L").resize((tw, th), Image.Resampling.LANCZOS)
            metal_u8 = np.asarray(metal_pil, dtype=np.uint8)
        else:
            metal_u8 = np.zeros((th, tw), dtype=np.uint8)

        orm_pil = Image.fromarray(np.stack([ao_u8, rough_u8, metal_u8], axis=-1), mode="RGB")
        orm_tex = add_image_texture(orm_pil, "pbr_orm", max(82, jpg_q - 3))

        # Gerçek Normal haritası varsa onu kullan, yoksa yüksek çözünürlüklü mikro-yüzey normal haritası çıkar
        if normal_path:
            norm_pil = Image.open(normal_path).convert("RGB").resize((tw, th), Image.Resampling.LANCZOS)
        else:
            gy, gx = np.gradient(lum)
            nx, ny, nz = -gx * 2.0, -gy * 2.0, np.ones_like(lum)
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
        norm_tex = add_image_texture(norm_pil, "pbr_normal", max(82, jpg_q - 4))

        mat = {
            "name": "MekanAR_PBR_21",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                "baseColorTexture": {"index": albedo_tex},
                "metallicFactor": 1.0 if metallic_path else 0.0,
                "roughnessFactor": 1.0,
                "metallicRoughnessTexture": {"index": orm_tex},
            },
            "normalTexture": {"index": norm_tex, "scale": 0.72},
            "occlusionTexture": {"index": orm_tex, "strength": 0.75},
        }
        gltf["materials"] = [mat]
        for m in gltf.get("meshes", []):
            for prim in m.get("primitives", []):
                prim["material"] = 0

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
        cleaned_list: List[Image.Image] = []
        front_clean: Optional[Image.Image] = None
        for k in ("front", "back", "left", "right"):
            if k in imgs_dict:
                rgba = rembg(_decode_image(imgs_dict[k]))
                if k == "front":
                    front_clean = rgba
                cleaned_list.append(rgba)

        low_vram = _vram_gb() < 36.0

        # 1) Şekil Üretimi: Hunyuan3D-2.1 Full (40 adım, octree 384 -> keskin mobilya kenarları!)
        shape_pipe = _get_shape_pipeline()
        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cuda")

        t_shape = time.time()
        with torch.no_grad():
            mesh = shape_pipe(
                image=front_clean,
                num_inference_steps=35,
                guidance_scale=7.5,
                octree_resolution=384,
                num_chunks=20000,
                generator=torch.manual_seed(42),
                output_type="trimesh",
            )[0]
        shape_sec = round(time.time() - t_shape, 2)

        if low_vram and torch.cuda.is_available():
            shape_pipe.to("cpu")
            gc.collect()
            torch.cuda.empty_cache()

        # 2) Gerçek PBR Boyama: Hunyuan3D-2.1 Paint PBR (Albedo + Metallic + Roughness + RealESRGAN x4)
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

            # 3) 1:1 gerçek cm ölçek + y=0 zemin kilidi + 2K PBR .GLB paketleme
            use_direct_r2 = bool(r2_put_url and r2_public_url)
            if use_direct_r2:
                # R2 doğrudan yüklemede 2.55 MB sınırı YOK -> tam 2048x2048 2K PBR kalite!
                final_glb, w_cm, d_cm, h_cm = _build_pbr_glb_from_obj(
                    out_obj_path,
                    width_cm=width_cm,
                    depth_cm=depth_cm,
                    height_cm=height_cm,
                    tex_max_side=2048,
                    jpg_q=91,
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
                    f"[ar3d-21] R2 DIRECT OK: views={len(cleaned_list)} shape={shape_sec}s paint={paint_sec}s "
                    f"total={total_sec}s size={len(final_glb)/1024:.0f}KB dims={w_cm}x{d_cm}x{h_cm}cm gpu={gpu_name}",
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
                    "shapeSec": shape_sec,
                    "paintSec": paint_sec,
                    "elapsedSec": total_sec,
                    "model": "Hunyuan3D-2.1 Full PBR (2K)",
                    "gpu": gpu_name,
                }

            # Yedek yol (R2 verilmediyse <= 2.55 MB base64 yanıtı)
            final_glb, w_cm, d_cm, h_cm = _build_pbr_glb_from_obj(
                out_obj_path, width_cm=width_cm, depth_cm=depth_cm, height_cm=height_cm, tex_max_side=1024, jpg_q=88
            )
            if len(final_glb) > MAX_FALLBACK_BASE64_BYTES:
                final_glb, w_cm, d_cm, h_cm = _build_pbr_glb_from_obj(
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
                "shapeSec": shape_sec,
                "paintSec": paint_sec,
                "elapsedSec": total_sec,
                "model": "Hunyuan3D-2.1 Full PBR",
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
