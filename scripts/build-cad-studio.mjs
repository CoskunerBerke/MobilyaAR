import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';

const modelsDir = path.resolve('public/models');
const thumbsDir = path.resolve('public/ikea-thumbs');
fs.mkdirSync(modelsDir, { recursive: true });
fs.mkdirSync(thumbsDir, { recursive: true });

const io = new NodeIO();

// Deterministic PRNG for repeatable textures
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Builds albedo + tangent-space normal JPEG buffers from a procedural height/color generator. */
async function buildTexturePair(size, seed, genFn) {
  const rng = makeRng(seed);
  const albedo = Buffer.alloc(size * size * 3);
  const height = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const [r, g, b, h] = genFn(x / size, y / size, rng);
      albedo[idx * 3] = clamp255(r);
      albedo[idx * 3 + 1] = clamp255(g);
      albedo[idx * 3 + 2] = clamp255(b);
      height[idx] = h;
    }
  }

  const normal = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      const dx = (height[y * size + xp] - height[y * size + xm]) * 2.4;
      const dy = (height[yp * size + x] - height[ym * size + x]) * 2.4;
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const idx = (y * size + x) * 3;
      normal[idx] = clamp255((nx * 0.5 + 0.5) * 255);
      normal[idx + 1] = clamp255((ny * 0.5 + 0.5) * 255);
      normal[idx + 2] = clamp255((nz * 0.5 + 0.5) * 255);
    }
  }

  const albedoJpg = await sharp(albedo, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 91 })
    .toBuffer();
  const normalJpg = await sharp(normal, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { albedoJpg, normalJpg };
}

async function generateTextures() {
  const boucle = await buildTexturePair(512, 101, (u, v, rng) => {
    const warp = Math.sin(u * Math.PI * 110 + Math.sin(v * Math.PI * 44) * 1.4);
    const weft = Math.sin(v * Math.PI * 110 + Math.cos(u * Math.PI * 44) * 1.4);
    const nub = Math.sin(u * Math.PI * 36) * Math.cos(v * Math.PI * 36) * 0.5;
    const grain = (rng() - 0.5) * 0.35;
    const h = 0.5 + 0.18 * warp + 0.18 * weft + 0.14 * nub + grain * 0.35;
    // Neutral light base so runtime swatch tinting produces true rich upholstery hues
    const base = 232 + (h - 0.5) * 26;
    return [base, base - 2, base - 6, h];
  });

  const walnut = await buildTexturePair(512, 202, (u, v, rng) => {
    const grainWave = Math.sin(u * 42 + Math.sin(v * 7.5) * 2.3 + Math.cos(u * 14) * 0.8);
    const fine = Math.sin(u * 210 + v * 12) * 0.3;
    const pore = (rng() - 0.5) * 0.16;
    const t = 0.5 + 0.32 * grainWave + 0.12 * fine + pore;
    return [92 + t * 34, 58 + t * 24, 38 + t * 16, 0.5 + 0.18 * grainWave + pore];
  });

  const oak = await buildTexturePair(512, 303, (u, v, rng) => {
    const wave = Math.sin(u * 54 + Math.sin(v * 6.0) * 1.6);
    const fine = Math.sin(u * 190 + v * 8) * 0.25;
    const pore = (rng() - 0.5) * 0.12;
    const t = 0.5 + 0.28 * wave + 0.1 * fine + pore;
    return [194 + t * 24, 166 + t * 22, 126 + t * 18, 0.5 + 0.14 * wave + pore];
  });

  const marble = await buildTexturePair(512, 404, (u, v, rng) => {
    const strata = Math.sin(v * 18 + Math.sin(u * 9.5) * 1.8 + Math.cos(v * 6) * 0.9);
    const vein = Math.pow(Math.abs(Math.sin(v * 14 + u * 5 + Math.sin(u * 11) * 0.6)), 6);
    const pit = rng() > 0.965 ? -0.35 : (rng() - 0.5) * 0.08;
    const t = 0.5 + 0.22 * strata - 0.25 * vein + pit * 0.4;
    return [218 + t * 22, 206 + t * 20, 187 + t * 18, 0.5 + pit * 0.5 + 0.06 * strata];
  });

  return { boucle, walnut, oak, marble };
}

/** Creates an empty mesh accumulator helper. */
function makeMeshData() {
  return { pos: [], norm: [], uv: [], idx: [] };
}

