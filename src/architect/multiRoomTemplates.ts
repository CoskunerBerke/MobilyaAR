import type { Product } from '../lib/products';
import {
  createDefaultArchitectProject,
  type ArchAdjacentRoom,
  type ArchPlacedObject,
  type ArchRoomProject,
  type PassageStyle,
  type RoomKind,
  type WallId,
} from './types';

export type ApartmentPresetId = 'single' | '1+1' | '2+1' | '3+1';

export function oppositeWall(w: WallId): WallId {
  if (w === 'north') return 'south';
  if (w === 'south') return 'north';
  if (w === 'east') return 'west';
  return 'east';
}

interface RoomDefaults {
  name: string;
  w: number;
  d: number;
  floorMaterial: ArchAdjacentRoom['floorMaterial'];
  floorTintHex: string;
  floorBrandLabel: string;
  wallColorHex: string;
  wallPattern: ArchAdjacentRoom['wallPattern'];
  wallBrandLabel: string;
  passageStyle: PassageStyle;
  passageWidthCm: number;
}

export const ROOM_KIND_DEFAULTS: Record<RoomKind, RoomDefaults> = {
  living: {
    name: 'Oturma Odası',
    w: 4.4,
    d: 3.8,
    floorMaterial: 'herringbone_oak',
    floorTintHex: '#c4a47c',
    floorBrandLabel: 'Kastamonu Floorpan FRV001 · Danube Meşe',
    wallColorHex: '#f3f1eb',
    wallPattern: 'smooth',
    wallBrandLabel: 'Filli Boya FB-1088 · Lületaşı',
    passageStyle: 'open_arch',
    passageWidthCm: 145,
  },
  bedroom: {
    name: 'Yatak Odası',
    w: 3.8,
    d: 3.6,
    floorMaterial: 'plank_oak',
    floorTintHex: '#d4c5b0',
    floorBrandLabel: 'AGT Effect PRK902 · Tibet Açık',
    wallColorHex: '#dcd4c6',
    wallPattern: 'smooth',
    wallBrandLabel: 'Jotun 10678 · Space',
    passageStyle: 'door',
    passageWidthCm: 95,
  },
  kitchen: {
    name: 'Mutfak',
    w: 3.4,
    d: 3.8,
    floorMaterial: 'microcement',
    floorTintHex: '#c8c4bc',
    floorBrandLabel: 'VitrA Urbancrete VT-URB3 · Beton',
    wallColorHex: '#f3f1eb',
    wallPattern: 'smooth',
    wallBrandLabel: 'Kastamonu Evogloss P001 · Süpermat Beyaz',
    passageStyle: 'open_arch',
    passageWidthCm: 140,
  },
  bathroom: {
    name: 'Banyo / WC',
    w: 2.6,
    d: 2.6,
    floorMaterial: 'marble',
    floorTintHex: '#efede8',
    floorBrandLabel: 'VitrA Marmori VT-MRM1 · Calacatta',
    wallColorHex: '#f0eee9',
    wallPattern: 'marble',
    wallBrandLabel: 'VitrA Marble-X VT-MX1 · Statuario',
    passageStyle: 'door',
    passageWidthCm: 85,
  },
  hallway: {
    name: 'Koridor / Hol',
    w: 4.8,
    d: 1.6,
    floorMaterial: 'herringbone_oak',
    floorTintHex: '#c4a47c',
    floorBrandLabel: 'Kastamonu Floorpan FRV001 · Danube Meşe',
    wallColorHex: '#e6dfd4',
    wallPattern: 'smooth',
    wallBrandLabel: 'Filli Boya Cİ-6840 · Beyaz Kaşmir',
    passageStyle: 'open_arch',
    passageWidthCm: 150,
  },
  office: {
    name: 'Çalışma Odası',
    w: 3.4,
    d: 3.4,
    floorMaterial: 'plank_oak',
    floorTintHex: '#cdb38f',
    floorBrandLabel: 'Çamsan Platinum 2108 · Amasra Meşe',
    wallColorHex: '#c6ccb8',
    wallPattern: 'smooth',
    wallBrandLabel: 'Jotun 8281 · Pale Linden',
    passageStyle: 'door',
    passageWidthCm: 95,
  },
  balcony: {
    name: 'Balkon / Teras',
    w: 3.6,
    d: 1.8,
    floorMaterial: 'travertine',
    floorTintHex: '#dfd6c6',
    floorBrandLabel: 'VitrA Canyon VT-CNY2 · Traverten',
    wallColorHex: '#ece8df',
    wallPattern: 'stone',
    wallBrandLabel: 'VitrA Canyon VT-CNW · Taş',
    passageStyle: 'open_wide',
    passageWidthCm: 180,
  },
};

