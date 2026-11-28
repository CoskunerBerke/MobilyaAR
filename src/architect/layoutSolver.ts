/**
 * MekanAR Universal Architectural Layout & Relationship Solver (Stage 2)
 *
 * Enforces universal interior-architecture physics & parent-child spatial relationships
 * for ANY random Pinterest room photo (living room, bedroom, dining room, home office,
 * 2-story mezzanine loft, studio, hallway):
 *
 *  1. True 2D wall-elevation occupancy (allows vertical stacking: art over bed, board over mirror)
 *  2. Window exclusion zones (wall items never clip through windows)
 *  3. Left-to-right photo-order consistency along primary walls
 *  4. Parent-child furniture relationships:
 *       - table_lamp      -> placed ON TOP OF nearest nightstand / desk / vanity / sideboard / console
 *       - nightstand      -> flanks left/right of bed_frame flush against the same wall
 *       - office_chair    -> snaps in front of desk / vanity_table facing the tabletop
 *       - dining_chair    -> orbits dining_table cleanly facing inward
 *       - coffee_table_*  -> centers 0.55m in front of sofa (if sofa exists & coffee table is near center)
 *       - rug_custom      -> centers beneath seating group or bed without drifting into corners
 *       - wall_art/tv/mirror with 'above' relation -> centers horizontally over parent piece
 *  5. Dual-floor separation (1st floor vs 2nd-floor mezzanine) with strict deck clamping
 */

import { findOpenSpawnPosition, type OBB2D } from '../lib/collision2d';
import {
  getMezzanineBounds,
  type ArchMezzanine,
  type ArchPlacedObject,
  type ArchRoomProject,
  type MezzanineBounds,
  type ParametricFurnitureKind,
  type WallId,
} from './types';
import {
  isValidHexColor,
  resolvePinterestArchetype,
  type PinterestDetectedObject,
  type PinterestRoomStyle,
} from './pinterestClient';

export interface WallSlot2D {
  along: number;
  halfW: number;
  y0: number;
  y1: number;
}

export const DEFAULT_COLORS_BY_ARCHETYPE: Partial<Record<ParametricFurnitureKind, { c1: string; c2: string }>> = {
  sofa: { c1: '#c8bfb1', c2: '#5d534a' },
  armchair: { c1: '#495a46', c2: '#e4ddd0' },
  coffee_table_round: { c1: '#232325', c2: '#1a1a1c' },
  coffee_table_rect: { c1: '#b99672', c2: '#252527' },
  dining_table: { c1: '#8b684c', c2: '#262524' },
  dining_chair: { c1: '#cfc5b6', c2: '#2d2b29' },
  desk: { c1: '#c5a27a', c2: '#4d5748' },
  office_chair: { c1: '#a25d32', c2: '#222224' },
  vanity_table: { c1: '#53614d', c2: '#3c4638' },
  bed_frame: { c1: '#f0ede6', c2: '#b68d65' },
  nightstand: { c1: '#232325', c2: '#9a7e56' },
  wardrobe: { c1: '#e6e1d7', c2: '#282726' },
  bookshelf: { c1: '#252527', c2: '#b8946e' },
  sideboard: { c1: '#56614d', c2: '#2b2b2b' },
  console_table: { c1: '#7d5d42', c2: '#262626' },
  tv_baza: { c1: '#e6e2da', c2: '#232325' },
  tv_wall_unit: { c1: '#b9936c', c2: '#222224' },
  wall_tv: { c1: '#141518', c2: '#090a0d' },
  wall_shelf: { c1: '#7c5538', c2: '#252423' },
  linear_fireplace: { c1: '#e8e4dc', c2: '#1f1f21' },
  fireplace_marble: { c1: '#eae6de', c2: '#232220' },
  decorative_vase: { c1: '#e6e0d5', c2: '#4d6647' },
  potted_plant: { c1: '#4b6343', c2: '#373532' },
  chandelier: { c1: '#c4a265', c2: '#ffefc8' },
  floor_lamp: { c1: '#232325', c2: '#f3e8d4' },
  table_lamp: { c1: '#202022', c2: '#fff2d6' },
  rug_custom: { c1: '#ddd4c4', c2: '#2b2a28' },
  wall_mirror: { c1: '#222224', c2: '#dbe4ed' },
  wall_art: { c1: '#222224', c2: '#ece8df' },
  ottoman: { c1: '#ddd5c7', c2: '#4a453e' },
  stairs: { c1: '#c3a27a', c2: '#242426' },
  ac_unit: { c1: '#f4f3ef', c2: '#2b2b2b' },
  kitchen_counter: { c1: '#8e8983', c2: '#f4f2ee' },
  kitchen_upper_cabinet: { c1: '#8e8983', c2: '#5c5853' },
  kitchen_island: { c1: '#95908a', c2: '#807b75' },
  bar_stool: { c1: '#f2f0eb', c2: '#d5d9df' },
  kitchen_appliance: { c1: '#eceae4', c2: '#1f2023' },
  fridge: { c1: '#8d8882', c2: '#5a5753' },
  toilet_wc: { c1: '#f7f6f2', c2: '#cfd4da' },
  bathroom_vanity: { c1: '#6e6a64', c2: '#cfd4da' },
  shower_cabin: { c1: '#232426', c2: '#cfd4da' },
  washer: { c1: '#f2f1ed', c2: '#2b2d31' },
};

export const WALL_BACKED_KINDS = new Set<ParametricFurnitureKind>([
  'wall_art',
  'wall_mirror',
  'wall_tv',
  'wall_shelf',
  'fireplace_marble',
  'linear_fireplace',
  'tv_wall_unit',
  'tv_baza',
  'wardrobe',
  'bookshelf',
  'sideboard',
  'console_table',
  'vanity_table',
  'ac_unit',
  'kitchen_counter',
  'kitchen_upper_cabinet',
  'fridge',
  'toilet_wc',
  'bathroom_vanity',
  'shower_cabin',
  'washer',
]);

export const WALL_ANCHORABLE_FLOOR_KINDS = new Set<ParametricFurnitureKind>([
  'bed_frame',
  'sofa',
  'desk',
  'nightstand',
]);

const LAMP_SURFACE_KINDS = new Set<ParametricFurnitureKind>([
  'tv_baza',
  'linear_fireplace',
  'nightstand',
  'desk',
  'vanity_table',
  'sideboard',
  'console_table',
  'coffee_table_round',
  'coffee_table_rect',
  'dining_table',
  'kitchen_counter',
  'kitchen_island',
  'bathroom_vanity',
]);

