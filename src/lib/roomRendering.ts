import * as THREE from 'three';
import { extractExifFocal35mm } from './exif';

export async function normalizeRoomPhoto(
  file: File,
  maxEdge = 1600
): Promise<{ dataUrl: string; exifFocal35mm?: number }> {
  const exifFocal35mm = await extractExifFocal35mm(file);
  let src: CanvasImageSource;
  let w: number;
  let h: number;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    src = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    src = img;
    w = img.naturalWidth;
    h = img.naturalHeight;
  }
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.9), exifFocal35mm };
}

export function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
}

export async function loadThreeTexture(
  url: string,
  colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace
): Promise<THREE.Texture> {
  const img = await loadHtmlImage(url);
  const tex = new THREE.Texture(img);
  tex.colorSpace = colorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Oda fotoğrafından pencere/ışık yönünü, ortam yansımasını ve doğal aydınlatmayı çıkarır. */
export function buildRoomEnvironment(img: HTMLImageElement, renderer: THREE.WebGLRenderer) {
  const s = 48;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  const top = [0, 0, 0];
  const bot = [0, 0, 0];
  let lUpper = 0;
  let rUpper = 0;
  let lum = 0;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const v = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      lum += v;
      if (y < s / 2) {
        if (x < s / 2) lUpper += v;
        else rUpper += v;
        top[0] += d[i];
        top[1] += d[i + 1];
        top[2] += d[i + 2];
      } else {
        bot[0] += d[i];
        bot[1] += d[i + 1];
        bot[2] += d[i + 2];
      }
    }
  }

  const n = (s * s) / 2;
  const col = (a: number[]) => new THREE.Color(a[0] / n / 255, a[1] / n / 255, a[2] / n / 255);
  lum /= s * s;

  const ec = document.createElement('canvas');
  ec.width = 512;
  ec.height = 256;
  const e = ec.getContext('2d')!;
  e.filter = 'blur(10px)';
  e.drawImage(img, 0, 0, 256, 256);
  e.translate(512, 0);
  e.scale(-1, 1);
  e.drawImage(img, 0, 0, 256, 256);
  const et = new THREE.CanvasTexture(ec);
  et.mapping = THREE.EquirectangularReflectionMapping;
  et.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(et).texture;
  et.dispose();
  pm.dispose();

  return {
    env,
    sky: col(top),
    ground: col(bot),
    lum,
    sideBias: (rUpper - lUpper) / Math.max(0.05, rUpper + lUpper),
  };
}

/** Gerçekçi kumaş/ahşap PBR ayarları: plastik parlaklığı önler, AO derinliğini öne çıkarır. */
export function preparePhotorealMaterial(mat: THREE.Material, maxAniso: number, isFabricCategory = false) {
  const sm = mat as THREE.MeshStandardMaterial;
  if (sm.map) sm.map.anisotropy = maxAniso;
  if (sm.normalMap) sm.normalMap.anisotropy = maxAniso;
  if (sm.roughnessMap) sm.roughnessMap.anisotropy = maxAniso;
  if (sm.aoMap) {
    sm.aoMap.anisotropy = maxAniso;
    sm.aoMapIntensity = 1.35;
  }
  sm.envMapIntensity = 0.42;
  if ((sm.metalness ?? 0) < 0.25 && (isFabricCategory || !sm.roughnessMap)) {
    sm.roughness = Math.max(sm.roughness ?? 0.8, 0.78);
  }
}

export function decodeBase64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