function appendQuad(m, p0, p1, p2, p3, uv0, uv1, uv2, uv3) {
  const base = m.pos.length / 3;
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1];
  let ny = e1[2] * e2[0] - e1[0] * e2[2];
  let nz = e1[0] * e2[1] - e1[1] * e2[0];
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;

  const pts = [p0, p1, p2, p3];
  const uvs = [uv0, uv1, uv2, uv3];
  for (let i = 0; i < 4; i++) {
    m.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    m.norm.push(nx, ny, nz);
    m.uv.push(uvs[i][0], uvs[i][1]);
  }
  m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Recomputes smooth normals for indexed vertex buffers with shared vertices, or welded vertices. */
function appendSmoothSurfaceGrid(m, nu, nv, evalFn, closeU = false) {
  const base = m.pos.length / 3;
  const grid = [];
  for (let iv = 0; iv <= nv; iv++) {
    const v = iv / nv;
    for (let iu = 0; iu <= nu; iu++) {
      const u = iu / nu;
      const [px, py, pz, tu, tv] = evalFn(u, v);
      m.pos.push(px, py, pz);
      m.norm.push(0, 1, 0);
      m.uv.push(tu, tv);
      grid.push([px, py, pz]);
    }
  }

  const stride = nu + 1;
  const accum = new Float32Array(grid.length * 3);

  for (let iv = 0; iv < nv; iv++) {
    for (let iu = 0; iu < nu; iu++) {
      const a = iv * stride + iu;
      const b = a + 1;
      const c = (iv + 1) * stride + iu + 1;
      const d = (iv + 1) * stride + iu;

      for (const [i0, i1, i2] of [
        [a, b, c],
        [a, c, d],
      ]) {
        const p0 = grid[i0];
        const p1 = grid[i1];
        const p2 = grid[i2];
        const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
        const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        for (const vi of [i0, i1, i2]) {
          accum[vi * 3] += nx;
          accum[vi * 3 + 1] += ny;
          accum[vi * 3 + 2] += nz;
        }
        m.idx.push(base + i0, base + i1, base + i2);
      }
    }
  }

  if (closeU) {
    for (let iv = 0; iv <= nv; iv++) {
      const iStart = iv * stride;
      const iEnd = iv * stride + nu;
      for (let k = 0; k < 3; k++) {
        const s = accum[iStart * 3 + k] + accum[iEnd * 3 + k];
        accum[iStart * 3 + k] = s;
        accum[iEnd * 3 + k] = s;
      }
    }
  }

  for (let i = 0; i < grid.length; i++) {
    const nx = accum[i * 3];
    const ny = accum[i * 3 + 1];
    const nz = accum[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    m.norm[(base + i) * 3] = nx / nl;
    m.norm[(base + i) * 3 + 1] = ny / nl;
    m.norm[(base + i) * 3 + 2] = nz / nl;
  }
}

function rotPt(x, y, z, rx = 0, rz = 0) {
  if (rx) {
    const c = Math.cos(rx), s = Math.sin(rx);
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny;
    z = nz;
  }
  if (rz) {
    const c = Math.cos(rz), s = Math.sin(rz);
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx;
    y = ny;
  }
  return [x, y, z];
}

/**
 * Smooth superellipsoid cushion / rounded architectural panel (rounded corners + optional pillow crown).
 */
function addRoundedBox(m, { cx, cy, cz, sx, sy, sz, power = 6, crownY = 0, tiltX = 0, nu = 32, nv = 20, uvScale = 1.4 }) {
  const rx = sx / 2;
  const ry = sy / 2;
  const rz = sz / 2;
  const exp = 2 / power;
  const spow = (val, p) => Math.sign(val) * Math.pow(Math.abs(val), p);

  appendSmoothSurfaceGrid(
    m,
    nu,
    nv,
    (u, v) => {
      const theta = u * Math.PI * 2;
      const phi = (v - 0.5) * Math.PI;
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const ct = Math.cos(theta);
      const st = Math.sin(theta);

      let lx = rx * spow(cp * ct, exp);
      let ly = ry * spow(sp, exp);
      let lz = rz * spow(cp * st, exp);

      if (crownY && ly > 0) {
        const mask = Math.max(0, 1 - (lx / rx) ** 2) * Math.max(0, 1 - (lz / rz) ** 2);
        ly += crownY * mask * (ly / ry);
      }
      const [px, py, pz] = rotPt(lx, ly, lz, tiltX, 0);
      const tu = (lx * 0.7 + lz * 0.3) * uvScale + 0.5;
      const tv = (ly * 0.7 + lz * 0.3) * uvScale + 0.5;
      return [cx + px, cy + py, cz + pz, tu, tv];
    },
    true
  );
}

/** Revolved lathe geometry (for tapered legs, brass ferrules, cylinder feet). */
function addLathe(m, { cx, cy, cz, profile, radSegs = 24, rx = 0, rz = 0, uvScale = 2.0 }) {
  // profile is array of [radius, localY] bottom-to-top
  const nv = profile.length - 1;
  appendSmoothSurfaceGrid(
    m,
    radSegs,
    nv,
    (u, v) => {
      const idxF = v * nv;
      const i0 = Math.min(nv, Math.floor(idxF));
      const [r, ly] = profile[i0];
      const ang = u * Math.PI * 2;
      const lx = Math.cos(ang) * r;
      const lz = Math.sin(ang) * r;
      const [px, py, pz] = rotPt(lx, ly, lz, rx, rz);
      return [cx + px, cy + py, cz + pz, u * 2.0, ly * uvScale];
    },
    true
  );
}

/** 24-flute tambour pedestal cylinder with flat caps. */
function addFlutedDrum(m, { cx, y0, y1, cz, rBase, fluteCount = 24, fluteAmp = 0.008, radSegs = 96, ySegs = 8 }) {
  const h = y1 - y0;
  appendSmoothSurfaceGrid(
    m,
    radSegs,
    ySegs,
    (u, v) => {
      const ang = u * Math.PI * 2;
      const r = rBase + fluteAmp * Math.cos(fluteCount * ang);
      const lx = Math.cos(ang) * r;
      const lz = Math.sin(ang) * r;
      const ly = y0 + v * h;
      return [cx + lx, ly, cz + lz, u * 3.5, v * 1.2];
    },
    true
  );

  // Top & Bottom flat caps
  for (const isTop of [false, true]) {
    const yc = isTop ? y1 : y0;
    const ny = isTop ? 1 : -1;
    const cIdx = m.pos.length / 3;
    m.pos.push(cx, yc, cz);
    m.norm.push(0, ny, 0);
    m.uv.push(0.5, 0.5);
    for (let i = 0; i <= radSegs; i++) {
      const ang = (i / radSegs) * Math.PI * 2;
      const r = rBase + fluteAmp * Math.cos(fluteCount * ang);
      m.pos.push(cx + Math.cos(ang) * r, yc, cz + Math.sin(ang) * r);
      m.norm.push(0, ny, 0);
      m.uv.push(0.5 + 0.5 * Math.cos(ang), 0.5 + 0.5 * Math.sin(ang));
    }
    for (let i = 0; i < radSegs; i++) {
      if (isTop) {
        m.idx.push(cIdx, cIdx + 1 + i + 1, cIdx + 1 + i);
      } else {
        m.idx.push(cIdx, cIdx + 1 + i, cIdx + 1 + i + 1);
      }
    }
  }
}

/** Stadium/capsule-plan bullnose slab (for travertine table top). */
function addRoundedSlab(m, { cx, yBottom, yTop, cz, sx, sz, superPow = 4.2, nu = 72, nv = 12, uvScale = 0.85 }) {
  const hx = sx / 2;
  const hz = sz / 2;
  const midY = (yBottom + yTop) * 0.5;
  const halfT = (yTop - yBottom) * 0.5;
  const inset = Math.min(hx, hz) * 0.04;

  // Profile along V from bottom center -> outer bullnose edge -> top center
  appendSmoothSurfaceGrid(
    m,
    nu,
    nv,
    (u, v) => {
      const ang = u * Math.PI * 2;
      const ct = Math.cos(ang);
      const st = Math.sin(ang);
      const scalePlan = Math.pow(Math.pow(Math.abs(ct), superPow) + Math.pow(Math.abs(st), superPow), -1 / superPow);
      const pxUnit = ct * scalePlan;
      const pzUnit = st * scalePlan;

      let radialFrac;
      let ly;
      if (v <= 0.25) {
        const t = v / 0.25;
        radialFrac = t * (1 - inset / Math.min(hx, hz));
        ly = yBottom;
      } else if (v <= 0.75) {
        const bt = ((v - 0.25) / 0.5 - 0.5) * Math.PI;
        const rimFrac = 1 - inset / Math.min(hx, hz);
        radialFrac = rimFrac + (inset / Math.min(hx, hz)) * Math.cos(bt);
        ly = midY + halfT * Math.sin(bt);
      } else {
        const t = (v - 0.75) / 0.25;
        radialFrac = (1 - t) * (1 - inset / Math.min(hx, hz));
        ly = yTop;
      }

      const lx = pxUnit * hx * radialFrac;
      const lz = pzUnit * hz * radialFrac;
      return [cx + lx, ly, cz + lz, (lx / sx + 0.5) * uvScale, (lz / sz + 0.5) * uvScale];
    },
    true
  );
}

/** Crisp architectural beveled slat / panel box. */
function addCrispBox(m, cx, cy, cz, sx, sy, sz, uvScale = 1.6) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const x0 = cx - hx, x1 = cx + hx;
  const y0 = cy - hy, y1 = cy + hy;
  const z0 = cz - hz, z1 = cz + hz;
  // Front (+Z)
  appendQuad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0], [sx * uvScale, 0], [sx * uvScale, sy * uvScale], [0, sy * uvScale]);
  // Back (-Z)
  appendQuad(m, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0], [sx * uvScale, 0], [sx * uvScale, sy * uvScale], [0, sy * uvScale]);
  // Right (+X)
  appendQuad(m, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [0, 0], [sz * uvScale, 0], [sz * uvScale, sy * uvScale], [0, sy * uvScale]);
  // Left (-X)
  appendQuad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [0, 0], [sz * uvScale, 0], [sz * uvScale, sy * uvScale], [0, sy * uvScale]);
  // Top (+Y)
  appendQuad(m, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 0], [sx * uvScale, 0], [sx * uvScale, sz * uvScale], [0, sz * uvScale]);
  // Bottom (-Y)
  appendQuad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, 0], [sx * uvScale, 0], [sx * uvScale, sz * uvScale], [0, sz * uvScale]);
}

