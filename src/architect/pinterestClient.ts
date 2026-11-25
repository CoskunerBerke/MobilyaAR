import type { FloorMaterialKind, ParametricFurnitureKind, WallId, WallPattern } from './types';

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
  parametricKind?: ParametricFurnitureKind;
  primaryColorHex?: string;
  accentColorHex?: string;
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

const VALID_PARAMETRIC_SET = new Set<ParametricFurnitureKind>([
  'fireplace_marble',
  'tv_wall_unit',
  'wall_tv',
  'rug_custom',
  'chandelier',
  'wardrobe',
  'dining_table',
  'dining_chair',
  'bookshelf',
  'bed_frame',
  'nightstand',
  'sofa',
  'armchair',
  'coffee_table_round',
  'coffee_table_rect',
  'desk',
  'office_chair',
  'vanity_table',
  'sideboard',
  'ottoman',
  'potted_plant',
  'table_lamp',
  'stairs',
  'ac_unit',
  'wall_mirror',
  'floor_lamp',
  'console_table',
  'wall_art',
]);

function normTr(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

/**
 * Guarantees EVERY Pinterest item maps to its closest realistic editable 3D archetype
 * so the entire Pinterest room can assemble instantaneously in 3D with zero failures.
 */
export function resolvePinterestArchetype(item: PinterestDetectedObject): ParametricFurnitureKind {
  if (item.parametricKind && VALID_PARAMETRIC_SET.has(item.parametricKind)) {
    return item.parametricKind;
  }
  const t = normTr(`${item.nameTr} ${item.category} ${item.visualDescriptionEn}`);
  if (item.mountMode === 'rug' || /hali|kilim|rug|carpet/.test(t)) return 'rug_custom';
  if (/ayna|mirror/.test(t)) return 'wall_mirror';
  if (/tablo|poster|resim|cerceve|painting|artwork|wall art/.test(t)) return 'wall_art';
  if (/somine|fireplace/.test(t)) return 'fireplace_marble';
  if ((/tv|televizyon|media/.test(t)) && (/unite|dolap|unit|stand|wall/.test(t))) return 'tv_wall_unit';
  if (/televizyon|\btv\b|oled|ekran|screen/.test(t)) return 'wall_tv';
  if (/bitki|saksi|agac|zeytin|cicek|plant|tree|ficus|monstera/.test(t)) return 'potted_plant';
  if (/merdiven|stair/.test(t)) return 'stairs';
  if (/yatak|bed|mezanin/.test(t)) return 'bed_frame';
  if (/komodin|nightstand|bedside table/.test(t)) return 'nightstand';
  if (/makyaj|vanity|dressing table/.test(t)) return 'vanity_table';
  if (/calisma masa|ofis masa|bilgisayar masa|desk/.test(t)) return 'desk';
  if (/calisma kolt|ofis kolt|doner|office chair|desk chair/.test(t)) return 'office_chair';
  if (/yemek masa|dining table|\bmasa\b|table/.test(t) && !/sehpa|coffee/.test(t)) return 'dining_table';
  if (/yuvarlak.*sehpa|round.*table|coffee.*round/.test(t)) return 'coffee_table_round';
  if (/sehpa|coffee table|side table/.test(t)) {
    return Math.abs(item.widthCm - item.depthCm) <= 15 && item.widthCm <= 95 ? 'coffee_table_round' : 'coffee_table_rect';
  }
  if (/puf|pouf|ottoman|tabure|stool/.test(t)) return 'ottoman';
  if (/berjer|tekli.*kolt|armchair|accent chair|lounge chair/.test(t)) return 'armchair';
  if (/sandalye|chair/.test(t)) return 'dining_chair';
  if (/kanepe|koltuk|sofa|couch|l-koltuk|oturma/.test(t)) return 'sofa';
  if (/kitaplik|bookshelf|bookcase|raf|shelf/.test(t)) return 'bookshelf';
  if (/gardirop|gardrop|wardrobe|closet/.test(t)) return 'wardrobe';
  if (/konsol|console/.test(t)) return 'console_table';
  if (/dolap|depolama|bufe|sideboard|cabinet|storage|credenza/.test(t)) return 'sideboard';
  if (item.mountMode === 'ceiling' || /avize|sarkit|chandelier|pendant/.test(t)) return 'chandelier';
  if (/lambader|ayakli lamba|floor lamp/.test(t)) return 'floor_lamp';
  if (/abajur|lamba|lamp|lighting|aydinlatma/.test(t)) return 'table_lamp';
  if (/klima|air conditioner/.test(t)) return 'ac_unit';
  return 'sideboard';
}

export function isValidHexColor(s?: string): s is string {
  return Boolean(s && /^#[0-9a-fA-F]{6}$/.test(s.trim()));
}

/**
 * Samples the center-weighted dominant color from a cropped Pinterest image
 * as an automatic fallback when AI omits a hex color or user draws a custom box.
 */
export function sampleDominantHexFromDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve('#8d8476');
        ctx.drawImage(img, 0, 0, 32, 32);
        const { data } = ctx.getImageData(6, 6, 20, 20);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          // Skip near-pure white studio margins
          if (pr > 246 && pg > 246 && pb > 246) continue;
          r += pr;
          g += pg;
          b += pb;
          n++;
        }
        if (n === 0) return resolve('#8d8476');
        const hex =
          '#' +
          [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
            .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
            .join('');
        resolve(hex);
      } catch {
        resolve('#8d8476');
      }
    };
    img.onerror = () => resolve('#8d8476');
    img.src = dataUrl;
  });
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

/**
 * Edge-to-edge tight crop (zero white padding) for instant 1:1 textured flat items
 * such as patterned rugs, framed wall art, and posters.
 */
export function cropRawTightDataUrl(
  imageDataUrl: string,
  box2d: [number, number, number, number]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box2d;
      const sx = Math.max(0, Math.round((xmin / 1000) * img.width));
      const sy = Math.max(0, Math.round((ymin / 1000) * img.height));
      const sw = Math.max(16, Math.min(img.width - sx, Math.round(((xmax - xmin) / 1000) * img.width)));
      const sh = Math.max(16, Math.min(img.height - sy, Math.round(((ymax - ymin) / 1000) * img.height)));
      const maxDim = 1024;
      const sc = Math.min(1, maxDim / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(32, Math.round(sw * sc));
      canvas.height = Math.max(32, Math.round(sh * sc));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageDataUrl);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
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
  parametricKind?: ParametricFurnitureKind;
  primaryColorHex?: string;
  accentColorHex?: string;
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
