import * as THREE from 'three';
import type { FloorMaterialKind, WallPattern } from './types';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [235, 232, 224];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function shade(rgb: [number, number, number], delta: number): string {
  return `rgb(${clamp255(rgb[0] + delta)}, ${clamp255(rgb[1] + delta)}, ${clamp255(rgb[2] + delta)})`;
}

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// Cache the expensive drawn HTMLCanvasElement strictly by (type + color), NOT by room repeat!
// Changing room width/depth/height updates repeat in 0.001 ms with ZERO pixel redrawing!
const CANVAS_CACHE = new Map<string, HTMLCanvasElement>();
const TEXTURE_CACHE = new Map<string, THREE.CanvasTexture>();
const MAX_CANVAS_ENTRIES = 36;
const MAX_TEX_ENTRIES = 64;

function getCachedCanvas(key: string, draw: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = CANVAS_CACHE.get(key);
  if (hit) {
    CANVAS_CACHE.delete(key);
    CANVAS_CACHE.set(key, hit);
    return hit;
  }
  if (CANVAS_CACHE.size >= MAX_CANVAS_ENTRIES) {
    const oldest = CANVAS_CACHE.keys().next().value;
    if (oldest) CANVAS_CACHE.delete(oldest);
  }
  const c = draw();
  CANVAS_CACHE.set(key, c);
  return c;
}

