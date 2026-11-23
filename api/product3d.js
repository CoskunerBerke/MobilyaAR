/**
 * MekanAR — Sunucusuz (Zero-Idle) Fotoğraftan 1:1 3B Mobilya Üretim API'si
 * Desteklenen sağlayıcılar:
 *   1) RunPod Serverless Flex (Boşta $0 — gerçek saniye bazlı faturalama):
 *        - L4 / 24 GB       : $0.00019 / sn (~$0.007 / ürün)
 *        - RTX 4090 24GB PRO: $0.00031 / sn (~$0.008 / ürün — önerilen)
 *        - L40S 48GB PRO    : $0.00053 / sn (~$0.011 / ürün)
 *        - A100 80GB        : $0.00076 / sn (~$0.014 / ürün)
 *   2) fal.ai TRELLIS       ($0.02 / ürün — tek veya çok açılı, sıfır kurulum)
 *   3) fal.ai Hunyuan3D v2  ($0.48 / ürün — stüdyo PBR dokulu .GLB)
 *
 * Ek olarak güvenilir barındırıcılardan CORS-güvenli .GLB proxy (action=proxyGlb) sunar;
 * böylece tarayıcı üretilen .GLB'yi anında gerçek santimetre (1:1) ölçüsüne getirip Canlı AR'da açar.
 */

const RUNPOD_GPU_RATES_USD_PER_SEC = {
  L4: { rate: 0.00019, avgSec: 32, label: 'RunPod L4 / 24GB Flex' },
  RTX4090: { rate: 0.00031, avgSec: 20, label: 'RunPod RTX 4090 (24GB PRO)' },
  L40S: { rate: 0.00053, avgSec: 16, label: 'RunPod L40S (48GB PRO)' },
  A100: { rate: 0.00076, avgSec: 14, label: 'RunPod A100 (80GB)' },
};

const FAL_MODELS = {
  'trellis-single': {
    path: 'fal-ai/trellis',
    costUsd: 0.02,
    label: 'TRELLIS (Hızlı 3B)',
  },
  'trellis-multi': {
    path: 'fal-ai/trellis/multi',
    costUsd: 0.02,
    label: 'TRELLIS Çok-Açılı',
  },
  'hunyuan-single': {
    path: 'fal-ai/hunyuan3d/v2',
    costUsd: 0.48,
    label: 'Hunyuan3D v2 PBR',
  },
  'hunyuan-multi': {
    path: 'fal-ai/hunyuan3d/v2/multi-view',
    costUsd: 0.48,
    label: 'Hunyuan3D v2 Çok-Açılı PBR',
  },
};

const ALLOWED_GLB_HOST_SUFFIXES = [
  '.fal.media',
  '.fal.run',
  '.runpod.net',
  '.r2.dev',
  '.r2.cloudflarestorage.com',
  '.public.blob.vercel-storage.com',
  '.blob.vercel-storage.com',
  '.amazonaws.com',
  'storage.googleapis.com',
];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-fal-key, x-runpod-key, x-runpod-3d-endpoint, x-runpod-gpu-tier'
  );
}

function cleanEndpointId(raw) {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/api\.runpod\.ai\/v2\//i, '')
    .replace(/^v2\//i, '')
    .replace(/\/.*$/, '')
    .trim();
}

function resolveRunpodTier(raw) {
  const key = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
  if (key === '4090' || key === 'RTX4090' || key === '24GBPRO') return 'RTX4090';
  if (key === 'L4' || key === '24GB' || key === 'A5000') return 'L4';
  if (key === 'L40S' || key === 'L40' || key === '48GB' || key === '48GBPRO') return 'L40S';
  if (key === 'A100' || key === '80GB') return 'A100';
  return 'RTX4090';
}

function isAllowedFalQueueUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    return u.protocol === 'https:' && u.hostname === 'queue.fal.run';
  } catch {
    return false;
  }
}

function isAllowedGlbUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_GLB_HOST_SUFFIXES.some((sfx) => (sfx.startsWith('.') ? h.endsWith(sfx) : h === sfx));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const headerFalKey = typeof req.headers['x-fal-key'] === 'string' ? req.headers['x-fal-key'].trim() : '';
  const headerRpKey = typeof req.headers['x-runpod-key'] === 'string' ? req.headers['x-runpod-key'].trim() : '';
  const headerRpEp =
    typeof req.headers['x-runpod-3d-endpoint'] === 'string'
      ? req.headers['x-runpod-3d-endpoint'].trim()
      : '';
  const headerTier =
    typeof req.headers['x-runpod-gpu-tier'] === 'string' ? req.headers['x-runpod-gpu-tier'].trim() : '';

  const falKey = headerFalKey || process.env.FAL_KEY || '';
  const rpKey = headerRpKey || process.env.RUNPOD_API_KEY || '';
  const rp3dEndpoint = cleanEndpointId(
    headerRpEp || process.env.RUNPOD_3D_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID || ''
  );
  const rpTierKey = resolveRunpodTier(headerTier || process.env.RUNPOD_GPU_TIER || 'RTX4090');
  const rpSpec = RUNPOD_GPU_RATES_USD_PER_SEC[rpTierKey] || RUNPOD_GPU_RATES_USD_PER_SEC.RTX4090;

  if (req.method === 'GET') {
    const action = typeof req.query?.action === 'string' ? req.query.action : '';

    // 1) Sunucu yapılandırma ve gerçek RunPod saniye tarifeleri
    if (action === 'config') {
      return res.status(200).json({
        ok: true,
        falConfigured: Boolean(process.env.FAL_KEY),
        runpod3dConfigured: Boolean(
          process.env.RUNPOD_API_KEY &&
            (process.env.RUNPOD_3D_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID)
        ),
        defaultRunpodTier: resolveRunpodTier(process.env.RUNPOD_GPU_TIER || 'RTX4090'),
        runpodRatesUsdPerSec: {
          L4: RUNPOD_GPU_RATES_USD_PER_SEC.L4.rate,
          RTX4090: RUNPOD_GPU_RATES_USD_PER_SEC.RTX4090.rate,
          L40S: RUNPOD_GPU_RATES_USD_PER_SEC.L40S.rate,
          A100: RUNPOD_GPU_RATES_USD_PER_SEC.A100.rate,
        },
      });
    }

    // 2) CORS-güvenli GLB proxy (üretilen modeli tarayıcıda 1:1 metre ölçeklemek için)
    if (action === 'proxyGlb') {
      const targetUrl = typeof req.query?.url === 'string' ? req.query.url : '';
      if (!isAllowedGlbUrl(targetUrl)) {
        return res.status(400).json({ ok: false, error: 'Geçersiz veya izin verilmeyen model adresi.' });
      }
      try {
        const up = await fetch(targetUrl);
        if (!up.ok) {
          return res.status(up.status).json({ ok: false, error: `Model indirilemedi (${up.status})` });
        }
        const ab = await up.arrayBuffer();
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(200).send(Buffer.from(ab));
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Model proxy hatası.',
        });
      }
    }

    // 3) Asenkron iş durumu sorgulama (RunPod Serverless veya fal.ai)
    const provider = typeof req.query?.provider === 'string' ? req.query.provider : 'runpod';

    if (provider === 'fal') {
      if (!falKey) {
        return res.status(400).json({ ok: false, error: 'fal.ai API anahtarı (FAL_KEY) eksik.' });
      }
      const statusUrl = typeof req.query?.statusUrl === 'string' ? req.query.statusUrl : '';
      const responseUrl = typeof req.query?.responseUrl === 'string' ? req.query.responseUrl : '';
      if (!isAllowedFalQueueUrl(statusUrl) || !isAllowedFalQueueUrl(responseUrl)) {
        return res.status(400).json({ ok: false, error: 'Geçersiz fal.ai kuyruk adresi.' });
      }

      try {
        const stRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${falKey}` },
        });
        const stJson = await stRes.json().catch(() => ({}));
        if (!stRes.ok) {
          return res.status(stRes.status).json({
            ok: false,
            error: stJson.detail || stJson.error || `fal.ai durum sorgusu başarısız (${stRes.status})`,
          });
        }
        const st = String(stJson.status || '').toUpperCase();
        if (st === 'COMPLETED') {
          const outRes = await fetch(responseUrl, {
            headers: { Authorization: `Key ${falKey}` },
          });
          const outJson = await outRes.json().catch(() => ({}));
          if (!outRes.ok) {
            return res.status(outRes.status).json({
              ok: false,
              error: outJson.detail || outJson.error || '3B model yanıtı okunamadı.',
            });
          }
          const glbUrl =
            outJson?.model_mesh?.url ||
            outJson?.mesh?.url ||
            outJson?.glb?.url ||
            outJson?.model_glb?.url ||
            '';
          if (!glbUrl) {
            return res.status(500).json({ ok: false, error: 'Üretilen yanıtta .GLB dosya bağlantısı bulunamadı.' });
          }
          return res.status(200).json({
            ok: true,
            status: 'COMPLETED',
            glbUrl,
            fileSize: outJson?.model_mesh?.file_size || null,
          });
        }
        if (st === 'FAILED') {
          return res.status(200).json({
            ok: true,
            status: 'FAILED',
            error: stJson.error || '3B üretim işlemi başarısız oldu.',
          });
        }
        return res.status(200).json({
          ok: true,
          status: st || 'IN_PROGRESS',
          queuePosition: stJson.queue_position ?? null,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'fal.ai sunucusuna ulaşılamadı.',
        });
      }
    }

    if (provider === 'runpod') {
      const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId.trim() : '';
      if (!jobId || !rpKey || !rp3dEndpoint) {
        return res.status(400).json({ ok: false, error: 'RunPod 3B iş sorgusu için bilgiler eksik.' });
      }
      try {
        const rpRes = await fetch(
          `https://api.runpod.ai/v2/${encodeURIComponent(rp3dEndpoint)}/status/${encodeURIComponent(jobId)}`,
          { headers: { Authorization: `Bearer ${rpKey}` } }
        );
        const data = await rpRes.json().catch(() => ({}));
        if (!rpRes.ok) {
          return res.status(rpRes.status).json({
            ok: false,
            error: data.error || `RunPod durum sorgusu başarısız (${rpRes.status})`,
          });
        }
        // RunPod Serverless Flex gerçek faturalama: executionTime (sn yukarı yuvarlanır) + 5 sn idle kuyruğu
        const execSec = Math.ceil(Number(data.executionTime || 0) / 1000);
        const billedSec = execSec > 0 ? execSec + 5 : 0;
        const estimatedCostUsd = Number((billedSec * rpSpec.rate).toFixed(5));
        return res.status(200).json({
          ok: true,
          status: data.status,
          gpuTier: rpTierKey,
          ratePerSecUsd: rpSpec.rate,
          executionSec: Number((Number(data.executionTime || 0) / 1000).toFixed(1)),
          billedSec,
          estimatedCostUsd,
          glbUrl: data.output?.glbUrl || data.output?.glb_url || null,
          glbBase64: data.output?.glbBase64 || data.output?.glb_base64 || null,
          error: data.error || data.output?.error || undefined,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'RunPod durum sunucusuna ulaşılamadı.',
        });
      }
    }

    return res.status(400).json({ ok: false, error: 'Desteklenmeyen sağlayıcı.' });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false, error: 'Geçersiz JSON gövdesi.' });
      }
    }

    const engine = String(body?.engine || 'runpod').toLowerCase(); // 'runpod' | 'trellis' | 'hunyuan'
    const images = body?.images || {};
    const front = typeof images.front === 'string' ? images.front : '';
    const back = typeof images.back === 'string' ? images.back : '';
    const left = typeof images.left === 'string' ? images.left : '';
    const right = typeof images.right === 'string' ? images.right : '';

    if (!front) {
      return res.status(400).json({ ok: false, error: 'En az 1 önden ürün fotoğrafı gereklidir.' });
    }

    // RunPod Serverless Flex GPU Endpoint (Boşta $0)
    if (engine === 'runpod') {
      if (!rpKey || !rp3dEndpoint) {
        return res.status(400).json({
          ok: false,
          error:
            'RunPod Serverless Endpoint ID ve API Key ayarlar panelinden veya Vercel ortam değişkenlerinden (RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY) tanımlanmalıdır.',
        });
      }
      try {
        const rpRes = await fetch(`https://api.runpod.ai/v2/${encodeURIComponent(rp3dEndpoint)}/run`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rpKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              task: 'product3d',
              images: { front, back: back || null, left: left || null, right: right || null },
              width_cm: Number(body?.width_cm || 0) || undefined,
              depth_cm: Number(body?.depth_cm || 0) || undefined,
              height_cm: Number(body?.height_cm || 0) || undefined,
            },
          }),
        });
        const data = await rpRes.json().catch(() => ({}));
        if (!rpRes.ok || !data.id) {
          return res.status(rpRes.status || 502).json({
            ok: false,
            error: data.error || `RunPod 3B üretim işi başlatılamadı (${rpRes.status})`,
          });
        }
        return res.status(200).json({
          ok: true,
          provider: 'runpod',
          jobId: data.id,
          gpuTier: rpTierKey,
          ratePerSecUsd: rpSpec.rate,
          estimatedCostUsd: Number(((rpSpec.avgSec + 5) * rpSpec.rate).toFixed(4)),
          modelLabel: rpSpec.label,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'RunPod isteği gönderilemedi.',
        });
      }
    }

    // fal.ai TRELLIS ($0.02) veya Hunyuan3D v2 ($0.48)
    if (!falKey) {
      return res.status(400).json({
        ok: false,
        error:
          'fal.ai API Anahtarı (FAL_KEY) eksik. Sağ üstteki Ayarlar menüsünden girin veya RunPod Serverless motorunu seçin.',
      });
    }

    const extraImgs = [back, left, right].filter(Boolean);
    let modelSpec;
    let payload;

    if (engine === 'hunyuan') {
      if (back && left) {
        modelSpec = FAL_MODELS['hunyuan-multi'];
        payload = {
          front_image_url: front,
          back_image_url: back,
          left_image_url: left,
          enable_texture: true,
          octree_resolution: 256,
        };
      } else {
        modelSpec = FAL_MODELS['hunyuan-single'];
        payload = {
          input_image_url: front,
          textured_mesh: true,
        };
      }
    } else {
      if (extraImgs.length > 0) {
        modelSpec = FAL_MODELS['trellis-multi'];
        payload = {
          image_urls: [front, ...extraImgs],
          texture_size: 1024,
          mesh_simplify: 0.95,
        };
      } else {
        modelSpec = FAL_MODELS['trellis-single'];
        payload = {
          image_url: front,
          texture_size: 1024,
          mesh_simplify: 0.95,
        };
      }
    }

    try {
      const submitRes = await fetch(`https://queue.fal.run/${modelSpec.path}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const submitJson = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok || !submitJson.request_id) {
        return res.status(submitRes.status || 502).json({
          ok: false,
          error:
            submitJson.detail ||
            submitJson.error ||
            `fal.ai 3B üretim başlatılamadı (${submitRes.status})`,
        });
      }

      const statusUrl =
        submitJson.status_url ||
        `https://queue.fal.run/${modelSpec.path}/requests/${submitJson.request_id}/status`;
      const responseUrl =
        submitJson.response_url ||
        `https://queue.fal.run/${modelSpec.path}/requests/${submitJson.request_id}`;

      return res.status(200).json({
        ok: true,
        provider: 'fal',
        requestId: submitJson.request_id,
        statusUrl,
        responseUrl,
        estimatedCostUsd: modelSpec.costUsd,
        modelLabel: modelSpec.label,
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'fal.ai isteği gönderilemedi.',
      });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
