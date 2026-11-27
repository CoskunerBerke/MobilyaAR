import * as THREE from 'three';
import { clampToRoomWalls, computeOBBOverlapMTV, getOBBAxes, type OBB2D } from '../lib/collision2d';
import { getHouseBounds, getMezzanineBounds, type ArchPlacedObject, type ArchRoomProject } from './types';

export interface SupportSurfaceHit {
  host: ArchPlacedObject;
  surfaceY: number;
  isInteriorShelf?: boolean;
}

export interface Placement3DResult {
  x: number;
  y: number;
  z: number;
  hitObstacle: boolean;
  support: SupportSurfaceHit | null;
  minAllowedY: number;
  maxAllowedY: number;
  clampedBySupport: boolean;
  clampedInsideParent: boolean;
}

const MAJOR_FLOOR_KINDS = new Set<string>([
  'bed_frame',
  'sofa',
  'armchair',
  'wardrobe',
  'dining_table',
  'dining_chair',
  'office_chair',
  'kitchen_counter',
  'fridge',
  'washer',
  'shower_cabin',
  'toilet_wc',
  'fireplace_marble',
  'linear_fireplace',
  'tv_wall_unit',
  'tv_baza',
  'bookshelf',
  'stairs',
  'nightstand',
  'sideboard',
  'console_table',
  'desk',
  'vanity_table',
  'bathroom_vanity',
  'coffee_table_round',
  'coffee_table_rect',
  'ottoman',
  'floor_lamp',
  'rug_custom',
  'chandelier',
]);

const NON_SUPPORT_KINDS = new Set<string>([
  'rug_custom',
  'chandelier',
  'wall_art',
  'wall_mirror',
  'wall_tv',
  'ac_unit',
  'floor_lamp',
  'potted_plant',
  'decorative_vase',
  'table_lamp',
  'shower_cabin',
  'stairs',
]);

const PLACEABLE_TOP_REGEX =
  /yast[ıi]k|k[ıi]rlent|minder|battaniye|örtü|ortu|pik[e]|nevresim|abajur|masa lamba|gece lamba|lamba|vazo|saks[ıi]|çiçek|cicek|bitki|dekor|obje|kitap|tepsi|mum|saat|kutu|sepet|çerçeve|cerceve|laptop|bilgisayar|monitör|monitor|televizyon|\btv\b|fincan|bardak|tabak|kase|peluş|pelus|oyuncak|hoparlör|hoparlor|duvar raf|raf[ıi]\b|\braf\b|çekmece|cekmece|pillow|cushion|throw|blanket|lamp|vase|plant|decor|book|tray|candle|clock|box|basket|frame|mug|cup|bowl|plush|toy|speaker|\bshelf\b|drawer/i;

const MAJOR_FLOOR_NAME_REGEX =
  /yatak|karyola|baza|kanepe|koltuk|berjer|sandalye|gard[ıi]rop|dolap|yemek masa|çalışma masa|calisma masa|sehpa|komodin|konsol|şifonyer|sifonyer|tezgah|buzdolab|çamaşır|camasir|duşakabin|dusakabin|klozet|şömine|somine|kitapl[ıi]k|merdiven|lambader|hal[ıi]|kilim|puf|bank|\bbed\b|\bsofa\b|\bcouch\b|\bchair\b|\btable\b|\bwardrobe\b|\bcabinet\b|\bdresser\b|\bnightstand\b|\bdesk\b|\brug\b|\bcarpet\b/i;

const BED_REGEX = /yatak|karyola|baza|\bbed\b/i;
const SEAT_REGEX = /kanepe|koltuk|berjer|\bsofa\b|\bcouch\b|\barmchair\b/i;
const OPEN_SHELVING_REGEX =
  /kitapl[ıi]k|raf\s*[üu]nit|vitrin|ni[şs]|tv\s*[üu]nit|dolap\s*[üu]nit|bookshelf|bookcase|shelving|shelf\s*unit|rack|cubby/i;

export function objToOBB2D(o: ArchPlacedObject, x = o.x, z = o.z): OBB2D {
  return {
    id: o.id,
    x,
    z,
    rot: o.rot,
    halfW: Math.max(0.06, o.widthM * 0.5),
    halfD: Math.max(0.04, o.depthM * 0.5),
  };
}

export function isBedObject(o: ArchPlacedObject): boolean {
  if (o.parametricKind === 'bed_frame') return true;
  return BED_REGEX.test(`${o.name} ${o.category}`);
}

export function isSeatObject(o: ArchPlacedObject): boolean {
  if (o.parametricKind === 'sofa' || o.parametricKind === 'armchair') return true;
  return SEAT_REGEX.test(`${o.name} ${o.category}`);
}

