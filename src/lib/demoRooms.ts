import type {
  ReconstructedCamera,
  ReconstructRoomResult,
  RoomAnalysis,
} from './server';

export interface DemoPhotoRoom {
  id: 'oak' | 'rug' | 'travertine';
  title: string;
  subtitle: string;
  imageUrl: string;
  width: number;
  height: number;
  vfovDeg: number;
  cameraHeightM: number;
  pitchDownDeg: number;
  defaultSpawn: { x: number; z: number; rot: number };
}

export const DEMO_PHOTO_ROOMS: DemoPhotoRoom[] = [
  {
    id: 'oak',
    title: 'Balıksırtı Meşe Salon',
    subtitle: 'Doğal gün ışığı · Geniş açık cephe',
    imageUrl: '/rooms/room-oak.jpg',
    width: 1376,
    height: 768,
    vfovDeg: 46,
    cameraHeightM: 1.2,
    pitchDownDeg: 2.6,
    defaultSpawn: { x: 0, z: -3.6, rot: 0 },
  },
  {
    id: 'rug',
    title: 'Ceviz & Dokuma Halılı Salon',
    subtitle: 'Klasik duvar çıtası · Akşam üstü ışığı',
    imageUrl: '/rooms/room-rug.jpg',
    width: 1376,
    height: 768,
    vfovDeg: 45,
    cameraHeightM: 1.26,
    pitchDownDeg: 4.5,
    defaultSpawn: { x: -0.1, z: -3.4, rot: 0.36 },
  },
  {
    id: 'travertine',
    title: 'Traverten Panoramik Salon',
    subtitle: 'Minimal beton · Bahçe manzaralı',
    imageUrl: '/rooms/room-travertine.jpg',
    width: 1376,
    height: 768,
    vfovDeg: 46,
    cameraHeightM: 1.32,
    pitchDownDeg: 3.8,
    defaultSpawn: { x: 0, z: -3.5, rot: 0 },
  },
];

let cachedUnobstructedDepthUrl: string | null = null;
function getUnobstructedDepthMap(): string {
  if (cachedUnobstructedDepthUrl) return cachedUnobstructedDepthUrl;
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2, 2);
  }
  cachedUnobstructedDepthUrl = c.toDataURL('image/png');
  return cachedUnobstructedDepthUrl;
}

export function buildCalibratedRoomAnalysis(params: {
  width: number;
  height: number;
  vfovDeg: number;
  cameraHeightM: number;
  pitchDownDeg: number;
}): RoomAnalysis {
  const { width, height, vfovDeg, cameraHeightM, pitchDownDeg } = params;
  const rad = (pitchDownDeg * Math.PI) / 180;
  const cosT = Math.cos(rad);
  const sinT = Math.sin(rad);
  const focalPx = height / 2 / Math.tan((vfovDeg * Math.PI) / 360);
  const hfovDeg = (2 * Math.atan(width / 2 / focalPx) * 180) / Math.PI;

  return {
    imageWidth: width,
    imageHeight: height,
    focalPx,
    vfovDeg,
    hfovDeg,
    cameraHeightM,
    pitchDownDeg,
    rollDeg: 0,
    cameraBasis: {
      right: [1, 0, 0],
      up: [0, cosT, -sinT],
      back: [0, sinT, cosT],
    },
    floorInlierRatio: 1,
    floorCoverage: 0.45,
    floorDepthMedianM: 3.2,
    scaleFactor: 1,
    erasableObjects: [],
    depthMap: getUnobstructedDepthMap(),
    depthMapWidth: 2,
    depthMapHeight: 2,
    elapsedMs: 12,
  };
}

export function buildClientPhotoAnalysis(
  width: number,
  height: number,
  exifFocal35mm?: number,
  pitchDownDeg?: number
): RoomAnalysis {
  const f35 = exifFocal35mm && Number.isFinite(exifFocal35mm) ? Math.min(85, Math.max(14, exifFocal35mm)) : 26;
  const focalPx = Math.hypot(width, height) * (f35 / 43.266615);
  const vfovDeg = (2 * Math.atan(height / 2 / focalPx) * 180) / Math.PI;
  const pitch = pitchDownDeg ?? (width >= height ? 13 : 17);
  return buildCalibratedRoomAnalysis({
    width,
    height,
    vfovDeg,
    cameraHeightM: 1.42,
    pitchDownDeg: pitch,
  });
}

export type DemoStudioPresetId = 'living' | 'bedroom' | 'grand';

