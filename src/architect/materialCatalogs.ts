import type { FloorMaterialKind, WallPattern } from './types';

export type SupplierBrand =
  | 'Kastamonu Entegre'
  | 'Yıldız Entegre'
  | 'Starwood'
  | 'AGT'
  | 'Filli Boya'
  | 'Jotun'
  | 'Çamsan'
  | 'VitrA'
  | 'Çimstone'
  | 'Belenco';

export const SUPPLIER_BRANDS: SupplierBrand[] = [
  'Kastamonu Entegre',
  'Yıldız Entegre',
  'Starwood',
  'AGT',
  'Filli Boya',
  'Jotun',
  'Çamsan',
  'VitrA',
  'Çimstone',
  'Belenco',
];

export const SUPPLIER_SHORT: Record<SupplierBrand, string> = {
  'Kastamonu Entegre': 'Kastamonu',
  'Yıldız Entegre': 'Yıldız',
  Starwood: 'Starwood',
  AGT: 'AGT',
  'Filli Boya': 'Filli Boya',
  Jotun: 'Jotun',
  Çamsan: 'Çamsan',
  VitrA: 'VitrA',
  Çimstone: 'Çimstone',
  Belenco: 'Belenco',
};

export interface ParquetCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  floorMaterial: FloorMaterialKind;
  hex: string;
  finish: string;
}

export interface WallPanelCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  pattern: WallPattern;
  hex: string;
  finish: string;
  isProfile?: boolean;
}

export interface SkirtingTrimCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  hex: string;
  defaultHeightCm: number;
  kind: 'skirting' | 'corner' | 'both';
}

export type DoorPanelStyle = 'classic' | 'modern' | 'fluted' | 'wood';

export interface DoorPanelCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  hex: string;
  handleHex: string;
  panelStyle: DoorPanelStyle;
  finish: string;
}

export interface CountertopCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  surfaceKind: FloorMaterialKind;
  hex: string;
  recommendedCabinetHex: string;
  finish: string;
}

export interface FurniturePanelCatalogItem {
  id: string;
  brand: SupplierBrand;
  series: string;
  code: string;
  name: string;
  hex: string;
  accentHex: string;
  finish: string;
}

