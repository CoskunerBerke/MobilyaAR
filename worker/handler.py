"""
MekanAR (Odanda Gör) v10 — RunPod Serverless Dual-Model GPU Worker
  1) ByteDance Depth-Anything-3 Nested Metric Giant-Large 1.1 (DA3NESTED-GIANT-LARGE-1.1):
     - 36 bulanıklık-filtreli HD kareden yüksek doğruluklu kamera pozları, 1:1 metrik derinlik
       ve sinirsel 3D Gaussian başlangıcı (infer_gs=True) üretir.
  2) gsplat v1.5.3 (CUDA 12.8 AOT) + NVIDIA Difix3D+ (nvidia/difix_ref, bf16 / fp32 VAE):
     - Sıkı 3.8 cm ölçek sınırı + 3.400 adım HD eğitim + 24 göz-hizası/köşe/zemin/orbit açısı
       Difix3D+ temizliği -> 140.000 yüksek opaklıklı keskin splat (sıfır kasma, net köşeler).
"""

import base64
import os
import sys
import tempfile
import time
import traceback

os.environ.setdefault("HF_HOME", "/models/hf")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
if "/opt/difix" not in sys.path:
    sys.path.insert(0, "/opt/difix")

import numpy as np
import runpod
import torch

from postprocess import build_room_payload

DA3_MODEL_ID = os.environ.get("DA3_MODEL_ID", "depth-anything/DA3NESTED-GIANT-LARGE-1.1")
DIFIX_MODEL_DIR = os.environ.get("DIFIX_MODEL_DIR", "/models/difix_ref_fp16")
MAX_IMAGES = int(os.environ.get("MAX_IMAGES", "36"))
DA3_PROCESS_RES = int(os.environ.get("DA3_PROCESS_RES", "504"))

_DA3_MODEL = None
_DIFIX_PIPE = None
_DIFIX_LOAD_ERR = None


def _total_vram_gb() -> float:
    if not torch.cuda.is_available():
        return 0.0
    try:
        return float(torch.cuda.get_device_properties(0).total_memory) / (1024.0 ** 3)
    except Exception:
        return 0.0


def get_da3_model():
    global _DA3_MODEL
    if _DA3_MODEL is None:
        from depth_anything_3.api import DepthAnything3

        t0 = time.time()
        _DA3_MODEL = DepthAnything3.from_pretrained(DA3_MODEL_ID).eval()
        if torch.cuda.is_available():
            _DA3_MODEL = _DA3_MODEL.to("cuda")
        print(f"[worker-v10] {DA3_MODEL_ID} loaded in {time.time() - t0:.1f}s", flush=True)
    return _DA3_MODEL


def get_difix_pipe():
    global _DIFIX_PIPE, _DIFIX_LOAD_ERR
    if _DIFIX_PIPE is None:
        try:
            from pipeline_difix import DifixPipeline

            t0 = time.time()
            src = DIFIX_MODEL_DIR if os.path.isdir(DIFIX_MODEL_DIR) else "nvidia/difix_ref"
            local_only = os.path.isdir(DIFIX_MODEL_DIR)
            # SD-Turbo/SD2.1 VAE fp16 taşması yapmasın diye bf16 (veya fp32) yükle!
            use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
            dtype = torch.bfloat16 if use_bf16 else torch.float32
            pipe = DifixPipeline.from_pretrained(
                src,
                trust_remote_code=True,
                torch_dtype=dtype,
                local_files_only=local_only,
            )
            pipe.set_progress_bar_config(disable=True)
            if torch.cuda.is_available() and _total_vram_gb() >= 34.0:
                pipe.to("cuda")
            _DIFIX_PIPE = pipe
            _DIFIX_LOAD_ERR = None
            print(f"[worker-v10] Difix3D+ ({src}, dtype={dtype}) loaded in {time.time() - t0:.1f}s", flush=True)
        except Exception as exc:
            _DIFIX_LOAD_ERR = f"{type(exc).__name__}: {exc}"
            print(f"[worker-v10] Difix3D+ yüklenemedi: {_DIFIX_LOAD_ERR}", flush=True)
            _DIFIX_PIPE = False
    return _DIFIX_PIPE if _DIFIX_PIPE is not False else None


def _to_np(x):
    if isinstance(x, torch.Tensor):
        return x.detach().float().cpu().numpy()
    return np.asarray(x)


