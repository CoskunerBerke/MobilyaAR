import type { FloorMaterialKind, WallId, WallPattern } from './types';

export interface PinterestServerConfig {
  geminiConfigured: boolean;
  runpodConfigured: boolean;
  visionModel: string;
  imageModel: string;
}

export interface PinterestRoomStyle {
  styleNameTr: string;
  summaryTr: string;
  wallColorHex: string;
  accentWallColorHex: string;
  wallPattern: WallPattern;
  floorMaterial: FloorMaterialKind;
  floorTintHex: string;
  curtainColorHex: string;
  suggestedSunHour: number;
}

export interface PinterestDetectedObject {
  id: string;
  nameTr: string;
  category: string;
  /** [ymin, xmin, ymax, xmax] in 0..1000 */
  box2d: [number, number, number, number];
  widthCm: number;
  depthCm: number;
  heightCm: number;
  mountMode: 'floor' | 'wall' | 'ceiling' | 'rug';
  suggestedWall: WallId | 'center';
  elevationCm: number;
  relativeX: number;
  relativeZ: number;
  facingDeg: number;
  visualDescriptionEn: string;
}

const GEMINI_KEY_STORAGE = 'mekanar_arch_gemini_key_v1';
const GEMINI_DIRECT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DIRECT_VISION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-4-neon',
];
const DIRECT_IMAGE_MODELS = [
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];

