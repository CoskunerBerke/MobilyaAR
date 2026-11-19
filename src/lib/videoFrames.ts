/**
 * MekanAR (Odanda Gör) v11 — Yüksek Çözünürlüklü Fotoğraf & Akıllı Video Kare Hazırlayıcı
 *  - Fotoğraflar 640px'e düşürülmez: adet bazlı adaptif bütçeyle 980–1280px (q=0.86–0.90)
 *    olarak GPU'ya gönderilir, böylece durgun fotoğraf keskinliği sonuna kadar korunur.
 *  - Video modunda hem Laplacian hareket bulanıklığı hem 16x16 görsel parmak izi farkıyla
 *    yalnızca net ve birbirinden yeterince farklı açılar seçilir.
 *  - iOS Safari (HEVC/.MOV) donanım dekoderi için inline DOM mount + oynatma ısıtması + sıralı yedek içerir.
 */

export interface PreparedScanFrame {
  gpuDataUrl: string;
  hdDataUrl: string;
  sharpness?: number;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

const VIDEO_GPU_MAX_EDGE = 784;
const HD_MAX_EDGE = 1440;

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

/** Hızlı Laplacian kenar varyansı + 16x16 görsel parmak izi (benzer/durağan kare ayıklama için). */
function measureSharpnessAndFingerprint(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  probeCanvas: HTMLCanvasElement,
  probeCtx: CanvasRenderingContext2D
): { sharpness: number; hasSignal: boolean; fingerprint: Float32Array } {
  const pw = 128;
  const ph = Math.max(72, Math.min(160, Math.round((pw * srcH) / Math.max(1, srcW))));
  if (probeCanvas.width !== pw || probeCanvas.height !== ph) {
    probeCanvas.width = pw;
    probeCanvas.height = ph;
  }
  probeCtx.drawImage(source, 0, 0, srcW, srcH, 0, 0, pw, ph);

  const fp = new Float32Array(256);
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
      return { sharpness: 0, hasSignal: false, fingerprint: fp };
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

    // 16x16 normalize parlaklık parmak izi
    for (let gy = 0; gy < 16; gy++) {
      const sy = Math.min(ph - 1, Math.floor(((gy + 0.5) / 16) * ph));
      for (let gx = 0; gx < 16; gx++) {
        const sx = Math.min(pw - 1, Math.floor(((gx + 0.5) / 16) * pw));
        fp[gy * 16 + gx] = gray[sy * pw + sx] / 255.0;
      }
    }
    return { sharpness: variance, hasSignal: true, fingerprint: fp };
  } catch {
    return { sharpness: 1, hasSignal: true, fingerprint: fp };
  }
}

function fingerprintDiff(a: Float32Array, b: Float32Array): number {
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += Math.abs(a[i] - b[i]);
  }
  return acc / 256;
}

function loadImgElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel okunamadı'));
    img.src = dataUrl;
  });
}

/** Tek bir fotoğrafın keskinlik skorunu (Laplacian varyansı) ölçer — kullanıcıya anlık bulanıklık uyarısı için. */
export async function measureDataUrlSharpness(dataUrl: string): Promise<number> {
  try {
    const img = await loadImgElement(dataUrl);
    const probeC = document.createElement('canvas');
    const probeCtx = probeC.getContext('2d', { willReadFrequently: true });
    if (!probeCtx) return 100;
    const { sharpness } = measureSharpnessAndFingerprint(
      img,
      img.naturalWidth || 720,
      img.naturalHeight || 720,
      probeC,
      probeCtx
    );
    return sharpness;
  } catch {
    return 100;
  }
}

export async function preparePhotoForScan(
  dataUrl: string,
  gpuMaxEdge = 1120,
  gpuQuality = 0.88
): Promise<PreparedScanFrame> {
  const img = await loadImgElement(dataUrl);
  const w = img.naturalWidth || 1024;
  const h = img.naturalHeight || 1024;
  const [tw, th] = computeTargetSize(w, h, gpuMaxEdge, true);
  const [hdW, hdH] = computeTargetSize(w, h, HD_MAX_EDGE, false);

  const gpuC = document.createElement('canvas');
  const hdC = document.createElement('canvas');
  const probeC = document.createElement('canvas');
  const gpuCtx = gpuC.getContext('2d');
  const hdCtx = hdC.getContext('2d');
  const probeCtx = probeC.getContext('2d', { willReadFrequently: true });
  if (!gpuCtx || !hdCtx) {
    throw new Error('Görsel kanvası oluşturulamadı');
  }
  const sharpness = probeCtx
    ? measureSharpnessAndFingerprint(img, w, h, probeC, probeCtx).sharpness
    : 100;
  const gpuDataUrl = drawResized(img, w, h, gpuC, gpuCtx, tw, th, gpuQuality);
  const hdDataUrl = drawResized(img, w, h, hdC, hdCtx, hdW, hdH, 0.92);
  return { gpuDataUrl, hdDataUrl, sharpness };
}

