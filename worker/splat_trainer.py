"""
Odanda Gör — Anti-Needle / Sıfır-Leke 3D Gaussian Splatting (gsplat v1.5.3 + MCMCStrategy)
v7:
  - Sentetik zemin noktaları 3DGS eğitimine karıştırılmaz (halı ortasındaki gri sis lekesi tamamen biter)
  - 2DGS / SuGaR anti-iğne cezası (s_max / s_mid <= 2.2): duvar/masa/halı yassı ve keskin kalır,
    dış açılarda patlayan sivri diken/çizgi (needle/spike) bozulmaları yok olur
  - Sıkı Gaussian boyut sınırı (<= 6.5 cm) + tüm adımlar boyunca aktif metrik derinlik kilidi
  - İnce SE(3) kamera hizalaması (±1.5°, ±2.5 cm) ile derinlik bozulmadan piksel keskinliği
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
    """Differentiable 11x11 Gaussian SSIM (pure PyTorch, 0 harici bağımlılık)."""
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

    scales = torch.clamp(dists_out * 0.58, min=0.004, max=0.022)
    return torch.log(scales).unsqueeze(-1).repeat(1, 3)


def _se3_delta_matrix(rot_vec, trans_vec):
    """İnce SE(3) hizalama düzeltmesi (<= 1.5° dönüş, <= 2.5 cm öteleme — geometriyi bozmaz)."""
    import torch

    r = torch.tanh(rot_vec) * 0.026
    t = torch.tanh(trans_vec) * 0.025

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


def train_room_splats(
    P_init: np.ndarray,
    C_init: np.ndarray,
    views_cam: list[dict],
    half_w: float,
    half_d: float,
    ceil_cut: float,
    n_real_pts: int | None = None,
    max_splats: int = 155_000,
    num_steps: int = 2600,
):
    """
    Sadece gerçek gözlemlenmiş MapAnything 3D noktaları + tam HD karelerden
    diken/iğne patlamasız, derinlik kilitli 3D Gaussian Splatting eğitir.
    """
    import torch
    import torch.nn.functional as F
    from gsplat import MCMCStrategy, rasterization

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU bulunamadı")

    t0 = time.time()
    device = torch.device("cuda")

    # Sadece gerçek gözlenen 3D noktaları kullan (sentetik zemin noktaları halı üstünde gri leke yapmaz!)
    if n_real_pts is not None and 500 <= n_real_pts <= len(P_init):
        P_src = P_init[:n_real_pts]
        C_src = C_init[:n_real_pts]
    else:
        P_src = P_init
        C_src = C_init

    pad_xz = 0.30
    in_box = (
        np.isfinite(P_src).all(axis=1)
        & (np.abs(P_src[:, 0]) <= half_w + pad_xz)
        & (np.abs(P_src[:, 2]) <= half_d + pad_xz)
        & (P_src[:, 1] >= -0.06)
        & (P_src[:, 1] <= ceil_cut + 0.04)
    )
    P_use = P_src[in_box]
    C_use = C_src[in_box]
    if len(P_use) < 500:
        raise RuntimeError("3DGS başlatmak için yeterli gerçek nokta yok")

    init_cap = min(95_000, max_splats - 25_000)
    if len(P_use) > init_cap:
        rng = np.random.default_rng(42)
        sel = rng.choice(len(P_use), init_cap, replace=False)
        P_use = P_use[sel]
        C_use = C_use[sel]

    n_init = len(P_use)
    pts_t = torch.from_numpy(P_use.astype(np.float32)).to(device)
    rgb_t = torch.from_numpy(C_use.astype(np.float32) / 255.0).to(device).clamp(0.01, 0.99)
    sh0_init = ((rgb_t - 0.5) / SH_C0).unsqueeze(1)  # (N, 1, 3)

    log_scales_init = _estimate_initial_scales_gpu(pts_t, device)
    quats_init = torch.zeros((n_init, 4), device=device, dtype=torch.float32)
    quats_init[:, 0] = 1.0  # [w, x, y, z]
    opa_init = torch.full((n_init,), -0.10, device=device, dtype=torch.float32)

    params = torch.nn.ParameterDict(
        {
            "means": torch.nn.Parameter(pts_t),
            "scales": torch.nn.Parameter(log_scales_init),
            "quats": torch.nn.Parameter(quats_init),
            "opacities": torch.nn.Parameter(opa_init),
            "sh0": torch.nn.Parameter(sh0_init),
        }
    )

    scene_scale = max(1.5, float(max(half_w * 2.0, half_d * 2.0)))
    means_lr_init = 1.1e-4 * scene_scale
    means_lr_final = 8.0e-6 * scene_scale

    optimizers = {
        "means": torch.optim.Adam([{"params": params["means"], "lr": means_lr_init, "name": "means"}], eps=1e-15),
        "scales": torch.optim.Adam([{"params": params["scales"], "lr": 4.5e-3, "name": "scales"}], eps=1e-15),
        "quats": torch.optim.Adam([{"params": params["quats"], "lr": 1.0e-3, "name": "quats"}], eps=1e-15),
        "opacities": torch.optim.Adam([{"params": params["opacities"], "lr": 4.5e-2, "name": "opacities"}], eps=1e-15),
        "sh0": torch.optim.Adam([{"params": params["sh0"], "lr": 3.2e-3, "name": "sh0"}], eps=1e-15),
    }

    # Tam HD (rgb_hd) + 0.5x hızlı kaba tensörleri GPU'ya yükle
    train_views = []
    hd_res_sample = (0, 0)
    for vc in views_cam:
        R_rdf = vc["R_rdf2room"]
        w2c_r = R_rdf.T
        w2c_t = -w2c_r @ vc["cam_pos"]
        w2c = np.eye(4, dtype=np.float32)
        w2c[:3, :3] = w2c_r.astype(np.float32)
        w2c[:3, 3] = w2c_t.astype(np.float32)

        K_ma = np.asarray(vc["K"], dtype=np.float32)
        rgb_ma = np.asarray(vc["rgb"], dtype=np.uint8)
        H_ma, W_ma = rgb_ma.shape[:2]

        rgb_hd_u8 = np.asarray(vc.get("rgb_hd", rgb_ma), dtype=np.uint8)
        H_hd, W_hd = rgb_hd_u8.shape[:2]
        max_side = max(H_hd, W_hd)
        if max_side > 960:
            ratio = 960.0 / float(max_side)
            H_t, W_t = max(64, int(round(H_hd * ratio))), max(64, int(round(W_hd * ratio)))
            gt_bchw = F.interpolate(
                torch.from_numpy(rgb_hd_u8.astype(np.float32) / 255.0).to(device).permute(2, 0, 1).unsqueeze(0),
                size=(H_t, W_t),
                mode="bilinear",
                align_corners=False,
            ).contiguous()
            gt_rgb = gt_bchw[0].permute(1, 2, 0).contiguous()
            H_hd, W_hd = H_t, W_t
        else:
            gt_rgb = torch.from_numpy(rgb_hd_u8.astype(np.float32) / 255.0).to(device)
            gt_bchw = gt_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()

        hd_res_sample = (W_hd, H_hd)

        sx = float(W_hd) / max(1.0, float(W_ma))
        sy = float(H_hd) / max(1.0, float(H_ma))
        K_hd = K_ma.copy()
        K_hd[0, 0] *= sx
        K_hd[0, 2] *= sx
        K_hd[1, 1] *= sy
        K_hd[1, 2] *= sy

        d_ma_t = torch.from_numpy(np.asarray(vc["depth_m"], dtype=np.float32)).to(device)[None, None]
        m_ma_t = torch.from_numpy(np.asarray(vc["mask"], dtype=np.float32)).to(device)[None, None]
        if (H_hd, W_hd) != (H_ma, W_ma):
            gt_depth = F.interpolate(d_ma_t, size=(H_hd, W_hd), mode="bilinear", align_corners=False)[0, 0]
            gt_mask = (F.interpolate(m_ma_t, size=(H_hd, W_hd), mode="nearest")[0, 0] > 0.5)
        else:
            gt_depth = d_ma_t[0, 0]
            gt_mask = m_ma_t[0, 0] > 0.5
        gt_mask = gt_mask & (gt_depth > 0.22) & (gt_depth < 8.5)

        H_lo, W_lo = max(64, H_hd // 2), max(64, W_hd // 2)
        gt_bchw_lo = F.interpolate(gt_bchw, size=(H_lo, W_lo), mode="area").contiguous()
        gt_rgb_lo = gt_bchw_lo[0].permute(1, 2, 0).contiguous()
        gt_depth_lo = F.interpolate(gt_depth[None, None], size=(H_lo, W_lo), mode="bilinear", align_corners=False)[0, 0]
        gt_mask_lo = (F.interpolate(gt_mask.float()[None, None], size=(H_lo, W_lo), mode="nearest")[0, 0] > 0.5) & (
            gt_depth_lo > 0.22
        )
        K_lo = K_hd.copy()
        K_lo[0, 0] *= float(W_lo) / float(W_hd)
        K_lo[0, 2] *= float(W_lo) / float(W_hd)
        K_lo[1, 1] *= float(H_lo) / float(H_hd)
        K_lo[1, 2] *= float(H_lo) / float(H_hd)

        train_views.append(
            {
                "w2c": torch.from_numpy(w2c).to(device),
                "K_hd": torch.from_numpy(K_hd).to(device).unsqueeze(0),
                "gt_rgb_hd": gt_rgb,
                "gt_bchw_hd": gt_bchw,
                "gt_depth_hd": gt_depth,
                "gt_mask_hd": gt_mask,
                "H_hd": H_hd,
                "W_hd": W_hd,
                "K_lo": torch.from_numpy(K_lo).to(device).unsqueeze(0),
                "gt_rgb_lo": gt_rgb_lo,
                "gt_bchw_lo": gt_bchw_lo,
                "gt_depth_lo": gt_depth_lo,
                "gt_mask_lo": gt_mask_lo,
                "H_lo": H_lo,
                "W_lo": W_lo,
            }
        )

    n_views = len(train_views)
    if n_views < 2:
        raise RuntimeError("3DGS için en az 2 kamera görünümü gerekli")

    pose_rot = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_trans = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_lr_init = 5.0e-4
    pose_lr_final = 6.0e-5
    pose_opt = torch.optim.Adam([pose_rot, pose_trans], lr=pose_lr_init, weight_decay=5e-4)

    coarse_steps = min(550, num_steps // 4)
    refine_stop = max(coarse_steps + 200, num_steps - 650)
    pose_stop = max(coarse_steps + 300, num_steps - 600)

    strategy = MCMCStrategy(
        cap_max=max_splats,
        noise_lr=1.4e4,
        refine_start_iter=150,
        refine_stop_iter=refine_stop,
        refine_every=65,
        min_opacity=0.018,
        verbose=False,
    )
    strategy.check_sanity(params, optimizers)
    strategy_state = strategy.initialize_state()

    ssim_window = _make_gaussian_window(11, 1.5, device, torch.float32)

    rng_order = np.random.default_rng(17)
    order = []
    while len(order) < num_steps:
        order.extend(rng_order.permutation(n_views).tolist())

    gamma_means = math.pow(means_lr_final / means_lr_init, 1.0 / max(1, num_steps))
    gamma_pose = math.pow(pose_lr_final / pose_lr_init, 1.0 / max(1, pose_stop - 120))
    cur_means_lr = means_lr_init
    cur_pose_lr = pose_lr_init

    # Sıkı boyut sınırı: max 6.5 cm (dev sis bulutu & uzun diken/iğne kesinlikle yasak!)
    MIN_LOG_SCALE = math.log(0.0020)
    MAX_LOG_SCALE = math.log(0.065)

    for step in range(num_steps):
        vi = order[step]
        tv = train_views[vi]
        use_hd = step >= coarse_steps

        if use_hd:
            K_cur = tv["K_hd"]
            gt_rgb = tv["gt_rgb_hd"]
            gt_bchw = tv["gt_bchw_hd"]
            gt_depth = tv["gt_depth_hd"]
            gt_mask = tv["gt_mask_hd"]
            H_cur, W_cur = tv["H_hd"], tv["W_hd"]
        else:
            K_cur = tv["K_lo"]
            gt_rgb = tv["gt_rgb_lo"]
            gt_bchw = tv["gt_bchw_lo"]
            gt_depth = tv["gt_depth_lo"]
            gt_mask = tv["gt_mask_lo"]
            H_cur, W_cur = tv["H_lo"], tv["W_lo"]

        opt_pose_now = 120 <= step < pose_stop
        if opt_pose_now:
            delta = _se3_delta_matrix(pose_rot[vi], pose_trans[vi])
            w2c_cur = (delta @ tv["w2c"]).unsqueeze(0)
        else:
            with torch.no_grad():
                delta = _se3_delta_matrix(pose_rot[vi], pose_trans[vi]) if step >= 120 else None
            w2c_cur = ((delta @ tv["w2c"]) if delta is not None else tv["w2c"]).unsqueeze(0)

        scales_exp = torch.exp(params["scales"].clamp(MIN_LOG_SCALE, MAX_LOG_SCALE))
        opas_sig = torch.sigmoid(params["opacities"])

        renders, alphas, info = rasterization(
            means=params["means"],
            quats=params["quats"],
            scales=scales_exp,
            opacities=opas_sig,
            colors=params["sh0"],
            viewmats=w2c_cur,
            Ks=K_cur,
            width=W_cur,
            height=H_cur,
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

        l1 = torch.abs(pred_rgb - gt_rgb).mean()
        pred_bchw = pred_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()
        ssim_val = _ssim_loss_11(pred_bchw, gt_bchw, ssim_window)
        loss = 0.80 * l1 + 0.20 * (1.0 - ssim_val)

        # Sürekli metrik derinlik kilidi: splat'lerin havaya fırlamasını tüm eğitim boyunca engeller
        valid_d = gt_mask & (alphas[0, ..., 0] > 0.45)
        if valid_d.any():
            d_w = 0.08 if step < coarse_steps else (0.045 if step < refine_stop else 0.025)
            loss = loss + d_w * F.smooth_l1_loss(pred_depth[valid_d], gt_depth[valid_d], beta=0.08)

        # 2DGS / SuGaR anti-iğne cezası: yassı disk (s0 ince, s1≈s2) serbest, sivri diken (s2 >> s1) yasak!
        s_sorted, _ = torch.sort(scales_exp, dim=-1)
        needle_pen = F.relu(s_sorted[:, 2] / (s_sorted[:, 1] + 1e-4) - 2.2).mean()
        flat_pen = F.relu(s_sorted[:, 0] - 0.018).mean()

        reg_mul = 1.0 if step < refine_stop else 0.50
        loss = loss + reg_mul * (
            0.004 * opas_sig.mean()
            + 0.016 * scales_exp.mean()
            + 0.06 * needle_pen
            + 0.03 * flat_pen
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

    # Temizlik: iğne/diken kalıntılarını ve oda dışı gürültüleri ayıkla
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
        & (alphas_np >= 0.07)
        & (sc_sorted[:, 2] <= 0.068)
        & (needle_ratio <= 4.5)
        & (np.abs(means_np[:, 0]) <= half_w + 0.25)
        & (np.abs(means_np[:, 2]) <= half_d + 0.25)
        & (means_np[:, 1] >= -0.06)
        & (means_np[:, 1] <= ceil_cut)
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
        f"[gsplat-v7] {len(means_np)} splat ({hd_res_sample[0]}x{hd_res_sample[1]} HD, "
        f"anti-needle, {num_steps} adım, {n_views} açı, {gs_sec} sn)",
        flush=True,
    )

    return {
        "positions": means_np,
        "log_scales": log_scales_np,
        "quats_wxyz": quats_np,
        "alphas": alphas_np,
        "rgb": rgb_np,
        "gs_sec": gs_sec,
    }
