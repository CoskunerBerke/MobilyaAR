const GPU_RATES_USD_PER_SEC = {
  L4: 0.00019,
  L40S: 0.00054,
  A100: 0.00078,
  H100: 0.00135,
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-runpod-key, x-runpod-endpoint, x-gpu-tier');
}

function cleanEndpointId(raw) {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/api\.runpod\.ai\/v2\//i, '')
    .replace(/^v2\//i, '')
    .replace(/\/.*$/, '')
    .trim();
}

function formatRunpodError(rawErr) {
  if (!rawErr) return undefined;
  let msg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
  if (typeof rawErr === 'string' && rawErr.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawErr);
      msg = parsed.error_message || parsed.error || rawErr;
    } catch {
      /* keep raw string */
    }
  }
  if (/no kernel image is available/i.test(msg)) {
    return 'Seçili GPU nesli (Blackwell) için CUDA 12.8 imajı yükleniyor — hemen denemek için RunPod Edit Endpoint ekranında GPU sekmesini Previous generation (L40S / RTX 4090 / A6000) olarak değiştirin.';
  }
  return msg.split('\n')[0].slice(0, 260);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const headerKey = typeof req.headers['x-runpod-key'] === 'string' ? req.headers['x-runpod-key'].trim() : '';
  const headerEndpoint = typeof req.headers['x-runpod-endpoint'] === 'string' ? req.headers['x-runpod-endpoint'] : '';
  const headerTier = typeof req.headers['x-gpu-tier'] === 'string' ? req.headers['x-gpu-tier'].trim().toUpperCase() : '';

  const apiKey = headerKey || process.env.RUNPOD_API_KEY || '';
  const endpointId = cleanEndpointId(headerEndpoint || process.env.RUNPOD_ENDPOINT_ID || '');
  const gpuTier = GPU_RATES_USD_PER_SEC[headerTier]
    ? headerTier
    : GPU_RATES_USD_PER_SEC[(process.env.RUNPOD_GPU_TIER || '').toUpperCase()]
    ? process.env.RUNPOD_GPU_TIER.toUpperCase()
    : 'L40S';
  const rate = GPU_RATES_USD_PER_SEC[gpuTier] || GPU_RATES_USD_PER_SEC.L40S;

  if (req.method === 'GET') {
    const action = typeof req.query?.action === 'string' ? req.query.action : '';
    if (action === 'config') {
      return res.status(200).json({
        ok: true,
        serverConfigured: Boolean(process.env.RUNPOD_API_KEY && process.env.RUNPOD_ENDPOINT_ID),
        defaultGpuTier: GPU_RATES_USD_PER_SEC[(process.env.RUNPOD_GPU_TIER || '').toUpperCase()]
          ? process.env.RUNPOD_GPU_TIER.toUpperCase()
          : 'L40S',
      });
    }

    const jobId = typeof req.query?.jobId === 'string' ? req.query.jobId.trim() : '';
    if (!jobId) {
      return res.status(400).json({ ok: false, error: 'jobId veya action=config parametresi gerekli.' });
    }
    if (!apiKey || !endpointId) {
      return res.status(400).json({
        ok: false,
        error:
          'RunPod Serverless bağlantı bilgisi eksik. Sağ üstteki Sunucu ikonundan Endpoint ID & API Key girin veya Vercel Ortam Değişkenlerine RUNPOD_ENDPOINT_ID ve RUNPOD_API_KEY ekleyin.',
      });
    }

    try {
      const rpRes = await fetch(
        `https://api.runpod.ai/v2/${encodeURIComponent(endpointId)}/status/${encodeURIComponent(jobId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        }
      );
      const data = await rpRes.json().catch(() => ({}));
      if (!rpRes.ok) {
        return res.status(rpRes.status).json({
          ok: false,
          error: data.error || `RunPod durum sorgusu başarısız (${rpRes.status})`,
        });
      }
      const execMs = Number(data.executionTime || 0);
      const delayMs = Number(data.delayTime || 0);
      const billedSec = execMs / 1000;
      const estimatedCostUsd = Number((billedSec * rate).toFixed(4));
      return res.status(200).json({
        ok: true,
        status: data.status,
        executionTimeMs: execMs,
        delayTimeMs: delayMs,
        estimatedCostUsd,
        output: data.output,
        error: formatRunpodError(data.error),
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'RunPod durum sunucusuna ulaşılamadı.',
      });
    }
  }

  if (req.method === 'POST') {
    if (!apiKey || !endpointId) {
      return res.status(400).json({
        ok: false,
        error:
          'RunPod Serverless henüz bağlanmadı. Sağ üstteki Sunucu ikonundan Endpoint ID & API Key girin ya da Vercel projenizde RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY tanımlayın.',
      });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ ok: false, error: 'Geçersiz JSON gövdesi.' });
      }
    }
    const images = body?.images;
    if (!Array.isArray(images) || images.length < 4 || images.length > 40) {
      return res.status(400).json({
        ok: false,
        error: '3D oda oluşturmak için 4 ile 40 arası kare/fotoğraf gönderilmelidir.',
      });
    }

    try {
      const rpRes = await fetch(`https://api.runpod.ai/v2/${encodeURIComponent(endpointId)}/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: { images: images.slice(0, 40) } }),
      });
      const data = await rpRes.json().catch(() => ({}));
      if (!rpRes.ok) {
        return res.status(rpRes.status).json({
          ok: false,
          error: data.error || `RunPod iş başlatılamadı (${rpRes.status})`,
        });
      }
      return res.status(200).json({
        ok: true,
        jobId: data.id,
        status: data.status || 'IN_QUEUE',
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'RunPod API isteği gönderilemedi.',
      });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
