"""
MekanAR (Odanda Gör) v9 — Gerçek Mekân 3B Tarayıcı
  - Depth-Anything-3 (DA3NESTED-GIANT-LARGE-1.1) beslemeli 3D Gaussian başlatma
  - Tam HD kareler üzerinde gsplat v1.5.3 (MCMCStrategy) fotometrik hizalama
  - NVIDIA Difix3D+ (nvidia/difix_ref) tek adımlık difüzyon ile 3B bulanıklık / bozulma temizliği
    ve temizlenmiş yeni açıların (orbit / paralaks / kuşbakışı) 3DGS'ye damıtılması (distillation)
"""

import math
import time

import numpy as np

SH_C0 = 0.28209479177387814


def _make_gaussian_window(window_size: int, sigma: float, device, dtype):
    import torch

    coords = torch.arange(window_size, device=device, dtype=dtype) - window_size // 2
    g = torch.exp(-(coords ** 2) / (2.0 * sigma * sigma))
    g = g / g.sum()
    w2d = (g[:, None] * g[None, :]).unsqueeze(0).unsqueeze(0)
    return w2d.expand(3, 1, window_size, window_size).contiguous()


def _ssim_loss_11(pred_bchw, gt_bchw, window):
    """Differentiable 11x11 Gaussian SSIM (pure PyTorch)."""
    import torch.nn.functional as F

    pad = window.shape[-1] // 2
    mu1 = F.conv2d(pred_bchw, window, padding=pad, groups=3)
    mu2 = F.conv2d(gt_bchw, window, padding=pad, groups=3)

    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = F.conv2d(pred_bchw * pred_bchw, window, padding=pad, groups=3) - mu1_sq
    sigma2_sq = F.conv2d(gt_bchw * gt_bchw, window, padding=pad, groups=3) - mu2_sq
    sigma12 = F.conv2d(pred_bchw * gt_bchw, window, padding=pad, groups=3) - mu1_mu2

    c1 = 0.01 ** 2
    c2 = 0.03 ** 2
    num = (2.0 * mu1_mu2 + c1) * (2.0 * sigma12 + c2)
    den = (mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2)
    return (num / (den + 1e-8)).mean()


def _estimate_initial_scales_gpu(pts_t, device):
    """Chunked GPU 3-NN mesafesinden sıkı başlangıç log-ölçeklerini hesaplar."""
    import torch

    n = pts_t.shape[0]
    if n < 16:
        return torch.full((n, 3), math.log(0.012), device=device, dtype=torch.float32)

    ref_n = min(n, 24_000)
    if ref_n < n:
        perm = torch.randperm(n, device=device)[:ref_n]
        ref = pts_t[perm]
        density_fix = math.pow(ref_n / float(n), 1.0 / 3.0)
    else:
        ref = pts_t
        density_fix = 1.0

    dists_out = torch.empty(n, device=device, dtype=torch.float32)
    chunk = 2048
    with torch.no_grad():
        for s in range(0, n, chunk):
            e = min(n, s + chunk)
            d = torch.cdist(pts_t[s:e], ref, p=2)
            vals, _ = torch.topk(d, k=min(4, ref_n), dim=1, largest=False)
            avg_d = vals[:, 1:4].mean(dim=1) if vals.shape[1] >= 4 else vals[:, -1]
            dists_out[s:e] = avg_d * density_fix

    scales = torch.clamp(dists_out * 0.56, min=0.0035, max=0.022)
    return torch.log(scales).unsqueeze(-1).repeat(1, 3)


def _se3_delta_matrix(rot_vec, trans_vec):
    """Mikro SE(3) poz ince ayarı (<= 0.9° dönüş, <= 1.8 cm öteleme — DA3 pozlarını bozmaz)."""
    import torch

    r = torch.tanh(rot_vec) * 0.016
    t = torch.tanh(trans_vec) * 0.018

    zero = torch.zeros_like(r[0])
    rx, ry, rz = r[0], r[1], r[2]
    K = torch.stack(
        [
            torch.stack([zero, -rz, ry]),
            torch.stack([rz, zero, -rx]),
            torch.stack([-ry, rx, zero]),
        ]
    )
    theta2 = (r * r).sum()
    theta = torch.sqrt(theta2 + 1e-12)
    sin_t = torch.sin(theta) / theta
    cos_t = (1.0 - torch.cos(theta)) / (theta2 + 1e-12)
    eye3 = torch.eye(3, device=r.device, dtype=r.dtype)
    R = eye3 + sin_t * K + cos_t * (K @ K)

    M = torch.eye(4, device=r.device, dtype=r.dtype)
    M[:3, :3] = R
    M[:3, 3] = t
    return M


