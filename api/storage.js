/**
 * MekanAR — Kalıcı, GPU'suz (0 TL AR Trafiği) 3B Model & Katalog Depolama API'si
 *
 * Desteklenen Kalıcı Dosya Depoları (Vercel ortam değişkenlerinden otomatik algılanır):
 *   1) Cloudflare R2 (ÖNERİLEN — 10 GB Ücretsiz + SINIRSIZ 0 TL İndirme Trafiği):
 *        - R2_ACCOUNT_ID
 *        - R2_ACCESS_KEY_ID
 *        - R2_SECRET_ACCESS_KEY
 *        - R2_BUCKET_NAME
 *        - R2_PUBLIC_URL          (Örn: https://pub-xxxx.r2.dev veya https://cdn.markaniz.com)
 *   2) Vercel Blob (2 tıkla Vercel içinden kurulum):
 *        - BLOB_READ_WRITE_TOKEN
 *
 * Opsiyonel Yazma Koruması:
 *   - STORAGE_ADMIN_PIN           (Tanımlanırsa yeni ürün kaydı/silme için x-admin-pin başlığı istenir;
 *                                  QR ile ürün okuma ve AR indirme her zaman herkese açıktır.)
 *
 * Akış:
 *   Üretim (RunPod / CAD) sadece 1 kere -> 1:1 .GLB kalıcı dosya deposuna kaydedilir ->
 *   Müşteriler QR/link ile doğrudan dosya deposundan .GLB indirip telefonun ARKit/ARCore
 *   özelliğiyle evinde 1:1 görür (RunPod hiç çalışmaz = 0 TL GPU maliyeti).
 */

import crypto from 'node:crypto';

const CATALOG_KEY = 'catalog/products.json';
const MAX_SERVER_UPLOAD_BYTES = 3_600_000; // Vercel 4.5 MB gövde sınırı güvenliği

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-pin');
}

function isR2DevUrl(urlStr) {
  try {
    return new URL(String(urlStr || '')).hostname.toLowerCase().endsWith('.r2.dev');
  } catch {
    return false;
  }
}

/**
 * Türkiye'deki bazı ISS'ler Cloudflare'in geliştirme adresi (*.r2.dev) için TLS bağlantısını
 * engelleyebiliyor. Özel alan adı (cdn.markaniz.com) bağlandığında doğrudan R2 URL kullanılır;
 * geliştirme aşamasında (*.r2.dev) dosyalar aynı alan adından Edge CDN önbellekli sunulur.
 */
export function buildPublicAssetUrl(env, key) {
  if (env.provider === 'r2' && env.r2) {
    if (!isR2DevUrl(env.r2.publicUrl)) {
      return `${env.r2.publicUrl}/${key}`;
    }
    return `/api/storage?action=file&key=${encodeURIComponent(key)}`;
  }
  return '';
}

function normalizeServedProduct(env, p) {
  if (!p || env.provider !== 'r2' || !env.r2) return p;
  const out = { ...p };
  if (isR2DevUrl(out.glbUrl) && out.id) {
    out.glbUrl = buildPublicAssetUrl(env, `models/${out.id}.glb`);
    out.remoteGlbUrl = out.glbUrl;
  }
  if (isR2DevUrl(out.thumbUrl) && out.id) {
    out.thumbUrl = buildPublicAssetUrl(env, `thumbs/${out.id}.jpg`);
  }
  return out;
}

export function getStorageEnv() {
  const r2Account = String(process.env.R2_ACCOUNT_ID || '').trim();
  const r2Access = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const r2Secret = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const r2Bucket = String(process.env.R2_BUCKET_NAME || '').trim();
  const r2PublicUrl = String(process.env.R2_PUBLIC_URL || '')
    .trim()
    .replace(/\/+$/, '');

  const hasR2 = Boolean(r2Account && r2Access && r2Secret && r2Bucket && r2PublicUrl);
  const blobToken = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  const hasBlob = Boolean(blobToken);
  const adminPin = String(process.env.STORAGE_ADMIN_PIN || '').trim();

  if (hasR2) {
    return {
      configured: true,
      provider: 'r2',
      providerLabel: 'Cloudflare R2 (Kalıcı Dosya Deposu)',
      publicBaseUrl: r2PublicUrl,
      requiresPin: Boolean(adminPin),
      adminPin,
      r2: {
        accountId: r2Account,
        accessKeyId: r2Access,
        secretAccessKey: r2Secret,
        bucket: r2Bucket,
        publicUrl: r2PublicUrl,
        host: `${r2Account}.r2.cloudflarestorage.com`,
      },
      blobToken: '',
    };
  }

  if (hasBlob) {
    return {
      configured: true,
      provider: 'vercel-blob',
      providerLabel: 'Vercel Blob (Kalıcı Dosya Deposu)',
      publicBaseUrl: '',
      requiresPin: Boolean(adminPin),
      adminPin,
      r2: null,
      blobToken,
    };
  }

  return {
    configured: false,
    provider: 'none',
    providerLabel: 'Bağlı Değil (Geçici Oturum)',
    publicBaseUrl: '',
    requiresPin: Boolean(adminPin),
    adminPin,
    r2: null,
    blobToken: '',
  };
}