// ============================================================================
// 1. ZEMİN: LAMİNAT PARKE & PORSELEN SERAMİK (Floorpan · VarioClic · AGT · Çamsan · VitrA)
// ============================================================================
export const PARQUET_CATALOG: ParquetCatalogItem[] = [
  // Kastamonu Entegre — Floorpan
  { id: 'ke-fp-frv001', brand: 'Kastamonu Entegre', series: 'Floorpan River', code: 'FRV001', name: 'Danube Meşe (Balıksırtı)', floorMaterial: 'herringbone_oak', hex: '#c4a47c', finish: 'AC4 · Derzli Doğal Meşe' },
  { id: 'ke-fp-fs043', brand: 'Kastamonu Entegre', series: 'Floorpan Sun', code: 'FS043', name: 'İzmir Meşe', floorMaterial: 'plank_oak', hex: '#cca97e', finish: '8 mm · Mat Ahşap Doku' },
  { id: 'ke-fp-fs044', brand: 'Kastamonu Entegre', series: 'Floorpan Sun', code: 'FS044', name: 'Samsun Açık Meşe', floorMaterial: 'plank_oak', hex: '#d8c2a1', finish: '8 mm · Ferah İskandinav' },
  { id: 'ke-fp-fs046', brand: 'Kastamonu Entegre', series: 'Floorpan Sun', code: 'FS046', name: 'Bursa Sıcak Meşe', floorMaterial: 'plank_oak', hex: '#b58f63', finish: '8 mm · Sıcak Hareli' },
  { id: 'ke-fp-fc087', brand: 'Kastamonu Entegre', series: 'Floorpan Classic', code: 'FC087', name: 'Otantik Meşe', floorMaterial: 'plank_walnut', hex: '#9d7954', finish: '8 mm · Rustik Damar' },
  { id: 'ke-fp-fc086', brand: 'Kastamonu Entegre', series: 'Floorpan Classic', code: 'FC086', name: 'Kristal Meşe', floorMaterial: 'plank_oak', hex: '#d9d1c3', finish: '8 mm · Açık Kum Meşe' },
  { id: 'ke-fp-fsx01', brand: 'Kastamonu Entegre', series: 'Floorpan Sunex', code: 'FSX01', name: 'Gri Ceviz', floorMaterial: 'plank_walnut', hex: '#7e7368', finish: '8 mm · Modern Füme Ceviz' },

  // Yıldız Entegre — VarioClic
  { id: 'ye-vc-v21c', brand: 'Yıldız Entegre', series: 'VarioClic Standard', code: 'V-21C', name: 'Doğal Macar Balıksırtı', floorMaterial: 'herringbone_oak', hex: '#c7a77e', finish: 'Macar Kesim · 24s Suya Dayanıklı' },
  { id: 'ye-vc-v22c', brand: 'Yıldız Entegre', series: 'VarioClic Standard', code: 'V-22C', name: 'Antrasit Macar Balıksırtı', floorMaterial: 'herringbone_oak', hex: '#57595d', finish: 'Macar Kesim · Modern Füme' },
  { id: 'ye-vc-pp515', brand: 'Yıldız Entegre', series: 'VarioClic Premium Plus', code: 'PP-515', name: 'Venedik Doğal Meşe', floorMaterial: 'plank_oak', hex: '#ceb38d', finish: '12 mm · AC4 · Derin Doku' },
  { id: 'ye-vc-pp512', brand: 'Yıldız Entegre', series: 'VarioClic Premium Plus', code: 'PP-512', name: 'Milano Orta Meşe', floorMaterial: 'plank_oak', hex: '#b39068', finish: '12 mm · AC4 · Dar Plank' },
  { id: 'ye-vc-pp513', brand: 'Yıldız Entegre', series: 'VarioClic Premium Plus', code: 'PP-513', name: 'Bergamo Koyu Meşe', floorMaterial: 'plank_walnut', hex: '#7b5b3e', finish: '12 mm · AC4 · Koyu Meşe' },
  { id: 'ye-vc-vst10d', brand: 'Yıldız Entegre', series: 'VarioClic Stilo', code: 'VST-10D', name: 'Melbourne Gri Meşe', floorMaterial: 'plank_oak', hex: '#a79581', finish: '8 mm · Timberland Doku' },
  { id: 'ye-vc-v336', brand: 'Yıldız Entegre', series: 'VarioClic Standard', code: 'V-336', name: 'Akasya Ceviz', floorMaterial: 'plank_walnut', hex: '#8f6645', finish: '8 mm · Sıcak Akasya' },

  // AGT — Effect & Bella Neo
  { id: 'agt-prk901', brand: 'AGT', series: 'Effect Elegance', code: 'PRK901', name: 'Effect Toros Meşe', floorMaterial: 'plank_oak', hex: '#cbb08a', finish: '12 mm · AC5 · 4V Derzli' },
  { id: 'agt-prk902', brand: 'AGT', series: 'Effect Premium', code: 'PRK902', name: 'Effect Tibet Açık', floorMaterial: 'plank_oak', hex: '#d4c5b0', finish: '12 mm · AC5 · Doğal Mat' },
  { id: 'agt-prk903', brand: 'AGT', series: 'Effect Premium', code: 'PRK903', name: 'Effect Everest', floorMaterial: 'plank_oak', hex: '#b99c78', finish: '12 mm · AC5 · Doğal Meşe' },
  { id: 'agt-prk904', brand: 'AGT', series: 'Effect Premium', code: 'PRK904', name: 'Effect Alp (Balıksırtı)', floorMaterial: 'herringbone_oak', hex: '#c3a47a', finish: '12 mm · AC5 · Register Emboss' },
  { id: 'agt-prk907', brand: 'AGT', series: 'Effect Premium', code: 'PRK907', name: 'Effect Ural Ceviz', floorMaterial: 'plank_walnut', hex: '#805f43', finish: '12 mm · AC5 · Derin Ahşap' },
  { id: 'agt-prk908', brand: 'AGT', series: 'Effect Premium', code: 'PRK908', name: 'Effect Altay Gri Meşe', floorMaterial: 'plank_oak', hex: '#a9a096', finish: '12 mm · AC5 · Soğuk Gri' },
  { id: 'agt-prk101', brand: 'AGT', series: 'Bella Neo', code: 'PRK101', name: 'Bella Lilyum', floorMaterial: 'plank_oak', hex: '#dfd7c8', finish: '8 mm · Açık Minimalist' },
  { id: 'agt-prk108', brand: 'AGT', series: 'Bella Neo', code: 'PRK108', name: 'Bella Defne', floorMaterial: 'plank_oak', hex: '#a88a68', finish: '8 mm · Doğal Defne Meşe' },

  // Çamsan Parke — Klasik, Modern, Platinum, Avangard
  { id: 'cm-731', brand: 'Çamsan', series: 'Klasik 8mm', code: '731', name: 'Volga Meşe', floorMaterial: 'plank_oak', hex: '#c6a57e', finish: '8 mm · AC4 · Klasik Meşe' },
  { id: 'cm-704', brand: 'Çamsan', series: 'Klasik 8mm', code: '704', name: 'Abant Meşe', floorMaterial: 'plank_oak', hex: '#b8946c', finish: '8 mm · AC4 · Sıcak Meşe' },
  { id: 'cm-645', brand: 'Çamsan', series: 'Klasik 8mm', code: '645', name: 'Kristal Meşe', floorMaterial: 'plank_oak', hex: '#dcd3c4', finish: '8 mm · AC4 · Aydınlık Ton' },
  { id: 'cm-733', brand: 'Çamsan', series: 'Modern Derzli', code: '733', name: 'Solid Meşe', floorMaterial: 'plank_oak', hex: '#be9a70', finish: '8 mm · V-Derzli Masif His' },
  { id: 'cm-717', brand: 'Çamsan', series: 'Modern Derzli', code: '717', name: 'Rustik Ceviz', floorMaterial: 'plank_walnut', hex: '#76543a', finish: '8 mm · V-Derzli Koyu Ceviz' },
  { id: 'cm-2108', brand: 'Çamsan', series: 'Platinum 10mm', code: '2108', name: 'Amasra Meşe', floorMaterial: 'plank_oak', hex: '#cdb38f', finish: '10 mm · Geniş Lüks Plaka' },
  { id: 'cm-2104', brand: 'Çamsan', series: 'Platinum 10mm', code: '2104', name: 'Amerikan Ceviz', floorMaterial: 'plank_walnut', hex: '#6c4b34', finish: '10 mm · Derin Ceviz Damar' },
  { id: 'cm-2101', brand: 'Çamsan', series: 'Platinum 10mm', code: '2101', name: 'Barok Meşe', floorMaterial: 'herringbone_oak', hex: '#b28e64', finish: '10 mm · Prestij Meşe' },
  { id: 'cm-4550', brand: 'Çamsan', series: 'Avangard 10mm', code: '4550', name: 'Belen Meşe', floorMaterial: 'plank_oak', hex: '#d3c2aa', finish: '10 mm · Zarif İnce Plaka' },
  { id: 'cm-4500', brand: 'Çamsan', series: 'Avangard 10mm', code: '4500', name: 'İtalyan Ceviz', floorMaterial: 'plank_walnut', hex: '#7d5b42', finish: '10 mm · İtalyan Ceviz' },

  // VitrA — Porselen Seramik, Mermer, Traverten & Beton Karolar (Banyo, Mutfak, Antre, Salon)
  { id: 'vt-marmori-cal', brand: 'VitrA', series: 'Marmori Porselen', code: 'VT-MRM1', name: 'Marmori Calacatta Beyaz', floorMaterial: 'marble', hex: '#efede8', finish: '60×120 cm · Lappato Mermer Karo' },
  { id: 'vt-marmori-nero', brand: 'VitrA', series: 'Marmori Porselen', code: 'VT-MRM9', name: 'Marmori Nero Siyah Mermer', floorMaterial: 'marble', hex: '#2a2b2e', finish: '60×120 cm · Damarlı Siyah Karo' },
  { id: 'vt-canyon-trv', brand: 'VitrA', series: 'Canyon Doğal Taş', code: 'VT-CNY2', name: 'Canyon Bej Traverten', floorMaterial: 'travertine', hex: '#dfd6c6', finish: '60×120 cm · Mat Traverten Karo' },
  { id: 'vt-cardostone-gr', brand: 'VitrA', series: 'Cardostone', code: 'VT-CRD4', name: 'Cardostone Sıcak Gri', floorMaterial: 'microcement', hex: '#a8a59f', finish: '60×60 cm · Mat Taş Porselen' },
  { id: 'vt-cardostone-ant', brand: 'VitrA', series: 'Cardostone', code: 'VT-CRD8', name: 'Cardostone Antrasit', floorMaterial: 'microcement', hex: '#44464b', finish: '60×60 cm · Banyo & Antre Karosu' },
  { id: 'vt-urbancrete', brand: 'VitrA', series: 'Urbancrete', code: 'VT-URB3', name: 'Urbancrete Açık Beton', floorMaterial: 'microcement', hex: '#c8c4bc', finish: '80×80 cm · Colorbody Beton' },
  { id: 'vt-retromix', brand: 'VitrA', series: 'Retromix Terrazzo', code: 'VT-RTR5', name: 'Retromix Mimari Terrazzo', floorMaterial: 'terrazzo', hex: '#dcd7ce', finish: '60×60 cm · Banyo & Mutfak Terrazzo' },
  { id: 'vt-craft-oak', brand: 'VitrA', series: 'Craft Ahşap Karo', code: 'VT-CRF2', name: 'Craft Meşe Porselen', floorMaterial: 'plank_oak', hex: '#bc9972', finish: '20×120 cm · Suya %100 Dayanıklı' },
];