/** Shifts vertices across all mesh parts so minY = 0 and X/Z centered at 0, then scales uniformly if needed. */
function groundAndCenterParts(parts, targetWidthM = null) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const part of parts) {
    const p = part.mesh.pos;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < minX) minX = p[i];
      if (p[i] > maxX) maxX = p[i];
      if (p[i + 1] < minY) minY = p[i + 1];
      if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2];
      if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
  }

  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const scale = targetWidthM && maxX - minX > 1e-4 ? targetWidthM / (maxX - minX) : 1.0;

  for (const part of parts) {
    const p = part.mesh.pos;
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (p[i] - cx) * scale;
      p[i + 1] = (p[i + 1] - minY) * scale;
      p[i + 2] = (p[i + 2] - cz) * scale;
    }
  }

  return {
    w: (maxX - minX) * scale,
    h: (maxY - minY) * scale,
    d: (maxZ - minZ) * scale,
  };
}

/** Exports named multi-material meshes as binary glTF 2.0 (.glb). */
async function packMultiMaterialGlb(outPath, parts) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const texCache = new Map();

  const makeTex = (jpgBuf, name) => {
    const key = name;
    if (texCache.has(key)) return texCache.get(key);
    const t = doc.createTexture(name).setMimeType('image/jpeg').setImage(new Uint8Array(jpgBuf));
    texCache.set(key, t);
    return t;
  };

  for (const part of parts) {
    const mat = doc
      .createMaterial(part.matName)
      .setBaseColorFactor(part.baseColor || [1, 1, 1, 1])
      .setRoughnessFactor(part.roughness ?? 0.6)
      .setMetallicFactor(part.metallic ?? 0.0)
      .setDoubleSided(false);

    if (part.textures) {
      mat.setBaseColorTexture(makeTex(part.textures.albedoJpg, `${part.matName}_Albedo`));
      mat.setNormalTexture(makeTex(part.textures.normalJpg, `${part.matName}_Normal`));
      mat.setNormalScale(part.normalScale ?? 0.55);
    }

    const posAcc = doc.createAccessor(`${part.matName}_POS`).setType('VEC3').setArray(new Float32Array(part.mesh.pos)).setBuffer(buf);
    const normAcc = doc.createAccessor(`${part.matName}_NRM`).setType('VEC3').setArray(new Float32Array(part.mesh.norm)).setBuffer(buf);
    const uvAcc = doc.createAccessor(`${part.matName}_UV`).setType('VEC2').setArray(new Float32Array(part.mesh.uv)).setBuffer(buf);
    const idxAcc = doc.createAccessor(`${part.matName}_IDX`).setType('SCALAR').setArray(new Uint32Array(part.mesh.idx)).setBuffer(buf);

    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setAttribute('TEXCOORD_0', uvAcc)
      .setIndices(idxAcc)
      .setMaterial(mat);

    const mesh = doc.createMesh(part.matName).addPrimitive(prim);
    const node = doc.createNode(part.matName).setMesh(mesh);
    scene.addChild(node);
  }

  const bin = await io.writeBinary(doc);
  fs.writeFileSync(outPath, Buffer.from(bin));
  return bin.byteLength;
}

