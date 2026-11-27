export type Placement = 'floor';
export type ProductSource = 'ikea-cad' | 'studyo-cad' | 'ozel-cad';

export interface ProductSwatch {
  name: string;
  hex: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  dimensionsCm: string;
  glbUrl: string;
  /** Pre-baked Apple ARKit Quick Look (.usdz) file with exact 1:1 meters, Y=0 floor pivot & horizontal plane anchoring */
  usdzUrl?: string;
  remoteGlbUrl?: string;
  dimsTargetCm?: { w: number; d: number; h: number };
  thumbUrl?: string;
  source: ProductSource;
  swatches?: ProductSwatch[];
  cloudStored?: boolean;
  createdAt?: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 'hasagac-lilac-sandalye',
    name: 'HASAĞAÇ Lilac Modern Sandalye',
    category: 'Sandalye',
    dimensionsCm: '64 × 62 × 82 cm',
    glbUrl: '/models/hasagac-lilac-sandalye.glb',
    usdzUrl: '/models/hasagac-lilac-sandalye.usdz',
    thumbUrl: '/ikea-thumbs/hasagac-lilac-sandalye.jpg',
    source: 'ozel-cad',
  },
  {
    id: 'ikea-landskrona-sofa',
    name: 'LANDSKRONA 3’lü Kanepe',
    category: 'Kanepe',
    dimensionsCm: '205 × 91 × 78 cm',
    glbUrl: '/models/ikea-landskrona-sofa.glb',
    usdzUrl: '/models/ikea-landskrona-sofa.usdz',
    thumbUrl: '/ikea-thumbs/ikea-landskrona-sofa.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-uppland-sofa',
    name: 'UPPLAND / EKTORP 3’lü Beyaz Kanepe',
    category: 'Kanepe',
    dimensionsCm: '220 × 93 × 91 cm',
    glbUrl: '/models/ikea-uppland-sofa.glb',
    usdzUrl: '/models/ikea-uppland-sofa.usdz',
    thumbUrl: '/ikea-thumbs/ikea-uppland-sofa.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-morabo-chaise',
    name: 'LANDSKRONA Uzanma Koltuklu L-Kanepe',
    category: 'Kanepe',
    dimensionsCm: '281 × 157 × 78 cm',
    glbUrl: '/models/ikea-morabo-chaise.glb',
    usdzUrl: '/models/ikea-morabo-chaise.usdz',
    thumbUrl: '/ikea-thumbs/ikea-morabo-chaise.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-kivik-sofa',
    name: 'KIVIK 3’lü Kanepe',
    category: 'Kanepe',
    dimensionsCm: '229 × 94 × 85 cm',
    glbUrl: '/models/ikea-kivik-sofa.glb',
    usdzUrl: '/models/ikea-kivik-sofa.usdz',
    thumbUrl: '/ikea-thumbs/ikea-kivik-sofa.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-friheten-corner',
    name: 'FRIHETEN Köşe Yataklı L-Kanepe',
    category: 'Kanepe',
    dimensionsCm: '231 × 156 × 93 cm',
    glbUrl: '/models/ikea-friheten-corner.glb',
    usdzUrl: '/models/ikea-friheten-corner.usdz',
    thumbUrl: '/ikea-thumbs/ikea-friheten-corner.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-strandmon-chair',
    name: 'STRANDMON Kulaklı Berjer',
    category: 'Berjer',
    dimensionsCm: '81 × 97 × 101 cm',
    glbUrl: '/models/ikea-strandmon-chair.glb',
    usdzUrl: '/models/ikea-strandmon-chair.usdz',
    thumbUrl: '/ikea-thumbs/ikea-strandmon-chair.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ph-armchair-modern',
    name: 'NORDIC Keten & Meşe Tekli Koltuk',
    category: 'Berjer',
    dimensionsCm: '82 × 99 × 102 cm',
    glbUrl: '/models/ph-armchair-modern.glb',
    usdzUrl: '/models/ph-armchair-modern.usdz',
    source: 'studyo-cad',
  },
  {
    id: 'ph-chair-lounge',
    name: 'OSLO Deri & Masif Dinlenme Koltuğu',
    category: 'Berjer',
    dimensionsCm: '101 × 119 × 117 cm',
    glbUrl: '/models/ph-chair-lounge.glb',
    usdzUrl: '/models/ph-chair-lounge.usdz',
    source: 'studyo-cad',
  },
  {
    id: 'ph-ottoman',
    name: 'OSLO Kare Dokuma Puf',
    category: 'Berjer',
    dimensionsCm: '89 × 62 × 62 cm',
    glbUrl: '/models/ph-ottoman.glb',
    usdzUrl: '/models/ph-ottoman.usdz',
    source: 'studyo-cad',
  },
  {
    id: 'ikea-lisabo-table',
    name: 'LISABO Yemek Masası',
    category: 'Masa',
    dimensionsCm: '140 × 78 × 74 cm',
    glbUrl: '/models/ikea-lisabo-table.glb',
    usdzUrl: '/models/ikea-lisabo-table.usdz',
    thumbUrl: '/ikea-thumbs/ikea-lisabo-table.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-alex-desk',
    name: 'ALEX Çekmeceli Çalışma Masası',
    category: 'Masa',
    dimensionsCm: '131 × 58 × 76 cm',
    glbUrl: '/models/ikea-alex-desk.glb',
    usdzUrl: '/models/ikea-alex-desk.usdz',
    thumbUrl: '/ikea-thumbs/ikea-alex-desk.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-odger-chair',
    name: 'ODGER Antrasit Sandalye',
    category: 'Sandalye',
    dimensionsCm: '45 × 51 × 80 cm',
    glbUrl: '/models/ikea-odger-chair.glb',
    usdzUrl: '/models/ikea-odger-chair.usdz',
    thumbUrl: '/ikea-thumbs/ikea-odger-chair.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-stockholm-coffee',
    name: 'STOCKHOLM Orta Sehpa',
    category: 'Sehpa',
    dimensionsCm: '180 × 59 × 40 cm',
    glbUrl: '/models/ikea-stockholm-coffee.glb',
    usdzUrl: '/models/ikea-stockholm-coffee.usdz',
    thumbUrl: '/ikea-thumbs/ikea-stockholm-coffee.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ph-table-coffee',
    name: 'ZEN Cam & Masif Meşe Orta Sehpa',
    category: 'Sehpa',
    dimensionsCm: '120 × 120 × 37 cm',
    glbUrl: '/models/ph-table-coffee.glb',
    usdzUrl: '/models/ph-table-coffee.usdz',
    source: 'studyo-cad',
  },
  {
    id: 'ikea-hemnes-tv',
    name: 'HEMNES TV Ünitesi',
    category: 'TV Ünitesi',
    dimensionsCm: '148 × 49 × 57 cm',
    glbUrl: '/models/ikea-hemnes-tv.glb',
    usdzUrl: '/models/ikea-hemnes-tv.usdz',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-billy-bookcase',
    name: 'BILLY Kitaplık',
    category: 'Kitaplık',
    dimensionsCm: '80 × 28 × 205 cm',
    glbUrl: '/models/ikea-billy-bookcase.glb',
    usdzUrl: '/models/ikea-billy-bookcase.usdz',
    thumbUrl: '/ikea-thumbs/ikea-billy-bookcase.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-kallax-shelf',
    name: 'KALLAX 8 Bölmeli Raf Ünitesi',
    category: 'Raf',
    dimensionsCm: '77 × 40 × 147 cm',
    glbUrl: '/models/ikea-kallax-shelf.glb',
    usdzUrl: '/models/ikea-kallax-shelf.usdz',
    thumbUrl: '/ikea-thumbs/ikea-kallax-shelf.jpg',
    source: 'ikea-cad',
  },
  {
    id: 'ikea-brimnes-bed',
    name: 'BRIMNES Çekmeceli Çift Kişilik Karyola',
    category: 'Yatak',
    dimensionsCm: '151 × 205 × 47 cm',
    glbUrl: '/models/ikea-brimnes-bed.glb',
    usdzUrl: '/models/ikea-brimnes-bed.usdz',
    thumbUrl: '/ikea-thumbs/ikea-brimnes-bed.jpg',
    source: 'ikea-cad',
  },
];

export function resolveStaticUsdzUrl(product: Pick<Product, 'glbUrl' | 'usdzUrl'>): string | undefined {
  if (product.usdzUrl) return product.usdzUrl;
  if (product.glbUrl && product.glbUrl.startsWith('/models/') && product.glbUrl.endsWith('.glb')) {
    return product.glbUrl.replace(/\.glb$/i, '.usdz');
  }
  return undefined;
}

export function findProduct(id: string | null): Product | null {
  if (!id) return null;
  return PRODUCTS.find((p) => p.id === id) || null;
}