/** True for open-compartment shelving units (bookcases, wall shelf units, TV units, display cabinets) that accept interior items/shelves */
export function isOpenShelvingHost(host: ArchPlacedObject): boolean {
  if (host.mountMode === 'rug' || host.mountMode === 'ceiling') return false;
  if (host.heightM < 0.75) return false;
  if (host.parametricKind === 'bookshelf' || host.parametricKind === 'tv_wall_unit') return true;
  return OPEN_SHELVING_REGEX.test(`${host.name} ${host.category}`);
}

/** True if `obj` can cleanly go INSIDE the open compartments/shelves of `host` (e.g. inner shelf plank, book, vase, box, decor) */
export function canFitInsideShelving(obj: ArchPlacedObject, host: ArchPlacedObject): boolean {
  if (obj.id === host.id) return false;
  if (!isOpenShelvingHost(host)) return false;
  if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling') return false;
  if (isBedObject(obj) || isSeatObject(obj)) return false;
  if (obj.parametricKind && MAJOR_FLOOR_KINDS.has(obj.parametricKind)) return false;

  const fitsDims =
    Math.min(obj.widthM, obj.depthM) <= Math.max(host.widthM, host.depthM) * 1.04 &&
    Math.max(obj.widthM, obj.depthM) <= Math.max(host.widthM, host.depthM) * 1.06 &&
    obj.heightM <= host.heightM * 0.62;
  if (!fitsDims) return false;

  if (isPlaceableTopItem(obj)) return true;
  if (obj.heightM <= 0.45 && obj.widthM * obj.depthM <= host.widthM * host.depthM * 1.05) return true;
  return false;
}

/** True if other objects (pillows, lamps, vases, trays, etc.) can rest on top of `host` */
export function isSupportSurfaceHost(host: ArchPlacedObject): boolean {
  if (host.mountMode === 'rug' || host.mountMode === 'ceiling') return false;
  if (host.mountMode === 'wall' && host.depthM < 0.16) return false;
  if (host.parametricKind && NON_SUPPORT_KINDS.has(host.parametricKind)) return false;
  if (host.heightM < 0.15 || host.widthM < 0.24 || host.depthM < 0.20) return false;
  if (PLACEABLE_TOP_REGEX.test(host.name) && Math.max(host.widthM, host.depthM) < 0.55) return false;
  return true;
}

/** True if `obj` is a tabletop / soft-furnishing / shelf / small accessory that can sit on beds, tables, nightstands, or inside shelves */
export function isPlaceableTopItem(obj: ArchPlacedObject): boolean {
  if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling') return false;
  if (
    obj.parametricKind === 'table_lamp' ||
    obj.parametricKind === 'decorative_vase' ||
    obj.parametricKind === 'potted_plant'
  ) {
    return true;
  }
  if (obj.parametricKind && MAJOR_FLOOR_KINDS.has(obj.parametricKind)) return false;

  const text = `${obj.name} ${obj.category}`;
  if (
    PLACEABLE_TOP_REGEX.test(text) &&
    !BED_REGEX.test(text) &&
    !SEAT_REGEX.test(text) &&
    !OPEN_SHELVING_REGEX.test(text)
  ) {
    return true;
  }
  if (MAJOR_FLOOR_NAME_REGEX.test(text)) return false;

  if (obj.mountMode === 'floor' && obj.widthM <= 0.72 && obj.depthM <= 0.72 && obj.heightM <= 0.65) {
    return true;
  }
  return false;
}

/** True if `obj` is allowed to sit ON TOP of `host` */
export function canObjectStackOnHost(obj: ArchPlacedObject, host: ArchPlacedObject, currentY?: number): boolean {
  if (obj.id === host.id) return false;
  if (!isSupportSurfaceHost(host)) return false;
  if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling') return false;

  const objArea = obj.widthM * obj.depthM;
  const hostArea = host.widthM * host.depthM;
  const fitsFootprint =
    Math.min(obj.widthM, obj.depthM) <= Math.max(host.widthM, host.depthM) * 0.96 && objArea <= hostArea * 0.92;
  if (!fitsFootprint) return false;

  if (isPlaceableTopItem(obj)) return true;

  const yNow = currentY ?? obj.y;
  const estTop = estimateSupportSurfaceY(host);
  if (yNow >= Math.max(host.y + 0.16, estTop - 0.18)) return true;

  return false;
}