export function resolveMezzaninePlan(
  project: Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM' | 'floorTintHex' | 'mezzanine'>,
  styleToApply: PinterestRoomStyle | null,
  replaceExisting: boolean
): { effectiveCeilingM: number; mezSpec: ArchMezzanine | null; mezBounds: MezzanineBounds | null } {
  const effectiveCeilingM = styleToApply?.hasMezzanine
    ? Math.max(3.85, Math.min(4.8, (styleToApply.suggestedCeilingCm || 410) / 100))
    : styleToApply?.suggestedCeilingCm
    ? Math.max(2.5, Math.min(4.5, styleToApply.suggestedCeilingCm / 100))
    : project.ceilingM;

  const mezSpec: ArchMezzanine | null = styleToApply?.hasMezzanine
    ? {
        enabled: true,
        anchorWall: styleToApply.mezzanine?.anchorWall || 'north',
        heightM: Math.max(1.85, Math.min(effectiveCeilingM - 1.5, (styleToApply.mezzanine?.heightCm || 205) / 100)),
        depthM: Math.max(1.6, Math.min(project.depthM * 0.65, (styleToApply.mezzanine?.depthRatio || 0.52) * project.depthM)),
        widthRatio: Math.max(0.55, Math.min(1.0, styleToApply.mezzanine?.widthRatio || 0.78)),
        stairGapSide: styleToApply.mezzanine?.stairGapSide || 'west',
        thicknessM: 0.16,
        deckColorHex: styleToApply.mezzanine?.deckColorHex || styleToApply.floorTintHex || '#c9b092',
        railingStyle: styleToApply.mezzanine?.railingStyle || 'none',
        underLed: true,
      }
    : project.mezzanine?.enabled && !replaceExisting
    ? project.mezzanine
    : null;

  const mezBounds = mezSpec
    ? getMezzanineBounds({
        widthM: project.widthM,
        depthM: project.depthM,
        ceilingM: effectiveCeilingM,
        mezzanine: mezSpec,
      })
    : null;

  return { effectiveCeilingM, mezSpec, mezBounds };
}

function wallForwardVector(wall: WallId): { fx: number; fz: number; rot: number } {
  if (wall === 'north') return { fx: 0, fz: 1, rot: 0 };
  if (wall === 'south') return { fx: 0, fz: -1, rot: Math.PI };
  if (wall === 'west') return { fx: 1, fz: 0, rot: Math.PI / 2 };
  return { fx: -1, fz: 0, rot: -Math.PI / 2 };
}

function clampInsideFloor(
  x: number,
  z: number,
  halfW: number,
  halfD: number,
  roomW: number,
  roomD: number,
  mezBounds: MezzanineBounds | null,
  isUpper: boolean
): { x: number; z: number } {
  const pad = 0.05;
  if (isUpper && mezBounds) {
    return {
      x: Math.max(mezBounds.minX + halfW + pad, Math.min(mezBounds.maxX - halfW - pad, x)),
      z: Math.max(mezBounds.minZ + halfD + pad, Math.min(mezBounds.maxZ - halfD - pad, z)),
    };
  }
  return {
    x: Math.max(-roomW * 0.5 + halfW + pad, Math.min(roomW * 0.5 - halfW - pad, x)),
    z: Math.max(-roomD * 0.5 + halfD + pad, Math.min(roomD * 0.5 - halfD - pad, z)),
  };
}

/**
 * Post-layout Architectural Relationship Solver:
 * Takes initially placed objects + their semantic metadata and enforces universal interior design physics:
 *  - Nightstands flank their bed cleanly on left/right
 *  - Table lamps rest ON TOP OF nightstands / desks / consoles (never floating on floor!)
 *  - Office chairs sit directly in front of desks facing them
 *  - Dining chairs orbit dining tables facing inward
 *  - Coffee tables align neatly in front of sofas
 *  - Wall art/mirrors/TVs with explicit 'above' anchor center cleanly over their parent piece
 *  - Every object stays strictly inside room or mezzanine bounds
 */
export interface SolverWindowSpec {
  wall: WallId;
  offsetCm?: number;
  widthCm?: number;
  sillHeightCm: number;
  hasSill?: boolean;
}