/** Builds clean isometric studio product thumbnail SVG rendered by sharp to JPEG. */
async function renderThumb(outPath, svgBody) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <defs>
      <radialGradient id="bg" cx="50%" cy="46%" r="55%">
        <stop offset="0%" stop-color="#fafaf9"/>
        <stop offset="100%" stop-color="#ecebe8"/>
      </radialGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="12"/>
      </filter>
    </defs>
    <rect width="800" height="800" fill="url(#bg)"/>
    ${svgBody}
  </svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(outPath, jpg);
}

const textures = await generateTextures();

// =========================================================================
// 1. MODA Bukle & Masif Ceviz 3'lü Koltuk (220 x 92 x 79 cm)
// =========================================================================
{
  const fabric = makeMeshData();
  const wood = makeMeshData();
  const metal = makeMeshData();

  // 4 Tapered splayed walnut legs + brushed brass ferrules sitting at y=0..0.155
  const legPos = [
    [-0.96, 0.34, 0.05, -0.04],
    [0.96, 0.34, -0.05, -0.04],
    [-0.96, -0.34, 0.05, 0.06],
    [0.96, -0.34, -0.05, 0.06],
  ];
  for (const [lx, lz, rz, rx] of legPos) {
    addLathe(metal, {
      cx: lx,
      cy: 0,
      cz: lz,
      rx,
      rz,
      profile: [
        [0.015, 0.0],
        [0.017, 0.036],
        [0.0, 0.036],
      ],
    });
    addLathe(wood, {
      cx: lx,
      cy: 0,
      cz: lz,
      rx,
      rz,
      profile: [
        [0.017, 0.036],
        [0.025, 0.165],
        [0.0, 0.165],
      ],
    });
  }

  // Center walnut support leg
  addLathe(wood, {
    cx: 0,
    cy: 0,
    cz: 0,
    profile: [
      [0.016, 0.0],
      [0.022, 0.155],
    ],
  });

  // Sculpted solid walnut apron plinth
  addRoundedBox(wood, { cx: 0, cy: 0.185, cz: 0, sx: 2.16, sy: 0.072, sz: 0.88, power: 10, nu: 36, nv: 16 });

  // Upholstered platform deck under cushions
  addRoundedBox(fabric, { cx: 0, cy: 0.23, cz: 0.01, sx: 2.02, sy: 0.05, sz: 0.82, power: 8, nu: 28, nv: 12 });

  // 2 Deep Plush Seat Cushions (0.93 x 0.21 x 0.78 m)
  addRoundedBox(fabric, { cx: -0.468, cy: 0.325, cz: 0.065, sx: 0.925, sy: 0.195, sz: 0.76, power: 4.5, crownY: 0.024, nu: 36, nv: 20 });
  addRoundedBox(fabric, { cx: 0.468, cy: 0.325, cz: 0.065, sx: 0.925, sy: 0.195, sz: 0.76, power: 4.5, crownY: 0.024, nu: 36, nv: 20 });

  // Sculpted Track Armrests (x = ±1.015 m)
  addRoundedBox(fabric, { cx: -1.015, cy: 0.42, cz: 0.0, sx: 0.17, sy: 0.42, sz: 0.90, power: 5.2, crownY: 0.012, nu: 28, nv: 18 });
  addRoundedBox(fabric, { cx: 1.015, cy: 0.42, cz: 0.0, sx: 0.17, sy: 0.42, sz: 0.90, power: 5.2, crownY: 0.012, nu: 28, nv: 18 });

  // Continuous reclined backrest shell + 2 plush back pillows
  addRoundedBox(fabric, { cx: 0, cy: 0.495, cz: -0.355, sx: 2.18, sy: 0.56, sz: 0.18, power: 5.5, tiltX: -0.1, nu: 36, nv: 18 });
  addRoundedBox(fabric, { cx: -0.465, cy: 0.575, cz: -0.225, sx: 0.91, sy: 0.41, sz: 0.21, power: 3.8, crownY: 0.028, tiltX: -0.18, nu: 32, nv: 18 });
  addRoundedBox(fabric, { cx: 0.465, cy: 0.575, cz: -0.225, sx: 0.91, sy: 0.41, sz: 0.21, power: 3.8, crownY: 0.028, tiltX: -0.18, nu: 32, nv: 18 });

  const parts = [
    { matName: 'CAD_Fabric', mesh: fabric, textures: textures.boucle, roughness: 0.92, metallic: 0.0, normalScale: 0.65 },
    { matName: 'CAD_Wood', mesh: wood, textures: textures.walnut, roughness: 0.42, metallic: 0.0, normalScale: 0.4 },
    { matName: 'CAD_Metal', mesh: metal, baseColor: [0.77, 0.63, 0.38, 1], roughness: 0.26, metallic: 0.92 },
  ];
  const dim = groundAndCenterParts(parts, 2.2);
  const bytes = await packMultiMaterialGlb(path.join(modelsDir, 'cad-moda-boucle-sofa.glb'), parts);
  await renderThumb(
    path.join(thumbsDir, 'cad-moda-boucle-sofa.jpg'),
    `<ellipse cx="400" cy="548" rx="280" ry="38" fill="#00000018" filter="url(#sh)"/>
     <g stroke="#27272a" stroke-opacity="0.18" stroke-width="2">
       <polygon points="155,505 170,505 162,555 147,555" fill="#6b442d"/>
       <rect x="147" y="542" width="15" height="14" rx="3" fill="#c7a563"/>
       <polygon points="630,505 645,505 653,555 638,555" fill="#6b442d"/>
       <rect x="638" y="542" width="15" height="14" rx="3" fill="#c7a563"/>
       <rect x="135" y="482" width="530" height="28" rx="8" fill="#6b442d"/>
       <rect x="145" y="295" width="510" height="190" rx="28" fill="#e2ddd4"/>
       <rect x="172" y="275" width="224" height="150" rx="28" fill="#efeae1"/>
       <rect x="404" y="275" width="224" height="150" rx="28" fill="#efeae1"/>
       <rect x="172" y="410" width="226" height="78" rx="22" fill="#f6f3ec"/>
       <rect x="402" y="410" width="226" height="78" rx="22" fill="#f6f3ec"/>
       <rect x="122" y="368" width="54" height="122" rx="18" fill="#ece7dd"/>
       <rect x="624" y="368" width="54" height="122" rx="18" fill="#ece7dd"/>
     </g>`
  );
  console.log(`[CAD OK] cad-moda-boucle-sofa.glb -> ${(bytes / 1024).toFixed(0)} KB | ${dim.w.toFixed(2)}W x ${dim.h.toFixed(2)}H x ${dim.d.toFixed(2)}D`);
}

