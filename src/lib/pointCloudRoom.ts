import * as THREE from 'three';
import {
  getOBBAxes,
  hasAnyCollision,
  resolveMoveOBB,
  resolveRotateOBB,
  findOpenSpawnPosition,
  type OBB2D,
} from './collision2d';
import { decodeBase64Bytes } from './roomRendering';

export interface ScannedRoomPayload {
  ok: boolean;
  error?: string;
  pointCount: number;
  points: string; // base64 int16 mm xyz
  colors: string; // base64 uint8 rgb
  bounds: {
    halfW: number;
    halfD: number;
    ceilingM: number;
  };
  grid: {
    w: number;
    d: number;
    cell: number;
    data: string; // base64 uint8: 0 = free floor, 1 = obstacle/wall, 2 = unseen
  };
  spawnXZ?: [number, number];
  cameras: Array<[number, number, number]>;
  stats?: {
    scaleFix?: number;
    cameraHeightM?: number;
    freeFloorM2?: number;
    views?: number;
    inferSec?: number;
    totalSec?: number;
    model?: string;
    gpu?: string;
  };
}

export interface DecodedScannedRoom {
  pointCount: number;
  positions: Float32Array;
  colors: Float32Array;
  bounds: {
    halfW: number;
    halfD: number;
    ceilingM: number;
  };
  grid: {
    w: number;
    d: number;
    cell: number;
    cells: Uint8Array;
  };
  spawnXZ: [number, number];
  cameras: Array<[number, number, number]>;
  stats: NonNullable<ScannedRoomPayload['stats']>;
}

export function decodeScannedRoom(raw: ScannedRoomPayload): DecodedScannedRoom {
  const ptBytes = decodeBase64Bytes(raw.points);
  const colBytes = decodeBase64Bytes(raw.colors);
  const gridCells = decodeBase64Bytes(raw.grid.data);

  const int16 = new Int16Array(ptBytes.buffer, ptBytes.byteOffset, Math.floor(ptBytes.byteLength / 2));
  const count = Math.min(raw.pointCount, Math.floor(int16.length / 3), Math.floor(colBytes.length / 3));

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] = int16[o] * 0.001;
    positions[o + 1] = int16[o + 1] * 0.001;
    positions[o + 2] = int16[o + 2] * 0.001;

    c.setRGB(colBytes[o] / 255, colBytes[o + 1] / 255, colBytes[o + 2] / 255, THREE.SRGBColorSpace);
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
  }

  return {
    pointCount: count,
    positions,
    colors,
    bounds: raw.bounds,
    grid: {
      w: raw.grid.w,
      d: raw.grid.d,
      cell: raw.grid.cell,
      cells: gridCells,
    },
    spawnXZ: raw.spawnXZ && raw.spawnXZ.length >= 2 ? [raw.spawnXZ[0], raw.spawnXZ[1]] : [0, 0],
    cameras: raw.cameras || [],
    stats: raw.stats || {},
  };
}

function makeCircularSplatTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.96)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createRoomPointCloudObject(
  room: DecodedScannedRoom,
  pointSize = 0.042,
  clipPlane?: THREE.Plane
): { points: THREE.Points; material: THREE.PointsMaterial; dispose: () => void } {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(room.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(room.colors, 3));
  geo.computeBoundingSphere();

  const discTex = makeCircularSplatTexture();
  const material = new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: true,
    map: discTex,
    alphaTest: 0.35,
    sizeAttenuation: true,
    clippingPlanes: clipPlane ? [clipPlane] : [],
  });

  const points = new THREE.Points(geo, material);
  points.userData.isHelper = true;

  return {
    points,
    material,
    dispose: () => {
      geo.dispose();
      discTex.dispose();
      material.dispose();
    },
  };
}

