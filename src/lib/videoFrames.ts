/**
 * MekanAR (Odanda Gör) v9 — Hareket Bulanıklığı Filtreli HD Video/Fotoğraf Kare Çıkarıcı
 *  - Videoyu 24 zaman dilimine böler, her dilimde hızlı Laplacian keskinlik skoru ile
 *    en net (hareketsiz) kareyi seçer.
 *  - gpuDataUrl (~768px, 14'ün katına hizalı): Depth-Anything-3 + gsplat HD + Difix3D+ için.
 *  - hdDataUrl  (<=1280px): Tarayıcı RAM'inde kristal netliğinde HD Fotoğraf modu için.
 *  - iOS Safari (HEVC/.MOV) donanım dekoderi için DOM mount + oynatma ısıtması + sıralı yedek içerir.
 */

export interface PreparedScanFrame {
  gpuDataUrl: string;
  hdDataUrl: string;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

const GPU_MAX_EDGE = 640;
const HD_MAX_EDGE = 1280;

function round14(v: number): number {
  return Math.max(140, Math.round(v / 14) * 14);
}

function computeTargetSize(srcW: number, srcH: number, maxEdge: number, align14 = false): [number, number] {
  const w = Math.max(1, srcW);
  const h = Math.max(1, srcH);
  const scale = Math.min(1.0, maxEdge / Math.max(w, h));
  let tw = Math.max(140, Math.round(w * scale));
  let th = Math.max(140, Math.round(h * scale));
  if (align14) {
    tw = round14(tw);
    th = round14(th);
  }
  return [tw, th];
}

function drawResized(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  targetW: number,
  targetH: number,
  quality: number
): string {
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Hızlı Laplacian kenar varyansı ile hareket bulanıklığı olmayan en net kareyi puanlar. */
function measureSharpnessAndSignal(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  probeCanvas: HTMLCanvasElement,
  probeCtx: CanvasRenderingContext2D
): { sharpness: number; hasSignal: boolean } {
  const pw = 128;
  const ph = Math.max(72, Math.min(160, Math.round((pw * srcH) / Math.max(1, srcW))));
  if (probeCanvas.width !== pw || probeCanvas.height !== ph) {
    probeCanvas.width = pw;
    probeCanvas.height = ph;
  }
  probeCtx.drawImage(source, 0, 0, srcW, srcH, 0, 0, pw, ph);
  try {
    const data = probeCtx.getImageData(0, 0, pw, ph).data;
    const gray = new Float32Array(pw * ph);
    let lit = 0;
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (r + g + b > 6) lit++;
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    if (lit < gray.length * 0.02) {
      return { sharpness: 0, hasSignal: false };
    }
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let y = 1; y < ph - 1; y += 2) {
      const row = y * pw;
      for (let x = 1; x < pw - 1; x += 2) {
        const idx = row + x;
        const lap =
          gray[idx - pw] + gray[idx + pw] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }
    const mean = sum / Math.max(1, count);
    const variance = Math.max(0, sumSq / Math.max(1, count) - mean * mean);
    return { sharpness: variance, hasSignal: true };
  } catch {
    return { sharpness: 1, hasSignal: true };
  }
}

export async function preparePhotoForScan(dataUrl: string): Promise<PreparedScanFrame> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 768;
      const h = img.naturalHeight || 768;
      const [tw, th] = computeTargetSize(w, h, GPU_MAX_EDGE, true);
      const [hdW, hdH] = computeTargetSize(w, h, HD_MAX_EDGE, false);
      const gpuC = document.createElement('canvas');
      const hdC = document.createElement('canvas');
      const gpuCtx = gpuC.getContext('2d');
      const hdCtx = hdC.getContext('2d');
      if (!gpuCtx || !hdCtx) {
        reject(new Error('Görsel kanvası oluşturulamadı'));
        return;
      }
      const gpuDataUrl = drawResized(img, w, h, gpuC, gpuCtx, tw, th, 0.84);
      const hdDataUrl = drawResized(img, w, h, hdC, hdCtx, hdW, hdH, 0.9);
      resolve({ gpuDataUrl, hdDataUrl });
    };
    img.onerror = () => reject(new Error('Görsel ölçeklenemedi'));
    img.src = dataUrl;
  });
}