// =========================================================================
// 2. PERA Traverten Mermer & Tambur Ceviz Sehpa (130 x 70 x 38 cm)
// =========================================================================
{
  const wood = makeMeshData();
  const marble = makeMeshData();
  const metal = makeMeshData();

  // Left & Right 24-flute tambour pedestals + brass base rings
  for (const cx of [-0.34, 0.34]) {
    addLathe(metal, {
      cx,
      cy: 0,
      cz: 0,
      radSegs: 48,
      profile: [
        [0.198, 0.0],
        [0.198, 0.012],
        [0.0, 0.012],
      ],
    });
    addFlutedDrum(wood, { cx, y0: 0.012, y1: 0.338, cz: 0, rBase: 0.192, fluteCount: 24, fluteAmp: 0.0085 });
  }

  // Sculpted walnut stretcher connecting both pedestals
  addRoundedBox(wood, { cx: 0, cy: 0.095, cz: 0, sx: 0.62, sy: 0.075, sz: 0.14, power: 6, nu: 24, nv: 12 });

  // Stadium bullnose natural travertine slab top (1.30 x 0.70 m, y = 0.338..0.380)
  addRoundedSlab(marble, { cx: 0, yBottom: 0.336, yTop: 0.38, cz: 0, sx: 1.3, sz: 0.7, superPow: 4.5, nu: 72, nv: 14 });

  const parts = [
    { matName: 'CAD_Marble', mesh: marble, textures: textures.marble, roughness: 0.24, metallic: 0.04, normalScale: 0.38 },
    { matName: 'CAD_Wood', mesh: wood, textures: textures.walnut, roughness: 0.42, metallic: 0.0, normalScale: 0.42 },
    { matName: 'CAD_Metal', mesh: metal, baseColor: [0.77, 0.63, 0.38, 1], roughness: 0.26, metallic: 0.92 },
  ];
  const dim = groundAndCenterParts(parts, 1.3);
  const bytes = await packMultiMaterialGlb(path.join(modelsDir, 'cad-pera-marble-coffee.glb'), parts);
  await renderThumb(
    path.join(thumbsDir, 'cad-pera-marble-coffee.jpg'),
    `<ellipse cx="400" cy="542" rx="255" ry="38" fill="#00000018" filter="url(#sh)"/>
     <g stroke="#27272a" stroke-opacity="0.16" stroke-width="2">
       <rect x="215" y="458" width="370" height="30" rx="8" fill="#5e3c28"/>
       <rect x="195" y="380" width="130" height="150" rx="20" fill="#6d4730"/>
       <rect x="475" y="380" width="130" height="150" rx="20" fill="#6d4730"/>
       <path d="M215 382 v145 M235 382 v145 M255 382 v145 M275 382 v145 M295 382 v145 M315 382 v145" stroke="#432a1c" stroke-width="2"/>
       <path d="M495 382 v145 M515 382 v145 M535 382 v145 M555 382 v145 M575 382 v145 M595 382 v145" stroke="#432a1c" stroke-width="2"/>
       <rect x="195" y="520" width="130" height="12" rx="6" fill="#c7a563"/>
       <rect x="475" y="520" width="130" height="12" rx="6" fill="#c7a563"/>
       <ellipse cx="400" cy="368" rx="286" ry="74" fill="#ebe3d5"/>
       <ellipse cx="400" cy="356" rx="284" ry="70" fill="#f5efe5"/>
     </g>`
  );
  console.log(`[CAD OK] cad-pera-marble-coffee.glb -> ${(bytes / 1024).toFixed(0)} KB | ${dim.w.toFixed(2)}W x ${dim.h.toFixed(2)}H x ${dim.d.toFixed(2)}D`);
}