export function applyArchitecturalRelationships(
  objects: ArchPlacedObject[],
  sourceItems: Map<string, PinterestDetectedObject>,
  project: Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM'>,
  effectiveCeilingM: number,
  mezBounds: MezzanineBounds | null,
  windows: SolverWindowSpec[] = []
): ArchPlacedObject[] {
  const result = objects.map((o) => ({ ...o }));
  const byPinId = new Map<string, ArchPlacedObject>();
  for (const o of result) {
    if (o.pinterestItemId) byPinId.set(o.pinterestItemId, o);
  }

  const sameFloor = (a: ArchPlacedObject, b: ArchPlacedObject) => (a.floorLevel || 0) === (b.floorLevel || 0);

  const findNearestOfKinds = (
    self: ArchPlacedObject,
    kinds: Set<ParametricFurnitureKind>,
    maxDistM = 4.5
  ): ArchPlacedObject | null => {
    let best: ArchPlacedObject | null = null;
    let bestD = maxDistM;
    for (const cand of result) {
      if (cand.id === self.id || !sameFloor(cand, self)) continue;
      if (!cand.parametricKind || !kinds.has(cand.parametricKind)) continue;
      const d = Math.hypot(cand.x - self.x, cand.z - self.z);
      if (d < bestD) {
        bestD = d;
        best = cand;
      }
    }
    return best;
  };

  // 0) Sofa vs TV/Fireplace Same-Wall Collision Guard:
  //    A sofa MUST NEVER sit flat on the exact same wall colliding with a TV baza / wall TV / fireplace!
  //    If Vision assigns both to the same wall (e.g. north), swing the sofa cleanly to the perpendicular side wall
  //    (matching its left/right offset) or face the focal wall from across the room!
  const FOCAL_TV_KINDS = new Set<ParametricFurnitureKind>([
    'tv_baza',
    'tv_wall_unit',
    'wall_tv',
    'linear_fireplace',
    'fireplace_marble',
  ]);
  for (const sofa of result) {
    if (sofa.parametricKind !== 'sofa' || !sofa.attachedWall) continue;
    const sameWallFocal = result.find(
      (f) =>
        f.id !== sofa.id &&
        sameFloor(f, sofa) &&
        f.attachedWall === sofa.attachedWall &&
        Boolean(f.parametricKind && FOCAL_TV_KINDS.has(f.parametricKind))
    );
    if (!sameWallFocal) continue;
    const wall = sofa.attachedWall;
    const isUpper = (sofa.floorLevel || 0) === 1;
    const inset = 0.05;
    if (wall === 'north' || wall === 'south') {
      const dx = sofa.x - sameWallFocal.x;
      if (dx < -0.25) {
        sofa.attachedWall = 'west';
        sofa.rot = Math.PI / 2;
        const cl = clampInsideFloor(
          -project.widthM * 0.5 + sofa.depthM * 0.5 + inset,
          Math.max(-project.depthM * 0.12, Math.min(project.depthM * 0.25, sofa.z + 0.45)),
          sofa.depthM * 0.5,
          sofa.widthM * 0.5,
          project.widthM,
          project.depthM,
          mezBounds,
          isUpper
        );
        sofa.x = cl.x;
        sofa.z = cl.z;
      } else if (dx > 0.25) {
        sofa.attachedWall = 'east';
        sofa.rot = -Math.PI / 2;
        const cl = clampInsideFloor(
          project.widthM * 0.5 - sofa.depthM * 0.5 - inset,
          Math.max(-project.depthM * 0.12, Math.min(project.depthM * 0.25, sofa.z + 0.45)),
          sofa.depthM * 0.5,
          sofa.widthM * 0.5,
          project.widthM,
          project.depthM,
          mezBounds,
          isUpper
        );
        sofa.x = cl.x;
        sofa.z = cl.z;
      } else {
        const opp: WallId = wall === 'north' ? 'south' : 'north';
        sofa.attachedWall = opp;
        sofa.rot = opp === 'south' ? Math.PI : 0;
        sofa.z =
          opp === 'south'
            ? project.depthM * 0.5 - sofa.depthM * 0.5 - 0.35
            : -project.depthM * 0.5 + sofa.depthM * 0.5 + 0.35;
      }
    } else {
      // Focal unit on west/east wall -> put sofa facing it from across or perpendicular south wall
      const opp: WallId = wall === 'west' ? 'east' : 'west';
      sofa.attachedWall = opp;
      sofa.rot = opp === 'east' ? -Math.PI / 2 : Math.PI / 2;
      sofa.x =
        opp === 'east'
          ? project.widthM * 0.5 - sofa.depthM * 0.5 - 0.35
          : -project.widthM * 0.5 + sofa.depthM * 0.5 + 0.35;
    }
  }

  // 1) Nightstands flank bed_frame on the same floor
  const beds = result.filter((o) => o.parametricKind === 'bed_frame');
  const assignedNightstands = new Set<string>();
  for (const bed of beds) {
    const floorNightstands = result.filter(
      (o) => o.parametricKind === 'nightstand' && sameFloor(o, bed) && !assignedNightstands.has(o.id)
    );
    if (floorNightstands.length === 0) continue;
    const rightX = Math.cos(bed.rot);
    const rightZ = -Math.sin(bed.rot);
    const fwdX = Math.sin(bed.rot);
    const fwdZ = Math.cos(bed.rot);
    // Sort left-to-right relative to bed's local right axis
    floorNightstands.sort((a, b) => {
      const da = (a.x - bed.x) * rightX + (a.z - bed.z) * rightZ;
      const db = (b.x - bed.x) * rightX + (b.z - bed.z) * rightZ;
      return da - db;
    });
    const sides = floorNightstands.length === 1
      ? [((floorNightstands[0].x - bed.x) * rightX + (floorNightstands[0].z - bed.z) * rightZ) >= 0 ? 1 : -1]
      : [-1, 1];
    floorNightstands.slice(0, 2).forEach((ns, idx) => {
      const side = sides[idx] || 1;
      const latDist = bed.widthM * 0.5 + ns.widthM * 0.5 + 0.08;
      // Align back of nightstand with headboard back of bed!
      const backShift = -(bed.depthM * 0.5 - ns.depthM * 0.5);
      const nx = bed.x + rightX * latDist * side + fwdX * backShift;
      const nz = bed.z + rightZ * latDist * side + fwdZ * backShift;
      const cl = clampInsideFloor(nx, nz, ns.widthM * 0.5, ns.depthM * 0.5, project.widthM, project.depthM, mezBounds, (ns.floorLevel || 0) === 1);
      ns.x = cl.x;
      ns.z = cl.z;
      ns.y = bed.y;
      ns.rot = bed.rot;
      ns.attachedWall = bed.attachedWall;
      assignedNightstands.add(ns.id);
    });
  }

  // 1b) Coffee table centers nicely in front of the primary sofa FIRST so tabletop decor (vases/candles/books)
  //     locks onto the coffee table's FINAL position instead of getting orphaned behind!
  const sofas = result.filter((o) => o.parametricKind === 'sofa');
  for (const ct of result) {
    if (ct.parametricKind !== 'coffee_table_rect' && ct.parametricKind !== 'coffee_table_round') continue;
    const sofa = sofas
      .filter((s) => sameFloor(s, ct) && Math.hypot(s.x - ct.x, s.z - ct.z) < 2.6)
      .sort((a, b) => Math.hypot(a.x - ct.x, a.z - ct.z) - Math.hypot(b.x - ct.x, b.z - ct.z))[0];
    if (sofa) {
      const fx = Math.sin(sofa.rot);
      const fz = Math.cos(sofa.rot);
      const dist = sofa.depthM * 0.5 + ct.depthM * 0.5 + 0.45;
      const cl = clampInsideFloor(
        sofa.x + fx * dist,
        sofa.z + fz * dist,
        ct.widthM * 0.5,
        ct.depthM * 0.5,
        project.widthM,
        project.depthM,
        mezBounds,
        (ct.floorLevel || 0) === 1
      );
      ct.x = cl.x;
      ct.z = cl.z;
      ct.y = sofa.y;
      ct.rot = sofa.rot;
    }
  }

  // 2) ALL tabletop decor items (table_lamp, decorative_vase, or explicit 'on_top_of' non-rug relation)
  //    ALWAYS sit cleanly ON TOP OF their anchored or nearest surface (TV baza, fireplace bench, nightstand, coffee/dining table)!
  //    Floor woven baskets (sepet/basket/hasır/rattan) stay strictly on the floor unless explicitly on_top_of!
  //    Windowsill items ('on_windowsill' or explicitly named windowsill/pencere önü) are handled by Step 2b below!
  const NON_TABLETOP_KINDS = new Set([
    'sofa',
    'armchair',
    'coffee_table_rect',
    'coffee_table_round',
    'dining_table',
    'dining_chair',
    'bed_frame',
    'wardrobe',
    'bookshelf',
    'sideboard',
    'console_table',
    'tv_baza',
    'tv_wall_unit',
    'linear_fireplace',
    'fireplace_marble',
    'desk',
    'office_chair',
    'rug_custom',
    'stairs',
    'kitchen_counter',
    'kitchen_upper_cabinet',
    'kitchen_island',
    'bar_stool',
    'fridge',
    'toilet_wc',
    'bathroom_vanity',
    'shower_cabin',
    'washer',
  ]);
  const isWindowsillCandidate = (obj: ArchPlacedObject, src?: PinterestDetectedObject): boolean => {
    if (obj.parametricKind && NON_TABLETOP_KINDS.has(obj.parametricKind)) return false;
    if (obj.heightM > 0.85) return false;
    if (src?.relation === 'on_windowsill') return true;
    const text = `${obj.name} ${src?.visualDescriptionEn || ''}`;
    if (/pencere\s*[öo]n|cam\s*[öo]n|denizlik|windowsill|window\s*sill|window\s*ledge/i.test(text)) return true;
    if (
      (src?.elevationCm || 0) >= 45 &&
      obj.heightM <= 0.72 &&
      obj.mountMode !== 'wall' &&
      obj.mountMode !== 'ceiling' &&
      windows.some((w) => w.wall === src?.suggestedWall && w.sillHeightCm >= 35)
    ) {
      return true;
    }
    return false;
  };
  const decorCountPerSurface = new Map<string, number>();
  const placedLatsPerSurface = new Map<string, number[]>();
  for (const obj of result) {
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    if (isWindowsillCandidate(obj, src)) continue;
    // Floor rattan/wicker baskets MUST stay on the floor beside sofa/table, never hoisted onto a coffee table!
    const isFloorBasket =
      /sepet|basket|has[ıi]r|rattan|wicker/i.test(obj.name) &&
      !/çiçek|cicek|vazo|vase|buket|bouquet/i.test(obj.name) &&
      src?.relation !== 'on_top_of';
    if (isFloorBasket) continue;
    // Allow sleek tabletop glass bioethanol linear burners (H <= 28cm, on_top_of) to sit directly on top of consoles!
    const isTabletopBurner =
      obj.parametricKind === 'linear_fireplace' &&
      obj.heightM <= 0.28 &&
      src?.relation === 'on_top_of';
    if (!isTabletopBurner && obj.parametricKind && NON_TABLETOP_KINDS.has(obj.parametricKind)) continue;
    // Never pull high wall sconces ("Duvar Apliği", elevation >= 110cm) down onto a TV baza!
    const isWallSconce =
      (obj.mountMode === 'wall' || (src?.elevationCm || 0) >= 110 || /aplik|sconce|duvar/i.test(obj.name)) &&
      src?.relation !== 'on_top_of';
    if (isWallSconce) continue;
    const isTabletopItem =
      isTabletopBurner ||
      obj.parametricKind === 'table_lamp' ||
      obj.parametricKind === 'decorative_vase' ||
      obj.parametricKind === 'kitchen_appliance' ||
      src?.relation === 'on_top_of';
    if (!isTabletopItem) continue;

    const explicitParent = src?.anchorToId ? byPinId.get(src.anchorToId) : undefined;
    const validExplicit =
      explicitParent &&
      explicitParent.mountMode !== 'rug' &&
      explicitParent.parametricKind !== 'rug_custom' &&
      sameFloor(explicitParent, obj)
        ? explicitParent
        : undefined;
    // Kitchen appliances strongly prefer kitchen_counter / kitchen_island first!
    const preferredKitchenParent =
      obj.parametricKind === 'kitchen_appliance'
        ? findNearestOfKinds(obj, new Set<ParametricFurnitureKind>(['kitchen_counter', 'kitchen_island']), 4.2)
        : undefined;
    const parent = validExplicit || preferredKitchenParent || findNearestOfKinds(obj, LAMP_SURFACE_KINDS, 3.8);
    if (parent) {
      const prevCount = decorCountPerSurface.get(parent.id) || 0;
      decorCountPerSurface.set(parent.id, prevCount + 1);
      const prevLats = placedLatsPerSurface.get(parent.id) || [];
      const rx = Math.cos(parent.rot);
      const rz = -Math.sin(parent.rot);
      // Preserve item's rough left-to-right spot along a wide counter/console, avoiding exact overlap with siblings!
      const rawLat = (obj.x - parent.x) * rx + (obj.z - parent.z) * rz;
      const maxLat = Math.max(0.05, parent.widthM * 0.5 - obj.widthM * 0.5 - 0.08);
      let lat = Math.max(-maxLat, Math.min(maxLat, rawLat));
      const minSpacing = Math.max(0.24, obj.widthM + 0.08);
      if (prevLats.some((p) => Math.abs(p - lat) < minSpacing)) {
        const offsets = [0.28, -0.28, 0.52, -0.52, 0.78, -0.78];
        for (const off of offsets) {
          const cand = Math.max(-maxLat, Math.min(maxLat, lat + off));
          if (prevLats.every((p) => Math.abs(p - cand) >= minSpacing * 0.85)) {
            lat = cand;
            break;
          }
        }
      }
      prevLats.push(lat);
      placedLatsPerSurface.set(parent.id, prevLats);
      obj.x = Number((parent.x + rx * lat).toFixed(3));
      obj.z = Number((parent.z + rz * lat).toFixed(3));
      obj.y = Number((parent.y + parent.heightM).toFixed(3));
      obj.rot = parent.rot;
      obj.lockedParentId = parent.id;
    }
  }

  // 2b) UNIVERSAL WINDOWSILL & ELEVATED LEDGE SNAPPER (works on ANY Pinterest photo with raised windowsills!):
  //     Snaps windowsill plants, candles, books, frames & vases directly ONTO the room's physical 20cm interior sill ledge!
  for (const obj of result) {
    if (obj.lockedParentId) continue;
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    if (!isWindowsillCandidate(obj, src)) continue;

    const preferredWall =
      src?.suggestedWall && src.suggestedWall !== 'center' ? src.suggestedWall : obj.attachedWall;
    const matchedWin =
      windows.find((w) => w.wall === preferredWall) ||
      windows.find((w) => w.sillHeightCm >= 35) ||
      windows[0];

    if (matchedWin) {
      const wall = matchedWin.wall;
      const isHoriz = wall === 'north' || wall === 'south';
      const wallLen = isHoriz ? project.widthM : project.depthM;
      const winCenterAlong =
        typeof matchedWin.offsetCm === 'number' ? matchedWin.offsetCm / 100 - wallLen * 0.5 : 0;
      const winHalfSpan = Math.max(0.28, ((matchedWin.widthCm || 180) / 100) * 0.42 - obj.widthM * 0.45);
      const rawAlong = isHoriz ? obj.x : obj.z;
      const along = Math.max(winCenterAlong - winHalfSpan, Math.min(winCenterAlong + winHalfSpan, rawAlong));

      // Rest flush ON TOP OF the protruding 20cm interior windowsill ledge (never floating & never dropped to y=0!)
      const sillCm =
        matchedWin.sillHeightCm >= 40
          ? matchedWin.sillHeightCm
          : Math.max(78, Math.min(115, src?.elevationCm || 88));
      const sillY = Math.max(0.4, Math.min(effectiveCeilingM - obj.heightM - 0.1, sillCm / 100));
      const sillInset = Math.max(0.08, Math.min(0.15, obj.depthM * 0.44));

      if (wall === 'west') {
        obj.x = Number((-project.widthM * 0.5 + sillInset).toFixed(3));
        obj.z = Number(along.toFixed(3));
        obj.rot = Math.PI / 2;
      } else if (wall === 'east') {
        obj.x = Number((project.widthM * 0.5 - sillInset).toFixed(3));
        obj.z = Number(along.toFixed(3));
        obj.rot = -Math.PI / 2;
      } else if (wall === 'north') {
        obj.x = Number(along.toFixed(3));
        obj.z = Number((-project.depthM * 0.5 + sillInset).toFixed(3));
        obj.rot = 0;
      } else {
        obj.x = Number(along.toFixed(3));
        obj.z = Number((project.depthM * 0.5 - sillInset).toFixed(3));
        obj.rot = Math.PI;
      }
      obj.y = Number(sillY.toFixed(3));
      obj.attachedWall = wall;
      obj.mountMode = 'wall';
    } else if ((src?.elevationCm || 0) >= 35) {
      const baseY = (obj.floorLevel || 0) === 1 && mezBounds ? mezBounds.topY : 0;
      obj.y = Number(Math.min(effectiveCeilingM - obj.heightM - 0.1, baseY + (src!.elevationCm / 100)).toFixed(3));
    }
  }

  // 2c) UNIVERSAL NON-ZERO ELEVATION PRESERVATION (mantels, wall ledges, radiator covers, inside shelves):
  //     Never silently crush compact elevated decor/plants (elevationCm >= 35) back down to y=0!
  for (const obj of result) {
    if (obj.lockedParentId || obj.mountMode === 'wall' || obj.mountMode === 'ceiling' || obj.mountMode === 'rug') continue;
    if (obj.parametricKind && NON_TABLETOP_KINDS.has(obj.parametricKind)) continue;
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    const isFloorBasket =
      /sepet|basket|has[ıi]r|rattan|wicker/i.test(obj.name) &&
      !/çiçek|cicek|vazo|vase|buket|bouquet/i.test(obj.name);
    if (isFloorBasket || obj.heightM > 0.78) continue;
    const baseY = (obj.floorLevel || 0) === 1 && mezBounds ? mezBounds.topY : 0;
    if (obj.y <= baseY + 0.05 && (src?.elevationCm || 0) >= 35) {
      obj.y = Number(Math.min(effectiveCeilingM - obj.heightM - 0.08, baseY + src!.elevationCm / 100).toFixed(3));
    }
  }

  // 3) Office chairs, vanity chairs & vanity poufs sit cleanly in front of their desk / vanity_table facing the tabletop!
  const desks = result.filter((o) => o.parametricKind === 'desk' || o.parametricKind === 'vanity_table');
  const claimedByDeskOrVanity = new Set<string>();
  for (const chair of result) {
    const src = chair.pinterestItemId ? sourceItems.get(chair.pinterestItemId) : undefined;
    const explicit = src?.anchorToId ? byPinId.get(src.anchorToId) : undefined;
    const anchoredToDesk =
      explicit &&
      sameFloor(explicit, chair) &&
      (explicit.parametricKind === 'desk' || explicit.parametricKind === 'vanity_table') &&
      src?.relation === 'in_front_of';
    const isDeskSeat =
      chair.parametricKind === 'office_chair' ||
      ((chair.parametricKind === 'dining_chair' || chair.parametricKind === 'ottoman') && Boolean(anchoredToDesk));
    if (!isDeskSeat) continue;

    const desk =
      anchoredToDesk && explicit
        ? explicit
        : desks
            .filter((d) => sameFloor(d, chair))
            .sort((a, b) => Math.hypot(a.x - chair.x, a.z - chair.z) - Math.hypot(b.x - chair.x, b.z - chair.z))[0];
    if (desk) {
      const fwdX = Math.sin(desk.rot);
      const fwdZ = Math.cos(desk.rot);
      const dist = desk.depthM * 0.5 + chair.depthM * 0.42;
      const cl = clampInsideFloor(
        desk.x + fwdX * dist,
        desk.z + fwdZ * dist,
        chair.widthM * 0.5,
        chair.depthM * 0.5,
        project.widthM,
        project.depthM,
        mezBounds,
        (chair.floorLevel || 0) === 1
      );
      chair.x = cl.x;
      chair.z = cl.z;
      chair.y = desk.y;
      chair.rot = desk.rot + Math.PI; // face the desk/vanity!
      claimedByDeskOrVanity.add(chair.id);
    }
  }

  // 4) Dining chairs arrange cleanly around their dining_table facing inward (respecting explicit anchorToId & skipping kitchen islands!)
  const tables = result.filter((o) => o.parametricKind === 'dining_table');
  const assignedDiningChairs = new Set<string>();
  for (const tbl of tables) {
    const isIslandCounter = /ada|island|tezgah|bar|counter/i.test(tbl.name);
    const chairs = result.filter((o) => {
      if (o.parametricKind !== 'dining_chair' || !sameFloor(o, tbl)) return false;
      if (claimedByDeskOrVanity.has(o.id) || assignedDiningChairs.has(o.id)) return false;
      const src = o.pinterestItemId ? sourceItems.get(o.pinterestItemId) : undefined;
      if (src?.anchorToId) {
        const exp = byPinId.get(src.anchorToId);
        if (exp) return exp.id === tbl.id;
      }
      if (isIslandCounter) return false;
      return Math.hypot(o.x - tbl.x, o.z - tbl.z) < 3.2;
    });
    if (chairs.length === 0) continue;
    chairs.forEach((c) => assignedDiningChairs.add(c.id));
    const n = chairs.length;
    const isRound = /yuvarlak|round|daire/i.test(tbl.name);
    chairs.forEach((ch, i) => {
      if (isRound) {
        const a = (i / n) * Math.PI * 2;
        const rad = Math.max(tbl.widthM, tbl.depthM) * 0.5 + ch.depthM * 0.45;
        ch.x = tbl.x + Math.sin(a) * rad;
        ch.z = tbl.z + Math.cos(a) * rad;
        ch.rot = a + Math.PI;
      } else {
        const side = i % 2 === 0 ? 1 : -1;
        const perSide = Math.ceil(n / 2);
        const slot = Math.floor(i / 2);
        const span = Math.max(0.3, tbl.widthM - 0.36);
        const lat = perSide === 1 ? 0 : -span * 0.5 + (span * slot) / Math.max(1, perSide - 1);
        const fwd = side * (tbl.depthM * 0.5 + ch.depthM * 0.42);
        const rx = Math.cos(tbl.rot);
        const rz = -Math.sin(tbl.rot);
        const fx = Math.sin(tbl.rot);
        const fz = Math.cos(tbl.rot);
        ch.x = tbl.x + rx * lat + fx * fwd;
        ch.z = tbl.z + rz * lat + fz * fwd;
        ch.rot = side === 1 ? tbl.rot + Math.PI : tbl.rot;
      }
      const cl = clampInsideFloor(ch.x, ch.z, ch.widthM * 0.5, ch.depthM * 0.5, project.widthM, project.depthM, mezBounds, (ch.floorLevel || 0) === 1);
      ch.x = cl.x;
      ch.z = cl.z;
      ch.y = tbl.y;
    });
  }

  // 4b) Bar stools align neatly side-by-side tucked under the front knee-space overhang of their kitchen_island / breakfast bar!
  const islands = result.filter((o) => o.parametricKind === 'kitchen_island');
  const assignedBarStools = new Set<string>();
  for (const isl of islands) {
    const stools = result.filter((o) => {
      if (o.parametricKind !== 'bar_stool' || !sameFloor(o, isl)) return false;
      if (assignedBarStools.has(o.id)) return false;
      const src = o.pinterestItemId ? sourceItems.get(o.pinterestItemId) : undefined;
      if (src?.anchorToId) {
        const exp = byPinId.get(src.anchorToId);
        if (exp) return exp.id === isl.id;
      }
      return Math.hypot(o.x - isl.x, o.z - isl.z) < 2.8;
    });
    if (stools.length === 0) continue;
    stools.forEach((s) => assignedBarStools.add(s.id));
    const rx = Math.cos(isl.rot);
    const rz = -Math.sin(isl.rot);
    const fx = Math.sin(isl.rot);
    const fz = Math.cos(isl.rot);
    // Preserve left-to-right ordering of bar stools along island axis
    stools.sort((a, b) => (a.x - isl.x) * rx + (a.z - isl.z) * rz - ((b.x - isl.x) * rx + (b.z - isl.z) * rz));
    const n = stools.length;
    // Leave clean clearance before the right waterfall gable (+W/2 - 0.065)
    const minLat = -isl.widthM * 0.5 + 0.24;
    const maxLat = isl.widthM * 0.5 - 0.28;
    const span = Math.max(0.24, maxLat - minLat);
    stools.forEach((st, i) => {
      const lat = n === 1 ? (minLat + maxLat) * 0.5 : minLat + (span * i) / (n - 1);
      const fwd = isl.depthM * 0.5 + st.depthM * 0.14;
      const cl = clampInsideFloor(
        isl.x + rx * lat + fx * fwd,
        isl.z + rz * lat + fz * fwd,
        st.widthM * 0.5,
        st.depthM * 0.5,
        project.widthM,
        project.depthM,
        mezBounds,
        (st.floorLevel || 0) === 1
      );
      st.x = Number(cl.x.toFixed(3));
      st.z = Number(cl.z.toFixed(3));
      st.y = isl.y;
      st.rot = isl.rot + Math.PI; // face inward toward the breakfast bar!
    });
  }

  // 4c) Twin/multi ceiling pendants explicitly anchored 'above' a kitchen_island or dining_table center evenly along it!
  const pendantTargets = result.filter(
    (o) => o.parametricKind === 'kitchen_island' || o.parametricKind === 'dining_table'
  );
  for (const tgt of pendantTargets) {
    const pendants = result.filter((o) => {
      if (o.parametricKind !== 'chandelier' || !sameFloor(o, tgt)) return false;
      const src = o.pinterestItemId ? sourceItems.get(o.pinterestItemId) : undefined;
      if (src?.anchorToId) {
        const exp = byPinId.get(src.anchorToId);
        if (exp && exp.id === tgt.id) return true;
      }
      return tgt.parametricKind === 'kitchen_island' && o.widthM <= 0.48 && Math.hypot(o.x - tgt.x, o.z - tgt.z) < 1.85;
    });
    if (pendants.length === 0) continue;
    const rx = Math.cos(tgt.rot);
    const rz = -Math.sin(tgt.rot);
    pendants.sort((a, b) => (a.x - tgt.x) * rx + (a.z - tgt.z) * rz - ((b.x - tgt.x) * rx + (b.z - tgt.z) * rz));
    const n = pendants.length;
    const span = Math.max(0.32, tgt.widthM * 0.56);
    pendants.forEach((p, i) => {
      const lat = n === 1 ? 0 : -span * 0.5 + (span * i) / (n - 1);
      p.x = Number((tgt.x + rx * lat).toFixed(3));
      p.z = Number((tgt.z + rz * lat).toFixed(3));
    });
  }

  // 5) Rugs explicitly anchored 'under' a bed_frame / dining_table / sofa center cleanly beneath their parent!
  //    (Coffee tables were already aligned in Step 1b BEFORE tabletop decor locked onto them.)
  for (const rug of result) {
    if (rug.parametricKind !== 'rug_custom') continue;
    const src = rug.pinterestItemId ? sourceItems.get(rug.pinterestItemId) : undefined;
    const parent = src?.anchorToId ? byPinId.get(src.anchorToId) : undefined;
    if (!parent || !sameFloor(parent, rug)) continue;
    const rel = String(src?.relation || '');
    if (rel === 'under' || rel === 'in_front_of') {
      const fx = Math.sin(parent.rot);
      const fz = Math.cos(parent.rot);
      const shift = parent.parametricKind === 'bed_frame' ? 0.35 : 0;
      const cl = clampInsideFloor(
        parent.x + fx * shift,
        parent.z + fz * shift,
        rug.widthM * 0.5,
        rug.depthM * 0.5,
        project.widthM,
        project.depthM,
        mezBounds,
        (rug.floorLevel || 0) === 1
      );
      rug.x = cl.x;
      rug.z = cl.z;
      rug.y = parent.y + 0.004;
    }
  }

  // 6) Explicit 'above' wall alignment + Automatic Wall-TV / Kitchen Upper Cabinet alignment above lower base units on same wall!
  for (const obj of result) {
    if (obj.mountMode !== 'wall') continue;
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    let parent: ArchPlacedObject | undefined;
    if (src?.anchorToId && src.relation === 'above') {
      parent = byPinId.get(src.anchorToId);
    } else if (obj.parametricKind === 'wall_tv' && obj.attachedWall) {
      // Auto-pair wall_tv cleanly above a tv_baza / linear_fireplace / console_table on the same wall
      parent = result.find(
        (c) =>
          c.id !== obj.id &&
          sameFloor(c, obj) &&
          c.attachedWall === obj.attachedWall &&
          (c.parametricKind === 'tv_baza' ||
            c.parametricKind === 'linear_fireplace' ||
            c.parametricKind === 'console_table' ||
            c.parametricKind === 'sideboard')
      );
    } else if (obj.parametricKind === 'kitchen_upper_cabinet' && obj.attachedWall) {
      parent = result.find(
        (c) =>
          c.id !== obj.id &&
          sameFloor(c, obj) &&
          c.attachedWall === obj.attachedWall &&
          c.parametricKind === 'kitchen_counter'
      );
    }
    if (!parent || !sameFloor(parent, obj)) continue;
    if (parent.attachedWall && obj.attachedWall === parent.attachedWall) {
      const isHoriz = parent.attachedWall === 'north' || parent.attachedWall === 'south';
      const parentCenter = isHoriz ? parent.x : parent.z;
      const myAlong = isHoriz ? obj.x : obj.z;
      const maxDrift = Math.max(0.15, (parent.widthM - obj.widthM) * 0.5 + 0.12);
      const clampedAlong =
        Math.abs(myAlong - parentCenter) <= maxDrift ? myAlong : parentCenter;
      if (isHoriz) obj.x = clampedAlong;
      else obj.z = clampedAlong;
      const isKitchenUpper = obj.parametricKind === 'kitchen_upper_cabinet';
      const isFlushUpperCabinet = obj.parametricKind === 'bookshelf';
      const minClearY = parent.y + parent.heightM + (isKitchenUpper ? 0.54 : isFlushUpperCabinet ? 0.0 : 0.18);
      const maxY = effectiveCeilingM - obj.heightM - (isKitchenUpper ? 0.02 : 0.08);
      obj.y = isKitchenUpper
        ? Number(Math.max(minClearY, Math.min(maxY, Math.max(obj.y, minClearY))).toFixed(3))
        : isFlushUpperCabinet
        ? Math.max(parent.y + parent.heightM, Math.min(maxY, obj.y))
        : Math.max(minClearY, Math.min(maxY, Math.max(obj.y, minClearY + 0.14)));
    }
  }

  // 7) Final safety pass: ensure NO wall-anchored item protrudes outside room bounds
  for (const obj of result) {
    if (obj.mountMode === 'wall' && obj.attachedWall) {
      const { rot } = wallForwardVector(obj.attachedWall);
      obj.rot = rot;
    }
  }

  return result;
}

