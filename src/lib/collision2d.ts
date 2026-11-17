export interface OBB2D {
  id: string;
  x: number;
  z: number;
  rot: number;
  halfW: number;
  halfD: number;
}

export function getOBBAxes(rot: number): { ux: [number, number]; uz: [number, number] } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Three.js rotation.y = rot: lokal +X -> (cos, -sin), lokal +Z -> (sin, cos)
  return {
    ux: [c, -s],
    uz: [s, c],
  };
}

export function parseProductFootprintM(dimensionsCm: string): { halfW: number; halfD: number } {
  const nums = dimensionsCm.match(/\d+(?:[.,]\d+)?/g);
  if (nums && nums.length >= 2) {
    const w = parseFloat(nums[0].replace(',', '.')) / 100;
    const d = parseFloat(nums[1].replace(',', '.')) / 100;
    if (Number.isFinite(w) && Number.isFinite(d) && w > 0.08 && d > 0.08) {
      return {
        halfW: Math.min(2.8, Math.max(0.14, w * 0.5 - 0.01)),
        halfD: Math.min(2.8, Math.max(0.14, d * 0.5 - 0.01)),
      };
    }
  }
  return { halfW: 0.45, halfD: 0.45 };
}

export function getWorldAABBSpan(rot: number, halfW: number, halfD: number): { extX: number; extZ: number } {
  const ac = Math.abs(Math.cos(rot));
  const as = Math.abs(Math.sin(rot));
  return {
    extX: ac * halfW + as * halfD,
    extZ: as * halfW + ac * halfD,
  };
}

export function clampToRoomWalls(
  x: number,
  z: number,
  rot: number,
  halfW: number,
  halfD: number,
  roomW: number,
  roomD: number,
  wallGap = 0.015
): { x: number; z: number; clamped: boolean } {
  const { extX, extZ } = getWorldAABBSpan(rot, halfW, halfD);
  const maxX = Math.max(0, roomW * 0.5 - extX - wallGap);
  const maxZ = Math.max(0, roomD * 0.5 - extZ - wallGap);
  const nx = Math.min(maxX, Math.max(-maxX, x));
  const nz = Math.min(maxZ, Math.max(-maxZ, z));
  return {
    x: nx,
    z: nz,
    clamped: Math.abs(nx - x) > 1e-4 || Math.abs(nz - z) > 1e-4,
  };
}

export function fitsInsideWalls(
  x: number,
  z: number,
  rot: number,
  halfW: number,
  halfD: number,
  roomW: number,
  roomD: number,
  wallGap = 0.01
): boolean {
  const { extX, extZ } = getWorldAABBSpan(rot, halfW, halfD);
  if (extX * 2 + wallGap * 2 > roomW + 1e-4) return false;
  if (extZ * 2 + wallGap * 2 > roomD + 1e-4) return false;
  return (
    Math.abs(x) <= roomW * 0.5 - extX - wallGap + 2e-3 &&
    Math.abs(z) <= roomD * 0.5 - extZ - wallGap + 2e-3
  );
}

export function computeOBBOverlapMTV(
  a: OBB2D,
  b: OBB2D,
  gap = 0.008
): { mx: number; mz: number; overlap: number } | null {
  const axA = getOBBAxes(a.rot);
  const axB = getOBBAxes(b.rot);
  const axes: Array<[number, number]> = [axA.ux, axA.uz, axB.ux, axB.uz];

  const dx = a.x - b.x;
  const dz = a.z - b.z;

  let minOverlap = Infinity;
  let bestAxis: [number, number] = [1, 0];
  let bestSign = 1;

  for (const axis of axes) {
    const ux = axis[0];
    const uz = axis[1];
    const dist = dx * ux + dz * uz;
    const rA =
      a.halfW * Math.abs(axA.ux[0] * ux + axA.ux[1] * uz) +
      a.halfD * Math.abs(axA.uz[0] * ux + axA.uz[1] * uz);
    const rB =
      b.halfW * Math.abs(axB.ux[0] * ux + axB.ux[1] * uz) +
      b.halfD * Math.abs(axB.uz[0] * ux + axB.uz[1] * uz);

    const overlap = rA + rB + gap - Math.abs(dist);
    if (overlap <= 0) {
      return null;
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
      bestAxis = axis;
      if (Math.abs(dist) > 1e-6) {
        bestSign = dist > 0 ? 1 : -1;
      } else {
        bestSign = dx * ux + dz * uz >= 0 ? 1 : -1;
      }
    }
  }

  const push = minOverlap + 1e-4;
  return {
    mx: bestAxis[0] * bestSign * push,
    mz: bestAxis[1] * bestSign * push,
    overlap: minOverlap,
  };
}

