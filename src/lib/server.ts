const DEFAULT_POD = '0i27zgeirpejj9';
const KEY = 'mekanar_pod_v2';

export function podToUrl(input: string): string {
  const t = input.trim().replace(/\/+$/, '');
  if (t.startsWith('http')) return t;
  return `https://${t.replace(/-8000\.proxy\.runpod\.net.*$/i, '')}-8000.proxy.runpod.net`;
}

export function getServerUrl(): string {
  const q = new URLSearchParams(window.location.search).get('srv');
  if (q) {
    try {
      localStorage.setItem(KEY, q);
    } catch {
      /* ignore */
    }
    return podToUrl(q);
  }
  try {
    const s = localStorage.getItem(KEY);
    if (s) return podToUrl(s);
  } catch {
    /* ignore */
  }
  return podToUrl(DEFAULT_POD);
}

export function setServerPod(pod: string): string {
  try {
    localStorage.setItem(KEY, pod.trim());
  } catch {
    /* ignore */
  }
  return podToUrl(pod);
}

export function getPodId(url: string): string {
  const m = url.match(/https:\/\/([^-]+)-8000/);
  return m ? m[1] : url;
}

export const DEFAULT_PUBLIC_ORIGIN = 'https://mobilya-ar.vercel.app';

export function getPublicOrigin(): string {
  if (typeof window === 'undefined') return DEFAULT_PUBLIC_ORIGIN;
  const h = window.location.hostname;
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.startsWith('192.168.') ||
    h.endsWith('.vercel.app')
  ) {
    return DEFAULT_PUBLIC_ORIGIN;
  }
  return window.location.origin;
}

export function buildShareUrl(opts: {
  productId: string;
  glbUrl?: string;
  productName?: string;
  dimensionsCm?: string;
  mode?: 'preview' | 'photo' | 'studio';
  oda?: string;
  colorHex?: string;
  serverOnline?: boolean;
  serverUrl?: string;
}): string {
  const q = new URLSearchParams();
  const hasRemoteGlb = Boolean(opts.glbUrl && opts.glbUrl.startsWith('http'));
  const safeId = !hasRemoteGlb && opts.productId.startsWith('cad-local-') ? 'ikea-landskrona-sofa' : opts.productId;
  q.set('urun', safeId);
  if (opts.mode && opts.mode !== 'preview') q.set('mod', opts.mode);
  if (opts.oda) q.set('oda', opts.oda);
  if (opts.colorHex) q.set('renk', opts.colorHex);
  if (hasRemoteGlb && opts.glbUrl) {
    q.set('glb', opts.glbUrl);
    if (opts.productName) q.set('name', opts.productName);
    if (opts.dimensionsCm) q.set('dim', opts.dimensionsCm);
  }
  if (opts.serverOnline && opts.serverUrl) {
    q.set('srv', getPodId(opts.serverUrl));
  }
  return `${getPublicOrigin()}/?${q.toString()}`;
}

export interface ServerHealth {
  online: boolean;
  version?: string;
  gpu?: string;
  modelsLoaded?: boolean;
  lamaLoaded?: boolean;
  hy3dReady?: boolean;
}

export async function checkHealth(url: string): Promise<ServerHealth> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 6000);
  try {
    const r = await fetch(`${url}/health`, { signal: c.signal });
    if (!r.ok) return { online: false };
    const j = await r.json();
    return {
      online: j.status === 'ok',
      version: j.version,
      gpu: j.gpu,
      modelsLoaded: Boolean(j.models_loaded),
      lamaLoaded: Boolean(j.lama_loaded),
      hy3dReady: Boolean(j.hy3d_ready),
    };
  } catch {
    return { online: false };
  } finally {
    clearTimeout(t);
  }
}

export interface ErasableObject {
  label: string;
  u: number;
  v: number;
  areaRatio: number;
}

export interface RoomAnalysis {
  imageWidth: number;
  imageHeight: number;
  focalPx: number;
  vfovDeg: number;
  hfovDeg: number;
  cameraHeightM: number;
  pitchDownDeg: number;
  rollDeg: number;
  cameraBasis: { right: number[]; up: number[]; back: number[] };
  floorInlierRatio: number;
  floorCoverage: number;
  floorDepthMedianM?: number;
  scaleFactor?: number;
  erasableObjects?: ErasableObject[];
  depthMap: string;
  depthMapWidth: number;
  depthMapHeight: number;
  elapsedMs: number;
}

async function parseError(r: Response, fallback: string): Promise<string> {
  try {
    const j = await r.json();
    if (j?.detail && typeof j.detail === 'string') return j.detail;
  } catch {
    /* ignore */
  }
  return `${fallback} (${r.status})`;
}

