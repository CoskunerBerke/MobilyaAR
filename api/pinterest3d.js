/**
 * MekanAR Mimari Stüdyo — Pinterest'ten Birebir 3B Oda & Fotogerçekçi Render API'si
 *
 * Google Gemini API (Google AI Studio) kullanır:
 *   1) action=config          -> Sunucuda GEMINI_API_KEY / RunPod tanımlı mı bildirir
 *   2) action=analyze         -> gemini-2.5-flash ile Pinterest oda fotoğrafından:
 *                                 - duvar rengi/dokusu, zemin malzemesi/rengi, perde & güneş tonu
 *                                 - odadaki tüm eşyaların (şömine, TV ünitesi, koltuk, sehpa, berjer vb.)
 *                                   2D konum kutusu, gerçek cm tahmini ve oda yerleşimini çıkarır
 *   3) action=isolate         -> gemini-2.5-flash-image ile seçilen tekil eşyayı (örn. şömine/TV/koltuk)
 *                                 birebir tasarımını koruyarak önü açık bembeyaz stüdyo ürününe izole eder;
 *                                 ardından RunPod Hunyuan3D-2.1 2K PBR motoru bunu birebir 3B .GLB'ye çevirir!
 *   4) action=photorealRender -> gemini-2.5-flash-image ile 3B odanın anlık görüntüsünü mimari
 *                                 geometrisini bozmadan V-Ray / Corona kalitesinde sunum render'ına çevirir.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Paid-Tier flagship spatial Vision first: gemini-3.5-flash answers in ~12-15s with full wallZones/furniture accuracy!
// Sequential fallback only if primary fails -> cuts latency >55% (14s vs 35s) & stays strictly <50s (<60s Vercel cap).
const VISION_WAVES = [
  ['gemini-3.5-flash'],
  ['gemini-3.7-flash', 'gemini-3.8-flash'],
  ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
];
const VISION_MODELS = VISION_WAVES.flat();
const IMAGE_MODELS = [
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-nano-banana-2.1',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-key, x-openai-key, x-groq-key, x-openrouter-key');
}

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function classifyKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return null;
  if (k.startsWith('gsk_')) return { provider: 'groq', key: k };
  if (k.startsWith('sk-or-')) return { provider: 'openrouter', key: k };
  if (k.startsWith('sk-')) return { provider: 'openai', key: k };
  return { provider: 'gemini', key: k };
}

function resolveProviderKeys(req) {
  const headerBox = classifyKey(req.headers['x-gemini-key']);
  const keys = {
    gemini: String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim(),
    groq: String(req.headers['x-groq-key'] || process.env.GROQ_API_KEY || '').trim(),
    openai: String(req.headers['x-openai-key'] || process.env.OPENAI_API_KEY || '').trim(),
    openrouter: String(req.headers['x-openrouter-key'] || process.env.OPENROUTER_API_KEY || '').trim(),
    preferred: null,
  };
  if (headerBox) {
    keys[headerBox.provider] = headerBox.key;
    keys.preferred = headerBox.provider;
  }
  return keys;
}

function getGeminiKey(req) {
  return resolveProviderKeys(req).gemini;
}

async function discoverFallbackModels(apiKey, mode, alreadyTried) {
  try {
    const resp = await fetch(`${GEMINI_BASE}?pageSize=100&key=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => null);
    const list = Array.isArray(data?.models) ? data.models : [];
    const candidates = list
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((name) => name && !alreadyTried.has(name));

    if (mode === 'image') {
      return candidates
        .filter((n) => /image|banana/i.test(n) && !/imagen/i.test(n))
        .reverse()
        .slice(0, 4);
    }
    return candidates
      .filter(
        (n) =>
          /^(gemini-|gemma-)/i.test(n) &&
          !/image|tts|audio|live|embedding|robotics|computer-use|1\.5|2\.0|deep-research|transcribe/i.test(n)
      )
      .reverse()
      .slice(0, 4);
  } catch {
    return [];
  }
}

async function callSingleGeminiModel(apiKey, model, body, timeoutMs = 42000, expectJson = false, disableThinkingCap = false) {
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let payload = body;
  if (/^gemma-/i.test(model) || /omni/i.test(model)) {
    const cfg = { ...(body.generationConfig || {}) };
    delete cfg.responseMimeType;
    delete cfg.thinkingConfig;
    cfg.maxOutputTokens = Math.max(cfg.maxOutputTokens || 4096, 6144);
    payload = { ...body, generationConfig: cfg };
  } else if (expectJson && !disableThinkingCap && /^gemini-3/i.test(model)) {
    // Cap Gemini 3.x reasoning latency (LOW keeps full spatial precision while responding in ~4-9s instead of 25-45s!)
    const cfg = { ...(body.generationConfig || {}) };
    if (!cfg.thinkingConfig) {
      cfg.thinkingConfig = { thinkingLevel: 'LOW' };
    }
    payload = { ...body, generationConfig: cfg };
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw error */
  }
  if (!resp.ok && resp.status === 400 && !disableThinkingCap && /thinking/i.test(text)) {
    return callSingleGeminiModel(apiKey, model, body, timeoutMs, expectJson, true);
  }
  if (resp.ok && json) {
    const parts = json?.candidates?.[0]?.content?.parts || [];
    if (parts.length > 0) {
      if (expectJson) {
        const parsed = parseJsonResponse(extractText(json));
        return { model, json, parsed };
      }
      return { model, json };
    }
  }
  const errMsg = json?.error?.message || text.slice(0, 140) || `HTTP ${resp.status}`;
  const err = new Error(`${model} (${resp.status}): ${errMsg.slice(0, 120)}`);
  err.status = resp.status;
  throw err;
}

