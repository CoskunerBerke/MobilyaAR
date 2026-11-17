import fs from 'fs';
import path from 'path';

const ASSETS = [
  { id: 'sofa_03', out: 'ph-sofa-l.glb' },
  { id: 'Sofa_01', out: 'ph-sofa-modern.glb' },
  { id: 'sofa_02', out: 'ph-sofa-classic.glb' },
  { id: 'Ottoman_01', out: 'ph-ottoman.glb' },
  { id: 'modern_arm_chair_01', out: 'ph-armchair-modern.glb' },
  { id: 'mid_century_lounge_chair', out: 'ph-chair-lounge.glb' },
  { id: 'dining_table', out: 'ph-table-dining.glb' },
  { id: 'round_wooden_table_01', out: 'ph-table-round.glb' },
  { id: 'modern_coffee_table_01', out: 'ph-table-coffee.glb' },
  { id: 'dining_chair_02', out: 'ph-chair-dining.glb' },
];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadAndPackGLB(assetId, outFilename) {
  const metaRes = await fetch(`https://api.polyhaven.com/files/${assetId}`);
  const meta = await metaRes.json();
  // Use 2k gltf
  const gltfEntry = meta.gltf['2k']?.gltf || meta.gltf['1k']?.gltf;
  if (!gltfEntry) throw new Error(`No gltf for ${assetId}`);

  const gltfJsonBuf = await fetchBuffer(gltfEntry.url);
  const gltf = JSON.parse(gltfJsonBuf.toString('utf8'));
  const includeMap = gltfEntry.include;

  const chunks = [];
  let totalByteLength = 0;

  // 1. Load original binary buffer (.bin)
  const binUri = gltf.buffers[0].uri;
  const binUrl = includeMap[binUri]?.url;
  const mainBin = await fetchBuffer(binUrl);
  chunks.push(mainBin);
  totalByteLength += mainBin.length;

  // Pad to 4-byte boundary helper
  const pad4 = (len) => (4 - (len % 4)) % 4;
  const pad0 = pad4(mainBin.length);
  if (pad0 > 0) {
    chunks.push(Buffer.alloc(pad0));
    totalByteLength += pad0;
  }

  // 2. Embed all external images into bufferViews so we produce a single self-contained .glb
  if (gltf.images) {
    for (const img of gltf.images) {
      if (img.uri) {
        const imgEntry = includeMap[img.uri];
        if (!imgEntry) throw new Error(`Missing image ${img.uri} in ${assetId}`);
        const imgBuf = await fetchBuffer(imgEntry.url);
        const byteOffset = totalByteLength;
        const byteLength = imgBuf.length;

        gltf.bufferViews.push({
          buffer: 0,
          byteOffset,
          byteLength,
        });

        img.bufferView = gltf.bufferViews.length - 1;
        img.mimeType = img.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
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
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binPadded.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

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
    `Packed ${outFilename} (${(glb.length / (1024 * 1024)).toFixed(2)} MB) - Materials:`,
    (gltf.materials || []).map((m) => m.name)
  );
}

for (const a of ASSETS) {
  try {
    await downloadAndPackGLB(a.id, a.out);
  } catch (e) {
    console.error(`Error on ${a.id}:`, e.message);
  }
}