export interface DemoStudioPresetInfo {
  id: DemoStudioPresetId;
  title: string;
  dimensionsLabel: string;
  subtitle: string;
}

export const DEMO_STUDIO_PRESETS: DemoStudioPresetInfo[] = [
  {
    id: 'living',
    title: 'Modern Salon',
    dimensionsLabel: '4.6 × 5.2 m • 2.70 m tavan',
    subtitle: 'Sıcak meşe parke ve geniş pencereli boş oda. Koltuk, sehpa ve TV ünitesini kendiniz yerleştirin.',
  },
  {
    id: 'bedroom',
    title: 'Yatak & Çalışma Odası',
    dimensionsLabel: '3.6 × 4.2 m • 2.65 m tavan',
    subtitle: 'Açık dişbudak parkeli kompakt boş oda planı. Karyola, masa ve kitaplığı çarpışmasız dizin.',
  },
  {
    id: 'grand',
    title: 'Geniş Salon',
    dimensionsLabel: '5.6 × 6.4 m • 2.80 m tavan',
    subtitle: 'L-kanepe ve yemek takımı kurguları için açık traverten/parke dokulu ferah boş salon.',
  },
];

export type FloorSurfaceKind = 'tile' | 'wood' | 'matte';

function renderDemoFloorTexture(opts: {
  plankRgb: [number, number, number];
  floorKind?: FloorSurfaceKind;
  rugColor?: string;
  rugBorder?: string;
  herringbone?: boolean;
}): string {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const [r, g, b] = opts.plankRgb;
  const kind = opts.floorKind || 'wood';

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, size, size);

  let seed = 17;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  if (kind === 'tile') {
    const tiles = 8;
    const step = size / tiles;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const shade = 0.97 + rand() * 0.06;
        ctx.fillStyle = `rgb(${Math.min(246, Math.round(r * shade))},${Math.min(246, Math.round(g * shade))},${Math.min(246, Math.round(b * shade))})`;
        ctx.fillRect(tx * step + 1, ty * step + 1, step - 2, step - 2);
      }
    }
    ctx.strokeStyle = 'rgba(90, 86, 80, 0.22)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= tiles; k++) {
      const p = Math.round(k * step);
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
    }
  } else if (kind === 'matte') {
    for (let i = 0; i < 650; i++) {
      const shade = 0.96 + rand() * 0.08;
      ctx.fillStyle = `rgba(${Math.min(246, Math.round(r * shade))},${Math.min(246, Math.round(g * shade))},${Math.min(246, Math.round(b * shade))},0.35)`;
      ctx.fillRect(rand() * size, rand() * size, 12 + rand() * 32, 8 + rand() * 24);
    }
  } else {
    // Parke tahta dokusu
    const stripH = 44;
    for (let y = 0; y < size; y += stripH) {
      const shade = 0.94 + rand() * 0.12;
      ctx.fillStyle = `rgb(${Math.min(245, Math.round(r * shade))},${Math.min(245, Math.round(g * shade))},${Math.min(245, Math.round(b * shade))})`;
      ctx.fillRect(0, y, size, stripH - 1);
      ctx.fillStyle = 'rgba(70, 52, 34, 0.14)';
      ctx.fillRect(0, y + stripH - 1, size, 1);

      const stepX = opts.herringbone ? 140 : 240;
      const offset = Math.round(((y / stripH) % 3) * (stepX * 0.35));
      for (let x = offset; x < size; x += stepX) {
        ctx.fillRect(x, y, 1, stripH);
      }
    }
  }

  // Orta dokuma halı
  if (opts.rugColor) {
    const padX = Math.round(size * 0.2);
    const padY = Math.round(size * 0.24);
    const rw = size - padX * 2;
    const rh = size - padY * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.16)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = opts.rugColor;
    ctx.fillRect(padX, padY, rw, rh);
    ctx.restore();

    ctx.strokeStyle = opts.rugBorder || 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 4;
    ctx.strokeRect(padX + 18, padY + 18, rw - 36, rh - 36);

    // İnce dokuma çizgileri
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let ry = padY + 8; ry < padY + rh - 8; ry += 6) {
      ctx.fillRect(padX + 6, ry, rw - 12, 1);
    }
  }

  return c.toDataURL('image/jpeg', 0.88);
}

export function buildCustomFloorTexture(floorKind: FloorSurfaceKind, rgb: [number, number, number]): string {
  return renderDemoFloorTexture({ plankRgb: rgb, floorKind });
}

