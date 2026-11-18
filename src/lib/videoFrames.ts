/**
 * Tarayıcı içinde mobil/masaüstü oda videosundan ve fotoğraflardan
 * MapAnything oranlarına birebir hizalı 2'li kare seti üretir:
 *  - gpuDataUrl (~518px): RunPod Serverless'a hızlı yükleme için
 *  - hdDataUrl  (~1140px): Tarayıcı RAM'inde IKEA Kreativ tarzı cam netliğinde HD açı görünümü için
 * iOS Safari (HEVC/.MOV) donanım dekoderi için inline DOM mount + oynatma ısıtması + sıralı oynatma yedeği içerir.
 */

export interface PreparedScanFrame {
  gpuDataUrl: string;
  hdDataUrl: string;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

const MAPANYTHING_518_BUCKETS: ReadonlyArray<readonly [number, number]> = [
  [518, 518],
  [518, 392],
  [518, 336],
  [518, 294],
  [518, 252],
  [518, 168],
  [392, 518],
  [336, 518],
  [294, 518],
  [252, 518],
];

const HD_SCALE = 2.2;

function pickMapAnythingBucket(srcW: number, srcH: number): [number, number] {
  const ar = Math.max(1, srcW) / Math.max(1, srcH);
  let best = MAPANYTHING_518_BUCKETS[0];
  let bestDiff = Infinity;
  for (const b of MAPANYTHING_518_BUCKETS) {
    const diff = Math.abs(b[0] / b[1] - ar);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = b;
    }
  }
  return [best[0], best[1]];
}

function drawCenterCropped(
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
  const srcAr = srcW / Math.max(1, srcH);
  const dstAr = targetW / targetH;
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;
  if (srcAr > dstAr) {
    sw = Math.max(1, Math.round(srcH * dstAr));
    sx = Math.round((srcW - sw) * 0.5);
  } else if (srcAr < dstAr) {
    sh = Math.max(1, Math.round(srcW / dstAr));
    sy = Math.round((srcH - sh) * 0.5);
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL('image/jpeg', quality);
}

export async function preparePhotoForScan(dataUrl: string): Promise<PreparedScanFrame> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 518;
      const h = img.naturalHeight || 518;
      const [tw, th] = pickMapAnythingBucket(w, h);
      const gpuC = document.createElement('canvas');
      const hdC = document.createElement('canvas');
      const gpuCtx = gpuC.getContext('2d');
      const hdCtx = hdC.getContext('2d');
      if (!gpuCtx || !hdCtx) {
        reject(new Error('Görsel kanvası oluşturulamadı'));
        return;
      }
      const gpuDataUrl = drawCenterCropped(img, w, h, gpuC, gpuCtx, tw, th, 0.8);
      const hdW = Math.round(tw * HD_SCALE);
      const hdH = Math.round(th * HD_SCALE);
      const hdDataUrl = drawCenterCropped(img, w, h, hdC, hdCtx, hdW, hdH, 0.86);
      resolve({ gpuDataUrl, hdDataUrl });
    };
    img.onerror = () => reject(new Error('Görsel ölçeklenemedi'));
    img.src = dataUrl;
  });
}

export async function downscaleDataUrlForGpu(dataUrl: string, _maxEdge = 518): Promise<string> {
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
      }, 35);
    });
  });
}

function captureDualFrame(
  video: HTMLVideoElement,
  srcW: number,
  srcH: number,
  tw: number,
  th: number,
  gpuCanvas: HTMLCanvasElement,
  gpuCtx: CanvasRenderingContext2D,
  hdCanvas: HTMLCanvasElement,
  hdCtx: CanvasRenderingContext2D
): { frame: PreparedScanFrame; hasSignal: boolean } {
  const gpuDataUrl = drawCenterCropped(video, srcW, srcH, gpuCanvas, gpuCtx, tw, th, 0.82);
  let hasSignal = true;
  try {
    const data = gpuCtx.getImageData(0, 0, tw, th).data;
    const stride = Math.max(1, Math.floor(data.length / (4 * 64))) * 4;
    let lit = 0;
    for (let i = 0; i < data.length; i += stride) {
      if (data[i] + data[i + 1] + data[i + 2] > 4) {
        lit += 1;
        if (lit >= 2) break;
      }
    }
    hasSignal = lit >= 1;
  } catch {
    hasSignal = true;
  }
  const hdW = Math.round(tw * HD_SCALE);
  const hdH = Math.round(th * HD_SCALE);
  const hdDataUrl = drawCenterCropped(video, srcW, srcH, hdCanvas, hdCtx, hdW, hdH, 0.86);
  return { frame: { gpuDataUrl, hdDataUrl }, hasSignal };
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

async function seekVideoTo(video: VideoWithRvfc, targetTime: number, timeoutMs = 2200): Promise<boolean> {
  if (Math.abs(video.currentTime - targetTime) <= 0.035 && video.readyState >= 2) {
    await waitDecodedFrame(video, 100);
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
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - targetTime) < 0.12) {
        finish(true);
      }
    }, 80);

    video.addEventListener('seeked', onSeeked, { once: true });
    try {
      video.currentTime = targetTime;
    } catch {
      finish(false);
    }
  });

  if (settled) {
    await waitDecodedFrame(video, 120);
  }
  return settled;
}