/** Pure-math estimate of usable support surface height (handles bed mattresses & sofa seats separately from headboards/backrests!) */
export function estimateSupportSurfaceY(host: ArchPlacedObject): number {
  if (isBedObject(host)) {
    if (host.heightM > 0.72) {
      return Number((host.y + Math.min(0.60, Math.max(0.45, host.heightM * 0.50))).toFixed(3));
    }
    return Number((host.y + host.heightM).toFixed(3));
  }
  if (isSeatObject(host)) {
    if (host.heightM > 0.62) {
      return Number((host.y + Math.min(0.48, Math.max(0.36, host.heightM * 0.48))).toFixed(3));
    }
    return Number((host.y + host.heightM).toFixed(3));
  }
  return Number((host.y + host.heightM).toFixed(3));
}

const DOWN_VEC = new THREE.Vector3(0, -1, 0);
const RAY_ORIGIN = new THREE.Vector3();
const DOWN_RAYCASTER = new THREE.Raycaster();

/**
 * Millimeter-accurate top surface sampling using actual mounted Three.js geometry (when available),
 * automatically filtering out headboards/backrests on beds & sofas and falling back to math estimates.
 */
export function sampleSupportSurfaceY(
  host: ArchPlacedObject,
  x: number,
  z: number,
  objHalfW: number,
  objHalfD: number,
  mountedRoot?: THREE.Object3D
): number {
  const mathEst = estimateSupportSurfaceY(host);
  if (!mountedRoot) return mathEst;

  mountedRoot.updateMatrixWorld(true);
  const startY = host.y + host.heightM + 0.35;
  const isBedOrSeat = isBedObject(host) || isSeatObject(host);
  const maxValidHitY =
    isBedOrSeat && host.heightM > 0.72
      ? host.y + Math.min(0.78, host.heightM * 0.76)
      : host.y + host.heightM + 0.04;
  const minValidHitY = host.y + Math.min(0.16, host.heightM * 0.25);

  const sx = Math.min(0.14, objHalfW * 0.45);
  const sz = Math.min(0.14, objHalfD * 0.45);
  const { ux, uz } = getOBBAxes(host.rot);
  const relX = x - host.x;
  const relZ = z - host.z;
  const locX = relX * ux[0] + relZ * ux[1];
  const locZ = relX * uz[0] + relZ * uz[1];
  const clampedLocX = Math.max(-host.widthM * 0.44, Math.min(host.widthM * 0.44, locX));
  const clampedLocZ = Math.max(-host.depthM * 0.44, Math.min(host.depthM * 0.44, locZ));
  const cx = host.x + ux[0] * clampedLocX + uz[0] * clampedLocZ;
  const cz = host.z + ux[1] * clampedLocX + uz[1] * clampedLocZ;

  const samples: Array<[number, number]> = [
    [cx, cz],
    [cx - sx, cz - sz],
    [cx + sx, cz - sz],
    [cx - sx, cz + sz],
    [cx + sx, cz + sz],
  ];

  const validYs: number[] = [];
  for (const [px, pz] of samples) {
    RAY_ORIGIN.set(px, startY, pz);
    DOWN_RAYCASTER.set(RAY_ORIGIN, DOWN_VEC);
    DOWN_RAYCASTER.far = host.heightM + 0.6;
    const hits = DOWN_RAYCASTER.intersectObject(mountedRoot, true);
    for (const h of hits) {
      const mesh = h.object as THREE.Mesh;
      if (!mesh.visible) continue;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat && 'transparent' in mat && mat.transparent && 'opacity' in mat && (mat as THREE.Material).opacity < 0.45) {
        continue;
      }
      const hy = h.point.y;
      if (hy >= minValidHitY && hy <= maxValidHitY) {
        validYs.push(hy);
        break;
      }
    }
  }

  if (validYs.length === 0) return mathEst;
  const topY = Math.max(...validYs);
  return Number(topY.toFixed(3));
}

export function isPointInsideHostOBB(px: number, pz: number, host: ArchPlacedObject, marginM = 0): boolean {
  const { ux, uz } = getOBBAxes(host.rot);
  const dx = px - host.x;
  const dz = pz - host.z;
  const localX = Math.abs(dx * ux[0] + dz * ux[1]);
  const localZ = Math.abs(dx * uz[0] + dz * uz[1]);
  return localX <= host.widthM * 0.5 + marginM && localZ <= host.depthM * 0.5 + marginM;
}