// =========================================================================
// 3. ATELIER Çıtalı Meşe & Antrasit TV Konsolu (180 x 44 x 52 cm)
// =========================================================================
{
  const oak = makeMeshData();
  const anth = makeMeshData();
  const metal = makeMeshData();

  // 6 Anthracite tapered steel legs + brass leveling glides (y=0..0.155)
  for (const lx of [-0.82, 0.0, 0.82]) {
    for (const lz of [-0.16, 0.16]) {
      addLathe(metal, {
        cx: lx,
        cy: 0,
        cz: lz,
        profile: [
          [0.013, 0.0],
          [0.014, 0.022],
        ],
      });
      addLathe(anth, {
        cx: lx,
        cy: 0,
        cz: lz,
        profile: [
          [0.014, 0.022],
          [0.018, 0.158],
        ],
      });
    }
  }

  // Anthracite powder-coated bottom frame & recessed carcass
  addRoundedBox(anth, { cx: 0, cy: 0.17, cz: 0, sx: 1.78, sy: 0.036, sz: 0.43, power: 10, nu: 28, nv: 10 });
  addCrispBox(anth, 0, 0.34, -0.025, 1.76, 0.32, 0.38);
  // Anthracite inner shelf divider in open middle compartment
  addCrispBox(anth, 0, 0.34, 0.02, 0.56, 0.024, 0.39);
  // Warm Oak bevelled side cheeks & top surface cap
  addRoundedBox(oak, { cx: 0, cy: 0.502, cz: 0, sx: 1.8, sy: 0.036, sz: 0.44, power: 10, nu: 32, nv: 10 });
  addRoundedBox(oak, { cx: -0.882, cy: 0.338, cz: 0, sx: 0.036, sy: 0.335, sz: 0.44, power: 10, nu: 16, nv: 12 });
  addRoundedBox(oak, { cx: 0.882, cy: 0.338, cz: 0, sx: 0.036, sy: 0.335, sz: 0.44, power: 10, nu: 16, nv: 12 });

  // Left & Right Oak tambour slatted doors (15 sculpted vertical oak slats per side) + brass pulls
  for (const bayCx of [-0.57, 0.57]) {
    addCrispBox(anth, bayCx, 0.335, 0.195, 0.58, 0.295, 0.016);
    const slats = 15;
    for (let i = 0; i < slats; i++) {
      const sx = bayCx - 0.266 + (i / (slats - 1)) * 0.532;
      addRoundedBox(oak, { cx: sx, cy: 0.335, cz: 0.207, sx: 0.024, sy: 0.292, sz: 0.018, power: 5, nu: 12, nv: 8 });
    }
    const handleX = bayCx < 0 ? bayCx + 0.22 : bayCx - 0.22;
    addCrispBox(metal, handleX, 0.43, 0.221, 0.08, 0.012, 0.016);
  }

  const parts = [
    { matName: 'CAD_Oak', mesh: oak, textures: textures.oak, roughness: 0.46, metallic: 0.0, normalScale: 0.4 },
    { matName: 'CAD_Anthracite', mesh: anth, baseColor: [0.15, 0.16, 0.175, 1], roughness: 0.55, metallic: 0.15 },
    { matName: 'CAD_Metal', mesh: metal, baseColor: [0.77, 0.63, 0.38, 1], roughness: 0.26, metallic: 0.92 },
  ];
  const dim = groundAndCenterParts(parts, 1.8);
  const bytes = await packMultiMaterialGlb(path.join(modelsDir, 'cad-atelier-slat-tv.glb'), parts);
  await renderThumb(
    path.join(thumbsDir, 'cad-atelier-slat-tv.jpg'),
    `<ellipse cx="400" cy="560" rx="285" ry="26" fill="#00000018" filter="url(#sh)"/>
     <g stroke="#27272a" stroke-opacity="0.2" stroke-width="2">
       <rect x="148" y="485" width="14" height="68" fill="#27272a"/>
       <rect x="393" y="485" width="14" height="68" fill="#27272a"/>
       <rect x="638" y="485" width="14" height="68" fill="#27272a"/>
       <rect x="148" y="542" width="14" height="11" fill="#c7a563"/>
       <rect x="393" y="542" width="14" height="11" fill="#c7a563"/>
       <rect x="638" y="542" width="14" height="11" fill="#c7a563"/>
       <rect x="122" y="344" width="556" height="146" rx="8" fill="#25272b"/>
       <rect x="120" y="330" width="560" height="20" rx="5" fill="#d1b894"/>
       <rect x="135" y="356" width="176" height="122" rx="4" fill="#cfb48e"/>
       <rect x="489" y="356" width="176" height="122" rx="4" fill="#cfb48e"/>
       <rect x="319" y="412" width="162" height="12" fill="#3a3d42"/>
       <path d="M150 358 v118 M168 358 v118 M186 358 v118 M204 358 v118 M222 358 v118 M240 358 v118 M258 358 v118 M276 358 v118 M294 358 v118" stroke="#9d815c" stroke-width="2"/>
       <path d="M504 358 v118 M522 358 v118 M540 358 v118 M558 358 v118 M576 358 v118 M594 358 v118 M612 358 v118 M630 358 v118 M648 358 v118" stroke="#9d815c" stroke-width="2"/>
       <rect x="266" y="370" width="32" height="6" rx="2" fill="#c7a563"/>
       <rect x="502" y="370" width="32" height="6" rx="2" fill="#c7a563"/>
     </g>`
  );
  console.log(`[CAD OK] cad-atelier-slat-tv.glb -> ${(bytes / 1024).toFixed(0)} KB | ${dim.w.toFixed(2)}W x ${dim.h.toFixed(2)}H x ${dim.d.toFixed(2)}D`);
}