def _look_at_w2c(eye: np.ndarray, target: np.ndarray, world_up=np.array([0.0, 1.0, 0.0])) -> np.ndarray:
    """OpenCV RDF (+X sağ, +Y aşağı, +Z ileri) world-to-camera 4x4 matrisi oluşturur."""
    fwd = target - eye
    fn = float(np.linalg.norm(fwd))
    if fn < 1e-6:
        fwd = np.array([0.0, 0.0, -1.0], dtype=np.float64)
    else:
        fwd = fwd / fn
    right = np.cross(fwd, world_up)
    rn = float(np.linalg.norm(right))
    if rn < 1e-4:
        right = np.cross(fwd, np.array([1.0, 0.0, 0.0], dtype=np.float64))
        rn = max(float(np.linalg.norm(right)), 1e-6)
    right = right / rn
    down = np.cross(fwd, right)
    down = down / max(float(np.linalg.norm(down)), 1e-6)

    R_c2w = np.stack([right, down, fwd], axis=1)  # OpenCV RDF columns
    R_w2c = R_c2w.T
    t_w2c = -R_w2c @ eye
    w2c = np.eye(4, dtype=np.float64)
    w2c[:3, :3] = R_w2c
    w2c[:3, 3] = t_w2c
    return w2c


def _build_difix_novel_poses(
    train_views: list[dict],
    half_w: float,
    half_d: float,
    ceil_cut: float,
    n_orbit: int = 10,
    n_lateral: int = 4,
    n_birdseye: int = 4,
) -> list[dict]:
    """
    Kullanıcının 3B dönme (orbit), yan açı (paralaks) ve kuşbakışı (top-down) görünümlerinde
    en çok bulanıklaşan stratejik yeni kamera pozlarını üretir ve her biri için en yakın
    gerçek HD referans kamera indeksini eşler.
    """
    n_train = len(train_views)
    if n_train == 0:
        return []

    cam_positions = np.stack([v["cam_pos"] for v in train_views], axis=0)
    cam_forwards = np.stack([v["forward"] for v in train_views], axis=0)
    cam_rights = np.stack([v["right"] for v in train_views], axis=0)

    def _nearest_ref_idx(eye: np.ndarray, fwd: np.ndarray) -> int:
        # En yakın bakış yönü + kamera mesafesi
        cos_sim = np.clip(cam_forwards @ fwd, -1.0, 1.0)
        angle_cost = 1.0 - cos_sim
        dist_cost = np.linalg.norm(cam_positions - eye[None, :], axis=1) * 0.28
        return int(np.argmin(angle_cost + dist_cost))

    # Sahne hedef derinliği: gerçek medyan derinliğin %75'i (~1.8-2.6 m)
    scene_center = np.array([0.0, max(0.55, min(1.05, ceil_cut * 0.36)), 0.0], dtype=np.float64)
    novel = []

    # 1. Yükseltilmiş ve hafif geri çekilmiş orbit açıları (3D Oda modu temizliği)
    orbit_indices = np.linspace(0, n_train - 1, min(n_orbit, n_train), dtype=int)
    for idx in orbit_indices:
        pos = cam_positions[idx]
        fwd = cam_forwards[idx]
        med_d = float(train_views[idx]["med_depth"])
        look_t = pos + fwd * np.clip(med_d * 0.85, 1.2, 3.2)
        look_t[1] = np.clip(look_t[1], 0.25, max(1.2, ceil_cut - 0.5))

        # Kamerayı biraz geriye ve yukarıya taşı (gerçek çekim merkezinden dışarı doğru)
        eye = pos - fwd * 0.36 + np.array([0.0, 0.38, 0.0], dtype=np.float64)
        eye[0] = np.clip(eye[0], -(half_w + 0.35), half_w + 0.35)
        eye[2] = np.clip(eye[2], -(half_d + 0.35), half_d + 0.35)
        eye[1] = np.clip(eye[1], 0.85, max(1.85, ceil_cut - 0.10))

        w2c = _look_at_w2c(eye, look_t)
        new_fwd = look_t - eye
        new_fwd = new_fwd / max(float(np.linalg.norm(new_fwd)), 1e-6)
        novel.append(
            {
                "w2c": w2c,
                "ref_idx": _nearest_ref_idx(eye, new_fwd),
                "kind": "orbit",
            }
        )

    # 2. Yanal paralaks açıları (sandalye / masa / raf kenarlarını keskinleştirir)
    lat_indices = np.linspace(0, n_train - 1, min(n_lateral, n_train), dtype=int)
    for k, idx in enumerate(lat_indices):
        pos = cam_positions[idx]
        fwd = cam_forwards[idx]
        right = cam_rights[idx]
        med_d = float(train_views[idx]["med_depth"])
        look_t = pos + fwd * np.clip(med_d * 0.82, 1.2, 3.0)
        sign = 1.0 if (k % 2 == 0) else -1.0
        eye = pos + right * (0.30 * sign) + np.array([0.0, 0.14, 0.0], dtype=np.float64)
        eye[0] = np.clip(eye[0], -(half_w + 0.25), half_w + 0.25)
        eye[2] = np.clip(eye[2], -(half_d + 0.25), half_d + 0.25)
        eye[1] = np.clip(eye[1], 0.70, max(1.80, ceil_cut - 0.12))

        w2c = _look_at_w2c(eye, look_t)
        new_fwd = look_t - eye
        new_fwd = new_fwd / max(float(np.linalg.norm(new_fwd)), 1e-6)
        novel.append(
            {
                "w2c": w2c,
                "ref_idx": _nearest_ref_idx(eye, new_fwd),
                "kind": "lateral",
            }
        )

    # 3. Yüksek kuşbakışı açılar (4 köşeden hafif yukarıdan içe bakış)
    bird_angles = np.linspace(0.0, 2.0 * np.pi, n_birdseye, endpoint=False) + np.pi * 0.25
    rad_x = min(half_w * 0.72, 1.8)
    rad_z = min(half_d * 0.72, 1.8)
    bird_y = min(max(ceil_cut - 0.18, 1.95), 2.85)
    for ang in bird_angles:
        eye = np.array([math.cos(ang) * rad_x, bird_y, math.sin(ang) * rad_z], dtype=np.float64)
        look_t = np.array([0.0, 0.35, 0.0], dtype=np.float64)
        w2c = _look_at_w2c(eye, look_t)
        new_fwd = look_t - eye
        new_fwd = new_fwd / max(float(np.linalg.norm(new_fwd)), 1e-6)
        novel.append(
            {
                "w2c": w2c,
                "ref_idx": _nearest_ref_idx(eye, new_fwd),
                "kind": "birdseye",
            }
        )

    return novel