export async function downscaleDataUrlForGpu(dataUrl: string, _maxEdge = GPU_MAX_EDGE): Promise<string> {
  const prepared = await preparePhotoForScan(dataUrl);
  return prepared.gpuDataUrl;
}

function waitDecodedFrame(video: VideoWithRvfc, maxWaitMs = 140): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, maxWaitMs);
    if (typeof video.requestVideoFrameCallback === 'function') {
      try {
        video.requestVideoFrameCallback(() => {
          clearTimeout(timer);
          finish();
        });
        return;
      } catch {
        /* Fallback to rAF below */
      }
    }
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer);
        finish();
      }, 30);
    });
  });
}

function captureDualFrame(
  video: HTMLVideoElement,
  srcW: number,
  srcH: number,
  tw: number,
  th: number,
  hdW: number,
  hdH: number,
  gpuCanvas: HTMLCanvasElement,
  gpuCtx: CanvasRenderingContext2D,
  hdCanvas: HTMLCanvasElement,
  hdCtx: CanvasRenderingContext2D,
  probeCanvas: HTMLCanvasElement,
  probeCtx: CanvasRenderingContext2D
): { frame: PreparedScanFrame; hasSignal: boolean; sharpness: number } {
  const { sharpness, hasSignal } = measureSharpnessAndSignal(video, srcW, srcH, probeCanvas, probeCtx);
  const gpuDataUrl = drawResized(video, srcW, srcH, gpuCanvas, gpuCtx, tw, th, 0.84);
  const hdDataUrl = drawResized(video, srcW, srcH, hdCanvas, hdCtx, hdW, hdH, 0.9);
  return { frame: { gpuDataUrl, hdDataUrl }, hasSignal, sharpness };
}

async function primeVideoDecoder(video: VideoWithRvfc): Promise<void> {
  try {
    await video.play();
  } catch {
    /* iOS kısıtı olsa bile readyState bekle */
  }
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('timeupdate', done);
        video.removeEventListener('canplay', done);
        resolve();
      };
      const timer = setTimeout(done, 1200);
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('timeupdate', done, { once: true });
      video.addEventListener('canplay', done, { once: true });
      if (typeof video.requestVideoFrameCallback === 'function') {
        try {
          video.requestVideoFrameCallback(done);
        } catch {
          /* ignore */
        }
      }
    });
  } else {
    await waitDecodedFrame(video, 140);
  }
  try {
    video.pause();
  } catch {
    /* ignore */
  }
}

async function seekVideoTo(video: VideoWithRvfc, targetTime: number, timeoutMs = 2000): Promise<boolean> {
  if (Math.abs(video.currentTime - targetTime) <= 0.03 && video.readyState >= 2) {
    await waitDecodedFrame(video, 90);
    return true;
  }

  const settled = await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poller);
      video.removeEventListener('seeked', onSeeked);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    const poller = setInterval(() => {
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - targetTime) < 0.1) {
        finish(true);
      }
    }, 70);

    video.addEventListener('seeked', onSeeked, { once: true });
    try {
      video.currentTime = targetTime;
    } catch {
      finish(false);
    }
  });

  if (settled) {
    await waitDecodedFrame(video, 110);
  }
  return settled;
}