// ============================================================================
// 2. DUVAR: İÇ CEPHE BOYALARI, DUVAR PROFİLLERİ, DEKORATİF PANELLER & SERAMİK
//    (Filli Boya · Jotun · AGT LB/Supramat · Kastamonu Evogloss · Yıldız · Starwood · VitrA)
// ============================================================================
export const WALL_PANEL_CATALOG: WallPanelCatalogItem[] = [
  // Filli Boya — Türkiye'nin En Popüler İç Cephe Renkleri
  { id: 'fb-1088', brand: 'Filli Boya', series: 'Momento Silan', code: 'FB-1088', name: 'Lületaşı (Sıcak Beyaz)', pattern: 'smooth', hex: '#f4f1ea', finish: 'Silinebilir İpek Mat Boya' },
  { id: 'fb-6840', brand: 'Filli Boya', series: 'Momento Silan', code: 'Cİ-6840', name: 'Beyaz Kaşmir', pattern: 'smooth', hex: '#e6dfd4', finish: 'Sofistike Vizon-Krem Ton' },
  { id: 'fb-kumbej', brand: 'Filli Boya', series: 'Bej Serisi', code: 'FB-B15', name: 'Kum Beji', pattern: 'smooth', hex: '#dfd3c0', finish: 'Klasik Sıcak Nötr Bej' },
  { id: 'fb-kumsal', brand: 'Filli Boya', series: 'Doğal Tonlar', code: 'FB-KMS', name: 'Kumsal', pattern: 'smooth', hex: '#d4c3aa', finish: 'Sıcak Sahil Beji' },
  { id: 'fb-buzul', brand: 'Filli Boya', series: 'Ferah Tonlar', code: 'FB-BZL', name: 'Buzul Gri', pattern: 'smooth', hex: '#dfe3e6', finish: 'Ferah Soğuk Beyaz-Gri' },
  { id: 'fb-and20', brand: 'Filli Boya', series: 'Zamansız Griler', code: 'Andezit 20', name: 'Andezit 20 (Açık Gri)', pattern: 'smooth', hex: '#c8c8c6', finish: 'Modern Açık Gri' },
  { id: 'fb-and45', brand: 'Filli Boya', series: 'Zamansız Griler', code: 'Andezit 45', name: 'Andezit 45 (Koyu Gri)', pattern: 'smooth', hex: '#7a7d80', finish: 'Mimari Vurgu Grisi' },
  { id: 'fb-adacayi', brand: 'Filli Boya', series: 'Doğa Koleksiyonu', code: 'FB-ADC', name: 'Adaçayı Yeşili', pattern: 'smooth', hex: '#bac5b4', finish: 'Huzurlu Soft Yeşil' },
  { id: 'fb-terracotta', brand: 'Filli Boya', series: 'Toprak Tonları', code: 'FB-TRC', name: 'Toprak Terracotta', pattern: 'smooth', hex: '#b67a61', finish: 'Sıcak Kiremit Vurgu' },
  { id: 'fb-gece', brand: 'Filli Boya', series: 'Koyu Vurgu', code: 'FB-GCL', name: 'Gece Laciverti', pattern: 'boiserie', hex: '#283647', finish: 'Derin Lacivert Çıtalı' },

  // Jotun Türkiye — Mimari İç Cephe Kartelası
  { id: 'jt-1001', brand: 'Jotun', series: 'Fenomastic Güzel Evim', code: '1001', name: 'Egg White (Yumurta Beyazı)', pattern: 'smooth', hex: '#f3efe6', finish: 'Zengin Mat · İskandinav Beyaz' },
  { id: 'jt-10678', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '10678', name: 'Space (Kuş Tüyü)', pattern: 'smooth', hex: '#dcd4c6', finish: 'En Çok Tercih Edilen Açık Bej' },
  { id: 'jt-12075', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '12075', name: 'Soothing Beige', pattern: 'smooth', hex: '#c8b9a4', finish: 'Yumuşak Sıcak Bej' },
  { id: 'jt-10341', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '10341', name: 'Kalk (Sahlep Grej)', pattern: 'smooth', hex: '#cfc8be', finish: 'Sıcak Gri-Bej (Greige)' },
  { id: 'jt-1140', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '1140', name: 'Sand (Kum Taşı)', pattern: 'smooth', hex: '#c5b59f', finish: 'Altın Alt Tonlu Bej' },
  { id: 'jt-12078', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '12078', name: 'Comfort Grey', pattern: 'smooth', hex: '#b8b3aa', finish: 'Dengeli Sıcak Gri' },
  { id: 'jt-8281', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '8281', name: 'Pale Linden (Soft Yeşil)', pattern: 'smooth', hex: '#c6ccb8', finish: 'Doğal İskandinav Yeşili' },
  { id: 'jt-8478', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '8478', name: 'Pale Green (Zeytin)', pattern: 'smooth', hex: '#9aa48c', finish: 'Sakin Zeytin Yeşili' },
  { id: 'jt-5030', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '5030', name: 'St. Pauls Blue', pattern: 'boiserie', hex: '#556975', finish: 'Mimari Gri-Mavi' },
  { id: 'jt-1434', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '1434', name: 'Elegant (Koyu Gri)', pattern: 'smooth', hex: '#4f4e4b', finish: 'Altın Alt Tonlu Koyu Gri' },
  { id: 'jt-9938', brand: 'Jotun', series: 'Fenomastic Zengin Mat', code: '9938', name: 'Dempet Sort (Mat Siyah)', pattern: 'smooth', hex: '#262729', finish: 'Yumuşak Mimari Siyah' },

  // AGT Duvar Profilleri (LB Serisi — 3D Lambri / Çıta Profili)
  { id: 'agt-lb2050-3079', brand: 'AGT', series: 'Duvar Profili LB-2050', code: 'LB-2050 / 3079', name: 'Ahşap Meşe Duvar Profili', pattern: 'slats', hex: '#b99268', finish: '18×140 mm · Akustik Çıta', isProfile: true },
  { id: 'agt-lb2050-3076', brand: 'AGT', series: 'Duvar Profili LB-2050', code: 'LB-2050 / 3076', name: 'Klasik Meşe Duvar Profili', pattern: 'slats', hex: '#9a734b', finish: '18×140 mm · Sıcak Meşe', isProfile: true },
  { id: 'agt-lb2050-248', brand: 'AGT', series: 'Duvar Profili LB-2050', code: 'LB-2050 / 248', name: 'Mat Tik Duvar Profili', pattern: 'slats', hex: '#7a5237', finish: '18×140 mm · Mat Tik Lambri', isProfile: true },
  { id: 'agt-lb2050-726', brand: 'AGT', series: 'Duvar Profili LB-2050', code: 'LB-2050 / 726', name: 'Soft Touch Fırtına Gri Profil', pattern: 'slats', hex: '#686c71', finish: '18×140 mm · Parmak İzi Bırakmaz', isProfile: true },
  { id: 'agt-lb2250', brand: 'AGT', series: 'Duvar Profili LB-2250', code: 'LB-2250', name: 'Rustik Ceviz İnce Lambri', pattern: 'slats', hex: '#60422e', finish: '12×115 mm · İnce Fitilli Profil', isProfile: true },
  { id: 'agt-lb3821', brand: 'AGT', series: 'Duvar Profili LB-3821', code: 'LB-3821', name: 'Lake Beyaz Fitilli Profil', pattern: 'slats', hex: '#edeae3', finish: 'Modern Beyaz Akustik Lambri', isProfile: true },
  { id: 'agt-lb5005', brand: 'AGT', series: 'Duvar Profili LB-5005', code: 'LB-5005', name: 'Antrasit Geniş Duvar Profili', pattern: 'slats', hex: '#31343a', finish: 'Geniş Mimari Çıta Profili', isProfile: true },

  // AGT Supramat & Soft Touch Dekoratif Paneller
  { id: 'agt-3018', brand: 'AGT', series: 'Supramat Panel', code: '3018', name: 'Ay Işığı (Moonlight)', pattern: 'smooth', hex: '#e8e4dc', finish: 'Supramat · Mat Lake Hissi' },
  { id: 'agt-3019', brand: 'AGT', series: 'Supramat Panel', code: '3019', name: 'Sahara Krem', pattern: 'smooth', hex: '#e0d6c5', finish: 'Supramat · Sıcak Krem' },
  { id: 'agt-3027', brand: 'AGT', series: 'Supramat Panel', code: '3027', name: 'Orman Yeşili', pattern: 'boiserie', hex: '#354f40', finish: 'Supramat · Çıtalı Panel' },
  { id: 'agt-3030', brand: 'AGT', series: 'Supramat Panel', code: '3030', name: 'Toros Beyaz Mermer', pattern: 'marble', hex: '#ece9e2', finish: 'Süper Mat Mermer Panel' },
  { id: 'agt-732', brand: 'AGT', series: 'Soft Touch Panel', code: '732', name: 'Soft Touch Vizon', pattern: 'boiserie', hex: '#b9ada0', finish: 'İpeksi Mat Vizon' },

  // Kastamonu Entegre — Evogloss & Vision Dekoratif Paneller
  { id: 'ke-p001', brand: 'Kastamonu Entegre', series: 'Evogloss Süpermat', code: 'P001', name: 'Süpermat Lake Beyaz', pattern: 'smooth', hex: '#f3f1eb', finish: 'PET/PVC Kaplı Süpermat' },
  { id: 'ke-p009', brand: 'Kastamonu Entegre', series: 'Evogloss Süpermat', code: 'P009', name: 'Süper Mat Kum Bej', pattern: 'boiserie', hex: '#dfd5c6', finish: 'Soft Touch Kum Beji' },
  { id: 'ke-p269', brand: 'Kastamonu Entegre', series: 'Evogloss Beton', code: 'P269', name: 'Cashmere Beton', pattern: 'concrete', hex: '#cac2b6', finish: 'Mimari Beton Dokulu Panel' },
  { id: 'ke-p272', brand: 'Kastamonu Entegre', series: 'Evogloss Beton', code: 'P272', name: 'Antrasit Beton', pattern: 'concrete', hex: '#46484c', finish: 'Koyu Endüstriyel Beton' },
  { id: 'ke-p265', brand: 'Kastamonu Entegre', series: 'Evogloss Metalik', code: 'P265', name: 'Brush Bronz Panel', pattern: 'wallpaper', hex: '#7e6953', finish: 'Fırçalanmış Bronz Doku' },

  // Yıldız Entegre & Starwood & VitrA Duvar Kaplamaları
  { id: 'ye-yt10z', brand: 'Yıldız Entegre', series: 'Yıldız Trend', code: 'YT_10Z', name: 'Satürn Bej Panel', pattern: 'smooth', hex: '#ddd4c6', finish: 'Mat Dekoratif MDF-Lam' },
  { id: 'ye-yt10v', brand: 'Yıldız Entegre', series: 'Yıldız Trend', code: 'YT_10V', name: 'Moka Kahve Boiserie', pattern: 'boiserie', hex: '#7d6656', finish: 'Sıcak Moka Çıta Duvar' },
  { id: 'sw-139', brand: 'Starwood', series: 'Süpermat MDF-Lam', code: '139', name: 'Kumtaşı Kaşmir', pattern: 'smooth', hex: '#cfc6b8', finish: 'Starwood Süpermat' },
  { id: 'sw-275', brand: 'Starwood', series: 'Naturel MDF-Lam', code: '275', name: 'Antrasit Gri Panel', pattern: 'boiserie', hex: '#3f4247', finish: 'Naturel Antrasit' },
  { id: 'sw-329', brand: 'Starwood', series: 'Senkron Ahşap', code: '329', name: 'Amerika Senkron Meşe', pattern: 'slats', hex: '#ac8860', finish: 'Derin Senkron Damar', isProfile: true },
  { id: 'sw-332', brand: 'Starwood', series: 'Senkron Ahşap', code: '332', name: 'Avustralya Ceviz Panel', pattern: 'slats', hex: '#6d4c35', finish: 'Derin Ceviz Çıta', isProfile: true },
  { id: 'vt-wall-mrm', brand: 'VitrA', series: 'Marble-X Duvar Karosu', code: 'VT-MX1', name: 'Statuario Beyaz Mermer Duvar', pattern: 'marble', hex: '#f0eee9', finish: 'Banyo & Salon Büyük Ebat Karo' },
  { id: 'vt-wall-trv', brand: 'VitrA', series: 'Canyon Taş Duvar', code: 'VT-CNW', name: 'Canyon Traverten Duvar Karosu', pattern: 'stone', hex: '#dcd2c0', finish: 'Doğal Taş Duvar Kaplaması' },
];