export function hasAnyCollision(cand: OBB2D, others: OBB2D[], gap = 0.006): boolean {
  for (const o of others) {
    if (o.id === cand.id) continue;
    if (computeOBBOverlapMTV(cand, o, gap) !== null) {
      return true;
    }
  }
  return false;
}

function tryResolveAtPoint(
  id: string,
  tx: number,
  tz: number,
  rot: number,
  halfW: number,
  halfD: number,
  others: OBB2D[],
  roomW: number,
  roomD: number,
  maxIters = 6
): { ok: boolean; x: number; z: number; hadPush: boolean } {
  const c0 = clampToRoomWalls(tx, tz, rot, halfW, halfD, roomW, roomD);
  let x = c0.x;
  let z = c0.z;
  let hadPush = c0.clamped;

  for (let iter = 0; iter < maxIters; iter++) {
    let pushed = false;
    const cand: OBB2D = { id, x, z, rot, halfW, halfD };
    for (const o of others) {
      if (o.id === id) continue;
      const mtv = computeOBBOverlapMTV(cand, o, 0.008);
      if (mtv) {
        x += mtv.mx;
        z += mtv.mz;
        cand.x = x;
        cand.z = z;
        pushed = true;
        hadPush = true;
      }
    }
    const c1 = clampToRoomWalls(x, z, rot, halfW, halfD, roomW, roomD);
    x = c1.x;
    z = c1.z;
    if (c1.clamped) hadPush = true;
    if (!pushed) break;
  }

  const clean =
    fitsInsideWalls(x, z, rot, halfW, halfD, roomW, roomD, 0.008) &&
    !hasAnyCollision({ id, x, z, rot, halfW, halfD }, others, 0.004);
  return { ok: clean, x, z, hadPush };
}

export function resolveMoveOBB(
  prev: OBB2D,
  targetX: number,
  targetZ: number,
  others: OBB2D[],
  roomW: number,
  roomD: number
): { x: number; z: number; hitObstacle: boolean } {
  const startClamped = clampToRoomWalls(prev.x, prev.z, prev.rot, prev.halfW, prev.halfD, roomW, roomD);
  let bestX = startClamped.x;
  let bestZ = startClamped.z;
  let hitObstacle = startClamped.clamped;

  // Başlangıçta üst üste binme varsa önce en yakın temiz konuma çıkar
  if (hasAnyCollision({ id: prev.id, x: bestX, z: bestZ, rot: prev.rot, halfW: prev.halfW, halfD: prev.halfD }, others, 0.004)) {
    const fixed = tryResolveAtPoint(prev.id, bestX, bestZ, prev.rot, prev.halfW, prev.halfD, others, roomW, roomD, 8);
    if (fixed.ok) {
      bestX = fixed.x;
      bestZ = fixed.z;
    }
  }

  const totalDx = targetX - bestX;
  const totalDz = targetZ - bestZ;
  const dist = Math.hypot(totalDx, totalDz);
  if (dist < 1e-5) {
    return { x: bestX, z: bestZ, hitObstacle };
  }

  const stepSize = 0.05;
  const steps = Math.max(1, Math.min(80, Math.ceil(dist / stepSize)));
  const stepDx = totalDx / steps;
  const stepDz = totalDz / steps;
  const maxStepJump = Math.hypot(stepDx, stepDz) * 2.25 + 0.02;

  const acceptStep = (candX: number, candZ: number): boolean => {
    const res = tryResolveAtPoint(
      prev.id,
      candX,
      candZ,
      prev.rot,
      prev.halfW,
      prev.halfD,
      others,
      roomW,
      roomD,
      6
    );
    if (!res.ok) return false;
    const jump = Math.hypot(res.x - bestX, res.z - bestZ);
    if (jump > maxStepJump) return false;
    const prevDistSq = (targetX - bestX) ** 2 + (targetZ - bestZ) ** 2;
    const nextDistSq = (targetX - res.x) ** 2 + (targetZ - res.z) ** 2;
    if (nextDistSq >= prevDistSq - 1e-7) return false;
    bestX = res.x;
    bestZ = res.z;
    if (res.hadPush) hitObstacle = true;
    return true;
  };

  for (let s = 0; s < steps; s++) {
    if (acceptStep(bestX + stepDx, bestZ + stepDz)) {
      continue;
    }
    hitObstacle = true;
    const tryXFirst = Math.abs(stepDx) >= Math.abs(stepDz);
    const slid = tryXFirst
      ? (Math.abs(stepDx) > 1e-5 && acceptStep(bestX + stepDx, bestZ)) ||
        (Math.abs(stepDz) > 1e-5 && acceptStep(bestX, bestZ + stepDz))
      : (Math.abs(stepDz) > 1e-5 && acceptStep(bestX, bestZ + stepDz)) ||
        (Math.abs(stepDx) > 1e-5 && acceptStep(bestX + stepDx, bestZ));
    if (!slid) {
      break;
    }
  }

  return {
    x: bestX,
    z: bestZ,
    hitObstacle: hitObstacle || Math.hypot(bestX - targetX, bestZ - targetZ) > 0.015,
  };
}

