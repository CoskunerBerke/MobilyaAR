"""
Ham MapAnything RGB-D + kamera pozu tahminlerini tarayıcıda akıcı gösterilen,
katı (noktasız) Volumetric TSDF + Surface Nets 3D oda yüzeyine, y=0 zemin düzlemine,
10 cm doluluk haritasına ve HD açı derinlik maskelerine dönüştürür.
Sadece numpy kullanır (harici bağımlılık gerektirmez ve yerelde test edilebilir).
"""

import base64
import gzip
import struct

import numpy as np

VOXEL_M = 0.014
CELL_M = 0.10
SPZ_MAGIC = 0x5053474E  # "NGSP"
SPZ_SH_C0 = 0.28209479177387814
SPZ_COLOR_SCALE = 0.15


def pack_spz_v2(
    positions: np.ndarray,
    log_scales: np.ndarray,
    quats_wxyz: np.ndarray,
    alphas: np.ndarray,
    rgb: np.ndarray,
    antialiased: bool = True,
) -> bytes:
    """
    RUB koordinatlı 3D Gaussian bulutunu Niantic SPZ v2 (gzip) ikili biçimine sıkıştırır.
    Spark (@sparkjsdev/spark) ve tüm standart SPZ v2 okuyucularıyla bit-düzeyinde uyumludur.
    """
    n = int(len(positions))
    flags = 1 if antialiased else 0
    header = struct.pack("<IIIBBBB", SPZ_MAGIC, 2, n, 0, 12, flags, 0)

    # 1. Positions: 24-bit işaretli sabit nokta (1/4096 m = 0.24 mm hassasiyet)
    pos_q = np.clip(np.round(np.asarray(positions, dtype=np.float64) * 4096.0), -8_388_607, 8_388_607).astype(np.int32)
    p_u = pos_q.astype(np.uint32).reshape(-1)
    pos_bytes = np.empty((len(p_u), 3), dtype=np.uint8)
    pos_bytes[:, 0] = p_u & 0xFF
    pos_bytes[:, 1] = (p_u >> 8) & 0xFF
    pos_bytes[:, 2] = (p_u >> 16) & 0xFF

    # 2. Alphas: [0, 1] -> uint8
    alpha_bytes = np.clip(np.round(np.asarray(alphas, dtype=np.float32) * 255.0), 0, 255).astype(np.uint8)

    # 3. Colors (DC): Spark decoder rgb = (byte/255 - 0.5) * (SH_C0 / 0.15) + 0.5
    rgb_f = np.asarray(rgb, dtype=np.float32)
    color_bytes = np.clip(
        np.round(((rgb_f - 0.5) * (SPZ_COLOR_SCALE / SPZ_SH_C0) + 0.5) * 255.0),
        0,
        255,
    ).astype(np.uint8)

    # 4. Scales: log-scale -> uint8 ((log_s + 10) * 16)
    scale_bytes = np.clip(np.round((np.asarray(log_scales, dtype=np.float32) + 10.0) * 16.0), 0, 255).astype(np.uint8)

    # 5. Rotations (SPZ v2): normalize [w,x,y,z], w >= 0 yap, [x,y,z] -> uint8 (v*127.5 + 127.5)
    q = np.asarray(quats_wxyz, dtype=np.float32).copy()
    q_norm = np.linalg.norm(q, axis=1, keepdims=True)
    q = np.divide(q, np.maximum(q_norm, 1e-8))
    flip = q[:, 0] < 0.0
    q[flip] = -q[flip]
    rot_bytes = np.clip(np.round(q[:, 1:4] * 127.5 + 127.5), 0, 255).astype(np.uint8)

    raw = b"".join(
        [
            header,
            np.ascontiguousarray(pos_bytes).tobytes(),
            np.ascontiguousarray(alpha_bytes).tobytes(),
            np.ascontiguousarray(color_bytes).tobytes(),
            np.ascontiguousarray(scale_bytes).tobytes(),
            np.ascontiguousarray(rot_bytes).tobytes(),
        ]
    )
    return gzip.compress(raw, compresslevel=6)


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def _voxel_downsample(P: np.ndarray, C: np.ndarray, voxel: float):
    keys = np.floor(P / voxel).astype(np.int64)
    keys -= keys.min(axis=0)
    dims = keys.max(axis=0) + 1
    flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
    _, idx = np.unique(flat, return_index=True)
    return P[idx], C[idx]