/**
 * Durgun çok-açılı fotoğraflar için adaptif yüksek çözünürlüklü paketleyici:
 * Fotoğrafları asla gereksiz yere 640px'e düşürmez; Vercel 4.5 MB sınırı (3.65 MB güvenli bütçe)
 * içinde kalacak en yüksek piksel çözünürlüğünü (980–1280px) otomatik korur!
 */
export async function preparePhotoBatchForScan(
  dataUrls: string[],
  maxPostBytes = 3_650_000
): Promise<PreparedScanFrame[]> {
  const n = dataUrls.length;
  if (n === 0) return [];

  // Başlangıç çözünürlüğü: az fotoğrafta tam 1280px, çok fotoğrafta 1120 -> 980 -> 868px
  const tiers: Array<{ edge: number; q: number }> =
    n <= 10
      ? [
          { edge: 1280, q: 0.9 },
          { edge: 1120, q: 0.86 },
          { edge: 980, q: 0.84 },
        ]
      : n <= 20
      ? [
          { edge: 1120, q: 0.88 },
          { edge: 980, q: 0.85 },
          { edge: 868, q: 0.82 },
        ]
      : [
          { edge: 980, q: 0.86 },
          { edge: 868, q: 0.83 },
          { edge: 756, q: 0.8 },
        ];

  const imgs = await Promise.all(dataUrls.map((u) => loadImgElement(u)));
  const gpuC = document.createElement('canvas');
  const hdC = document.createElement('canvas');
  const gpuCtx = gpuC.getContext('2d');
  const hdCtx = hdC.getContext('2d');
  if (!gpuCtx || !hdCtx) {
    throw new Error('Fotoğraf kanvası oluşturulamadı');
  }

  // HD önizleme kopyalarını bir kez üret
  const hdUrls = imgs.map((img) => {
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || 1024;
    const [hdW, hdH] = computeTargetSize(w, h, HD_MAX_EDGE, false);
    return drawResized(img, w, h, hdC, hdCtx, hdW, hdH, 0.92);
  });

  let bestFrames: PreparedScanFrame[] = [];
  for (const tier of tiers) {
    const frames: PreparedScanFrame[] = [];
    let totalBytes = 64;
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      const [tw, th] = computeTargetSize(w, h, tier.edge, true);
      const gpuDataUrl = drawResized(img, w, h, gpuC, gpuCtx, tw, th, tier.q);
      totalBytes += gpuDataUrl.length + 4;
      frames.push({ gpuDataUrl, hdDataUrl: hdUrls[i] });
    }
    bestFrames = frames;
    if (totalBytes <= maxPostBytes) {
      return frames;
    }
  }
  return bestFrames;
}

