"""
Ham MapAnything nokta bulutunu tarayıcıda gösterilebilir, zemini y=0'a oturtulmuş, duvarları eksenlere
hizalanmış metrik bir oda paketine çevirir. Sadece numpy kullanır (yerelde test edilebilir).
"""

import base64

import numpy as np

VOXEL_M = 0.02
MAX_POINTS = 140_000
CELL_M = 0.10


def _b64(arr: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def _voxel_downsample(P, C, voxel):
    keys = np.floor(P / voxel).astype(np.int64)
    keys -= keys.min(axis=0)
    dims = keys.max(axis=0) + 1
    flat = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
    _, idx = np.unique(flat, return_index=True)
    return P[idx], C[idx]


def _rotation_from_to(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.9999:
        axis = np.array([1.0, 0.0, 0.0]) if abs(a[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
        axis = axis - a * np.dot(axis, a)
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def _fit_floor(P, up, rng):
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
    # en küçük kareler ile iyileştir
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


def _dominant_yaw(xz, rng):
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
    # Duvar sınırlarına olan mesafe (hücre cinsinden)
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


def build_room_payload(P: np.ndarray, C: np.ndarray, cam_poses: np.ndarray) -> dict:
    rng = np.random.default_rng(7)
    ok = np.isfinite(P).all(axis=1)
    P, C = P[ok].astype(np.float64), C[ok]
    if len(P) < 1000:
        return {"ok": False, "error": "Fotoğraflardan yeterli 3D nokta çıkarılamadı. Daha aydınlık ve örtüşen açılarla tekrar deneyin."}

    P, C = _voxel_downsample(P, C, VOXEL_M)

    # Kamera "yukarı" yönü: OpenCV'de kamera +Y aşağı bakar
    cam_R = cam_poses[:, :3, :3]
    cam_t = cam_poses[:, :3, 3]
    up = -cam_R[:, :, 1].mean(axis=0)
    up /= np.linalg.norm(up)

    n, d = _fit_floor(P, up, rng)
    if np.mean(cam_t @ n - d) < 0:
        n, d = -n, -d

    R = _rotation_from_to(n, np.array([0.0, 1.0, 0.0]))
    P = P @ R.T
    cams = cam_t @ R.T
    floor_y = d  # n·p = d düzlemi döndürüldükten sonra y = d olur
    P[:, 1] -= floor_y
    cams[:, 1] -= floor_y

    # Metrik ölçek kontrolü: telefon genelde yerden 0.8–2.2 m yükseklikte tutulur
    cam_h = float(np.median(cams[:, 1]))
    scale = 1.0
    if not (0.8 <= cam_h <= 2.2) and cam_h > 0.05:
        scale = 1.4 / cam_h
        P *= scale
        cams *= scale

    # Duvarları x/z eksenlerine hizala
    mid = P[(P[:, 1] > 0.3) & (P[:, 1] < 2.0)]
    yaw = _dominant_yaw(mid[:, [0, 2]], rng) if len(mid) > 200 else 0.0
    c, s = np.cos(yaw), np.sin(yaw)
    Ry = np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
    P = P @ Ry.T
    cams = cams @ Ry.T

    # Tavanı kes (yukarıdan bakınca oda içi görünsün), zemin altı gürültüyü at
    ceil = float(min(3.4, np.percentile(P[:, 1], 98)))
    keep = (P[:, 1] > -0.12) & (P[:, 1] < max(1.8, ceil - 0.12))
    P, C = P[keep], C[keep]

    # Oda sınırları ve merkezleme
    x0, x1 = np.percentile(P[:, 0], [1, 99])
    z0, z1 = np.percentile(P[:, 2], [1, 99])
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    P[:, 0] -= cx
    P[:, 2] -= cz
    cams[:, 0] -= cx
    cams[:, 2] -= cz
    half_w, half_d = (x1 - x0) / 2, (z1 - z0) / 2

    # Doluluk haritası: 0 = görülen boş zemin, 1 = eşya/duvar, 2 = bilinmiyor
    gw = max(1, int(np.ceil(2 * half_w / CELL_M)))
    gd = max(1, int(np.ceil(2 * half_d / CELL_M)))
    gx = np.clip(((P[:, 0] + half_w) / CELL_M).astype(int), 0, gw - 1)
    gz = np.clip(((P[:, 2] + half_d) / CELL_M).astype(int), 0, gd - 1)
    floor_pts = np.abs(P[:, 1]) < 0.05
    obst_pts = (P[:, 1] > 0.10) & (P[:, 1] < 1.8)
    floor_cnt = np.zeros((gd, gw), np.int32)
    obst_cnt = np.zeros((gd, gw), np.int32)
    np.add.at(floor_cnt, (gz[floor_pts], gx[floor_pts]), 1)
    np.add.at(obst_cnt, (gz[obst_pts], gx[obst_pts]), 1)
    grid = np.full((gd, gw), 2, np.uint8)
    grid[floor_cnt >= 2] = 0
    grid[obst_cnt >= 4] = 1

    if len(P) > MAX_POINTS:
        sel = rng.choice(len(P), MAX_POINTS, replace=False)
        P, C = P[sel], C[sel]

    q = np.clip(np.round(P * 1000.0), -32760, 32760).astype(np.int16)
    free_m2 = float(np.count_nonzero(grid == 0)) * CELL_M * CELL_M
    spawn_xz = _find_open_spawn_xz(grid, gw, gd, half_w, half_d)

    return {
        "ok": True,
        "pointCount": int(len(P)),
        "points": _b64(q),
        "colors": _b64(C.astype(np.uint8)),
        "bounds": {"halfW": float(half_w), "halfD": float(half_d), "ceilingM": float(ceil)},
        "grid": {"w": gw, "d": gd, "cell": CELL_M, "data": _b64(grid)},
        "spawnXZ": spawn_xz,
        "cameras": [[float(v) for v in cpos] for cpos in cams],
        "stats": {"scaleFix": round(scale, 3), "cameraHeightM": round(float(np.median(cams[:, 1])), 2), "freeFloorM2": round(free_m2, 1)},
    }