/** Clamps a locked child strictly inside its parent's rotated 2D footprint so it can NEVER accidentally exit or pop out */
export function clampChildInsideParentOBB(
  child: ArchPlacedObject,
  parent: ArchPlacedObject,
  targetX: number,
  targetZ: number
): { x: number; z: number; clamped: boolean } {
  const { ux, uz } = getOBBAxes(parent.rot);
  const relX = targetX - parent.x;
  const relZ = targetZ - parent.z;
  const locX = relX * ux[0] + relZ * ux[1];
  const locZ = relX * uz[0] + relZ * uz[1];

  // Compute child's half-extents projected onto parent's local axes
  const relRot = child.rot - parent.rot;
  const ac = Math.abs(Math.cos(relRot));
  const as = Math.abs(Math.sin(relRot));
  const childHalfX = ac * (child.widthM * 0.5) + as * (child.depthM * 0.5);
  const childHalfZ = as * (child.widthM * 0.5) + ac * (child.depthM * 0.5);

  const maxLocX = Math.max(0, parent.widthM * 0.5 - childHalfX);
  const maxLocZ = Math.max(0, parent.depthM * 0.5 - childHalfZ);
  const clampedX = Math.max(-maxLocX, Math.min(maxLocX, locX));
  const clampedZ = Math.max(-maxLocZ, Math.min(maxLocZ, locZ));

  const wx = parent.x + ux[0] * clampedX + uz[0] * clampedZ;
  const wz = parent.z + ux[1] * clampedX + uz[1] * clampedZ;
  const clamped = Math.abs(clampedX - locX) > 1e-4 || Math.abs(clampedZ - locZ) > 1e-4;
  return { x: Number(wx.toFixed(3)), z: Number(wz.toFixed(3)), clamped };
}

export function getBaseFloorYAt(project: ArchRoomProject, obj: ArchPlacedObject, x: number, z: number, currentY: number): number {
  const mez = getMezzanineBounds(project);
  if (mez) {
    const insideMez = x >= mez.minX && x <= mez.maxX && z >= mez.minZ && z <= mez.maxZ;
    if (insideMez && (obj.floorLevel === 1 || currentY >= mez.bottomY - 0.06)) {
      return Number(mez.topY.toFixed(3));
    }
  }
  return 0;
}

/** Clamp (x, z) cleanly inside either single-room or multi-room house perimeter */
export function clampPositionToProjectWalls(
  project: ArchRoomProject,
  x: number,
  z: number,
  rot: number,
  halfW: number,
  halfD: number
): { x: number; z: number } {
  const hasMulti = (project.adjacentRooms?.length || 0) > 0;
  if (hasMulti) {
    const hb = getHouseBounds(project);
    const c = clampToRoomWalls(x - hb.centerX, z - hb.centerZ, rot, halfW, halfD, hb.totalW, hb.totalD, 0.01);
    return { x: c.x + hb.centerX, z: c.z + hb.centerZ };
  }
  const c = clampToRoomWalls(x, z, rot, halfW, halfD, project.widthM, project.depthM, 0.01);
  return { x: c.x, z: c.z };
}

/** Returns an open-shelving unit (bookcase / wall unit) that `obj` is entering or currently inside */
export function findOpenShelvingAt(
  project: ArchRoomProject,
  obj: ArchPlacedObject,
  x: number,
  z: number
): ArchPlacedObject | null {
  const candOBB = objToOBB2D(obj, x, z);
  for (const host of project.objects) {
    if (!canFitInsideShelving(obj, host)) continue;
    const mtv = computeOBBOverlapMTV(candOBB, objToOBB2D(host), 0.002);
    if (mtv && mtv.overlap >= 0.015) return host;
  }
  return null;
}

/**
 * Find the highest valid furniture support surface directly under `obj` at `(x, z)`.
 * Excludes open-shelving units when `obj` is inside their interior compartments (below roof).
 */
export function findSupportUnderObject(
  project: ArchRoomProject,
  obj: ArchPlacedObject,
  x: number,
  z: number,
  currentY: number,
  mountedMap?: Map<string, { root: THREE.Group }>,
  requireStackable = true
): SupportSurfaceHit | null {
  if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling' || obj.parametricKind === 'rug_custom') {
    return null;
  }
  const candOBB = objToOBB2D(obj, x, z);
  const edgeGrace = Math.min(0.08, Math.min(obj.widthM, obj.depthM) * 0.28);
  let best: SupportSurfaceHit | null = null;

  for (const host of project.objects) {
    if (host.id === obj.id) continue;
    if (!isSupportSurfaceHost(host)) continue;

    // Open shelving (bookshelf / TV unit): items fitting inside can move freely inside shelves without catapulting to roof!
    if (canFitInsideShelving(obj, host) && currentY < host.y + host.heightM - 0.06) {
      continue;
    }

    if (requireStackable && !canObjectStackOnHost(obj, host, currentY)) continue;

    const hostOBB = objToOBB2D(host);
    const mtv = computeOBBOverlapMTV(candOBB, hostOBB, 0.002);
    if (!mtv) continue;

    const centerIn = isPointInsideHostOBB(x, z, host, edgeGrace);
    const edgeThreshold = requireStackable ? 0.015 : Math.min(0.08, Math.min(obj.widthM, obj.depthM) * 0.22);
    if (!centerIn && mtv.overlap < edgeThreshold) continue;

    const surfY = sampleSupportSurfaceY(
      host,
      x,
      z,
      candOBB.halfW,
      candOBB.halfD,
      mountedMap?.get(host.id)?.root
    );
    if (!best || surfY > best.surfaceY) {
      best = { host, surfaceY: surfY };
    }
  }

  return best;
}

