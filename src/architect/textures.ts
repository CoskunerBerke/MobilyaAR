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

/**
 * Creates a seamless tileable floor CanvasTexture scaled in meters (repeat handled by caller).
 */
export function createFloorTexture(
  kind: FloorMaterialKind,
  tintHex: string,
  roomW: number,
  roomD: number
): THREE.CanvasTexture {
  const size = 512;
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
        ctx.lineWidth = 1.1;
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
        const d = (rand() - 0.5) * 24;
        ctx.fillStyle = shade(rgb, d);
        ctx.fillRect(x, y, size * 0.65, rh);
        // Subtle wood grain streaks
        ctx.strokeStyle = `rgba(38, 24, 14, ${kind === 'plank_walnut' ? 0.16 : 0.1})`;
        ctx.lineWidth = 1;
        for (let g = 0; g < 6; g++) {
          const gy = y + ((g + 0.5) / 6) * rh;
          ctx.beginPath();
          ctx.moveTo(x, gy);
          ctx.bezierCurveTo(
            x + size * 0.2,
            gy + (rand() - 0.5) * 5,
            x + size * 0.45,
            gy + (rand() - 0.5) * 5,
            x + size * 0.65,
            gy
          );
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(30, 20, 12, 0.28)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x, y, size * 0.65, rh);
      }
    }
  } else if (kind === 'travertine' || kind === 'marble') {
    const tiles = 2;
    const tw = size / tiles;
    for (let tx = 0; tx < tiles; tx++) {
      for (let ty = 0; ty < tiles; ty++) {
        const d = (rand() - 0.5) * 10;
        ctx.fillStyle = shade(rgb, d);
        ctx.fillRect(tx * tw, ty * tw, tw, tw);

        // Veins
        const veinCount = kind === 'marble' ? 5 : 9;
        for (let v = 0; v < veinCount; v++) {
          ctx.strokeStyle =
            kind === 'marble'
              ? `rgba(115, 110, 102, ${0.09 + rand() * 0.12})`
              : `rgba(130, 116, 98, ${0.06 + rand() * 0.08})`;
          ctx.lineWidth = kind === 'marble' ? 1.2 + rand() * 2.2 : 1 + rand() * 1.4;
          ctx.beginPath();
          const sx = tx * tw + rand() * tw;
          const sy = ty * tw;
          ctx.moveTo(sx, sy);
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
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tx * tw, ty * tw, tw, tw);
      }
    }
  } else if (kind === 'microcement') {
    for (let i = 0; i < 650; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 8 + rand() * 34;
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
      'rgba(148, 108, 86, 0.48)',
    ];
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = chipPalette[Math.floor(rand() * chipPalette.length)];
      const cx = rand() * size;
      const cy = rand() * size;
      const rad = 2 + rand() * 8;
      const sides = 4 + Math.floor(rand() * 3);
      ctx.beginPath();
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 + rand() * 0.4;
        const rr = rad * (0.65 + rand() * 0.5);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const tileM = kind === 'travertine' || kind === 'marble' ? 1.4 : 1.65;
  tex.repeat.set(Math.max(1, roomW / tileM), Math.max(1, roomD / tileM));
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Creates a world-unit repeatable wall texture for ExtrudeGeometry (UVs are in meters!).
 */
export function createWallTexture(pattern: WallPattern, colorHex: string): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const rgb = hexToRgb(colorHex);
  const rand = seededRand(pattern.length * 733 + rgb[0] * 31 + rgb[1] * 13);

  ctx.fillStyle = shade(rgb, 0);
  ctx.fillRect(0, 0, size, size);

  if (pattern === 'smooth') {
    // Micro architectural plaster stipple
    for (let i = 0; i < 900; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const d = (rand() - 0.5) * 8;
      ctx.fillStyle = shade(rgb, d);
      ctx.fillRect(x, y, 3, 3);
    }
  } else if (pattern === 'boiserie') {
    // Architectural French wall molding panel grid
    const pad = 34;
    ctx.strokeStyle = shade(rgb, -24);
    ctx.lineWidth = 10;
    ctx.strokeRect(pad, pad, size - pad * 2, size - pad * 2);
    ctx.strokeStyle = shade(rgb, 18);
    ctx.lineWidth = 4;
    ctx.strokeRect(pad + 5, pad + 5, size - (pad + 5) * 2, size - (pad + 5) * 2);
    // Inner fillet
    ctx.strokeStyle = shade(rgb, -14);
    ctx.lineWidth = 3;
    ctx.strokeRect(pad + 18, pad + 18, size - (pad + 18) * 2, size - (pad + 18) * 2);
  } else if (pattern === 'slats') {
    // Acoustic vertical wood slats over dark felt backing
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
      grad.addColorStop(0.22, shade(rgb, d + 8));
      grad.addColorStop(0.82, shade(rgb, d));
      grad.addColorStop(1, shade(rgb, d - 22));
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, slatW, size);
    }
  } else if (pattern === 'concrete') {
    for (let i = 0; i < 420; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 10 + rand() * 44;
      const d = (rand() - 0.5) * 24;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${clamp255(rgb[0] + d)},${clamp255(rgb[1] + d)},${clamp255(rgb[2] + d)},0.3)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Architectural formwork seam + tie holes
    ctx.strokeStyle = 'rgba(40,40,40,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, size - 4, size - 4);
    ctx.fillStyle = 'rgba(35,35,35,0.28)';
    for (const [px, py] of [
      [88, 88],
      [size - 88, 88],
      [88, size - 88],
      [size - 88, size - 88],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === 'stone') {
    const rows = 6;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const off = (r % 2) * 110;
      for (let cIdx = -1; cIdx <= 3; cIdx++) {
        const bw = 190 + (cIdx % 2) * 40;
        const x = cIdx * 210 + off;
        const d = (rand() - 0.5) * 22;
        ctx.fillStyle = shade(rgb, d);
        ctx.fillRect(x, y, bw, rh);
        ctx.strokeStyle = 'rgba(50,45,38,0.22)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, bw, rh);
      }
    }
  } else if (pattern === 'wallpaper') {
    // Subtle vertical woven linen weave
    for (let x = 0; x < size; x += 4) {
      ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(x, 0, 2, size);
    }
    for (let y = 0; y < size; y += 6) {
      ctx.fillStyle = y % 12 === 0 ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, y, size, 1.5);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry uses 1 UV unit = 1 meter -> repeat controls tiles per meter!
  const perMeter = pattern === 'slats' ? 1.15 : pattern === 'boiserie' ? 0.68 : 0.72;
  tex.repeat.set(perMeter, perMeter);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function createWovenRugTexture(baseHex: string, borderHex: string): THREE.CanvasTexture {
  const size = 512;
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
      const d = (rand() - 0.5) * 14;
      ctx.fillStyle = shade(rgb, d);
      ctx.fillRect(x, y, 5, 2);
    }
  }

  // Minimal architectural border frame
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(22, 22, size - 44, size - 44);
  ctx.lineWidth = 2;
  ctx.strokeRect(38, 38, size - 76, size - 76);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
