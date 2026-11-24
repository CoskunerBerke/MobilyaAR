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

export type ParametricFurnitureKind =
  | 'fireplace_marble'
  | 'tv_wall_unit'
  | 'wall_tv'
  | 'rug_custom'
  | 'chandelier'
  | 'wardrobe'
  | 'dining_table'
  | 'bookshelf'
  | 'bed_frame'
  | 'ac_unit'
  | 'wall_mirror'
  | 'floor_lamp'
  | 'console_table'
  | 'wall_art';

export interface WallFinish {
  colorHex: string;
  pattern: WallPattern;
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
  ceilingColorHex: string;
  recessedSpots: boolean;
  spotWarmthHex: string;
  floorMaterial: FloorMaterialKind;
  floorTintHex: string;
  walls: Record<WallId, WallFinish>;
  wallZones: ArchWallZone[];
  windows: ArchWindow[];
  doors: ArchDoor[];
  columns: ArchColumn[];
  beams: ArchBeam[];
  curtainCoves: ArchCurtainCove[];
  sun: SunConfig;
  objects: ArchPlacedObject[];
}

export const WALL_LABELS: Record<WallId, string> = {
  north: 'Üst Duvar (A)',
  south: 'Alt Duvar (C)',
  west: 'Sol Duvar (D)',
  east: 'Sağ Duvar (B)',
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
  const coffee = catalogProducts.find((p) => p.id === 'ikea-stockholm-coffee');
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
      widthM: 1.8,
      depthM: 0.59,
      heightM: 0.4,
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
    baseboardColorHex: '#f2efe8',
    ceilingColorHex: '#f8f7f3',
    recessedSpots: true,
    spotWarmthHex: '#ffe7c2',
    floorMaterial: 'herringbone_oak',
    floorTintHex: '#c8ab86',
    walls: {
      north: { colorHex: '#f2efe8', pattern: 'smooth' },
      south: { colorHex: '#f2efe8', pattern: 'boiserie' },
      west: { colorHex: '#ece7de', pattern: 'smooth' },
      east: { colorHex: '#f0ece4', pattern: 'smooth' },
    },
    wallZones: [
      {
        id: 'zone-east-slats',
        wall: 'east',
        label: 'Ahşap Çıta Bölgesi',
        offsetCm: 335,
        widthCm: 190,
        bottomCm: 0,
        heightCm: 285,
        pattern: 'slats',
        colorHex: '#b9936c',
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
        colorHex: '#f3f1eb',
        handleColorHex: '#262626',
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
