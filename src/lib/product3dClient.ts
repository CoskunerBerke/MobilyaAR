import { normalizeGlbArrayBufferToMetricCm } from './cadImport';
import type { ActiveAiEngine, RunpodGpuTierId } from './membership';

export interface Product3DServerConfig {
  falConfigured: boolean;
  runpod3dConfigured: boolean;
  defaultRunpodTier: RunpodGpuTierId;
}

export async function fetchProduct3DConfig(): Promise<Product3DServerConfig> {
  try {
    const r = await fetch('/api/product3d?action=config');
    if (!r.ok) {
      return { falConfigured: false, runpod3dConfigured: false, defaultRunpodTier: 'RTX4090' };
    }
    const j = await r.json();
    const tier: RunpodGpuTierId =
      j.defaultRunpodTier === 'L4' ||
      j.defaultRunpodTier === 'RTX4090' ||
      j.defaultRunpodTier === 'L40S' ||
      j.defaultRunpodTier === 'A100'
        ? j.defaultRunpodTier
        : 'RTX4090';
    return {
      falConfigured: Boolean(j.falConfigured),
      runpod3dConfigured: Boolean(j.runpod3dConfigured),
      defaultRunpodTier: tier,
    };
  } catch {
    return { falConfigured: false, runpod3dConfigured: false, defaultRunpodTier: 'RTX4090' };
  }
}

export interface Serverless3DRequest {
  engine: ActiveAiEngine;
  images: {
    front: string;
    back?: string | null;
    left?: string | null;
    right?: string | null;
  };
  name: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  falApiKey?: string;
  runpodApiKey?: string;
  runpod3dEndpointId?: string;
  runpodGpuTier?: RunpodGpuTierId;
  onProgress?: (msg: string) => void;
}