def _extract_da3_gaussians(pred, H: int, W: int, n_views: int):
    gs_world = getattr(pred, "gaussians", None)
    if gs_world is None:
        return None
    try:
        sf = float(pred.scale_factor) if getattr(pred, "scale_factor", None) else 1.0
        if not np.isfinite(sf) or sf <= 1e-4:
            sf = 1.0

        means = _to_np(gs_world.means)[0] * sf
        scales = _to_np(gs_world.scales)[0] * sf
        quats = _to_np(gs_world.rotations)[0]
        harm = _to_np(gs_world.harmonics)[0]
        if harm.ndim == 3:
            sh_dc = harm[:, :, 0] if harm.shape[1] == 3 else harm[:, 0, :]
        else:
            sh_dc = harm[:, :3]
        opas = _to_np(gs_world.opacities)[0].reshape(-1)

        expected = n_views * H * W
        if len(means) == expected:
            # Köşe ve duvar uçlarını kaybetmemek için çok ince (%1.5) kenar kırpma + alt %10 güven eşiği
            keep_vhw = np.ones((n_views, H, W), dtype=bool)
            bh = max(1, int(round(H * 0.015)))
            bw = max(1, int(round(W * 0.015)))
            keep_vhw[:, :bh, :] = False
            keep_vhw[:, -bh:, :] = False
            keep_vhw[:, :, :bw] = False
            keep_vhw[:, :, -bw:] = False
            sky = getattr(pred, "sky", None)
            if sky is not None and sky.shape == (n_views, H, W):
                keep_vhw &= (np.asarray(sky) < 0.45)
            conf = getattr(pred, "conf", None)
            if conf is not None and conf.shape == (n_views, H, W):
                cf = np.asarray(conf, dtype=np.float32)
                finite_c = cf[np.isfinite(cf)]
                if len(finite_c) > 100:
                    c_thr = float(np.percentile(finite_c, 10))
                    keep_vhw &= (cf >= c_thr)
            flat_keep = keep_vhw.reshape(-1)
            means = means[flat_keep]
            scales = scales[flat_keep]
            quats = quats[flat_keep]
            sh_dc = sh_dc[flat_keep]
            opas = opas[flat_keep]

        return {
            "positions": means.astype(np.float32),
            "scales": scales.astype(np.float32),
            "quats_wxyz": quats.astype(np.float32),
            "sh_dc": sh_dc.astype(np.float32),
            "opacities": opas.astype(np.float32),
        }
    except Exception as exc:
        print(f"[worker-v10] DA3 Gaussian çıkarımı atlandı: {exc}", flush=True)
        return None


