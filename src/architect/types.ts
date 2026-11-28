import type { Product } from '../lib/products';

export type WallId = 'north' | 'south' | 'west' | 'east';

export type WallPattern =
  | 'smooth'
  | 'boiserie'
  | 'slats'
  | 'concrete'
  | 'stone'
  | 'wallpaper'
  | 'marble'
  | 'mirror';

export type FloorMaterialKind =
  | 'herringbone_oak'
  | 'plank_oak'
  | 'plank_walnut'
  | 'travertine'
  | 'marble'
  | 'microcement'
  | 'terrazzo';

export type WindowKind =
  | 'single'
  | 'double'
  | 'triple'
  | 'quad'
  | 'french'
  | 'sliding'
  | 'round'
  | 'oval'
  | 'arched';

export type CurtainStyle = 'none' | 'sheer_and_drape' | 'sheer_only' | 'roman_blind';

export type DoorKind = 'single' | 'double' | 'sliding' | 'archway';

export type RoomKind = 'living' | 'bedroom' | 'kitchen' | 'bathroom' | 'hallway' | 'office' | 'balcony';

export type PassageStyle = 'door' | 'open_arch' | 'open_wide';

export interface ArchAdjacentRoom {
  id: string;
  name: string;
  roomKind: RoomKind;
  /** World-space center X/Z in meters relative to primary room origin (0,0) */
  centerXM: number;
  centerZM: number;
  widthM: number;
  depthM: number;
  /** Parent room id ('main' or another adjacentRoom.id) */
  parentRoomId: string;
  /** Which side of the parent room this room attaches to */
  attachedSide: WallId;
  passageStyle: PassageStyle;
  passageWidthCm: number;
  floorMaterial: FloorMaterialKind;
  floorTintHex: string;
  floorBrandLabel?: string;
  wallColorHex: string;
  wallPattern: WallPattern;
  wallBrandLabel?: string;
  baseboardColorHex: string;
  hasWindow?: boolean;
  windowWall?: WallId;
}

export interface HouseBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  totalW: number;
  totalD: number;
  centerX: number;
  centerZ: number;
  totalAreaM2: number;
  roomCount: number;
}

export function getHouseBounds(project: {
  widthM: number;
  depthM: number;
  adjacentRooms?: ArchAdjacentRoom[];
}): HouseBounds {
  let minX = -project.widthM * 0.5;
  let maxX = project.widthM * 0.5;
  let minZ = -project.depthM * 0.5;
  let maxZ = project.depthM * 0.5;
  let totalAreaM2 = project.widthM * project.depthM;
  const rooms = project.adjacentRooms || [];
  for (const r of rooms) {
    minX = Math.min(minX, r.centerXM - r.widthM * 0.5);
    maxX = Math.max(maxX, r.centerXM + r.widthM * 0.5);
    minZ = Math.min(minZ, r.centerZM - r.depthM * 0.5);
    maxZ = Math.max(maxZ, r.centerZM + r.depthM * 0.5);
    totalAreaM2 += r.widthM * r.depthM;
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    totalW: maxX - minX,
    totalD: maxZ - minZ,
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
    totalAreaM2,
    roomCount: 1 + rooms.length,
  };
}

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  living: 'Salon',
  bedroom: 'Yatak Odası',
  kitchen: 'Mutfak',
  bathroom: 'Banyo / WC',
  hallway: 'Koridor / Hol',
  office: 'Çalışma Odası',
  balcony: 'Balkon / Teras',
};

export const PASSAGE_STYLE_LABELS: Record<PassageStyle, string> = {
  door: 'Kapılı Geçiş',
  open_arch: 'Açık Kemer Geçiş',
  open_wide: 'Geniş Açık Geçiş',
};

export type ParametricFurnitureKind =
  | 'fireplace_marble'
  | 'linear_fireplace'
  | 'tv_wall_unit'
  | 'tv_baza'
  | 'wall_tv'
  | 'wall_shelf'
  | 'decorative_vase'
  | 'rug_custom'
  | 'chandelier'
  | 'wardrobe'
  | 'dining_table'
  | 'dining_chair'
  | 'bookshelf'
  | 'bed_frame'
  | 'nightstand'
  | 'sofa'
  | 'armchair'
  | 'coffee_table_round'
  | 'coffee_table_rect'
  | 'desk'
  | 'office_chair'
  | 'vanity_table'
  | 'sideboard'
  | 'ottoman'
  | 'potted_plant'
  | 'table_lamp'
  | 'stairs'
  | 'ac_unit'
  | 'wall_mirror'
  | 'floor_lamp'
  | 'console_table'
  | 'kitchen_counter'
  | 'kitchen_upper_cabinet'
  | 'fridge'
  | 'toilet_wc'
  | 'bathroom_vanity'
  | 'shower_cabin'
  | 'washer'
  | 'wall_art';

