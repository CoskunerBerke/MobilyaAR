import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const pad4 = (len) => (4 - (len % 4)) % 4;

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Given a Poly Haven diffuse buffer and ARM (R=AO, G=Roughness, B=Metallic) buffer,
 * bakes the real photogrammetry Ambient Occlusion (R channel of ARM) into the diffuse texture
 * with natural S-curve contrast and sharpening so cushions, seams, tufts, and wood grain
 * never look flat or washed-out in mobile AR or 3D viewers.
 */
async function bakePhotogrammetryAOIntoDiffuse(diffBuf, armBuf) {
  const diffMeta = await sharp(diffBuf).metadata();
  const w = diffMeta.width || 2048;
  const h = diffMeta.height || 2048;

  const diffRaw = await sharp(diffBuf)
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer();

  const armRaw = await sharp(armBuf)
    .resize(w, h)
    .removeAlpha()
    .raw()
    .toBuffer();

  const outRaw = Buffer.alloc(diffRaw.length);

  for (let i = 0; i < diffRaw.length; i += 3) {
    // Red channel of Poly Haven ARM texture is the baked photogrammetry Ambient Occlusion!
    const ao = armRaw[i] / 255.0;
    // Deepen creases & seams naturally while keeping lit surfaces true to color
    const aoFactor = Math.pow(ao, 0.82) * 0.76 + 0.24;

    for (let c = 0; c < 3; c++) {
      let v = (diffRaw[i + c] / 255.0) * aoFactor;
      // Subtle photographic S-curve for rich material depth
      v = v < 0.5 ? 2 * v * v * 0.22 + v * 0.78 : (1 - 2 * (1 - v) * (1 - v)) * 0.22 + v * 0.78;
      outRaw[i + c] = Math.min(255, Math.max(0, Math.round(v * 255)));
    }
  }

  return await sharp(outRaw, { raw: { width: w, height: h, channels: 3 } })
    .sharpen({ sigma: 0.9, m1: 1.0, m2: 1.8 })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

const POLYHAVEN_ASSETS = [
  { id: 'sofa_03', out: 'ph-sofa-l.glb' },
  { id: 'ArmChair_01', out: 'ph-sofa-classic.glb' },
  { id: 'modern_arm_chair_01', out: 'ph-armchair-modern.glb' },
  { id: 'mid_century_lounge_chair', out: 'ph-chair-lounge.glb' },
  { id: 'dining_chair_02', out: 'ph-chair-dining.glb' },
  { id: 'modern_coffee_table_02', out: 'ph-table-coffee.glb' },
  { id: 'round_wooden_table_01', out: 'ph-table-round.glb' },
  { id: 'modern_wooden_cabinet', out: 'ph-table-dining.glb' },
  { id: 'Ottoman_01', out: 'ph-ottoman.glb' },
];

async function downloadAndPackPolyHavenGLB(assetId, outFilename) {
  console.log(`[PolyHaven] Fetching ${assetId} -> ${outFilename}...`);
  const metaRes = await fetch(`https://api.polyhaven.com/files/${assetId}`);
  const meta = await metaRes.json();
  const gltfEntry = meta.gltf['2k']?.gltf || meta.gltf['1k']?.gltf;
  if (!gltfEntry) throw new Error(`No gltf for ${assetId}`);

  const gltfJsonBuf = await fetchBuffer(gltfEntry.url);
  const gltf = JSON.parse(gltfJsonBuf.toString('utf8'));
  const includeMap = gltfEntry.include;

  const chunks = [];
  let totalByteLength = 0;

  // 1. Load binary geometry buffer (.bin)
  const binUri = gltf.buffers[0].uri;
  const binUrl = includeMap[binUri]?.url;
  const mainBin = await fetchBuffer(binUrl);
  chunks.push(mainBin);
  totalByteLength += mainBin.length;

  const pad0 = pad4(mainBin.length);
  if (pad0 > 0) {
    chunks.push(Buffer.alloc(pad0));
    totalByteLength += pad0;
  }

  // First download all image buffers
  const rawImageBuffers = [];
  if (gltf.images) {
    for (const img of gltf.images) {
      if (img.uri) {
        const imgEntry = includeMap[img.uri];
        if (!imgEntry) throw new Error(`Missing image ${img.uri} in ${assetId}`);
        rawImageBuffers.push(await fetchBuffer(imgEntry.url));
      } else {
        rawImageBuffers.push(null);
      }
    }
  }

  // Link occlusionTexture on every material AND bake AO into baseColorTexture!
  if (Array.isArray(gltf.materials)) {
    for (const mat of gltf.materials) {
      mat.doubleSided = true;
      const pbr = mat.pbrMetallicRoughness;
      if (pbr && pbr.metallicRoughnessTexture !== undefined) {
        const mrTexIdx = pbr.metallicRoughnessTexture.index;
        // Link occlusionTexture to the ARM texture (Red channel = AO!)
        mat.occlusionTexture = {
          index: mrTexIdx,
          strength: 1.0,
        };

        if (mat.normalTexture) {
          mat.normalTexture.scale = 1.25;
        }

        // Also bake AO into baseColorTexture so AR viewers with strong direct light show deep cushion/wood creases
        if (pbr.baseColorTexture !== undefined) {
          const baseTexIdx = pbr.baseColorTexture.index;
          const baseImgIdx = gltf.textures?.[baseTexIdx]?.source;
          const mrImgIdx = gltf.textures?.[mrTexIdx]?.source;
          if (
            typeof baseImgIdx === 'number' &&
            typeof mrImgIdx === 'number' &&
            rawImageBuffers[baseImgIdx] &&
            rawImageBuffers[mrImgIdx]
          ) {
            try {
              rawImageBuffers[baseImgIdx] = await bakePhotogrammetryAOIntoDiffuse(
                rawImageBuffers[baseImgIdx],
                rawImageBuffers[mrImgIdx]
              );
            } catch (e) {
              console.warn(`Could not bake AO for ${mat.name}:`, e.message);
            }
          }
        }
      }
    }
  }

  // Pack all images into bufferViews
  if (gltf.images) {
    for (let i = 0; i < gltf.images.length; i++) {
      const img = gltf.images[i];
      const imgBuf = rawImageBuffers[i];
      if (imgBuf) {
        const byteOffset = totalByteLength;
        const byteLength = imgBuf.length;

        gltf.bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength,
        });

        img.bufferView = gltf.bufferViews.length - 1;
        img.mimeType =
          img.uri && img.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
        delete img.uri;

        chunks.push(imgBuf);
        totalByteLength += byteLength;
        const p = pad4(byteLength);
        if (p > 0) {
          chunks.push(Buffer.alloc(p));
          totalByteLength += p;
        }
      }
    }
  }

  delete gltf.buffers[0].uri;
  gltf.buffers[0].byteLength = totalByteLength;

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = pad4(jsonBuf.length);
  const jsonPadded =
    jsonPad > 0
      ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)])
      : jsonBuf;

  const binPadded = Buffer.concat(chunks);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  const glb = Buffer.concat([
    header,
    jsonChunkHeader,
    jsonPadded,
    binChunkHeader,
    binPadded,
  ]);

  const outPath = path.join('public', 'models', outFilename);
  fs.writeFileSync(outPath, glb);
  console.log(
    `[OK] Packed ${outFilename} (${(glb.length / (1024 * 1024)).toFixed(2)} MB) with Baked AO + Linked occlusionTexture`
  );
}

