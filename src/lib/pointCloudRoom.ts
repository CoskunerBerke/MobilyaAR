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

export interface ScannedKeyframePayload {
  viewIdx: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  w2cR?: number[];
  w2cT?: number[];
  fovY: number;
  aspect: number;
  normK?: [number, number, number, number];
  ceilCut?: number;
  occW: number;
  occH: number;
  occK: [number, number, number, number];
  occDepthMm: string;
}

export interface DecodedKeyframe {
  viewIdx: number;
  pos: [number, number, number];
  quat: [number, number, number, number];
  w2cR?: number[];
  w2cT?: number[];
  fovY: number;
  aspect: number;
  normK?: [number, number, number, number];
  ceilCut?: number;
  occW: number;
  occH: number;
  occK: [number, number, number, number];
  occDepthMm: Uint16Array;
}

export interface ScannedRoomPayload {
  ok: boolean;
  error?: string;
  pointCount: number;
  points: string; // base64 int16 mm xyz
  colors: string; // base64 uint8 rgb
  wallRgb?: [number, number, number];
  floorRgb?: string; // base64 uint8 gd*gw*3
  mesh?: {
    faceCount: number;
    faces: string; // base64 uint16 triangle indices
  };
  keyframes?: ScannedKeyframePayload[];
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
    meshFaces?: number;
    meshVerts?: number;
    voxelM?: number;
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
  colors: Float32Array; // linear vertex colors (THREE.SRGBColorSpace -> linear)
  srgbColors: Float32Array; // raw 0..1 sRGB vertex colors for projective shader
  wallRgb: [number, number, number];
  floorRgb?: Uint8Array;
  mesh?: {
    faceCount: number;
    indices: Uint16Array;
  };
  keyframes: DecodedKeyframe[];
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
  const srgbColors = new Float32Array(count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] = int16[o] * 0.001;
    positions[o + 1] = int16[o + 1] * 0.001;
    positions[o + 2] = int16[o + 2] * 0.001;

    const r = colBytes[o] / 255;
    const g = colBytes[o + 1] / 255;
    const b = colBytes[o + 2] / 255;
    srgbColors[o] = r;
    srgbColors[o + 1] = g;
    srgbColors[o + 2] = b;