def _rotation_from_to(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.9999:
        axis = np.array([1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
        axis = axis - a * np.dot(axis, a)
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0.0, -v[2], v[1]], [v[2], 0.0, -v[0]], [-v[1], v[0], 0.0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def _mat3_to_quat(m: np.ndarray) -> list[float]:
    """3x3 orthonormal dönüşüm matrisini Three.js [qx, qy, qz, qw] kuaterniyonuna çevirir."""
    tr = float(m[0, 0] + m[1, 1] + m[2, 2])
    if tr > 0.0:
        s = np.sqrt(tr + 1.0) * 2.0
        qw = 0.25 * s
        qx = (m[2, 1] - m[1, 2]) / s
        qy = (m[0, 2] - m[2, 0]) / s
        qz = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2.0
        qw = (m[2, 1] - m[1, 2]) / s
        qx = 0.25 * s
        qy = (m[0, 1] + m[1, 0]) / s
        qz = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2.0
        qw = (m[0, 2] - m[2, 0]) / s
        qx = (m[0, 1] + m[1, 0]) / s
        qy = 0.25 * s
        qz = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2.0
        qw = (m[1, 0] - m[0, 1]) / s
        qx = (m[0, 2] + m[2, 0]) / s
        qy = (m[1, 2] + m[2, 1]) / s
        qz = 0.25 * s
    q = np.array([qx, qy, qz, qw], dtype=np.float64)
    norm = float(np.linalg.norm(q))
    if norm > 1e-8:
        q /= norm
    return [round(float(v), 6) for v in q]


def _fit_floor(P: np.ndarray, up: np.ndarray, rng: np.random.Generator):
    """Normali yukarı yöne yakın, altında az nokta kalan en büyük düzlemi RANSAC ile bulur."""
    h = P @ up
    low = P[h < np.percentile(h, 35)]
    if len(low) < 50:
        return up, float(np.percentile(h, 2))
    best_n, best_d, best_score = up, float(np.percentile(h, 2)), -1
    for _ in range(300):
        s = low[rng.choice(len(low), 3, replace=False)]
        n = np.cross(s[1] - s[0], s[2] - s[0])
        norm = np.linalg.norm(n)
        if norm < 1e-9:
            continue
        n /= norm
        if np.dot(n, up) < 0:
            n = -n
        if np.dot(n, up) < 0.9:
            continue
        d = float(np.dot(n, s[0]))
        dist = P @ n - d
        inl = np.count_nonzero(np.abs(dist) < 0.03)
        below = np.count_nonzero(dist < -0.08)
        score = inl - 3 * below
        if score > best_score:
            best_score, best_n, best_d = score, n, d
    dist = P @ best_n - best_d
    inl = P[np.abs(dist) < 0.03]
    if len(inl) > 50:
        c = inl.mean(axis=0)
        _, _, vt = np.linalg.svd(inl - c, full_matrices=False)
        n = vt[2]
        if np.dot(n, up) < 0:
            n = -n
        if np.dot(n, up) > 0.9:
            best_n, best_d = n, float(np.dot(n, c))
    return best_n, best_d


def _dominant_yaw(xz: np.ndarray, rng: np.random.Generator) -> float:
    """Duvarların oluşturduğu keskin histogram tepelerini en çok artıran yatay dönüş açısı (0–90°)."""
    if len(xz) > 30_000:
        xz = xz[rng.choice(len(xz), 30_000, replace=False)]
    best_a, best_s = 0.0, -1.0
    for deg in np.arange(0, 90, 1.0):
        a = np.deg2rad(deg)
        c, s = np.cos(a), np.sin(a)
        x = xz[:, 0] * c - xz[:, 1] * s
        z = xz[:, 0] * s + xz[:, 1] * c
        hx, _ = np.histogram(x, bins=max(10, int(np.ptp(x) / 0.05) + 1))
        hz, _ = np.histogram(z, bins=max(10, int(np.ptp(z) / 0.05) + 1))
        score = float((hx.astype(np.float64) ** 2).sum() + (hz.astype(np.float64) ** 2).sum())
        if score > best_s:
            best_s, best_a = score, a
    return best_a


def _find_open_spawn_xz(grid: np.ndarray, gw: int, gd: int, half_w: float, half_d: float) -> list[float]:
    """En geniş boş zeminin merkez noktasını (metre cinsinden) seçer."""
    free_rc = np.argwhere(grid == 0)
    if len(free_rc) == 0:
        return [0.0, 0.0]

    blocked_rc = np.argwhere(grid != 0)
    wall_dist = np.minimum(
        np.minimum(free_rc[:, 1] + 0.5, gw - 0.5 - free_rc[:, 1]),
        np.minimum(free_rc[:, 0] + 0.5, gd - 0.5 - free_rc[:, 0]),
    )
    if len(blocked_rc) == 0:
        best_idx = int(np.argmax(wall_dist))
    else:
        best_clear = -1.0
        best_idx = 0
        chunk = 512
        b_rc = blocked_rc.astype(np.float32)
        for s in range(0, len(free_rc), chunk):
            f_rc = free_rc[s : s + chunk].astype(np.float32)
            diff = f_rc[:, None, :] - b_rc[None, :, :]
            d_blk = np.sqrt((diff * diff).sum(axis=2)).min(axis=1)
            clear = np.minimum(d_blk, wall_dist[s : s + chunk])
            local_best = int(np.argmax(clear))
            if float(clear[local_best]) > best_clear:
                best_clear = float(clear[local_best])
                best_idx = s + local_best

    best_gz, best_gx = int(free_rc[best_idx, 0]), int(free_rc[best_idx, 1])
    sx = (best_gx + 0.5) * CELL_M - half_w
    sz = (best_gz + 0.5) * CELL_M - half_d
    return [round(float(sx), 2), round(float(sz), 2)]


def _dilate_3d(mask: np.ndarray, radius: int = 2) -> np.ndarray:
    """Pure NumPy 3D Chebyshev (kutu) genişletmesi."""
    cur = mask
    for _ in range(radius):
        out = cur.copy()
        out[1:, :, :] |= cur[:-1, :, :]
        out[:-1, :, :] |= cur[1:, :, :]
        cur = out
        out = cur.copy()
        out[:, 1:, :] |= cur[:, :-1, :]
        out[:, :-1, :] |= cur[:, 1:, :]
        cur = out
        out = cur.copy()
        out[:, :, 1:] |= cur[:, :, :-1]
        out[:, :, :-1] |= cur[:, :, 1:]
        cur = out
    return cur


def _fill_floor_and_synthesize(
    P: np.ndarray,
    C: np.ndarray,
    cams: np.ndarray,
    half_w: float,
    half_d: float,
    grid: np.ndarray,
    floor_cnt: np.ndarray,
    obst_cnt: np.ndarray,
):
    """Kamera yürüyüş koridorunu ve zemin boşluklarını kurtarır; tüm zemin için yayılmış renk haritası ve y=0 TSDF noktaları üretir."""
    gd, gw = grid.shape

    # 1. Kamera yürüyüş yolu kurtarma: kameranın geçtiği 0.45m koridor boş zemin sayılır
    if len(cams) > 0:
        cx_i = np.arange(gw, dtype=np.float64) * CELL_M + 0.5 * CELL_M - half_w
        cz_i = np.arange(gd, dtype=np.float64) * CELL_M + 0.5 * CELL_M - half_d
        gxx, gzz = np.meshgrid(cx_i, cz_i, indexing="xy")
        cam_xz = cams[:, [0, 2]]
        d2 = (gxx[..., None] - cam_xz[:, 0][None, None, :]) ** 2 + (gzz[..., None] - cam_xz[:, 1][None, None, :]) ** 2
        near_cam = np.min(d2, axis=2) <= (0.45 ** 2)
        grid[near_cam & (obst_cnt <= 1) & (grid != 1)] = 0

    # 2. İç zemin tekil boşluklarını 2 tur morfolojik doldurma ile kapat
    for _ in range(2):
        padded = np.pad((grid == 0).astype(np.int32), 1, mode="constant", constant_values=0)
        nbr_free = (
            padded[:-2, :-2]
            + padded[:-2, 1:-1]
            + padded[:-2, 2:]
            + padded[1:-1, :-2]
            + padded[1:-1, 2:]
            + padded[2:, :-2]
            + padded[2:, 1:-1]
            + padded[2:, 2:]
        )
        grid[(grid == 2) & (obst_cnt == 0) & (nbr_free >= 4)] = 0

    # 3. Gözlenen zemin hücrelerinden tüm odaya Gaussian ağırlıklı halı/parke taban rengi yay
    gx = np.clip(((P[:, 0] + half_w) / CELL_M).astype(int), 0, gw - 1)
    gz = np.clip(((P[:, 2] + half_d) / CELL_M).astype(int), 0, gd - 1)
    floor_pts = np.abs(P[:, 1]) < 0.08
    cell_rgb = np.zeros((gd, gw, 3), dtype=np.float32)
    cell_n = np.zeros((gd, gw), dtype=np.float32)
    f_idx = np.flatnonzero(floor_pts)
    if len(f_idx) > 0:
        np.add.at(cell_rgb, (gz[f_idx], gx[f_idx]), C[f_idx].astype(np.float32))
        np.add.at(cell_n, (gz[f_idx], gx[f_idx]), 1.0)

    obs_cells = np.argwhere(cell_n >= 1.0)
    if len(obs_cells) == 0:
        fallback = np.array([195, 188, 178], dtype=np.uint8)
        floor_rgb_grid = np.broadcast_to(fallback, (gd, gw, 3)).copy()
        return P, C, grid, floor_rgb_grid

    obs_rgb = cell_rgb[obs_cells[:, 0], obs_cells[:, 1]] / cell_n[obs_cells[:, 0], obs_cells[:, 1], None]
    all_r, all_c = np.meshgrid(np.arange(gd, dtype=np.float32), np.arange(gw, dtype=np.float32), indexing="ij")
    all_rc = np.column_stack([all_r.ravel(), all_c.ravel()])
    oc_f = obs_cells.astype(np.float32)

    interp_rgb = np.empty((len(all_rc), 3), dtype=np.float32)
    for s in range(0, len(all_rc), 256):
        sub = all_rc[s : s + 256]
        diff = sub[:, None, :] - oc_f[None, :, :]
        dist2 = (diff * diff).sum(axis=2)
        w = np.exp(-dist2 / 12.0) + 1e-6 / (1.0 + dist2)
        w /= w.sum(axis=1, keepdims=True)
        interp_rgb[s : s + 256] = w @ obs_rgb

    floor_rgb_grid = np.clip(np.round(interp_rgb), 0, 255).astype(np.uint8).reshape(gd, gw, 3)

    # Doğrudan gözlenen hücrelerde orijinal ortalama rengi koru
    exact_mask = cell_n >= 2.0
    floor_rgb_grid[exact_mask] = np.clip(
        np.round(cell_rgb[exact_mask] / cell_n[exact_mask, None]), 0, 255
    ).astype(np.uint8)

    # 4. Seyrek/boş iç zemin hücrelerini y=0 noktalarıyla sıklaştır (TSDF'de kara delik kalmaz)
    sparse_cells = np.argwhere((obst_cnt < 4) & (floor_cnt < 6))
    if len(sparse_cells) == 0:
        return P, C, grid, floor_rgb_grid

    offs = np.array([0.125, 0.375, 0.625, 0.875], dtype=np.float64) * CELL_M
    ox, oz = np.meshgrid(offs, offs, indexing="xy")
    ox = ox.ravel()
    oz = oz.ravel()

    base_x = sparse_cells[:, 1].astype(np.float64) * CELL_M - half_w
    base_z = sparse_cells[:, 0].astype(np.float64) * CELL_M - half_d
    syn_x = (base_x[:, None] + ox[None, :]).ravel()
    syn_z = (base_z[:, None] + oz[None, :]).ravel()
    syn_y = np.zeros_like(syn_x)
    syn_P = np.column_stack([syn_x, syn_y, syn_z])
    syn_colors = floor_rgb_grid[sparse_cells[:, 0], sparse_cells[:, 1]]
    syn_C = np.repeat(syn_colors, len(ox), axis=0)

    return np.concatenate([P, syn_P], axis=0), np.concatenate([C, syn_C], axis=0), grid, floor_rgb_grid


def _extract_tsdf_surface(
    P_room: np.ndarray,
    C_room: np.ndarray,
    views_cam: list[dict],
    grid: np.ndarray,
    obst_cnt: np.ndarray,
    half_w: float,
    half_d: float,
    ceil: float,
    vox: float,
):
    """Dar bantlı Volumetric TSDF + Surface Nets + Taubin yumuşatma ile katı üçgen yüzey çıkarır."""
    x_min, x_max = -half_w - 0.12, half_w + 0.12
    y_min, y_max = -0.14, max(1.9, ceil - 0.06)
    z_min, z_max = -half_d - 0.12, half_d + 0.12

    origin = np.array([x_min, y_min, z_min], dtype=np.float64)
    nx = max(6, int(np.ceil((x_max - x_min) / vox)) + 1)
    ny = max(6, int(np.ceil((y_max - y_min) / vox)) + 1)
    nz = max(6, int(np.ceil((z_max - z_min) / vox)) + 1)

    ix = np.floor((P_room[:, 0] - origin[0]) / vox).astype(np.int32)
    iy = np.floor((P_room[:, 1] - origin[1]) / vox).astype(np.int32)
    iz = np.floor((P_room[:, 2] - origin[2]) / vox).astype(np.int32)
    inb = (ix >= 1) & (ix < nx - 1) & (iy >= 1) & (iy < ny - 1) & (iz >= 1) & (iz < nz - 1)
    ix, iy, iz, C_in = ix[inb], iy[inb], iz[inb], C_room[inb]

    occ = np.zeros((nx, ny, nz), dtype=bool)
    occ[ix, iy, iz] = True

    vox_rgb_sum = np.zeros((nx, ny, nz, 3), dtype=np.float32)
    vox_rgb_cnt = np.zeros((nx, ny, nz), dtype=np.float32)
    np.add.at(vox_rgb_sum, (ix, iy, iz), C_in.astype(np.float32))
    np.add.at(vox_rgb_cnt, (ix, iy, iz), 1.0)

    band = _dilate_3d(occ, radius=2)
    bi, bj, bk = np.nonzero(band)
    if len(bi) == 0:
        return None, None, None

    X_band = np.column_stack(
        [
            origin[0] + bi * vox,
            origin[1] + bj * vox,
            origin[2] + bk * vox,
        ]
    )

    trunc = 2.6 * vox
    tsdf_sum = np.zeros(len(bi), dtype=np.float32)
    w_sum = np.zeros(len(bi), dtype=np.float32)
    col_sum = np.zeros((len(bi), 3), dtype=np.float32)
    col_w = np.zeros(len(bi), dtype=np.float32)

    # Boş zemin (y=0) önceliği: halı/parke yüzeyi deliksiz ve düz kalsın
    gd, gw = grid.shape
    bgx = np.clip(((X_band[:, 0] + half_w) / CELL_M).astype(int), 0, gw - 1)
    bgz = np.clip(((X_band[:, 2] + half_d) / CELL_M).astype(int), 0, gd - 1)
    is_floor_band = (grid[bgz, bgx] == 0) & (obst_cnt[bgz, bgx] == 0) & (np.abs(X_band[:, 1]) < 2.2 * vox)
    if np.any(is_floor_band):
        fsdf = np.clip(X_band[is_floor_band, 1] / trunc, -1.0, 1.0).astype(np.float32)
        tsdf_sum[is_floor_band] += 0.35 * fsdf
        w_sum[is_floor_band] += 0.35

    for vc in views_cam:
        depth_m = vc["depth_m"]
        rgb_img = vc["rgb"]
        vmask = vc["mask"]
        K = vc["K"]
        H, W = depth_m.shape
        fx, fy, cx_p, cy_p = float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])

        X_rdf = (X_band - vc["cam_pos"]) @ vc["R_rdf2room"]
        zc = X_rdf[:, 2]
        valid = zc > 0.20
        if not np.any(valid):
            continue

        idx_v = np.flatnonzero(valid)
        zc_v = zc[idx_v]
        u = fx * (X_rdf[idx_v, 0] / zc_v) + cx_p
        v = fy * (X_rdf[idx_v, 1] / zc_v) + cy_p
        ui = np.round(u).astype(np.int32)
        vi = np.round(v).astype(np.int32)
        inside = (ui >= 0) & (ui < W) & (vi >= 0) & (vi < H)
        if not np.any(inside):
            continue

        idx_v = idx_v[inside]
        ui = ui[inside]
        vi = vi[inside]
        zc_v = zc_v[inside]

        d_obs = depth_m[vi, ui]
        ok_d = vmask[vi, ui] & (d_obs > 0.20)
        if not np.any(ok_d):
            continue

        idx_v = idx_v[ok_d]
        ui = ui[ok_d]
        vi = vi[ok_d]
        zc_v = zc_v[ok_d]
        d_obs = d_obs[ok_d]

        sdf = d_obs - zc_v
        in_band = (sdf >= -trunc) & (sdf <= 1.35 * trunc)
        if not np.any(in_band):
            continue

        idx_v = idx_v[in_band]
        ui = ui[in_band]
        vi = vi[in_band]
        zc_v = zc_v[in_band]
        sdf = sdf[in_band]

        tsdf_val = np.clip(sdf / trunc, -1.0, 1.0).astype(np.float32)
        w = (
            np.where(sdf >= 0.0, 1.0, np.maximum(0.20, 1.0 + sdf / trunc))
            / np.maximum(0.65, zc_v)
        ).astype(np.float32)
        tsdf_sum[idx_v] += w * tsdf_val
        w_sum[idx_v] += w

        near_surf = np.abs(sdf) < 0.72 * trunc
        if np.any(near_surf):
            isurf = idx_v[near_surf]
            wc = (w[near_surf] * 1.5).astype(np.float32)
            col_sum[isurf] += wc[:, None] * rgb_img[vi[near_surf], ui[near_surf]].astype(np.float32)
            col_w[isurf] += wc

    T = np.zeros((nx, ny, nz), dtype=np.float32)
    V = np.zeros((nx, ny, nz), dtype=bool)
    C_vol = np.zeros((nx, ny, nz, 3), dtype=np.float32)
    W_col = np.zeros((nx, ny, nz), dtype=np.float32)

    valid_band = w_sum > 0.05
    biv, bjv, bkv = bi[valid_band], bj[valid_band], bk[valid_band]
    T[biv, bjv, bkv] = tsdf_sum[valid_band] / w_sum[valid_band]
    V[biv, bjv, bkv] = True

    has_c = valid_band & (col_w > 0)
    C_vol[bi[has_c], bj[has_c], bk[has_c]] = col_sum[has_c] / col_w[has_c, None]
    W_col[bi[has_c], bj[has_c], bk[has_c]] = 1.0

    # Voxel ortalama rengi ile eksik köşeleri yedekle
    need_fallback = (W_col == 0) & (vox_rgb_cnt > 0)
    C_vol[need_fallback] = vox_rgb_sum[need_fallback] / vox_rgb_cnt[need_fallback, None]
    W_col[need_fallback] = 1.0

    # Surface Nets: 8 köşesi geçerli ve işaret değişen dual hücreler
    cell_valid = (
        V[:-1, :-1, :-1] & V[1:, :-1, :-1] & V[:-1, 1:, :-1] & V[1:, 1:, :-1]
        & V[:-1, :-1, 1:] & V[1:, :-1, 1:] & V[:-1, 1:, 1:] & V[1:, 1:, 1:]
    )
    T_corners = np.stack(
        [
            T[:-1, :-1, :-1],
            T[1:, :-1, :-1],
            T[1:, 1:, :-1],
            T[:-1, 1:, :-1],
            T[:-1, :-1, 1:],
            T[1:, :-1, 1:],
            T[1:, 1:, 1:],
            T[:-1, 1:, 1:],
        ],
        axis=-1,
    )
    active = cell_valid & (T_corners.min(axis=-1) < 0.0) & (T_corners.max(axis=-1) >= 0.0)
    ci, cj, ck = np.nonzero(active)
    n_verts = len(ci)
    if n_verts < 10:
        return None, None, None

    cell_to_vid = np.full((nx - 1, ny - 1, nz - 1), -1, dtype=np.int32)
    cell_to_vid[ci, cj, ck] = np.arange(n_verts, dtype=np.int32)

    # 8 küp köşesi lokal koordinatları ve 12 küp kenarı
    corners = np.array(
        [
            [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
            [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
        ],
        dtype=np.float64,
    )
    cube_edges = [
        (0, 1), (1, 2), (2, 3), (3, 0),
        (4, 5), (5, 6), (6, 7), (7, 4),
        (0, 4), (1, 5), (2, 6), (3, 7),
    ]

    pos_sum = np.zeros((n_verts, 3), dtype=np.float64)
    pos_cnt = np.zeros(n_verts, dtype=np.float64)
    vrgb_sum = np.zeros((n_verts, 3), dtype=np.float32)
    vrgb_cnt = np.zeros(n_verts, dtype=np.float32)

    for ca, cb in cube_edges:
        ox_a, oy_a, oz_a = int(corners[ca, 0]), int(corners[ca, 1]), int(corners[ca, 2])
        ox_b, oy_b, oz_b = int(corners[cb, 0]), int(corners[cb, 1]), int(corners[cb, 2])
        ta = T[ci + ox_a, cj + oy_a, ck + oz_a]
        tb = T[ci + ox_b, cj + oy_b, ck + oz_b]
        cross = (ta < 0.0) != (tb < 0.0)
        if not np.any(cross):
            continue
        denom = np.where(np.abs(tb - ta) > 1e-6, tb - ta, 1.0)
        alpha = np.clip(-ta / denom, 0.0, 1.0)
        pt = (1.0 - alpha[:, None]) * corners[ca] + alpha[:, None] * corners[cb]
        cm = cross.astype(np.float64)
        pos_sum += cm[:, None] * pt
        pos_cnt += cm

        wa = W_col[ci + ox_a, cj + oy_a, ck + oz_a]
        wb = W_col[ci + ox_b, cj + oy_b, ck + oz_b]
        ca_rgb = C_vol[ci + ox_a, cj + oy_a, ck + oz_a]
        cb_rgb = C_vol[ci + ox_b, cj + oy_b, ck + oz_b]
        both_c = cross & (wa > 0) & (wb > 0)
        only_a = cross & (wa > 0) & (wb == 0)
        only_b = cross & (wb > 0) & (wa == 0)
        if np.any(both_c):
            a_sub = alpha[both_c, None].astype(np.float32)
            vrgb_sum[both_c] += (1.0 - a_sub) * ca_rgb[both_c] + a_sub * cb_rgb[both_c]
            vrgb_cnt[both_c] += 1.0
        if np.any(only_a):
            vrgb_sum[only_a] += ca_rgb[only_a]
            vrgb_cnt[only_a] += 1.0
        if np.any(only_b):
            vrgb_sum[only_b] += cb_rgb[only_b]
            vrgb_cnt[only_b] += 1.0

    local_pos = pos_sum / np.maximum(pos_cnt[:, None], 1.0)
    verts = np.column_stack(
        [
            origin[0] + (ci + local_pos[:, 0]) * vox,
            origin[1] + (cj + local_pos[:, 1]) * vox,
            origin[2] + (ck + local_pos[:, 2]) * vox,
        ]
    )

    fallback_rgb = np.median(C_room, axis=0).astype(np.float32)
    vrgb = np.where(vrgb_cnt[:, None] > 0, vrgb_sum / np.maximum(vrgb_cnt[:, None], 1.0), fallback_rgb[None, :])

    # İşaret değişen grid kenarları çevresindeki 4 dual hücreden dörtgen (quad) yüzleri üret
    quads_list = []

    # X-yönlü kenarlar
    ex = V[:-1, 1:-1, 1:-1] & V[1:, 1:-1, 1:-1] & ((T[:-1, 1:-1, 1:-1] < 0.0) != (T[1:, 1:-1, 1:-1] < 0.0))
    xi, xj, xk = np.nonzero(ex)
    xj += 1
    xk += 1
    if len(xi):
        q0 = cell_to_vid[xi, xj - 1, xk - 1]
        q1 = cell_to_vid[xi, xj, xk - 1]
        q2 = cell_to_vid[xi, xj, xk]
        q3 = cell_to_vid[xi, xj - 1, xk]
        okq = (q0 >= 0) & (q1 >= 0) & (q2 >= 0) & (q3 >= 0)
        if np.any(okq):
            flip = T[xi[okq], xj[okq], xk[okq]] >= 0.0
            qs = np.stack([q0[okq], q1[okq], q2[okq], q3[okq]], axis=1)
            qs[flip] = qs[flip][:, [0, 3, 2, 1]]
            quads_list.append(qs)

    # Y-yönlü kenarlar
    ey = V[1:-1, :-1, 1:-1] & V[1:-1, 1:, 1:-1] & ((T[1:-1, :-1, 1:-1] < 0.0) != (T[1:-1, 1:, 1:-1] < 0.0))
    yi, yj, yk = np.nonzero(ey)
    yi += 1
    yk += 1
    if len(yi):
        q0 = cell_to_vid[yi - 1, yj, yk - 1]
        q1 = cell_to_vid[yi - 1, yj, yk]
        q2 = cell_to_vid[yi, yj, yk]
        q3 = cell_to_vid[yi, yj, yk - 1]
        okq = (q0 >= 0) & (q1 >= 0) & (q2 >= 0) & (q3 >= 0)
        if np.any(okq):
            flip = T[yi[okq], yj[okq], yk[okq]] >= 0.0
            qs = np.stack([q0[okq], q1[okq], q2[okq], q3[okq]], axis=1)
            qs[flip] = qs[flip][:, [0, 3, 2, 1]]
            quads_list.append(qs)

    # Z-yönlü kenarlar
    ez = V[1:-1, 1:-1, :-1] & V[1:-1, 1:-1, 1:] & ((T[1:-1, 1:-1, :-1] < 0.0) != (T[1:-1, 1:-1, 1:] < 0.0))
    zi, zj, zk = np.nonzero(ez)
    zi += 1
    zj += 1
    if len(zi):
        q0 = cell_to_vid[zi - 1, zj - 1, zk]
        q1 = cell_to_vid[zi, zj - 1, zk]
        q2 = cell_to_vid[zi, zj, zk]
        q3 = cell_to_vid[zi - 1, zj, zk]
        okq = (q0 >= 0) & (q1 >= 0) & (q2 >= 0) & (q3 >= 0)
        if np.any(okq):
            flip = T[zi[okq], zj[okq], zk[okq]] >= 0.0
            qs = np.stack([q0[okq], q1[okq], q2[okq], q3[okq]], axis=1)
            qs[flip] = qs[flip][:, [0, 3, 2, 1]]
            quads_list.append(qs)

    if not quads_list:
        return None, None, None

    quads = np.concatenate(quads_list, axis=0)
    # Kısa köşegenden iki üçgene böl
    d02 = np.sum((verts[quads[:, 0]] - verts[quads[:, 2]]) ** 2, axis=1)
    d13 = np.sum((verts[quads[:, 1]] - verts[quads[:, 3]]) ** 2, axis=1)
    tri_a = np.where(d02[:, None] <= d13[:, None], quads[:, [0, 1, 2]], quads[:, [0, 1, 3]])
    tri_b = np.where(d02[:, None] <= d13[:, None], quads[:, [0, 2, 3]], quads[:, [3, 1, 2]])
    faces = np.concatenate([tri_a, tri_b], axis=0).astype(np.int32)

    # Taubin büzülmesiz yüzey yumuşatma (2 tur)
    raw_edges = np.concatenate(
        [
            faces[:, [0, 1]], faces[:, [1, 0]],
            faces[:, [1, 2]], faces[:, [2, 1]],
            faces[:, [2, 0]], faces[:, [0, 2]],
        ],
        axis=0,
    )
    ekeys = raw_edges[:, 0].astype(np.int64) * n_verts + raw_edges[:, 1].astype(np.int64)
    _, uidx = np.unique(ekeys, return_index=True)
    u_edges = raw_edges[uidx]

    floor_pin = np.abs(verts[:, 1]) < 0.03
    for _ in range(2):
        for factor in (0.33, -0.34):
            s_nbr = np.zeros_like(verts)
            c_nbr = np.zeros(n_verts, dtype=np.float64)
            np.add.at(s_nbr, u_edges[:, 0], verts[u_edges[:, 1]])
            np.add.at(c_nbr, u_edges[:, 0], 1.0)
            avg = s_nbr / np.maximum(c_nbr[:, None], 1.0)
            verts = verts + factor * (avg - verts)
            verts[floor_pin, 1] = 0.0

    # Yumuşak derinlik kabartması için tepe normalleri hesapla (rengi karartmadan hafif 3D form)
    v0 = verts[faces[:, 0]]
    fnorm = np.cross(verts[faces[:, 1]] - v0, verts[faces[:, 2]] - v0)
    vnorm = np.zeros_like(verts)
    np.add.at(vnorm, faces[:, 0], fnorm)
    np.add.at(vnorm, faces[:, 1], fnorm)
    np.add.at(vnorm, faces[:, 2], fnorm)
    nlen = np.linalg.norm(vnorm, axis=1, keepdims=True)
    vnorm = np.divide(vnorm, np.maximum(nlen, 1e-8))
    shade = (0.91 + 0.09 * np.clip(vnorm[:, 1], 0.0, 1.0)).astype(np.float32)
    shaded_rgb = np.clip(vrgb * shade[:, None], 0.0, 255.0).astype(np.uint8)

    return verts, shaded_rgb, faces


def _build_keyframes(views_cam: list[dict], max_kf: int = 8) -> list[dict]:
    """En fazla 8 eşit aralıklı açı için kamera pozu, projeksiyon matrisi ve tam 160px metrik derinlik haritası çıkarır."""
    n = len(views_cam)
    if n == 0:
        return []
    count = min(max_kf, n)
    indices = np.unique(np.linspace(0, n - 1, count).round().astype(int))
    conv_flip = np.diag([1.0, -1.0, -1.0])

    keyframes = []
    for idx in indices:
        vc = views_cam[int(idx)]
        R_rdf = vc["R_rdf2room"]
        R_three = R_rdf @ conv_flip
        quat = _mat3_to_quat(R_three)
        pos = [round(float(v), 4) for v in vc["cam_pos"]]

        w2c_r = R_rdf.T
        w2c_t = -w2c_r @ vc["cam_pos"]

        depth_m = vc["depth_m"]
        mask = vc["mask"]
        K = vc["K"]
        H, W = depth_m.shape
        fx, fy, cx_p, cy_p = float(K[0, 0]), float(K[1, 1]), float(K[0, 2]), float(K[1, 2])
        fov_y = float(2.0 * np.degrees(np.arctan(H / max(1.0, 2.0 * fy))))
        aspect = round(float(W) / max(1.0, float(H)), 5)

        # Hem 3D doku projeksiyon shader'ı hem de ön-plan derinlik maskesi için tüm geçerli metrik derinliği sakla
        occ_valid = mask & (depth_m > 0.20) & (depth_m < 14.0)
        d_occ = np.where(occ_valid, depth_m, 0.0)

        stride = max(1, int(np.ceil(max(H, W) / 160.0)))
        d_sub = d_occ[::stride, ::stride]
        oh, ow = d_sub.shape
        occ_mm = np.clip(np.round(d_sub * 1000.0), 0, 65535).astype(np.uint16)

        keyframes.append(
            {
                "viewIdx": int(idx),
                "pos": pos,
                "quat": quat,
                "w2cR": [round(float(v), 6) for v in w2c_r.ravel()],
                "w2cT": [round(float(v), 6) for v in w2c_t],
                "fovY": round(fov_y, 3),
                "aspect": aspect,
                "normK": [
                    round(fx / max(1.0, float(W)), 6),
                    round(fy / max(1.0, float(H)), 6),
                    round(cx_p / max(1.0, float(W)), 6),
                    round(cy_p / max(1.0, float(H)), 6),
                ],
                "ceilCut": round(float(vc["ceil_cut"]), 3),
                "occW": int(ow),
                "occH": int(oh),
                "occK": [
                    round(fx / stride, 3),
                    round(fy / stride, 3),
                    round(cx_p / stride, 3),
                    round(cy_p / stride, 3),
                ],
                "occDepthMm": _b64(occ_mm),
            }
        )
    return keyframes


def build_room_payload(views_data: list[dict], enable_gs: bool = True) -> dict:
    rng = np.random.default_rng(7)
    if not views_data:
        return {"ok": False, "error": "Görüntü verisi bulunamadı."}

    all_p, all_c, cam_R_list, cam_t_list = [], [], [], []
    for vd in views_data:
        pts = np.asarray(vd["pts3d"], dtype=np.float64)
        rgb = np.asarray(vd["rgb"], dtype=np.uint8)
        mask = np.asarray(vd["mask"], dtype=bool)
        depth_z = np.asarray(vd["depth_z"], dtype=np.float64)
        pose = np.asarray(vd["pose"], dtype=np.float64)

        valid = mask & np.isfinite(pts).all(axis=-1) & np.isfinite(depth_z) & (depth_z > 0.15)
        if np.any(valid):
            all_p.append(pts[valid])
            all_c.append(rgb[valid])
        cam_R_list.append(pose[:3, :3])
        cam_t_list.append(pose[:3, 3])

    if not all_p:
        return {"ok": False, "error": "Karelerden yeterli 3D geometri çıkarılamadı. Daha aydınlık açılarla tekrar deneyin."}

    P_raw = np.concatenate(all_p, axis=0)
    C_raw = np.concatenate(all_c, axis=0)
    if len(P_raw) < 1000:
        return {"ok": False, "error": "Fotoğraflardan yeterli 3D nokta çıkarılamadı. Daha aydınlık ve örtüşen açılarla tekrar deneyin."}

    P, C = _voxel_downsample(P_raw, C_raw, VOXEL_M)

    cam_R = np.stack(cam_R_list, axis=0)
    cam_t = np.stack(cam_t_list, axis=0)
    up = -cam_R[:, :, 1].mean(axis=0)
    up_norm = np.linalg.norm(up)
    up = up / up_norm if up_norm > 1e-8 else np.array([0.0, 1.0, 0.0])

    n, d = _fit_floor(P, up, rng)
    if np.mean(cam_t @ n - d) < 0:
        n, d = -n, -d

    R_floor = _rotation_from_to(n, np.array([0.0, 1.0, 0.0]))
    P = P @ R_floor.T
    cams = cam_t @ R_floor.T
    floor_y = d
    P[:, 1] -= floor_y
    cams[:, 1] -= floor_y

    cam_h = float(np.median(cams[:, 1]))
    scale = 1.0
    if not (0.8 <= cam_h <= 2.2) and cam_h > 0.05:
        scale = 1.4 / cam_h
        P *= scale
        cams *= scale

    mid = P[(P[:, 1] > 0.3) & (P[:, 1] < 2.0)]
    yaw = _dominant_yaw(mid[:, [0, 2]], rng) if len(mid) > 200 else 0.0
    c_y, s_y = np.cos(yaw), np.sin(yaw)
    Ry = np.array([[c_y, 0.0, -s_y], [0.0, 1.0, 0.0], [s_y, 0.0, c_y]])
    R_tot = Ry @ R_floor

    P = P @ Ry.T
    cams = cams @ Ry.T

    ceil = float(min(3.4, np.percentile(P[:, 1], 98)))
    ceil_cut = max(1.85, ceil - 0.12)
    keep = (P[:, 1] > -0.10) & (P[:, 1] < ceil_cut)
    P, C = P[keep], C[keep]
    if len(P) < 500:
        return {"ok": False, "error": "Oda sınırları çıkarılamadı. Lütfen odanın daha geniş açılarını çekin."}

    x0, x1 = np.percentile(P[:, 0], [1, 99])
    z0, z1 = np.percentile(P[:, 2], [1, 99])
    cx, cz = (x0 + x1) / 2.0, (z0 + z1) / 2.0
    P[:, 0] -= cx
    P[:, 2] -= cz
    cams[:, 0] -= cx
    cams[:, 2] -= cz
    half_w, half_d = max(0.8, (x1 - x0) / 2.0), max(0.8, (z1 - z0) / 2.0)

    # 10 cm doluluk ızgarası + seyrek zemin tamamlama
    gw = max(1, int(np.ceil(2.0 * half_w / CELL_M)))
    gd = max(1, int(np.ceil(2.0 * half_d / CELL_M)))
    gx = np.clip(((P[:, 0] + half_w) / CELL_M).astype(int), 0, gw - 1)
    gz = np.clip(((P[:, 2] + half_d) / CELL_M).astype(int), 0, gd - 1)
    floor_pts = np.abs(P[:, 1]) < 0.06
    obst_pts = (P[:, 1] > 0.10) & (P[:, 1] < 1.85)
    floor_cnt = np.zeros((gd, gw), np.int32)
    obst_cnt = np.zeros((gd, gw), np.int32)
    np.add.at(floor_cnt, (gz[floor_pts], gx[floor_pts]), 1)
    np.add.at(obst_cnt, (gz[obst_pts], gx[obst_pts]), 1)
    grid = np.full((gd, gw), 2, np.uint8)
    grid[floor_cnt >= 2] = 0
    grid[obst_cnt >= 4] = 1

    P_surf, C_surf, grid, floor_rgb_grid = _fill_floor_and_synthesize(
        P, C, cams, half_w, half_d, grid, floor_cnt, obst_cnt
    )

    outer_wall = (P[:, 1] > 0.7) & (P[:, 1] < 2.0) & (
        (np.abs(P[:, 0]) > half_w * 0.78) | (np.abs(P[:, 2]) > half_d * 0.78)
    )
    if np.count_nonzero(outer_wall) >= 50:
        wall_rgb = [int(round(v)) for v in np.median(C[outer_wall], axis=0)]
    else:
        wall_rgb = [224, 218, 208]

    # Kamera verilerini oda eksenine dönüştür (TSDF ve HD anahtar kareleri için)
    views_cam = []
    shift = np.array([cx, scale * floor_y, cz], dtype=np.float64)
    for vd in views_data:
        pose = np.asarray(vd["pose"], dtype=np.float64)
        cam_pos = scale * (R_tot @ pose[:3, 3]) - shift
        R_rdf2room = R_tot @ pose[:3, :3]
        pts_w = np.asarray(vd["pts3d"], dtype=np.float64)
        y_room = scale * (pts_w @ R_tot[1, :] - floor_y)
        views_cam.append(
            {
                "cam_pos": cam_pos,
                "R_rdf2room": R_rdf2room,
                "depth_m": np.asarray(vd["depth_z"], dtype=np.float64) * scale,
                "mask": np.asarray(vd["mask"], dtype=bool),
                "rgb": np.asarray(vd["rgb"], dtype=np.uint8),
                "rgb_hd": np.asarray(vd.get("rgb_hd", vd["rgb"]), dtype=np.uint8),
                "K": np.asarray(vd["K"], dtype=np.float64),
                "y_room": y_room,
                "ceil_cut": ceil_cut,
            }
        )

    # 1. Öncelik: Yüksek Keskinlikli Per-Scene 3D Gaussian Splatting (gsplat v6 -> SPZ v2)
    splat_spz_b64 = None
    splat_count = 0
    gs_sec = 0.0
    gs_error = None
    if enable_gs and len(views_cam) >= 4:
        try:
            from splat_trainer import train_room_splats

            gs_out = train_room_splats(
                P_init=P_surf,
                C_init=C_surf,
                views_cam=views_cam,
                half_w=half_w,
                half_d=half_d,
                ceil_cut=ceil_cut,
                n_real_pts=len(P),
                max_splats=155_000,
                num_steps=2600,
            )
            spz_bytes = pack_spz_v2(
                positions=gs_out["positions"],
                log_scales=gs_out["log_scales"],
                quats_wxyz=gs_out["quats_wxyz"],
                alphas=gs_out["alphas"],
                rgb=gs_out["rgb"],
                antialiased=True,
            )
            # Vercel 4.5 MB yanıt sınırı güvenliği: SPZ <= 2.65 MB (~3.53 MB base64)
            if len(spz_bytes) > 2_650_000:
                keep_n = max(40_000, int(len(gs_out["positions"]) * (2_450_000 / len(spz_bytes))))
                score = gs_out["alphas"] * np.power(
                    np.maximum(1e-9, np.exp(gs_out["log_scales"]).prod(axis=1)), 0.12
                )
                top_idx = np.argpartition(score, -keep_n)[-keep_n:]
                spz_bytes = pack_spz_v2(
                    positions=gs_out["positions"][top_idx],
                    log_scales=gs_out["log_scales"][top_idx],
                    quats_wxyz=gs_out["quats_wxyz"][top_idx],
                    alphas=gs_out["alphas"][top_idx],
                    rgb=gs_out["rgb"][top_idx],
                    antialiased=True,
                )
                splat_count = int(len(top_idx))
            else:
                splat_count = int(len(gs_out["positions"]))

            splat_spz_b64 = base64.b64encode(spz_bytes).decode("ascii")
            gs_sec = float(gs_out["gs_sec"])
            print(f"[postprocess] SPZ v2 paketlendi: {splat_count} splat, {len(spz_bytes)/1e6:.2f} MB", flush=True)
        except Exception as exc:
            gs_error = f"{type(exc).__name__}: {exc}"
            print(f"[postprocess] 3DGS atlandı, TSDF yedeğine dönülüyor: {gs_error}", flush=True)

    free_m2 = float(np.count_nonzero(grid == 0)) * CELL_M * CELL_M
    spawn_xz = _find_open_spawn_xz(grid, gw, gd, half_w, half_d)
    keyframes = _build_keyframes(views_cam, max_kf=10)

    mesh_payload = None
    vox = 0.0
    if splat_spz_b64 is not None:
        # 3DGS başarılı: ağır TSDF üçgenlerini göndermeye gerek yok, yanıt hızlı ve <3.5 MB kalır
        out_P = np.zeros((0, 3), dtype=np.float64)
        out_C = np.zeros((0, 3), dtype=np.uint8)
        faces_count = 0
    else:
        # Yedek: Katı TSDF + Surface Nets yüzeyini çıkar
        vox = float(np.clip(max(2.0 * half_w, 2.0 * half_d) / 150.0, 0.032, 0.052))
        verts, vert_colors, faces = None, None, None
        for _ in range(3):
            v_out, c_out, f_out = _extract_tsdf_surface(
                P_surf, C_surf, views_cam, grid, obst_cnt, half_w, half_d, ceil, vox
            )
            if v_out is None:
                break
            verts, vert_colors, faces = v_out, c_out, f_out
            if len(verts) <= 64_500 and len(faces) <= 135_000:
                break
            vox *= 1.25

        if verts is not None and faces is not None and len(verts) <= 65_535:
            out_P = verts
            out_C = vert_colors
            faces_count = int(len(faces))
            mesh_payload = {
                "faceCount": faces_count,
                "faces": _b64(faces.astype(np.uint16)),
            }
        else:
            faces_count = 0
            if len(P_surf) > 120_000:
                sel = rng.choice(len(P_surf), 120_000, replace=False)
                out_P, out_C = P_surf[sel], C_surf[sel]
            else:
                out_P, out_C = P_surf, C_surf

    q = np.clip(np.round(out_P * 1000.0), -32760, 32760).astype(np.int16)

    res = {
        "ok": True,
        "pointCount": int(len(out_P)),
        "points": _b64(q),
        "colors": _b64(out_C.astype(np.uint8)),
        "wallRgb": wall_rgb,
        "floorRgb": _b64(floor_rgb_grid.astype(np.uint8)),
        "bounds": {"halfW": float(half_w), "halfD": float(half_d), "ceilingM": float(ceil)},
        "grid": {"w": gw, "d": gd, "cell": CELL_M, "data": _b64(grid)},
        "spawnXZ": spawn_xz,
        "cameras": [[float(v) for v in cpos] for cpos in cams],
        "keyframes": keyframes,
        "stats": {
            "scaleFix": round(scale, 3),
            "cameraHeightM": round(float(np.median(cams[:, 1])), 2),
            "freeFloorM2": round(free_m2, 1),
            "meshFaces": faces_count,
            "meshVerts": int(len(out_P)),
            "voxelM": round(vox, 4),
            "splatCount": splat_count,
            "gsSec": gs_sec,
        },
    }
    if gs_error is not None:
        res["stats"]["gsFallback"] = gs_error[:180]
    if splat_spz_b64 is not None:
        res["splatSpz"] = splat_spz_b64
        res["splatCount"] = splat_count
    if mesh_payload is not None:
        res["mesh"] = mesh_payload
    return res
