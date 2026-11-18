/**
 * Tarayıcı içinde 15–25 saniyelik oda videosundan eşit aralıklı ~24 kare (518px JPEG) çıkarır
 * ve tek tek seçilen fotoğrafları Vercel/RunPod için kompakt boyuta indirger.
 */

export async function downscaleDataUrlForGpu(dataUrl: string, maxEdge = 518): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 518;
      const h = img.naturalHeight || 518;
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
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Görsel ölçeklenemedi'));
    img.src = dataUrl;
  });
}

export async function extractFramesFromVideo(
  file: File,
  maxFrames = 24,
  maxEdge = 518,
  onProgress?: (pct: number) => void
): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video zaman aşımına uğradı')), 20000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Video dosyası okunamadı — lütfen MP4 veya MOV deneyin'));
      };
      video.src = url;
    });

    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(60, video.duration) : 6;
    const count = Math.min(maxFrames, Math.max(8, Math.floor(duration * 1.6)));
    const startT = Math.min(0.15, duration * 0.05);
    const endT = Math.max(startT + 0.3, duration - Math.min(0.15, duration * 0.05));

    const scale = Math.min(1, maxEdge / Math.max(vw, vh));
    const cw = Math.max(1, Math.round(vw * scale));
    const ch = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Video kare kanvası oluşturulamadı');

    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const ratio = count === 1 ? 0.5 : i / (count - 1);
      const targetTime = startT + ratio * (endT - startT);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video karesi alınamadı')), 8000);
        const onSeeked = () => {
          clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = targetTime;
      });

      ctx.drawImage(video, 0, 0, cw, ch);
      frames.push(canvas.toDataURL('image/jpeg', 0.82));
      onProgress?.(Math.round(((i + 1) / count) * 100));
    }

    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