    c.setRGB(r, g, b, THREE.SRGBColorSpace);
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
  }

  let mesh: DecodedScannedRoom['mesh'];
  if (raw.mesh && raw.mesh.faceCount > 0 && raw.mesh.faces) {
    const faceBytes = decodeBase64Bytes(raw.mesh.faces);
    const u16 = new Uint16Array(faceBytes.buffer, faceBytes.byteOffset, Math.floor(faceBytes.byteLength / 2));
    const triLen = Math.min(raw.mesh.faceCount * 3, Math.floor(u16.length / 3) * 3);
    if (triLen >= 3) {
      mesh = {
        faceCount: Math.floor(triLen / 3),
        indices: u16.subarray(0, triLen),
      };
    }
  }

  const keyframes: DecodedKeyframe[] = [];
  for (const kf of raw.keyframes || []) {
    if (!kf.occDepthMm || !kf.occW || !kf.occH) continue;
    const occBytes = decodeBase64Bytes(kf.occDepthMm);
    const u16 = new Uint16Array(occBytes.buffer, occBytes.byteOffset, Math.floor(occBytes.byteLength / 2));
    keyframes.push({
      viewIdx: kf.viewIdx,
      pos: kf.pos,
      quat: kf.quat,
      w2cR: kf.w2cR,
      w2cT: kf.w2cT,
      fovY: kf.fovY,
      aspect: kf.aspect,
      normK: kf.normK,
      ceilCut: kf.ceilCut,
      occW: kf.occW,
      occH: kf.occH,
      occK: kf.occK,
      occDepthMm: u16,
    });
  }

  const wallRgb: [number, number, number] =
    raw.wallRgb && raw.wallRgb.length >= 3 ? [raw.wallRgb[0], raw.wallRgb[1], raw.wallRgb[2]] : [224, 218, 208];
  const floorRgb = raw.floorRgb ? decodeBase64Bytes(raw.floorRgb) : undefined;

  return {
    pointCount: count,
    positions,
    colors,
    srgbColors,
    wallRgb,
    floorRgb,
    mesh,
    keyframes,
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

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

async function createProjectiveAtlasMaterial(
  keyframes: DecodedKeyframe[],
  hdFrames: string[],
  clipPlane?: THREE.Plane
): Promise<{ material: THREE.ShaderMaterial; dispose: () => void } | null> {
  const candidates = keyframes.filter(
    (kf) => kf.w2cR?.length === 9 && kf.w2cT?.length === 3 && kf.normK?.length === 4 && Boolean(hdFrames[kf.viewIdx])
  );
  if (candidates.length === 0) return null;

  const loaded = await Promise.allSettled(candidates.slice(0, 8).map((kf) => loadImageElement(hdFrames[kf.viewIdx])));
  const pairs: Array<{ kf: DecodedKeyframe; img: HTMLImageElement }> = [];
  for (let i = 0; i < loaded.length; i++) {
    const r = loaded[i];
    if (r.status === 'fulfilled') {
      pairs.push({ kf: candidates[i], img: r.value });
    }
  }
  const count = pairs.length;
  if (count === 0) return null;

  const cols = 2;
  const rows = 4;
  const cellW = 768;
  const cellH = 768;
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = cols * cellW;
  atlasCanvas.height = rows * cellH;
  const ctx = atlasCanvas.getContext('2d');
  if (!ctx) return null;

  const dW = 160;
  const dH = 160;
  const depthBytes = new Uint8Array(cols * dW * rows * dH * 4);

  const mat3List: THREE.Matrix3[] = [];
  const vec3List: THREE.Vector3[] = [];
  const vec4List: THREE.Vector4[] = [];

  for (let i = 0; i < 8; i++) {
    if (i < count) {
      const { kf, img } = pairs[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH);

      for (let ry = 0; ry < dH; ry++) {
        const sy = Math.min(kf.occH - 1, Math.floor(((ry + 0.5) / dH) * kf.occH));
        for (let rx = 0; rx < dW; rx++) {
          const sx = Math.min(kf.occW - 1, Math.floor(((rx + 0.5) / dW) * kf.occW));
          const mm = kf.occDepthMm[sy * kf.occW + sx] ?? 0;
          const outIdx = ((row * dH + ry) * (cols * dW) + (col * dW + rx)) * 4;
          depthBytes[outIdx] = (mm >> 8) & 255;
          depthBytes[outIdx + 1] = mm & 255;
          depthBytes[outIdx + 3] = 255;
        }
      }

      const R = kf.w2cR!;
      const T = kf.w2cT!;
      const K = kf.normK!;
      mat3List.push(new THREE.Matrix3().set(R[0], R[1], R[2], R[3], R[4], R[5], R[6], R[7], R[8]));
      vec3List.push(new THREE.Vector3(T[0], T[1], T[2]));
      vec4List.push(new THREE.Vector4(K[0], K[1], K[2], K[3]));
    } else {
      mat3List.push(new THREE.Matrix3());
      vec3List.push(new THREE.Vector3());
      vec4List.push(new THREE.Vector4(1, 1, 0.5, 0.5));
    }
  }

  const colorTex = new THREE.CanvasTexture(atlasCanvas);
  colorTex.flipY = false;
  colorTex.colorSpace = THREE.NoColorSpace;
  colorTex.minFilter = THREE.LinearFilter;
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.generateMipmaps = false;
  colorTex.needsUpdate = true;

  const depthTex = new THREE.DataTexture(depthBytes, cols * dW, rows * dH, THREE.RGBAFormat, THREE.UnsignedByteType);
  depthTex.flipY = false;
  depthTex.minFilter = THREE.NearestFilter;
  depthTex.magFilter = THREE.NearestFilter;
  depthTex.generateMipmaps = false;
  depthTex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColorAtlas: { value: colorTex },
      uDepthAtlas: { value: depthTex },
      uKfCount: { value: count },
      uW2cR: { value: mat3List },
      uW2cT: { value: vec3List },
      uNormK: { value: vec4List },
    },
    vertexColors: true,
    side: THREE.DoubleSide,
    clipping: true,
    clippingPlanes: clipPlane ? [clipPlane] : [],
    toneMapped: false,
    vertexShader: /* glsl */ `
      #include <clipping_planes_pars_vertex>
      varying vec3 vWorldPos;
      varying vec3 vSrgbColor;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vSrgbColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <clipping_planes_pars_fragment>
      uniform sampler2D uColorAtlas;
      uniform sampler2D uDepthAtlas;
      uniform int uKfCount;
      uniform mat3 uW2cR[8];
      uniform vec3 uW2cT[8];
      uniform vec4 uNormK[8];
      varying vec3 vWorldPos;
      varying vec3 vSrgbColor;

      void main() {
        #include <clipping_planes_fragment>
        vec3 accCol = vec3(0.0);
        float accW = 0.0;

        for (int i = 0; i < 8; i++) {
          if (i >= uKfCount) break;
          vec3 pRdf = uW2cR[i] * vWorldPos + uW2cT[i];
          if (pRdf.z <= 0.20) continue;

          vec2 uv = vec2(
            uNormK[i].x * (pRdf.x / pRdf.z) + uNormK[i].z,
            uNormK[i].y * (pRdf.y / pRdf.z) + uNormK[i].w
          );
          if (uv.x <= 0.01 || uv.x >= 0.99 || uv.y <= 0.01 || uv.y >= 0.99) continue;

          float col = mod(float(i), 2.0);
          float row = floor(float(i) / 2.0);
          vec2 atlasUv = vec2(
            (col + clamp(uv.x, 0.003, 0.997)) * 0.5,
            (row + clamp(uv.y, 0.003, 0.997)) * 0.25
          );

          vec4 dp = texture2D(uDepthAtlas, atlasUv);
          float hiB = floor(dp.r * 255.0 + 0.5);
          float loB = floor(dp.g * 255.0 + 0.5);
          float dObs = (hiB * 256.0 + loB) * 0.001;
          if (dObs > 0.15 && pRdf.z > dObs + 0.16) continue;

          float feather =
            smoothstep(0.01, 0.10, uv.x) *
            smoothstep(0.99, 0.90, uv.x) *
            smoothstep(0.01, 0.10, uv.y) *
            smoothstep(0.99, 0.90, uv.y);
          float w = feather / (0.35 + pRdf.z * pRdf.z);
          accCol += w * texture2D(uColorAtlas, atlasUv).rgb;
          accW += w;
        }

        vec3 outSrgb = accW > 0.001
          ? mix(vSrgbColor, accCol / accW, clamp(accW * 6.0, 0.0, 1.0))
          : vSrgbColor;
        gl_FragColor = vec4(outSrgb, 1.0);
      }
    `,
  });

  return {
    material,
    dispose: () => {
      colorTex.dispose();
      depthTex.dispose();
      material.dispose();
    },
  };
}