/**
 * Returns all child objects that belong inside or on top of `parent` and must travel together when `parent` moves
 * (e.g. lamp on nightstand, pillow on bed, inner shelf/books inside bookcase).
 */
export function findAttachedChildren(project: ArchRoomProject, parent: ArchPlacedObject): ArchPlacedObject[] {
  if (!isSupportSurfaceHost(parent) && !isOpenShelvingHost(parent)) return [];
  const children: ArchPlacedObject[] = [];
  const parentOBB = objToOBB2D(parent);

  for (const o of project.objects) {
    if (o.id === parent.id) continue;
    if (o.mountMode === 'rug' || o.mountMode === 'ceiling') continue;

    // 1) Explicitly locked parent-child link
    if (o.lockedParentId === parent.id) {
      children.push(o);
      continue;
    }

    // 2) Implicit child resting cleanly ON TOP of or INSIDE this parent (never leave lamps/pillows/shelves floating!)
    const mtv = computeOBBOverlapMTV(objToOBB2D(o), parentOBB, 0.002);
    if (!mtv) continue;
    const centerIn = isPointInsideHostOBB(o.x, o.z, parent, 0.06);
    if (!centerIn) continue;

    if (canFitInsideShelving(o, parent) && o.y >= parent.y - 0.02 && o.y <= parent.y + parent.heightM + 0.06) {
      children.push(o);
      continue;
    }
    if (canObjectStackOnHost(o, parent, o.y) && o.y >= parent.y + 0.12 && o.y <= parent.y + parent.heightM + 0.14) {
      children.push(o);
    }
  }

  return children;
}

/**
 * Post-processes freshly spawned Pinterest AI scenes so:
 * 1) Nested shelves/inserts inside bookcases/units are auto-locked (`lockedParentId`) so they move together and don't slip out.
 * 2) Lamps/pillows/decor placed on beds/nightstands/tables are auto-locked to their host.
 * 3) Floor items floating mid-air (`y > 0.06`) with NO support surface underneath are cleanly grounded to `y = 0`.
 */
export function autoLinkNestedAssemblies(objects: ArchPlacedObject[]): ArchPlacedObject[] {
  return objects.map((obj) => {
    if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling' || obj.mountMode === 'wall') return obj;
    if (obj.lockedParentId && objects.some((o) => o.id === obj.lockedParentId)) return obj;

    // Check if inside an open-shelving unit
    for (const host of objects) {
      if (host.id === obj.id) continue;
      if (canFitInsideShelving(obj, host)) {
        const mtv = computeOBBOverlapMTV(objToOBB2D(obj), objToOBB2D(host), 0.002);
        if (mtv && isPointInsideHostOBB(obj.x, obj.z, host, 0.08)) {
          return { ...obj, lockedParentId: host.id };
        }
      }
    }

    // Check if resting on top of a bed/nightstand/table/sofa
    let bestHost: ArchPlacedObject | null = null;
    let bestSurfY = 0;
    for (const host of objects) {
      if (host.id === obj.id) continue;
      if (!canObjectStackOnHost(obj, host, obj.y)) continue;
      const mtv = computeOBBOverlapMTV(objToOBB2D(obj), objToOBB2D(host), 0.002);
      if (!mtv || !isPointInsideHostOBB(obj.x, obj.z, host, 0.06)) continue;
      const sy = estimateSupportSurfaceY(host);
      if (obj.y >= Math.max(0.12, sy - 0.20) && sy > bestSurfY) {
        bestSurfY = sy;
        bestHost = host;
      }
    }
    if (bestHost) {
      return { ...obj, lockedParentId: bestHost.id };
    }

    // Ground floating floor-mounted plants/decor if nothing is underneath them
    if (obj.mountMode === 'floor' && obj.y > 0.06 && obj.y < 1.35 && obj.floorLevel !== 1) {
      return { ...obj, y: 0 };
    }

    return obj;
  });
}