def handler(job):
    t_start = time.time()
    inp = job.get("input") or {}
    images = inp.get("images") or []
    if len(images) < 4:
        return {"ok": False, "error": "En az 4 fotoğraf veya video karesi gerekli."}
    images = images[:MAX_IMAGES]

    try:
        from PIL import Image

        vram_gb = _total_vram_gb()
        low_vram = torch.cuda.is_available() and vram_gb < 34.0

        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            hd_rgbs = []
            for i, b64 in enumerate(images):
                if "," in b64[:100]:
                    b64 = b64.split(",", 1)[1]
                p = os.path.join(tmp, f"{i:03d}.jpg")
                with open(p, "wb") as f:
                    f.write(base64.b64decode(b64))
                with Image.open(p) as im:
                    hd_rgbs.append(np.asarray(im.convert("RGB"), dtype=np.uint8))
                paths.append(p)

            da3 = get_da3_model()
            if low_vram:
                da3.to("cuda")

            # Yüksek çözünürlüklü durgun fotoğraflarda (<=22 kare, >=900px) DA3 çözünürlüğünü 560px'e çıkar
            max_inp_edge = max((max(im.shape[0], im.shape[1]) for im in hd_rgbs), default=504)
            da3_res = 560 if (len(paths) <= 22 and max_inp_edge >= 900) else DA3_PROCESS_RES

            t_inf = time.time()
            with torch.no_grad():
                pred = da3.inference(
                    image=paths,
                    process_res=da3_res,
                    infer_gs=True,
                    ref_view_strategy="saddle_balanced",
                )
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            infer_s = time.time() - t_inf

            if low_vram:
                da3.to("cpu")
                torch.cuda.empty_cache()

        depths = np.asarray(pred.depth, dtype=np.float32)
        N, H, W = depths.shape
        confs = np.asarray(pred.conf, dtype=np.float32) if pred.conf is not None else np.ones_like(depths)
        skies = np.asarray(pred.sky, dtype=np.float32) if pred.sky is not None else None
        exts = np.asarray(pred.extrinsics, dtype=np.float64)
        ixts = np.asarray(pred.intrinsics, dtype=np.float64)
        proc_imgs = np.asarray(pred.processed_images, dtype=np.uint8)

        gs_init = _extract_da3_gaussians(pred, H, W, N)

        uu, vv = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))
        views_data = []
        for idx_p in range(N):
            d_hw = depths[idx_p].astype(np.float64)
            K = ixts[idx_p].astype(np.float64)
            w2c = np.eye(4, dtype=np.float64)
            w2c[:3, :4] = exts[idx_p, :3, :4]
            pose = np.linalg.inv(w2c)

            fx = max(float(K[0, 0]), 1e-6)
            fy = max(float(K[1, 1]), 1e-6)
            cx_k, cy_k = float(K[0, 2]), float(K[1, 2])
            x_cam = (uu - cx_k) * d_hw / fx
            y_cam = (vv - cy_k) * d_hw / fy
            pts_cam = np.stack([x_cam, y_cam, d_hw], axis=-1)
            pts_w = (pts_cam @ pose[:3, :3].T + pose[:3, 3]).astype(np.float32)

            c_hw = confs[idx_p]
            finite_c = c_hw[np.isfinite(c_hw)]
            c_thr = float(np.percentile(finite_c, 10)) if len(finite_c) > 100 else 0.0
            mask = np.isfinite(d_hw) & (d_hw > 0.15) & (d_hw < 16.0) & (c_hw >= c_thr)
            if skies is not None:
                mask &= (skies[idx_p] < 0.45)

            rgb_u8 = proc_imgs[idx_p]
            rgb_hd = hd_rgbs[idx_p] if idx_p < len(hd_rgbs) else rgb_u8
            views_data.append(
                {
                    "pts3d": pts_w,
                    "rgb": rgb_u8,
                    "rgb_hd": rgb_hd,
                    "mask": mask,
                    "depth_z": d_hw.astype(np.float32),
                    "K": K.astype(np.float32),
                    "pose": pose.astype(np.float32),
                }
            )

        difix_pipe = get_difix_pipe()
        if difix_pipe is not None and low_vram:
            difix_pipe.to("cuda")

        try:
            payload = build_room_payload(
                views_data,
                enable_gs=True,
                clean_arch_only=False,
                gs_init=gs_init,
                difix_pipe=difix_pipe,
            )
        finally:
            if difix_pipe is not None and low_vram:
                difix_pipe.to("cpu")
                torch.cuda.empty_cache()

        if payload.get("ok"):
            if _DIFIX_LOAD_ERR and not payload["stats"].get("difixError"):
                payload["stats"]["difixError"] = _DIFIX_LOAD_ERR[:180]
            payload["stats"].update(
                {
                    "views": len(images),
                    "inputMaxPx": int(max_inp_edge),
                    "da3Res": int(da3_res),
                    "inferSec": round(infer_s, 2),
                    "totalSec": round(time.time() - t_start, 2),
                    "model": f"{DA3_MODEL_ID} + Difix3D+ v11",
                    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
                }
            )
            print(
                f"[worker-v11] Tamamlandı: views={len(images)} inPx={max_inp_edge} da3Res={da3_res} infer={infer_s:.1f}s "
                f"splats={payload['stats'].get('splatCount', 0)} "
                f"difix={payload['stats'].get('difixViews', 0)}/{payload['stats'].get('difixSec', 0)}s "
                f"cov={payload.get('coverage', {}).get('score', '-')} "
                f"err={payload['stats'].get('difixError', '')} "
                f"total={payload['stats']['totalSec']}s",
                flush=True,
            )
        return payload
    except Exception as exc:
        traceback.print_exc()
        return {"ok": False, "error": f"3D mekân hesaplama hatası ({type(exc).__name__}): {exc}"}


if __name__ == "__main__":
    get_da3_model()
    get_difix_pipe()
    runpod.serverless.start({"handler": handler})
