import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const pad4 = (n) => (4 - (n % 4)) % 4;

/**
 * Packs a glTF 2.0 scene (positions, normals, uvs, indices, JPEG texture, PBR factors) into a valid .glb binary.
 */
function buildSingleMeshGlb({
  positions,
  normals,
  uvs,
  indices,
  jpegBuffer,
  roughnessFactor = 0.25,
  metallicFactor = 0.1,
  name = 'ParametricAsset',
}) {
  const posArr = new Float32Array(positions);
  const normArr = new Float32Array(normals);
  const uvArr = new Float32Array(uvs);
  const idxArr = new Uint32Array(indices);

  // Compute min/max for POSITION accessor (strictly required by glTF 2.0 & iOS Quick Look!)
  const minPos = [Infinity, Infinity, Infinity];
  const maxPos = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posArr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (posArr[i + k] < minPos[k]) minPos[k] = posArr[i + k];
      if (posArr[i + k] > maxPos[k]) maxPos[k] = posArr[i + k];
    }
  }

  const chunks = [];
  const bufferViews = [];
  let offset = 0;

  function pushBuffer(buf, target) {
    const p = pad4(offset);
    if (p > 0) {
      chunks.push(Buffer.alloc(p));
      offset += p;
    }
    const bv = { buffer: 0, byteOffset: offset, byteLength: buf.length };
    if (target) bv.target = target;
    bufferViews.push(bv);
    chunks.push(buf);
    offset += buf.length;
    return bufferViews.length - 1;
  }

  const posBv = pushBuffer(Buffer.from(posArr.buffer), 34962);
  const normBv = pushBuffer(Buffer.from(normArr.buffer), 34962);
  const uvBv = pushBuffer(Buffer.from(uvArr.buffer), 34962);
  const idxBv = pushBuffer(Buffer.from(idxArr.buffer), 34963);
  const imgBv = pushBuffer(jpegBuffer, undefined);

  const endPad = pad4(offset);
  if (endPad > 0) {
    chunks.push(Buffer.alloc(endPad));
    offset += endPad;
  }
  const binChunk = Buffer.concat(chunks);

  const gltf = {
    asset: { version: '2.0', generator: 'MekanAR Parametric CAD Builder' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [
      {
        name,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        name: `${name}_Mat`,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor,
          roughnessFactor,
        },
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ mimeType: 'image/jpeg', bufferView: imgBv }],
    accessors: [
      {
        bufferView: posBv,
        componentType: 5126,
        count: posArr.length / 3,
        type: 'VEC3',
        min: minPos,
        max: maxPos,
      },
      {
        bufferView: normBv,
        componentType: 5126,
        count: normArr.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: uvBv,
        componentType: 5126,
        count: uvArr.length / 2,
        type: 'VEC2',
      },
      {
        bufferView: idxBv,
        componentType: 5125,
        count: idxArr.length,
        type: 'SCALAR',
      },
    ],
    bufferViews,
    buffers: [{ byteLength: binChunk.length }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jp = pad4(jsonBuf.length);
  if (jp > 0) {
    jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jp, 0x20)]);
  }

  const totalLen = 12 + 8 + jsonBuf.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binChunk]);
}

function appendBox(geom, cx, cy, cz, sx, sy, sz, uvRect = [0, 0, 0.1, 0.1], frontUvRect = null) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;

  const faces = [
    // Front (+Z)
    {
      n: [0, 0, 1],
      v: [
        [-hx, -hy, hz],
        [hx, -hy, hz],
        [hx, hy, hz],
        [-hx, hy, hz],
      ],
      uv: frontUvRect || uvRect,
    },
    // Back (-Z)
    {
      n: [0, 0, -1],
      v: [
        [hx, -hy, -hz],
        [-hx, -hy, -hz],
        [-hx, hy, -hz],
        [hx, hy, -hz],
      ],
      uv: uvRect,
    },
    // Top (+Y)
    {
      n: [0, 1, 0],
      v: [
        [-hx, hy, hz],
        [hx, hy, hz],
        [hx, hy, -hz],
        [-hx, hy, -hz],
      ],
      uv: uvRect,
    },
    // Bottom (-Y)
    {
      n: [0, -1, 0],
      v: [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
      ],
      uv: uvRect,
    },
    // Right (+X)
    {
      n: [1, 0, 0],
      v: [
        [hx, -hy, hz],
        [hx, -hy, -hz],
        [hx, hy, -hz],
        [hx, hy, hz],
      ],
      uv: uvRect,
    },
    // Left (-X)
    {
      n: [-1, 0, 0],
      v: [
        [-hx, -hy, -hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
        [-hx, hy, -hz],
      ],
      uv: uvRect,
    },
  ];

  for (const f of faces) {
    const baseIdx = geom.positions.length / 3;
    const [u0, v0, u1, v1] = f.uv;
    const faceUvs = [
      [u0, v1],
      [u1, v1],
      [u1, v0],
      [u0, v0],
    ];
    for (let i = 0; i < 4; i++) {
      geom.positions.push(cx + f.v[i][0], cy + f.v[i][1], cz + f.v[i][2]);
      geom.normals.push(f.n[0], f.n[1], f.n[2]);
      geom.uvs.push(faceUvs[i][0], faceUvs[i][1]);
    }
    geom.indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
  }
}