function getCachedTextureFromCanvas(
  baseKey: string,
  drawCanvas: () => HTMLCanvasElement,
  rx: number,
  ry: number,
  wrap = true
): THREE.CanvasTexture {
  // Reuse single Texture per baseKey when updating repeat in place (for floor), or per rounded repeat for zones
  const texKey = `${baseKey}`;
  const hit = TEXTURE_CACHE.get(texKey);
  if (hit) {
    hit.repeat.set(rx, ry);
    return hit;
  }
  if (TEXTURE_CACHE.size >= MAX_TEX_ENTRIES) {
    const oldest = TEXTURE_CACHE.keys().next().value;
    if (oldest) {
      TEXTURE_CACHE.get(oldest)?.dispose();
      TEXTURE_CACHE.delete(oldest);
    }
  }
  const canvas = getCachedCanvas(baseKey, drawCanvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.repeat.set(rx, ry);
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  TEXTURE_CACHE.set(texKey, tex);
  return tex;
}

export function createFloorTexture(
  kind: FloorMaterialKind,
  tintHex: string,
  roomW: number,
  roomD: number
): THREE.CanvasTexture {
  const tileM = kind === 'travertine' || kind === 'marble' ? 1.4 : 1.65;
  const rx = Number(Math.max(1, roomW / tileM).toFixed(2));
  const ry = Number(Math.max(1, roomD / tileM).toFixed(2));
  const baseKey = `floor:${kind}:${tintHex.toLowerCase()}`;

  return getCachedTextureFromCanvas(
    baseKey,
    () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      const rgb = hexToRgb(tintHex);
      const rand = seededRand(kind.length * 911 + rgb[0] * 17);

      ctx.fillStyle = shade(rgb, 0);
      ctx.fillRect(0, 0, size, size);

      if (kind === 'herringbone_oak') {
        const cols = 8;
        const rows = 16;
        const cw = size / cols;
        const rh = size / rows;
        for (let r = -2; r < rows + 2; r++) {
          for (let col = 0; col < cols; col++) {
            const d = (rand() - 0.5) * 20;
            const x = col * cw;
            const y = r * rh;
            const up = col % 2 === 0;
            ctx.fillStyle = shade(rgb, d);
            ctx.beginPath();
            if (up) {
              ctx.moveTo(x, y);
              ctx.lineTo(x + cw, y + rh);
              ctx.lineTo(x + cw, y + rh * 2);
              ctx.lineTo(x, y + rh);
            } else {
              ctx.moveTo(x, y + rh);
              ctx.lineTo(x + cw, y);
              ctx.lineTo(x + cw, y + rh);
              ctx.lineTo(x, y + rh * 2);
            }
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(42, 28, 16, 0.22)';
            ctx.lineWidth = 0.85;
            ctx.stroke();
          }
        }
      } else if (kind === 'plank_oak' || kind === 'plank_walnut') {
        const rows = 8;
        const rh = size / rows;
        for (let r = 0; r < rows; r++) {
          const y = r * rh;
          const offset = (r % 2) * (size * 0.45);
          for (let seg = -1; seg <= 2; seg++) {
            const x = seg * (size * 0.65) + offset;
            ctx.fillStyle = shade(rgb, (rand() - 0.5) * 24);
            ctx.fillRect(x, y, size * 0.65, rh);
            ctx.strokeStyle = 'rgba(30, 20, 12, 0.28)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, size * 0.65, rh);
          }
        }
      } else if (kind === 'travertine' || kind === 'marble') {
        const tiles = 2;
        const tw = size / tiles;
        for (let tx = 0; tx < tiles; tx++) {
          for (let ty = 0; ty < tiles; ty++) {
            ctx.fillStyle = shade(rgb, (rand() - 0.5) * 10);
            ctx.fillRect(tx * tw, ty * tw, tw, tw);
            const veinCount = kind === 'marble' ? 4 : 6;
            for (let v = 0; v < veinCount; v++) {
              ctx.strokeStyle =
                kind === 'marble'
                  ? `rgba(115, 110, 102, ${0.1 + rand() * 0.12})`
                  : `rgba(130, 116, 98, ${0.07 + rand() * 0.08})`;
              ctx.lineWidth = kind === 'marble' ? 1 + rand() * 1.6 : 0.9 + rand();
              ctx.beginPath();
              ctx.moveTo(tx * tw + rand() * tw, ty * tw);
              ctx.bezierCurveTo(
                tx * tw + rand() * tw,
                ty * tw + tw * 0.35,
                tx * tw + rand() * tw,
                ty * tw + tw * 0.7,
                tx * tw + rand() * tw,
                ty * tw + tw
              );
              ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(70, 65, 58, 0.18)';
            ctx.lineWidth = 1.1;
            ctx.strokeRect(tx * tw, ty * tw, tw, tw);
          }
        }
      } else if (kind === 'microcement') {
        for (let i = 0; i < 140; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const r = 8 + rand() * 22;
          const d = (rand() - 0.5) * 16;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, `rgba(${clamp255(rgb[0] + d)},${clamp255(rgb[1] + d)},${clamp255(rgb[2] + d)},0.25)`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
      } else if (kind === 'terrazzo') {
        const chipPalette = [
          'rgba(105, 92, 78, 0.52)',
          'rgba(178, 152, 122, 0.55)',
          'rgba(62, 62, 66, 0.45)',
          'rgba(248, 245, 238, 0.65)',
        ];
        for (let i = 0; i < 160; i++) {
          ctx.fillStyle = chipPalette[Math.floor(rand() * chipPalette.length)];
          ctx.fillRect(rand() * size, rand() * size, 3 + rand() * 6, 3 + rand() * 6);
        }
      }
      return c;
    },
    rx,
    ry,
    true
  );
}

export function createWallTexture(pattern: WallPattern, colorHex: string, repeatX?: number, repeatY?: number): THREE.CanvasTexture {
  const perMeter = pattern === 'slats' ? 1.15 : pattern === 'boiserie' ? 0.68 : 0.72;
  const rx = Number((repeatX ?? perMeter).toFixed(2));
  const ry = Number((repeatY ?? perMeter).toFixed(2));
  const canvasKey = `wallCanvas:${pattern}:${colorHex.toLowerCase()}`;
  // Bucket repeat slightly for zones so dragging sliders reuses cached canvas instantaneously!
  const texKey = `${canvasKey}:${Math.round(rx * 2)}:${Math.round(ry * 2)}`;

  const hit = TEXTURE_CACHE.get(texKey);
  if (hit) return hit;

  if (TEXTURE_CACHE.size >= MAX_TEX_ENTRIES) {
    const oldest = TEXTURE_CACHE.keys().next().value;
    if (oldest) {
      TEXTURE_CACHE.get(oldest)?.dispose();
      TEXTURE_CACHE.delete(oldest);
    }
  }

  const canvas = getCachedCanvas(canvasKey, () => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const rgb = hexToRgb(colorHex);
    const rand = seededRand(pattern.length * 733 + rgb[0] * 31 + rgb[1] * 13);

    ctx.fillStyle = shade(rgb, 0);
    ctx.fillRect(0, 0, size, size);

    if (pattern === 'smooth') {
      for (let i = 0; i < 200; i++) {
        ctx.fillStyle = shade(rgb, (rand() - 0.5) * 6);
        ctx.fillRect(rand() * size, rand() * size, 3, 3);
      }
    } else if (pattern === 'boiserie') {
      const pad = 18;
      ctx.strokeStyle = shade(rgb, -24);
      ctx.lineWidth = 6;
      ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
      ctx.strokeStyle = shade(rgb, 18);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(pad + 3, pad + 3, size - (pad + 3) * 2, size - (pad + 3) * 2);
      ctx.strokeStyle = shade(rgb, -14);
      ctx.lineWidth = 2;
      ctx.strokeRect(pad + 10, pad + 10, size - (pad + 10) * 2, size - (pad + 10) * 2);
    } else if (pattern === 'slats') {
      ctx.fillStyle = '#232220';
      ctx.fillRect(0, 0, size, size);
      const slats = 12;
      const pitch = size / slats;
      const slatW = pitch * 0.64;
      for (let i = 0; i < slats; i++) {
        const x = i * pitch + pitch * 0.18;
        const d = (rand() - 0.5) * 16;
        const grad = ctx.createLinearGradient(x, 0, x + slatW, 0);
        grad.addColorStop(0, shade(rgb, d - 16));
        grad.addColorStop(0.25, shade(rgb, d + 8));
        grad.addColorStop(1, shade(rgb, d - 20));
        ctx.fillStyle = grad;
        ctx.fillRect(x, 0, slatW, size);
      }
    } else if (pattern === 'marble') {
      for (let v = 0; v < 7; v++) {
        ctx.strokeStyle = `rgba(110, 104, 96, ${0.1 + rand() * 0.15})`;
        ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath();
        ctx.moveTo(rand() * size, 0);
        ctx.bezierCurveTo(rand() * size, size * 0.35, rand() * size, size * 0.7, rand() * size, size);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(80,75,68,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(1, 1, size - 2, size - 2);
    } else if (pattern === 'mirror') {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#dde6ed');
      grad.addColorStop(0.35, '#f6f9fc');
      grad.addColorStop(0.6, '#c8d4de');
      grad.addColorStop(1, '#e8eff5');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(30,30,30,0.22)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, size - 4, size - 4);
    } else if (pattern === 'concrete') {
      for (let i = 0; i < 120; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const r = 8 + rand() * 24;
        const d = (rand() - 0.5) * 24;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${clamp255(rgb[0] + d)},${clamp255(rgb[1] + d)},${clamp255(rgb[2] + d)},0.3)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.strokeStyle = 'rgba(40,40,40,0.16)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, size - 2, size - 2);
    } else if (pattern === 'stone') {
      const rows = 6;
      const rh = size / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const off = (r % 2) * 58;
        for (let cIdx = -1; cIdx <= 3; cIdx++) {
          const bw = 96 + (cIdx % 2) * 20;
          const x = cIdx * 108 + off;
          ctx.fillStyle = shade(rgb, (rand() - 0.5) * 20);
          ctx.fillRect(x, y, bw, rh);
          ctx.strokeStyle = 'rgba(50,45,38,0.22)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(x, y, bw, rh);
        }
      }
    } else if (pattern === 'wallpaper') {
      for (let x = 0; x < size; x += 4) {
        ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
        ctx.fillRect(x, 0, 2, size);
      }
    }
    return c;
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  TEXTURE_CACHE.set(texKey, tex);
  return tex;
}

export function createWovenRugTexture(baseHex: string, borderHex: string): THREE.CanvasTexture {
  const key = `rug:${baseHex.toLowerCase()}:${borderHex.toLowerCase()}`;
  return getCachedTextureFromCanvas(
    key,
    () => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      const rgb = hexToRgb(baseHex);
      const rand = seededRand(rgb[0] * 19 + 42);

      ctx.fillStyle = shade(rgb, 0);
      ctx.fillRect(0, 0, size, size);

      for (let y = 0; y < size; y += 3) {
        for (let x = 0; x < size; x += 6) {
          ctx.fillStyle = shade(rgb, (rand() - 0.5) * 14);
          ctx.fillRect(x, y, 5, 2);
        }
      }

      ctx.strokeStyle = borderHex;
      ctx.lineWidth = 6;
      ctx.strokeRect(14, 14, size - 28, size - 28);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(24, 24, size - 48, size - 48);
      return c;
    },
    1,
    1,
    false
  );
}