async function callGeminiWithFallback(apiKey, models, body, mode = 'vision') {
  const statusMap = [];
  const errors = [];
  const tried = new Set();
  const recordErr = (model, e) => {
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|aborted/i.test(String(e?.message || ''));
    const st = e?.status || (isTimeout ? 'TIMEOUT' : /JSON/i.test(String(e?.message || '')) ? 'JSON' : 'ERR');
    statusMap.push(`${model}:${st}`);
    errors.push(e?.message || String(e));
  };

  // For Vision: race COMPLETELY SEPARATE serving pools in parallel waves -> beats 503 spikes & fits strictly <52s!
  if (mode === 'vision') {
    for (const wave of VISION_WAVES) {
      const waveModels = wave.filter((m) => !tried.has(m));
      if (waveModels.length === 0) continue;
      waveModels.forEach((m) => tried.add(m));
      try {
        const winner = await Promise.any(
          waveModels.map((m) =>
            callSingleGeminiModel(
              apiKey,
              m,
              body,
              /3\.5-flash$/.test(m) ? 22000 : /flash-lite/.test(m) ? 14000 : 18000,
              true
            ).catch((e) => {
              recordErr(m, e);
              throw e;
            })
          )
        );
        return winner;
      } catch {
        // Check if every failure was invalid API key (401/403) — fail fast
        if (errors.length > 0 && errors.every((m) => /\((401|403)\)/.test(m))) {
          throw new Error(errors[0]);
        }
      }
    }

    // One brief jittered retry wave if transient 503 high-demand spike hit every pool
    const had503 = statusMap.some((s) => s.endsWith(':503'));
    if (had503) {
      await new Promise((r) => setTimeout(r, 1800));
      try {
        return await Promise.any(
          ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemma-4-26b-a4b-it'].map((m) =>
            callSingleGeminiModel(apiKey, m, body, /^gemma-/i.test(m) ? 26000 : 12000, true).catch((e) => {
              recordErr(`${m}[retry]`, e);
              throw e;
            })
          )
        );
      } catch {
        /* fall through to summary */
      }
    }

    const summary = statusMap.join(', ');
    if (had503) {
      throw new Error(
        `Google Gemini ücretsiz kota sunucuları şu an yoğun (503). Birkaç saniye sonra tekrar deneyin veya API kutusuna ücretsiz Groq (gsk_...) / OpenAI (sk-...) anahtarı girin. [${summary}]`
      );
    }
    throw new Error(`Gemini Vision başarısız: ${summary || errors[0] || 'Bilinmeyen hata'}`);
  }

  // Image generation mode: sequential fallback across image models (32s budget prevents double-billing timed-out renders)
  for (const model of models) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      return await callSingleGeminiModel(apiKey, model, body, 32000, false);
    } catch (e) {
      errors.push(e.message || String(e));
      if (e.status === 401 || e.status === 403) throw e;
    }
  }
  throw new Error(errors.slice(0, 3).join(' | ') || 'Gemini görsel üretimi başarısız oldu.');
}

function extractInlineImage(json) {
  const candidates = json?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    for (const part of parts) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType || inline.mime_type || 'image/png';
        return `data:${mime};base64,${inline.data}`;
      }
    }
  }
  return null;
}

function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const visible = parts.filter((p) => !p.thought && typeof p.text === 'string');
  const source = visible.length > 0 ? visible : parts;
  return source.map((p) => p.text || '').join('\n').trim();
}

function parseJsonResponse(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        // Salvage truncated detectedObjects array if output hit token limit mid-item
        const slice = cleaned.slice(start);
        const arrIdx = slice.indexOf('"detectedObjects"');
        if (arrIdx !== -1) {
          const lastObjEnd = slice.lastIndexOf('},');
          const lastCompleteEnd = slice.lastIndexOf('}');
          const cutPos = lastObjEnd > arrIdx ? lastObjEnd + 1 : lastCompleteEnd > arrIdx ? lastCompleteEnd + 1 : -1;
          if (cutPos > arrIdx) {
            try {
              return JSON.parse(slice.slice(0, cutPos) + ']}');
            } catch {
              /* fall through */
            }
          }
        }
      }
    }
    throw new Error('Gemini JSON yanıtı ayrıştırılamadı.');
  }
}

const VALID_ARCHETYPES =
  '"sofa" | "armchair" | "coffee_table_round" | "coffee_table_rect" | "dining_table" | "dining_chair" | "desk" | "office_chair" | "vanity_table" | "bed_frame" | "nightstand" | "wardrobe" | "bookshelf" | "sideboard" | "console_table" | "tv_baza" | "tv_wall_unit" | "wall_tv" | "wall_shelf" | "linear_fireplace" | "fireplace_marble" | "decorative_vase" | "potted_plant" | "chandelier" | "floor_lamp" | "table_lamp" | "rug_custom" | "wall_mirror" | "wall_art" | "ottoman" | "stairs" | "ac_unit"';

async function callOpenAICompatibleVision({ endpoint, apiKey, models, prompt, imageDataUrls, label, extraHeaders = {} }) {
  if (!apiKey) throw new Error(`${label} anahtarı eksik.`);
  const content = [{ type: 'text', text: prompt }];
  for (const url of imageDataUrls) {
    if (url) content.push({ type: 'image_url', image_url: { url } });
  }
  const errs = [];
  for (const model of models) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify({
          model,
          temperature: 0.15,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(24000),
      });
      const txt = await r.text();
      if (!r.ok) {
        errs.push(`${label}/${model}:${r.status}`);
        continue;
      }
      const j = JSON.parse(txt);
      const out = j?.choices?.[0]?.message?.content;
      if (out) {
        return { model: `${label}:${model}`, parsed: parseJsonResponse(out) };
      }
    } catch (e) {
      errs.push(`${label}/${model}:${e?.name || 'ERR'}`);
    }
  }
  throw new Error(`${label} Vision başarısız: ${errs.join(', ')}`);
}