async function buildSmartTv65() {
  // 65-inch 16:9 Ultra-Slim OLED TV: Width 1.44m, Screen Height 0.82m, Panel Depth 0.028m
  // Atlas layout (1024x1024):
  // Top 80% (y: 0..820) = OLED Glass Screen (subtle dark architectural Gallery Mode / ambient reflection)
  // Bottom 20% (y: 820..1024) = Dark Brushed Titanium Aluminum Chassis
  const W = 1024;
  const H = 1024;
  const raw = Buffer.alloc(W * H * 3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      if (y < 820) {
        const u = x / W;
        const v = y / 820;
        // Thin 6px black inner bezel
        if (x < 8 || x > W - 9 || y < 8 || y > 811) {
          raw[idx] = 10;
          raw[idx + 1] = 11;
          raw[idx + 2] = 13;
        } else {
          // Sleek dark OLED ambient glass with subtle diagonal architectural daylight sheen
          const diag = Math.exp(-Math.pow((u * 0.85 + v * 0.55 - 0.62) * 3.1, 2)) * 34;
          const warmGlow = Math.exp(-Math.pow((u - 0.35) * 2.4, 2) - Math.pow((v - 0.58) * 2.4, 2)) * 26;
          raw[idx] = Math.min(255, Math.round(14 + diag * 0.92 + warmGlow * 1.15));
          raw[idx + 1] = Math.min(255, Math.round(16 + diag * 0.96 + warmGlow * 0.95));
          raw[idx + 2] = Math.min(255, Math.round(21 + diag * 1.08 + warmGlow * 0.72));
        }
      } else {
        // Dark brushed titanium metal
        const brush = Math.sin(x * 0.7) * 3;
        raw[idx] = Math.round(28 + brush);
        raw[idx + 1] = Math.round(30 + brush);
        raw[idx + 2] = Math.round(33 + brush);
      }
    }
  }

  const jpg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 94 })
    .toBuffer();

  const geom = { positions: [], normals: [], uvs: [], indices: [] };
  const metalUv = [0.05, 0.85, 0.95, 0.98];
  const screenUv = [0.0, 0.0, 1.0, 0.8];

  // Minimal center pedestal base (y: 0..0.012m) + slim neck (y: 0.012..0.055m) + OLED panel (y: 0.055..0.875m)
  appendBox(geom, 0, 0.006, 0.02, 0.38, 0.012, 0.21, metalUv);
  appendBox(geom, 0, 0.035, -0.01, 0.12, 0.046, 0.035, metalUv);
  // Main 65" OLED Panel (1.44m x 0.82m x 0.018m)
  appendBox(geom, 0, 0.465, 0.0, 1.44, 0.82, 0.018, metalUv, screenUv);
  // Rear electronics housing (slim lower back box)
  appendBox(geom, 0, 0.31, -0.018, 0.86, 0.38, 0.02, metalUv);

  const glb = buildSingleMeshGlb({
    ...geom,
    jpegBuffer: jpg,
    roughnessFactor: 0.16,
    metallicFactor: 0.25,
    name: 'OLED_Smart_TV_65',
  });

  const outPath = path.resolve('public/models/smart-tv-65.glb');
  fs.writeFileSync(outPath, glb);
  console.log(`[OK] Built ${outPath} (${(glb.length / 1024).toFixed(1)} KB)`);
}

async function buildCeramicVase() {
  // Handcrafted Fluted Travertine/Ceramic Tabletop Vase: Height 0.34m, Max Diameter 0.21m
  const W = 512;
  const H = 512;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      const flute = Math.sin((x / W) * Math.PI * 36) * 9;
      const grain = Math.sin(x * 0.31 + y * 0.17) * 4 + Math.cos(y * 0.43) * 3;
      const vGrad = (1 - y / H) * 14;
      raw[idx] = Math.min(255, Math.max(0, Math.round(216 + flute + grain + vGrad)));
      raw[idx + 1] = Math.min(255, Math.max(0, Math.round(205 + flute + grain + vGrad)));
      raw[idx + 2] = Math.min(255, Math.max(0, Math.round(189 + flute + grain + vGrad)));
    }
  }
  const jpg = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();

  // Lathe profile (y from 0.00 to 0.34m)
  const profile = [
    [0.0, 0.0],
    [0.068, 0.0],
    [0.088, 0.04],
    [0.105, 0.11],
    [0.102, 0.19],
    [0.072, 0.26],
    [0.052, 0.30],
    [0.062, 0.34],
    [0.048, 0.34],
    [0.044, 0.29],
    [0.0, 0.28],
  ];

  const segs = 48;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let p = 0; p < profile.length; p++) {
    const [r, y] = profile[p];
    const prev = profile[Math.max(0, p - 1)];
    const next = profile[Math.min(profile.length - 1, p + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    let nr = dy;
    let ny = -dr;
    const len = Math.hypot(nr, ny) || 1;
    nr /= len;
    ny /= len;

    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const theta = u * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const fluteR = r > 0.03 && p < 8 ? r + Math.sin(theta * 24) * 0.0022 : r;

      positions.push(cos * fluteR, y, sin * fluteR);
      normals.push(cos * nr, ny, sin * nr);
      uvs.push(u, 1 - y / 0.34);
    }
  }

  const ringStride = segs + 1;
  for (let p = 0; p < profile.length - 1; p++) {
    for (let s = 0; s < segs; s++) {
      const a = p * ringStride + s;
      const b = a + 1;
      const c = (p + 1) * ringStride + s;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const glb = buildSingleMeshGlb({
    positions,
    normals,
    uvs,
    indices,
    jpegBuffer: jpg,
    roughnessFactor: 0.58,
    metallicFactor: 0.02,
    name: 'Travertine_Ceramic_Vase',
  });

  const outPath = path.resolve('public/models/ceramic-vase.glb');
  fs.writeFileSync(outPath, glb);
  console.log(`[OK] Built ${outPath} (${(glb.length / 1024).toFixed(1)} KB)`);
}

await buildSmartTv65();
await buildCeramicVase();
