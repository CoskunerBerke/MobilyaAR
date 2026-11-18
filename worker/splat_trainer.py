"""
Odanda Gör — Per-Scene 3D Gaussian Splatting (gsplat v1.5.3 + MCMCStrategy)
MapAnything'in metrik 3D nokta bulutu ve hizalanmış kamera pozlarından doğrudan
başlayarak 12–20 saniyede fotogerçekçi 3D Gaussian Splat odası optimize eder.
Koordinat sistemi: hizalanmış Three.js RUB (y=0 zemin, metre cinsinden).
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
    """Chunked GPU 3-NN mesafesinden başlangıç log-ölçeklerini hesaplar (hızlı, OOM-güvenli)."""
    import torch

    n = pts_t.shape[0]
    if n < 16:
        return torch.full((n, 3), math.log(0.018), device=device, dtype=torch.float32)

    # Hız için referans alt-örnekleme (<= 25K nokta) ile 3-NN kestirimi
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
            # Kendi noktası 0 olabileceğinden en yakın 4 komşudan 2..4 ortalamasını al
            vals, _ = torch.topk(d, k=min(4, ref_n), dim=1, largest=False)
            if vals.shape[1] >= 4:
                avg_d = vals[:, 1:4].mean(dim=1)
            else:
                avg_d = vals[:, -1]
            dists_out[s:e] = avg_d * density_fix

    scales = torch.clamp(dists_out * 0.72, min=0.005, max=0.038)
    return torch.log(scales).unsqueeze(-1).repeat(1, 3)


def _se3_delta_matrix(rot_vec, trans_vec):
    """Küçük eksen-açı rot_vec (3,) + trans_vec (3,) -> 4x4 sol-çarpım SE(3) düzeltmesi."""
    import torch

    # Sınırla: oda metrik ölçeği ve y=0 zemini asla kaymasın (<= 1.4°, <= 3.5 cm)
    r = torch.tanh(rot_vec) * 0.025
    t = torch.tanh(trans_vec) * 0.035

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
    max_splats: int = 110_000,
    num_steps: int = 1100,
):
    """
    MapAnything çıktısından 3D Gaussian Splatting eğitir ve temizlenmiş
    RUB koordinatlı (positions, log_scales, quats_wxyz, alphas, sh0_rgb) döndürür.
    """
    import torch
    import torch.nn.functional as F
    from gsplat import MCMCStrategy, rasterization

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU bulunamadı")

    t0 = time.time()
    device = torch.device("cuda")

    # 1. Başlangıç nokta bulutunu oda sınırlarına kırp ve <= 75K başlangıç Gaussian'ına indir
    pad_xz = 0.38
    in_box = (
        np.isfinite(P_init).all(axis=1)
        & (np.abs(P_init[:, 0]) <= half_w + pad_xz)
        & (np.abs(P_init[:, 2]) <= half_d + pad_xz)
        & (P_init[:, 1] >= -0.10)
        & (P_init[:, 1] <= ceil_cut + 0.08)
    )
    P_use = P_init[in_box]
    C_use = C_init[in_box]
    if len(P_use) < 500:
        raise RuntimeError("3DGS başlatmak için yeterli nokta yok")

    init_cap = min(75_000, max_splats - 15_000)
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
    quats_init[:, 0] = 1.0  # [w, x, y, z] birim kuaterniyon
    # logit(0.45) ≈ -0.2007
    opa_init = torch.full((n_init,), -0.20, device=device, dtype=torch.float32)

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
    means_lr_init = 1.6e-4 * scene_scale
    means_lr_final = 1.6e-5 * scene_scale

    optimizers = {
        "means": torch.optim.Adam([{"params": params["means"], "lr": means_lr_init, "name": "means"}], eps=1e-15),
        "scales": torch.optim.Adam([{"params": params["scales"], "lr": 5.0e-3, "name": "scales"}], eps=1e-15),
        "quats": torch.optim.Adam([{"params": params["quats"], "lr": 1.0e-3, "name": "quats"}], eps=1e-15),
        "opacities": torch.optim.Adam([{"params": params["opacities"], "lr": 5.0e-2, "name": "opacities"}], eps=1e-15),
        "sh0": torch.optim.Adam([{"params": params["sh0"], "lr": 3.0e-3, "name": "sh0"}], eps=1e-15),
    }

    # 2. Eğitim kameralarını ve hedef RGB + derinlik tensörlerini GPU'ya yükle
    train_views = []
    for vc in views_cam:
        R_rdf = vc["R_rdf2room"]
        w2c_r = R_rdf.T
        w2c_t = -w2c_r @ vc["cam_pos"]
        w2c = np.eye(4, dtype=np.float32)
        w2c[:3, :3] = w2c_r.astype(np.float32)
        w2c[:3, 3] = w2c_t.astype(np.float32)

        K = np.asarray(vc["K"], dtype=np.float32)
        rgb_img = np.asarray(vc["rgb"], dtype=np.float32) / 255.0  # (H, W, 3)
        depth_m = np.asarray(vc["depth_m"], dtype=np.float32)
        mask = np.asarray(vc["mask"], dtype=bool)
        H, W = rgb_img.shape[:2]

        gt_rgb = torch.from_numpy(rgb_img).to(device)  # (H, W, 3)
        gt_bchw = gt_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()  # (1, 3, H, W)
        gt_depth = torch.from_numpy(depth_m).to(device)
        gt_mask = torch.from_numpy(mask).to(device) & (gt_depth > 0.22) & (gt_depth < 8.5)

        train_views.append(
            {
                "w2c": torch.from_numpy(w2c).to(device),
                "K": torch.from_numpy(K).to(device).unsqueeze(0),
                "gt_rgb": gt_rgb,
                "gt_bchw": gt_bchw,
                "gt_depth": gt_depth,
                "gt_mask": gt_mask,
                "H": H,
                "W": W,
            }
        )

    n_views = len(train_views)
    if n_views < 2:
        raise RuntimeError("3DGS için en az 2 kamera görünümü gerekli")

    # Hafif kamera poz ince ayarı (1-2 px MapAnything titremesini silip keskinliği artırır)
    pose_rot = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_trans = torch.nn.Parameter(torch.zeros((n_views, 3), device=device, dtype=torch.float32))
    pose_opt = torch.optim.Adam([pose_rot, pose_trans], lr=2.5e-4, weight_decay=1e-3)

    strategy = MCMCStrategy(
        cap_max=max_splats,
        noise_lr=3.0e4,
        refine_start_iter=150,
        refine_stop_iter=max(200, num_steps - 250),
        refine_every=75,
        min_opacity=0.012,
        verbose=False,
    )
    strategy.check_sanity(params, optimizers)
    strategy_state = strategy.initialize_state()

    ssim_window = _make_gaussian_window(11, 1.5, device, torch.float32)

    # Rastgele ama her görüşü eşit gezen deterministik sıra
    rng_order = np.random.default_rng(17)
    order = []
    while len(order) < num_steps:
        order.extend(rng_order.permutation(n_views).tolist())

    gamma = math.pow(means_lr_final / means_lr_init, 1.0 / max(1, num_steps))
    cur_means_lr = means_lr_init

    for step in range(num_steps):
        vi = order[step]
        tv = train_views[vi]

        # İlk 150 adımda kamera sabit, 150..850 arasında ince poz ayarı açık
        if 150 <= step < num_steps - 200:
            delta = _se3_delta_matrix(pose_rot[vi], pose_trans[vi])
            w2c_cur = (delta @ tv["w2c"]).unsqueeze(0)
        else:
            with torch.no_grad():
                delta = _se3_delta_matrix(pose_rot[vi], pose_trans[vi]) if step >= 150 else None
            w2c_cur = ((delta @ tv["w2c"]) if delta is not None else tv["w2c"]).unsqueeze(0)

        scales_exp = torch.exp(params["scales"].clamp(-9.0, -0.5))
        opas_sig = torch.sigmoid(params["opacities"])

        renders, alphas, info = rasterization(
            means=params["means"],
            quats=params["quats"],
            scales=scales_exp,
            opacities=opas_sig,
            colors=params["sh0"],
            viewmats=w2c_cur,
            Ks=tv["K"],
            width=tv["W"],
            height=tv["H"],
            near_plane=0.12,
            far_plane=25.0,
            sh_degree=0,
            packed=True,
            render_mode="RGB+ED",
            rasterize_mode="antialiased",
        )

        # RGB + rastgele arka plan kompoziti (boşluklarda şeffaflık sızıntısını engeller)
        bg = torch.rand(3, device=device, dtype=torch.float32)
        pred_rgb = renders[0, ..., :3] + (1.0 - alphas[0]) * bg
        pred_depth = renders[0, ..., 3]

        l1 = torch.abs(pred_rgb - tv["gt_rgb"]).mean()
        pred_bchw = pred_rgb.permute(2, 0, 1).unsqueeze(0).contiguous()
        ssim_val = _ssim_loss_11(pred_bchw, tv["gt_bchw"], ssim_window)
        loss = 0.80 * l1 + 0.20 * (1.0 - ssim_val)

        # Zayıf metrik derinlik koruması: havada uçan bulutları (floaters) bastırır
        valid_d = tv["gt_mask"] & (alphas[0, ..., 0] > 0.45)
        if valid_d.any():
            d_w = 0.045 if step < num_steps - 300 else 0.015
            loss = loss + d_w * F.smooth_l1_loss(pred_depth[valid_d], tv["gt_depth"][valid_d], beta=0.10)

        # MCMC düzenlileştirme: net ve küçük Gaussian'lar + gereksizleri yeniden konumlandır
        loss = loss + 0.008 * opas_sig.mean() + 0.008 * scales_exp.mean()

        loss.backward()

        for opt in optimizers.values():
            opt.step()
            opt.zero_grad(set_to_none=True)

        with torch.no_grad():
            params["scales"].clamp_(-9.0, -0.75)
            params["opacities"].clamp_(-8.0, 8.0)

        if 150 <= step < num_steps - 200:
            pose_opt.step()
            pose_opt.zero_grad(set_to_none=True)

        # Son 250 adımda MCMC gürültüsünü kapatarak keskin dokuları kilitle
        if step < num_steps - 250:
            strategy.step_post_backward(
                params=params,
                optimizers=optimizers,
                state=strategy_state,
                step=step,
                info=info,
                lr=cur_means_lr,
            )

        cur_means_lr *= gamma
        optimizers["means"].param_groups[0]["lr"] = cur_means_lr

    # 3. Temizlik & kırpma (Kuşbakışı için tavanı ve oda dışı gürültüleri ayıkla)
    with torch.no_grad():
        means_np = params["means"].detach().float().cpu().numpy()
        log_scales_np = params["scales"].detach().float().clamp(-9.0, -0.8).cpu().numpy()
        quats_np = F.normalize(params["quats"].detach().float(), p=2, dim=-1).cpu().numpy()  # w,x,y,z
        alphas_np = torch.sigmoid(params["opacities"].detach().float()).cpu().numpy()
        sh0_np = params["sh0"].detach().float().squeeze(1).cpu().numpy()  # (N, 3)
        rgb_np = np.clip(sh0_np * SH_C0 + 0.5, 0.0, 1.0)

    max_sc = np.exp(log_scales_np).max(axis=1)
    keep = (
        np.isfinite(means_np).all(axis=1)
        & np.isfinite(log_scales_np).all(axis=1)
        & np.isfinite(quats_np).all(axis=1)
        & np.isfinite(alphas_np)
        & (alphas_np >= 0.045)
        & (max_sc <= 0.38)
        & (np.abs(means_np[:, 0]) <= half_w + 0.30)
        & (np.abs(means_np[:, 2]) <= half_d + 0.30)
        & (means_np[:, 1] >= -0.10)
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
        # Görsel katkısı en yüksek splat'leri tut
        score = alphas_np * np.power(np.maximum(1e-9, np.exp(log_scales_np).prod(axis=1)), 0.15)
        top_idx = np.argpartition(score, -max_splats)[-max_splats:]
        means_np = means_np[top_idx]
        log_scales_np = log_scales_np[top_idx]
        quats_np = quats_np[top_idx]
        alphas_np = alphas_np[top_idx]
        rgb_np = rgb_np[top_idx]

    gs_sec = round(time.time() - t0, 2)
    print(f"[gsplat] {len(means_np)} splat optimize edildi ({num_steps} adım, {n_views} açı, {gs_sec} sn)", flush=True)

    return {
        "positions": means_np,
        "log_scales": log_scales_np,
        "quats_wxyz": quats_np,
        "alphas": alphas_np,
        "rgb": rgb_np,
        "gs_sec": gs_sec,
    }