/**
 * Full 3D placement solver for horizontal drags & nudges:
 * 1) If locked inside/on a parent (`lockedParentId`), clamps strictly inside the parent's boundaries (never pops out!).
 * 2) If `allowOverlap` is enabled, moves freely inside room walls with zero collision pushback.
 * 3) If entering/inside an open-shelving unit (`bookshelf` / `tv_wall_unit`), allows smooth interior shelf placement without blocking!
 * 4) For placeable items (pillows, lamps, vases) dragged onto beds/tables/nightstands, auto-climbs onto real 3D top surface!
 * 5) For solid non-stackable furniture (nightstands, chairs, beds, wardrobes), slides along outer boundaries (never under beds!).
 */
export function resolveHorizontalMove3D(
  project: ArchRoomProject,
  obj: ArchPlacedObject,
  prevX: number,
  prevY: number,
  prevZ: number,
  targetX: number,
  targetZ: number,
  mountedMap?: Map<string, { root: THREE.Group }>
): Placement3DResult {
  const halfW = Math.max(0.06, obj.widthM * 0.5);
  const halfD = Math.max(0.04, obj.depthM * 0.5);
  const wallClamped = clampPositionToProjectWalls(project, targetX, targetZ, obj.rot, halfW, halfD);
  let nextX = wallClamped.x;
  let nextZ = wallClamped.z;
  let nextY = prevY;
  let hitObstacle = false;
  let clampedInsideParent = false;

  // 0) LOCKED PARENT-CHILD BOUNDARY: keep strictly inside/on top of parent (cannot slip outside!)
  const lockedParent = obj.lockedParentId
    ? project.objects.find((o) => o.id === obj.lockedParentId) || null
    : null;
  if (lockedParent) {
    const inside = clampChildInsideParentOBB(obj, lockedParent, nextX, nextZ);
    nextX = inside.x;
    nextZ = inside.z;
    clampedInsideParent = inside.clamped;
    hitObstacle = inside.clamped;

    if (isOpenShelvingHost(lockedParent)) {
      const minY = lockedParent.y;
      const maxY = Math.max(minY, lockedParent.y + lockedParent.heightM - obj.heightM);
      nextY = Math.max(minY, Math.min(maxY, prevY));
      return {
        x: Number(nextX.toFixed(3)),
        y: Number(nextY.toFixed(3)),
        z: Number(nextZ.toFixed(3)),
        hitObstacle,
        support: { host: lockedParent, surfaceY: minY, isInteriorShelf: true },
        minAllowedY: Number(minY.toFixed(3)),
        maxAllowedY: Number(maxY.toFixed(3)),
        clampedBySupport: false,
        clampedInsideParent,
      };
    } else {
      const surfY = sampleSupportSurfaceY(
        lockedParent,
        nextX,
        nextZ,
        halfW,
        halfD,
        mountedMap?.get(lockedParent.id)?.root
      );
      const maxY = Math.max(surfY, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));
      nextY = Math.max(surfY, Math.min(maxY, prevY <= surfY + 0.08 ? surfY : prevY));
      return {
        x: Number(nextX.toFixed(3)),
        y: Number(nextY.toFixed(3)),
        z: Number(nextZ.toFixed(3)),
        hitObstacle,
        support: { host: lockedParent, surfaceY: surfY },
        minAllowedY: surfY,
        maxAllowedY: maxY,
        clampedBySupport: nextY <= surfY + 0.001,
        clampedInsideParent,
      };
    }
  }

  // 0b) FREE OVERLAP MODE: architect explicitly enabled free nesting for this piece
  if (obj.allowOverlap) {
    const floorY = getBaseFloorYAt(project, obj, nextX, nextZ, prevY);
    const maxY = Math.max(floorY, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));
    return {
      x: Number(nextX.toFixed(3)),
      y: Number(Math.max(floorY, Math.min(maxY, prevY)).toFixed(3)),
      z: Number(nextZ.toFixed(3)),
      hitObstacle: false,
      support: null,
      minAllowedY: floorY,
      maxAllowedY: maxY,
      clampedBySupport: false,
      clampedInsideParent: false,
    };
  }

  const prevFloorY = getBaseFloorYAt(project, obj, prevX, prevZ, prevY);
  const prevSupport = findSupportUnderObject(project, obj, prevX, prevZ, prevY, mountedMap, true);
  const wasOnSurface = prevSupport !== null && Math.abs(prevY - prevSupport.surfaceY) <= 0.08;

  // Check if moving inside an open-shelving unit (bookcase / wall shelf unit)
  const shelvingHost = findOpenShelvingAt(project, obj, nextX, nextZ);

  // 1) Check if moving onto a stackable support surface (e.g. pillow -> bed, lamp -> nightstand)
  const targetSupport = findSupportUnderObject(project, obj, nextX, nextZ, prevY, mountedMap, true);
  const nextFloorY = getBaseFloorYAt(project, obj, nextX, nextZ, prevY);

  if (targetSupport) {
    if (prevY <= targetSupport.surfaceY + 0.08 || wasOnSurface) {
      nextY = targetSupport.surfaceY;
    }
  } else if (!shelvingHost && wasOnSurface && obj.mountMode === 'floor') {
    nextY = nextFloorY;
  } else if (!shelvingHost && Math.abs(prevY - prevFloorY) < 0.03 && obj.mountMode === 'floor') {
    nextY = nextFloorY;
  }

  // Gather own attached children so moving a parent NEVER collides with its own lamp/pillow/shelf!
  const ownChildrenIds = new Set(findAttachedChildren(project, obj).map((c) => c.id));

  // 2) Solid boundary enforcement against non-stackable solid obstacles at overlapping vertical ranges
  if (obj.mountMode !== 'rug' && obj.mountMode !== 'ceiling') {
    const prevOBB = objToOBB2D(obj, prevX, prevZ);

    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      const candOBB = objToOBB2D(obj, nextX, nextZ);

      for (const other of project.objects) {
        if (other.id === obj.id) continue;
        if (ownChildrenIds.has(other.id)) continue;
        if (other.allowOverlap) continue;
        if (other.mountMode === 'rug' || other.mountMode === 'ceiling') continue;
        if (other.mountMode === 'wall' && other.depthM < 0.14) continue;

        // Skip open-shelving unit if `obj` fits inside its shelves! (Allows sliding shelves/books/decor right back in!)
        if (canFitInsideShelving(obj, other)) continue;
        // Skip the host we are currently sitting cleanly ON TOP of!
        if (targetSupport && targetSupport.host.id === other.id && nextY >= targetSupport.surfaceY - 0.03) {
          continue;
        }
        // Check 3D vertical overlap
        const otherTop = other.y + other.heightM;
        const vertOverlaps = nextY < otherTop - 0.025 && nextY + obj.heightM > other.y + 0.025;
        if (!vertOverlaps) continue;

        const otherOBB = objToOBB2D(other);
        const mtv = computeOBBOverlapMTV(candOBB, otherOBB, 0.008);
        if (!mtv) continue;

        // Non-trapping guard: never freeze items that were already overlapping
        const prevMtv = computeOBBOverlapMTV(prevOBB, otherOBB, 0.004);
        if (prevMtv) {
          if (mtv.overlap > prevMtv.overlap + 0.015) {
            hitObstacle = true;
          }
          continue;
        }

        hitObstacle = true;
        const tryX = clampPositionToProjectWalls(project, nextX, prevZ, obj.rot, halfW, halfD);
        const tryZ = clampPositionToProjectWalls(project, prevX, nextZ, obj.rot, halfW, halfD);
        const xClear = !computeOBBOverlapMTV(objToOBB2D(obj, tryX.x, tryX.z), otherOBB, 0.006);
        const zClear = !computeOBBOverlapMTV(objToOBB2D(obj, tryZ.x, tryZ.z), otherOBB, 0.006);

        if (xClear && Math.abs(tryX.x - prevX) >= Math.abs(tryZ.z - prevZ)) {
          nextX = tryX.x;
          nextZ = tryX.z;
        } else if (zClear) {
          nextX = tryZ.x;
          nextZ = tryZ.z;
        } else {
          const pushedClamped = clampPositionToProjectWalls(
            project,
            nextX + mtv.mx,
            nextZ + mtv.mz,
            obj.rot,
            halfW,
            halfD
          );
          nextX = pushedClamped.x;
          nextZ = pushedClamped.z;
        }
        candOBB.x = nextX;
        candOBB.z = nextZ;
        pushed = true;
      }
      if (!pushed) break;
    }
  }

  const finalShelving = findOpenShelvingAt(project, obj, nextX, nextZ);
  const finalSupport = findSupportUnderObject(project, obj, nextX, nextZ, nextY, mountedMap, true);
  const finalFloor = getBaseFloorYAt(project, obj, nextX, nextZ, nextY);
  const minAllowedY = finalSupport ? Math.max(finalFloor, finalSupport.surfaceY) : finalFloor;
  const maxAllowedY = Math.max(minAllowedY, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));

  let clampedBySupport = false;
  if (nextY < minAllowedY) {
    nextY = minAllowedY;
    clampedBySupport = finalSupport !== null;
  }
  if (nextY > maxAllowedY) {
    nextY = maxAllowedY;
  }

  return {
    x: Number(nextX.toFixed(3)),
    y: Number(nextY.toFixed(3)),
    z: Number(nextZ.toFixed(3)),
    hitObstacle,
    support:
      finalSupport || (finalShelving ? { host: finalShelving, surfaceY: finalShelving.y, isInteriorShelf: true } : null),
    minAllowedY,
    maxAllowedY,
    clampedBySupport,
    clampedInsideParent,
  };
}