async function extractSequentialFallback(
  video: VideoWithRvfc,
  srcW: number,
  srcH: number,
  tw: number,
  th: number,
  gpuCanvas: HTMLCanvasElement,
  gpuCtx: CanvasRenderingContext2D,
  hdCanvas: HTMLCanvasElement,
  hdCtx: CanvasRenderingContext2D,
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

  const finiteDur = Number.isFinite(video.duration) && video.duration > 0.5 ? Math.min(45, video.duration) : 0;
  const sampleStepSec = finiteDur ? Math.max(0.25, (finiteDur * 0.92) / maxFrames) : 0.45;
  const collected: PreparedScanFrame[] = [];
  let lastSampledVideoT = -sampleStepSec;
  const wallStart = Date.now();

  while (!video.ended && collected.length < maxFrames + 12 && Date.now() - wallStart < 28000) {
    await new Promise<void>((r) => setTimeout(r, 180));
    if (video.readyState < 2) continue;
    const t = video.currentTime;
    if (collected.length === 0 || t - lastSampledVideoT >= sampleStepSec) {
      const cap = captureDualFrame(video, srcW, srcH, tw, th, gpuCanvas, gpuCtx, hdCanvas, hdCtx);
      if (cap.hasSignal || collected.length > 0) {
        collected.push(cap.frame);
        lastSampledVideoT = t;
        onProgress?.(Math.min(99, Math.round((collected.length / maxFrames) * 100)));
      }
    }
  }

  try {
    video.pause();
  } catch {
    /* ignore */
  }

  if (collected.length <= maxFrames) {
    return collected;
  }
  const sampled: PreparedScanFrame[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round((i / (maxFrames - 1)) * (collected.length - 1));
    sampled.push(collected[idx]);
  }
  return sampled;
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 32,
  _maxEdge = 518,
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
    const [tw, th] = pickMapAnythingBucket(vw, vh);

    const gpuCanvas = document.createElement('canvas');
    const hdCanvas = document.createElement('canvas');
    const gpuCtx = gpuCanvas.getContext('2d');
    const hdCtx = hdCanvas.getContext('2d');
    if (!gpuCtx || !hdCtx) throw new Error('Video kare kanvası oluşturulamadı');

    let frames: PreparedScanFrame[] = [];
    let seekFailed = false;

    if (Number.isFinite(video.duration) && video.duration > 0.5) {
      const duration = Math.min(60, video.duration);
      const count = Math.min(maxFrames, Math.max(12, Math.floor(duration * 1.8)));
      const startT = Math.min(0.2, duration * 0.05);
      const endT = Math.max(startT + 0.25, duration - Math.min(0.3, duration * 0.07));

      for (let i = 0; i < count; i++) {
        const ratio = count === 1 ? 0.5 : i / (count - 1);
        const targetTime = startT + ratio * (endT - startT);
        const ok = await seekVideoTo(video, targetTime, 2200);
        if (!ok) {
          if (frames.length >= 6) break;
          seekFailed = true;
          break;
        }

        let cap = captureDualFrame(video, vw, vh, tw, th, gpuCanvas, gpuCtx, hdCanvas, hdCtx);
        if (!cap.hasSignal && i === 0) {
          await new Promise<void>((r) => setTimeout(r, 150));
          cap = captureDualFrame(video, vw, vh, tw, th, gpuCanvas, gpuCtx, hdCanvas, hdCtx);
        }
        frames.push(cap.frame);
        onProgress?.(Math.round(((i + 1) / count) * 100));
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
        gpuCanvas,
        gpuCtx,
        hdCanvas,
        hdCtx,
        maxFrames,
        onProgress
      );
      if (fallbackFrames.length >= 4) {
        frames = fallbackFrames;
      }
    }

    if (frames.length < 4) {
      throw new Error('Videodan yeterli kare alınamadı — lütfen 8–20 saniyelik net bir oda videosu çekin');
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