export function createFreeFloorOverlayMesh(
  room: DecodedScannedRoom
): { mesh: THREE.Mesh; dispose: () => void } {
  const { w, d, cells } = room.grid;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = d;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(w, d);

  for (let i = 0; i < w * d; i++) {
    const val = cells[i] ?? 2;
    const o = i * 4;
    if (val === 0) {
      // Görülen boş zemin: şeffaf zümrüt yeşili
      imgData.data[o] = 16;
      imgData.data[o + 1] = 185;
      imgData.data[o + 2] = 129;
      imgData.data[o + 3] = 74;
    } else if (val === 1) {
      // Dolu alan (mevcut eşya / duvar): hafif mercan uyarısı
      imgData.data[o] = 239;
      imgData.data[o + 1] = 68;
      imgData.data[o + 2] = 68;
      imgData.data[o + 3] = 56;
    } else {
      imgData.data[o + 3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(room.bounds.halfW * 2, room.bounds.halfD * 2).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.004;
  mesh.userData.isHelper = true;

  return {
    mesh,
    dispose: () => {
      geo.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}

/** OBB ayak izi içinde gerçek taranmış eşya/duvar (`grid === 1`) veya oda sınırı dışı var mı? */
export function hitsScannedObstacle(obb: OBB2D, room: DecodedScannedRoom): boolean {
  const { ux, uz } = getOBBAxes(obb.rot);
  const { halfW: rwHalf, halfD: rdHalf } = room.bounds;
  const { w, d, cell, cells } = room.grid;
  const step = Math.max(0.06, Math.min(0.1, cell * 0.85));

  const nx = Math.max(2, Math.ceil((obb.halfW * 2) / step));
  const nz = Math.max(2, Math.ceil((obb.halfD * 2) / step));

  for (let ix = 0; ix <= nx; ix++) {
    const lx = -obb.halfW + (ix / nx) * (obb.halfW * 2);
    for (let iz = 0; iz <= nz; iz++) {
      const lz = -obb.halfD + (iz / nz) * (obb.halfD * 2);
      const wx = obb.x + lx * ux[0] + lz * uz[0];
      const wz = obb.z + lx * ux[1] + lz * uz[1];
      if (wx < -rwHalf + 0.01 || wx > rwHalf - 0.01 || wz < -rdHalf + 0.01 || wz > rdHalf - 0.01) {
        return true;
      }
      const gx = Math.floor((wx + rwHalf) / cell);
      const gz = Math.floor((wz + rdHalf) / cell);
      if (gx >= 0 && gx < w && gz >= 0 && gz < d) {
        if (cells[gz * w + gx] === 1) {
          return true;
        }
      }
    }
  }
  return false;
}

export function resolveMoveInScannedRoom(
  prev: OBB2D,
  targetX: number,
  targetZ: number,
  others: OBB2D[],
  room: DecodedScannedRoom
): { x: number; z: number; hitObstacle: boolean } {
  const roomW = room.bounds.halfW * 2;
  const roomD = room.bounds.halfD * 2;
  const obbRes = resolveMoveOBB(prev, targetX, targetZ, others, roomW, roomD);

  const canPlace = (x: number, z: number) => {
    const cand: OBB2D = { ...prev, x, z };
    return !hitsScannedObstacle(cand, room) && !hasAnyCollision(cand, others, 0.008);
  };

  if (canPlace(obbRes.x, obbRes.z)) {
    return obbRes;
  }

  // İkili arama ile en yakın engelden önceki temas noktasına yaklaş
  let lo = 0;
  let hi = 1;
  let bestX = prev.x;
  let bestZ = prev.z;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) * 0.5;
    const cx = prev.x + (obbRes.x - prev.x) * mid;
    const cz = prev.z + (obbRes.z - prev.z) * mid;
    if (canPlace(cx, cz)) {
      bestX = cx;
      bestZ = cz;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Engel boyunca tek eksende kayma
  if (Math.abs(obbRes.x - prev.x) > 0.002 && canPlace(obbRes.x, bestZ)) {
    return { x: obbRes.x, z: bestZ, hitObstacle: true };
  }
  if (Math.abs(obbRes.z - prev.z) > 0.002 && canPlace(bestX, obbRes.z)) {
    return { x: bestX, z: obbRes.z, hitObstacle: true };
  }

  return { x: bestX, z: bestZ, hitObstacle: true };
}

export function resolveRotateInScannedRoom(
  item: OBB2D,
  nextRot: number,
  others: OBB2D[],
  room: DecodedScannedRoom
): { ok: boolean; x: number; z: number; rot: number } {
  const roomW = room.bounds.halfW * 2;
  const roomD = room.bounds.halfD * 2;
  const rotFit = resolveRotateOBB(item, nextRot, others, roomW, roomD);
  if (!rotFit.ok) return rotFit;

  const nudges: Array<[number, number]> = [
    [0, 0],
    [0.12, 0],
    [-0.12, 0],
    [0, 0.12],
    [0, -0.12],
    [0.24, 0],
    [-0.24, 0],
    [0, 0.24],
    [0, -0.24],
  ];

  for (const [nx, nz] of nudges) {
    const cand: OBB2D = { ...item, x: rotFit.x + nx, z: rotFit.z + nz, rot: rotFit.rot };
    if (!hitsScannedObstacle(cand, room) && !hasAnyCollision(cand, others, 0.008)) {
      return { ok: true, x: cand.x, z: cand.z, rot: cand.rot };
    }
  }

  return { ok: false, x: item.x, z: item.z, rot: item.rot };
}

export function findOpenSpawnInScannedRoom(
  halfW: number,
  halfD: number,
  others: OBB2D[],
  room: DecodedScannedRoom,
  preferredXZ?: [number, number]
): { x: number; z: number; rot: number } | null {
  const start = preferredXZ || room.spawnXZ || [0, 0];
  const rots = [0, Math.PI / 2, Math.PI / 4];

  for (const rot of rots) {
    for (let r = 0; r <= 4.5; r += 0.22) {
      const steps = r === 0 ? 1 : 16;
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const candX = start[0] + Math.cos(ang) * r;
        const candZ = start[1] + Math.sin(ang) * r;
        const cand: OBB2D = { id: '__spawn__', x: candX, z: candZ, rot, halfW, halfD };
        if (!hitsScannedObstacle(cand, room) && !hasAnyCollision(cand, others, 0.02)) {
          return { x: candX, z: candZ, rot };
        }
      }
    }
  }

  return findOpenSpawnPosition(
    halfW,
    halfD,
    0,
    others,
    room.bounds.halfW * 2,
    room.bounds.halfD * 2,
    start
  );
}