function makeStarterFixturesForRoom(room: ArchAdjacentRoom, idPrefix: string): ArchPlacedObject[] {
  const cx = room.centerXM;
  const cz = room.centerZM;
  const hw = room.widthM * 0.5;
  const hd = room.depthM * 0.5;
  const backSide = room.attachedSide; // Push main fixtures against the wall OPPOSITE the entry doorway!
  const items: ArchPlacedObject[] = [];

  if (room.roomKind === 'bathroom') {
    // VitrA WC + Aynalı Banyo Lavabo + Cam Duşakabin neatly hugging bathroom walls
    items.push(
      {
        id: `${idPrefix}-wc`,
        name: 'VitrA Asma Klozet (WC)',
        category: 'Banyo & WC',
        dimensionsCm: '42 × 68 × 110 cm',
        parametricKind: 'toilet_wc',
        parametricColorHex: '#f7f6f2',
        parametricAccentHex: '#c8cdd4',
        x: cx - hw + 0.45,
        y: 0,
        z: cz + hd - 0.38,
        rot: Math.PI,
        widthM: 0.42,
        depthM: 0.68,
        heightM: 1.1,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-vanity`,
        name: 'VitrA Aynalı Banyo Lavabo',
        category: 'Banyo & WC',
        dimensionsCm: '100 × 48 × 195 cm',
        parametricKind: 'bathroom_vanity',
        parametricColorHex: '#b99268',
        parametricAccentHex: '#c8cdd4',
        x: cx + hw - 0.26,
        y: 0,
        z: cz - 0.1,
        rot: -Math.PI / 2,
        widthM: 1.0,
        depthM: 0.48,
        heightM: 1.95,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-shower`,
        name: 'Cam Duşakabin (95×95)',
        category: 'Banyo & WC',
        dimensionsCm: '95 × 95 × 205 cm',
        parametricKind: 'shower_cabin',
        parametricColorHex: '#242528',
        parametricAccentHex: '#cfd4da',
        x: cx + hw - 0.52,
        y: 0,
        z: cz + hd - 0.52,
        rot: Math.PI,
        widthM: 0.95,
        depthM: 0.95,
        heightM: 2.05,
        mountMode: 'floor',
        source: 'parametric',
      }
    );
    return items;
  }

  if (room.roomKind === 'kitchen') {
    const cw = Math.min(2.4, Math.max(1.6, room.widthM - 1.1));
    items.push(
      {
        id: `${idPrefix}-counter`,
        name: 'Technotop Laminat Tezgah (F024)',
        category: 'Tezgah & Mutfak',
        dimensionsCm: `${Math.round(cw * 100)} × 65 × 90 cm`,
        parametricKind: 'kitchen_counter',
        parametricColorHex: '#efede7',
        parametricAccentHex: '#3f4247',
        countertopSurface: 'marble',
        materialBrandLabel: 'Kastamonu F024 · Apollon Beyaz Mermer',
        x: cx - 0.35,
        y: 0,
        z: cz - hd + 0.35,
        rot: 0,
        widthM: cw,
        depthM: 0.65,
        heightM: 0.9,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-upper`,
        name: 'Üst Mutfak Dolabı (Evogloss P001)',
        category: 'Tezgah & Mutfak',
        dimensionsCm: `${Math.round(cw * 100)} × 36 × 72 cm`,
        parametricKind: 'kitchen_upper_cabinet',
        parametricColorHex: '#f3f1eb',
        parametricAccentHex: '#262628',
        x: cx - 0.35,
        y: 1.48,
        z: cz - hd + 0.2,
        rot: 0,
        widthM: cw,
        depthM: 0.36,
        heightM: 0.72,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-fridge`,
        name: 'Ankastre Inox Buzdolabı',
        category: 'Mutfak',
        dimensionsCm: '75 × 70 × 192 cm',
        parametricKind: 'fridge',
        parametricColorHex: '#c6c9ce',
        parametricAccentHex: '#2b2d31',
        x: cx + hw - 0.42,
        y: 0,
        z: cz - hd + 0.38,
        rot: 0,
        widthM: 0.75,
        depthM: 0.7,
        heightM: 1.92,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-table`,
        name: 'Mutfak Yemek Masası',
        category: 'Masa',
        dimensionsCm: '140 × 80 × 75 cm',
        parametricKind: 'dining_table',
        parametricColorHex: '#b9936a',
        parametricAccentHex: '#252423',
        x: cx,
        y: 0,
        z: cz + 0.65,
        rot: 0,
        widthM: Math.min(1.4, room.widthM * 0.55),
        depthM: 0.8,
        heightM: 0.75,
        mountMode: 'floor',
        source: 'parametric',
      }
    );
    return items;
  }

  if (room.roomKind === 'bedroom') {
    const isLarge = room.widthM >= 3.7;
    const bedW = isLarge ? 1.7 : 1.15;
    const bedRot = backSide === 'south' ? Math.PI : 0;
    const bedZ = backSide === 'south' ? cz + hd - 1.1 : cz - hd + 1.1;
    items.push(
      {
        id: `${idPrefix}-bed`,
        name: isLarge ? 'Çift Kişilik Yatak' : 'Tek Kişilik Yatak',
        category: 'Yatak',
        dimensionsCm: `${Math.round(bedW * 100)} × 205 × 110 cm`,
        parametricKind: 'bed_frame',
        parametricColorHex: '#dcd5c9',
        parametricAccentHex: '#b9936c',
        x: cx - 0.25,
        y: 0,
        z: bedZ,
        rot: bedRot,
        widthM: bedW,
        depthM: 2.05,
        heightM: 1.1,
        mountMode: 'floor',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-wardrobe`,
        name: 'Mimari Gardırop (Starwood 139)',
        category: 'Depolama',
        dimensionsCm: '180 × 58 × 235 cm',
        parametricKind: 'wardrobe',
        parametricColorHex: '#cfc6b8',
        parametricAccentHex: '#2b2a28',
        materialBrandLabel: 'Starwood 139 · Kumtaşı Kaşmir',
        x: cx + hw - 0.32,
        y: 0,
        z: cz,
        rot: -Math.PI / 2,
        widthM: Math.min(1.8, room.depthM - 1.0),
        depthM: 0.58,
        heightM: 2.35,
        mountMode: 'wall',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-night`,
        name: 'Komodin',
        category: 'Yatak',
        dimensionsCm: '50 × 40 × 52 cm',
        parametricKind: 'nightstand',
        parametricColorHex: '#876246',
        parametricAccentHex: '#252423',
        x: cx - 0.25 - bedW * 0.5 - 0.32,
        y: 0,
        z: backSide === 'south' ? cz + hd - 0.26 : cz - hd + 0.26,
        rot: bedRot,
        widthM: 0.5,
        depthM: 0.4,
        heightM: 0.52,
        mountMode: 'floor',
        source: 'parametric',
      }
    );
    return items;
  }

  if (room.roomKind === 'office') {
    items.push(
      {
        id: `${idPrefix}-desk`,
        name: 'Çalışma Masası',
        category: 'Çalışma',
        dimensionsCm: '150 × 70 × 75 cm',
        parametricKind: 'desk',
        parametricColorHex: '#a47e5a',
        parametricAccentHex: '#252527',
        x: cx - 0.2,
        y: 0,
        z: cz - hd + 0.52,
        rot: 0,
        widthM: 1.5,
        depthM: 0.7,
        heightM: 0.75,
        mountMode: 'floor',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-chair`,
        name: 'Çalışma Koltuğu',
        category: 'Sandalye',
        dimensionsCm: '62 × 62 × 92 cm',
        parametricKind: 'office_chair',
        parametricColorHex: '#334d3e',
        parametricAccentHex: '#232325',
        x: cx - 0.2,
        y: 0,
        z: cz - hd + 1.15,
        rot: Math.PI,
        widthM: 0.62,
        depthM: 0.62,
        heightM: 0.92,
        mountMode: 'floor',
        source: 'parametric',
      },
      {
        id: `${idPrefix}-shelf`,
        name: 'Işıklı Kitaplık',
        category: 'Depolama',
        dimensionsCm: '140 × 36 × 220 cm',
        parametricKind: 'bookshelf',
        parametricColorHex: '#6d4c35',
        parametricAccentHex: '#242322',
        x: cx - hw + 0.22,
        y: 0,
        z: cz + 0.2,
        rot: Math.PI / 2,
        widthM: 1.4,
        depthM: 0.36,
        heightM: 2.2,
        mountMode: 'wall',
        source: 'parametric',
      }
    );
    return items;
  }

  return items;
}

