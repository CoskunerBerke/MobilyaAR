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
// Parallel racing waves across COMPLETELY DISTINCT serving pools (eliminates 503 high-demand stalls!)
// Wave 1 races all 8 distinct Gemini Flash / Flash-Lite generations simultaneously at t=0s!
// Wave 2 races Gemma 4 MoE + Gemini 3 Preview + Hydrogen + Omni + 2.5 Flash if Wave 1 spikes.
const VISION_WAVES = [
  [
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
  ],
  [
    'gemma-4-26b-a4b-it',
    'gemma-4-31b-it',
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
    'gemini-4-hydrogen',
    'gemini-omni-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
];
const VISION_MODELS = VISION_WAVES.flat();
const IMAGE_MODELS = [
  'gemini-nano-banana-2.1',
  'gemini-3.1-flash-lite-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-key, x-openai-key');
}

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function getGeminiKey(req) {
  const fromHeader = String(req.headers['x-gemini-key'] || '').trim();
  const fromEnv = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
  if (fromHeader && !fromHeader.startsWith('sk-')) return fromHeader;
  return fromEnv;
}

function getOpenAIKey(req) {
  const explicit = String(req.headers['x-openai-key'] || '').trim();
  const fromGeminiBox = String(req.headers['x-gemini-key'] || '').trim();
  const fromEnv = String(process.env.OPENAI_API_KEY || '').trim();
  if (explicit) return explicit;
  if (fromGeminiBox.startsWith('sk-')) return fromGeminiBox;
  return fromEnv;
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

async function callSingleGeminiModel(apiKey, model, body, timeoutMs = 42000, expectJson = false) {
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let payload = body;
  if (/^gemma-/i.test(model) || /omni/i.test(model)) {
    const cfg = { ...(body.generationConfig || {}) };
    delete cfg.responseMimeType;
    delete cfg.thinkingConfig;
    cfg.maxOutputTokens = Math.max(cfg.maxOutputTokens || 4096, 6144);
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
  const errors = [];
  const tried = new Set();

  // For Vision: race COMPLETELY SEPARATE serving pools in parallel waves -> beats 503 spikes!
  if (mode === 'vision') {
    for (const wave of VISION_WAVES) {
      const waveModels = wave.filter((m) => !tried.has(m));
      if (waveModels.length === 0) continue;
      waveModels.forEach((m) => tried.add(m));
      try {
        const winner = await Promise.any(
          waveModels.map((m) =>
            callSingleGeminiModel(apiKey, m, body, /^gemma-/i.test(m) ? 38000 : 18000, true).catch((e) => {
              errors.push(e.message || String(e));
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
    const discovered = await discoverFallbackModels(apiKey, 'vision', tried);
    if (discovered.length > 0) {
      try {
        return await Promise.any(
          discovered.map((m) =>
            callSingleGeminiModel(apiKey, m, body, 14000, true).catch((e) => {
              errors.push(e.message || String(e));
              throw e;
            })
          )
        );
      } catch {
        /* fall through */
      }
    }
    throw new Error(errors.join(' | ').slice(0, 480) || 'Gemini Vision sunucuları şu an yoğun, lütfen 5 saniye sonra tekrar deneyin.');
  }

  // Image generation mode: sequential fallback across image models
  for (const model of models) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      return await callSingleGeminiModel(apiKey, model, body, 18000, false);
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
  '"sofa" | "armchair" | "coffee_table_round" | "coffee_table_rect" | "dining_table" | "dining_chair" | "desk" | "office_chair" | "vanity_table" | "bed_frame" | "nightstand" | "wardrobe" | "bookshelf" | "sideboard" | "console_table" | "tv_wall_unit" | "wall_tv" | "fireplace_marble" | "potted_plant" | "chandelier" | "floor_lamp" | "table_lamp" | "rug_custom" | "wall_mirror" | "wall_art" | "ottoman" | "stairs" | "ac_unit"';

async function callOpenAIVisionBackup(prompt, imageDataUrls, openAiKeyOverride = '') {
  const openAiKey = String(openAiKeyOverride || process.env.OPENAI_API_KEY || '').trim();
  if (!openAiKey) return null;
  const content = [{ type: 'text', text: prompt }];
  for (const url of imageDataUrls) {
    if (url) content.push({ type: 'image_url', image_url: { url } });
  }
  for (const model of ['gpt-4.1-mini', 'gpt-4o-mini']) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        }),
        signal: AbortSignal.timeout(24000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const txt = j?.choices?.[0]?.message?.content;
      if (txt) return { model: `openai:${model}`, text: txt };
    } catch {
      /* try next */
    }
  }
  return null;
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
      openaiConfigured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
      runpodConfigured: envRunpod,
      visionModel: VISION_MODELS[0],
      imageModel: IMAGE_MODELS[0],
      ...(availableModels ? { availableModels } : {}),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Yalnızca POST desteklenir.' });
  }

  const rawHeaderKey = String(req.headers['x-gemini-key'] || '').trim();
  const apiKey = getGeminiKey(req);
  const openAiKey = getOpenAIKey(req);
  const preferOpenAI = rawHeaderKey.startsWith('sk-') || Boolean(String(req.headers['x-openai-key'] || '').trim());
  if (!apiKey && !openAiKey) {
    return res.status(400).json({
      ok: false,
      error: 'Gemini veya OpenAI API anahtarı eksik. Vercel ortam değişkenine GEMINI_API_KEY (veya OPENAI_API_KEY) ekleyin.',
    });
  }

  try {
    if (action === 'analyze') {
      const { imageDataUrl, roomWidthM = 5.4, roomDepthM = 4.8, roomCeilingM = 2.85 } = req.body || {};
      const img = splitDataUrl(imageDataUrl);
      if (!img) {
        return res.status(400).json({ ok: false, error: 'Geçerli bir oda fotoğrafı gönderin.' });
      }

      const prompt = `You are a senior interior architect and meticulous 3D spatial object detector.
Perform an EXHAUSTIVE inventory of EVERY distinct visible furniture piece, lighting fixture, rug, plant, mirror, framed wall artwork, shelving unit, and interior architectural element in this inspiration photo to faithfully recreate the room inside a ${roomWidthM}m × ${roomDepthM}m × ${roomCeilingM}m 3D studio.

Return ONLY valid JSON with this exact schema:
{
  "roomStyle": {
    "styleNameTr": "string (e.g. Modern Minimalist Loft)",
    "summaryTr": "string (1 concise Turkish sentence describing the ambiance)",
    "wallColorHex": "#RRGGBB",
    "accentWallColorHex": "#RRGGBB",
    "wallPattern": "smooth" | "boiserie" | "slats" | "concrete" | "stone" | "wallpaper",
    "floorMaterial": "herringbone_oak" | "plank_oak" | "plank_walnut" | "travertine" | "marble" | "microcement" | "terrazzo",
    "floorTintHex": "#RRGGBB",
    "curtainColorHex": "#RRGGBB",
    "suggestedSunHour": number (between 9 and 18)
  },
  "detectedObjects": [
    {
      "id": "unique-slug",
      "nameTr": "short descriptive Turkish name (e.g. Mavi Yemek Masası, Yeşil Keten Berjer, Saksılı Zeytin Ağacı, Yuvarlak Duvar Aynası, Mermer Şömine Ünitesi)",
      "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
      "parametricKind": ${VALID_ARCHETYPES},
      "primaryColorHex": "#RRGGBB (EXACT main color of this specific item in the photo, e.g. blue table -> #2b5b84, green armchair -> #3e523a, oak desk -> #c6a57c, black coffee table -> #232325)",
      "accentColorHex": "#RRGGBB (secondary/leg/frame/cushion/planter color of this item)",
      "box2d": [ymin, xmin, ymax, xmax],
      "widthCm": number,
      "depthCm": number,
      "heightCm": number,
      "mountMode": "floor" | "wall" | "ceiling" | "rug",
      "suggestedWall": "north" | "south" | "west" | "east" | "center",
      "elevationCm": number,
      "relativeX": number (-0.85 to 0.85, where -1 is west wall and +1 is east wall),
      "relativeZ": number (-0.85 to 0.85, where -1 is north wall and +1 is south wall),
      "facingDeg": number (0 faces +Z south, 180 faces -Z north, 90 faces +X east, -90 faces -X west),
      "visualDescriptionEn": "max 10 words describing exact look/material"
    }
  ]
}

RULES (Output ONLY compact valid JSON immediately, NO prose, NO markdown):
- Detect 8 to 14 distinct visible items across the whole room: hero furniture (bed, sofa, fireplace, TV, desk, dining table, cabinets, stairs), seating/tables (armchair, chair, coffee table, nightstand, vanity), rugs, lighting, plants, mirrors, framed art.
- Pick exact closest parametricKind and TRUE primaryColorHex + accentColorHex from the photo.
- box2d: integers 0..1000 [ymin, xmin, ymax, xmax] tightly enclosing the item.
- Realistic cm dimensions and non-overlapping layout matching the photo.`;

      let modelUsed = '';
      let parsed = null;
      const runGeminiAnalyze = async () => {
        const win = await callGeminiWithFallback(
          apiKey,
          VISION_MODELS,
          {
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
          'vision'
        );
        return { model: win.model, parsed: win.parsed || parseJsonResponse(extractText(win.json)) };
      };
      const runOpenAIAnalyze = async () => {
        const oa = await callOpenAIVisionBackup(prompt, [imageDataUrl], openAiKey);
        if (!oa) throw new Error('OpenAI Vision yanıt vermedi.');
        return { model: oa.model, parsed: parseJsonResponse(oa.text) };
      };

      if (preferOpenAI && openAiKey) {
        try {
          const out = await runOpenAIAnalyze();
          modelUsed = out.model;
          parsed = out.parsed;
        } catch (oaErr) {
          if (!apiKey) throw oaErr;
          const out = await runGeminiAnalyze();
          modelUsed = out.model;
          parsed = out.parsed;
        }
      } else if (apiKey && openAiKey) {
        // Race Gemini pool AND OpenAI Vision simultaneously — guaranteed 2-4s response even during 503 peaks!
        const out = await Promise.any([runGeminiAnalyze(), runOpenAIAnalyze()]);
        modelUsed = out.model;
        parsed = out.parsed;
      } else if (apiKey) {
        const out = await runGeminiAnalyze();
        modelUsed = out.model;
        parsed = out.parsed;
      } else {
        const out = await runOpenAIAnalyze();
        modelUsed = out.model;
        parsed = out.parsed;
      }

      return res.status(200).json({
        ok: true,
        model: modelUsed,
        roomStyle: parsed.roomStyle || null,
        detectedObjects: Array.isArray(parsed.detectedObjects) ? parsed.detectedObjects : [],
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
  "parametricKind": "sofa" | "armchair" | "coffee_table_round" | "coffee_table_rect" | "dining_table" | "dining_chair" | "desk" | "office_chair" | "vanity_table" | "bed_frame" | "nightstand" | "wardrobe" | "bookshelf" | "sideboard" | "console_table" | "tv_wall_unit" | "wall_tv" | "fireplace_marble" | "potted_plant" | "chandelier" | "floor_lamp" | "table_lamp" | "rug_custom" | "wall_mirror" | "wall_art" | "ottoman" | "stairs" | "ac_unit",
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

      let modelUsed = '';
      let parsed = null;
      const runGeminiCrop = async () => {
        const win = await callGeminiWithFallback(
          apiKey,
          VISION_MODELS,
          {
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 1536,
              responseMimeType: 'application/json',
            },
          },
          'vision'
        );
        return { model: win.model, parsed: win.parsed || parseJsonResponse(extractText(win.json)) };
      };
      const runOpenAICrop = async () => {
        const oa = await callOpenAIVisionBackup(cropPrompt, [croppedImageDataUrl, fullRoomImageDataUrl], openAiKey);
        if (!oa) throw new Error('OpenAI Vision yanıt vermedi.');
        return { model: oa.model, parsed: parseJsonResponse(oa.text) };
      };

      if (preferOpenAI && openAiKey) {
        try {
          const out = await runOpenAICrop();
          modelUsed = out.model;
          parsed = out.parsed;
        } catch (oaErr) {
          if (!apiKey) throw oaErr;
          const out = await runGeminiCrop();
          modelUsed = out.model;
          parsed = out.parsed;
        }
      } else if (apiKey && openAiKey) {
        const out = await Promise.any([runGeminiCrop(), runOpenAICrop()]);
        modelUsed = out.model;
        parsed = out.parsed;
      } else if (apiKey) {
        const out = await runGeminiCrop();
        modelUsed = out.model;
        parsed = out.parsed;
      } else {
        const out = await runOpenAICrop();
        modelUsed = out.model;
        parsed = out.parsed;
      }
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
                  text: `Convert this 3D architectural viewport screenshot into an ultra-photorealistic V-Ray / Corona interior architectural photography render (Architectural Digest quality).
STRICT GEOMETRY PRESERVATION RULES:
- Keep EVERY wall, window shape/count, door position/swing, column, ceiling beam, recessed curtain cove, hidden warm LED strip, sunlight beam direction, and furniture placement in the EXACT same position and proportions.
- Upgrade ONLY realism: physically accurate global illumination, soft window daylight bounce, crisp wood parquet grain, realistic fabric weave, real marble reflections, natural curtain translucency, warm cove LED glow, realistic glass reflections, 24mm tilt-shift architectural lens.
Room context: ${roomSummary}
Additional architect styling note: ${styleNote || 'Doğal gün ışığı, sıcak mimari atmosfer, foto-gerçekçi malzeme kalitesi.'}`,
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
