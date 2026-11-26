import type { Product } from '../lib/products';
import {
  COUNTERTOP_CATALOG,
  DOOR_PANEL_CATALOG,
  FURNITURE_PANEL_CATALOG,
  PARQUET_CATALOG,
  SKIRTING_TRIM_CATALOG,
  SUPPLIER_SHORT,
  WALL_PANEL_CATALOG,
  type CountertopCatalogItem,
  type DoorPanelCatalogItem,
  type FurniturePanelCatalogItem,
  type ParquetCatalogItem,
  type SkirtingTrimCatalogItem,
  type WallPanelCatalogItem,
} from './materialCatalogs';
import {
  DOOR_KIND_LABELS,
  WINDOW_KIND_LABELS,
  type DoorKind,
  type ParametricFurnitureKind,
  type WindowKind,
} from './types';

export function normalizeSearchTr(s: string): string {
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

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [200, 195, 185];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceptual weighted RGB distance (redmean formula) — accurate visual color closeness in 0..765 */
export function perceptualColorDistance(hexA: string, hexB: string): number {
  const [r1, g1, b1] = hexToRgbTuple(hexA);
  const [r2, g2, b2] = hexToRgbTuple(hexB);
  const rMean = (r1 + r2) * 0.5;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

/** Returns 0..100 visual color closeness percentage */
export function colorSimilarityPct(hexA: string, hexB: string): number {
  const d = perceptualColorDistance(hexA, hexB);
  return Math.max(0, Math.min(100, Math.round((1 - d / 560) * 100)));
}

/** Rich Turkish interior color lexicon -> reference RGB hex for nearest-color search! */
export const TURKISH_COLOR_LEXICON: Array<{ keys: string[]; hex: string; label: string }> = [
  { keys: ['beyaz', 'ekru', 'luletasi', 'kirec', 'kar', 'egg white', 'iceberg', 'barents'], hex: '#f4f2ec', label: 'Beyaz' },
  { keys: ['krem', 'fildisi', 'sahara', 'vanilya', 'ay isigi'], hex: '#e5dccb', label: 'Krem' },
  { keys: ['kasmir', 'kumtasi', 'vizon', 'grej', 'kalk', 'sahlep', 'space'], hex: '#cfc6b8', label: 'Kaşmir / Vizon' },
  { keys: ['kum beji', 'bej', 'kumsal', 'sand', 'badem'], hex: '#d8c9b2', label: 'Kum Beji' },
  { keys: ['acik mese', 'kristal mese', 'samsun', 'tibet', 'lilyum', 'iskandinav'], hex: '#d7c3a4', label: 'Açık Meşe' },
  { keys: ['mese', 'dogal mese', 'izmir mese', 'danube', 'toros', 'volga', 'ahsap'], hex: '#c29e74', label: 'Doğal Meşe' },
  { keys: ['koyu mese', 'otantik mese', 'bergamo', 'klasik mese'], hex: '#96724c', label: 'Koyu Meşe' },
  { keys: ['ceviz', 'koyu ceviz', 'amerikan ceviz', 'opera ceviz', 'tik', 'kahve', 'moka', 'kahverengi'], hex: '#6f4e37', label: 'Ceviz / Kahve' },
  { keys: ['buzul', 'buz gri', 'acik gri', 'yeni gri', 'andezit 20'], hex: '#cfd3d6', label: 'Açık Gri' },
  { keys: ['gri', 'beton', 'tas', 'luna', 'tundra', 'comfort grey'], hex: '#9ea0a2', label: 'Gri / Beton' },
  { keys: ['firtina', 'koyu gri', 'fume', 'kozmik', 'andezit 45', 'elegant', 'forza'], hex: '#63666b', label: 'Koyu Gri / Füme' },
  { keys: ['antrasit', '275', '3068', 'bodrum'], hex: '#3a3d42', label: 'Antrasit' },
  { keys: ['siyah', 'magma', 'nero', 'dempet sort', 'spa black'], hex: '#1e1f22', label: 'Siyah' },
  { keys: ['adacayi', 'su yesili', 'pale linden', 'mint', 'soft yesil'], hex: '#b6c4b1', label: 'Adaçayı Yeşili' },
  { keys: ['zeytin', 'haki', 'pale green'], hex: '#88937b', label: 'Zeytin / Haki' },
  { keys: ['orman yesili', 'zumrut', 'koyu yesil', 'yesil'], hex: '#344f3f', label: 'Orman / Zümrüt Yeşili' },
  { keys: ['mavi', 'st pauls', 'londra mavi', 'petrol', 'turkuaz'], hex: '#44627c', label: 'Mavi' },
  { keys: ['lacivert', 'gece'], hex: '#273649', label: 'Lacivert' },
  { keys: ['terracotta', 'kiremit', 'taba', 'konyak', 'turuncu', 'bordo', 'kirmizi'], hex: '#b46f53', label: 'Terracotta / Taba' },
  { keys: ['sari', 'hardal', 'altin', 'pirinc', 'bronz'], hex: '#c8a258', label: 'Altın / Hardal' },
  { keys: ['mermer', 'calacatta', 'statuario', 'apollon', 'kashmera'], hex: '#efede8', label: 'Beyaz Mermer' },
  { keys: ['traverten', 'canyon'], hex: '#ded4c3', label: 'Traverten' },
];

export function detectQueryColorHex(raw: string): { hex: string; label: string } | null {
  const norm = normalizeSearchTr(raw);
  if (!norm) return null;
  const hexMatch = norm.match(/#[0-9a-f]{6}\b/);
  if (hexMatch) return { hex: hexMatch[0], label: hexMatch[0].toUpperCase() };
  // Prefer longer keyword matches first (e.g. "koyu ceviz" before "ceviz", "acik gri" before "gri")
  let best: { hex: string; label: string; len: number } | null = null;
  for (const entry of TURKISH_COLOR_LEXICON) {
    for (const k of entry.keys) {
      if (norm.includes(k) && (!best || k.length > best.len)) {
        best = { hex: entry.hex, label: entry.label, len: k.length };
      }
    }
  }
  return best ? { hex: best.hex, label: best.label } : null;
}

export type UniversalSearchGroup = 'material' | 'furniture' | 'opening' | 'room';

export type UniversalSearchResult =
  | {
      id: string;
      group: 'material';
      subKind: 'parquet';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: ParquetCatalogItem;
    }
  | {
      id: string;
      group: 'material';
      subKind: 'wall';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: WallPanelCatalogItem;
    }
  | {
      id: string;
      group: 'material';
      subKind: 'skirting';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: SkirtingTrimCatalogItem;
    }
  | {
      id: string;
      group: 'material';
      subKind: 'doorPanel';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: DoorPanelCatalogItem;
    }
  | {
      id: string;
      group: 'material';
      subKind: 'countertop';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: CountertopCatalogItem;
    }
  | {
      id: string;
      group: 'material';
      subKind: 'furniturePanel';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      similarityPct?: number;
      score: number;
      item: FurniturePanelCatalogItem;
    }
  | {
      id: string;
      group: 'furniture';
      subKind: 'parametric';
      title: string;
      subtitle: string;
      badge: string;
      hex: string;
      score: number;
      spec: {
        kind: ParametricFurnitureKind;
        name: string;
        category: string;
        wM: number;
        dM: number;
        hM: number;
        yM: number;
        mount: 'floor' | 'wall' | 'ceiling' | 'rug';
        c1: string;
        c2: string;
      };
    }
  | {
      id: string;
      group: 'furniture';
      subKind: 'catalogProduct';
      title: string;
      subtitle: string;
      badge: string;
      thumbUrl?: string;
      score: number;
      product: Product;
    }
  | {
      id: string;
      group: 'opening';
      subKind: 'window';
      title: string;
      subtitle: string;
      badge: string;
      score: number;
      windowKind: WindowKind;
    }
  | {
      id: string;
      group: 'opening';
      subKind: 'door';
      title: string;
      subtitle: string;
      badge: string;
      score: number;
      doorKind: DoorKind;
    }
  | {
      id: string;
      group: 'room';
      subKind: 'action';
      title: string;
      subtitle: string;
      badge: string;
      score: number;
      actionId:
        | 'template_1plus1'
        | 'template_2plus1'
        | 'template_3plus1'
        | 'add_room_bedroom'
        | 'add_room_kitchen'
        | 'add_room_bathroom'
        | 'add_room_hallway'
        | 'toggle_mezzanine'
        | 'add_cove'
        | 'add_column'
        | 'add_beam';
    };

const PARAMETRIC_SEARCH_ITEMS: Array<{
  keywords: string;
  spec: Extract<UniversalSearchResult, { subKind: 'parametric' }>['spec'];
}> = [
  { keywords: 'tv televizyon oled ekran 65 75', spec: { kind: 'wall_tv', name: 'Duvar OLED TV (65")', category: 'Televizyon', wM: 1.45, dM: 0.06, hM: 0.84, yM: 1.15, mount: 'wall', c1: '#18181b', c2: '#0b0c10' } },
  { keywords: 'somine mermer ocak ates', spec: { kind: 'fireplace_marble', name: 'Calacatta Mermer Şömine', category: 'Şömine', wM: 2.0, dM: 0.44, hM: 2.6, yM: 0, mount: 'wall', c1: '#ece9e2', c2: '#252423' } },
  { keywords: 'tv unitesi duvar unitesi citali', spec: { kind: 'tv_wall_unit', name: 'Çıtalı TV Duvar Ünitesi', category: 'TV Ünitesi', wM: 2.4, dM: 0.42, hM: 2.45, yM: 0, mount: 'wall', c1: '#b78e66', c2: '#252423' } },
  { keywords: 'gardirop dolap elbise giyinme', spec: { kind: 'wardrobe', name: 'Mimari Gardırop', category: 'Depolama', wM: 2.2, dM: 0.6, hM: 2.4, yM: 0, mount: 'wall', c1: '#ebe6dd', c2: '#2b2a28' } },
  { keywords: 'tezgah mutfak laminat technotop evye ada', spec: { kind: 'kitchen_counter', name: 'Technotop Laminat Tezgah', category: 'Mutfak', wM: 2.2, dM: 0.65, hM: 0.9, yM: 0, mount: 'wall', c1: '#efede7', c2: '#3f4247' } },
  { keywords: 'ust mutfak dolabi mutfak dolap', spec: { kind: 'kitchen_upper_cabinet', name: 'Üst Mutfak Dolabı (LED)', category: 'Mutfak', wM: 2.2, dM: 0.36, hM: 0.72, yM: 1.48, mount: 'wall', c1: '#f3f1eb', c2: '#262628' } },
  { keywords: 'buzdolabi ankastre inox mutfak beyaz esya', spec: { kind: 'fridge', name: 'Ankastre Inox Buzdolabı', category: 'Mutfak', wM: 0.75, dM: 0.7, hM: 1.92, yM: 0, mount: 'wall', c1: '#c6c9ce', c2: '#2b2d31' } },
  { keywords: 'klozet tuvalet wc vitra banyo', spec: { kind: 'toilet_wc', name: 'VitrA Asma Klozet (WC)', category: 'Banyo & WC', wM: 0.42, dM: 0.68, hM: 1.1, yM: 0, mount: 'wall', c1: '#f7f6f2', c2: '#c8cdd4' } },
  { keywords: 'lavabo banyo dolabi ayna musluk banyo', spec: { kind: 'bathroom_vanity', name: 'VitrA Aynalı Banyo Lavabo', category: 'Banyo & WC', wM: 1.0, dM: 0.48, hM: 1.95, yM: 0, mount: 'wall', c1: '#b99268', c2: '#c8cdd4' } },
  { keywords: 'dusakabin dus banyo cam kabin', spec: { kind: 'shower_cabin', name: 'Cam Duşakabin (95×95)', category: 'Banyo & WC', wM: 0.95, dM: 0.95, hM: 2.05, yM: 0, mount: 'floor', c1: '#242528', c2: '#cfd4da' } },
  { keywords: 'camasir makinesi banyo beyaz esya', spec: { kind: 'washer', name: 'Çamaşır Makinesi', category: 'Banyo & WC', wM: 0.6, dM: 0.6, hM: 0.85, yM: 0, mount: 'floor', c1: '#f4f4f2', c2: '#2c2e33' } },
  { keywords: 'yemek masasi masa salon', spec: { kind: 'dining_table', name: 'Yemek Masası (180×95)', category: 'Masa', wM: 1.8, dM: 0.95, hM: 0.75, yM: 0, mount: 'floor', c1: '#9b7452', c2: '#232325' } },
  { keywords: 'calisma masasi ofis bilgisayar masasi', spec: { kind: 'desk', name: 'Çalışma Masası', category: 'Çalışma', wM: 1.5, dM: 0.7, hM: 0.75, yM: 0, mount: 'floor', c1: '#9b7452', c2: '#252527' } },
  { keywords: 'kitaplik raf kitap', spec: { kind: 'bookshelf', name: 'Işıklı Mimari Kitaplık', category: 'Depolama', wM: 1.6, dM: 0.36, hM: 2.2, yM: 0, mount: 'wall', c1: '#876246', c2: '#242322' } },
  { keywords: 'yatak cift kisilik baza yatak odasi', spec: { kind: 'bed_frame', name: 'Çift Kişilik Yatak', category: 'Yatak', wM: 1.75, dM: 2.12, hM: 1.12, yM: 0, mount: 'floor', c1: '#dcd5c9', c2: '#b9936c' } },
  { keywords: 'komodin basucu yatak odasi', spec: { kind: 'nightstand', name: 'Komodin', category: 'Yatak', wM: 0.52, dM: 0.42, hM: 0.54, yM: 0, mount: 'floor', c1: '#6f4e37', c2: '#b49263' } },
  { keywords: 'konsol dresuar sifonyer bufet', spec: { kind: 'console_table', name: 'Modern Konsol', category: 'Depolama', wM: 1.65, dM: 0.44, hM: 0.78, yM: 0, mount: 'wall', c1: '#a47e5a', c2: '#232324' } },
  { keywords: 'klima split duvar klimasi', spec: { kind: 'ac_unit', name: 'Duvar Split Klima', category: 'İklimlendirme', wM: 0.95, dM: 0.24, hM: 0.32, yM: 2.35, mount: 'wall', c1: '#f5f5f3', c2: '#2d2f33' } },
  { keywords: 'ayna boy aynasi duvar aynasi', spec: { kind: 'wall_mirror', name: 'Boy / Duvar Aynası', category: 'Dekor', wM: 0.9, dM: 0.04, hM: 1.85, yM: 0, mount: 'wall', c1: '#c8a86b', c2: '#dce6ee' } },
  { keywords: 'tablo cerceve sanat resim', spec: { kind: 'wall_art', name: 'Modern Duvar Tablosu', category: 'Dekor', wM: 1.2, dM: 0.04, hM: 0.9, yM: 1.2, mount: 'wall', c1: '#2a2826', c2: '#dfd6c8' } },
  { keywords: 'zeytin agaci saksi bitki cicek agac', spec: { kind: 'potted_plant', name: 'Saksılı Zeytin Ağacı', category: 'Bitki', wM: 0.75, dM: 0.75, hM: 1.75, yM: 0, mount: 'floor', c1: '#4c6444', c2: '#373532' } },
  { keywords: 'lambader aydinlatma abajur', spec: { kind: 'floor_lamp', name: 'Modern Lambader', category: 'Aydınlatma', wM: 0.42, dM: 0.42, hM: 1.68, yM: 0, mount: 'floor', c1: '#242322', c2: '#f5efe2' } },
  { keywords: 'avize sarkit pirinc aydinlatma', spec: { kind: 'chandelier', name: 'Pirinç Halka Avize', category: 'Aydınlatma', wM: 0.85, dM: 0.85, hM: 0.5, yM: 2.32, mount: 'ceiling', c1: '#c8a86b', c2: '#fff4dc' } },
  { keywords: 'hali kilim dokuma', spec: { kind: 'rug_custom', name: 'Özel Ölçü Dokuma Halı', category: 'Halı', wM: 2.6, dM: 1.9, hM: 0.015, yM: 0, mount: 'rug', c1: '#e6dfd3', c2: '#b8ad9b' } },
];

const ROOM_ACTION_ITEMS: Array<{
  keywords: string;
  title: string;
  subtitle: string;
  badge: string;
  actionId: Extract<UniversalSearchResult, { subKind: 'action' }>['actionId'];
}> = [
  { keywords: '3+1 daire ev tam plan 3 oda salon banyo mutfak', title: '3+1 Tam Daire Planı Kur (Sims)', subtitle: 'Salon + Mutfak + 3 Yatak Odası + Koridor + Banyo/WC', badge: 'Hazır Ev', actionId: 'template_3plus1' },
  { keywords: '2+1 daire ev plan 2 oda salon banyo mutfak', title: '2+1 Daire Planı Kur (Sims)', subtitle: 'Salon + Mutfak + 2 Yatak Odası + Banyo/WC', badge: 'Hazır Ev', actionId: 'template_2plus1' },
  { keywords: '1+1 daire ev plan tek oda salon', title: '1+1 Daire Planı Kur (Sims)', subtitle: 'Salon + Mutfak + Yatak Odası + Banyo/WC', badge: 'Hazır Ev', actionId: 'template_1plus1' },
  { keywords: 'oda ekle yanina yatak odasi gecisli oda sims', title: 'Yanına Yatak Odası Ekle (Kapılı Geçiş)', subtitle: 'Mevcut odanın yanına kapılı yeni yatak odası kurar', badge: '+ Oda', actionId: 'add_room_bedroom' },
  { keywords: 'mutfak ekle yanina mutfak odasi acik mutfak', title: 'Yanına Mutfak Odası Ekle', subtitle: 'Technotop tezgahlı & geçişli yeni mutfak kurar', badge: '+ Oda', actionId: 'add_room_kitchen' },
  { keywords: 'banyo ekle tuvalet wc odasi ekle', title: 'Yanına Banyo / WC Ekle', subtitle: 'VitrA seramik + klozet + lavabo + duşakabinli banyo', badge: '+ Oda', actionId: 'add_room_bathroom' },
  { keywords: 'koridor hol antre gecis odasi ekle', title: 'Yanına Koridor / Hol Ekle', subtitle: 'Odaları birbirine bağlayan geçiş koridoru', badge: '+ Oda', actionId: 'add_room_hallway' },
  { keywords: '2. kat ikinci kat asma kat loft dubleks', title: '2. Kat / Asma Kat (Loft) Aç-Kapat', subtitle: 'Tavanı yükseltip üst kat platformu kurar', badge: '2. Kat', actionId: 'toggle_mezzanine' },
  { keywords: 'perde havuzu gizli led tavan', title: 'Perde Havuzu & Gizli LED Ekle', subtitle: 'Seçili duvara gizli LED perde havuzu ekler', badge: 'Yapı', actionId: 'add_cove' },
  { keywords: 'kolon sutun kare', title: 'Mimari Kolon Ekle', subtitle: 'Odaya 40×40 cm kolon ekler', badge: 'Yapı', actionId: 'add_column' },
  { keywords: 'kiris tavan kirisi', title: 'Tavan Kirişi Ekle', subtitle: 'Yatay tavan kirişi ekler', badge: 'Yapı', actionId: 'add_beam' },
];

function scoreText(haystack: string, tokens: string[], exactCode?: string, rawNorm?: string): number {
  const hay = normalizeSearchTr(haystack);
  let score = 0;
  if (exactCode && rawNorm && normalizeSearchTr(exactCode) === rawNorm) score += 120;
  else if (exactCode && rawNorm && normalizeSearchTr(exactCode).includes(rawNorm) && rawNorm.length >= 2) score += 75;
  if (rawNorm && hay.includes(rawNorm)) score += 40;
  for (const tk of tokens) {
    if (tk.length < 2) continue;
    if (hay.includes(tk)) score += 18;
  }
  return score;
}

/**
 * Universal search across:
 *  - 10 Turkish brand catalogs (150+ real codes + perceptual color proximity matching!)
 *  - 24 parametric 3D furniture / kitchen / bathroom modules
 *  - All 3D GLB catalog products
 *  - All 9 window kinds & 4 door kinds
 *  - Sims-style multi-room builders & apartment templates (1+1, 2+1, 3+1)
 */
export function runUniversalSearch(
  rawQuery: string,
  catalogProducts: Product[],
  filterGroup: 'all' | UniversalSearchGroup = 'all',
  limit = 28
): {
  detectedColor: { hex: string; label: string } | null;
  results: UniversalSearchResult[];
} {
  const norm = normalizeSearchTr(rawQuery);
  if (!norm) return { detectedColor: null, results: [] };

  const tokens = norm.split(/[\s,./+-]+/).filter((t) => t.length >= 2);
  const detectedColor = detectQueryColorHex(rawQuery);
  const out: UniversalSearchResult[] = [];

  const allow = (g: UniversalSearchGroup) => filterGroup === 'all' || filterGroup === g;

  // 1) Materials & Colors (Exact code/name/brand + Perceptual nearest-color match!)
  if (allow('material')) {
    const pushMaterial = <T extends { id: string; brand: keyof typeof SUPPLIER_SHORT; series: string; code: string; name: string; hex: string }>(
      list: T[],
      subKind: 'parquet' | 'wall' | 'skirting' | 'doorPanel' | 'countertop' | 'furniturePanel',
      catTag: string,
      extraKeywords: string
    ) => {
      for (const item of list) {
        const textScore = scoreText(
          `${item.brand} ${SUPPLIER_SHORT[item.brand]} ${item.series} ${item.code} ${item.name} ${catTag} ${extraKeywords}`,
          tokens,
          item.code,
          norm
        );
        let simPct: number | undefined;
        let colorScore = 0;
        if (detectedColor) {
          simPct = colorSimilarityPct(detectedColor.hex, item.hex);
          if (simPct >= 76) {
            colorScore = Math.round((simPct - 65) * 1.45);
          }
        }
        const total = textScore + colorScore;
        if (total >= 18) {
          out.push({
            id: `${subKind}:${item.id}`,
            group: 'material',
            subKind,
            title: `${item.name}`,
            subtitle: `${SUPPLIER_SHORT[item.brand]} · ${item.series} · ${item.code}`,
            badge: catTag,
            hex: item.hex,
            similarityPct: textScore < 20 ? simPct : undefined,
            score: total,
            item,
          } as unknown as UniversalSearchResult);
        }
      }
    };

    pushMaterial(PARQUET_CATALOG, 'parquet', 'Parke & Seramik', 'parke zemin laminat seramik karo baliksirti');
    pushMaterial(WALL_PANEL_CATALOG, 'wall', 'Duvar & Profil', 'duvar boya profil panel lambri cita mermer beton');
    pushMaterial(SKIRTING_TRIM_CATALOG, 'skirting', 'Süpürgelik & Köşelik', 'supurgelik koselik kose profili');
    pushMaterial(DOOR_PANEL_CATALOG, 'doorPanel', 'Kapı Paneli', 'kapi paneli kanat');
    pushMaterial(COUNTERTOP_CATALOG, 'countertop', 'Tezgah', 'tezgah laminat kuvars mutfak mermer');
    pushMaterial(FURNITURE_PANEL_CATALOG, 'furniturePanel', 'Mobilya MDF-Lam', 'mobilya dolap kapak mdf suntalam intermob');
  }

  // 2) Parametric 3D Furniture & Bathroom/Kitchen Modules + GLB Catalog Products
  if (allow('furniture')) {
    for (const pm of PARAMETRIC_SEARCH_ITEMS) {
      const sc = scoreText(`${pm.spec.name} ${pm.spec.category} ${pm.keywords}`, tokens, undefined, norm);
      if (sc >= 18) {
        out.push({
          id: `param:${pm.spec.kind}`,
          group: 'furniture',
          subKind: 'parametric',
          title: pm.spec.name,
          subtitle: `${pm.spec.category} · ${Math.round(pm.spec.wM * 100)}×${Math.round(pm.spec.dM * 100)}×${Math.round(pm.spec.hM * 100)} cm`,
          badge: '3B Modül',
          hex: detectedColor?.hex || pm.spec.c1,
          score: sc + 12,
          spec: detectedColor ? { ...pm.spec, c1: detectedColor.hex } : pm.spec,
        });
      }
    }

    for (const prod of catalogProducts) {
      const sc = scoreText(`${prod.name} ${prod.category} ${prod.dimensionsCm} koltuk kanepe berjer sehpa sandalye puf`, tokens, prod.id, norm);
      if (sc >= 18) {
        out.push({
          id: `glb:${prod.id}`,
          group: 'furniture',
          subKind: 'catalogProduct',
          title: prod.name,
          subtitle: `${prod.category} · ${prod.dimensionsCm}`,
          badge: '3B Katalog',
          thumbUrl: prod.thumbUrl,
          score: sc + 15,
          product: prod,
        });
      }
    }
  }

  // 3) Windows & Doors (ALL 9 Window Types + 4 Door Types!)
  if (allow('opening')) {
    (Object.keys(WINDOW_KIND_LABELS) as WindowKind[]).forEach((wk) => {
      const label = WINDOW_KIND_LABELS[wk];
      const sc = scoreText(`pencere cam ${label} ${wk}`, tokens, wk, norm);
      if (sc >= 18) {
        out.push({
          id: `win:${wk}`,
          group: 'opening',
          subKind: 'window',
          title: `${label} Pencere`,
          subtitle: 'Seçili duvara anında pencere açar',
          badge: 'Pencere',
          score: sc + 14,
          windowKind: wk,
        });
      }
    });

    (Object.keys(DOOR_KIND_LABELS) as DoorKind[]).forEach((dk) => {
      const label = DOOR_KIND_LABELS[dk];
      const sc = scoreText(`kapi gecis ${label} ${dk}`, tokens, dk, norm);
      if (sc >= 18) {
        out.push({
          id: `door:${dk}`,
          group: 'opening',
          subKind: 'door',
          title: label,
          subtitle: 'Seçili duvara kapı / geçiş boşluğu ekler',
          badge: 'Kapı',
          score: sc + 14,
          doorKind: dk,
        });
      }
    });
  }

  // 4) Multi-Room Sims Builders & Structural Actions
  if (allow('room')) {
    for (const ra of ROOM_ACTION_ITEMS) {
      const sc = scoreText(`${ra.title} ${ra.subtitle} ${ra.keywords}`, tokens, undefined, norm);
      if (sc >= 18) {
        out.push({
          id: `act:${ra.actionId}`,
          group: 'room',
          subKind: 'action',
          title: ra.title,
          subtitle: ra.subtitle,
          badge: ra.badge,
          score: sc + 16,
          actionId: ra.actionId,
        });
      }
    }
  }

  out.sort((a, b) => b.score - a.score);
  return {
    detectedColor,
    results: out.slice(0, limit),
  };
}
