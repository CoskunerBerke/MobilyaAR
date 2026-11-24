import type { Product } from '../lib/products';
import type { DoorKind, ParametricFurnitureKind, WallPattern, WindowKind } from './types';

export type QuickAddCommand =
  | {
      kind: 'parametric';
      parametricKind: ParametricFurnitureKind;
      name: string;
      category: string;
      widthCm: number;
      depthCm: number;
      heightCm: number;
      yCm: number;
      mountMode: 'floor' | 'wall' | 'ceiling' | 'rug';
      colorHex: string;
      accentHex: string;
    }
  | {
      kind: 'catalog';
      product: Product;
      widthCm?: number;
      depthCm?: number;
      heightCm?: number;
    }
  | { kind: 'window'; windowKind: WindowKind; widthCm?: number; heightCm?: number }
  | { kind: 'door'; doorKind: DoorKind; widthCm?: number }
  | { kind: 'column'; shape: 'rect' | 'round'; widthCm: number; depthCm: number }
  | { kind: 'beam'; axis: 'x' | 'z'; widthCm: number; dropCm: number }
  | { kind: 'cove' }
  | { kind: 'wallZone'; pattern: WallPattern; colorHex: string; widthCm: number; heightCm?: number };

function normalizeTr(s: string): string {
  return s
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

const COLOR_KEYWORDS: Array<{ keys: string[]; hex: string }> = [
  { keys: ['beyaz', 'ekru', 'kirec'], hex: '#f2f0ea' },
  { keys: ['siyah', 'antrasit', 'koyu gri', 'fume'], hex: '#26272a' },
  { keys: ['gri', 'tas', 'beton'], hex: '#a8a49c' },
  { keys: ['krem', 'bej', 'kum'], hex: '#e2d9c8' },
  { keys: ['ceviz', 'kahve', 'ahsap', 'koyu ahsap'], hex: '#78563c' },
  { keys: ['mese', 'acik ahsap'], hex: '#c29e74' },
  { keys: ['yesil', 'adacayi', 'zeytin'], hex: '#6c7c68' },
  { keys: ['lacivert', 'mavi'], hex: '#2f455c' },
  { keys: ['bordo', 'kirmizi', 'terracotta', 'kiremit'], hex: '#a45d4a' },
  { keys: ['altin', 'pirinc', 'gold', 'bronz'], hex: '#c8a86b' },
  { keys: ['mermer'], hex: '#ece9e2' },
];

function extractColorHex(norm: string): string | undefined {
  const hexMatch = norm.match(/#[0-9a-f]{6}\b/);
  if (hexMatch) return hexMatch[0];
  for (const c of COLOR_KEYWORDS) {
    if (c.keys.some((k) => norm.includes(k))) return c.hex;
  }
  return undefined;
}

/**
 * Extracts explicit cm dimensions such as "180x90", "220x45x260", "160 cm", or TV inches "65 inc" / "75\"".
 */
function extractDims(norm: string): { w?: number; d?: number; h?: number; tvInch?: number } {
  // Check TV diagonal inches (e.g. 55 inc, 65", 75 inch, 85 inç)
  const inchM = norm.match(/\b(32|40|42|43|48|50|55|60|65|70|75|77|82|85|98)\s*(?:inc|inch|"|'')\b/);
  const tvInch = inchM ? Number(inchM[1]) : undefined;

  // Check WxDxH or WxH (e.g. 180x90 or 200x45x240)
  const tri = norm.match(/\b(\d{2,3})\s*[x×*]\s*(\d{2,3})\s*[x×*]\s*(\d{2,3})\b/);
  if (tri) {
    return { w: Number(tri[1]), d: Number(tri[2]), h: Number(tri[3]), tvInch };
  }
  const pair = norm.match(/\b(\d{2,3})\s*[x×*]\s*(\d{2,3})\b/);
  if (pair) {
    return { w: Number(pair[1]), d: Number(pair[2]), h: Number(pair[2]), tvInch };
  }
  const singleCm = norm.match(/\b(\d{2,3})\s*cm\b/);
  if (singleCm) {
    return { w: Number(singleCm[1]), tvInch };
  }
  return { tvInch };
}

export const QUICK_ADD_SUGGESTIONS = [
  'Televizyon 65"',
  'Mermer Şömine 200 cm',
  'TV Duvar Ünitesi 240 cm',
  'Gardırop 220x60x240',
  'Yemek Masası 180x95',
  'Kitaplık 160x35x220',
  'Çift Kişilik Yatak',
  'Duvar Kliması',
  'Duvar Aynası',
  'Ahşap Çıta Duvar Paneli',
  'Yuvarlak Pencere',
  'Oval Pencere',
  'Perde Havuzu',
];

/**
 * Parses natural Turkish architectural / furniture input like:
 *  - "televizyon", "tv 75 inc", "televizyon 180x100"
 *  - "somine 200 cm", "mermer somine"
 *  - "gardirop 220x60x240", "dolap"
 *  - "klima", "ayna", "tablo", "lambader", "avize", "hali 250x350"
 *  - "yuvarlak pencere", "oval pencere", "dortlu pencere", "kapi", "kolon", "kiris", "perde havuzu"
 *  - "ahsap cita panel", "mermer duvar bolgesi"
 *  - "koltuk", "berjer", "sehpa", "sandalye" (matches 3D catalog!)
 */
export function parseQuickAddQuery(raw: string, catalog: Product[], ceilingM = 2.85): QuickAddCommand | null {
  const norm = normalizeTr(raw);
  if (!norm) return null;

  const dims = extractDims(norm);
  const color = extractColorHex(norm);
  const ceilCm = Math.round(ceilingM * 100);

  // 1) Architectural openings & structure
  if (norm.includes('perde havuz') || norm.includes('havuz')) {
    return { kind: 'cove' };
  }
  if (norm.includes('pencere') || norm.includes('cam')) {
    let wk: WindowKind = 'double';
    if (norm.includes('yuvarlak') || norm.includes('daire')) wk = 'round';
    else if (norm.includes('oval') || norm.includes('elips')) wk = 'oval';
    else if (norm.includes('kemer')) wk = 'arched';
    else if (norm.includes('fransiz') || norm.includes('boydan')) wk = 'french';
    else if (norm.includes('surgu') || norm.includes('balkon')) wk = 'sliding';
    else if (norm.includes('dort') || norm.includes('4')) wk = 'quad';
    else if (norm.includes('uc') || norm.includes('3')) wk = 'triple';
    else if (norm.includes('tek') || norm.includes('1')) wk = 'single';
    return { kind: 'window', windowKind: wk, widthCm: dims.w, heightCm: dims.h };
  }
  if (norm.includes('kapi') || norm.includes('gecis')) {
    let dk: DoorKind = 'single';
    if (norm.includes('cift') || norm.includes('2')) dk = 'double';
    else if (norm.includes('surgu')) dk = 'sliding';
    else if (norm.includes('kemer')) dk = 'archway';
    return { kind: 'door', doorKind: dk, widthCm: dims.w };
  }
  if (norm.includes('kolon') || norm.includes('sutun')) {
    const shape = norm.includes('yuvarlak') || norm.includes('oval') || norm.includes('silindir') ? 'round' : 'rect';
    return { kind: 'column', shape, widthCm: dims.w || 40, depthCm: dims.d || dims.w || 40 };
  }
  if (norm.includes('kiris')) {
    const axis = norm.includes('dikey') ? 'z' : 'x';
    return { kind: 'beam', axis, widthCm: dims.w || 30, dropCm: dims.d || 32 };
  }
  if (norm.includes('duvar panel') || norm.includes('duvar bolge') || norm.includes('cita panel') || norm.includes('lambri')) {
    let pat: WallPattern = 'slats';
    if (norm.includes('mermer')) pat = 'marble';
    else if (norm.includes('ayna')) pat = 'mirror';
    else if (norm.includes('beton')) pat = 'concrete';
    else if (norm.includes('tas') || norm.includes('traverten')) pat = 'stone';
    else if (norm.includes('boiserie') || norm.includes('klasik')) pat = 'boiserie';
    else if (norm.includes('boya')) pat = 'smooth';
    return {
      kind: 'wallZone',
      pattern: pat,
      colorHex: color || (pat === 'slats' ? '#b9936c' : pat === 'marble' ? '#ece9e2' : '#d8d0c3'),
      widthCm: dims.w || 180,
      heightCm: norm.includes('lambri') ? 115 : dims.h,
    };
  }

  // 2) Televizyon / TV Ünitesi
  if ((norm.includes('tv') || norm.includes('televizyon')) && (norm.includes('unite') || norm.includes('duvar unit') || norm.includes('konsol'))) {
    return {
      kind: 'parametric',
      parametricKind: 'tv_wall_unit',
      name: 'Ahşap Çıtalı TV Ünitesi',
      category: 'TV Ünitesi',
      widthCm: dims.w || 240,
      depthCm: dims.d && dims.d < 100 ? dims.d : 42,
      heightCm: Math.min(ceilCm - 10, dims.h && dims.h > 100 ? dims.h : 240),
      yCm: 0,
      mountMode: 'wall',
      colorHex: color || '#b78e66',
      accentHex: '#252423',
    };
  }
  if (norm.includes('televizyon') || /\btv\b/.test(norm) || norm.includes('ekran') || norm.includes('oled')) {
    let wCm = 145;
    let hCm = 84;
    let labelSuffix = '65"';
    if (dims.tvInch) {
      wCm = Math.round(dims.tvInch * 2.54 * 0.872);
      hCm = Math.round(dims.tvInch * 2.54 * 0.49);
      labelSuffix = `${dims.tvInch}"`;
    } else if (dims.w) {
      wCm = Math.max(60, Math.min(300, dims.w));
      hCm = dims.h && dims.h >= 35 && dims.h <= 180 ? dims.h : Math.round(wCm * 0.5625);
      labelSuffix = `${wCm}×${hCm} cm`;
    }
    return {
      kind: 'parametric',
      parametricKind: 'wall_tv',
      name: `Duvar OLED TV (${labelSuffix})`,
      category: 'Televizyon',
      widthCm: wCm,
      depthCm: 6,
      heightCm: hCm,
      yCm: 115,
      mountMode: 'wall',
      colorHex: color || '#18181b',
      accentHex: '#0b0c10',
    };
  }

  // 3) Şömine
  if (norm.includes('somine') || norm.includes('ocak')) {
    return {
      kind: 'parametric',
      parametricKind: 'fireplace_marble',
      name: 'Mermer Şömine',
      category: 'Şömine',
      widthCm: dims.w || 200,
      depthCm: dims.d && dims.d <= 90 ? dims.d : 44,
      heightCm: dims.h && dims.h >= 90 ? Math.min(ceilCm, dims.h) : Math.min(ceilCm, 260),
      yCm: 0,
      mountMode: 'wall',
      colorHex: color || '#ece9e2',
      accentHex: '#252423',
    };
  }

  // 4) Gardırop / Dolap
  if (norm.includes('gardirop') || norm.includes('gardrop') || norm.includes('dolap')) {
    return {
      kind: 'parametric',
      parametricKind: 'wardrobe',
      name: 'Mimari Gardırop',
      category: 'Depolama',
      widthCm: dims.w || 220,
      depthCm: dims.d && dims.d <= 90 ? dims.d : 60,
      heightCm: dims.h && dims.h >= 120 ? Math.min(ceilCm - 5, dims.h) : Math.min(ceilCm - 10, 240),
      yCm: 0,
      mountMode: 'wall',
      colorHex: color || '#ebe6dd',
      accentHex: '#2b2a28',
    };
  }

  // 5) Klima
  if (norm.includes('klima')) {
    return {
      kind: 'parametric',
      parametricKind: 'ac_unit',
      name: 'Duvar Split Klima',
      category: 'İklimlendirme',
      widthCm: dims.w || 95,
      depthCm: 24,
      heightCm: 32,
      yCm: Math.max(190, ceilCm - 52),
      mountMode: 'wall',
      colorHex: color || '#f5f5f3',
      accentHex: '#2d2f33',
    };
  }

  // 6) Ayna
  if (norm.includes('ayna')) {
    return {
      kind: 'parametric',
      parametricKind: 'wall_mirror',
      name: 'Kemerli Duvar Aynası',
      category: 'Dekor',
      widthCm: dims.w || 90,
      depthCm: 4,
      heightCm: dims.h || 185,
      yCm: 20,
      mountMode: 'wall',
      colorHex: color || '#c8a86b',
      accentHex: '#dce6ee',
    };
  }

  // 7) Tablo / Sanat
  if (norm.includes('tablo') || norm.includes('cerceve') || norm.includes('resim')) {
    return {
      kind: 'parametric',
      parametricKind: 'wall_art',
      name: 'Modern Duvar Tablosu',
      category: 'Dekor',
      widthCm: dims.w || 120,
      depthCm: 4,
      heightCm: dims.h || 90,
      yCm: 120,
      mountMode: 'wall',
      colorHex: color || '#2a2826',
      accentHex: '#dfd6c8',
    };
  }

  // 8) Avize / Lambader
  if (norm.includes('avize') || norm.includes('sarkit')) {
    const w = dims.w || 85;
    return {
      kind: 'parametric',
      parametricKind: 'chandelier',
      name: 'Pirinç Halka Avize',
      category: 'Aydınlatma',
      widthCm: w,
      depthCm: w,
      heightCm: 50,
      yCm: Math.max(170, ceilCm - 52),
      mountMode: 'ceiling',
      colorHex: color || '#c8a86b',
      accentHex: '#fff4dc',
    };
  }
  if (norm.includes('lambader') || norm.includes('lamba') || norm.includes('aydinlatma')) {
    return {
      kind: 'parametric',
      parametricKind: 'floor_lamp',
      name: 'Modern Lambader',
      category: 'Aydınlatma',
      widthCm: 42,
      depthCm: 42,
      heightCm: dims.h || 168,
      yCm: 0,
      mountMode: 'floor',
      colorHex: color || '#242322',
      accentHex: '#f5efe2',
    };
  }

  // 9) Halı
  if (norm.includes('hali') || norm.includes('kilim')) {
    return {
      kind: 'parametric',
      parametricKind: 'rug_custom',
      name: 'Özel Ölçü Dokuma Halı',
      category: 'Halı',
      widthCm: dims.w || 260,
      depthCm: dims.d || 190,
      heightCm: 2,
      yCm: 0,
      mountMode: 'rug',
      colorHex: color || '#e6dfd3',
      accentHex: '#b8ad9b',
    };
  }

  // 10) Kitaplık / Raf
  if (norm.includes('kitaplik') || norm.includes('raf')) {
    return {
      kind: 'parametric',
      parametricKind: 'bookshelf',
      name: 'Işıklı Mimari Kitaplık',
      category: 'Depolama',
      widthCm: dims.w || 160,
      depthCm: dims.d && dims.d <= 60 ? dims.d : 36,
      heightCm: dims.h && dims.h >= 100 ? Math.min(ceilCm - 10, dims.h) : 220,
      yCm: 0,
      mountMode: 'wall',
      colorHex: color || '#876246',
      accentHex: '#242322',
    };
  }

  // 11) Yemek Masası / Çalışma Masası
  if (norm.includes('masa')) {
    return {
      kind: 'parametric',
      parametricKind: 'dining_table',
      name: norm.includes('calisma') ? 'Çalışma Masası' : 'Yemek Masası',
      category: 'Masa',
      widthCm: dims.w || (norm.includes('calisma') ? 140 : 180),
      depthCm: dims.d || (norm.includes('calisma') ? 70 : 95),
      heightCm: 75,
      yCm: 0,
      mountMode: 'floor',
      colorHex: color || '#9b7452',
      accentHex: '#232325',
    };
  }

  // 12) Konsol / Dresuar / Şifonyer
  if (norm.includes('konsol') || norm.includes('dresuar') || norm.includes('sifonyer') || norm.includes('komodin')) {
    return {
      kind: 'parametric',
      parametricKind: 'console_table',
      name: norm.includes('komodin') ? 'Komodin' : 'Modern Konsol',
      category: 'Depolama',
      widthCm: dims.w || (norm.includes('komodin') ? 55 : 165),
      depthCm: dims.d || 44,
      heightCm: dims.h || (norm.includes('komodin') ? 52 : 78),
      yCm: 0,
      mountMode: 'wall',
      colorHex: color || '#a47e5a',
      accentHex: '#232324',
    };
  }

  // 13) Yatak
  if (norm.includes('yatak') || norm.includes('baza')) {
    return {
      kind: 'parametric',
      parametricKind: 'bed_frame',
      name: norm.includes('tek') ? 'Tek Kişilik Yatak' : 'Çift Kişilik Yatak',
      category: 'Yatak',
      widthCm: dims.w || (norm.includes('tek') ? 110 : 175),
      depthCm: dims.d || 212,
      heightCm: 112,
      yCm: 0,
      mountMode: 'floor',
      colorHex: color || '#dcd5c9',
      accentHex: '#f5f2ec',
    };
  }

  // 14) Fuzzy match against existing 3D GLB catalog (Koltuk, Kanepe, Berjer, Sehpa, Sandalye...)
  const scored = catalog
    .map((p) => {
      const hay = normalizeTr(`${p.name} ${p.category}`);
      let score = 0;
      for (const tok of norm.split(/\s+/)) {
        if (tok.length < 2) continue;
        if (hay.includes(tok)) score += 3;
        if ((tok === 'koltuk' || tok === 'kanepe') && hay.includes('kanepe')) score += 4;
        if (tok === 'berjer' && hay.includes('berjer')) score += 4;
        if (tok === 'sehpa' && hay.includes('sehpa')) score += 4;
        if (tok === 'sandalye' && hay.includes('sandalye')) score += 4;
      }
      return { p, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    return {
      kind: 'catalog',
      product: scored[0].p,
      widthCm: dims.w,
      depthCm: dims.d,
      heightCm: dims.h,
    };
  }

  return null;
}
