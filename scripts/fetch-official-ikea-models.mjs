import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const IKEA_PRODUCTS = [
  {
    slug: 'ikea-kivik-sofa',
    name: 'IKEA KIVIK 3’lü Kanepe (Tibbleby Bej/Gri)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/49440597/PS01_S01_NV_01/simple/glb/425eeb77ad51566aef542fb96088050c-G-49440597-2419b65e9779b069b55501ea5ceb01bdd648c60a-simple.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/kivik-sofa-tibbleby-beige-gray__1577303_pe1033081_s5.jpg',
  },
  {
    slug: 'ikea-landskrona-sofa',
    name: 'IKEA LANDSKRONA 3’lü Kanepe (Gunnared Koyu Gri)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/59270311/PS01_S01_NV_01/simple/glb_draco/06fe80d3a92a4bfcbc91cbe123d736ec-G-59270311-1a901a5f9b18c84cbfdb910cd26cdaa7ef57a67d-simple.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/morabo-sofa-gunnared-dark-gray-wood__1576951_pe1032842_s5.jpg',
  },
  {
    slug: 'ikea-strandmon-chair',
    name: 'IKEA STRANDMON Kulaklı Berjer (Nordvalla Koyu Gri)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/20343224/PS01_S01_NV_01/simple/glb_draco/5539b15bb20d40698858dae8527b08ea-G-20343224-8954298e0269d0e20e9e09f0c172f8f981bf1ef7-simple.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/strandmon-wing-chair-nordvalla-dark-gray__0325432_pe517964_s5.jpg',
  },
  {
    slug: 'ikea-lisabo-table',
    name: 'IKEA LISABO Dişbudak Yemek Masası',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/70294339/PS01_S01_NV01/rqp3/glb/0715d3505b5f45dbb55c66cc4c65ae0c-70294339_PS01_S01_NV01_RQP3_4.0.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/lisabo-table-ash-veneer__0737105_pe740883_s5.jpg',
  },
  {
    slug: 'ikea-stockholm-coffee',
    name: 'IKEA STOCKHOLM Ceviz Orta Sehpa',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/70239710/PS01_S01_NV01/rqp3/glb/02a9f3eac99a48448655fefa967e6638-70239710_PS01_S01_NV01_RQP3_4.0.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/stockholm-coffee-table-walnut-veneer__0181245_pe332924_s5.jpg',
  },
  {
    slug: 'ikea-hemnes-tv',
    name: 'IKEA HEMNES TV Ünitesi (Açık Kahve / Beyaz)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/50413526/PS01_S01_NV01/simple/glb_draco/G-50413526-4c971121c69d03aa14aa2654f4990b565afa10d5_fcbbfc1a3a5e42698e565d6f7dc739ab.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/hemnes-tv-unit-white-stain-light-brown__0626265_pe692676_s5.jpg',
  },
  {
    slug: 'ikea-friheten-corner',
    name: 'IKEA FRIHETEN Köşe Yataklı L-Kanepe',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/39216754/PS01_S01_NV01/simple/glb_draco/G-39216754-f25e21c62bb42236a3c337e5b312c6e2e0af6675_32b57f91c53445e0b9e6460ba2f5593d.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/friheten-sleeper-sectional-3-seat-w-storage-skiftebo-dark-gray__0175610_pe328883_s5.jpg',
  },
  {
    slug: 'ikea-billy-bookcase',
    name: 'IKEA BILLY Kitaplık (Beyaz)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/00263850/PS01_S01_NV01/iqp3/glb_draco/781a5abd2974456789ad9b8a7277f752-00263850_PS01_S01_NV01_iqp3_v1.4.11.glb',
    thumbUrl:
      'https://www.ikea.com/gb/en/images/products/billy-bookcase-white__1590272_pe1038911_s5.jpg',
  },
  {
    slug: 'ikea-kallax-shelf',
    name: 'IKEA KALLAX 8 Bölmeli Raf Ünitesi (Ağartılmış Meşe)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/00324518/PS01_S01_NV01/iqp3/glb_draco/328c6b15930f4fdba75c388e69163353-00324518_PS01_S01_NV01_IQP3_2.0.glb',
    thumbUrl:
      'https://www.ikea.com/gb/en/images/products/kallax-shelving-unit-white-stained-oak-effect__0459250_pe606049_s5.jpg',
  },
  {
    slug: 'ikea-alex-desk',
    name: 'IKEA ALEX Çekmeceli Çalışma Masası (Beyaz)',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/80483438/PS01_S01_NV01/rqp3/glb_draco/69e6061c27f54f519c14907472c143cf-80483438_PS01_S01_NV01_RQP3_3.0.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/alex-desk-white__0977666_pe813729_s5.jpg',
  },
  {
    slug: 'ikea-odger-chair',
    name: 'IKEA ODGER Antrasit Sandalye',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/50457313/PS01_S01_NV01/iqp3/glb_draco/ecbb5b2dc34140acbac6593845e7f5a0-50457313_PS01_S01_NV01_iqp3_v1.4.11.glb',
    thumbUrl:
      'https://www.ikea.com/gb/en/images/products/odger-chair-anthracite__0739669_pe741828_s5.jpg',
  },
  {
    slug: 'ikea-brimnes-bed',
    name: 'IKEA BRIMNES Çekmeceli Çift Kişilik Karyola',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/29006940/PS01_S01_NV01/isp3/glb_draco/29006940_PS01_S01_NV01_ISP3_2.0_32a8153ccd384f4486ee34e3a6011cbc.glb',
    thumbUrl:
      'https://www.ikea.com/gb/en/images/products/brimnes-bed-frame-with-storage-white-luroey__1151024_pe884762_s5.jpg',
  },
  {
    slug: 'ikea-morabo-chaise',
    name: 'IKEA LANDSKRONA Uzanma Koltuklu L-Kanepe',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/geomagical/79270372/PS01_S01_NV_01/simple/glb_draco/7facc86532b549868e2664cf42ca4870-G-79270372-a85cb1d63b19aca87a2f72b28ba375dee24ad81d-simple+draco.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/morabo-sectional-4-seat-with-chaise-gunnared-dark-gray-metal__1576922_pe1032819_s5.jpg',
  },
  {
    slug: 'ikea-uppland-sofa',
    name: 'IKEA UPPLAND / EKTORP 3’lü Beyaz Kanepe',
    glbUrl:
      'https://web-api.ikea.com/dimma/assets/1.2/19384116/PS01_S01_NV01/isp3/glb_draco/19384116_PS01_S01_NV01_ISP3_2.0_d0e9b84105cb437f912058794571b78c.glb',
    thumbUrl:
      'https://www.ikea.com/us/en/images/products/uppland-sofa-blekinge-white__1578502_pe1034145_s5.jpg',
  },
];