async function extractSequentialFallback(
  video: VideoWithRvfc,
  srcW: number,
  srcH: number,
  tw: number,
  th: number,
  hdW: number,
  hdH: number,
  gpuCanvas: HTMLCanvasElement,
  gpuCtx: CanvasRenderingContext2D,
  hdCanvas: HTMLCanvasElement,
  hdCtx: CanvasRenderingContext2D,
  probeCanvas: HTMLCanvasElement,
  probeCtx: CanvasRenderingContext2D,
  maxFrames: number,
  onProgress?: (pct: number) => void
): Promise<PreparedScanFrame[]> {
  try {
    video.currentTime = 0;
  } catch {
    /* ignore non-seekable stream */
  }
  try {
    video.playbackRate = 1.75;
  } catch {
    video.playbackRate = 1.0;
  }
  try {
    await video.play();
  } catch {
    return [];
  }

  const finiteDur = Number.isFinite(video.duration) && video.duration > 0.5 ? Math.min(50, video.duration) : 0;
  const sampleStepSec = finiteDur ? Math.max(0.18, (finiteDur * 0.94) / (maxFrames * 1.5)) : 0.35;
  const collected: Array<{ frame: PreparedScanFrame; sharpness: number }> = [];
  let lastSampledVideoT = -sampleStepSec;
  const wallStart = Date.now();

  while (!video.ended && collected.length < maxFrames * 2 && Date.now() - wallStart < 30000) {
    await new Promise<void>((r) => setTimeout(r, 140));
    if (video.readyState < 2) continue;
    const t = video.currentTime;
    if (collected.length === 0 || t - lastSampledVideoT >= sampleStepSec) {
      const cap = captureDualFrame(
        video, srcW, srcH, tw, th, hdW, hdH,
        gpuCanvas, gpuCtx, hdCanvas, hdCtx, probeCanvas, probeCtx
      );
      if (cap.hasSignal || collected.length > 0) {
        collected.push({ frame: cap.frame, sharpness: cap.sharpness });
        lastSampledVideoT = t;
        onProgress?.(Math.min(99, Math.round((collected.length / (maxFrames * 1.4)) * 100)));
      }
    }
  }

  try {
    video.pause();
  } catch {
    /* ignore */
  }

  if (collected.length <= maxFrames) {
    return collected.map((c) => c.frame);
  }
  // Her zaman kovasında en keskin kareyi seç
  const sampled: PreparedScanFrame[] = [];
  const bucketSize = collected.length / maxFrames;
  for (let i = 0; i < maxFrames; i++) {
    const s = Math.floor(i * bucketSize);
    const e = Math.min(collected.length, Math.max(s + 1, Math.floor((i + 1) * bucketSize)));
    let best = collected[s];
    for (let j = s + 1; j < e; j++) {
      if (collected[j].sharpness > best.sharpness) best = collected[j];
    }
    sampled.push(best.frame);
  }
  return sampled;
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 36,
  _maxEdge = GPU_MAX_EDGE,
  onProgress?: (pct: number) => void
): Promise<PreparedScanFrame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video') as VideoWithRvfc;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.style.cssText =
    'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:-1;';
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('loadeddata', onMeta);
        video.removeEventListener('error', onErr);
      };
      const onMeta = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onErr = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Video dosyası okunamadı — lütfen MP4 veya MOV deneyin'));
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Video zaman aşımına uğradı'));
      }, 20000);

      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('loadeddata', onMeta, { once: true });
      video.addEventListener('error', onErr, { once: true });
      video.src = url;
      video.load();
    });

    await primeVideoDecoder(video);

    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const [tw, th] = computeTargetSize(vw, vh, GPU_MAX_EDGE, true);
    const [hdW, hdH] = computeTargetSize(vw, vh, HD_MAX_EDGE, false);

    const gpuCanvas = document.createElement('canvas');
    const hdCanvas = document.createElement('canvas');
    const probeCanvas = document.createElement('canvas');
    const gpuCtx = gpuCanvas.getContext('2d');
    const hdCtx = hdCanvas.getContext('2d');
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!gpuCtx || !hdCtx || !probeCtx) throw new Error('Video kare kanvası oluşturulamadı');

    let frames: PreparedScanFrame[] = [];
    const scoredFrames: Array<{ frame: PreparedScanFrame; sharpness: number }> = [];
    let seekFailed = false;

    if (Number.isFinite(video.duration) && video.duration > 0.5) {
      const duration = Math.min(60, video.duration);
      const count = Math.min(maxFrames, Math.max(16, Math.floor(duration * 2.0)));
      const startT = Math.min(0.2, duration * 0.03);
      const endT = Math.max(startT + 0.25, duration - Math.min(0.35, duration * 0.05));
      const span = endT - startT;
      const step = count > 1 ? span / (count - 1) : 0;
      // Her zaman diliminde 3 aday yokla ve en net (hareketsiz) kareyi seç
      const probeOffsets =
        duration >= 7 && step >= 0.35
          ? [-Math.min(0.16, step * 0.28), 0, Math.min(0.16, step * 0.28)]
          : duration >= 4 && step >= 0.22
          ? [-Math.min(0.1, step * 0.25), Math.min(0.1, step * 0.25)]
          : [0];

      for (let i = 0; i < count; i++) {
        const baseT = startT + (count === 1 ? 0.5 : i / (count - 1)) * span;
        let bestCap: { frame: PreparedScanFrame; hasSignal: boolean; sharpness: number } | null = null;

        for (const off of probeOffsets) {
          const t = Math.max(startT, Math.min(endT, baseT + off));
          const ok = await seekVideoTo(video, t, 1900);
          if (!ok) {
            if (!bestCap && scoredFrames.length < 6) seekFailed = true;
            break;
          }
          const cap = captureDualFrame(
            video, vw, vh, tw, th, hdW, hdH,
            gpuCanvas, gpuCtx, hdCanvas, hdCtx, probeCanvas, probeCtx
          );
          if (!bestCap || (cap.hasSignal && cap.sharpness > bestCap.sharpness)) {
            bestCap = cap;
          }
        }

        if (seekFailed) break;
        if (!bestCap) {
          if (scoredFrames.length >= 6) break;
          seekFailed = true;
          break;
        }
        if (!bestCap.hasSignal && i === 0) {
          await new Promise<void>((r) => setTimeout(r, 150));
          bestCap = captureDualFrame(
            video, vw, vh, tw, th, hdW, hdH,
            gpuCanvas, gpuCtx, hdCanvas, hdCtx, probeCanvas, probeCtx
          );
        }
        scoredFrames.push({ frame: bestCap.frame, sharpness: bestCap.sharpness });
        onProgress?.(Math.round(((i + 1) / count) * 100));
      }

      if (scoredFrames.length > 0) {
        // Hızlı kamera savrulmasında aşırı bulanıklaşmış kareleri ele (medyanın %24'ü altı)
        const sortedSh = [...scoredFrames].map((f) => f.sharpness).sort((a, b) => a - b);
        const medSh = sortedSh[Math.floor(sortedSh.length / 2)] || 0;
        const blurCutoff = medSh * 0.24;
        const filtered =
          scoredFrames.length >= 20 && medSh > 0
            ? scoredFrames.filter((f, idx) => idx === 0 || idx === scoredFrames.length - 1 || f.sharpness >= blurCutoff)
            : scoredFrames;
        frames = (filtered.length >= 16 ? filtered : scoredFrames).map((f) => f.frame);
      }
    } else {
      seekFailed = true;
    }

    if (seekFailed || frames.length < 4) {
      const fallbackFrames = await extractSequentialFallback(
        video,
        vw,
        vh,
        tw,
        th,
        hdW,
        hdH,
        gpuCanvas,
        gpuCtx,
        hdCanvas,
        hdCtx,
        probeCanvas,
        probeCtx,
        maxFrames,
        onProgress
      );
      if (fallbackFrames.length >= 4) {
        frames = fallbackFrames;
      }
    }

    if (frames.length < 4) {
      throw new Error('Videodan yeterli kare alınamadı — lütfen 8–25 saniyelik net bir mekân videosu çekin');
    }

    onProgress?.(100);
    return frames;
  } finally {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