// ============================================================================
// 3. SÜPÜRGELİK & KÖŞELİK / KÖŞE PROFİLLERİ (AGT SPR · Floorpan · VarioClic · Çamsan · Starwood)
// ============================================================================
export const SKIRTING_TRIM_CATALOG: SkirtingTrimCatalogItem[] = [
  { id: 'agt-spr-3072', brand: 'AGT', series: 'AGT Süpürgelik', code: 'SPR-3072', name: 'Lake Beyaz', hex: '#f4f2ec', defaultHeightCm: 10, kind: 'both' },
  { id: 'agt-spr-734', brand: 'AGT', series: 'AGT Soft Touch', code: 'SPR-734', name: 'Soft Touch Beyaz', hex: '#eae7df', defaultHeightCm: 10, kind: 'both' },
  { id: 'agt-spr-729', brand: 'AGT', series: 'AGT Soft Touch', code: 'SPR-729', name: 'Yeni Gri', hex: '#b5b5b2', defaultHeightCm: 10, kind: 'both' },
  { id: 'agt-spr-726', brand: 'AGT', series: 'AGT Soft Touch', code: 'SPR-726', name: 'Fırtına Gri', hex: '#696d72', defaultHeightCm: 10, kind: 'both' },
  { id: 'agt-spr-3068', brand: 'AGT', series: 'AGT Lake', code: 'SPR-3068', name: 'Lake Antrasit', hex: '#36383d', defaultHeightCm: 12, kind: 'both' },
  { id: 'agt-spr-723', brand: 'AGT', series: 'AGT Soft Touch', code: 'SPR-723', name: 'Soft Touch Siyah', hex: '#1c1c1e', defaultHeightCm: 10, kind: 'both' },
  { id: 'agt-spr-369', brand: 'AGT', series: 'AGT Ahşap Profil', code: 'SPR-369', name: 'Alman Meşe', hex: '#ba966c', defaultHeightCm: 8, kind: 'both' },
  { id: 'agt-spr-248', brand: 'AGT', series: 'AGT Ahşap Profil', code: 'SPR-248', name: 'Mat Tik / Ceviz', hex: '#785238', defaultHeightCm: 8, kind: 'both' },
  { id: 'ke-sk-fs043', brand: 'Kastamonu Entegre', series: 'Floorpan Süpürgelik', code: 'FP-FS043', name: 'İzmir Meşe Uyumlu', hex: '#cca97e', defaultHeightCm: 8, kind: 'both' },
  { id: 'ke-sk-p001', brand: 'Kastamonu Entegre', series: 'Floorpan Lake', code: 'FP-P001', name: 'Süpermat Beyaz', hex: '#f5f4ef', defaultHeightCm: 12, kind: 'both' },
  { id: 'ke-sk-fsx01', brand: 'Kastamonu Entegre', series: 'Floorpan Süpürgelik', code: 'FP-FSX01', name: 'Gri Ceviz Uyumlu', hex: '#7e7368', defaultHeightCm: 8, kind: 'both' },
  { id: 'ye-sk-pp515', brand: 'Yıldız Entegre', series: 'VarioClic Profil', code: 'VC-PP515', name: 'Venedik Meşe', hex: '#ceb38d', defaultHeightCm: 10, kind: 'both' },
  { id: 'ye-sk-pp513', brand: 'Yıldız Entegre', series: 'VarioClic Profil', code: 'VC-PP513', name: 'Bergamo Koyu Meşe', hex: '#7b5b3e', defaultHeightCm: 10, kind: 'both' },
  { id: 'cm-sk-731', brand: 'Çamsan', series: 'Çamsan Süpürgelik', code: 'CM-731', name: 'Volga Meşe Süpürgelik', hex: '#c6a57e', defaultHeightCm: 8, kind: 'both' },
  { id: 'sw-sk-275', brand: 'Starwood', series: 'Starwood Köşelik', code: 'SW-275', name: 'Antrasit Köşe Profili', hex: '#3f4247', defaultHeightCm: 10, kind: 'both' },
];