function buildWatertightFloorGeometry(room: DecodedScannedRoom, useSrgb: boolean): THREE.BufferGeometry {
  const rw = room.bounds.halfW * 2;
  const rd = room.bounds.halfD * 2;
  const gw = Math.max(1, room.grid.w);
  const gd = Math.max(1, room.grid.d);
  const geo = new THREE.PlaneGeometry(rw, rd, gw, gd).rotateX(-Math.PI / 2);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const cols = new Float32Array(posAttr.count * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    let r = 0.76;
    let g = 0.73;
    let b = 0.69;
    if (room.floorRgb && room.floorRgb.length >= gw * gd * 3) {
      const gx = Math.min(gw - 1, Math.max(0, Math.floor(((x + room.bounds.halfW) / rw) * gw)));
      const gz = Math.min(gd - 1, Math.max(0, Math.floor(((z + room.bounds.halfD) / rd) * gd)));
      const idx = (gz * gw + gx) * 3;
      r = room.floorRgb[idx] / 255;
      g = room.floorRgb[idx + 1] / 255;
      b = room.floorRgb[idx + 2] / 255;
    }
    if (useSrgb) {
      cols[i * 3] = r;
      cols[i * 3 + 1] = g;
      cols[i * 3 + 2] = b;
    } else {
      tmpColor.setRGB(r, g, b, THREE.SRGBColorSpace);
      cols[i * 3] = tmpColor.r;
      cols[i * 3 + 1] = tmpColor.g;
      cols[i * 3 + 2] = tmpColor.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function addUniformVertexColors(geo: THREE.BufferGeometry, rgb: [number, number, number], useSrgb: boolean): void {
  const count = geo.getAttribute('position').count;
  const cols = new Float32Array(count * 3);
  const tmp = new THREE.Color();
  let r = (rgb[0] * 0.94) / 255;
  let g = (rgb[1] * 0.94) / 255;
  let b = (rgb[2] * 0.94) / 255;
  if (!useSrgb) {
    tmp.setRGB(r, g, b, THREE.SRGBColorSpace);
    r = tmp.r;
    g = tmp.g;
    b = tmp.b;
  }
  for (let i = 0; i < count; i++) {
    cols[i * 3] = r;
    cols[i * 3 + 1] = g;
    cols[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

export async function createScannedRoomSurfaceObject(
  room: DecodedScannedRoom,
  hdFrames: string[],
  clipPlane?: THREE.Plane
): Promise<{ object: THREE.Object3D; pointMat?: THREE.PointsMaterial; dispose: () => void }> {
  const disposeFns: Array<() => void> = [];
  const root = new THREE.Group();
  root.userData.isHelper = true;

  if (room.mesh && room.mesh.faceCount > 0 && room.mesh.indices.length >= 3) {
    const atlas = await createProjectiveAtlasMaterial(room.keyframes, hdFrames, clipPlane);
    const useSrgb = Boolean(atlas);

    let meshMat: THREE.Material;
    let wallMat: THREE.Material;
    if (atlas) {
      meshMat = atlas.material;
      const wm = atlas.material.clone();
      wm.side = THREE.FrontSide;
      wallMat = wm;
      disposeFns.push(atlas.dispose, () => wm.dispose());
    } else {
      const bm = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        clippingPlanes: clipPlane ? [clipPlane] : [],
      });
      const wm = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        toneMapped: false,
        clippingPlanes: clipPlane ? [clipPlane] : [],
      });
      meshMat = bm;
      wallMat = wm;
      disposeFns.push(
        () => bm.dispose(),
        () => wm.dispose()
      );
    }

    // 1. Sızdırmaz zemin tabanı (kamera yürüyüş boşlukları sıfır siyah delik)
    const floorBaseGeo = buildWatertightFloorGeometry(room, useSrgb);
    const floorBaseMesh = new THREE.Mesh(floorBaseGeo, meshMat);
    floorBaseMesh.position.y = -0.008;
    floorBaseMesh.userData.isHelper = true;
    root.add(floorBaseMesh);
    disposeFns.push(() => floorBaseGeo.dispose());

    // 2. İçeri bakan mimari çevre duvarları (FrontSide ile kameranın önündeki duvarlar otomatik gizlenir)
    const rw = room.bounds.halfW * 2;
    const rd = room.bounds.halfD * 2;
    const wallH = Math.min(2.65, Math.max(1.85, room.bounds.ceilingM - 0.12));
    const wallSpecs = [
      { w: rw, x: 0, z: -room.bounds.halfD, rotY: 0 },
      { w: rw, x: 0, z: room.bounds.halfD, rotY: Math.PI },
      { w: rd, x: -room.bounds.halfW, z: 0, rotY: Math.PI / 2 },
      { w: rd, x: room.bounds.halfW, z: 0, rotY: -Math.PI / 2 },
    ];
    for (const ws of wallSpecs) {
      const wGeo = new THREE.PlaneGeometry(ws.w, wallH);
      addUniformVertexColors(wGeo, room.wallRgb, useSrgb);
      const wMesh = new THREE.Mesh(wGeo, wallMat);
      wMesh.position.set(ws.x, wallH * 0.5 - 0.01, ws.z);
      wMesh.rotation.y = ws.rotY;
      wMesh.userData.isHelper = true;
      root.add(wMesh);
      disposeFns.push(() => wGeo.dispose());
    }

    // 3. Taranmış katı TSDF 3D oda yüzeyi
    const scanGeo = new THREE.BufferGeometry();
    scanGeo.setAttribute('position', new THREE.BufferAttribute(room.positions, 3));
    scanGeo.setAttribute('color', new THREE.BufferAttribute(useSrgb ? room.srgbColors : room.colors, 3));
    scanGeo.setIndex(new THREE.BufferAttribute(room.mesh.indices, 1));
    scanGeo.computeBoundingSphere();

    const scanMesh = new THREE.Mesh(scanGeo, meshMat);
    scanMesh.userData.isHelper = true;
    root.add(scanMesh);
    disposeFns.push(() => scanGeo.dispose());

    return {
      object: root,
      dispose: () => {
        disposeFns.forEach((fn) => fn());
      },
    };
  }

  const fallback = createRoomPointCloudObject(room, 0.042, clipPlane);
  return {
    object: fallback.points,
    pointMat: fallback.material,
    dispose: fallback.dispose,
  };
}

export function createKeyframeDepthOccluderMesh(
  kf: DecodedKeyframe,
  ceilingM = 2.75
): { mesh: THREE.Mesh; dispose: () => void } {
  const { occW: W, occH: H, occK, occDepthMm } = kf;
  const [fx, fy, cx, cy] = occK;
  const N = W * H;
  const pos = new Float32Array(N * 3);
  const depthM = new Float32Array(N);
  const worldY = new Float32Array(N);

  const [qx, qy, qz, qw] = kf.quat;
  const r10 = 2 * (qx * qy + qz * qw);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qx * qw);
  const py = kf.pos[1];
  const maxH = kf.ceilCut ?? Math.max(1.85, ceilingM - 0.1);

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      const d = (occDepthMm[i] ?? 0) * 0.001;
      depthM[i] = d;
      if (d > 0.15) {
        const xr = ((c - cx) * d) / fx;
        const yr = -((r - cy) * d) / fy;
        const zr = -d;
        pos[i * 3] = xr;
        pos[i * 3 + 1] = yr;
        pos[i * 3 + 2] = zr;
        worldY[i] = r10 * xr + r11 * yr + r12 * zr + py;
      }
    }
  }

  const idxList: number[] = [];
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const i00 = r * W + c;
      const i01 = i00 + 1;
      const i10 = i00 + W;
      const i11 = i10 + 1;
      const d00 = depthM[i00];
      const d01 = depthM[i01];
      const d10 = depthM[i10];
      const d11 = depthM[i11];
      if (d00 <= 0.15 || d01 <= 0.15 || d10 <= 0.15 || d11 <= 0.15) continue;
      if (
        worldY[i00] <= 0.1 ||
        worldY[i01] <= 0.1 ||
        worldY[i10] <= 0.1 ||
        worldY[i11] <= 0.1 ||
        worldY[i00] >= maxH ||
        worldY[i01] >= maxH ||
        worldY[i10] >= maxH ||
        worldY[i11] >= maxH
      ) {
        continue;
      }
      const dMin = Math.min(d00, d01, d10, d11);
      const dMax = Math.max(d00, d01, d10, d11);
      if (dMax - dMin >= 0.18) continue;
      idxList.push(i00, i10, i01, i01, i10, i11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idxList);
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(kf.pos[0], kf.pos[1], kf.pos[2]);
  mesh.quaternion.set(kf.quat[0], kf.quat[1], kf.quat[2], kf.quat[3]);
  mesh.renderOrder = -1;
  mesh.userData.isHelper = true;

  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
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
      imgData.data[o] = 16;
      imgData.data[o + 1] = 185;
      imgData.data[o + 2] = 129;
      imgData.data[o + 3] = 46;
    } else if (val === 1) {
      imgData.data[o] = 239;
      imgData.data[o + 1] = 68;
      imgData.data[o + 2] = 68;
      imgData.data[o + 3] = 38;
    } else {
      imgData.data[o + 3] = 0;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
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
