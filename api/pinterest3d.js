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
const VISION_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-4-neon',
];
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-key');
}

function splitDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function getGeminiKey(req) {
  const fromHeader = String(req.headers['x-gemini-key'] || '').trim();
  const fromEnv = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '').trim();
  return fromHeader || fromEnv;
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
    const cleanVision = candidates.filter(
      (n) =>
        /^gemini-/i.test(n) &&
        !/image|tts|audio|live|embedding|robotics|computer-use|1\.5|2\.0|deep-research/i.test(n)
    );
    // Prioritize diverse families (flash-lite, flash, pro) so a 503 spike on one tier falls back cleanly
    const lites = cleanVision.filter((n) => /lite/i.test(n)).reverse();
    const flashes = cleanVision.filter((n) => /flash/i.test(n) && !/lite/i.test(n)).reverse();
    const pros = cleanVision.filter((n) => /pro/i.test(n)).reverse();
    return Array.from(new Set([...flashes.slice(0, 2), ...lites.slice(0, 2), ...pros.slice(0, 2)])).slice(0, 5);
  } catch {
    return [];
  }
}

async function callGeminiWithFallback(apiKey, models, body, mode = 'vision') {
  const errors = [];
  const tried = new Set();

  const tryList = async (list) => {
    for (const model of list) {
      if (tried.has(model)) continue;
      tried.add(model);
      const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(16000),
        });
      } catch (netErr) {
        errors.push(`${model} (timeout): ${netErr instanceof Error ? netErr.message : 'zaman aşımı'}`);
        continue;
      }
      const text = await resp.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* raw error */
      }
      if (resp.ok && json) {
        return { model, json };
      }
      const errMsg = json?.error?.message || text.slice(0, 160);
      errors.push(`${model} (${resp.status}): ${errMsg.slice(0, 140)}`);
      // Invalid API key / auth errors fail immediately
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(errors[0]);
      }
      // Try next model on 404 / deprecated 400 / rate limit / transient 5xx
      if (resp.status === 404 || resp.status === 400 || resp.status === 429 || resp.status >= 500) {
        continue;
      }
      throw new Error(errors[0]);
    }
    return null;
  };

  const firstPass = await tryList(models);
  if (firstPass) return firstPass;

  // Auto-discover latest active Gemini models on this API key if hardcoded ones were rotated
  const discovered = await discoverFallbackModels(apiKey, mode, tried);
  if (discovered.length > 0) {
    const secondPass = await tryList(discovered);
    if (secondPass) return secondPass;
  }

  throw new Error(errors.slice(0, 4).join(' | ') || 'Gemini API isteği başarısız oldu');
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
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini JSON yanıtı ayrıştırılamadı.');
  }
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
      runpodConfigured: envRunpod,
      visionModel: VISION_MODELS[0],
      imageModel: IMAGE_MODELS[0],
      ...(availableModels ? { availableModels } : {}),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Yalnızca POST desteklenir.' });
  }

  const apiKey = getGeminiKey(req);
  if (!apiKey) {
    return res.status(400).json({
      ok: false,
      error: 'Gemini API anahtarı eksik. Vercel ortam değişkenine GEMINI_API_KEY ekleyin veya panelden girin.',
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
      "nameTr": "short descriptive Turkish name (e.g. Mermer Şömine Ünitesi, Metal Çerçeveli Kitaplık, Saksılı Zeytin Ağacı, Yuvarlak Duvar Aynası, Siyah Mantar Abajur)",
      "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
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
      "visualDescriptionEn": "extremely faithful visual specification of this EXACT item: silhouette, exact material, color, wood tone, cushions, legs, lamp shade, plant foliage, frame details"
    }
  ]
}

CRITICAL COMPLETENESS & PRECISION RULES:
- DO NOT stop at 8 items! Detect EVERY distinct visible item (aim for 10 to 20 items in detailed rooms). Scan all 4 quadrants AND upper/lower levels systematically:
  1. Hero furniture: beds, sofas, fireplaces, TV/media walls, desks, dining tables, wardrobes, built-in cabinets, staircases.
  2. Secondary seating & tables: armchairs, office chairs, poufs/ottomans, coffee tables, nightstands/bedside tables, vanity/dressing tables.
  3. Storage & tech: open bookshelves, sideboards, monitors/TVs.
  4. EVERY separate rug (list rectangular and round rugs separately!).
  5. Lighting: chandeliers, floor lamps, globe/table lamps, bedside lamps.
  6. Plants & wall decor: potted indoor trees/plants, wall mirrors, framed paintings/posters.
- box2d MUST be integers in 0..1000 scale [ymin, xmin, ymax, xmax] TIGHTLY enclosing ONLY that single item without excessive background bleed.
- Dimensions in cm MUST be realistic real-world furniture dimensions.
- If a fireplace and a wall-mounted TV are visually separate, list them as separate items (fireplace elevationCm=0, wall TV elevationCm=115..140).
- Ensure relativeX, relativeZ, and facingDeg form a sensible, non-overlapping layout matching the photo.`;

      const { model, json } = await callGeminiWithFallback(
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
            temperature: 0.2,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        },
        'vision'
      );

      const rawText = extractText(json);
      const parsed = parseJsonResponse(rawText);

      return res.status(200).json({
        ok: true,
        model,
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
      const parts = [
        {
          text: `You are an interior architect. Identify the SINGLE primary furniture or decor object shown in Image 1 (cropped from the room in Image 2).
Return ONLY valid JSON:
{
  "nameTr": "short descriptive Turkish name (e.g. Saksılı Zeytin Ağacı, Metal Çerçeveli Kitaplık, Yuvarlak Duvar Aynası)",
  "category": "Şömine" | "TV & Ünite" | "Yatak" | "Kanepe" | "Berjer" | "Sehpa" | "Masa" | "Sandalye" | "Depolama" | "Kitaplık" | "Aydınlatma" | "Bitki" | "Ayna & Tablo" | "Halı" | "Merdiven" | "Dekor",
  "widthCm": number,
  "depthCm": number,
  "heightCm": number,
  "mountMode": "floor" | "wall" | "ceiling" | "rug",
  "elevationCm": number,
  "visualDescriptionEn": "concise accurate English visual description of this exact object"
}`,
        },
        { inlineData: { mimeType: cropImg.mimeType, data: cropImg.data } },
      ];
      if (fullImg) parts.push({ inlineData: { mimeType: fullImg.mimeType, data: fullImg.data } });

      const { model, json } = await callGeminiWithFallback(
        apiKey,
        VISION_MODELS,
        {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        },
        'vision'
      );
      const parsed = parseJsonResponse(extractText(json));
      return res.status(200).json({ ok: true, model, item: parsed });
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
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Pinterest AI işleminde sunucu hatası.',
    });
  }
}