// ============================================================================
// 4. KAPI PANELLERİ (Kastamonu Doorpan/Doorlam · Yıldız VarioDor · AGT Kapı)
// ============================================================================
export const DOOR_PANEL_CATALOG: DoorPanelCatalogItem[] = [
  { id: 'ke-dp202', brand: 'Kastamonu Entegre', series: 'Doorpan', code: 'DP202', name: 'Anatolia Lake Beyaz', hex: '#f4f2ec', handleHex: '#232325', panelStyle: 'classic', finish: 'Göbekli Klasik Lake' },
  { id: 'ke-dp208', brand: 'Kastamonu Entegre', series: 'Doorpan', code: 'DP208', name: 'Artemis Sıcak Krem', hex: '#e8e0d2', handleHex: '#9c7d48', panelStyle: 'classic', finish: 'Göbekli Krem Astarlı' },
  { id: 'ke-dl-bm', brand: 'Kastamonu Entegre', series: 'Doorlam', code: 'DL-Buz', name: 'Doorlam Buz Meşe', hex: '#d5ccc0', handleHex: '#262628', panelStyle: 'wood', finish: 'Melamin Kaplı Hazır Kapı' },
  { id: 'ke-dl-km', brand: 'Kastamonu Entegre', series: 'Doorlam', code: 'DL-KM', name: 'Doorlam Kastamonu Meşe', hex: '#b9946b', handleHex: '#232325', panelStyle: 'wood', finish: 'Doğal Meşe Damarlı' },
  { id: 'ke-dl-zg', brand: 'Kastamonu Entegre', series: 'Doorlam', code: 'DL-Zeugma', name: 'Doorlam Zeugma Ceviz', hex: '#6e4c36', handleHex: '#b59359', panelStyle: 'wood', finish: 'Koyu Ceviz Kapı Paneli' },
  { id: 'ke-dl-bd', brand: 'Kastamonu Entegre', series: 'Doorlam', code: 'DL-Bodrum', name: 'Doorlam Bodrum Antrasit', hex: '#3d4045', handleHex: '#d4b27a', panelStyle: 'modern', finish: 'Mat Antrasit Derzli' },
  { id: 'ye-vda380', brand: 'Yıldız Entegre', series: 'VarioDor Lake', code: 'VDA-380', name: 'VarioDor Lake Beyaz', hex: '#f5f4f0', handleHex: '#222224', panelStyle: 'modern', finish: 'Minimal Düz Lake' },
  { id: 'ye-vda582', brand: 'Yıldız Entegre', series: 'VarioDor Lake', code: 'VDA-582', name: 'VarioDor Lake Krem', hex: '#ebe3d3', handleHex: '#8d7244', panelStyle: 'classic', finish: 'Sıcak Lake Krem' },
  { id: 'ye-vdapr', brand: 'Yıldız Entegre', series: 'VarioDor Luxury', code: 'VDA-PR', name: 'Luxury Kozmik Gri', hex: '#676a70', handleHex: '#1b1b1d', panelStyle: 'fluted', finish: 'Dikey Çizgili Modern Kapı' },
  { id: 'ye-vda399', brand: 'Yıldız Entegre', series: 'VarioDor Ahşap', code: 'VDA-399', name: 'Kanada Meşe', hex: '#bfa07a', handleHex: '#242426', panelStyle: 'wood', finish: 'Doğal Kanada Meşe' },
  { id: 'ye-vda061', brand: 'Yıldız Entegre', series: 'VarioDor Ahşap', code: 'VDA-061', name: 'Opera Ceviz', hex: '#5f4331', handleHex: '#b8965d', panelStyle: 'wood', finish: 'Prestij Opera Ceviz' },
  { id: 'ye-vdaneo', brand: 'Yıldız Entegre', series: 'VarioDor Neo', code: 'VDA-NEO', name: 'Neo Haki Gri', hex: '#898c81', handleHex: '#1f2022', panelStyle: 'modern', finish: 'Yeni Nesil Soft Haki' },
  { id: 'agt-door-3018', brand: 'AGT', series: 'AGT Supramat Kapı', code: '3018', name: 'Supramat Ay Işığı Kapı', hex: '#e8e4dc', handleHex: '#242426', panelStyle: 'modern', finish: 'İpeksi Mat Yüzey' },
  { id: 'agt-door-726', brand: 'AGT', series: 'AGT Soft Touch Kapı', code: '726', name: 'Fırtına Gri Çizgili Kapı', hex: '#676b70', handleHex: '#c6a56b', panelStyle: 'fluted', finish: 'Dikey Fitilli Kapı' },
];