function checkWriteAuth(req, env) {
  if (!env.requiresPin) return true;
  const sent = typeof req.headers['x-admin-pin'] === 'string' ? req.headers['x-admin-pin'].trim() : '';
  return sent.length > 0 && sent === env.adminPin;
}

function sanitizeId(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function isSafeStorageKey(key) {
  return /^(models\/[a-z0-9-]+\.glb|thumbs\/[a-z0-9-]+\.jpg)$/.test(String(key || ''));
}

/* -------------------- AWS Signature V4 (Cloudflare R2) -------------------- */

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeS3Path(pathStr) {
  return pathStr
    .split('/')
    .map((seg) => encodeRfc3986(seg))
    .join('/');
}

function getAmzTimestamps(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso, // YYYYMMDDTHHMMSSZ
    dateStamp: iso.slice(0, 8), // YYYYMMDD
  };
}

function deriveSigningKey(secretAccessKey, dateStamp, region = 'auto', service = 's3') {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export function presignR2PutUrl(r2, key, expiresSec = 600) {
  const { amzDate, dateStamp } = getAmzTimestamps();
  const region = 'auto';
  const service = 's3';
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${encodeS3Path(`${r2.bucket}/${key}`)}`;

  const queryParams = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${r2.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSec)],
    ['X-Amz-SignedHeaders', 'host'],
  ];

  const canonicalQuery = queryParams
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalHeaders = `host:${r2.host}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(r2.secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return `https://${r2.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function r2SignedFetch(r2, method, key, opts = {}) {
  const { amzDate, dateStamp } = getAmzTimestamps();
  const region = 'auto';
  const service = 's3';
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${encodeS3Path(`${r2.bucket}/${key}`)}`;

  const bodyBuf = opts.body ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body)) : Buffer.alloc(0);
  const payloadHash = sha256Hex(bodyBuf);

  const canonicalHeaders =
    `host:${r2.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(r2.secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const headers = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (opts.contentType) headers['Content-Type'] = opts.contentType;
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;

  return fetch(`https://${r2.host}${canonicalUri}`, {
    method,
    headers,
    body: method === 'PUT' || method === 'POST' ? bodyBuf : undefined,
  });
}

/* -------------------- Catalog Persistence (R2 & Vercel Blob) -------------------- */