export function getSavedGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveGeminiKey(key: string) {
  try {
    const clean = key.trim();
    if (clean) localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export async function fetchPinterestConfig(): Promise<PinterestServerConfig> {
  try {
    const r = await fetch('/api/pinterest3d?action=config');
    if (r.ok) {
      const d = await r.json();
      if (d && d.ok) {
        return {
          geminiConfigured: Boolean(d.geminiConfigured),
          runpodConfigured: Boolean(d.runpodConfigured),
          visionModel: d.visionModel || DIRECT_VISION_MODELS[0],
          imageModel: d.imageModel || DIRECT_IMAGE_MODELS[0],
        };
      }
    }
  } catch {
    /* local vite dev without serverless */
  }
  return {
    geminiConfigured: false,
    runpodConfigured: false,
    visionModel: DIRECT_VISION_MODELS[0],
    imageModel: DIRECT_IMAGE_MODELS[0],
  };
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/**
 * Crops a [ymin, xmin, ymax, xmax] (0..1000) region tightly from a room image
 * onto a clean 1024×1024 pure white studio canvas with generous outer margin
 * so RunPod Hunyuan3D's rembg cleanly isolates ONLY the target object.
 */
export function cropBoxFromDataUrl(
  imageDataUrl: string,
  box2d: [number, number, number, number],
  padRatio = 0.025
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box2d;
      const bw = Math.max(10, ((xmax - xmin) / 1000) * img.width);
      const bh = Math.max(10, ((ymax - ymin) / 1000) * img.height);
      const sx = Math.max(0, (xmin / 1000) * img.width - bw * padRatio);
      const sy = Math.max(0, (ymin / 1000) * img.height - bh * padRatio);
      const sw = Math.min(img.width - sx, bw * (1 + padRatio * 2));
      const sh = Math.min(img.height - sy, bh * (1 + padRatio * 2));

      const outSize = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outSize, outSize);
      // Generous 12% studio white margin around tightly cropped object improves rembg + 3D mesh silhouette
      const sc = Math.min((outSize * 0.78) / Math.max(1, sw), (outSize * 0.78) / Math.max(1, sh));
      const dw = sw * sc;
      const dh = sh * sc;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, (outSize - dw) * 0.5, (outSize - dh) * 0.5, dw, dh);
      resolve(canvas.toDataURL('image/jpeg', 0.94));
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

export function isGeminiQuotaZeroError(msg: string): boolean {
  const s = String(msg || '').toLowerCase();
  return (
    s.includes('limit: 0') ||
    s.includes('free_tier') ||
    s.includes('quota exceeded') ||
    s.includes('(429)') ||
    s.includes('resource_exhausted')
  );
}

export async function identifyCroppedPinterestObject(params: {
  croppedImageDataUrl: string;
  fullRoomImageDataUrl?: string;
  geminiKey?: string;
}): Promise<{
  nameTr: string;
  category: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  mountMode: 'floor' | 'wall' | 'ceiling' | 'rug';
  elevationCm: number;
  visualDescriptionEn: string;
} | null> {
  const key = (params.geminiKey || getSavedGeminiKey()).trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-gemini-key'] = key;

  try {
    const resp = await fetch('/api/pinterest3d?action=identifyCrop', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        croppedImageDataUrl: params.croppedImageDataUrl,
        fullRoomImageDataUrl: params.fullRoomImageDataUrl,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.ok && data?.item) return data.item;
    }
  } catch {
    /* ignore and let caller use default manual label */
  }
  return null;
}

async function callDirectGemini(
  apiKey: string,
  models: string[],
  body: Record<string, unknown>
): Promise<{ model: string; json: any }> {
  let lastErr = 'Gemini API yanıt vermedi';
  for (const model of models) {
    const resp = await fetch(
      `${GEMINI_DIRECT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const json = await resp.json().catch(() => null);
    if (resp.ok && json) return { model, json };
    lastErr = json?.error?.message || `HTTP ${resp.status}`;
  }
  throw new Error(lastErr);
}

export async function analyzePinterestRoom(params: {
  imageDataUrl: string;
  roomWidthM: number;
  roomDepthM: number;
  roomCeilingM: number;
  geminiKey?: string;
}): Promise<{ roomStyle: PinterestRoomStyle | null; detectedObjects: PinterestDetectedObject[]; model: string }> {
  const key = (params.geminiKey || getSavedGeminiKey()).trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-gemini-key'] = key;

  const resp = await fetch('/api/pinterest3d?action=analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imageDataUrl: params.imageDataUrl,
      roomWidthM: params.roomWidthM,
      roomDepthM: params.roomDepthM,
      roomCeilingM: params.roomCeilingM,
    }),
  });

  if (resp.ok) {
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Pinterest analizi başarısız');
    return {
      roomStyle: data.roomStyle || null,
      detectedObjects: data.detectedObjects || [],
      model: data.model || 'gemini-2.5-flash',
    };
  }

  // Fallback for local vite dev (no /api serverless mounted) when user provided Gemini key
  if (resp.status === 404 && key) {
    const img = splitDataUrl(params.imageDataUrl);
    if (!img) throw new Error('Fotoğraf okunamadı');
    const prompt = `You are a senior interior architect. Analyze this interior photo for a ${params.roomWidthM}x${params.roomDepthM}x${params.roomCeilingM}m 3D room. Return JSON { "roomStyle": { "styleNameTr", "summaryTr", "wallColorHex", "accentWallColorHex", "wallPattern": "smooth"|"boiserie"|"slats"|"concrete"|"stone"|"wallpaper", "floorMaterial": "herringbone_oak"|"plank_oak"|"plank_walnut"|"travertine"|"marble"|"microcement"|"terrazzo", "floorTintHex", "curtainColorHex", "suggestedSunHour" }, "detectedObjects": [{ "id", "nameTr", "category", "box2d": [ymin,xmin,ymax,xmax], "widthCm", "depthCm", "heightCm", "mountMode": "floor"|"wall"|"ceiling"|"rug", "suggestedWall": "north"|"south"|"west"|"east"|"center", "elevationCm", "relativeX", "relativeZ", "facingDeg", "visualDescriptionEn" }] }. Detect up to 8 key items (fireplace, TV, sofa, coffee table, chair, rug, chandelier).`;
    const { model, json } = await callDirectGemini(key, DIRECT_VISION_MODELS, {
      contents: [
        { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: img.mimeType, data: img.data } }] },
      ],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const visible = parts.filter((p: any) => !p.thought && typeof p.text === 'string');
    const txt = (visible.length > 0 ? visible : parts).map((p: any) => p.text || '').join('\n');
    const cleaned = txt.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    const parsed = JSON.parse(s !== -1 && e > s ? cleaned.slice(s, e + 1) : cleaned);
    return {
      roomStyle: parsed.roomStyle || null,
      detectedObjects: parsed.detectedObjects || [],
      model,
    };
  }

  const errJson = await resp.json().catch(() => null);
  throw new Error(errJson?.error || `Pinterest analiz hatası (HTTP ${resp.status})`);
}

export async function isolatePinterestObject(params: {
  fullRoomImageDataUrl: string;
  croppedImageDataUrl: string;
  item: PinterestDetectedObject;
  geminiKey?: string;
}): Promise<{ studioImageDataUrl: string; model: string }> {
  const key = (params.geminiKey || getSavedGeminiKey()).trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-gemini-key'] = key;

  const resp = await fetch('/api/pinterest3d?action=isolate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fullRoomImageDataUrl: params.fullRoomImageDataUrl,
      croppedImageDataUrl: params.croppedImageDataUrl,
      nameTr: params.item.nameTr,
      category: params.item.category,
      visualDescriptionEn: params.item.visualDescriptionEn,
      widthCm: params.item.widthCm,
      depthCm: params.item.depthCm,
      heightCm: params.item.heightCm,
    }),
  });

  if (resp.ok) {
    const data = await resp.json();
    if (!data.ok || !data.studioImageDataUrl) throw new Error(data.error || 'Nesne izolasyonu başarısız');
    return { studioImageDataUrl: data.studioImageDataUrl, model: data.model || 'gemini-2.5-flash-image' };
  }

  if (resp.status === 404 && key) {
    const crop = splitDataUrl(params.croppedImageDataUrl);
    const full = splitDataUrl(params.fullRoomImageDataUrl);
    if (!crop) throw new Error('Kırpılan görsel okunamadı');
    const parts: any[] = [
      {
        text: `Extract ONLY this exact item ("${params.item.nameTr}": ${params.item.visualDescriptionEn}) and render it cleanly isolated on a pure uniform solid white #FFFFFF studio background, slight 3/4 front view, zero overlapping furniture, zero floor shadows, complete legs and edges visible, 100% faithful to its exact design and texture.`,
      },
      { inlineData: { mimeType: crop.mimeType, data: crop.data } },
    ];
    if (full) parts.push({ inlineData: { mimeType: full.mimeType, data: full.data } });
    const { model, json } = await callDirectGemini(
      key,
      DIRECT_IMAGE_MODELS,
      { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }
    );
    const candParts = json?.candidates?.[0]?.content?.parts || [];
    for (const p of candParts) {
      const inl = p.inlineData || p.inline_data;
      if (inl?.data) {
        return { studioImageDataUrl: `data:${inl.mimeType || 'image/png'};base64,${inl.data}`, model };
      }
    }
    throw new Error('Gemini görsel döndürmedi');
  }

  const errJson = await resp.json().catch(() => null);
  throw new Error(errJson?.error || `İzolasyon hatası (HTTP ${resp.status})`);
}