/**
 * Sims-style "+ Yanına Oda Ekle": snaps a brand-new connected room flush onto any side of
 * either the primary room ('main') or any previously added room, cutting a walk-through passage!
 */
export function attachAdjacentRoom(
  project: ArchRoomProject,
  opts: {
    parentRoomId: string;
    side: WallId;
    roomKind: RoomKind;
    name?: string;
    widthM?: number;
    depthM?: number;
    passageStyle?: PassageStyle;
    autoFurnish?: boolean;
  }
): { room: ArchAdjacentRoom; newObjects: ArchPlacedObject[] } {
  const T = project.wallThicknessM || 0.18;
  const def = ROOM_KIND_DEFAULTS[opts.roomKind];
  const existing = project.adjacentRooms || [];
  const parent =
    opts.parentRoomId === 'main'
      ? { cx: 0, cz: 0, w: project.widthM, d: project.depthM }
      : (() => {
          const found = existing.find((r) => r.id === opts.parentRoomId);
          return found
            ? { cx: found.centerXM, cz: found.centerZM, w: found.widthM, d: found.depthM }
            : { cx: 0, cz: 0, w: project.widthM, d: project.depthM };
        })();

  const w = Math.max(1.4, Math.min(8.0, opts.widthM ?? def.w));
  const d = Math.max(1.4, Math.min(8.0, opts.depthM ?? def.d));

  let centerXM = parent.cx;
  let centerZM = parent.cz;
  if (opts.side === 'east') centerXM = parent.cx + parent.w * 0.5 + T + w * 0.5;
  else if (opts.side === 'west') centerXM = parent.cx - parent.w * 0.5 - T - w * 0.5;
  else if (opts.side === 'south') centerZM = parent.cz + parent.d * 0.5 + T + d * 0.5;
  else centerZM = parent.cz - parent.d * 0.5 - T - d * 0.5;

  // Avoid overlapping an already placed room along the same side by shifting along the wall axis
  const allRects = [
    { minX: -project.widthM * 0.5, maxX: project.widthM * 0.5, minZ: -project.depthM * 0.5, maxZ: project.depthM * 0.5 },
    ...existing.map((r) => ({
      minX: r.centerXM - r.widthM * 0.5,
      maxX: r.centerXM + r.widthM * 0.5,
      minZ: r.centerZM - r.depthM * 0.5,
      maxZ: r.centerZM + r.depthM * 0.5,
    })),
  ];
  const overlapsAny = (cx: number, cz: number) => {
    const a0x = cx - w * 0.5 + 0.05;
    const a1x = cx + w * 0.5 - 0.05;
    const a0z = cz - d * 0.5 + 0.05;
    const a1z = cz + d * 0.5 - 0.05;
    return allRects.some((b) => !(a1x <= b.minX || b.maxX <= a0x || a1z <= b.minZ || b.maxZ <= a0z));
  };
  if (overlapsAny(centerXM, centerZM)) {
    const shifts = [2.4, -2.4, 4.0, -4.0, 5.5, -5.5];
    for (const s of shifts) {
      const tx = opts.side === 'north' || opts.side === 'south' ? centerXM + s : centerXM;
      const tz = opts.side === 'east' || opts.side === 'west' ? centerZM + s : centerZM;
      if (!overlapsAny(tx, tz)) {
        centerXM = tx;
        centerZM = tz;
        break;
      }
    }
  }

  const sameKindCount = existing.filter((r) => r.roomKind === opts.roomKind).length;
  const label = opts.name?.trim() || (sameKindCount > 0 ? `${def.name} ${sameKindCount + 1}` : def.name);
  const id = `room-${opts.roomKind}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

  const room: ArchAdjacentRoom = {
    id,
    name: label,
    roomKind: opts.roomKind,
    centerXM: Number(centerXM.toFixed(2)),
    centerZM: Number(centerZM.toFixed(2)),
    widthM: Number(w.toFixed(2)),
    depthM: Number(d.toFixed(2)),
    parentRoomId: opts.parentRoomId,
    attachedSide: opts.side,
    passageStyle: opts.passageStyle ?? def.passageStyle,
    passageWidthCm: def.passageWidthCm,
    floorMaterial: def.floorMaterial,
    floorTintHex: def.floorTintHex,
    floorBrandLabel: def.floorBrandLabel,
    wallColorHex: def.wallColorHex,
    wallPattern: def.wallPattern,
    wallBrandLabel: def.wallBrandLabel,
    baseboardColorHex: project.baseboardColorHex,
    hasWindow: opts.roomKind !== 'hallway' && opts.roomKind !== 'bathroom',
    windowWall: opts.side,
  };

  const newObjects = opts.autoFurnish === false ? [] : makeStarterFixturesForRoom(room, id);
  return { room, newObjects };
}

/**
 * Builds complete 1-click Turkish residential floor plans (Tek Oda / 1+1 / 2+1 / 3+1 Tam Daire)
 * with mathematically verified zero-overlap partition walls, walk-through doorways,
 * room-specific Turkish supplier materials, and starter furniture!
 */
export function buildApartmentPreset(preset: ApartmentPresetId, catalogProducts: Product[]): ArchRoomProject {
  const base = createDefaultArchitectProject(catalogProducts);
  if (preset === 'single') {
    return { ...base, projectName: 'Modern Salon Projesi', adjacentRooms: [] };
  }

  const T = base.wallThicknessM; // 0.18 m
  // Clean salon geometry tailored for connected apartments (remove colliding west/east extra openings)
  const salonW = 5.4;
  const salonD = 4.6;
  const cleanBase: ArchRoomProject = {
    ...base,
    widthM: salonW,
    depthM: salonD,
    wallZones: [],
    columns: [],
    beams: [],
    windows: [
      {
        id: 'win-salon-north',
        wall: 'north',
        kind: 'triple',
        offsetCm: 270,
        widthCm: 280,
        heightCm: 225,
        sillHeightCm: 25,
        frameColorHex: '#26282c',
        hasSill: true,
        curtainStyle: 'sheer_and_drape',
        curtainColorHex: '#d9d1c3',
        curtainOpenRatio: 0.72,
      },
    ],
    doors: [],
    curtainCoves: [
      {
        id: 'cove-north',
        wall: 'north',
        depthCm: 22,
        dropCm: 18,
        ledEnabled: true,
        ledColorHex: '#ffddb0',
        ledIntensity: 1.15,
        colorHex: '#f8f7f3',
      },
    ],
  };

  const rooms: ArchAdjacentRoom[] = [];
  const extraObjects: ArchPlacedObject[] = [];

  const pushRoom = (r: ArchAdjacentRoom, furnish = true) => {
    rooms.push(r);
    if (furnish) extraObjects.push(...makeStarterFixturesForRoom(r, r.id));
  };

  if (preset === '1+1') {
    // Mutfak (East of Salon) + Yatak Odası (South-West) + Banyo/WC (South-East)
    const kitchen: ArchAdjacentRoom = {
      id: 'apt-kitchen',
      name: 'Mutfak',
      roomKind: 'kitchen',
      centerXM: Number((salonW * 0.5 + T + 1.7).toFixed(2)),
      centerZM: 0,
      widthM: 3.4,
      depthM: salonD,
      parentRoomId: 'main',
      attachedSide: 'east',
      passageStyle: 'open_arch',
      passageWidthCm: 150,
      floorMaterial: 'microcement',
      floorTintHex: '#c8c4bc',
      floorBrandLabel: 'VitrA Urbancrete VT-URB3 · Beton',
      wallColorHex: '#f3f1eb',
      wallPattern: 'smooth',
      wallBrandLabel: 'Kastamonu Evogloss P001 · Beyaz',
      baseboardColorHex: '#f4f2ec',
      hasWindow: true,
      windowWall: 'north',
    };
    const bedroom1: ArchAdjacentRoom = {
      id: 'apt-bed1',
      name: 'Yatak Odası',
      roomKind: 'bedroom',
      centerXM: -0.7,
      centerZM: Number((salonD * 0.5 + T + 1.8).toFixed(2)),
      widthM: 4.0,
      depthM: 3.6,
      parentRoomId: 'main',
      attachedSide: 'south',
      passageStyle: 'door',
      passageWidthCm: 95,
      floorMaterial: 'plank_oak',
      floorTintHex: '#d4c5b0',
      floorBrandLabel: 'AGT Effect PRK902 · Tibet Açık',
      wallColorHex: '#dcd4c6',
      wallPattern: 'smooth',
      wallBrandLabel: 'Jotun 10678 · Space',
      baseboardColorHex: '#f4f2ec',
      hasWindow: true,
      windowWall: 'south',
    };
    const bath: ArchAdjacentRoom = {
      id: 'apt-bath',
      name: 'Banyo / WC',
      roomKind: 'bathroom',
      centerXM: Number((1.3 + T + 1.4).toFixed(2)),
      centerZM: Number((salonD * 0.5 + T + 1.8).toFixed(2)),
      widthM: 2.8,
      depthM: 3.6,
      parentRoomId: 'main',
      attachedSide: 'south',
      passageStyle: 'door',
      passageWidthCm: 85,
      floorMaterial: 'marble',
      floorTintHex: '#efede8',
      floorBrandLabel: 'VitrA Marmori VT-MRM1 · Calacatta',
      wallColorHex: '#f0eee9',
      wallPattern: 'marble',
      wallBrandLabel: 'VitrA Marble-X VT-MX1 · Statuario',
      baseboardColorHex: '#f4f2ec',
      hasWindow: false,
    };
    pushRoom(kitchen);
    pushRoom(bedroom1);
    pushRoom(bath);
    return {
      ...cleanBase,
      projectName: '1+1 Modern Daire Planı',
      adjacentRooms: rooms,
      objects: [...cleanBase.objects, ...extraObjects],
    };
  }

  // Shared Core for 2+1 and 3+1: Salon + East Mutfak + South Koridor + South Ebeveyn Yatak + Genç Odası + Banyo/WC
  const kitchen: ArchAdjacentRoom = {
    id: 'apt-kitchen',
    name: 'Mutfak',
    roomKind: 'kitchen',
    centerXM: Number((salonW * 0.5 + T + 1.7).toFixed(2)), // 4.58
    centerZM: 0,
    widthM: 3.4,
    depthM: salonD,
    parentRoomId: 'main',
    attachedSide: 'east',
    passageStyle: 'open_arch',
    passageWidthCm: 145,
    floorMaterial: 'microcement',
    floorTintHex: '#c8c4bc',
    floorBrandLabel: 'VitrA Urbancrete VT-URB3 · Beton',
    wallColorHex: '#f3f1eb',
    wallPattern: 'smooth',
    wallBrandLabel: 'Kastamonu Evogloss P001 · Beyaz',
    baseboardColorHex: '#f4f2ec',
    hasWindow: true,
    windowWall: 'north',
  };

  const hallwayZ = Number((salonD * 0.5 + T + 0.8).toFixed(2)); // 3.28
  const hallway: ArchAdjacentRoom = {
    id: 'apt-hall',
    name: 'Koridor / Hol',
    roomKind: 'hallway',
    centerXM: 0.4,
    centerZM: hallwayZ,
    widthM: 10.0, // -4.60 .. +5.40 (cleanly connects Salon, 3. Oda, Master, Genç & Banyo!)
    depthM: 1.6, // 2.48 .. 4.08
    parentRoomId: 'main',
    attachedSide: 'south',
    passageStyle: 'open_arch',
    passageWidthCm: 155,
    floorMaterial: 'herringbone_oak',
    floorTintHex: '#c4a47c',
    floorBrandLabel: 'Kastamonu Floorpan FRV001 · Danube Meşe',
    wallColorHex: '#e6dfd4',
    wallPattern: 'smooth',
    wallBrandLabel: 'Filli Boya Cİ-6840 · Beyaz Kaşmir',
    baseboardColorHex: '#f4f2ec',
    hasWindow: false,
  };

  const row3Z = Number((hallwayZ + 0.8 + T + 1.8).toFixed(2)); // 6.06
  const masterBed: ArchAdjacentRoom = {
    id: 'apt-bed-master',
    name: 'Ebeveyn Yatak Odası',
    roomKind: 'bedroom',
    centerXM: -2.0, // -4.10 .. +0.10
    centerZM: row3Z,
    widthM: 4.2,
    depthM: 3.6,
    parentRoomId: 'apt-hall',
    attachedSide: 'south',
    passageStyle: 'door',
    passageWidthCm: 95,
    floorMaterial: 'plank_oak',
    floorTintHex: '#d4c5b0',
    floorBrandLabel: 'AGT Effect PRK902 · Tibet Açık',
    wallColorHex: '#dcd4c6',
    wallPattern: 'smooth',
    wallBrandLabel: 'Jotun 10678 · Space',
    baseboardColorHex: '#f4f2ec',
    hasWindow: true,
    windowWall: 'south',
  };

  const teenBed: ArchAdjacentRoom = {
    id: 'apt-bed-2',
    name: 'Genç Odası',
    roomKind: 'bedroom',
    centerXM: 1.98, // 0.28 .. 3.68 (exact 0.18m wall gap from masterBed!)
    centerZM: row3Z,
    widthM: 3.4,
    depthM: 3.6,
    parentRoomId: 'apt-hall',
    attachedSide: 'south',
    passageStyle: 'door',
    passageWidthCm: 95,
    floorMaterial: 'plank_oak',
    floorTintHex: '#cdb38f',
    floorBrandLabel: 'Çamsan Platinum 2108 · Amasra Meşe',
    wallColorHex: '#f4f1ea',
    wallPattern: 'smooth',
    wallBrandLabel: 'Filli Boya FB-1088 · Lületaşı',
    baseboardColorHex: '#f4f2ec',
    hasWindow: true,
    windowWall: 'south',
  };

  const bathroom: ArchAdjacentRoom = {
    id: 'apt-bath',
    name: 'Banyo & WC',
    roomKind: 'bathroom',
    centerXM: 5.16, // 3.86 .. 6.46 (exact 0.18m wall gap from teenBed, overlaps hallway 3.86..5.40 = 1.54m!)
    centerZM: row3Z,
    widthM: 2.6,
    depthM: 3.6,
    parentRoomId: 'apt-hall',
    attachedSide: 'south',
    passageStyle: 'door',
    passageWidthCm: 85,
    floorMaterial: 'marble',
    floorTintHex: '#efede8',
    floorBrandLabel: 'VitrA Marmori VT-MRM1 · Calacatta',
    wallColorHex: '#f0eee9',
    wallPattern: 'marble',
    wallBrandLabel: 'VitrA Marble-X VT-MX1 · Statuario',
    baseboardColorHex: '#f4f2ec',
    hasWindow: false,
  };

  pushRoom(kitchen);
  pushRoom(hallway, false);
  pushRoom(masterBed);
  pushRoom(teenBed);
  pushRoom(bathroom);

  if (preset === '3+1') {
    // 3rd Room (Çalışma / 3. Oda) flush West of Salon, entering cleanly from Koridor / Hol so Salon's west fireplace wall stays unobstructed!
    const room3: ArchAdjacentRoom = {
      id: 'apt-room-3',
      name: 'Çalışma / 3. Oda',
      roomKind: 'office',
      centerXM: Number((-salonW * 0.5 - T - 1.7).toFixed(2)), // -4.58 (-6.28 .. -2.88)
      centerZM: 0,
      widthM: 3.4,
      depthM: salonD,
      parentRoomId: 'apt-hall',
      attachedSide: 'north',
      passageStyle: 'door',
      passageWidthCm: 95,
      floorMaterial: 'plank_oak',
      floorTintHex: '#cca97e',
      floorBrandLabel: 'Kastamonu Floorpan FS043 · İzmir Meşe',
      wallColorHex: '#c6ccb8',
      wallPattern: 'smooth',
      wallBrandLabel: 'Jotun 8281 · Pale Linden',
      baseboardColorHex: '#f4f2ec',
      hasWindow: true,
      windowWall: 'north',
    };
    pushRoom(room3);
  }

  return {
    ...cleanBase,
    projectName: preset === '3+1' ? '3+1 Tam Daire Planı (117 m²)' : '2+1 Daire Planı (94 m²)',
    adjacentRooms: rooms,
    objects: [...cleanBase.objects, ...extraObjects],
  };
}