export interface WallFinish {
  colorHex: string;
  pattern: WallPattern;
  brandLabel?: string;
}

/** Partial region / accent panel painted or clad on a specific section of any wall */
export interface ArchWallZone {
  id: string;
  wall: WallId;
  label: string;
  /** Center distance from the left interior edge of this wall (cm) */
  offsetCm: number;
  widthCm: number;
  /** Bottom distance from floor (cm), 0 = floor-to-top */
  bottomCm: number;
  heightCm: number;
  pattern: WallPattern;
  colorHex: string;
  brandLabel?: string;
}

export interface ArchWindow {
  id: string;
  wall: WallId;
  kind: WindowKind;
  offsetCm: number;
  widthCm: number;
  heightCm: number;
  sillHeightCm: number;
  frameColorHex: string;
  hasSill: boolean;
  curtainStyle: CurtainStyle;
  curtainColorHex: string;
  curtainOpenRatio: number;
}

export interface ArchDoor {
  id: string;
  wall: WallId;
  kind: DoorKind;
  offsetCm: number;
  widthCm: number;
  heightCm: number;
  swing: 'inward' | 'outward';
  hinge: 'left' | 'right';
  openAngleDeg: number;
  colorHex: string;
  handleColorHex: string;
  panelStyle?: 'classic' | 'modern' | 'fluted' | 'wood';
  brandLabel?: string;
}

export interface ArchColumn {
  id: string;
  label: string;
  shape: 'rect' | 'round';
  xCm: number;
  zCm: number;
  widthCm: number;
  depthCm: number;
  colorHex: string;
}

export interface ArchBeam {
  id: string;
  label: string;
  axis: 'x' | 'z';
  positionCm: number;
  widthCm: number;
  dropCm: number;
  colorHex: string;
}

export interface ArchCurtainCove {
  id: string;
  wall: WallId;
  depthCm: number;
  dropCm: number;
  ledEnabled: boolean;
  ledColorHex: string;
  ledIntensity: number;
  colorHex: string;
}

/** Architectural 2nd Floor / Loft Mezzanine Platform (Asma Kat) */
export interface ArchMezzanine {
  enabled: boolean;
  /** Wall the mezzanine slab anchors against */
  anchorWall: WallId;
  /** Deck top surface height from ground floor (meters, e.g. 2.05m) */
  heightM: number;
  /** Slab depth protruding from anchorWall (meters, e.g. 2.45m) */
  depthM: number;
  /** Coverage ratio along anchorWall (0.45..1.0; <1 leaves an open stairwell gap) */
  widthRatio: number;
  /** Side of the open stairwell gap when widthRatio < 1 */
  stairGapSide: 'west' | 'east' | 'none';
  /** Structural slab thickness (meters, default 0.16m) */
  thicknessM: number;
  /** Upper floor deck wood/material tint */
  deckColorHex: string;
  /** Front edge balustrade style */
  railingStyle: 'none' | 'glass' | 'metal';
  /** Warm recessed LED strip under the mezzanine slab */
  underLed: boolean;
}

export interface MezzanineBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  widthM: number;
  depthM: number;
  topY: number;
  bottomY: number;
  thickM: number;
}