// ============================================================================
// 5. LAMİNAT & KUVARS TEZGAH (Kastamonu Technotop · Çimstone · Belenco · AGT · Starwood · Yıldız)
// ============================================================================
export const COUNTERTOP_CATALOG: CountertopCatalogItem[] = [
  // Kastamonu Technotop Laminat Tezgah
  { id: 'ke-tt-f024', brand: 'Kastamonu Entegre', series: 'Technotop Laminat', code: 'F024', name: 'Apollon Beyaz Mermer', surfaceKind: 'marble', hex: '#efede7', recommendedCabinetHex: '#e7e3db', finish: 'Quartz / Parlak Mermer' },
  { id: 'ke-tt-f042', brand: 'Kastamonu Entegre', series: 'Technotop Laminat', code: 'F042', name: 'Sahara Bej Traverten', surfaceKind: 'travertine', hex: '#dfd5c4', recommendedCabinetHex: '#7d6656', finish: 'Natural Matt Taş' },
  { id: 'ke-tt-d164', brand: 'Kastamonu Entegre', series: 'Technotop Laminat', code: 'D164', name: 'Luna Beton Gri', surfaceKind: 'microcement', hex: '#b9b6af', recommendedCabinetHex: '#3f4247', finish: 'Quarry Mat Yüzey' },
  { id: 'ke-tt-d107', brand: 'Kastamonu Entegre', series: 'Technotop Laminat', code: 'D107', name: 'Magma Siyah Taş', surfaceKind: 'microcement', hex: '#252629', recommendedCabinetHex: '#c4a47c', finish: 'PS60 Magma Mat' },
  { id: 'ke-tt-a402', brand: 'Kastamonu Entegre', series: 'Technotop Ahşap', code: 'A402', name: 'Naturel Meşe Tezgah', surfaceKind: 'plank_oak', hex: '#b9936a', recommendedCabinetHex: '#f3f1eb', finish: 'Timber Ahşap Doku' },
  { id: 'ke-tt-f039', brand: 'Kastamonu Entegre', series: 'Technotop Laminat', code: 'F039', name: 'Mozaik Terrazzo', surfaceKind: 'terrazzo', hex: '#dad5cc', recommendedCabinetHex: '#354f40', finish: 'Alutex Mimari Doku' },

  // Çimstone Kuvars Tezgah (Epiq & İsmira)
  { id: 'cs-2074', brand: 'Çimstone', series: 'Epiq Kuvars', code: '2074', name: 'Calacatta Nif', surfaceKind: 'marble', hex: '#f3f1ec', recommendedCabinetHex: '#354f40', finish: 'Kuvars · Altın-Gri Damar' },
  { id: 'cs-2081', brand: 'Çimstone', series: 'Epiq Kuvars', code: '2081', name: 'Calacatta Anka', surfaceKind: 'marble', hex: '#eeece6', recommendedCabinetHex: '#2c2e33', finish: 'Kuvars · Belirgin Mermer' },
  { id: 'cs-955', brand: 'Çimstone', series: 'İsmira Kuvars', code: '955', name: 'Barents Saf Beyaz', surfaceKind: 'microcement', hex: '#f7f6f2', recommendedCabinetHex: '#b99268', finish: 'Kuvars · Saf Beyaz' },
  { id: 'cs-936', brand: 'Çimstone', series: 'İsmira Kuvars', code: '936', name: 'Olympos', surfaceKind: 'travertine', hex: '#e2dcd0', recommendedCabinetHex: '#60422e', finish: 'Kuvars · Sıcak Hareketli' },
  { id: 'cs-900', brand: 'Çimstone', series: 'İsmira Kuvars', code: '900', name: 'Lapland Mozaik', surfaceKind: 'terrazzo', hex: '#e8e5de', recommendedCabinetHex: '#3f4247', finish: 'Kuvars · Cam & Taş Mozaik' },
  { id: 'cs-870', brand: 'Çimstone', series: 'İsmira Kuvars', code: '870', name: 'Tundra Gri', surfaceKind: 'microcement', hex: '#9f9d98', recommendedCabinetHex: '#f3f1eb', finish: 'Kuvars · Modern Gri' },

  // Belenco Kuvars Tezgah (Pure, Classic, Prestige, Loft)
  { id: 'bl-1110', brand: 'Belenco', series: 'Pure Kuvars', code: '1110', name: 'Iceberg Saf Beyaz', surfaceKind: 'microcement', hex: '#f6f6f3', recommendedCabinetHex: '#36383d', finish: 'Kuvars · Parlak Beyaz' },
  { id: 'bl-4123', brand: 'Belenco', series: 'Prestige Kuvars', code: '4123', name: 'Kashmera White', surfaceKind: 'marble', hex: '#efede8', recommendedCabinetHex: '#b9ada0', finish: 'Carrara Mermer Efekt' },
  { id: 'bl-5114', brand: 'Belenco', series: 'Prestige Kuvars', code: '5114', name: 'Carola Krem Mermer', surfaceKind: 'travertine', hex: '#e5dccb', recommendedCabinetHex: '#6d4c35', finish: 'Yumuşak Krem Damarlı' },
  { id: 'bl-4043', brand: 'Belenco', series: 'Loft Kuvars', code: '4043', name: 'Aizano Koyu Loft', surfaceKind: 'marble', hex: '#4b4c4f', recommendedCabinetHex: '#d8cfc0', finish: 'Damarlı Endüstriyel Koyu' },
  { id: 'bl-7537', brand: 'Belenco', series: 'Essential Kuvars', code: '7537', name: 'Metropol Grey', surfaceKind: 'microcement', hex: '#88898c', recommendedCabinetHex: '#f3f1eb', finish: 'Seta Mat Gri Kuvars' },
  { id: 'bl-8727', brand: 'Belenco', series: 'Classic Kuvars', code: '8727', name: 'Spa Black', surfaceKind: 'microcement', hex: '#1e1f22', recommendedCabinetHex: '#c8a376', finish: 'Derin Siyah Kuvars' },
  { id: 'bl-4444', brand: 'Belenco', series: 'Classic Kuvars', code: '4444', name: 'Shara Beige', surfaceKind: 'travertine', hex: '#d8cbb7', recommendedCabinetHex: '#3f4247', finish: 'Sıcak Bej Kuvars' },

  // AGT / Starwood / Yıldız Tezgah & Üst Tabla
  { id: 'agt-tt-3030', brand: 'AGT', series: 'AGT Mermer Tezgah', code: '3030', name: 'Toros Beyaz Mermer', surfaceKind: 'marble', hex: '#ece9e2', recommendedCabinetHex: '#36383d', finish: 'Süper Mat Damarlı' },
  { id: 'sw-tt-332', brand: 'Starwood', series: 'Starwood Tezgah', code: '332', name: 'Avustralya Ceviz Tezgah', surfaceKind: 'plank_walnut', hex: '#6d4c35', recommendedCabinetHex: '#cfc6b8', finish: 'Senkron Ceviz Tabla' },
  { id: 'sw-tt-275', brand: 'Starwood', series: 'Starwood Mat', code: '275', name: 'Antrasit Gri Tezgah', surfaceKind: 'microcement', hex: '#3f4247', recommendedCabinetHex: '#e8e4dc', finish: 'Naturel Mat Yüzey' },
  { id: 'ye-tt-yt10z', brand: 'Yıldız Entegre', series: 'Yıldız Trend Taş', code: 'YT_10Z', name: 'Satürn Bej Tezgah', surfaceKind: 'travertine', hex: '#dcd3c5', recommendedCabinetHex: '#60422e', finish: 'Mat Taş Dokusu' },
];