const modelsDir = path.resolve('public/models');
const thumbsDir = path.resolve('public/ikea-thumbs');
fs.mkdirSync(modelsDir, { recursive: true });
fs.mkdirSync(thumbsDir, { recursive: true });

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

function computeWorldBounds(doc) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let totalVerts = 0;

  const visit = (node, parentMat) => {
    const m = node.getMatrix();
    // parentMat * m (column-major 4x4)
    const wm = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) {
          s += parentMat[k * 4 + row] * m[col * 4 + k];
        }
        wm[col * 4 + row] = s;
      }
    }

    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        totalVerts += pos.getCount();
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const wx = wm[0] * v[0] + wm[4] * v[1] + wm[8] * v[2] + wm[12];
          const wy = wm[1] * v[0] + wm[5] * v[1] + wm[9] * v[2] + wm[13];
          const wz = wm[2] * v[0] + wm[6] * v[1] + wm[10] * v[2] + wm[14];
          if (wx < minX) minX = wx;
          if (wy < minY) minY = wy;
          if (wz < minZ) minZ = wz;
          if (wx > maxX) maxX = wx;
          if (wy > maxY) maxY = wy;
          if (wz > maxZ) maxZ = wz;
        }
      }
    }
    for (const ch of node.listChildren()) {
      visit(ch, wm);
    }
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (scene) {
    for (const n of scene.listChildren()) visit(n, identity);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, totalVerts };
}

for (const item of IKEA_PRODUCTS) {
  const outPath = path.join(modelsDir, `${item.slug}.glb`);
  const thumbPath = path.join(thumbsDir, `${item.slug}.jpg`);

  if (fs.existsSync(outPath) && fs.existsSync(thumbPath)) {
    const existingDoc = await io.read(outPath);
    const b = computeWorldBounds(existingDoc);
    console.log(
      `[SKIP] ${item.slug}.glb -> bbox(m): ${(b.maxX - b.minX).toFixed(2)}W x ${(b.maxY - b.minY).toFixed(2)}H x ${(b.maxZ - b.minZ).toFixed(2)}D | minY=${b.minY.toFixed(4)}`
    );
    continue;
  }

  console.log(`\nFetching ${item.name}...`);
  const glbRes = await fetch(item.glbUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!glbRes.ok) throw new Error(`Failed GLB ${item.slug}: ${glbRes.status}`);
  const rawGlb = new Uint8Array(await glbRes.arrayBuffer());

  const doc = await io.readBinary(rawGlb);

  // Remove Draco/WebP extensions so output is 100% pure standard binary glTF 2.0
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (
      ext.extensionName === 'KHR_draco_mesh_compression' ||
      ext.extensionName === 'EXT_texture_webp'
    ) {
      ext.dispose();
    }
  }

  // Ensure all textures are standard JPEG/PNG (convert WebP if any)
  for (const tex of doc.getRoot().listTextures()) {
    const mime = tex.getMimeType();
    const imgBytes = tex.getImage();
    if (imgBytes && mime === 'image/webp') {
      const jpg = await sharp(Buffer.from(imgBytes))
        .jpeg({ quality: 93, chromaSubsampling: '4:4:4' })
        .toBuffer();
      tex.setImage(new Uint8Array(jpg));
      tex.setMimeType('image/jpeg');
    }
  }

  let b = computeWorldBounds(doc);
  if (Math.abs(b.minY) > 0.0002) {
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    if (scene) {
      for (const n of scene.listChildren()) {
        const t = n.getTranslation();
        n.setTranslation([t[0], t[1] - b.minY, t[2]]);
      }
      b = computeWorldBounds(doc);
    }
  }

  const outGlb = await io.writeBinary(doc);
  fs.writeFileSync(outPath, Buffer.from(outGlb));

  console.log(
    `[OK] ${item.slug}.glb -> ${(outGlb.byteLength / 1024 / 1024).toFixed(2)} MB | verts: ${b.totalVerts} | bbox(m): ${(b.maxX - b.minX).toFixed(2)}W x ${(b.maxY - b.minY).toFixed(2)}H x ${(b.maxZ - b.minZ).toFixed(2)}D | minY=${b.minY.toFixed(4)}`
  );

  // Download official IKEA studio thumbnail
  if (!fs.existsSync(thumbPath)) {
    try {
      const tRes = await fetch(item.thumbUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (tRes.ok) {
        const tBuf = Buffer.from(await tRes.arrayBuffer());
        const cleanThumb = await sharp(tBuf)
          .resize(800, 800, { fit: 'inside' })
          .jpeg({ quality: 90 })
          .toBuffer();
        fs.writeFileSync(thumbPath, cleanThumb);
      }
    } catch (e) {
      console.warn('Thumb warning:', e.message);
    }
  }
}