export async function downscaleDataUrlForGpu(dataUrl: string, maxEdge = 1120): Promise<string> {
  const prepared = await preparePhotoForScan(dataUrl, maxEdge, 0.88);
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
): { frame: PreparedScanFrame; hasSignal: boolean; sharpness: number; fingerprint: Float32Array } {
  const { sharpness, hasSignal, fingerprint } = measureSharpnessAndFingerprint(
    video,
    srcW,
    srcH,
    probeCanvas,
    probeCtx
  );
  const gpuDataUrl = drawResized(video, srcW, srcH, gpuCanvas, gpuCtx, tw, th, 0.85);
  const hdDataUrl = drawResized(video, srcW, srcH, hdCanvas, hdCtx, hdW, hdH, 0.9);
  return { frame: { gpuDataUrl, hdDataUrl, sharpness }, hasSignal, sharpness, fingerprint };
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

async function seekVideoTo(video: VideoWithRvfc, targetTime: number, timeoutMs = 1900): Promise<boolean> {
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

function selectSharpAndDistinct(
  items: Array<{ frame: PreparedScanFrame; sharpness: number; fingerprint: Float32Array }>,
  maxFrames: number
): PreparedScanFrame[] {
  if (items.length <= 4) return items.map((x) => x.frame);

  // 1) Aşırı hareket bulanıklığı olan kareleri ele (medyanın %24'ü altı)
  const sortedSh = [...items].map((f) => f.sharpness).sort((a, b) => a - b);
  const medSh = sortedSh[Math.floor(sortedSh.length / 2)] || 0;
  const blurCutoff = medSh * 0.24;
  const sharpPool =
    items.length >= 16 && medSh > 0
      ? items.filter((f, idx) => idx === 0 || idx === items.length - 1 || f.sharpness >= blurCutoff)
      : items;
  const pool = sharpPool.length >= 12 ? sharpPool : items;

  // 2) Durağan / birbirinin aynısı kopya kareleri ayıkla (görsel parmak izi farkı >= 0.025)
  const distinct: typeof pool = [pool[0]];
  for (let i = 1; i < pool.length; i++) {
    const prev = distinct[distinct.length - 1];
    const diff = fingerprintDiff(pool[i].fingerprint, prev.fingerprint);
    if (diff >= 0.025 || i === pool.length - 1) {
      distinct.push(pool[i]);
    } else if (pool[i].sharpness > prev.sharpness) {
      distinct[distinct.length - 1] = pool[i];
    }
  }
  const finalPool = distinct.length >= Math.min(12, pool.length) ? distinct : pool;
  if (finalPool.length <= maxFrames) {
    return finalPool.map((x) => x.frame);
  }
  const out: PreparedScanFrame[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round((i / (maxFrames - 1)) * (finalPool.length - 1));
    out.push(finalPool[idx].frame);
  }
  return out;
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
    /* ignore */
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

  const finiteDur = Number.isFinite(video.duration) && video.duration > 0.5 ? Math.min(55, video.duration) : 0;
  const sampleStepSec = finiteDur ? Math.max(0.18, (finiteDur * 0.94) / (maxFrames * 1.5)) : 0.35;
  const collected: Array<{ frame: PreparedScanFrame; sharpness: number; fingerprint: Float32Array }> = [];
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
        collected.push({ frame: cap.frame, sharpness: cap.sharpness, fingerprint: cap.fingerprint });
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
  return selectSharpAndDistinct(collected, maxFrames);
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 32,
  maxEdge = VIDEO_GPU_MAX_EDGE,
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
    const [tw, th] = computeTargetSize(vw, vh, maxEdge, true);
    const [hdW, hdH] = computeTargetSize(vw, vh, HD_MAX_EDGE, false);

    const gpuCanvas = document.createElement('canvas');
    const hdCanvas = document.createElement('canvas');
    const probeCanvas = document.createElement('canvas');
    const gpuCtx = gpuCanvas.getContext('2d');
    const hdCtx = hdCanvas.getContext('2d');
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!gpuCtx || !hdCtx || !probeCtx) throw new Error('Video kare kanvası oluşturulamadı');

    let frames: PreparedScanFrame[] = [];
    const scoredFrames: Array<{ frame: PreparedScanFrame; sharpness: number; fingerprint: Float32Array }> = [];
    let seekFailed = false;

    if (Number.isFinite(video.duration) && video.duration > 0.5) {
      const duration = Math.min(60, video.duration);
      const count = Math.min(maxFrames + 6, Math.max(16, Math.floor(duration * 2.0)));
      const startT = Math.min(0.2, duration * 0.03);
      const endT = Math.max(startT + 0.25, duration - Math.min(0.35, duration * 0.05));
      const span = endT - startT;
      const step = count > 1 ? span / (count - 1) : 0;
      const probeOffsets =
        duration >= 7 && step >= 0.35
          ? [-Math.min(0.16, step * 0.28), 0, Math.min(0.16, step * 0.28)]
          : duration >= 4 && step >= 0.22
          ? [-Math.min(0.1, step * 0.25), Math.min(0.1, step * 0.25)]
          : [0];

      for (let i = 0; i < count; i++) {
        const baseT = startT + (count === 1 ? 0.5 : i / (count - 1)) * span;
        let bestCap: {
          frame: PreparedScanFrame;
          hasSignal: boolean;
          sharpness: number;
          fingerprint: Float32Array;
        } | null = null;

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
        scoredFrames.push({
          frame: bestCap.frame,
          sharpness: bestCap.sharpness,
          fingerprint: bestCap.fingerprint,
        });
        onProgress?.(Math.round(((i + 1) / count) * 100));
      }

      if (scoredFrames.length > 0) {
        frames = selectSharpAndDistinct(scoredFrames, maxFrames);
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
      throw new Error('Videodan yeterli net kare alınamadı — lütfen 10–25 saniyelik net bir mekân videosu çekin');
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