def _round64(v: int) -> int:
    return max(256, int(round(v / 64.0)) * 64)


def _run_difix_cleanup(
    difix_pipe,
    params: dict,
    novel_specs: list[dict],
    train_views: list[dict],
    device,
    max_side: int = 576,
):
    """
    NVIDIA Difix3D+ (nvidia/difix_ref) ile novel açıları tek adımda (~0.25 sn/açı) temizler.
    Temizlenmiş görüntü + geçerli alfa maskelerini gsplat damıtma listesi olarak döndürür.
    """
    import torch
    import torch.nn.functional as F
    from gsplat import rasterization
    from PIL import Image

    if difix_pipe is None or not novel_specs:
        return [], 0.0

    t0 = time.time()
    # Difix render çözünürlüğünü eğitim karesinin en-boy oranına göre 64'ün katına hizala (UNet + VAE uyumu)
    ref0 = train_views[0]
    W0, H0 = ref0["W"], ref0["H"]
    scale_r = min(1.0, float(max_side) / float(max(W0, H0)))
    W_dfx = _round64(int(W0 * scale_r))
    H_dfx = _round64(int(H0 * scale_r))

    with torch.no_grad():
        scales_exp = torch.exp(params["scales"])
        opas_sig = torch.sigmoid(params["opacities"])
        quats_n = F.normalize(params["quats"], p=2, dim=-1)

    cleaned_views = []
    for spec in novel_specs:
        ref_v = train_views[spec["ref_idx"]]
        K_ref = ref_v["K_np"]
        K_dfx = K_ref.copy()
        K_dfx[0, :] *= float(W_dfx) / float(ref_v["W"])
        K_dfx[1, :] *= float(H_dfx) / float(ref_v["H"])

        w2c_t = torch.from_numpy(spec["w2c"].astype(np.float32)).to(device).unsqueeze(0)
        K_t = torch.from_numpy(K_dfx.astype(np.float32)).to(device).unsqueeze(0)

        with torch.no_grad():
            renders, alphas, _ = rasterization(
                means=params["means"],
                quats=quats_n,
                scales=scales_exp,
                opacities=opas_sig,
                colors=params["sh0"],
                viewmats=w2c_t,
                Ks=K_t,
                width=W_dfx,
                height=H_dfx,
                near_plane=0.12,
                far_plane=25.0,
                sh_degree=0,
                packed=True,
                render_mode="RGB",
                rasterize_mode="antialiased",
            )
            alpha_hw = alphas[0, ..., 0]
            cov = float((alpha_hw > 0.35).float().mean().item())
            if cov < 0.25:
                continue

            # Boş pikselleri nötr arka planla doldur (Difix kenarlarda siyah leke üretmesin)
            rgb_hw3 = renders[0, ..., :3] + (1.0 - alphas[0]) * 0.5
            rgb_u8 = (rgb_hw3.clamp(0.0, 1.0) * 255.0).to(torch.uint8).cpu().numpy()

        render_pil = Image.fromarray(rgb_u8, mode="RGB")
        ref_pil = Image.fromarray(ref_v["rgb_u8"], mode="RGB").resize((W_dfx, H_dfx), Image.Resampling.BILINEAR)

        with torch.no_grad():
            out_pil = difix_pipe(
                prompt="remove degradation",
                image=render_pil,
                ref_image=ref_pil,
                height=H_dfx,
                width=W_dfx,
                num_inference_steps=1,
                timesteps=[199],
                guidance_scale=0.0,
            ).images[0]

        if out_pil.size != (W_dfx, H_dfx):
            out_pil = out_pil.resize((W_dfx, H_dfx), Image.Resampling.BILINEAR)

        clean_np = np.asarray(out_pil.convert("RGB"), dtype=np.float32) / 255.0
        clean_t = torch.from_numpy(clean_np).to(device)
        clean_bchw = clean_t.permute(2, 0, 1).unsqueeze(0).contiguous()
        valid_mask = (alpha_hw > 0.35).detach()

        cleaned_views.append(
            {
                "w2c": w2c_t,
                "K": K_t,
                "W": W_dfx,
                "H": H_dfx,
                "rgb": clean_t,
                "rgb_bchw": clean_bchw,
                "valid_mask": valid_mask,
            }
        )

    difix_sec = round(time.time() - t0, 2)
    print(f"[difix3d+] {len(cleaned_views)}/{len(novel_specs)} yeni açı temizlendi ({W_dfx}x{H_dfx}, {difix_sec} sn)", flush=True)
    return cleaned_views, difix_sec


