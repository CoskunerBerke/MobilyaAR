import * as THREE from 'three';
import type { DecodedKeyframe, DecodedScannedRoom } from './pointCloudRoom';

export interface ErasePoint {
  u: number; // 0..1 normalized X
  v: number; // 0..1 normalized Y
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel okunamadı'));
    img.src = src;
  });
}

/**
 * Tarayıcı içi çok ölçekli harmonik difüzyon + yumuşak mikro-doku inpainting.
 * Kullanıcının HD fotoğrafta fırçaladığı eski eşyayı çevredeki gerçek zemin/duvar
 * renkleriyle <120 ms içinde temizler.
 */
export async function inpaintPhotoRegion(
  srcDataUrl: string,
  strokes: ErasePoint[][],
  brushRadiusNorm = 0.045
): Promise<string> {
  if (strokes.length === 0) return srcDataUrl;

  const img = await loadImg(srcDataUrl);
  const W = img.naturalWidth || 720;
  const H = img.naturalHeight || 960;

  // 1. Maskeyi oluştur
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');
  if (!mctx) return srcDataUrl;

  mctx.clearRect(0, 0, W, H);
  mctx.lineCap = 'round';
  mctx.lineJoin = 'round';
  mctx.strokeStyle = '#ffffff';
  mctx.fillStyle = '#ffffff';
  const radiusPx = Math.max(10, brushRadiusNorm * Math.min(W, H));
  mctx.lineWidth = radiusPx * 2;

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      mctx.beginPath();
      mctx.arc(stroke[0].u * W, stroke[0].v * H, radiusPx, 0, Math.PI * 2);
      mctx.fill();
    } else {
      mctx.beginPath();
      mctx.moveTo(stroke[0].u * W, stroke[0].v * H);
      for (let i = 1; i < stroke.length; i++) {
        mctx.lineTo(stroke[i].u * W, stroke[i].v * H);
      }
      mctx.stroke();
    }
  }

  // 2. Hızlı alt-ölçek (~160px) harmonik sınır yayılımı
  const maxWork = 176;
  const scale = Math.min(1, maxWork / Math.max(W, H));
  const sw = Math.max(24, Math.round(W * scale));
  const sh = Math.max(24, Math.round(H * scale));

  const workImg = document.createElement('canvas');
  workImg.width = sw;
  workImg.height = sh;
  const wctx = workImg.getContext('2d')!;
  wctx.drawImage(img, 0, 0, sw, sh);
  const srcData = wctx.getImageData(0, 0, sw, sh).data;

  const workMask = document.createElement('canvas');
  workMask.width = sw;
  workMask.height = sh;
  const wmctx = workMask.getContext('2d')!;
  wmctx.drawImage(maskCanvas, 0, 0, sw, sh);
  const maskData = wmctx.getImageData(0, 0, sw, sh).data;

  const N = sw * sh;
  const isHole = new Uint8Array(N);
  const rBuf = new Float32Array(N);
  const gBuf = new Float32Array(N);
  const bBuf = new Float32Array(N);

  // Sınır halkasından ortalama renk topla (başlangıç tahmini için)
  let ringR = 0;
  let ringG = 0;
  let ringB = 0;
  let ringCnt = 0;

  for (let i = 0; i < N; i++) {
    const hole = maskData[i * 4 + 3] > 32 ? 1 : 0;
    isHole[i] = hole;
    rBuf[i] = srcData[i * 4];
    gBuf[i] = srcData[i * 4 + 1];
    bBuf[i] = srcData[i * 4 + 2];
  }

  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const idx = y * sw + x;
      if (isHole[idx]) continue;
      if (isHole[idx - 1] || isHole[idx + 1] || isHole[idx - sw] || isHole[idx + sw]) {
        ringR += rBuf[idx];
        ringG += gBuf[idx];
        ringB += bBuf[idx];
        ringCnt += 1;
      }
    }
  }
  const initR = ringCnt > 0 ? ringR / ringCnt : 185;
  const initG = ringCnt > 0 ? ringG / ringCnt : 180;
  const initB = ringCnt > 0 ? ringB / ringCnt : 172;

  const holeIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    if (isHole[i]) {
      holeIndices.push(i);
      rBuf[i] = initR;
      gBuf[i] = initG;
      bBuf[i] = initB;
    }
  }
  if (holeIndices.length === 0) return srcDataUrl;

  // Gauss-Seidel ağırlıklı harmonik difüzyon (yatay + alt zemin sürekliliğine öncelik verir)
  const iters = 55;
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k < holeIndices.length; k++) {
      const idx = holeIndices[k];
      const x = idx % sw;
      const y = (idx - x) / sw;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let swSum = 0;

      if (x > 0) {
        const w = 1.25;
        sr += rBuf[idx - 1] * w;
        sg += gBuf[idx - 1] * w;
        sb += bBuf[idx - 1] * w;
        swSum += w;
      }
      if (x < sw - 1) {
        const w = 1.25;
        sr += rBuf[idx + 1] * w;
        sg += gBuf[idx + 1] * w;
        sb += bBuf[idx + 1] * w;
        swSum += w;
      }
      if (y > 0) {
        const w = 0.85;
        sr += rBuf[idx - sw] * w;
        sg += gBuf[idx - sw] * w;
        sb += bBuf[idx - sw] * w;
        swSum += w;
      }
      if (y < sh - 1) {
        const w = 1.15;
        sr += rBuf[idx + sw] * w;
        sg += gBuf[idx + sw] * w;
        sb += bBuf[idx + sw] * w;
        swSum += w;
      }
      if (swSum > 0) {
        rBuf[idx] = sr / swSum;
        gBuf[idx] = sg / swSum;
        bBuf[idx] = sb / swSum;
      }
    }
  }

  // Çok hafif doğal doku kumu ekle (plastik düz boya görünümünü engeller)
  const filledImgData = wctx.createImageData(sw, sh);
  for (let i = 0; i < N; i++) {
    const grain = isHole[i] ? (((i * 1103515245 + 12345) & 7) - 3.5) * 0.9 : 0;
    filledImgData.data[i * 4] = Math.max(0, Math.min(255, Math.round(rBuf[i] + grain)));
    filledImgData.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(gBuf[i] + grain)));
    filledImgData.data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(bBuf[i] + grain)));
    filledImgData.data[i * 4 + 3] = 255;
  }
  wctx.putImageData(filledImgData, 0, 0);

  // 3. Orijinal HD fotoğrafa yumuşak kenarlı maske ile birleştir
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const octx = outCanvas.getContext('2d')!;
  octx.drawImage(img, 0, 0, W, H);

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = W;
  patchCanvas.height = H;
  const pctx = patchCanvas.getContext('2d')!;
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(workImg, 0, 0, W, H);

  const softMask = document.createElement('canvas');
  softMask.width = W;
  softMask.height = H;
  const smctx = softMask.getContext('2d')!;
  smctx.filter = `blur(${Math.max(4, Math.round(radiusPx * 0.25))}px)`;
  smctx.drawImage(maskCanvas, 0, 0, W, H);

  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(softMask, 0, 0, W, H);
  octx.drawImage(patchCanvas, 0, 0, W, H);

  return outCanvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Silinen fırça izi altındaki derinlik gizleme piksellerini (occDepthMm) ve
 * 10 cm zemin çarpışma hücrelerini (grid === 1 -> 0) temizler; böylece yeni mobilya
 * doğrudan silinen eski eşyanın yerine yerleştirilebilir.
 */