export function getMezzanineBounds(project: {
  widthM: number;
  depthM: number;
  ceilingM: number;
  mezzanine?: ArchMezzanine;
}): MezzanineBounds | null {
  const mez = project.mezzanine;
  if (!mez || !mez.enabled) return null;
  const W = project.widthM;
  const D = project.depthM;
  const H = project.ceilingM;
  const thickM = Math.max(0.1, Math.min(0.32, mez.thicknessM || 0.16));
  const topY = Math.max(1.55, Math.min(Math.max(1.7, H - 1.15), mez.heightM || 2.05));
  const bottomY = topY - thickM;
  const ratio = Math.max(0.45, Math.min(1.0, mez.widthRatio || 0.8));

  let minX = -W * 0.5;
  let maxX = W * 0.5;
  let minZ = -D * 0.5;
  let maxZ = D * 0.5;

  if (mez.anchorWall === 'north' || mez.anchorWall === 'south') {
    const spanD = Math.max(1.2, Math.min(D * 0.72, mez.depthM || D * 0.52));
    const slabW = W * (mez.stairGapSide === 'none' ? 1.0 : ratio);
    if (mez.anchorWall === 'north') {
      minZ = -D * 0.5;
      maxZ = -D * 0.5 + spanD;
    } else {
      maxZ = D * 0.5;
      minZ = D * 0.5 - spanD;
    }
    if (mez.stairGapSide === 'west') {
      maxX = W * 0.5;
      minX = W * 0.5 - slabW;
    } else if (mez.stairGapSide === 'east') {
      minX = -W * 0.5;
      maxX = -W * 0.5 + slabW;
    }
  } else {
    const spanW = Math.max(1.2, Math.min(W * 0.72, mez.depthM || W * 0.52));
    const slabD = D * (mez.stairGapSide === 'none' ? 1.0 : ratio);
    if (mez.anchorWall === 'west') {
      minX = -W * 0.5;
      maxX = -W * 0.5 + spanW;
    } else {
      maxX = W * 0.5;
      minX = W * 0.5 - spanW;
    }
    if (mez.stairGapSide === 'west') {
      maxZ = D * 0.5;
      minZ = D * 0.5 - slabD;
    } else if (mez.stairGapSide === 'east') {
      minZ = -D * 0.5;
      maxZ = -D * 0.5 + slabD;
    }
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    widthM: Math.max(0.5, maxX - minX),
    depthM: Math.max(0.5, maxZ - minZ),
    topY,
    bottomY,
    thickM,
  };
}

export type SolarSeason = 'summer' | 'equinox' | 'winter';

export interface SunConfig {
  northAngleDeg: number;
  hour: number;
  season: SolarSeason;
  sunIntensity: number;
}

export interface ArchPlacedObject {
  id: string;
  name: string;
  category: string;
  dimensionsCm: string;
  glbUrl?: string;
  parametricKind?: ParametricFurnitureKind;
  parametricColorHex?: string;
  parametricAccentHex?: string;
  /** Countertop surface texture kind for kitchen_counter (Technotop / laminate worktops) */
  countertopSurface?: FloorMaterialKind;
  /** Real supplier catalog specification label (e.g. "Starwood 332 Avustralya Ceviz") */
  materialBrandLabel?: string;
  /** Live color tint applied to imported/RunPod .GLB meshes when user changes color */
  tintHex?: string;
  /** Tracks originating Pinterest item ID so RunPod 2K PBR upgrade replaces it in-place */
  pinterestItemId?: string;
  /** 0 = Ground floor, 1 = Upper 2nd floor / mezzanine */
  floorLevel?: 0 | 1;
  /** When set, object is locked inside/on top of this parent furniture piece (moves together & stays inside bounds) */
  lockedParentId?: string;
  /** When true, skips solid obstacle collision for intentional custom nesting */
  allowOverlap?: boolean;
  x: number;
  y: number;
  z: number;
  rot: number;
  widthM: number;
  depthM: number;
  heightM: number;
  mountMode: 'floor' | 'wall' | 'ceiling' | 'rug';
  attachedWall?: WallId;
  thumbUrl?: string;
  source: 'catalog' | 'cad' | 'parametric' | 'pinterest-ai';
  productRef?: Product;
}

export type ArchSelection =
  | { type: 'object'; id: string }
  | { type: 'wall'; wall: WallId }
  | { type: 'wallZone'; id: string }
  | { type: 'floor' }
  | { type: 'window'; id: string }
  | { type: 'door'; id: string }
  | { type: 'column'; id: string }
  | { type: 'beam'; id: string }
  | { type: 'adjacentRoom'; id: string }
  | null;