def train_room_splats(
    P_init: np.ndarray,
    C_init: np.ndarray,
    views_cam: list[dict],
    half_w: float,
    half_d: float,
    ceil_cut: float,
    n_real_pts: int | None = None,
    gs_init: dict | None = None,
    difix_pipe=None,
    max_splats: int = 210_000,
    phase1_steps: int = 1350,
    phase2_steps: int = 1150,
):
    """
    v9 Gerçek Mekân 3D Gaussian Splatting + NVIDIA Difix3D+ Boru Hattı:
      1) DA3NESTED-GIANT-LARGE-1.1 beslemeli 3D Gaussian (veya nokta bulutu) başlatma
      2) Tam HD gerçek kamera kareleriyle gsplat v1.5.3 fotometrik eğitim (Faz 1)
      3) NVIDIA Difix3D+ (nvidia/difix_ref) ile 18 yeni orbit/paralaks/kuşbakışı açısının
         tek adımda bulanıklık/bozulma temizliği
      4) Temizlenmiş açılar + gerçek HD karelerin birleşik gsplat damıtma eğitimi (Faz 2)
    """
    import torch
    import torch.nn.functional as F
    from gsplat import MCMCStrategy, rasterization
    from PIL import Image

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU bulunamadı")

    t0 = time.time()
    device = torch.device("cuda")
    total_steps = phase1_steps + (phase2_steps if difix_pipe is not None else 950)
    refine_stop = int(total_steps * 0.84)

    # 1) Başlangıç Gaussian parametreleri: DA3 feed-forward 3DGS varsa öncelikle onu kullan!
    init_from_da3 = False
    if gs_init is not None and len(gs_init.get("positions", [])) >= 1500:
        gp = np.asarray(gs_init["positions"], dtype=np.float32)
        gs_sc = np.asarray(gs_init["scales"], dtype=np.float32)
        gq = np.asarray(gs_init["quats_wxyz"], dtype=np.float32)
        gsh = np.asarray(gs_init["sh_dc"], dtype=np.float32)
        ga = np.asarray(gs_init["opacities"], dtype=np.float32)

        valid_g = (
            np.isfinite(gp).all(axis=1)
            & np.isfinite(gs_sc).all(axis=1)
            & np.isfinite(gq).all(axis=1)
            & np.isfinite(gsh).all(axis=1)
            & np.isfinite(ga)
            & (ga >= 0.03)
            & (gs_sc.min(axis=1) > 1e-4)
            & (gs_sc.max(axis=1) <= 0.14)
            & (np.abs(gp[:, 0]) <= half_w + 0.65)
            & (np.abs(gp[:, 2]) <= half_d + 0.65)
            & (gp[:, 1] >= -0.15)
            & (gp[:, 1] <= ceil_cut + 0.45)
        )
        gp, gs_sc, gq, gsh, ga = gp[valid_g], gs_sc[valid_g], gq[valid_g], gsh[valid_g], ga[valid_g]

        if len(gp) >= 1500:
            max_init = 135_000
            if len(gp) > max_init:
                rng_g = np.random.default_rng(42)
                # Yüksek opaklıklı %50 + mekansal kapsama için rastgele %50
                top_k = max_init // 2
                top_idx = np.argpartition(ga, -top_k)[-top_k:]
                rem_mask = np.ones(len(gp), dtype=bool)
                rem_mask[top_idx] = False
                rem_idx = np.nonzero(rem_mask)[0]
                rand_idx = rng_g.choice(rem_idx, size=min(max_init - top_k, len(rem_idx)), replace=False)
                sel = np.concatenate([top_idx, rand_idx])
                gp, gs_sc, gq, gsh, ga = gp[sel], gs_sc[sel], gq[sel], gsh[sel], ga[sel]

            pts_t = torch.from_numpy(gp).to(device)
            log_scales_t = torch.log(torch.from_numpy(np.clip(gs_sc, 0.0025, 0.055)).to(device))
            quats_t = F.normalize(torch.from_numpy(gq).to(device), p=2, dim=-1)
            opa_clip = np.clip(ga, 0.04, 0.96)
            opas_t = torch.from_numpy(np.log(opa_clip / (1.0 - opa_clip)).astype(np.float32)).to(device)
            sh0_t = torch.from_numpy(gsh.astype(np.float32)).to(device).unsqueeze(1)  # (N, 1, 3)
            init_from_da3 = True
            print(f"[gsplat-v9] DA3 neural 3DGS başlatıldı: {len(gp)} splat", flush=True)

    if not init_from_da3:
        if n_real_pts is not None and 500 <= n_real_pts <= len(P_init):
            P_src = P_init[:n_real_pts]
            C_src = C_init[:n_real_pts]
        else:
            P_src = P_init
            C_src = C_init

        n_pts = len(P_src)
        max_init = 125_000
        if n_pts > max_init:
            sel = np.random.default_rng(42).choice(n_pts, max_init, replace=False)
            P_src = P_src[sel]
            C_src = C_src[sel]

        pts_t = torch.from_numpy(P_src.astype(np.float32)).to(device)
        rgb_t = torch.from_numpy(C_src.astype(np.float32) / 255.0).to(device)
        sh0_t = ((rgb_t - 0.5) / SH_C0).unsqueeze(1)
        log_scales_t = _estimate_initial_scales_gpu(pts_t, device)
        quats_t = torch.zeros((len(P_src), 4), device=device, dtype=torch.float32)
        quats_t[:, 0] = 1.0
        opas_t = torch.full((len(P_src),), math.log(0.45 / 0.55), device=device, dtype=torch.float32)
        print(f"[gsplat-v9] Nokta bulutu başlatma: {len(P_src)} nokta", flush=True)

    # 2) Eğitim görüntülerini tam HD olarak GPU'ya hazırla (<= 800px)
    train_views = []
    max_train_side = 800
    for vc in views_cam:
        rgb_src = vc.get("rgb_hd")
        if rgb_src is None:
            rgb_src = vc["rgb"]
        rgb_src = np.asarray(rgb_src, dtype=np.uint8)
        H_hd, W_hd = rgb_src.shape[:2]
        if max(W_hd, H_hd) > max_train_side:
            s_dn = float(max_train_side) / float(max(W_hd, H_hd))
            W_new = max(64, int(round(W_hd * s_dn)))
            H_new = max(64, int(round(H_hd * s_dn)))
            rgb_src = np.asarray(
                Image.fromarray(rgb_src, mode="RGB").resize((W_new, H_new), Image.Resampling.LANCZOS),
                dtype=np.uint8,
            )
            H_hd, W_hd = H_new, W_new

        H_d, W_d = vc["depth_m"].shape[:2]
        K_raw = np.asarray(vc["K"], dtype=np.float64)
        K_hd = K_raw.copy()
        K_hd[0, :] *= float(W_hd) / float(W_d)
        K_hd[1, :] *= float(H_hd) / float(H_d)

        R_c2w = np.asarray(vc["R_rdf2room"], dtype=np.float64)
        cam_pos = np.asarray(vc["cam_pos"], dtype=np.float64)
        R_w2c = R_c2w.T
        t_w2c = -R_w2c @ cam_pos
        w2c = np.eye(4, dtype=np.float64)
        w2c[:3, :3] = R_w2c
        w2c[:3, 3] = t_w2c

        gt_rgb = torch.from_numpy(rgb_src.astype(np.float32) / 255.0).to(device)
        gt_bchw = gt_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()

        d_t = torch.from_numpy(vc["depth_m"].astype(np.float32)).to(device)[None, None]
        m_t = torch.from_numpy(vc["mask"].astype(np.float32)).to(device)[None, None]
        d_hd = F.interpolate(d_t, size=(H_hd, W_hd), mode="bilinear", align_corners=False)[0, 0]
        m_hd = (F.interpolate(m_t, size=(H_hd, W_hd), mode="nearest")[0, 0] > 0.5) & (d_hd > 0.15) & (d_hd < 15.0)

        valid_d_np = vc["depth_m"][vc["mask"] & np.isfinite(vc["depth_m"]) & (vc["depth_m"] > 0.2)]
        med_depth = float(np.median(valid_d_np)) if len(valid_d_np) > 50 else 2.2

        train_views.append(
            {
                "w2c": torch.from_numpy(w2c.astype(np.float32)).to(device).unsqueeze(0),
                "K": torch.from_numpy(K_hd.astype(np.float32)).to(device).unsqueeze(0),
                "K_np": K_hd,
                "W": W_hd,
                "H": H_hd,
                "rgb": gt_rgb,
                "rgb_bchw": gt_bchw,
                "rgb_u8": rgb_src,
                "depth": d_hd,
                "mask": m_hd,
                "cam_pos": cam_pos,
                "forward": R_c2w[:, 2] / max(float(np.linalg.norm(R_c2w[:, 2])), 1e-6),
                "right": R_c2w[:, 0] / max(float(np.linalg.norm(R_c2w[:, 0])), 1e-6),
                "med_depth": med_depth,
            }
        )

    n_views = len(train_views)
    if n_views < 2:
        raise RuntimeError("3DGS için en az 2 kamera açısı gerekli")

    scene_scale = max(1.5, float(max(half_w, half_d) * 2.0))
    MIN_LOG_SCALE = math.log(0.0018)
    MAX_LOG_SCALE = math.log(0.062)

    params = {
        "means": torch.nn.Parameter(pts_t),
        "scales": torch.nn.Parameter(log_scales_t.clamp(MIN_LOG_SCALE, MAX_LOG_SCALE)),
        "quats": torch.nn.Parameter(quats_t),
        "opacities": torch.nn.Parameter(opas_t),
        "sh0": torch.nn.Parameter(sh0_t),
    }

    lr_means_start = 1.1e-4 * scene_scale
    lr_means_end = 1.2e-6 * scene_scale
    gamma_means = (lr_means_end / lr_means_start) ** (1.0 / max(1, total_steps))

    optimizers = {
        "means": torch.optim.Adam([params["means"]], lr=lr_means_start, eps=1e-15),
        "scales": torch.optim.Adam([params["scales"]], lr=4.0e-3, eps=1e-15),
        "quats": torch.optim.Adam([params["quats"]], lr=1.0e-3, eps=1e-15),
        "opacities": torch.optim.Adam([params["opacities"]], lr=3.5e-2, eps=1e-15),
        "sh0": torch.optim.Adam([params["sh0"]], lr=2.5e-3, eps=1e-15),
    }

    pose_rot = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_trans = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_lr_start = 3.5e-4
    pose_lr_end = 4.0e-5
    pose_opt = torch.optim.Adam([pose_rot, pose_trans], lr=pose_lr_start, eps=1e-15)

    cap_max = max(max_splats + 25_000, 225_000)
    strategy = MCMCStrategy(
        cap_max=cap_max,
        noise_lr=1.8e5,
        refine_start_iter=200,
        refine_stop_iter=refine_stop,
        refine_every=100,
        min_opacity=0.012,
        verbose=False,
    )
    strategy_state = strategy.initialize_state()
    ssim_window = _make_gaussian_window(11, 1.5, device, torch.float32)

    rng = np.random.default_rng(19)
    order = np.arange(n_views)
    rng.shuffle(order)
    order_pos = 0

    cur_means_lr = lr_means_start
    cur_pose_lr = pose_lr_start
    pose_start = 150
    pose_stop = min(phase1_steps - 150, 1150)
    gamma_pose = (pose_lr_end / pose_lr_start) ** (1.0 / max(1, pose_stop - pose_start))

    difix_views = []
    difix_sec = 0.0
    difix_pos = 0

    for step in range(total_steps):
        # Faz 1 -> Faz 2 geçişinde NVIDIA Difix3D+ yeni açı temizliğini çalıştır
        if step == phase1_steps and difix_pipe is not None:
            try:
                novel_specs = _build_difix_novel_poses(
                    train_views, half_w=half_w, half_d=half_d, ceil_cut=ceil_cut,
                    n_orbit=10, n_lateral=4, n_birdseye=4,
                )
                difix_views, difix_sec = _run_difix_cleanup(
                    difix_pipe, params, novel_specs, train_views, device, max_side=576
                )
            except Exception as exc:
                print(f"[difix3d+] Hata (saf HD eğitime devam): {type(exc).__name__}: {exc}", flush=True)
                difix_views = []

        use_difix = False
        if difix_views and step >= phase1_steps:
            # Son 250 adımda %75 gerçek HD + %25 Difix; öncesinde %65 gerçek HD + %35 Difix
            p_dfx = 0.25 if step >= total_steps - 250 else 0.35
            use_difix = bool(rng.random() < p_dfx)

        scales_exp = torch.exp(params["scales"])
        opas_sig = torch.sigmoid(params["opacities"])

        if use_difix:
            dv = difix_views[difix_pos % len(difix_views)]
            difix_pos += 1
            renders, alphas, info = rasterization(
                means=params["means"],
                quats=params["quats"],
                scales=scales_exp,
                opacities=opas_sig,
                colors=params["sh0"],
                viewmats=dv["w2c"],
                Ks=dv["K"],
                width=dv["W"],
                height=dv["H"],
                near_plane=0.12,
                far_plane=25.0,
                sh_degree=0,
                packed=True,
                render_mode="RGB",
                rasterize_mode="antialiased",
            )
            pred_rgb = renders[0, ..., :3] + (1.0 - alphas[0]) * 0.5
            vm = dv["valid_mask"]
            if vm.any():
                l1 = torch.abs(pred_rgb[vm] - dv["rgb"][vm]).mean()
            else:
                l1 = torch.abs(pred_rgb - dv["rgb"]).mean()
            # Maskelenmiş SSIM: yalnızca gözlenen yüzey piksellerini karşılaştır
            vm3 = vm.unsqueeze(-1).float()
            pred_m = (pred_rgb * vm3 + dv["rgb"] * (1.0 - vm3)).permute(2, 0, 1).unsqueeze(0).contiguous()
            ssim_val = _ssim_loss_11(pred_m, dv["rgb_bchw"], ssim_window)
            loss = 0.72 * (0.75 * l1 + 0.25 * (1.0 - ssim_val))
            opt_pose_now = False
        else:
            if order_pos >= n_views:
                rng.shuffle(order)
                order_pos = 0
            v_idx = int(order[order_pos])
            order_pos += 1
            v = train_views[v_idx]

            opt_pose_now = (pose_start <= step < pose_stop)
            if step >= pose_start:
                delta = _se3_delta_matrix(pose_rot[v_idx], pose_trans[v_idx])
                if not opt_pose_now:
                    delta = delta.detach()
                w2c_cur = (delta @ v["w2c"][0]).unsqueeze(0)
            else:
                w2c_cur = v["w2c"]

            renders, alphas, info = rasterization(
                means=params["means"],
                quats=params["quats"],
                scales=scales_exp,
                opacities=opas_sig,
                colors=params["sh0"],
                viewmats=w2c_cur,
                Ks=v["K"],
                width=v["W"],
                height=v["H"],
                near_plane=0.12,
                far_plane=25.0,
                sh_degree=0,
                packed=True,
                render_mode="RGB+ED",
                rasterize_mode="antialiased",
            )
            bg = torch.rand(3, device=device, dtype=torch.float32)
            pred_rgb = renders[0, ..., :3] + (1.0 - alphas[0]) * bg
            pred_depth = renders[0, ..., 3]

            l1 = torch.abs(pred_rgb - v["rgb"]).mean()
            pred_bchw = pred_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()
            ssim_val = _ssim_loss_11(pred_bchw, v["rgb_bchw"], ssim_window)
            loss = 0.80 * l1 + 0.20 * (1.0 - ssim_val)

            # Nazik metrik derinlik çapası (DA3 derinliği zaten çok keskin, geometriyi kilitler)
            valid_d = v["mask"] & (alphas[0, ..., 0] > 0.45)
            if valid_d.any():
                d_w = 0.045 if step < 600 else (0.025 if step < refine_stop else 0.012)
                loss = loss + d_w * F.smooth_l1_loss(pred_depth[valid_d], v["depth"][valid_d], beta=0.06)

        # Hafif anti-iğne düzenleyicisi (keskinliği ezmeden diken patlamasını engeller)
        s_sorted, _ = torch.sort(scales_exp, dim=-1)
        needle_pen = F.relu(s_sorted[:, 2] / (s_sorted[:, 1] + 1e-4) - 2.6).mean()
        flat_pen = F.relu(s_sorted[:, 0] - 0.020).mean()
        reg_mul = 1.0 if step < refine_stop else 0.40
        loss = loss + reg_mul * (
            0.0025 * opas_sig.mean()
            + 0.009 * scales_exp.mean()
            + 0.040 * needle_pen
            + 0.020 * flat_pen
        )

        loss.backward()

        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)

        with torch.no_grad():
            params["scales"].clamp_(MIN_LOG_SCALE, MAX_LOG_SCALE)
            params["opacities"].clamp_(-8.0, 8.0)

        if opt_pose_now:
            pose_opt.step()
            pose_opt.zero_grad(set_to_none=True)
            cur_pose_lr *= gamma_pose
            pose_opt.param_groups[0]["lr"] = cur_pose_lr

        if step < refine_stop:
            strategy.step_post_backward(
                params=params,
                optimizers=optimizers,
                state=strategy_state,
                step=step,
                info=info,
                lr=cur_means_lr,
            )

        cur_means_lr *= gamma_means
        optimizers["means"].param_groups[0]["lr"] = cur_means_lr

    # 3) Son temizlik ve yüksek yoğunluklu aktarım
    with torch.no_grad():
        means_np = params["means"].detach().float().cpu().numpy()
        log_scales_np = params["scales"].detach().float().clamp(MIN_LOG_SCALE, MAX_LOG_SCALE).cpu().numpy()
        quats_np = F.normalize(params["quats"].detach().float(), p=2, dim=-1).cpu().numpy()
        alphas_np = torch.sigmoid(params["opacities"].detach().float()).cpu().numpy()
        sh0_np = params["sh0"].detach().float().squeeze(1).cpu().numpy()
        rgb_np = np.clip(sh0_np * SH_C0 + 0.5, 0.0, 1.0)

    sc_np = np.exp(log_scales_np)
    sc_sorted = np.sort(sc_np, axis=1)
    needle_ratio = sc_sorted[:, 2] / np.maximum(sc_sorted[:, 1], 1e-4)

    keep = (
        np.isfinite(means_np).all(axis=1)
        & np.isfinite(log_scales_np).all(axis=1)
        & np.isfinite(quats_np).all(axis=1)
        & np.isfinite(alphas_np)
        & (alphas_np >= 0.06)
        & (sc_sorted[:, 2] <= 0.068)
        & (needle_ratio <= 4.5)
        & (np.abs(means_np[:, 0]) <= half_w + 0.45)
        & (np.abs(means_np[:, 2]) <= half_d + 0.45)
        & (means_np[:, 1] >= -0.08)
        & (means_np[:, 1] <= ceil_cut + 0.25)
    )

    means_np = means_np[keep]
    log_scales_np = log_scales_np[keep]
    quats_np = quats_np[keep]
    alphas_np = alphas_np[keep]
    rgb_np = rgb_np[keep]

    if len(means_np) < 500:
        raise RuntimeError("Temizlik sonrası yeterli 3D Gaussian kalmadı")

    if len(means_np) > max_splats:
        score = alphas_np * np.power(np.maximum(1e-9, np.exp(log_scales_np).prod(axis=1)), 0.12)
        top_idx = np.argpartition(score, -max_splats)[-max_splats:]
        means_np = means_np[top_idx]
        log_scales_np = log_scales_np[top_idx]
        quats_np = quats_np[top_idx]
        alphas_np = alphas_np[top_idx]
        rgb_np = rgb_np[top_idx]

    gs_sec = round(time.time() - t0, 2)
    print(
        f"[gsplat-v9] {len(means_np)} splat (DA3-init={init_from_da3}, "
        f"difix={len(difix_views)} açı/{difix_sec}s, {total_steps} adım, {n_views} HD kare, {gs_sec} sn)",
        flush=True,
    )

    return {
        "positions": means_np,
        "log_scales": log_scales_np,
        "quats_wxyz": quats_np,
        "alphas": alphas_np,
        "rgb": rgb_np,
        "gs_sec": gs_sec,
        "difix_sec": difix_sec,
        "difix_views": len(difix_views),
        "da3_init": init_from_da3,
    }
