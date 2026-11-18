/**
 * Tarayıcı içi mevcut eşya tespiti (COCO-SSD / TensorFlow.js) + 4–8 açıdan 3D oda yerleşim tahmini.
 *
 * Varsayım: Kullanıcı her fotoğrafı odanın bir duvarının ortasından, telefonu yaklaşık göz hizasında
 * tutup karşı duvara doğru çeker ve açılar saat yönünde sıralıdır (1. karşı, 2. sağ, 3. arka, 4. sol).
 * Her tespit kutusunun alt kenarı zemine değdiği noktadır; bu nokta kamera yüksekliği + lens açısı
 * ile zemine ışın atılarak metrik konuma çevrilir, ardından açılar arasında aynı eşyalar birleştirilir.
 */
import type { ExistingFurnitureKind, ReconstructedObject3D } from './server';
import { clampToRoomWalls, fitsInsideWalls, hasAnyCollision, type OBB2D } from './collision2d';
import { loadHtmlImage } from './roomRendering';

type DetectedModel = {
  detect: (
    img: HTMLImageElement | HTMLCanvasElement,
    maxNumBoxes?: number,
    minScore?: number
  ) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
};

type Pred = { bbox: [number, number, number, number]; class: string; score: number };

const MIN_SCORE: Record<string, number> = {
  chair: 0.2,
  'dining table': 0.16,
  couch: 0.35,
  bed: 0.35,
  bench: 0.3,
  refrigerator: 0.35,
};

function iou(a: Pred['bbox'], b: Pred['bbox']) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.max(1e-6, a[2] * a[3] + b[2] * b[3] - inter);
}

/** Tam kare + 2×2 örtüşen ve 2 kat büyütülmüş karolar: sınıftaki küçük sıra/sandalyeleri yakalar. */
async function detectMultiScale(model: DetectedModel, img: HTMLImageElement, W: number, H: number): Promise<Pred[]> {
  const all: Pred[] = [...(await model.detect(img, 80, 0.15))];
  const tw = Math.round(W * 0.6);
  const th = Math.round(H * 0.6);
  const c = document.createElement('canvas');
  c.width = tw * 2;
  c.height = th * 2;
  const ctx = c.getContext('2d');
  if (ctx) {
    for (const ox of [0, W - tw]) {
      for (const oy of [0, H - th]) {
        ctx.drawImage(img, ox, oy, tw, th, 0, 0, c.width, c.height);
        const ps = await model.detect(c, 80, 0.15);
        for (const p of ps) {
          all.push({ ...p, bbox: [ox + p.bbox[0] / 2, oy + p.bbox[1] / 2, p.bbox[2] / 2, p.bbox[3] / 2] });
        }
      }
    }
  }
  const kept: Pred[] = [];
  for (const p of all.sort((a, b) => b.score - a.score)) {
    const min = MIN_SCORE[p.class];
    if (min === undefined || p.score < min) continue;
    if (!kept.some((k) => k.class === p.class && iou(k.bbox, p.bbox) > 0.4)) kept.push(p);
  }
  return kept;
}

let modelPromise: Promise<DetectedModel> | null = null;

async function loadDetector(): Promise<DetectedModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import('@tensorflow/tfjs-core');
      await import('@tensorflow/tfjs-backend-webgl');
      await import('@tensorflow/tfjs-backend-cpu');
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      return (await cocoSsd.load({ base: 'mobilenet_v2' })) as unknown as DetectedModel;
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

interface LocalDetection {
  kind: ExistingFurnitureKind;
  label: string;
  forwardM: number;
  lateralM: number;
  widthM: number;
  depthM: number;
  heightM: number;
  colorHex: string;
  score: number;
}

const CAMERA_HEIGHT_M = 1.42;
const CAMERA_PITCH_DEG = 8;

function focalPxFor(width: number, height: number, exifFocal35mm?: number) {
  const f35 = exifFocal35mm && Number.isFinite(exifFocal35mm) ? Math.min(85, Math.max(14, exifFocal35mm)) : 26;
  return Math.hypot(width, height) * (f35 / 43.266615);
}

