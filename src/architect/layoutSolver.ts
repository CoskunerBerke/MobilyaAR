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
  tv_wall_unit: { c1: '#b9936c', c2: '#222224' },
  wall_tv: { c1: '#141518', c2: '#090a0d' },
  fireplace_marble: { c1: '#eae6de', c2: '#232220' },
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
};

export const WALL_BACKED_KINDS = new Set<ParametricFurnitureKind>([
  'wall_art',
  'wall_mirror',
  'wall_tv',
  'fireplace_marble',
  'tv_wall_unit',
  'wardrobe',
  'bookshelf',
  'sideboard',
  'console_table',
  'vanity_table',
  'ac_unit',
]);

export const WALL_ANCHORABLE_FLOOR_KINDS = new Set<ParametricFurnitureKind>([
  'bed_frame',
  'sofa',
  'desk',
  'nightstand',
]);

const LAMP_SURFACE_KINDS = new Set<ParametricFurnitureKind>([
  'nightstand',
  'desk',
  'vanity_table',
  'sideboard',
  'console_table',
  'coffee_table_round',
  'coffee_table_rect',
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
export function applyArchitecturalRelationships(
  objects: ArchPlacedObject[],
  sourceItems: Map<string, PinterestDetectedObject>,
  project: Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM'>,
  effectiveCeilingM: number,
  mezBounds: MezzanineBounds | null
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

  // 2) Table lamps ALWAYS sit ON TOP OF their nearest surface (nightstand, desk, vanity, console, sideboard)
  const lampCountPerSurface = new Map<string, number>();
  for (const obj of result) {
    if (obj.parametricKind !== 'table_lamp') continue;
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    const explicitParent = src?.anchorToId ? byPinId.get(src.anchorToId) : undefined;
    const parent =
      explicitParent && sameFloor(explicitParent, obj)
        ? explicitParent
        : findNearestOfKinds(obj, LAMP_SURFACE_KINDS, 3.8);
    if (parent) {
      const prevCount = lampCountPerSurface.get(parent.id) || 0;
      lampCountPerSurface.set(parent.id, prevCount + 1);
      const sideOffset = prevCount === 0 ? 0 : (prevCount % 2 === 1 ? 1 : -1) * Math.min(parent.widthM * 0.28, 0.35);
      const rx = Math.cos(parent.rot);
      const rz = -Math.sin(parent.rot);
      obj.x = parent.x + rx * sideOffset;
      obj.z = parent.z + rz * sideOffset;
      obj.y = parent.y + parent.heightM;
      obj.rot = parent.rot;
    }
  }

  // 3) Office chairs sit cleanly in front of their desk / vanity_table facing the tabletop!
  const desks = result.filter((o) => o.parametricKind === 'desk' || o.parametricKind === 'vanity_table');
  for (const chair of result) {
    if (chair.parametricKind !== 'office_chair') continue;
    const src = chair.pinterestItemId ? sourceItems.get(chair.pinterestItemId) : undefined;
    const explicit = src?.anchorToId ? byPinId.get(src.anchorToId) : undefined;
    const desk =
      explicit && sameFloor(explicit, chair)
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
      chair.rot = desk.rot + Math.PI; // face the desk!
    }
  }

  // 4) Dining chairs arrange cleanly around dining_table facing inward!
  const tables = result.filter((o) => o.parametricKind === 'dining_table');
  for (const tbl of tables) {
    const chairs = result.filter(
      (o) => o.parametricKind === 'dining_chair' && sameFloor(o, tbl) && Math.hypot(o.x - tbl.x, o.z - tbl.z) < 3.2
    );
    if (chairs.length === 0) continue;
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

  // 5) Coffee table centers nicely in front of the primary sofa if placed in the same seating area
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

  // 6) Explicit 'above' wall alignment (e.g. memo board directly above full-length mirror, TV/art above fireplace/bed/vanity!)
  for (const obj of result) {
    if (obj.mountMode !== 'wall') continue;
    const src = obj.pinterestItemId ? sourceItems.get(obj.pinterestItemId) : undefined;
    if (!src?.anchorToId || src.relation !== 'above') continue;
    const parent = byPinId.get(src.anchorToId);
    if (!parent || !sameFloor(parent, obj)) continue;
    if (parent.attachedWall && obj.attachedWall === parent.attachedWall) {
      const isHoriz = parent.attachedWall === 'north' || parent.attachedWall === 'south';
      if (isHoriz) obj.x = parent.x;
      else obj.z = parent.z;
      const targetY = parent.y + parent.heightM + 0.14;
      const maxY = effectiveCeilingM - obj.heightM - 0.08;
      obj.y = Math.max(parent.y + 0.35, Math.min(maxY, targetY));
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
  floorTintHex?: string | null;
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

    if (typeof f.elevationCm === 'number' && Number.isFinite(f.elevationCm)) {
      o.y = Math.max(0, Math.min(project.ceilingM - o.heightM - 0.04, baseY + f.elevationCm / 100));
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