async function readCatalog(env) {
  if (!env.configured) return [];

  if (env.provider === 'r2') {
    const r = await r2SignedFetch(env.r2, 'GET', CATALOG_KEY);
    if (r.status === 404) return [];
    if (!r.ok) {
      throw new Error(`R2 katalog okunamadı (${r.status})`);
    }
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : Array.isArray(j?.products) ? j.products : [];
  }

  if (env.provider === 'vercel-blob') {
    const { list } = await import('@vercel/blob');
    const found = await list({ prefix: CATALOG_KEY, token: env.blobToken });
    const exact = found.blobs.find((b) => b.pathname === CATALOG_KEY) || found.blobs[0];
    if (!exact) return [];
    const r = await fetch(`${exact.url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j : Array.isArray(j?.products) ? j.products : [];
  }

  return [];
}

async function writeCatalog(env, products) {
  const payload = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      products,
    },
    null,
    2
  );

  if (env.provider === 'r2') {
    const r = await r2SignedFetch(env.r2, 'PUT', CATALOG_KEY, {
      body: Buffer.from(payload, 'utf8'),
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'no-cache, max-age=0',
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`R2 katalog güncellenemedi (${r.status}): ${txt.slice(0, 180)}`);
    }
    return;
  }

  if (env.provider === 'vercel-blob') {
    const { put } = await import('@vercel/blob');
    await put(CATALOG_KEY, payload, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
      cacheControlMaxAge: 0,
      token: env.blobToken,
    });
  }
}

function sanitizeProductRecord(raw, fallbackGlbUrl = '', fallbackThumbUrl = '') {
  const id = sanitizeId(raw?.id || `urun-${Date.now()}`);
  const glbUrl = String(raw?.glbUrl || fallbackGlbUrl || '').trim();
  const thumbUrl = String(raw?.thumbUrl || fallbackThumbUrl || '').trim();
  const dims = raw?.dimsTargetCm;
  const cleanDims =
    dims && Number(dims.w) > 0 && Number(dims.d) > 0 && Number(dims.h) > 0
      ? {
          w: Math.round(Number(dims.w)),
          d: Math.round(Number(dims.d)),
          h: Math.round(Number(dims.h)),
        }
      : undefined;

  return {
    id,
    name: String(raw?.name || 'Mağaza Ürünü').trim().slice(0, 120),
    category: String(raw?.category || 'Özel 3B').trim().slice(0, 48),
    dimensionsCm: String(raw?.dimensionsCm || '1:1 Ölçü').trim().slice(0, 64),
    glbUrl,
    remoteGlbUrl: glbUrl,
    ...(thumbUrl ? { thumbUrl } : {}),
    ...(cleanDims ? { dimsTargetCm: cleanDims } : {}),
    source: 'ozel-cad',
    cloudStored: true,
    createdAt: String(raw?.createdAt || new Date().toISOString()),
  };
}

function decodeBase64Payload(str) {
  const clean = String(str || '').includes(',') ? String(str).split(',')[1] : String(str || '');
  return Buffer.from(clean, 'base64');
}

/* -------------------- Main Handler -------------------- */

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const env = getStorageEnv();

  if (req.method === 'GET' || req.method === 'HEAD') {
    const action = typeof req.query?.action === 'string' ? req.query.action : 'config';

    // 1) Depolama durumu
    if (action === 'config') {
      return res.status(200).json({
        ok: true,
        configured: env.configured,
        provider: env.provider,
        providerLabel: env.providerLabel,
        publicBaseUrl: env.publicBaseUrl,
        usingEdgeProxyForR2Dev: Boolean(env.provider === 'r2' && env.r2 && isR2DevUrl(env.r2.publicUrl)),
        requiresPin: env.requiresPin,
        maxDirectUploadMb: env.provider === 'r2' ? 25 : 3.5,
      });
    }

    // 2) Kalıcı bulut ürün kataloğunu listele (0 TL GPU — düz JSON okuma)
    if (action === 'catalog') {
      res.setHeader('Cache-Control', 'no-store');
      if (!env.configured) {
        return res.status(200).json({
          ok: true,
          configured: false,
          provider: 'none',
          products: [],
        });
      }
      try {
        const products = (await readCatalog(env)).map((p) => normalizeServedProduct(env, p));
        return res.status(200).json({
          ok: true,
          configured: true,
          provider: env.provider,
          products,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Bulut katalog okunamadı.',
        });
      }
    }

    // 3) Tek ürün sorgula (?urun=<id>&mod=ar kısa QR bağlantısı için)
    if (action === 'product') {
      res.setHeader('Cache-Control', 'no-store');
      const id = sanitizeId(req.query?.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: 'Geçersiz ürün kimliği.' });
      }
      if (!env.configured) {
        return res.status(404).json({ ok: false, error: 'Bulut depo bağlı değil.' });
      }
      try {
        const products = await readCatalog(env);
        const found = products.find((p) => p.id === id);
        if (!found) {
          return res.status(404).json({ ok: false, error: 'Ürün kalıcı katalogda bulunamadı.' });
        }
        return res.status(200).json({ ok: true, product: normalizeServedProduct(env, found) });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Ürün bilgisi okunamadı.',
        });
      }
    }

    // 4) R2 Edge CDN Dosya Sunucu (Türkiye ISS'lerinin *.r2.dev engelini aşar, 1 yıl Edge önbellekli!)
    if (action === 'file') {
      const key = typeof req.query?.key === 'string' ? req.query.key.trim() : '';
      if (!isSafeStorageKey(key)) {
        return res.status(400).json({ ok: false, error: 'Geçersiz dosya anahtarı.' });
      }
      if (env.provider !== 'r2' || !env.r2) {
        return res.status(404).json({ ok: false, error: 'R2 deposu aktif değil.' });
      }
      try {
        const up = await r2SignedFetch(env.r2, req.method === 'HEAD' ? 'HEAD' : 'GET', key);
        if (!up.ok) {
          return res.status(up.status).json({ ok: false, error: `Dosya bulunamadı (${up.status})` });
        }
        res.setHeader(
          'Content-Type',
          key.endsWith('.glb') ? 'model/gltf-binary' : 'image/jpeg'
        );
        res.setHeader('Cache-Control', 'public, s-maxage=31536000, max-age=31536000, immutable');
        if (req.method === 'HEAD') {
          const cl = up.headers.get('content-length');
          if (cl) res.setHeader('Content-Length', cl);
          return res.status(200).end();
        }
        const ab = await up.arrayBuffer();
        return res.status(200).send(Buffer.from(ab));
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Dosya okuma hatası.',
        });
      }
    }

    return res.status(400).json({ ok: false, error: 'Geçersiz işlem.' });
  }

  if (req.method === 'POST') {
    if (!env.configured) {
      return res.status(400).json({
        ok: false,
        error:
          'Kalıcı dosya deposu henüz bağlı değil. Vercel ortam değişkenlerine Cloudflare R2 veya BLOB_READ_WRITE_TOKEN ekleyin.',
      });
    }

    if (!checkWriteAuth(req, env)) {
      return res.status(401).json({
        ok: false,
        error: 'Yönetici PIN kodu hatalı veya eksik. Ayarlar panelinden depolama PIN kodunu girin.',
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

    const action = String(body?.action || '').trim();

    // A) Cloudflare R2 doğrudan imzalı PUT linki üret (25 MB'a kadar CAD dosyaları Vercel limitine takılmaz!)
    if (action === 'presign') {
      if (env.provider !== 'r2' || !env.r2) {
        return res.status(400).json({
          ok: false,
          error: 'Doğrudan presign yalnızca Cloudflare R2 için desteklenir.',
        });
      }
      const id = sanitizeId(body?.productId || `urun-${Date.now()}`);
      if (!id) {
        return res.status(400).json({ ok: false, error: 'Geçerli ürün kimliği gerekli.' });
      }
      const glbKey = `models/${id}.glb`;
      const glbPutUrl = presignR2PutUrl(env.r2, glbKey, 600);
      const glbPublicUrl = buildPublicAssetUrl(env, glbKey);

      let thumbKey = null;
      let thumbPutUrl = null;
      let thumbPublicUrl = null;
      if (body?.hasThumb) {
        thumbKey = `thumbs/${id}.jpg`;
        thumbPutUrl = presignR2PutUrl(env.r2, thumbKey, 600);
        thumbPublicUrl = buildPublicAssetUrl(env, thumbKey);
      }

      return res.status(200).json({
        ok: true,
        provider: 'r2',
        productId: id,
        glbKey,
        glbPutUrl,
        glbPublicUrl,
        thumbKey,
        thumbPutUrl,
        thumbPublicUrl,
      });
    }

    // B) Doğrudan R2 PUT tamamlandıktan sonra ürünü kalıcı kataloğa işle
    if (action === 'register') {
      try {
        const record = sanitizeProductRecord(body?.product);
        if (!record.glbUrl) {
          return res.status(400).json({ ok: false, error: 'Kayıt için geçerli glbUrl gerekli.' });
        }
        const existing = await readCatalog(env);
        const next = [record, ...existing.filter((p) => p.id !== record.id)];
        await writeCatalog(env, next);
        return res.status(200).json({
          ok: true,
          provider: env.provider,
          product: record,
          count: next.length,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Katalog kaydı başarısız oldu.',
        });
      }
    }

    // C) Tek adımda sunucu üzerinden yükleme (Vercel Blob veya <= 3.5 MB R2 CORS yedeği)
    if (action === 'upload') {
      try {
        const id = sanitizeId(body?.product?.id || `urun-${Date.now()}`);
        const glbBuf = decodeBase64Payload(body?.glbBase64);
        if (!glbBuf.length) {
          return res.status(400).json({ ok: false, error: 'Boş .GLB dosyası yüklenemez.' });
        }
        if (glbBuf.length > MAX_SERVER_UPLOAD_BYTES) {
          return res.status(413).json({
            ok: false,
            error:
              'Dosya 3.5 MB üzerinde. Büyük CAD dosyalarını doğrudan yüklemek için Cloudflare R2 CORS kuralını aktif edin.',
          });
        }

        const thumbBuf = body?.thumbDataUrl ? decodeBase64Payload(body.thumbDataUrl) : null;
        const glbKey = `models/${id}.glb`;
        const thumbKey = `thumbs/${id}.jpg`;

        let glbPublicUrl = '';
        let thumbPublicUrl = '';

        if (env.provider === 'r2' && env.r2) {
          const putGlb = await r2SignedFetch(env.r2, 'PUT', glbKey, {
            body: glbBuf,
            contentType: 'model/gltf-binary',
            cacheControl: 'public, max-age=31536000, immutable',
          });
          if (!putGlb.ok) {
            const errTxt = await putGlb.text().catch(() => '');
            throw new Error(`R2 .GLB yükleme hatası (${putGlb.status}): ${errTxt.slice(0, 180)}`);
          }
          glbPublicUrl = buildPublicAssetUrl(env, glbKey);

          if (thumbBuf && thumbBuf.length > 0 && thumbBuf.length < 600_000) {
            const putTh = await r2SignedFetch(env.r2, 'PUT', thumbKey, {
              body: thumbBuf,
              contentType: 'image/jpeg',
              cacheControl: 'public, max-age=31536000, immutable',
            });
            if (putTh.ok) {
              thumbPublicUrl = buildPublicAssetUrl(env, thumbKey);
            }
          }
        } else if (env.provider === 'vercel-blob') {
          const { put } = await import('@vercel/blob');
          const glbBlob = await put(glbKey, glbBuf, {
            access: 'public',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'model/gltf-binary',
            cacheControlMaxAge: 31536000,
            token: env.blobToken,
          });
          glbPublicUrl = glbBlob.url;

          if (thumbBuf && thumbBuf.length > 0 && thumbBuf.length < 600_000) {
            const thBlob = await put(thumbKey, thumbBuf, {
              access: 'public',
              addRandomSuffix: false,
              allowOverwrite: true,
              contentType: 'image/jpeg',
              cacheControlMaxAge: 31536000,
              token: env.blobToken,
            });
            thumbPublicUrl = thBlob.url;
          }
        }

        const record = sanitizeProductRecord(
          { ...body?.product, id },
          glbPublicUrl,
          thumbPublicUrl
        );
        const existing = await readCatalog(env);
        const next = [record, ...existing.filter((p) => p.id !== record.id)];
        await writeCatalog(env, next);

        return res.status(200).json({
          ok: true,
          provider: env.provider,
          product: record,
          count: next.length,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Bulut yükleme hatası.',
        });
      }
    }

    // D) Özel ürünü kalıcı depodan sil
    if (action === 'delete') {
      const id = sanitizeId(body?.id);
      if (!id) {
        return res.status(400).json({ ok: false, error: 'Silinecek ürün kimliği eksik.' });
      }
      try {
        const existing = await readCatalog(env);
        const target = existing.find((p) => p.id === id);
        const next = existing.filter((p) => p.id !== id);
        await writeCatalog(env, next);

        if (env.provider === 'r2' && env.r2) {
          await r2SignedFetch(env.r2, 'DELETE', `models/${id}.glb`).catch(() => {});
          await r2SignedFetch(env.r2, 'DELETE', `thumbs/${id}.jpg`).catch(() => {});
        } else if (env.provider === 'vercel-blob' && target) {
          const { del } = await import('@vercel/blob');
          const urls = [target.glbUrl, target.thumbUrl].filter(
            (u) => typeof u === 'string' && u.includes('blob.vercel-storage.com')
          );
          if (urls.length > 0) {
            await del(urls, { token: env.blobToken }).catch(() => {});
          }
        }

        return res.status(200).json({ ok: true, id, count: next.length });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Ürün silinemedi.',
        });
      }
    }

    return res.status(400).json({ ok: false, error: 'Geçersiz POST işlemi.' });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