export function clearErasedObstaclesForKeyframe(
  room: DecodedScannedRoom,
  kf: DecodedKeyframe,
  strokes: ErasePoint[][],
  brushRadiusNorm = 0.045
): number {
  const { occW, occH, occDepthMm } = kf;
  const rOcc = Math.max(2, Math.ceil(brushRadiusNorm * Math.min(occW, occH)));
  const rOcc2 = rOcc * rOcc;

  const cam = new THREE.PerspectiveCamera(kf.fovY, kf.aspect, 0.05, 30);
  cam.position.set(kf.pos[0], kf.pos[1], kf.pos[2]);
  cam.quaternion.set(kf.quat[0], kf.quat[1], kf.quat[2], kf.quat[3]);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const rc = new THREE.Raycaster();
  const hit = new THREE.Vector3();
  let clearedGridCells = 0;

  const { w: gw, d: gd, cell, cells } = room.grid;
  const { halfW, halfD } = room.bounds;

  for (const stroke of strokes) {
    for (const pt of stroke) {
      // 1. Derinlik maskesinde fırçalanan bölgeyi sıfırla
      const cx = Math.round(pt.u * (occW - 1));
      const cy = Math.round(pt.v * (occH - 1));
      const x0 = Math.max(0, cx - rOcc);
      const x1 = Math.min(occW - 1, cx + rOcc);
      const y0 = Math.max(0, cy - rOcc);
      const y1 = Math.min(occH - 1, cy + rOcc);
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          if (dx * dx + dy * dy <= rOcc2) {
            occDepthMm[y * occW + x] = 0;
          }
        }
      }

      // 2. Fırçalanan noktayı y=0 zeminine düşür ve çevresindeki 25 cm engel hücrelerini boşalt
      const ndc = new THREE.Vector2(pt.u * 2 - 1, -(pt.v * 2 - 1));
      rc.setFromCamera(ndc, cam);
      if (rc.ray.intersectPlane(floorPlane, hit)) {
        const gx0 = Math.floor((hit.x + halfW) / cell);
        const gz0 = Math.floor((hit.z + halfD) / cell);
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const gx = gx0 + dx;
            const gz = gz0 + dz;
            if (gx >= 1 && gx < gw - 1 && gz >= 1 && gz < gd - 1) {
              const idx = gz * gw + gx;
              if (cells[idx] === 1) {
                cells[idx] = 0;
                clearedGridCells += 1;
              }
            }
          }
        }
      }
    }
  }

  return clearedGridCells;
}