export async function generatePhotorealRender(params: {
  snapshotDataUrl: string;
  styleNote: string;
  roomSummary: string;
  geminiKey?: string;
}): Promise<{ renderImageDataUrl: string; model: string }> {
  const key = (params.geminiKey || getSavedGeminiKey()).trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['x-gemini-key'] = key;

  const resp = await fetch('/api/pinterest3d?action=photorealRender', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      snapshotDataUrl: params.snapshotDataUrl,
      styleNote: params.styleNote,
      roomSummary: params.roomSummary,
    }),
  });

  if (resp.ok) {
    const data = await resp.json();
    if (!data.ok || !data.renderImageDataUrl) throw new Error(data.error || 'Render başarısız');
    return { renderImageDataUrl: data.renderImageDataUrl, model: data.model || 'gemini-2.5-flash-image' };
  }

  if (resp.status === 404 && key) {
    const snap = splitDataUrl(params.snapshotDataUrl);
    if (!snap) throw new Error('Sahne görüntüsü alınamadı');
    const { model, json } = await callDirectGemini(
      key,
      DIRECT_IMAGE_MODELS,
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Turn this 3D architectural viewport screenshot into an ultra-photorealistic V-Ray interior architectural photograph. Preserve EVERY wall, window, door, column, beam, curtain cove, LED glow, sun direction, and furniture position strictly. Context: ${params.roomSummary}. Note: ${params.styleNote}`,
              },
              { inlineData: { mimeType: snap.mimeType, data: snap.data } },
            ],
          },
        ],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      }
    );
    const candParts = json?.candidates?.[0]?.content?.parts || [];
    for (const p of candParts) {
      const inl = p.inlineData || p.inline_data;
      if (inl?.data) {
        return { renderImageDataUrl: `data:${inl.mimeType || 'image/png'};base64,${inl.data}`, model };
      }
    }
    throw new Error('Render görseli üretilemedi');
  }

  const errJson = await resp.json().catch(() => null);
  throw new Error(errJson?.error || `Render hatası (HTTP ${resp.status})`);
}