export function resolveRotateOBB(
  item: OBB2D,
  nextRot: number,
  others: OBB2D[],
  roomW: number,
  roomD: number
): { ok: boolean; x: number; z: number; rot: number } {
  if (!fitsInsideWalls(0, 0, nextRot, item.halfW, item.halfD, roomW, roomD, 0.01)) {
    return { ok: false, x: item.x, z: item.z, rot: item.rot };
  }
  const res = tryResolveAtPoint(
    item.id,
    item.x,
    item.z,
    nextRot,
    item.halfW,
    item.halfD,
    others,
    roomW,
    roomD,
    8
  );
  if (res.ok && Math.hypot(res.x - item.x, res.z - item.z) <= 0.75) {
    return { ok: true, x: res.x, z: res.z, rot: nextRot };
  }
  return { ok: false, x: item.x, z: item.z, rot: item.rot };
}

export function findOpenSpawnPosition(
  halfW: number,
  halfD: number,
  preferredRot: number,
  others: OBB2D[],
  roomW: number,
  roomD: number,
  preferredXZ: [number, number] = [0, 0]
): { x: number; z: number; rot: number } | null {
  const rots = [preferredRot, preferredRot + Math.PI / 2, preferredRot + Math.PI / 4];

  // Önce tercih edilen merkez noktayı dene
  for (const r of rots) {
    const c0 = clampToRoomWalls(preferredXZ[0], preferredXZ[1], r, halfW, halfD, roomW, roomD, 0.02);
    if (
      fitsInsideWalls(c0.x, c0.z, r, halfW, halfD, roomW, roomD, 0.02) &&
      !hasAnyCollision({ id: '__spawn__', x: c0.x, z: c0.z, rot: r, halfW, halfD }, others, 0.06)
    ) {
      return { x: c0.x, z: c0.z, rot: r };
    }
  }

  // Izgara üzerinde en yakın boş noktayı bul (önce 6 cm, sonra sıkı 2 cm boşlukla)
  const step = 0.22;
  const maxX = Math.max(0, roomW * 0.5 - 0.12);
  const maxZ = Math.max(0, roomD * 0.5 - 0.12);
  const candidates: Array<{ x: number; z: number; d: number }> = [];
  for (let x = -maxX; x <= maxX + 1e-4; x += step) {
    for (let z = -maxZ; z <= maxZ + 1e-4; z += step) {
      candidates.push({ x, z, d: Math.hypot(x - preferredXZ[0], z - preferredXZ[1]) });
    }
  }
  candidates.sort((a, b) => a.d - b.d);

  for (const gap of [0.06, 0.02]) {
    for (const pt of candidates) {
      for (const r of rots) {
        const c = clampToRoomWalls(pt.x, pt.z, r, halfW, halfD, roomW, roomD, 0.02);
        if (
          fitsInsideWalls(c.x, c.z, r, halfW, halfD, roomW, roomD, 0.02) &&
          !hasAnyCollision({ id: '__spawn__', x: c.x, z: c.z, rot: r, halfW, halfD }, others, gap)
        ) {
          return { x: c.x, z: c.z, rot: r };
        }
      }
    }
  }

  return null;
}