/**
 * Vertical elevation solver (for ▲ Yukarı / ▼ Aşağı buttons, Y-axis 3D dragging, and Yerden Y input).
 * Respects open-shelving compartments (can move up/down between interior shelves), locked parents,
 * and strict solid support boundaries (cannot push a pillow underneath a bed!).
 */
export function resolveVerticalMove3D(
  project: ArchRoomProject,
  obj: ArchPlacedObject,
  targetY: number,
  mountedMap?: Map<string, { root: THREE.Group }>
): {
  y: number;
  minAllowedY: number;
  maxAllowedY: number;
  support: SupportSurfaceHit | null;
  clampedBySupport: boolean;
} {
  const baseFloor = getBaseFloorYAt(project, obj, obj.x, obj.z, obj.y);

  // 1) Locked inside an open-shelving unit -> stays cleanly inside parent's vertical span
  const lockedParent = obj.lockedParentId
    ? project.objects.find((o) => o.id === obj.lockedParentId) || null
    : null;
  if (lockedParent && isOpenShelvingHost(lockedParent)) {
    const minY = lockedParent.y;
    const maxY = Math.max(minY, Number((lockedParent.y + lockedParent.heightM - obj.heightM).toFixed(3)));
    const nextY = Math.max(minY, Math.min(maxY, targetY));
    return {
      y: Number(nextY.toFixed(3)),
      minAllowedY: Number(minY.toFixed(3)),
      maxAllowedY: maxY,
      support: { host: lockedParent, surfaceY: minY, isInteriorShelf: true },
      clampedBySupport: false,
    };
  }

  // 2) Free overlap mode -> full floor-to-ceiling vertical control
  if (obj.allowOverlap) {
    const maxY = Math.max(baseFloor, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));
    const nextY = Math.max(baseFloor, Math.min(maxY, targetY));
    return {
      y: Number(nextY.toFixed(3)),
      minAllowedY: Number(baseFloor.toFixed(3)),
      maxAllowedY: maxY,
      support: null,
      clampedBySupport: false,
    };
  }

  // 3) Inside an open-shelving unit (unlocked) -> can move smoothly across interior shelves down to shelf bottom!
  const shelving = findOpenShelvingAt(project, obj, obj.x, obj.z);
  if (shelving && targetY < shelving.y + shelving.heightM - 0.04) {
    const minY = Math.max(baseFloor, shelving.y);
    const maxY = Math.max(minY, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));
    const nextY = Math.max(minY, Math.min(maxY, targetY));
    return {
      y: Number(nextY.toFixed(3)),
      minAllowedY: Number(minY.toFixed(3)),
      maxAllowedY: maxY,
      support: { host: shelving, surfaceY: minY, isInteriorShelf: true },
      clampedBySupport: false,
    };
  }

  // 4) Standard solid surface support check (bed, nightstand, table, sofa -> NEVER sink underneath!)
  const support = findSupportUnderObject(project, obj, obj.x, obj.z, Math.max(obj.y, targetY), mountedMap, false);
  const enforceSupport =
    support !== null &&
    (canObjectStackOnHost(obj, support.host, Math.max(obj.y, targetY)) || obj.y >= support.surfaceY - 0.06);

  const minAllowedY = enforceSupport && support ? Math.max(baseFloor, support.surfaceY) : baseFloor;
  const maxAllowedY = Math.max(minAllowedY, Number((project.ceilingM - Math.max(0.02, obj.heightM)).toFixed(3)));

  let nextY = targetY;
  let clampedBySupport = false;
  if (nextY < minAllowedY) {
    nextY = minAllowedY;
    clampedBySupport = enforceSupport && support !== null && support.surfaceY > baseFloor + 0.01;
  }
  if (nextY > maxAllowedY) {
    nextY = maxAllowedY;
  }

  return {
    y: Number(nextY.toFixed(3)),
    minAllowedY: Number(minAllowedY.toFixed(3)),
    maxAllowedY: Number(maxAllowedY.toFixed(3)),
    support: enforceSupport ? support : null,
    clampedBySupport,
  };
}