// ============================================================================
// 6. MOBİLYA & İNTERMOB MDF-LAM / KAPAK / PROFİL KARTELASI
// ============================================================================
export const FURNITURE_PANEL_CATALOG: FurniturePanelCatalogItem[] = [
  { id: 'ke-m-d101', brand: 'Kastamonu Entegre', series: 'Medelam / Teknolam', code: 'D101', name: 'Düz Beyaz', hex: '#f3f2ee', accentHex: '#262628', finish: 'Mat Melamin Levha' },
  { id: 'ke-m-a401', brand: 'Kastamonu Entegre', series: 'Medelam / Teknolam', code: 'A401', name: 'Beyaz Alpi Ahşap', hex: '#dcd5cb', accentHex: '#4a4742', finish: 'Hafif Damarlı Açık Ahşap' },
  { id: 'ke-m-a402', brand: 'Kastamonu Entegre', series: 'Medelam / Teknolam', code: 'A402', name: 'Naturel Meşe', hex: '#bc956b', accentHex: '#252423', finish: 'PS22 Wood Doku' },
  { id: 'ke-m-p008', brand: 'Kastamonu Entegre', series: 'Evogloss Süpermat', code: 'P008', name: 'Süper Mat Vizon', hex: '#bfb4a5', accentHex: '#2c2b29', finish: 'Soft Touch Kapak' },
  { id: 'ke-m-p010', brand: 'Kastamonu Entegre', series: 'Evogloss Süpermat', code: 'P010', name: 'Süper Mat Su Yeşili', hex: '#9ab0a3', accentHex: '#2a322d', finish: 'Pastel Mat Kapak' },
  { id: 'ke-m-p270', brand: 'Kastamonu Entegre', series: 'Evogloss Beton', code: 'P270', name: 'Gri Beton', hex: '#8f9195', accentHex: '#1f2022', finish: 'Beton Efekt Kapak' },
  { id: 'ke-m-d107', brand: 'Kastamonu Entegre', series: 'Medelam Magma', code: 'D107', name: 'Magma Siyah', hex: '#222326', accentHex: '#c6a56b', finish: 'PS60 Derin Siyah' },
  { id: 'ye-m-yt10z', brand: 'Yıldız Entegre', series: 'Yıldız Trend', code: 'YT_10Z', name: 'Satürn Bej', hex: '#ddd4c6', accentHex: '#32302e', finish: 'Mat MDF-Lam' },
  { id: 'ye-m-yt10v', brand: 'Yıldız Entegre', series: 'Yıldız Trend', code: 'YT_10V', name: 'Moka Kahve', hex: '#7d6656', accentHex: '#22201e', finish: 'Sıcak Moka Gövde' },
  { id: 'ye-m-vt068', brand: 'Yıldız Entegre', series: 'Yıldız Trend Ahşap', code: 'VT-068', name: 'Doğal Meşe', hex: '#c39e74', accentHex: '#262524', finish: 'Senkron Ahşap' },
  { id: 'sw-m-102', brand: 'Starwood', series: 'Freze MDF-Lam', code: '102', name: 'Safir Meşe', hex: '#b9956d', accentHex: '#272624', finish: 'Freze / Derin Meşe' },
  { id: 'sw-m-139', brand: 'Starwood', series: 'Süpermat MDF-Lam', code: '139', name: 'Kumtaşı Kaşmir', hex: '#cfc6b8', accentHex: '#353432', finish: 'Kaşmir / Vizon Mat' },
  { id: 'sw-m-275', brand: 'Starwood', series: 'Naturel MDF-Lam', code: '275', name: 'Antrasit Gri', hex: '#3f4247', accentHex: '#c6a56b', finish: 'Standart Antrasit' },
  { id: 'sw-m-329', brand: 'Starwood', series: 'Senkron MDF-Lam', code: '329', name: 'Amerika Senkron Meşe', hex: '#ab875f', accentHex: '#242322', finish: 'Derin Senkron Damar' },
  { id: 'sw-m-332', brand: 'Starwood', series: 'Senkron MDF-Lam', code: '332', name: 'Avustralya Ceviz', hex: '#6d4c35', accentHex: '#232120', finish: 'Koyu Ceviz' },
  { id: 'sw-m-30', brand: 'Starwood', series: 'Bute MDF-Lam', code: '30', name: 'Ceviz Bute', hex: '#845d3f', accentHex: '#242220', finish: 'Hareli Klasik Ceviz' },
  { id: 'agt-m-3018', brand: 'AGT', series: 'Supramat', code: '3018', name: 'Ay Işığı (Moonlight)', hex: '#e8e4dc', accentHex: '#26272a', finish: 'Supramat Lake' },
  { id: 'agt-m-3019', brand: 'AGT', series: 'Supramat', code: '3019', name: 'Sahara Krem', hex: '#e0d6c5', accentHex: '#4c4338', finish: 'Supramat Krem' },
  { id: 'agt-m-3011', brand: 'AGT', series: 'Supramat', code: '3011', name: 'Londra Mavi', hex: '#395572', accentHex: '#d5b982', finish: 'Supramat Mavi Kapak' },
  { id: 'agt-m-3027', brand: 'AGT', series: 'Supramat', code: '3027', name: 'Orman Yeşili', hex: '#334d3e', accentHex: '#c8a86b', finish: 'Supramat Yeşil' },
  { id: 'agt-m-726', brand: 'AGT', series: 'Soft Touch', code: '726', name: 'Fırtına Gri', hex: '#686c71', accentHex: '#1c1d1f', finish: 'Soft Touch Mat' },
  { id: 'agt-m-732', brand: 'AGT', series: 'Soft Touch', code: '732', name: 'Soft Touch Vizon', hex: '#b9ada0', accentHex: '#33302c', finish: 'İpeksi Vizon' },
];
