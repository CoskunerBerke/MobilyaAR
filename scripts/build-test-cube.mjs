// 50 x 50 x 50 cm ölçü test küpü (tabanı y=0'da, 1 birim = 1 metre)
import fs from 'fs';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';

const S = 0.5;
const h = S / 2;
const faces = [
  { n: [0, 0, 1], v: [[-h, 0, h], [h, 0, h], [h, S, h], [-h, S, h]] },
  { n: [0, 0, -1], v: [[h, 0, -h], [-h, 0, -h], [-h, S, -h], [h, S, -h]] },
  { n: [1, 0, 0], v: [[h, 0, h], [h, 0, -h], [h, S, -h], [h, S, h]] },
  { n: [-1, 0, 0], v: [[-h, 0, -h], [-h, 0, h], [-h, S, h], [-h, S, -h]] },
  { n: [0, 1, 0], v: [[-h, S, h], [h, S, h], [h, S, -h], [-h, S, -h]] },
  { n: [0, -1, 0], v: [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]] },
];
const pos = [], nor = [], uv = [], idx = [];
for (const f of faces) {
  const b = pos.length / 3;
  f.v.forEach((p, i) => {
    pos.push(...p);
    nor.push(...f.n);
    uv.push(...[[0, 1], [1, 1], [1, 0], [0, 0]][i]);
  });
  idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
}

// 10 cm'lik kareler (5x5) + kenar çizgisi
const T = 500;
const raw = Buffer.alloc(T * T * 3);
for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
  const i = (y * T + x) * 3;
  const edge = x < 6 || y < 6 || x > T - 7 || y > T - 7;
  const c = ((Math.floor(x / 100) + Math.floor(y / 100)) % 2 === 0);
  const v = edge ? 20 : c ? 235 : 200;
  raw[i] = v; raw[i + 1] = edge ? 20 : c ? 120 : 90; raw[i + 2] = edge ? 20 : c ? 40 : 30;
}
const jpg = await sharp(raw, { raw: { width: T, height: T, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();

const doc = new Document();
const buf = doc.createBuffer();
const tex = doc.createTexture('checker').setImage(new Uint8Array(jpg)).setMimeType('image/jpeg');
const mat = doc.createMaterial('cube').setBaseColorTexture(tex).setRoughnessFactor(0.8).setMetallicFactor(0);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf))
  .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
  .setMaterial(mat);
const mesh = doc.createMesh('cube').addPrimitive(prim);
doc.createScene().addChild(doc.createNode('cube').setMesh(mesh));
const glb = await new NodeIO().writeBinary(doc);
fs.writeFileSync('public/models/test-cube-50.glb', Buffer.from(glb));
console.log('test-cube-50.glb', glb.byteLength, 'bytes');