/**
 * Repairs Wayfair / Khronos high-poly showcase models (sofa-leather.glb, chair-modern.glb, chair-classic.glb):
 * 1. Converts any embedded WebP images (EXT_texture_webp) into standard high-res JPEG/PNG
 *    so iOS Quick Look USDZExporter and Three.js load all textures natively.
 * 2. Removes conflicting 1x1 occlusionTexture ONLY on materials that use KHR_texture_transform
 *    with scale > 1 (preventing iOS Quick Look USDZExporter from tiling the 1x1 shadow map into a checkerboard!).
 */
async function fixWayfairKhronosGlb(inFilename, outFilename) {
  const inPath = path.join('public', 'models', inFilename);
  if (!fs.existsSync(inPath)) return;

  const b = fs.readFileSync(inPath);
  const jsonLen = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binBuf = b.subarray(binStart);

  // Remove EXT_texture_webp extension requirement
  if (Array.isArray(gltf.extensionsUsed)) {
    gltf.extensionsUsed = gltf.extensionsUsed.filter(
      (x) => x !== 'EXT_texture_webp'
    );
  }
  if (Array.isArray(gltf.extensionsRequired)) {
    gltf.extensionsRequired = gltf.extensionsRequired.filter(
      (x) => x !== 'EXT_texture_webp'
    );
  }

  // Map textures that used EXT_texture_webp to standard texture.source
  if (Array.isArray(gltf.textures)) {
    for (const tex of gltf.textures) {
      if (tex.extensions?.EXT_texture_webp?.source !== undefined) {
        tex.source = tex.extensions.EXT_texture_webp.source;
        delete tex.extensions.EXT_texture_webp;
        if (Object.keys(tex.extensions).length === 0) {
          delete tex.extensions;
        }
      }
    }
  }

  // Prevent iOS Quick Look USDZExporter UV scale mismatch when KHR_texture_transform is used
  if (Array.isArray(gltf.materials)) {
    for (const mat of gltf.materials) {
      mat.doubleSided = true;
      const baseScale =
        mat.pbrMetallicRoughness?.baseColorTexture?.extensions
          ?.KHR_texture_transform?.scale;
      const normScale =
        mat.normalTexture?.extensions?.KHR_texture_transform?.scale;
      const hasTiledTransform =
        (baseScale && (baseScale[0] > 1 || baseScale[1] > 1)) ||
        (normScale && (normScale[0] > 1 || normScale[1] > 1));

      if (hasTiledTransform && mat.occlusionTexture) {
        // Remove conflicting 1x1 occlusionTexture so USDZExporter doesn't tile it 10x10 across the sofa/chair!
        delete mat.occlusionTexture;
      }
    }
  }

  // Rebuild binary buffer, converting any image/webp bufferViews to image/jpeg or image/png
  const imageBvIndices = new Map();
  if (Array.isArray(gltf.images)) {
    for (let i = 0; i < gltf.images.length; i++) {
      const img = gltf.images[i];
      if (typeof img.bufferView === 'number') {
        imageBvIndices.set(img.bufferView, { imgIndex: i, img });
      }
    }
  }

  const newChunks = [];
  let newOffset = 0;

  for (let bvIdx = 0; bvIdx < gltf.bufferViews.length; bvIdx++) {
    const bv = gltf.bufferViews[bvIdx];
    const slice = binBuf.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);

    if (imageBvIndices.has(bvIdx)) {
      const { img } = imageBvIndices.get(bvIdx);
      if (img.mimeType === 'image/webp') {
        const converted = await sharp(slice)
          .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
          .toBuffer();
        bv.byteOffset = newOffset;
        bv.byteLength = converted.length;
        img.mimeType = 'image/jpeg';
        newChunks.push(converted);
        newOffset += converted.length;
        const p = pad4(converted.length);
        if (p > 0) {
          newChunks.push(Buffer.alloc(p));
          newOffset += p;
        }
        continue;
      }
    }

    bv.byteOffset = newOffset;
    bv.byteLength = slice.length;
    newChunks.push(slice);
    newOffset += slice.length;
    const p = pad4(slice.length);
    if (p > 0) {
      newChunks.push(Buffer.alloc(p));
      newOffset += p;
    }
  }

  gltf.buffers[0].byteLength = newOffset;

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const jsonPad = pad4(jsonBuf.length);
  const jsonPadded =
    jsonPad > 0
      ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)])
      : jsonBuf;

  const binPadded = Buffer.concat(newChunks);
  const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4);

  const outGlb = Buffer.concat([
    header,
    jsonChunkHeader,
    jsonPadded,
    binChunkHeader,
    binPadded,
  ]);

  const outPath = path.join('public', 'models', outFilename);
  fs.writeFileSync(outPath, outGlb);
  console.log(
    `[OK] Fixed Wayfair/Khronos ${outFilename} (${(outGlb.length / (1024 * 1024)).toFixed(2)} MB)`
  );
}

// 1. Fix Wayfair / Khronos high-poly retail models and also save sofa-leather as ph-sofa-modern.glb!
await fixWayfairKhronosGlb('sofa-leather.glb', 'ph-sofa-modern.glb');
await fixWayfairKhronosGlb('chair-modern.glb', 'chair-modern.glb');
await fixWayfairKhronosGlb('chair-classic.glb', 'chair-classic.glb');

// 2. Re-pack all Poly Haven photogrammetry models with Baked AO + Linked occlusionTexture
for (const a of POLYHAVEN_ASSETS) {
  try {
    await downloadAndPackPolyHavenGLB(a.id, a.out);
  } catch (e) {
    console.error(`Error on ${a.id}:`, e.message);
  }
}