export async function analyzeRoom(
  url: string,
  imageDataUrl: string,
  exifFocal35mm?: number
): Promise<RoomAnalysis> {
  const payload: { image: string; exifFocal35mm?: number } = { image: imageDataUrl };
  if (exifFocal35mm && Number.isFinite(exifFocal35mm)) {
    payload.exifFocal35mm = exifFocal35mm;
  }
  const r = await fetch(`${url}/analyze-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    throw new Error(await parseError(r, 'Sunucu hatası'));
  }
  return r.json();
}

export interface EraseObjectParams {
  image: string;
  tapU?: number;
  tapV?: number;
  brushMask?: string;
  exifFocal35mm?: number;
}

export interface EraseObjectResult {
  ok: boolean;
  cleanedImage: string;
  erasedLabel: string;
  analysis: RoomAnalysis;
}

export async function eraseObjectInRoom(
  url: string,
  params: EraseObjectParams
): Promise<EraseObjectResult> {
  const r = await fetch(`${url}/erase-object`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!r.ok) {
    throw new Error(await parseError(r, 'Eşya silme hatası'));
  }
  return r.json();
}

export interface Generate3DPayload {
  images: {
    front: string;
    back?: string | null;
    left?: string | null;
    right?: string | null;
  };
  name: string;
  width_cm?: number;
  depth_cm?: number;
  height_cm?: number;
}

export interface Generate3DResult {
  ok: boolean;
  filename: string;
  glbUrl: string;
  sizeKB: number;
  elapsedSec: number;
}

export async function generateProduct3D(
  url: string,
  payload: Generate3DPayload
): Promise<Generate3DResult> {
  const images: Record<string, string> = { front: payload.images.front };
  if (payload.images.back) images.back = payload.images.back;
  if (payload.images.left) images.left = payload.images.left;
  if (payload.images.right) images.right = payload.images.right;

  const r = await fetch(`${url}/generate-3d`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images,
      name: payload.name,
      width_cm: payload.width_cm,
      depth_cm: payload.depth_cm,
      height_cm: payload.height_cm,
    }),
  });
  if (!r.ok) {
    throw new Error(await parseError(r, '3D üretim hatası'));
  }
  const res = (await r.json()) as Generate3DResult;
  const cleanBase = url.replace(/\/+$/, '');
  return {
    ...res,
    glbUrl: res.filename ? `${cleanBase}/models/${res.filename}` : res.glbUrl,
  };
}

export interface UploadGlbResult {
  ok: boolean;
  filename: string;
  glbUrl: string;
  sizeKB: number;
}

export async function uploadCustomGlb(
  url: string,
  name: string,
  glbBuffer: ArrayBuffer
): Promise<UploadGlbResult> {
  const bytes = new Uint8Array(glbBuffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const glbBase64 = btoa(binary);

  const cleanBase = url.replace(/\/+$/, '');
  const r = await fetch(`${cleanBase}/upload-glb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, glbBase64 }),
  });
  if (!r.ok) {
    throw new Error(await parseError(r, 'GLB yükleme hatası'));
  }
  const res = (await r.json()) as UploadGlbResult;
  return {
    ...res,
    glbUrl: res.filename ? `${cleanBase}/models/${res.filename}` : res.glbUrl,
  };
}

export type ExistingFurnitureKind =
  | 'bed'
  | 'sofa'
  | 'armchair'
  | 'desk'
  | 'table'
  | 'coffee_table'
  | 'chair'
  | 'bookcase'
  | 'cabinet'
  | 'tv';

export interface ReconstructedObject3D {
  id: string;
  kind: ExistingFurnitureKind;
  label: string;
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
  colorHex: string;
}

export interface ReconstructedCamera {
  index: number;
  label: string;
  pos: [number, number, number];
  lookAt: [number, number, number];
  vfovDeg: number;
  imageWidth: number;
  imageHeight: number;
  basis: { right: number[]; up: number[]; back: number[] };
  photoUrl: string;
  cleanPhotoUrl: string;
}

export interface ReconstructRoomResult {
  ok: boolean;
  version: string;
  elapsedMs: number;
  viewCount: number;
  matchedViews: number;
  roomWidthM: number;
  roomDepthM: number;
  ceilingHeightM: number;
  floorTexture: string;
  wallTextures: {
    north: string;
    south: string;
    west: string;
    east: string;
  };
  existingObjects: ReconstructedObject3D[];
  spawnXZ: [number, number];
  cameras: ReconstructedCamera[];
  lightDir: [number, number, number];
}

export async function reconstructRoom3D(
  url: string,
  images: string[],
  exifFocals?: Array<number | null | undefined>
): Promise<ReconstructRoomResult> {
  const cleanBase = url.replace(/\/+$/, '');
  const payload: { images: string[]; exifFocals?: Array<number | null> } = { images };
  if (exifFocals && exifFocals.length > 0) {
    payload.exifFocals = exifFocals.map((v) => (v && Number.isFinite(v) ? v : null));
  }
  const r = await fetch(`${cleanBase}/reconstruct-room`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    throw new Error(await parseError(r, '3D oda modelleme hatası'));
  }
  return r.json();
}
