/**
 * Tarayıcı içinde mobil/masaüstü oda videosundan ~20 kare (518px JPEG) çıkarır
 * ve seçilen fotoğrafları Vercel/RunPod için kompakt boyuta indirger.
 * iOS Safari (HEVC/.MOV) donanım dekoderi için inline DOM mount + oynatma ısıtması + sıralı oynatma yedeği kullanır.
 */

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

export async function downscaleDataUrlForGpu(dataUrl: string, maxEdge = 518): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || maxEdge;
      const h = img.naturalHeight || maxEdge;
      const s = Math.min(1, maxEdge / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx) {
        reject(new Error('Görsel kanvası oluşturulamadı'));
        return;
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Görsel ölçeklenemedi'));
    img.src = dataUrl;
  });
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

function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number
): { dataUrl: string; hasSignal: boolean } {
  ctx.drawImage(video, 0, 0, cw, ch);
  let hasSignal = true;
  try {
    const data = ctx.getImageData(0, 0, cw, ch).data;
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
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.78), hasSignal };
}

async function primeVideoDecoder(video: VideoWithRvfc): Promise<void> {
  try {
    await video.play();
  } catch {
    /* iOS / tarayıcı kullanıcı etkileşimi kısıtı olsa bile readyState bekle */
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
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  maxFrames: number,
  onProgress?: (pct: number) => void
): Promise<string[]> {
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
  const collected: string[] = [];
  let lastSampledVideoT = -sampleStepSec;
  const wallStart = Date.now();

  while (!video.ended && collected.length < maxFrames + 12 && Date.now() - wallStart < 28000) {
    await new Promise<void>((r) => setTimeout(r, 180));
    if (video.readyState < 2) continue;
    const t = video.currentTime;
    if (collected.length === 0 || t - lastSampledVideoT >= sampleStepSec) {
      const cap = captureFrame(video, canvas, ctx, cw, ch);
      if (cap.hasSignal || collected.length > 0) {
        collected.push(cap.dataUrl);
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
  const sampled: string[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round((i / (maxFrames - 1)) * (collected.length - 1));
    sampled.push(collected[idx]);
  }
  return sampled;
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 20,
  maxEdge = 518,
  onProgress?: (pct: number) => void
): Promise<string[]> {
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
    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Video kare kanvası oluşturulamadı');

    let frames: string[] = [];
    let seekFailed = false;

    if (Number.isFinite(video.duration) && video.duration > 0.5) {
      const duration = Math.min(60, video.duration);
      const count = Math.min(maxFrames, Math.max(8, Math.floor(duration * 1.35)));
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

        let cap = captureFrame(video, canvas, ctx, cw, ch);
        if (!cap.hasSignal && i === 0) {
          await new Promise<void>((r) => setTimeout(r, 150));
          cap = captureFrame(video, canvas, ctx, cw, ch);
        }
        frames.push(cap.dataUrl);
        onProgress?.(Math.round(((i + 1) / count) * 100));
      }
    } else {
      seekFailed = true;
    }

    if (seekFailed || frames.length < 4) {
      const fallbackFrames = await extractSequentialFallback(video, canvas, ctx, cw, ch, maxFrames, onProgress);
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