function averageColorHex(img: HTMLImageElement, bbox: [number, number, number, number]): string {
  try {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    const ctx = c.getContext('2d');
    if (!ctx) return '#a1a1aa';
    const [x, y, w, h] = bbox;
    ctx.drawImage(img, x + w * 0.2, y + h * 0.2, Math.max(1, w * 0.6), Math.max(1, h * 0.6), 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return '#a1a1aa';
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function classify(
  cls: string,
  estWidthM: number
): { kind: ExistingFurnitureKind; label: string; w: number; d: number; h: number } | null {
  switch (cls) {
    case 'chair':
      return { kind: 'chair', label: 'Sandalye', w: clamp(estWidthM, 0.42, 0.62), d: 0.5, h: 0.82 };
    case 'dining table': {
      const w = clamp(estWidthM, 0.6, 2.2);
      if (w < 1.2) return { kind: 'desk', label: 'Sıra / Masa', w, d: 0.55, h: 0.75 };
      return { kind: 'table', label: 'Masa', w, d: 0.85, h: 0.76 };
    }
    case 'couch':
      return { kind: 'sofa', label: 'Koltuk', w: clamp(estWidthM, 1.4, 2.6), d: 0.9, h: 0.85 };
    case 'bed':
      return { kind: 'bed', label: 'Yatak', w: clamp(estWidthM, 0.9, 1.8), d: 2.0, h: 0.55 };
    case 'bench':
      return { kind: 'armchair', label: 'Bank', w: clamp(estWidthM, 0.8, 1.8), d: 0.45, h: 0.46 };
    case 'refrigerator':
      return { kind: 'cabinet', label: 'Dolap', w: clamp(estWidthM, 0.6, 0.9), d: 0.65, h: 1.8 };
    default:
      return null;
  }
}

async function detectInView(
  model: DetectedModel,
  view: { dataUrl: string; exifFocal35mm?: number }
): Promise<LocalDetection[]> {
  const img = await loadHtmlImage(view.dataUrl);
  const W = img.naturalWidth || 1024;
  const H = img.naturalHeight || 768;
  const focal = focalPxFor(W, H, view.exifFocal35mm);
  const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  const preds = await detectMultiScale(model, img, W, H);
  const out: LocalDetection[] = [];

  for (const p of preds) {
    const [bx, by, bw, bh] = p.bbox;
    const u = bx + bw / 2;
    const v = Math.min(H - 1, by + bh);
    const xn = (u - W / 2) / focal;
    const yn = (v - H / 2) / focal; // aşağı pozitif
    const denom = yn * cosP + sinP;
    if (denom <= 0.03) continue; // ufuk çizgisinin üstünde: zemine değmiyor
    const t = CAMERA_HEIGHT_M / denom;
    const forwardHit = (cosP - yn * sinP) * t;
    const lateralHit = xn * t;
    if (!Number.isFinite(forwardHit) || forwardHit < 0.4 || forwardHit > 11) continue;

    const estWidth = (bw / focal) * forwardHit;
    const spec = classify(p.class, estWidth);
    if (!spec) continue;

    out.push({
      kind: spec.kind,
      label: spec.label,
      forwardM: forwardHit + spec.d / 2,
      lateralM: lateralHit,
      widthM: spec.w,
      depthM: spec.d,
      heightM: spec.h,
      colorHex: averageColorHex(img, p.bbox),
      score: p.score,
    });
  }
  return out;
}

export interface FurnitureLayoutResult {
  existingObjects: ReconstructedObject3D[];
  roomWidthM: number;
  roomDepthM: number;
  cameraPositions: Array<[number, number, number]>;
  detectedCount: number;
}

/** Fotoğraflardaki mevcut eşyaları bulur ve tek bir metrik 3D oda planına yerleştirir. */
export async function detectRoomFurniture(
  views: Array<{ dataUrl: string; exifFocal35mm?: number }>,
  onProgress?: (msg: string) => void
): Promise<FurnitureLayoutResult> {
  onProgress?.('Eşya tanıma modeli yükleniyor...');
  const model = await loadDetector();

  const perView: LocalDetection[][] = [];
  for (let i = 0; i < views.length; i++) {
    onProgress?.(`${i + 1}/${views.length}. fotoğraftaki sıra, masa, sandalye ve koltuklar tespit ediliyor...`);
    perView.push(await detectInView(model, views[i]));
  }

  const n = views.length;
  // Saat yönünde: 0 = karşı (kuzey), 1 = sağ (doğu), 2 = arka (güney), 3 = sol (batı)
  const yaws = views.map((_, i) => -(i / Math.max(1, n)) * Math.PI * 2);
  const fwd = yaws.map((y) => [-Math.sin(y), -Math.cos(y)] as [number, number]);
  const right = yaws.map((y) => [Math.cos(y), -Math.sin(y)] as [number, number]);

  // ---- Oda ölçüsü tahmini: en uzak eşya + duvar payı ----
  let needD = 0;
  let needW = 0;
  perView.forEach((dets, i) => {
    const alongZ = Math.abs(fwd[i][1]) >= Math.abs(fwd[i][0]);
    for (const d of dets) {
      const span = d.forwardM + d.depthM / 2 + 0.45 + 0.35;
      const side = Math.abs(d.lateralM) * 2 + d.widthM + 0.6;
      if (alongZ) {
        needD = Math.max(needD, span);
        needW = Math.max(needW, side);
      } else {
        needW = Math.max(needW, span);
        needD = Math.max(needD, side);
      }
    }
  });
  const roomW = Math.round(clamp(Math.max(4.8, needW), 3.0, 12) * 10) / 10;
  const roomD = Math.round(clamp(Math.max(5.4, needD), 3.0, 12) * 10) / 10;

  // ---- Kameralar: her duvarın ortasında, karşı duvara bakarak ----
  const camPos: Array<[number, number]> = fwd.map(([fx, fz]) => {
    const halfAlong = Math.abs(fz) * (roomD / 2) + Math.abs(fx) * (roomW / 2);
    const back = Math.max(0.3, halfAlong - 0.45);
    return [-fx * back, -fz * back];
  });

  // ---- Dünya koordinatına taşı ----
  type WorldDet = LocalDetection & { x: number; z: number; rot: number; votes: number; fx: number; fz: number };
  const world: WorldDet[] = [];
  perView.forEach((dets, i) => {
    const snapRot = Math.round(yaws[i] / (Math.PI / 2)) * (Math.PI / 2);
    for (const d of dets) {
      world.push({
        ...d,
        x: camPos[i][0] + fwd[i][0] * d.forwardM + right[i][0] * d.lateralM,
        z: camPos[i][1] + fwd[i][1] * d.forwardM + right[i][1] * d.lateralM,
        rot: snapRot,
        votes: 1,
        fx: fwd[i][0],
        fz: fwd[i][1],
      });
    }
  });

  // ---- Açılar arası aynı eşyaları birleştir ----
  const groupOf = (k: ExistingFurnitureKind) => (k === 'desk' || k === 'table' ? 'table' : k);
  const merged: WorldDet[] = [];
  world
    .sort((a, b) => b.score - a.score)
    .forEach((d) => {
      const radius = d.kind === 'chair' ? 0.45 : Math.max(0.55, d.widthM * 0.45);
      const hit = merged.find((m) => groupOf(m.kind) === groupOf(d.kind) && Math.hypot(m.x - d.x, m.z - d.z) < radius);
      if (hit) {
        const wsum = hit.votes + 1;
        hit.x = (hit.x * hit.votes + d.x) / wsum;
        hit.z = (hit.z * hit.votes + d.z) / wsum;
        hit.widthM = Math.max(hit.widthM, d.widthM);
        hit.votes = wsum;
      } else {
        merged.push({ ...d });
      }
    });

  // ---- Sınıf / ofis düzeni: çok sandalye, az masa → her masasız sandalyenin önüne sıra ekle ----
  const chairs = merged.filter((m) => m.kind === 'chair');
  const tables = merged.filter((m) => m.kind === 'desk' || m.kind === 'table');
  if (chairs.length >= 4 && tables.length <= Math.floor(chairs.length / 3)) {
    for (const ch of chairs) {
      const hasTable = tables.some((t) => Math.hypot(t.x - ch.x, t.z - ch.z) < 0.9);
      if (hasTable) continue;
      const desk: WorldDet = {
        ...ch,
        kind: 'desk',
        label: 'Sıra / Masa',
        widthM: 0.7,
        depthM: 0.5,
        heightM: 0.75,
        colorHex: '#e7e5e4',
        x: ch.x + ch.fx * 0.56,
        z: ch.z + ch.fz * 0.56,
        score: ch.score * 0.9,
      };
      tables.push(desk);
      merged.push(desk);
    }
  }

  // ---- Çakışmasız yerleşim: büyükten küçüğe, gerekirse hafif kaydır ----
  merged.sort((a, b) => b.widthM * b.depthM - a.widthM * a.depthM);
  const accepted: OBB2D[] = [];
  const objects: ReconstructedObject3D[] = [];
  const nudges: Array<[number, number]> = [[0, 0]];
  for (const r of [0.12, 0.24, 0.36]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      nudges.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }

  merged.forEach((d, idx) => {
    const halfW = Math.max(0.14, d.widthM / 2 - 0.01);
    const halfD = Math.max(0.14, d.depthM / 2 - 0.01);
    const base = clampToRoomWalls(d.x, d.z, d.rot, halfW, halfD, roomW, roomD);
    for (const [ox, oz] of nudges) {
      const cand: OBB2D = { id: `scan-${idx}`, x: base.x + ox, z: base.z + oz, rot: d.rot, halfW, halfD };
      if (!fitsInsideWalls(cand.x, cand.z, cand.rot, halfW, halfD, roomW, roomD)) continue;
      if (hasAnyCollision(cand, accepted, 0.01)) continue;
      accepted.push(cand);
      objects.push({
        id: cand.id,
        kind: d.kind,
        label: d.label,
        center: [cand.x, d.heightM / 2, cand.z],
        size: [d.widthM, d.heightM, d.depthM],
        yaw: d.rot,
        colorHex: d.colorHex,
      });
      break;
    }
  });

  return {
    existingObjects: objects,
    roomWidthM: roomW,
    roomDepthM: roomD,
    cameraPositions: camPos.map(([x, z]) => [x, CAMERA_HEIGHT_M, z]),
    detectedCount: world.length,
  };
}