export interface Serverless3DOutput {
  localBlobUrl: string;
  glbBuffer: ArrayBuffer;
  remoteGlbUrl?: string;
  dimensionsCm: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  elapsedSec: number;
  costUsd: number;
  modelLabel: string;
  filename: string;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.includes(',') ? b64.split(',')[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Uzak bir AI .GLB dosyasını proxy üzerinden çekip gerçek cm (1:1) ölçüsüne
 * ve y=0 tabanına hizalayarak AR Quick Look / WebXR uyumlu yerel Blob URL döndürür.
 */
export async function fetchAndNormalizeRemoteGlb(
  remoteUrl: string,
  dims: { widthCm?: number; depthCm?: number; heightCm?: number }
): Promise<{ blobUrl: string; dimensionsCm: string }> {
  const proxyUrl = `/api/product3d?action=proxyGlb&url=${encodeURIComponent(remoteUrl)}`;
  const r = await fetch(proxyUrl);
  if (!r.ok) {
    throw new Error(`3B model indirilemedi (${r.status})`);
  }
  const rawBuf = await r.arrayBuffer();
  const normalized = await normalizeGlbArrayBufferToMetricCm(rawBuf, dims);
  const blobUrl = URL.createObjectURL(
    new Blob([normalized.glbBuffer], { type: 'model/gltf-binary' })
  );
  return { blobUrl, dimensionsCm: normalized.dimensionsCm };
}

export async function generateFurniture3DServerless(
  req: Serverless3DRequest
): Promise<Serverless3DOutput> {
  const t0 = Date.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (req.falApiKey) headers['x-fal-key'] = req.falApiKey;
  if (req.runpodApiKey) headers['x-runpod-key'] = req.runpodApiKey;
  if (req.runpod3dEndpointId) headers['x-runpod-3d-endpoint'] = req.runpod3dEndpointId;
  if (req.runpodGpuTier) headers['x-runpod-gpu-tier'] = req.runpodGpuTier;

  req.onProgress?.('Ürün fotoğrafları sunucusuz 3B GPU motoruna gönderiliyor...');

  const startRes = await fetch('/api/product3d', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      engine: req.engine,
      images: req.images,
      name: req.name,
      width_cm: req.widthCm,
      depth_cm: req.depthCm,
      height_cm: req.heightCm,
    }),
  });
  const startJson = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startJson.ok) {
    throw new Error(startJson.error || `3B ürün üretimi başlatılamadı (${startRes.status})`);
  }

  const provider = String(startJson.provider || 'runpod');
  const modelLabel = String(startJson.modelLabel || 'RunPod Serverless GPU');
  let costUsd = Number(startJson.estimatedCostUsd || 0.008);

  let remoteGlbUrl: string | undefined;
  let rawBuf: ArrayBuffer | null = null;

  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise((r) => setTimeout(r, 2200));
    const sec = Math.round((Date.now() - t0) / 1000);

    const pollHeaders: Record<string, string> = {};
    if (req.falApiKey) pollHeaders['x-fal-key'] = req.falApiKey;
    if (req.runpodApiKey) pollHeaders['x-runpod-key'] = req.runpodApiKey;
    if (req.runpod3dEndpointId) pollHeaders['x-runpod-3d-endpoint'] = req.runpod3dEndpointId;
    if (req.runpodGpuTier) pollHeaders['x-runpod-gpu-tier'] = req.runpodGpuTier;

    let pollUrl = '';
    if (provider === 'fal') {
      pollUrl =
        `/api/product3d?provider=fal&statusUrl=${encodeURIComponent(startJson.statusUrl)}` +
        `&responseUrl=${encodeURIComponent(startJson.responseUrl)}`;
    } else {
      pollUrl = `/api/product3d?provider=runpod&jobId=${encodeURIComponent(startJson.jobId)}`;
    }

    const stRes = await fetch(pollUrl, { headers: pollHeaders });
    const stJson = await stRes.json().catch(() => ({}));
    if (!stRes.ok || !stJson.ok) {
      throw new Error(stJson.error || `3B üretim durumu alınamadı (${stRes.status})`);
    }

    const st = String(stJson.status || '').toUpperCase();
    if (st === 'COMPLETED') {
      if (typeof stJson.estimatedCostUsd === 'number' && stJson.estimatedCostUsd > 0) {
        costUsd = stJson.estimatedCostUsd;
      }
      if (stJson.glbBase64) {
        rawBuf = base64ToArrayBuffer(stJson.glbBase64);
      } else if (stJson.glbUrl) {
        remoteGlbUrl = stJson.glbUrl;
      }
      break;
    }
    if (st === 'FAILED' || st === 'CANCELLED' || st === 'TIMED_OUT') {
      throw new Error(stJson.error || `3B üretim başarısız oldu (${st})`);
    }
    req.onProgress?.(`${modelLabel} dokulu 3B modeli üretiyor (${sec} sn)...`);
  }

  if (!rawBuf && !remoteGlbUrl) {
    throw new Error('3B ürün üretimi zaman aşımına uğradı. Lütfen tekrar deneyin.');
  }

  req.onProgress?.(
    `1:1 gerçek ölçü (${req.widthCm}×${req.depthCm}×${req.heightCm} cm) ve zemin hizası uygulanıyor...`
  );

  if (!rawBuf && remoteGlbUrl) {
    const proxyRes = await fetch(`/api/product3d?action=proxyGlb&url=${encodeURIComponent(remoteGlbUrl)}`);
    if (!proxyRes.ok) {
      throw new Error(`Üretilen .GLB indirilemedi (${proxyRes.status})`);
    }
    rawBuf = await proxyRes.arrayBuffer();
  }

  const normalized = await normalizeGlbArrayBufferToMetricCm(rawBuf!, {
    widthCm: req.widthCm,
    depthCm: req.depthCm,
    heightCm: req.heightCm,
  });

  const localBlobUrl = URL.createObjectURL(
    new Blob([normalized.glbBuffer], { type: 'model/gltf-binary' })
  );
  const safeSlug = req.name
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return {
    localBlobUrl,
    glbBuffer: normalized.glbBuffer,
    remoteGlbUrl,
    dimensionsCm: normalized.dimensionsCm,
    widthCm: normalized.widthCm,
    depthCm: normalized.depthCm,
    heightCm: normalized.heightCm,
    elapsedSec: Number(((Date.now() - t0) / 1000).toFixed(1)),
    costUsd,
    modelLabel,
    filename: `${safeSlug || 'mobilya'}-1to1.glb`,
  };
}