export interface ArchRoomProject {
  version: 2;
  projectName: string;
  widthM: number;
  depthM: number;
  ceilingM: number;
  wallThicknessM: number;
  showCeiling: boolean;
  showBaseboard: boolean;
  baseboardColorHex: string;
  baseboardHeightCm?: number;
  baseboardBrandLabel?: string;
  showCornerTrim?: boolean;
  cornerTrimColorHex?: string;
  cornerTrimBrandLabel?: string;
  ceilingColorHex: string;
  recessedSpots: boolean;
  spotWarmthHex: string;
  floorMaterial: FloorMaterialKind;
  floorTintHex: string;
  floorBrandLabel?: string;
  walls: Record<WallId, WallFinish>;
  wallZones: ArchWallZone[];
  windows: ArchWindow[];
  doors: ArchDoor[];
  columns: ArchColumn[];
  beams: ArchBeam[];
  curtainCoves: ArchCurtainCove[];
  mezzanine?: ArchMezzanine;
  adjacentRooms?: ArchAdjacentRoom[];
  sun: SunConfig;
  objects: ArchPlacedObject[];
}

export const WALL_LABELS: Record<WallId, string> = {
  north: 'Karşı Duvar',
  south: 'Ön Duvar',
  west: 'Sol Duvar',
  east: 'Sağ Duvar',
};

export const WALL_SHORT_LABELS: Record<WallId, string> = {
  north: 'Karşı',
  east: 'Sağ',
  south: 'Ön',
  west: 'Sol',
};

export const WINDOW_KIND_LABELS: Record<WindowKind, string> = {
  single: 'Tekli (1 Kanat)',
  double: 'Çiftli (2 Kanat)',
  triple: 'Üçlü (3 Kanat)',
  quad: 'Dörtlü (4 Kanat)',
  french: 'Fransız (Boydan Boya)',
  sliding: 'Sürgülü Balkon Camı',
  round: 'Yuvarlak Pencere',
  oval: 'Oval Pencere',
  arched: 'Kemerli Pencere',
};

export const DOOR_KIND_LABELS: Record<DoorKind, string> = {
  single: 'Tek Kanat Kapı',
  double: 'Çift Kanat Salon Kapısı',
  sliding: 'Sürgülü Kapı',
  archway: 'Kemerli Geçiş Boşluğu',
};

export const WALL_PATTERN_LABELS: Record<WallPattern, string> = {
  smooth: 'Mat Boya',
  boiserie: 'Duvar Çıtası',
  slats: 'Ahşap Çıta',
  marble: 'Mermer Panel',
  stone: 'Traverten Taş',
  concrete: 'Brüt Beton',
  wallpaper: 'Keten Kağıt',
  mirror: 'Dekoratif Ayna',
};

export const FLOOR_MATERIAL_LABELS: Record<FloorMaterialKind, { label: string; defaultTint: string }> = {
  herringbone_oak: { label: 'Balıksırtı Meşe', defaultTint: '#c8ab86' },
  plank_oak: { label: 'Geniş Meşe Parke', defaultTint: '#cbb18f' },
  plank_walnut: { label: 'Amerikan Ceviz', defaultTint: '#876246' },
  travertine: { label: 'Mat Traverten', defaultTint: '#ded6c7' },
  marble: { label: 'Calacatta Mermer', defaultTint: '#eceae4' },
  microcement: { label: 'Mikrosement Beton', defaultTint: '#c8c4bc' },
  terrazzo: { label: 'Mimari Terrazzo', defaultTint: '#dcd8cf' },
};

export const ARCHITECTURAL_PAINT_SWATCHES = [
  { name: 'Kireç Beyazı', hex: '#f4f1ea' },
  { name: 'Kum Beji', hex: '#e6dfd3' },
  { name: 'Sıcak Grej', hex: '#d4ccc0' },
  { name: 'Badem Taşı', hex: '#c5b8a5' },
  { name: 'Adaçayı Yeşili', hex: '#c6cfc1' },
  { name: 'Zeytin Gri', hex: '#7f8779' },
  { name: 'Toprak Terracotta', hex: '#b67d65' },
  { name: 'Füme Antrasit', hex: '#434548' },
  { name: 'Gece Laciverti', hex: '#2b3847' },
  { name: 'Koyu Ceviz', hex: '#634937' },
];

export const FRAME_COLOR_SWATCHES = [
  { name: 'Antrasit', hex: '#2b2e33' },
  { name: 'Siyah Mat', hex: '#18181a' },
  { name: 'Beyaz PVC', hex: '#f2f1ed' },
  { name: 'Doğal Meşe', hex: '#8b6848' },
  { name: 'Bronz', hex: '#5f5143' },
];

export function getWallLengthM(wall: WallId, roomW: number, roomD: number): number {
  return wall === 'north' || wall === 'south' ? roomW : roomD;
}