async function runMultiProviderVision({ keys, prompt, imageDataUrls, geminiBody }) {
  const runners = {};
  if (keys.gemini) {
    runners.gemini = async () => {
      const win = await callGeminiWithFallback(keys.gemini, VISION_MODELS, geminiBody, 'vision');
      return { model: win.model, parsed: win.parsed || parseJsonResponse(extractText(win.json)) };
    };
  }
  if (keys.groq) {
    runners.groq = () =>
      callOpenAICompatibleVision({
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: keys.groq,
        models: ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
        prompt,
        imageDataUrls,
        label: 'groq',
      });
  }
  if (keys.openai) {
    runners.openai = () =>
      callOpenAICompatibleVision({
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: keys.openai,
        models: ['gpt-4.1-mini', 'gpt-4o-mini'],
        prompt,
        imageDataUrls,
        label: 'openai',
      });
  }
  if (keys.openrouter) {
    runners.openrouter = () =>
      callOpenAICompatibleVision({
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: keys.openrouter,
        models: ['google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'meta-llama/llama-4-maverick'],
        prompt,
        imageDataUrls,
        label: 'openrouter',
        extraHeaders: { 'HTTP-Referer': 'https://mobilya-ar.vercel.app', 'X-Title': 'MekanAR Mimari' },
      });
  }

  // If user explicitly pasted a specific provider key in the UI box, try it first!
  if (keys.preferred && runners[keys.preferred]) {
    try {
      return await runners[keys.preferred]();
    } catch (prefErr) {
      const others = Object.entries(runners)
        .filter(([name]) => name !== keys.preferred)
        .map(([, fn]) => fn());
      if (others.length === 0) throw prefErr;
      return await Promise.any(others);
    }
  }

  const all = Object.values(runners).map((fn) => fn());
  if (all.length === 0) {
    throw new Error('Vision API anahtarı eksik (GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY veya OPENROUTER_API_KEY).');
  }
  return all.length === 1 ? await all[0] : await Promise.any(all);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query?.action || req.body?.action || 'config');

  if (action === 'config') {
    const key = getGeminiKey(req);
    const envGemini = Boolean(String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim());
    const envRunpod = Boolean(
      String(process.env.RUNPOD_API_KEY || '').trim() &&
        String(process.env.RUNPOD_3D_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID || '').trim()
    );
    let availableModels;
    if (req.query?.models === '1' && key) {
      try {
        const mr = await fetch(`${GEMINI_BASE}?pageSize=100&key=${encodeURIComponent(key)}`);
        const md = await mr.json().catch(() => null);
        availableModels = (md?.models || [])
          .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''));
      } catch {
        availableModels = [];
      }
    }
    return res.status(200).json({
      ok: true,
      geminiConfigured: envGemini,
      groqConfigured: Boolean(String(process.env.GROQ_API_KEY || '').trim()),
      openaiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
      openrouterConfigured: Boolean(String(process.env.OPENROUTER_API_KEY || '').trim()),
      runpodConfigured: envRunpod,
      visionModel: VISION_MODELS[0],
      imageModel: IMAGE_MODELS[0],
      ...(availableModels ? { availableModels } : {}),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Yalnızca POST desteklenir.' });
  }

  const keys = resolveProviderKeys(req);
  const apiKey = keys.gemini;
  if (!keys.gemini && !keys.groq && !keys.openai && !keys.openrouter) {
    return res.status(400).json({
      ok: false,
      error: 'Vision API anahtarı eksik. GEMINI_API_KEY, GROQ_API_KEY (ücretsiz) veya OPENAI_API_KEY ekleyin.',
    });
  }

  try {
    if (action === 'fetchImage') {
      const rawUrl = String(req.body?.url || '').trim();
      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        return res.status(400).json({ ok: false, error: 'Geçersiz görsel adresi.' });
      }
      if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ ok: false, error: 'Yalnızca HTTPS görsel adresleri desteklenir.' });
      }
      const host = parsedUrl.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host.endsWith('.local') ||
        /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1|\[::1\])/.test(host)
      ) {
        return res.status(400).json({ ok: false, error: 'Geçersiz görsel sunucusu.' });
      }
      const imgResp = await fetch(parsedUrl.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MekanAR/1.0)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!imgResp.ok) {
        return res.status(502).json({ ok: false, error: `Görsel alınamadı (HTTP ${imgResp.status}).` });
      }
      const ct = (imgResp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      if (!ct.startsWith('image/')) {
        return res.status(400).json({ ok: false, error: 'Sürüklenen bağlantı geçerli bir görsel değil.' });
      }
      const buf = Buffer.from(await imgResp.arrayBuffer());
      if (buf.byteLength > 10 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Görsel 10 MB sınırını aşıyor.' });
      }
      return res.status(200).json({
        ok: true,
        dataUrl: `data:${ct};base64,${buf.toString('base64')}`,
      });
    }

    if (action === 'analyze') {
      const { imageDataUrl, roomWidthM = 5.4, roomDepthM = 4.8, roomCeilingM = 2.85, userPrompt = '' } = req.body || {};
      const img = splitDataUrl(imageDataUrl);
      if (!img) {
        return res.status(400).json({ ok: false, error: 'Geçerli bir oda fotoğrafı gönderin.' });
      }

      const cleanFocus = String(userPrompt || '').trim();
      const focusDirective = cleanFocus
        ? `\nCRITICAL USER FOCUS & EXCLUSION INSTRUCTION (HIGHEST PRIORITY — OBEY STRICTLY, OVERRIDES ITEM COUNT RULES):\n"${cleanFocus}"\n- Detect ONLY the furniture/items requested by the user above (even if that means returning only 1, 2, or 3 items!).\n- STRICTLY EXCLUDE any clutter, flowers, vases, tabletop lamps, frames, rugs, or walls/items the user asked NOT to model.\n`
        : '';

      const prompt = `You are a senior interior architect and precision 3D spatial layout reconstruction expert.${focusDirective}
Analyze this interior room photo carefully and reconstruct EVERY architectural layer (including 2nd-floor mezzanines / lofts if present!) and ${cleanFocus ? 'ONLY the requested' : 'EVERY visible'} piece of furniture, lighting, rug, plant, mirror, artwork, and staircase with ACCURATE 3D floor-plan coordinates for a ${roomWidthM}m × ${roomDepthM}m room.

COORDINATE SYSTEM (CRITICAL — match the photo's spatial layout faithfully!):
- Imagine looking into the room from the front-open viewer side:
  * "north" wall = back-right / primary rear wall (z = -1.0)
  * "west" wall = back-left / left side wall (x = -1.0)
  * "east" wall = right side wall (x = +1.0)
  * "south" wall = front edge closest to viewer (z = +1.0)
- relativeX: -0.90 (left/west wall) to +0.90 (right/east wall)
- relativeZ: -0.90 (back/north wall) to +0.90 (front/south edge)
- facingDeg: 0 = faces +Z (front/south), 180 = faces -Z (back/north), 90 = faces +X (east/right), -90 = faces -X (west/left).
  * Example: a bed whose headboard touches the north/back wall has suggestedWall="north", facingDeg=0.
  * Example: a staircase climbing from front (+Z) up to a north mezzanine has facingDeg=0 (treads rise from +Z toward -Z).
- floorLevel: 0 = ground floor, 1 = UPPER 2ND FLOOR / MEZZANINE PLATFORM! (Only use 1 if hasMezzanine is true!)

Return ONLY valid JSON with this exact schema:
{
  "roomStyle": {
    "styleNameTr": "string (e.g. Modern Çıtalı TV Duvarlı Salon)",
    "summaryTr": "string (1 concise Turkish sentence describing the ambiance, wall panels & layout)",
    "wallColorHex": "#RRGGBB",
    "accentWallColorHex": "#RRGGBB",
    "accentWall": "north" | "west" | "east" | "south" (which wall has the primary feature cladding/motif — usually "north" for TV/fireplace/bed walls!),
    "wallPattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror",
    "perWallFinishes": {
      "north": { "colorHex": "#RRGGBB", "pattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror" },
      "west": { "colorHex": "#RRGGBB", "pattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror" },
      "east": { "colorHex": "#RRGGBB", "pattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror" }
    },
    "wallZones": [
      {
        "wall": "north" | "west" | "east" | "south",
        "labelTr": "short Turkish label (e.g. Ahşap Akustik Çıta Panel, TV Arkası Mermer/Beton Panel, Duvar Çıta Motifi)",
        "startRatio": number (0.0 left edge to 1.0 right edge along that wall),
        "endRatio": number (0.0 to 1.0, must be > startRatio),
        "bottomCm": number (0 for floor-to-ceiling panel),
        "heightCm": number (285 for full height),
        "pattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror",
        "colorHex": "#RRGGBB"
      }
    ],
    "floorMaterial": "herringbone_oak" | "plank_oak" | "plank_walnut" | "travertine" | "marble" | "microcement" | "terrazzo",
    "floorTintHex": "#RRGGBB",
    "curtainColorHex": "#RRGGBB",
    "curtainStyle": "none" | "sheer_and_drape" | "sheer_only" | "roman_blind",
    "suggestedSunHour": number (between 9 and 18),
    "suggestedCeilingCm": number (285 for normal 1-story room, 410 for 2-story mezzanine/loft),
    "hasVisibleWindow": boolean (true if exterior window OR floor-to-ceiling window curtains are clearly visible in the photo),
    "primaryWindowWall": "north" | "west" | "east" | "south",
    "windowWalls": ["east"] (array of ALL walls visibly covered by windows or floor-to-ceiling curtains, e.g. ["west","north"] for corner curtains, [] if none),
    "hasCeilingLedCove": boolean (true if recessed warm LED ceiling cove / perimeter lighting is visible),
    "hasMezzanine": boolean,
    "mezzanine": {
      "anchorWall": "north" | "east" | "west" | "south",
      "heightCm": number (typically 195..220 for 2-story loft deck top),
      "depthRatio": number (0.45..0.62 fraction of room depth),
      "widthRatio": number (0.65..1.0; use ~0.76 if stairs climb on one side!),
      "stairGapSide": "west" | "east" | "none",
      "railingStyle": "none" | "glass" | "metal",
      "deckColorHex": "#RRGGBB"
    }
  },
  "detectedObjects": [
    {
      "id": "unique-slug",
      "nameTr": "short descriptive Turkish name (e.g. Zeytin Yeşili Yatak, Konyak Ofis Koltuğu, Çalışma Masası, Siyah Yuvarlak Sehpa, Merdiven, Makyaj Masası, Yuvarlak Duvar Aynası)",
      "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
      "parametricKind": ${VALID_ARCHETYPES},
      "primaryColorHex": "#RRGGBB (EXACT main color of this specific item in the photo)",
      "accentColorHex": "#RRGGBB (secondary/leg/frame/cushion/pot color of this item)",
      "box2d": [ymin, xmin, ymax, xmax],
      "widthCm": number,
      "depthCm": number,
      "heightCm": number,
      "mountMode": "floor" | "wall" | "ceiling" | "rug",
      "suggestedWall": "north" | "south" | "west" | "east" | "center",
      "floorLevel": 0 | 1,
      "elevationCm": number (height above ITS OWN FLOOR LEVEL: 0 for floor/rug, ~105-135 for wall art/mirror/TV),
      "anchorToId": "optional id of parent object (e.g. lamp on nightstand, memo board above mirror, art above bed, chair in front of desk) or empty string",
      "relation": "none" | "above" | "on_top_of" | "left_of" | "right_of" | "in_front_of",
      "relativeX": number (-0.90 to 0.90),
      "relativeZ": number (-0.90 to 0.90),
      "facingDeg": number (0, 90, -90, or 180),
      "visualDescriptionEn": "max 10 words describing exact look/material"
    }
  ]
}

RULES (Output ONLY compact valid JSON immediately, NO prose, NO markdown):
- ${cleanFocus ? 'STRICTLY follow the USER FOCUS & EXCLUSION INSTRUCTION above: return ONLY the requested item(s) (1..12 items) and NEVER include excluded decor/clutter.' : 'Detect 8 to 15 distinct REAL visible items in the room (NEVER invent items that aren\'t there, and DO NOT confuse objects seen ONLY inside a mirror reflection as being on the same wall as the mirror — either skip faint reflection-only clutter or place clearly reflected opposite-wall items on the OPPOSITE wall like "south" or "west"!).'}
- WALL MOTIFS & FEATURE PANELS (CRITICAL — DO NOT MISS!):
  * Carefully inspect EVERY visible wall for decorative wall moldings/frames ("boiserie"), vertical acoustic wood slats ("slats"), marble/travertine slabs ("marble"), textured concrete panels ("concrete"), natural stone ("stone"), or wood cladding!
  * If ONLY PART of a wall has cladding (for example: wood slats on the right 35% of the north TV wall while left 65% is plain white, OR a central concrete/marble slab behind the TV flanked by dark walnut wood panels on left & right), emit exact entries in roomStyle.wallZones with accurate startRatio..endRatio (0.0..1.0)!
  * If an entire wall has boiserie frames or motifs, set perWallFinishes[wall].pattern = "boiserie" AND accentWall = that wall!
- TV WALL, LOW BAZA & FIREPLACE RULES (CRITICAL!):
  * Low horizontal TV console / floating media baza beneath a TV (heightCm 28..55): ALWAYS use parametricKind="tv_baza" (with elevationCm=12..22 if floating off the floor, or 0 if resting on floor), mountMode="wall", suggestedWall="north" (or whichever wall the TV is on)!
  * Low horizontal fireplace console / bench WITH a linear flame strip (heightCm 35..65): ALWAYS use parametricKind="linear_fireplace" — NEVER use "fireplace_marble" for a low horizontal fireplace!
  * Tall floor-to-ceiling marble chimney tower (heightCm 220..280): ONLY then use parametricKind="fireplace_marble"!
  * Separate wall-mounted TV above a tv_baza or linear_fireplace: ALWAYS emit BOTH the baza/fireplace AND a separate "wall_tv" with anchorToId="<baza id>", relation="above", elevationCm=95..120!
  * Floating wall shelves / open wood cubby boxes beside a TV panel: use parametricKind="wall_shelf", mountMode="wall", with exact elevationCm (e.g. 125, 185)!
- TABLETOP FLOWERS, VASES & LAMPS ON TOP OF FURNITURE:
  * Small flowers, vases, candle trays, bowls sitting ON TOP of a TV baza, coffee table, console, or dining table: use parametricKind="decorative_vase" (compact widthCm 18..38, heightCm 18..42), anchorToId="<parent id>", relation="on_top_of"!
  * Small table lamps sitting on a TV baza or nightstand: parametricKind="table_lamp", anchorToId="<parent id>", relation="on_top_of"!
  * ONLY tall floor-standing trees/palms in corners (heightCm 75..180, elevationCm=0) should use parametricKind="potted_plant"!
- SAME-WALL ADJACENCY (CRITICAL!): If multiple items appear side-by-side on the SAME primary photographed wall (for example: full-length mirror on left + framed board directly above mirror + hanging ivy/art on right + bed pushed against that wall), they MUST ALL share the EXACT SAME suggestedWall ("north") with matching left-to-right relativeX (-0.75 left -> +0.75 right)!
- VERTICAL STACKING & MIRRORS:
  * Tall full-length floor-standing mirror ("Boy Aynası" or "Kemerli Boy Aynası" if arch-topped!, heightCm 155..200): mountMode="wall", elevationCm=0!
  * NEVER hallucinate lamps, doors, or sofas visible ONLY inside a mirror's reflection!
  * Framed art/board hanging DIRECTLY ABOVE a mirror or bed: SAME suggestedWall AND SAME relativeX as the item below it, with elevationCm=180 (above tall mirror) or elevationCm=110..135 (above bed/sofa)!
  * Hanging ivy/wall tapestry behind a bed: parametricKind="wall_art", mountMode="wall", SAME suggestedWall and relativeX as the bed, elevationCm=85!
- CURTAINS & WINDOWS: If floor-to-ceiling curtains cover a wall (or TWO corner walls like west + north!), set hasVisibleWindow=true, list ALL curtained walls in windowWalls (e.g. ["east"] or ["west","north"]), and set curtainStyle="sheer_only" for white sheer curtains or "sheer_and_drape" for layered curtains! NEVER emit curtains or windows inside detectedObjects — they are rendered automatically from roomStyle.windowWalls!
- WALL-ANCHORED FURNITURE: For bed_frame, sofa, desk, bookshelf, wardrobe, sideboard, console_table, vanity_table, nightstand that sit against a wall, ALWAYS set suggestedWall ("north"|"east"|"west"|"south") and facingDeg pointing INTO the room away from that wall (north->0, south->180, west->90, east->-90).
- TRUE BED COLORS: For bed_frame, primaryColorHex MUST be the MAIN DUVET/BEDDING color (e.g. white duvet -> #f4f2ed, olive duvet -> #4c5942), and accentColorHex MUST be the WOOD/BEDFRAME color (e.g. natural wood pallet -> #b88f64). NEVER use a tiny accent throw pillow's color as the entire bed's primaryColorHex!
- If the room is a 2-story loft/mezzanine: set hasMezzanine=true, suggestedCeilingCm=410, tag EVERY upstairs object with floorLevel=1 and EVERY downstairs object with floorLevel=0!
- box2d: integers 0..1000 [ymin, xmin, ymax, xmax] tightly enclosing the item.`;

      const { model: modelUsed, parsed } = await runMultiProviderVision({
        keys,
        prompt,
        imageDataUrls: [imageDataUrl],
        geminiBody: {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, { inlineData: { mimeType: img.mimeType, data: img.data } }],
            },
          ],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 6144,
            responseMimeType: 'application/json',
          },
        },
      });

      return res.status(200).json({
        ok: true,
        model: modelUsed,
        roomStyle: parsed.roomStyle || null,
        detectedObjects: Array.isArray(parsed.detectedObjects) ? parsed.detectedObjects : [],
      });
    }

    if (action === 'verifyAndRefine') {
      const {
        originalPhotoDataUrl,
        rendered3dDataUrl,
        roomSummary = '',
        roomWidthM = 5.4,
        roomDepthM = 4.8,
        roomCeilingM = 2.85,
        placedObjects = [],
        userPrompt = '',
      } = req.body || {};

      const origImg = splitDataUrl(originalPhotoDataUrl);
      const renImg = splitDataUrl(rendered3dDataUrl);
      if (!origImg || !renImg) {
        return res.status(400).json({ ok: false, error: 'Doğrulama için orijinal fotoğraf ve 3B sahne görüntüsü gerekli.' });
      }

      const cleanFocus = String(userPrompt || '').trim();
      const focusVerifyRule = cleanFocus
        ? `\nCRITICAL USER FOCUS CONSTRAINT (OBEY STRICTLY):\n"${cleanFocus}"\n- Score matchScore ONLY on how accurately the requested target item(s) match Image 1.\n- NEVER add excluded decor/clutter (flowers, lamps, frames, rugs, etc.) into missingObjects and NEVER penalize matchScore for items the user intentionally excluded!\n`
        : '';

      const compactList = Array.isArray(placedObjects)
        ? placedObjects.slice(0, 24).map((o) => {
            const fl = o.floorLevel === 1 ? 1 : 0;
            // Send relative elevation above the object's OWN floor level so 2nd-floor items report 0cm (not 205cm)!
            const floorBaseM = fl === 1 && Number(o.y || 0) >= 1.5 ? (Number(o.y) >= 2.6 ? 2.05 : Number(o.y)) : 0;
            const relElevCm = Math.max(0, Math.round(((o.y || 0) - (fl === 1 ? floorBaseM : 0)) * 100));
            return {
              id: o.id,
              name: o.name,
              kind: o.parametricKind || 'glb',
              wall: o.attachedWall || 'center',
              floorLevel: fl,
              relativeX: Number(((o.x || 0) / Math.max(0.5, roomWidthM * 0.45)).toFixed(2)),
              relativeZ: Number(((o.z || 0) / Math.max(0.5, roomDepthM * 0.45)).toFixed(2)),
              elevationCm: relElevCm,
              facingDeg: Math.round((((o.rot || 0) * 180) / Math.PI) % 360),
              widthCm: Math.round((o.widthM || 1) * 100),
              depthCm: Math.round((o.depthM || 1) * 100),
              heightCm: Math.round((o.heightM || 1) * 100),
              colorHex: o.parametricColorHex || o.tintHex || '',
            };
          })
        : [];

      const refinePrompt = `You are a strict Senior Interior Architecture QA Inspector.${focusVerifyRule}
Compare Image 1 (the TARGET inspiration room photo) with Image 2 (our CURRENT 3D studio reconstruction).
Current room metadata: ${roomSummary} (${roomWidthM}m × ${roomDepthM}m × ${roomCeilingM}m).
Current placed 3D objects JSON:
${JSON.stringify(compactList)}

YOUR JOB — Audit Image 2 strictly against Image 1 and make SURGICAL, NON-DESTRUCTIVE fixes for real layout, wall, floor-level, rotation, proportion, window, or color mismatches:
- Check if a stale window/curtain is blocking wall art or shouldn't exist -> set roomFixes.removeWindows = true.
- Check if Image 1 is a 2-story loft/mezzanine but Image 2 missed the 2nd floor -> set roomFixes.enableMezzanine = true.
- Check EVERY placed object in the JSON list:
  * Is any object on the WRONG wall, floating off the floor when it should sit on the floor (e.g. full-length mirror -> elevationCm: 0), facing backwards, overlapping badly, wrong floorLevel (0 vs 1), wrong proportion, or wrong main color? Add an "update" entry in objectFixes with its EXACT existing "id"!
  * Is any object a hallucination (e.g. mirror reflection artifact or nonexistent piece)? Add { "id": "...", "action": "remove", "reasonTr": "..." }!
- ${cleanFocus ? 'ONLY add missingObjects if a piece EXPLICITLY requested by the user prompt is missing; otherwise keep missingObjects as [].' : 'Check if up to 3 MAJOR clearly visible hero items from Image 1 (like an armchair, coffee table, rug, lamp, plant, nightstand, bookcase, framed art) are completely missing from Image 2 -> add them to missingObjects!'}
- STABILITY RULE (CRITICAL): If an object is ALREADY reasonably placed on the right wall/zone in Image 2, DO NOT move, flip, or remove it — preserve good placements so visual accuracy strictly improves!

Return ONLY valid JSON:
{
  "matchScore": number (0..100 honest visual similarity score of Image 2 BEFORE your fixes),
  "critiqueTr": "1-2 concise Turkish sentences stating what already matches well and exactly what your fixes corrected",
  "roomFixes": {
    "removeWindows": boolean,
    "wallColorHex": "#RRGGBB" | null,
    "accentWall": "north" | "west" | "east" | "south" | null,
    "wallPattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper" | "marble" | "mirror" | null,
    "floorTintHex": "#RRGGBB" | null,
    "enableMezzanine": boolean | null,
    "mezzanineHeightCm": number | null
  },
  "objectFixes": [
    {
      "id": "EXACT id from Current placed 3D objects JSON",
      "action": "update" | "remove",
      "wall": "north" | "south" | "west" | "east" | "center",
      "floorLevel": 0 | 1,
      "relativeX": number (-0.90 to 0.90),
      "relativeZ": number (-0.90 to 0.90),
      "elevationCm": number (above its own floor level),
      "facingDeg": number (0, 90, -90, or 180),
      "widthCm": number,
      "depthCm": number,
      "heightCm": number,
      "primaryColorHex": "#RRGGBB",
      "accentColorHex": "#RRGGBB",
      "reasonTr": "max 8 words Turkish reason"
    }
  ],
  "missingObjects": [
    {
      "id": "missing-slug",
      "nameTr": "Turkish name",
      "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
      "parametricKind": ${VALID_ARCHETYPES},
      "primaryColorHex": "#RRGGBB",
      "accentColorHex": "#RRGGBB",
      "box2d": [ymin, xmin, ymax, xmax],
      "widthCm": number,
      "depthCm": number,
      "heightCm": number,
      "mountMode": "floor" | "wall" | "ceiling" | "rug",
      "suggestedWall": "north" | "south" | "west" | "east" | "center",
      "floorLevel": 0 | 1,
      "elevationCm": number,
      "anchorToId": "",
      "relation": "none" | "above" | "on_top_of" | "left_of" | "right_of" | "in_front_of",
      "relativeX": number,
      "relativeZ": number,
      "facingDeg": number,
      "visualDescriptionEn": "max 10 words"
    }
  ]
}`;

      const { model: modelUsed, parsed } = await runMultiProviderVision({
        keys,
        prompt: refinePrompt,
        imageDataUrls: [originalPhotoDataUrl, rendered3dDataUrl],
        geminiBody: {
          contents: [
            {
              role: 'user',
              parts: [
                { text: refinePrompt },
                { inlineData: { mimeType: origImg.mimeType, data: origImg.data } },
                { inlineData: { mimeType: renImg.mimeType, data: renImg.data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.12,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        },
      });

      return res.status(200).json({
        ok: true,
        model: modelUsed,
        matchScore: typeof parsed.matchScore === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.matchScore))) : 80,
        critiqueTr: String(parsed.critiqueTr || '3B sahne orijinal fotoğrafla karşılaştırılarak kalibre edildi.'),
        roomFixes: parsed.roomFixes || null,
        objectFixes: Array.isArray(parsed.objectFixes) ? parsed.objectFixes : [],
        missingObjects: Array.isArray(parsed.missingObjects) ? parsed.missingObjects.slice(0, 4) : [],
      });
    }

    if (action === 'identifyCrop') {
      const { croppedImageDataUrl, fullRoomImageDataUrl } = req.body || {};
      const cropImg = splitDataUrl(croppedImageDataUrl);
      const fullImg = splitDataUrl(fullRoomImageDataUrl);
      if (!cropImg) {
        return res.status(400).json({ ok: false, error: 'Kırpılmış alan görseli eksik.' });
      }
      const cropPrompt = `You are an interior architect. Identify the SINGLE primary furniture or decor object shown in Image 1 (cropped from the room in Image 2).
Return ONLY valid JSON:
{
  "nameTr": "short descriptive Turkish name (e.g. Saksılı Zeytin Ağacı, Metal Çerçeveli Kitaplık, Yuvarlak Duvar Aynası)",
  "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
  "parametricKind": ${VALID_ARCHETYPES},
  "primaryColorHex": "#RRGGBB (exact dominant color of this item)",
  "accentColorHex": "#RRGGBB (secondary/leg/frame/pot color)",
  "widthCm": number,
  "depthCm": number,
  "heightCm": number,
  "mountMode": "floor" | "wall" | "ceiling" | "rug",
  "elevationCm": number,
  "visualDescriptionEn": "concise accurate English visual description of this exact object"
}`;
      const parts = [
        { text: cropPrompt },
        { inlineData: { mimeType: cropImg.mimeType, data: cropImg.data } },
      ];
      if (fullImg) parts.push({ inlineData: { mimeType: fullImg.mimeType, data: fullImg.data } });

      const { model: modelUsed, parsed } = await runMultiProviderVision({
        keys,
        prompt: cropPrompt,
        imageDataUrls: [croppedImageDataUrl, fullRoomImageDataUrl].filter(Boolean),
        geminiBody: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 1536,
            responseMimeType: 'application/json',
          },
        },
      });
      return res.status(200).json({ ok: true, model: modelUsed, item: parsed });
    }

    if (action === 'isolate') {
      const {
        fullRoomImageDataUrl,
        croppedImageDataUrl,
        nameTr,
        category,
        visualDescriptionEn,
        widthCm,
        depthCm,
        heightCm,
      } = req.body || {};

      const fullImg = splitDataUrl(fullRoomImageDataUrl);
      const cropImg = splitDataUrl(croppedImageDataUrl);
      if (!cropImg && !fullImg) {
        return res.status(400).json({ ok: false, error: 'İzole edilecek nesne görseli eksik.' });
      }

      const parts = [
        {
          text: `You are an expert 3D product asset photographer preparing a reference photo for 3D mesh reconstruction (Hunyuan3D).
Image 1 is the cropped target item ("${nameTr || category}") from the interior photo.${fullImg ? ' Image 2 is the full room context.' : ''}
Item specification: ${visualDescriptionEn || nameTr || category}. Approximate size: ${widthCm || 160}x${depthCm || 80}x${heightCm || 85} cm.

TASK:
Generate ONE crystal-clear, unobstructed 3D studio product render of THIS EXACT ITEM — preserving its exact design, shape, proportions, color, fabric/wood/marble texture, legs, and details — completely isolated on a pure uniform solid white (#FFFFFF) background.

CRITICAL RULES:
- Must look IDENTICAL to the target item in the reference photo (do NOT invent a different style or generic substitute).
- Remove ALL other room furniture, foreground coffee tables, overlapping cushions from other items, rugs, walls, floor shadows, and clutter.
- Reconstruct any partially occluded bottom legs or corners faithfully to match the item's design.
- Show the complete item from head to foot with small white margin around all 4 edges, slight natural 3/4 front view, clean neutral softbox lighting, ZERO cast floor shadow, ZERO wall behind it, pure #FFFFFF background.`,
        },
      ];
      if (cropImg) parts.push({ inlineData: { mimeType: cropImg.mimeType, data: cropImg.data } });
      if (fullImg) parts.push({ inlineData: { mimeType: fullImg.mimeType, data: fullImg.data } });

      const { model, json } = await callGeminiWithFallback(
        apiKey,
        IMAGE_MODELS,
        {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        },
        'image'
      );

      const studioImageDataUrl = extractInlineImage(json);
      if (!studioImageDataUrl) {
        return res.status(502).json({
          ok: false,
          error: 'Gemini görsel izolasyonu çıktı üretmedi — lütfen tekrar deneyin veya kırpmayı genişletin.',
        });
      }

      return res.status(200).json({
        ok: true,
        model,
        studioImageDataUrl,
      });
    }

    if (action === 'photorealRender') {
      const { snapshotDataUrl, styleNote = '', roomSummary = '' } = req.body || {};
      const snap = splitDataUrl(snapshotDataUrl);
      if (!snap) {
        return res.status(400).json({ ok: false, error: '3B sahne görüntüsü alınamadı.' });
      }

      const { model, json } = await callGeminiWithFallback(
        apiKey,
        IMAGE_MODELS,
        {
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Convert this 3D architectural viewport screenshot into an ultra-photorealistic V-Ray / Corona interior architectural photograph (Architectural Digest quality).
STRICT GEOMETRY & COMPOSITION PRESERVATION RULES:
- Keep EVERY wall, partial wall panel (wood slats, concrete slab, marble, boiserie), window shape/count, door, column, ceiling beam, recessed curtain cove, hidden warm LED strip, sunlight beam direction, and EVERY furniture & decor item in the EXACT same position, color, and proportions.
- NEVER add extra unrequested furniture, people, watermarks, text labels, or UI bars — output 100% pure full-bleed architectural photography.
- Upgrade ONLY realism and light physics: physically accurate global illumination, soft window daylight bounce, crisp natural wood parquet grain, realistic bouclé/velvet/linen fabric weave, authentic stone/concrete patina, natural sheer curtain translucency, warm cove LED glow, realistic glass reflections, 24mm tilt-shift architectural camera lens.
Room context: ${roomSummary}
Lighting & styling direction: ${styleNote || 'Doğal gün ışığı, sıcak mimari atmosfer, foto-gerçekçi malzeme kalitesi.'}`,
                },
                { inlineData: { mimeType: snap.mimeType, data: snap.data } },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        },
        'image'
      );

      const renderImageDataUrl = extractInlineImage(json);
      if (!renderImageDataUrl) {
        return res.status(502).json({ ok: false, error: 'Fotogerçekçi render üretilemedi.' });
      }

      return res.status(200).json({
        ok: true,
        model,
        renderImageDataUrl,
      });
    }

    return res.status(400).json({ ok: false, error: `Bilinmeyen işlem: ${action}` });
  } catch (err) {
    const msg =
      err && typeof err === 'object' && Array.isArray(err.errors)
        ? err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join(' | ')
        : err instanceof Error
        ? err.message
        : 'Pinterest AI işleminde sunucu hatası.';
    return res.status(500).json({
      ok: false,
      error: msg.slice(0, 520),
    });
  }
}
