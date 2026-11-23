import type { Product } from './products';

export type StorageProvider = 'r2' | 'vercel-blob' | 'none';

export interface CloudStorageConfig {
  configured: boolean;
  provider: StorageProvider;
  providerLabel: string;
  publicBaseUrl: string;
  requiresPin: boolean;
  maxDirectUploadMb: number;
}

const PIN_KEY = 'mekanar_storage_pin_v1';

export function getSavedStoragePin(): string {
  try {
    return localStorage.getItem(PIN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStoragePin(pin: string): void {
  try {
    const clean = pin.trim();
    if (clean) localStorage.setItem(PIN_KEY, clean);
    else localStorage.removeItem(PIN_KEY);
  } catch {
    /* ignore */
  }
}

export async function fetchStorageConfig(): Promise<CloudStorageConfig> {
  try {
    const r = await fetch('/api/storage?action=config');
    if (!r.ok) {
      return {
        configured: false,
        provider: 'none',
        providerLabel: 'Bağlı Değil (Geçici Oturum)',
        publicBaseUrl: '',
        requiresPin: false,
        maxDirectUploadMb: 3.5,
      };
    }
    const j = await r.json();
    const provider: StorageProvider =
      j.provider === 'r2' || j.provider === 'vercel-blob' ? j.provider : 'none';
    return {
      configured: Boolean(j.configured),
      provider,
      providerLabel: String(j.providerLabel || 'Bağlı Değil'),
      publicBaseUrl: String(j.publicBaseUrl || ''),
      requiresPin: Boolean(j.requiresPin),
      maxDirectUploadMb: Number(j.maxDirectUploadMb || 3.5),
    };
  } catch {
    return {
      configured: false,
      provider: 'none',
      providerLabel: 'Bağlı Değil (Geçici Oturum)',
      publicBaseUrl: '',
      requiresPin: false,
      maxDirectUploadMb: 3.5,
    };
  }
}

export async function fetchCloudCatalog(): Promise<Product[]> {
  try {
    const r = await fetch('/api/storage?action=catalog', { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.products) ? (j.products as Product[]) : [];
  } catch {
    return [];
  }
}

export async function fetchCloudProductById(id: string): Promise<Product | null> {
  try {
    const r = await fetch(`/api/storage?action=product&id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.product ? (j.product as Product) : null;
  } catch {
    return null;
  }
}

function slugifyProductId(name: string): string {
  const trMap: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    İ: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    Ç: 'c',
    Ğ: 'g',
    Ö: 'o',
    Ş: 's',
    Ü: 'u',
  };
  const base = name
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (ch) => trMap[ch] || ch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || 'mobilya'}-${suffix}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

async function compressThumbDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 480;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#f6f4ef';
      ctx.fillRect(0, 0, size, size);
      const pad = 20;
      const avail = size - pad * 2;
      const sc = Math.min(avail / img.width, avail / img.height);
      const dw = Math.round(img.width * sc);
      const dh = Math.round(img.height * sc);
      ctx.drawImage(img, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export interface SaveCloudProductInput {
  name: string;
  category: string;
  dimensionsCm: string;
  dimsTargetCm?: { w: number; d: number; h: number };
  glbBuffer: ArrayBuffer;
  thumbnailDataUrl?: string | null;
  storageConfig: CloudStorageConfig;
  adminPin?: string;
  onProgress?: (msg: string) => void;
}

/**
 * Üretilen veya CAD'den dönüştürülen 1:1 .GLB modelini kalıcı dosya deposuna (Cloudflare R2 / Vercel Blob)
 * tek seferde kaydeder. Bundan sonra tüm müşteriler 0 TL GPU maliyetiyle doğrudan AR'da izler.
 */
export async function saveProductToCloudStorage(
  input: SaveCloudProductInput
): Promise<Product> {
  const { storageConfig } = input;
  if (!storageConfig.configured) {
    throw new Error('Kalıcı bulut depo yapılandırılmamış.');
  }

  const productId = slugifyProductId(input.name);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const pin = (input.adminPin ?? getSavedStoragePin()).trim();
  if (pin) headers['x-admin-pin'] = pin;

  const compactThumb = input.thumbnailDataUrl
    ? await compressThumbDataUrl(input.thumbnailDataUrl)
    : undefined;

  // 1) Cloudflare R2: Önce doğrudan imzalı PUT dene (25 MB'a kadar CAD desteği, sıfır Vercel limiti!)
  if (storageConfig.provider === 'r2') {
    input.onProgress?.('1:1 .GLB kalıcı Cloudflare R2 dosya deposuna kaydediliyor...');
    try {
      const preRes = await fetch('/api/storage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'presign',
          productId,
          hasThumb: Boolean(compactThumb),
        }),
      });
      const preJson = await preRes.json().catch(() => ({}));
      if (!preRes.ok || !preJson.ok || !preJson.glbPutUrl) {
        throw new Error(preJson.error || `R2 imzalı bağlantı alınamadı (${preRes.status})`);
      }

      const glbPut = await fetch(preJson.glbPutUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'model/gltf-binary' },
        body: new Blob([input.glbBuffer], { type: 'model/gltf-binary' }),
      });
      if (!glbPut.ok) {
        throw new Error(`R2 doğrudan yükleme hatası (${glbPut.status})`);
      }

      let thumbUrl: string | undefined;
      if (compactThumb && preJson.thumbPutUrl) {
        const tb = await dataUrlToBlob(compactThumb);
        const thPut = await fetch(preJson.thumbPutUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: tb,
        });
        if (thPut.ok && preJson.thumbPublicUrl) {
          thumbUrl = String(preJson.thumbPublicUrl);
        }
      }

      const regRes = await fetch('/api/storage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'register',
          product: {
            id: productId,
            name: input.name,
            category: input.category,
            dimensionsCm: input.dimensionsCm,
            dimsTargetCm: input.dimsTargetCm,
            glbUrl: preJson.glbPublicUrl,
            remoteGlbUrl: preJson.glbPublicUrl,
            thumbUrl,
            source: 'ozel-cad',
            cloudStored: true,
          },
        }),
      });
      const regJson = await regRes.json().catch(() => ({}));
      if (!regRes.ok || !regJson.ok || !regJson.product) {
        throw new Error(regJson.error || 'Katalog kaydı tamamlanamadı.');
      }
      return regJson.product as Product;
    } catch (directErr) {
      // Eğer R2 CORS henüz açılmadıysa ve dosya <= 3.5 MB ise otomatik sunucu üzerinden kaydet!
      if (input.glbBuffer.byteLength > 3_500_000) {
        throw directErr;
      }
      input.onProgress?.('Sunucu güvenli yükleme yoluna geçiliyor...');
    }
  } else {
    input.onProgress?.('1:1 .GLB kalıcı bulut deposuna kaydediliyor...');
  }

  // 2) Sunucu üzerinden tek adımda kayıt (Vercel Blob veya <= 3.5 MB R2 CORS yedeği)
  const upRes = await fetch('/api/storage', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'upload',
      product: {
        id: productId,
        name: input.name,
        category: input.category,
        dimensionsCm: input.dimensionsCm,
        dimsTargetCm: input.dimsTargetCm,
        source: 'ozel-cad',
      },
      glbBase64: arrayBufferToBase64(input.glbBuffer),
      thumbDataUrl: compactThumb,
    }),
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upJson.ok || !upJson.product) {
    throw new Error(upJson.error || `Kalıcı bulut kaydı başarısız (${upRes.status})`);
  }
  return upJson.product as Product;
}

export async function deleteCloudProduct(id: string, adminPin?: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const pin = (adminPin ?? getSavedStoragePin()).trim();
  if (pin) headers['x-admin-pin'] = pin;

  const r = await fetch('/api/storage', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'delete', id }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    throw new Error(j.error || `Ürün buluttan silinemedi (${r.status})`);
  }
}