function renderDemoWallTexture(opts: {
  paintRgb: [number, number, number];
  windowSpan?: [number, number];
  hasBalcony?: boolean;
}): string {
  const tw = 1024;
  const th = 512;
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d')!;
  const [r, g, b] = opts.paintRgb;

  const grad = ctx.createLinearGradient(0, 0, 0, th);
  grad.addColorStop(0, `rgb(${Math.min(248, r + 8)},${Math.min(248, g + 8)},${Math.min(248, b + 8)})`);
  grad.addColorStop(1, `rgb(${Math.max(30, r - 12)},${Math.max(30, g - 12)},${Math.max(30, b - 12)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, tw, th);

  // Sol ve sağ köşe ortam gölgesi
  const leftAo = ctx.createLinearGradient(0, 0, 64, 0);
  leftAo.addColorStop(0, 'rgba(0,0,0,0.09)');
  leftAo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = leftAo;
  ctx.fillRect(0, 0, 64, th);

  const rightAo = ctx.createLinearGradient(tw - 64, 0, tw, 0);
  rightAo.addColorStop(0, 'rgba(0,0,0,0)');
  rightAo.addColorStop(1, 'rgba(0,0,0,0.09)');
  ctx.fillStyle = rightAo;
  ctx.fillRect(tw - 64, 0, 64, th);

  // Kartonpiyer & süpürgelik
  ctx.fillStyle = `rgb(${Math.max(30, r - 10)},${Math.max(30, g - 10)},${Math.max(30, b - 10)})`;
  ctx.fillRect(0, 0, tw, 12);
  ctx.fillStyle = '#f3f2ee';
  ctx.fillRect(0, th - 18, tw, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, th - 19, tw, 2);

  if (opts.windowSpan) {
    const px0 = Math.round(opts.windowSpan[0] * tw);
    const px1 = Math.round(opts.windowSpan[1] * tw);
    const py0 = 62;
    const py1 = opts.hasBalcony ? th - 2 : 340;

    ctx.fillStyle = '#c8c5be';
    ctx.fillRect(px0 - 4, py0 - 4, px1 - px0 + 8, py1 - py0 + (opts.hasBalcony ? 4 : 8));
    ctx.fillStyle = '#f4f4f1';
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);

    const pad = 12;
    const sky = ctx.createLinearGradient(0, py0 + pad, 0, py1 - pad);
    sky.addColorStop(0, '#e3eef7');
    sky.addColorStop(1, '#f7f8f6');
    ctx.fillStyle = sky;
    ctx.fillRect(px0 + pad, py0 + pad, px1 - px0 - pad * 2, py1 - py0 - pad * 2);

    const mid = Math.round((px0 + px1) / 2);
    ctx.fillStyle = '#f4f4f1';
    ctx.fillRect(mid - 5, py0 + pad, 10, py1 - py0 - pad * 2);
  }

  return c.toDataURL('image/jpeg', 0.88);
}

export function buildDemoStudioRoom(presetId: DemoStudioPresetId): ReconstructRoomResult {
  if (presetId === 'bedroom') {
    return {
      ok: true,
      version: '6.0.0-demo',
      elapsedMs: 18,
      viewCount: 0,
      matchedViews: 0,
      roomWidthM: 3.6,
      roomDepthM: 4.2,
      ceilingHeightM: 2.65,
      floorTexture: renderDemoFloorTexture({
        plankRgb: [204, 189, 166],
      }),
      wallTextures: {
        north: renderDemoWallTexture({ paintRgb: [226, 224, 217] }),
        south: renderDemoWallTexture({ paintRgb: [222, 220, 213] }),
        west: renderDemoWallTexture({ paintRgb: [224, 222, 215], windowSpan: [0.22, 0.56] }),
        east: renderDemoWallTexture({ paintRgb: [225, 223, 216] }),
      },
      existingObjects: [],
      spawnXZ: [0, 0],
      cameras: [],
      lightDir: [-0.55, 0.78, 0.28],
    };
  }

  if (presetId === 'grand') {
    return {
      ok: true,
      version: '6.0.0-demo',
      elapsedMs: 20,
      viewCount: 0,
      matchedViews: 0,
      roomWidthM: 5.6,
      roomDepthM: 6.4,
      ceilingHeightM: 2.8,
      floorTexture: renderDemoFloorTexture({
        plankRgb: [210, 200, 185],
        floorKind: 'tile',
      }),
      wallTextures: {
        north: renderDemoWallTexture({ paintRgb: [224, 221, 214] }),
        south: renderDemoWallTexture({ paintRgb: [220, 217, 210] }),
        west: renderDemoWallTexture({ paintRgb: [222, 219, 212] }),
        east: renderDemoWallTexture({ paintRgb: [223, 220, 213], windowSpan: [0.14, 0.86], hasBalcony: true }),
      },
      existingObjects: [],
      spawnXZ: [0, 0],
      cameras: [],
      lightDir: [0.62, 0.72, 0.25],
    };
  }

  return {
    ok: true,
    version: '6.0.0-demo',
    elapsedMs: 22,
    viewCount: 0,
    matchedViews: 0,
    roomWidthM: 4.6,
    roomDepthM: 5.2,
    ceilingHeightM: 2.7,
    floorTexture: renderDemoFloorTexture({
      plankRgb: [192, 152, 108],
      herringbone: true,
    }),
    wallTextures: {
      north: renderDemoWallTexture({ paintRgb: [232, 229, 222] }),
      south: renderDemoWallTexture({ paintRgb: [228, 225, 218] }),
      west: renderDemoWallTexture({ paintRgb: [230, 227, 220], windowSpan: [0.16, 0.52], hasBalcony: true }),
      east: renderDemoWallTexture({ paintRgb: [229, 226, 219] }),
    },
    existingObjects: [],
    spawnXZ: [0, 0],
    cameras: [],
    lightDir: [-0.62, 0.72, 0.3],
  };
}

interface SampledPhotoMeta {
  width: number;
  height: number;
  wallRgb: [number, number, number];
  windowSpan?: [number, number];
  floorSamples: Array<[number, number, number, number]>;
}

function percentileAvgRgb(
  samples: Array<[number, number, number, number]>,
  loPct: number,
  hiPct: number,
  fallback: [number, number, number]
): { rgb: [number, number, number]; luma: number } {
  if (samples.length === 0) {
    return {
      rgb: fallback,
      luma: 0.2126 * fallback[0] + 0.7152 * fallback[1] + 0.0722 * fallback[2],
    };
  }
  const sorted = [...samples].sort((a, b) => a[0] - b[0]);
  const lo = Math.min(sorted.length - 1, Math.floor(sorted.length * loPct));
  const hi = Math.max(lo + 1, Math.min(sorted.length, Math.floor(sorted.length * hiPct)));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sl = 0;
  const count = hi - lo;
  for (let i = lo; i < hi; i++) {
    sl += sorted[i][0];
    sr += sorted[i][1];
    sg += sorted[i][2];
    sb += sorted[i][3];
  }
  return {
    rgb: [
      Math.min(240, Math.max(105, Math.round(sr / count))),
      Math.min(240, Math.max(105, Math.round(sg / count))),
      Math.min(240, Math.max(105, Math.round(sb / count))),
    ],
    luma: sl / count,
  };
}

function sampleDominantColorsFromDataUrl(dataUrl: string): Promise<SampledPhotoMeta> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 768;
      const s = 48;
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve({ width: w, height: h, wallRgb: [222, 219, 212], floorSamples: [] });
        return;
      }
      ctx.drawImage(img, 0, 0, s, s);
      const data = ctx.getImageData(0, 0, s, s).data;

      const wallSamples: Array<[number, number, number, number]> = [];
      const thirdsLuma: [number, number, number] = [0, 0, 0];
      const thirdsCount: [number, number, number] = [0, 0, 0];

      for (let y = 6; y < 24; y++) {
        for (let x = 4; x < 44; x++) {
          const idx = (y * s + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          wallSamples.push([luma, r, g, b]);
          const tIdx = x < 17 ? 0 : x < 31 ? 1 : 2;
          thirdsLuma[tIdx] += luma;
          thirdsCount[tIdx] += 1;
        }
      }

      const wallStats = percentileAvgRgb(wallSamples, 0.55, 0.85, [222, 219, 212]);
      const avgThirds = thirdsLuma.map((sum, k) => sum / Math.max(1, thirdsCount[k]));
      const spans: Array<[number, number]> = [
        [0.14, 0.42],
        [0.34, 0.66],
        [0.58, 0.86],
      ];
      let bestThird = 0;
      if (avgThirds[1] > avgThirds[bestThird]) bestThird = 1;
      if (avgThirds[2] > avgThirds[bestThird]) bestThird = 2;
      const windowSpan = avgThirds[bestThird] > wallStats.luma + 22 ? spans[bestThird] : undefined;

      const floorSamples: Array<[number, number, number, number]> = [];
      for (let y = 30; y < 46; y++) {
        for (let x = 4; x < 44; x++) {
          const idx = (y * s + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          floorSamples.push([luma, r, g, b]);
        }
      }

      resolve({
        width: w,
        height: h,
        wallRgb: wallStats.rgb,
        windowSpan,
        floorSamples,
      });
    };
    img.onerror = () => {
      resolve({ width: 1024, height: 768, wallRgb: [222, 219, 212], floorSamples: [] });
    };
    img.src = dataUrl;
  });
}

export async function buildClientStudioFromPhotos(
  views: Array<{ dataUrl: string; exifFocal35mm?: number }>,
  layout?: {
    existingObjects: ReconstructRoomResult['existingObjects'];
    roomWidthM: number;
    roomDepthM: number;
    cameraPositions: Array<[number, number, number]>;
  }
): Promise<ReconstructRoomResult> {
  const metas = await Promise.all(views.map((v) => sampleDominantColorsFromDataUrl(v.dataUrl)));
  const pooledFloor = metas.flatMap((m) => m.floorSamples);
  const { rgb: floorRgb } = percentileAvgRgb(pooledFloor, 0.6, 0.88, [196, 178, 152]);
  const maxC = Math.max(floorRgb[0], floorRgb[1], floorRgb[2]);
  const minC = Math.min(floorRgb[0], floorRgb[1], floorRgb[2]);
  const sat = (maxC - minC) / Math.max(1, maxC);
  const floorKind: FloorSurfaceKind = sat < 0.17 ? 'tile' : 'wood';

  const n = views.length;
  const dirLabels = ['1. Karşı Cephe', '2. Sağ Cephe', '3. Arka Cephe', '4. Sol Cephe'];
  const cameras: ReconstructedCamera[] = views.map((v, i) => {
    const m = metas[i];
    const analysis = buildClientPhotoAnalysis(m.width, m.height, v.exifFocal35mm, 13);
    const yaw = -(i / Math.max(1, n)) * Math.PI * 2;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const radius = 2.05;
    const camX = Math.sin(yaw) * radius;
    const camZ = Math.cos(yaw) * radius;

    const rotVec = (vec: number[]): number[] => [
      cy * vec[0] + sy * vec[2],
      vec[1],
      -sy * vec[0] + cy * vec[2],
    ];

    return {
      index: i,
      label: i < dirLabels.length ? dirLabels[i] : `${i + 1}. Açı ${i + 1}`,
      pos: layout?.cameraPositions[i] || [camX, analysis.cameraHeightM, camZ],
      lookAt: [0, 0.72, 0],
      vfovDeg: analysis.vfovDeg,
      imageWidth: m.width,
      imageHeight: m.height,
      basis: {
        right: rotVec(analysis.cameraBasis.right),
        up: rotVec(analysis.cameraBasis.up),
        back: rotVec(analysis.cameraBasis.back),
      },
      photoUrl: v.dataUrl,
      cleanPhotoUrl: v.dataUrl,
    };
  });

  const northMeta = metas[0];
  const eastMeta = metas[1 % n];
  const southMeta = metas[2 % n];
  const westMeta = metas[3 % n];

  return {
    ok: true,
    version: '6.0.0-offline',
    elapsedMs: 42,
    viewCount: n,
    matchedViews: n,
    roomWidthM: layout?.roomWidthM ?? 4.8,
    roomDepthM: layout?.roomDepthM ?? 5.4,
    ceilingHeightM: 2.75,
    floorTexture: renderDemoFloorTexture({
      plankRgb: floorRgb,
      floorKind,
    }),
    wallTextures: {
      north: renderDemoWallTexture({ paintRgb: northMeta.wallRgb, windowSpan: northMeta.windowSpan }),
      east: renderDemoWallTexture({ paintRgb: eastMeta.wallRgb, windowSpan: eastMeta.windowSpan }),
      south: renderDemoWallTexture({ paintRgb: southMeta.wallRgb, windowSpan: southMeta.windowSpan }),
      west: renderDemoWallTexture({ paintRgb: westMeta.wallRgb, windowSpan: westMeta.windowSpan }),
    },
    existingObjects: layout?.existingObjects ?? [],
    spawnXZ: [0, 0],
    cameras,
    lightDir: [-0.45, 0.82, 0.35],
  };
}