export function createDefaultArchitectProject(catalogProducts: Product[]): ArchRoomProject {
  const sofa = catalogProducts.find((p) => p.id === 'ikea-landskrona-sofa') || catalogProducts[0];
  // Use lightweight 442 KB Lisabo coffee table (10x lighter than 4.6 MB Stockholm) for instant loading & silky FPS!
  const coffee = catalogProducts.find((p) => p.id === 'ikea-lisabo-table') || catalogProducts.find((p) => p.id === 'ikea-stockholm-coffee');
  const chair = catalogProducts.find((p) => p.id === 'ikea-strandmon-chair');

  const objects: ArchPlacedObject[] = [
    {
      id: 'obj-rug-main',
      name: 'Dokuma Salon Halısı',
      category: 'Mimari Modül',
      dimensionsCm: '300 × 220 × 2 cm',
      parametricKind: 'rug_custom',
      parametricColorHex: '#e7e0d4',
      parametricAccentHex: '#bfb4a2',
      x: 0.1,
      y: 0,
      z: 0.2,
      rot: 0,
      widthM: 3.0,
      depthM: 2.2,
      heightM: 0.015,
      mountMode: 'rug',
      source: 'parametric',
    },
    {
      id: 'obj-fireplace-west',
      name: 'Calacatta Mermer Şömine',
      category: 'Şömine',
      dimensionsCm: '220 × 44 × 280 cm',
      parametricKind: 'fireplace_marble',
      parametricColorHex: '#ece9e2',
      parametricAccentHex: '#252423',
      x: -2.47,
      y: 0,
      z: 0.05,
      rot: Math.PI / 2,
      widthM: 2.2,
      depthM: 0.44,
      heightM: 2.8,
      mountMode: 'wall',
      attachedWall: 'west',
      source: 'parametric',
    },
    {
      id: 'obj-tv-west',
      name: 'Duvar OLED TV (65")',
      category: 'Televizyon',
      dimensionsCm: '145 × 6 × 84 cm',
      parametricKind: 'wall_tv',
      parametricColorHex: '#18181b',
      parametricAccentHex: '#0b0c10',
      x: -2.26,
      y: 1.28,
      z: 0.05,
      rot: Math.PI / 2,
      widthM: 1.45,
      depthM: 0.06,
      heightM: 0.84,
      mountMode: 'wall',
      attachedWall: 'west',
      source: 'parametric',
    },
    {
      id: 'obj-chandelier-center',
      name: 'Pirinç Halka Avize',
      category: 'Aydınlatma',
      dimensionsCm: '85 × 85 × 50 cm',
      parametricKind: 'chandelier',
      parametricColorHex: '#c8a86b',
      parametricAccentHex: '#fff4dc',
      x: 0.25,
      y: 2.32,
      z: 0.15,
      rot: 0,
      widthM: 0.85,
      depthM: 0.85,
      heightM: 0.5,
      mountMode: 'ceiling',
      source: 'parametric',
    },
  ];

  if (sofa) {
    objects.push({
      id: 'obj-sofa-main',
      name: sofa.name,
      category: sofa.category,
      dimensionsCm: sofa.dimensionsCm,
      glbUrl: sofa.glbUrl,
      x: 1.35,
      y: 0,
      z: 0.15,
      rot: -Math.PI / 2,
      widthM: 2.04,
      depthM: 0.89,
      heightM: 0.78,
      mountMode: 'floor',
      thumbUrl: sofa.thumbUrl,
      source: 'catalog',
      productRef: sofa,
    });
  }

  if (coffee) {
    objects.push({
      id: 'obj-coffee-main',
      name: coffee.name,
      category: coffee.category,
      dimensionsCm: coffee.dimensionsCm,
      glbUrl: coffee.glbUrl,
      x: 0.05,
      y: 0,
      z: 0.15,
      rot: Math.PI / 2,
      widthM: 1.18,
      depthM: 0.5,
      heightM: 0.45,
      mountMode: 'floor',
      thumbUrl: coffee.thumbUrl,
      source: 'catalog',
      productRef: coffee,
    });
  }

  if (chair) {
    objects.push({
      id: 'obj-chair-accent',
      name: chair.name,
      category: chair.category,
      dimensionsCm: chair.dimensionsCm,
      glbUrl: chair.glbUrl,
      x: 0.2,
      y: 0,
      z: -1.55,
      rot: 0.25,
      widthM: 0.82,
      depthM: 0.96,
      heightM: 1.01,
      mountMode: 'floor',
      thumbUrl: chair.thumbUrl,
      source: 'catalog',
      productRef: chair,
    });
  }

  return {
    version: 2,
    projectName: 'Modern Salon Projesi',
    widthM: 5.4,
    depthM: 4.8,
    ceilingM: 2.85,
    wallThicknessM: 0.18,
    showCeiling: false,
    showBaseboard: true,
    baseboardColorHex: '#f4f2ec',
    baseboardHeightCm: 10,
    baseboardBrandLabel: 'AGT SPR-3072 · Lake Beyaz',
    showCornerTrim: true,
    cornerTrimColorHex: '#eae7df',
    cornerTrimBrandLabel: 'AGT SPR-734 · Soft Touch Köşelik',
    ceilingColorHex: '#f8f7f3',
    recessedSpots: true,
    spotWarmthHex: '#ffe7c2',
    floorMaterial: 'herringbone_oak',
    floorTintHex: '#c4a47c',
    floorBrandLabel: 'Kastamonu Floorpan FRV001 · Danube Meşe',
    walls: {
      north: { colorHex: '#f3f1eb', pattern: 'smooth', brandLabel: 'Kastamonu Evogloss P001 · Süpermat Beyaz' },
      south: { colorHex: '#f3f1eb', pattern: 'boiserie', brandLabel: 'Kastamonu Evogloss P001 · Çıtalı' },
      west: { colorHex: '#e8e4dc', pattern: 'smooth', brandLabel: 'AGT Supramat 3018 · Ay Işığı' },
      east: { colorHex: '#efeae2', pattern: 'smooth', brandLabel: 'Yıldız Trend YT_10Z · Satürn Bej' },
    },
    wallZones: [
      {
        id: 'zone-east-slats',
        wall: 'east',
        label: 'AGT LB-2050 / 3079 · Ahşap Meşe Duvar Profili',
        offsetCm: 335,
        widthCm: 190,
        bottomCm: 0,
        heightCm: 285,
        pattern: 'slats',
        colorHex: '#b99268',
        brandLabel: 'AGT LB-2050 / 3079 · Ahşap Meşe',
      },
    ],
    windows: [
      {
        id: 'win-north-triple',
        wall: 'north',
        kind: 'triple',
        offsetCm: 270,
        widthCm: 270,
        heightCm: 225,
        sillHeightCm: 25,
        frameColorHex: '#26282c',
        hasSill: true,
        curtainStyle: 'sheer_and_drape',
        curtainColorHex: '#d9d1c3',
        curtainOpenRatio: 0.72,
      },
      {
        id: 'win-east-arched',
        wall: 'east',
        kind: 'arched',
        offsetCm: 125,
        widthCm: 105,
        heightCm: 175,
        sillHeightCm: 65,
        frameColorHex: '#26282c',
        hasSill: true,
        curtainStyle: 'none',
        curtainColorHex: '#d9d1c3',
        curtainOpenRatio: 0.7,
      },
    ],
    doors: [
      {
        id: 'door-south-entry',
        wall: 'south',
        kind: 'single',
        offsetCm: 120,
        widthCm: 95,
        heightCm: 215,
        swing: 'inward',
        hinge: 'left',
        openAngleDeg: 38,
        colorHex: '#f4f2ec',
        handleColorHex: '#232325',
        panelStyle: 'classic',
        brandLabel: 'Kastamonu Doorpan DP202 · Anatolia Beyaz',
      },
    ],
    columns: [
      {
        id: 'col-nw',
        label: 'Köşe Kolonu',
        shape: 'rect',
        xCm: -250,
        zCm: -220,
        widthCm: 40,
        depthCm: 40,
        colorHex: '#f2efe8',
      },
    ],
    beams: [
      {
        id: 'beam-north',
        label: 'Üst Kiriş',
        axis: 'x',
        positionCm: -225,
        widthCm: 30,
        dropCm: 30,
        colorHex: '#f5f3ee',
      },
    ],
    curtainCoves: [
      {
        id: 'cove-north',
        wall: 'north',
        depthCm: 22,
        dropCm: 18,
        ledEnabled: true,
        ledColorHex: '#ffddb0',
        ledIntensity: 1.2,
        colorHex: '#f8f7f3',
      },
    ],
    sun: {
      northAngleDeg: 155,
      hour: 14.5,
      season: 'equinox',
      sunIntensity: 1.75,
    },
    objects,
  };
}