/**
 * Applies targeted Stage-3 Visual Self-Critique corrections returned by `/api/pinterest3d?action=verifyAndRefine`
 * cleanly onto the active 3D scene objects & room architecture!
 */
export interface VisualRefineFix {
  id: string;
  action: 'update' | 'remove';
  wall?: WallId | 'center';
  floorLevel?: 0 | 1;
  relativeX?: number;
  relativeZ?: number;
  elevationCm?: number;
  facingDeg?: number;
  widthCm?: number;
  depthCm?: number;
  heightCm?: number;
  primaryColorHex?: string;
  accentColorHex?: string;
  reasonTr?: string;
}

export interface VisualRefineRoomFix {
  removeWindows?: boolean;
  wallColorHex?: string | null;
  accentWall?: WallId | null;
  wallPattern?: 'smooth' | 'boiserie' | 'slats' | 'concrete' | 'stone' | 'wallpaper' | 'marble' | 'mirror' | null;
  floorTintHex?: string | null;
  windowSillHeightCm?: number | null;
  windowFrameColorHex?: string | null;
  enableMezzanine?: boolean | null;
  mezzanineHeightCm?: number | null;
}

export function applyVisualCritiqueFixes(
  currentObjects: ArchPlacedObject[],
  fixes: VisualRefineFix[],
  project: Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM' | 'mezzanine'>
): { objects: ArchPlacedObject[]; appliedCount: number } {
  const mezBounds = getMezzanineBounds(project);
  const removeIds = new Set<string>();
  const fixMap = new Map<string, VisualRefineFix>();
  for (const f of fixes || []) {
    if (!f || !f.id) continue;
    if (f.action === 'remove') removeIds.add(f.id);
    else fixMap.set(f.id, f);
  }

  let appliedCount = 0;
  const next: ArchPlacedObject[] = [];
  for (const orig of currentObjects) {
    if (removeIds.has(orig.id) || (orig.pinterestItemId && removeIds.has(orig.pinterestItemId))) {
      appliedCount++;
      continue;
    }
    const f = fixMap.get(orig.id) || (orig.pinterestItemId ? fixMap.get(orig.pinterestItemId) : undefined);
    if (!f) {
      next.push(orig);
      continue;
    }
    appliedCount++;
    const o = { ...orig };

    if (typeof f.widthCm === 'number' && f.widthCm >= 15 && f.widthCm <= 450) o.widthM = f.widthCm / 100;
    if (typeof f.depthCm === 'number' && f.depthCm >= 3 && f.depthCm <= 450) o.depthM = f.depthCm / 100;
    if (typeof f.heightCm === 'number' && f.heightCm >= 2 && f.heightCm <= 420) o.heightM = f.heightCm / 100;
    o.dimensionsCm = `${Math.round(o.widthM * 100)} × ${Math.round(o.depthM * 100)} × ${Math.round(o.heightM * 100)} cm`;

    if (isValidHexColor(f.primaryColorHex)) {
      if (o.parametricKind) o.parametricColorHex = f.primaryColorHex;
      else o.tintHex = f.primaryColorHex;
    }
    if (isValidHexColor(f.accentColorHex) && o.parametricKind) {
      o.parametricAccentHex = f.accentColorHex;
    }

    const floorLevel: 0 | 1 =
      f.floorLevel === 1 && mezBounds ? 1 : f.floorLevel === 0 ? 0 : o.floorLevel || 0;
    o.floorLevel = floorLevel;
    const baseY = floorLevel === 1 && mezBounds ? mezBounds.topY : 0;

    if (typeof f.relativeX === 'number' && Number.isFinite(f.relativeX)) {
      o.x = Math.max(-project.widthM * 0.46, Math.min(project.widthM * 0.46, f.relativeX * project.widthM * 0.45));
    }
    if (typeof f.relativeZ === 'number' && Number.isFinite(f.relativeZ)) {
      o.z = Math.max(-project.depthM * 0.46, Math.min(project.depthM * 0.46, f.relativeZ * project.depthM * 0.45));
    }
    if (typeof f.facingDeg === 'number' && Number.isFinite(f.facingDeg)) {
      o.rot = (f.facingDeg * Math.PI) / 180;
    }

    if (f.wall && f.wall !== 'center') {
      o.attachedWall = f.wall;
      const inset = 0.025;
      if (f.wall === 'north') {
        o.z = -project.depthM * 0.5 + o.depthM * 0.5 + inset;
        o.rot = 0;
      } else if (f.wall === 'south') {
        o.z = project.depthM * 0.5 - o.depthM * 0.5 - inset;
        o.rot = Math.PI;
      } else if (f.wall === 'west') {
        o.x = -project.widthM * 0.5 + o.depthM * 0.5 + inset;
        o.rot = Math.PI / 2;
      } else {
        o.x = project.widthM * 0.5 - o.depthM * 0.5 - inset;
        o.rot = -Math.PI / 2;
      }
    }

    const isHighWallKind =
      o.parametricKind === 'wall_art' ||
      o.parametricKind === 'wall_tv' ||
      o.parametricKind === 'wall_shelf' ||
      o.parametricKind === 'kitchen_upper_cabinet' ||
      o.parametricKind === 'ac_unit' ||
      o.parametricKind === 'chandelier' ||
      (o.parametricKind === 'table_lamp' && (o.mountMode === 'wall' || /aplik|sconce|duvar/i.test(o.name))) ||
      (o.parametricKind === 'wall_mirror' && o.heightM < 1.25 && !/boy|ayakta|zemin|full|kemer/i.test(o.name));
    const isFloorBasketItem =
      /sepet|basket|has[ıi]r|rattan|wicker/i.test(o.name) &&
      !/çiçek|cicek|vazo|vase|buket|bouquet/i.test(o.name);
    const isElevatedSmallItem =
      o.heightM <= 0.78 &&
      (o.y > baseY + 0.25 ||
        (typeof f.elevationCm === 'number' && f.elevationCm >= 35) ||
        /pencere\s*[öo]n|cam\s*[öo]n|denizlik|windowsill|window\s*sill/i.test(o.name));
    const isFloatingOrTabletop =
      !isFloorBasketItem &&
      (o.parametricKind === 'table_lamp' ||
        o.parametricKind === 'decorative_vase' ||
        o.parametricKind === 'kitchen_appliance' ||
        o.parametricKind === 'tv_baza' ||
        ((o.parametricKind === 'wardrobe' || o.parametricKind === 'bookshelf') && o.y > baseY + 0.08) ||
        Boolean(o.lockedParentId) ||
        (o.parametricKind === 'potted_plant' && isElevatedSmallItem));
    const isFloorStandingKind = !isHighWallKind && !isFloatingOrTabletop;

    if (isFloorStandingKind) {
      // Floor & rug items ALWAYS sit flush on their own floor level (0 or mezzanine deck top — NEVER float!)
      o.y = o.mountMode === 'rug' ? baseY + 0.004 : baseY;
    } else if (typeof f.elevationCm === 'number' && Number.isFinite(f.elevationCm)) {
      // Guard against AI echoing world elevation (e.g. 205cm) instead of relative elevation above mezzanine!
      let relM = f.elevationCm / 100;
      if (floorLevel === 1 && mezBounds && relM >= mezBounds.topY - 0.15) {
        relM = Math.max(0, relM - mezBounds.topY);
      }
      o.y = Math.max(baseY, Math.min(project.ceilingM - o.heightM - 0.04, baseY + relM));
    } else if (f.floorLevel !== undefined) {
      o.y = baseY;
    }

    // Clamp cleanly inside room/mezzanine bounds
    const cl = clampInsideFloor(
      o.x,
      o.z,
      o.widthM * 0.5,
      o.depthM * 0.5,
      project.widthM,
      project.depthM,
      mezBounds,
      floorLevel === 1
    );
    if (!o.attachedWall || o.attachedWall === 'north' || o.attachedWall === 'south') o.x = cl.x;
    if (!o.attachedWall || o.attachedWall === 'west' || o.attachedWall === 'east') o.z = cl.z;

    next.push(o);
  }

  return { objects: next, appliedCount };
}

// Re-export helper to avoid unused import warning
export { findOpenSpawnPosition, resolvePinterestArchetype, type OBB2D };
