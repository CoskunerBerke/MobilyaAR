import * as THREE from 'three';
import { clampToRoomWalls, computeOBBOverlapMTV, getOBBAxes, type OBB2D } from '../lib/collision2d';
import { getHouseBounds, getMezzanineBounds, type ArchPlacedObject, type ArchRoomProject } from './types';

export interface SupportSurfaceHit {
  host: ArchPlacedObject;
  surfaceY: number;
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
  'tv_wall_unit',
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
  'table_lamp',
  'shower_cabin',
  'stairs',
]);

const PLACEABLE_TOP_REGEX =
  /yast[ıi]k|k[ıi]rlent|minder|battaniye|örtü|ortu|pik[e]|nevresim|abajur|masa lamba|gece lamba|lamba|vazo|saks[ıi]|çiçek|cicek|bitki|dekor|obje|kitap|tepsi|mum|saat|kutu|sepet|çerçeve|cerceve|laptop|bilgisayar|monitör|monitor|televizyon|\btv\b|fincan|bardak|tabak|kase|peluş|pelus|oyuncak|hoparlör|hoparlor|pillow|cushion|throw|blanket|lamp|vase|plant|decor|book|tray|candle|clock|box|basket|frame|mug|cup|bowl|plush|toy|speaker/i;

const MAJOR_FLOOR_NAME_REGEX =
  /yatak|karyola|baza|kanepe|koltuk|berjer|sandalye|gard[ıi]rop|dolap|yemek masa|çalışma masa|calisma masa|sehpa|komodin|konsol|şifonyer|sifonyer|tezgah|buzdolab|çamaşır|camasir|duşakabin|dusakabin|klozet|şömine|somine|kitapl[ıi]k|merdiven|lambader|hal[ıi]|kilim|puf|bank|\bbed\b|\bsofa\b|\bcouch\b|\bchair\b|\btable\b|\bwardrobe\b|\bcabinet\b|\bdresser\b|\bnightstand\b|\bdesk\b|\brug\b|\bcarpet\b/i;

const BED_REGEX = /yatak|karyola|baza|\bbed\b/i;
const SEAT_REGEX = /kanepe|koltuk|berjer|\bsofa\b|\bcouch\b|\barmchair\b/i;

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

/** True if other objects (pillows, lamps, vases, trays, etc.) can rest on top of `host` */
export function isSupportSurfaceHost(host: ArchPlacedObject): boolean {
  if (host.mountMode === 'rug' || host.mountMode === 'ceiling') return false;
  if (host.mountMode === 'wall' && host.depthM < 0.16) return false;
  if (host.parametricKind && NON_SUPPORT_KINDS.has(host.parametricKind)) return false;
  if (host.heightM < 0.15 || host.widthM < 0.24 || host.depthM < 0.20) return false;
  // Don't treat small pillows/lamps/vases as rigid beds/tables unless they are clearly larger
  if (PLACEABLE_TOP_REGEX.test(host.name) && Math.max(host.widthM, host.depthM) < 0.55) return false;
  return true;
}

/** True if `obj` is a tabletop / soft-furnishing / small accessory that should naturally sit on top of beds, tables, sofas, nightstands */
export function isPlaceableTopItem(obj: ArchPlacedObject): boolean {
  if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling') return false;
  if (obj.parametricKind === 'table_lamp' || obj.parametricKind === 'potted_plant') return true;
  if (obj.parametricKind && MAJOR_FLOOR_KINDS.has(obj.parametricKind)) return false;

  const text = `${obj.name} ${obj.category}`;
  if (PLACEABLE_TOP_REGEX.test(text) && !BED_REGEX.test(text) && !SEAT_REGEX.test(text)) {
    return true;
  }
  if (MAJOR_FLOOR_NAME_REGEX.test(text)) return false;

  // Compact non-structural floor accessories (e.g. Pinterest pillow/decor box without specific keyword)
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
    Math.min(obj.widthM, obj.depthM) <= Math.max(host.widthM, host.depthM) * 0.96 && objArea <= hostArea * 0.88;
  if (!fitsFootprint) return false;

  if (isPlaceableTopItem(obj)) return true;

  // If the user intentionally lifted a smaller solid object above host's mid-height, let it rest on top too
  const yNow = currentY ?? obj.y;
  const estTop = estimateSupportSurfaceY(host);
  if (yNow >= Math.max(host.y + 0.16, estTop - 0.18)) return true;

  return false;
}

/** Pure-math estimate of usable support surface height (handles bed mattresses & sofa seats separately from headboards/backrests!) */
export function estimateSupportSurfaceY(host: ArchPlacedObject): number {
  if (isBedObject(host)) {
    // Tall headboard beds (e.g. 110cm total height): mattress sits around 48-58cm, NOT at headboard top!
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
  // On beds & sofas with tall headboards/backrests, cap ray hits below the backrest so pillows rest on the mattress/seat!
  const maxValidHitY =
    isBedOrSeat && host.heightM > 0.72
      ? host.y + Math.min(0.78, host.heightM * 0.76)
      : host.y + host.heightM + 0.04;
  const minValidHitY = host.y + Math.min(0.16, host.heightM * 0.25);

  const sx = Math.min(0.14, objHalfW * 0.45);
  const sz = Math.min(0.14, objHalfD * 0.45);
  // Project sample center softly into host's interior if object is entering across the edge of a bed/table
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
      // Skip transparent contact shadows / helper planes
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
  // Use the highest valid contact point (prevents clipping into quilted blankets/pillows!)
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

/**
 * Find the highest valid furniture support surface directly under `obj` at `(x, z)`.
 * `strictCenter` = true checks center inside host (with small edge grace);
 * `strictCenter` = false also catches any meaningful 2D OBB overlap (used for strict under-bed prevention!).
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
  const candOBB = objToOBB2D(obj, x, z);
  const edgeGrace = Math.min(0.08, Math.min(obj.widthM, obj.depthM) * 0.28);
  let best: SupportSurfaceHit | null = null;

  for (const host of project.objects) {
    if (host.id === obj.id) continue;
    if (!isSupportSurfaceHost(host)) continue;
    if (requireStackable && !canObjectStackOnHost(obj, host, currentY)) continue;

    const hostOBB = objToOBB2D(host);
    const mtv = computeOBBOverlapMTV(candOBB, hostOBB, 0.002);
    if (!mtv) continue;

    // For stackable tabletop/soft items (pillows, lamps, vases), climb cleanly as soon as they cross 1.5cm onto the bed/table!
    // For non-stackable vertical checks, require center inside or meaningful overlap.
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
 * Full 3D placement solver for horizontal drags & nudges:
 * 1) Clamps inside room walls.
 * 2) For placeable items (pillows, lamps, vases, etc.) dragged onto beds/tables/nightstands/sofas:
 *    - Automatically climbs onto the true 3D top surface (NEVER clips underneath/inside the bed!).
 *    - Smoothly returns to the floor when dragged off the furniture onto open floor!
 * 3) For solid non-stackable furniture (nightstands, chairs, beds, wardrobes, sofas):
 *    - Slides cleanly along the outer boundary of other solid furniture at the same height
 *      so you CANNOT push furniture underneath or through a bed — while NEVER freezing already-overlapping items!
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

  const prevFloorY = getBaseFloorYAt(project, obj, prevX, prevZ, prevY);
  const prevSupport = findSupportUnderObject(project, obj, prevX, prevZ, prevY, mountedMap, true);
  const wasOnSurface =
    prevSupport !== null && Math.abs(prevY - prevSupport.surfaceY) <= 0.08;

  // 1) Check if moving onto a stackable support surface (e.g. pillow -> bed, lamp -> nightstand)
  const targetSupport = findSupportUnderObject(project, obj, nextX, nextZ, prevY, mountedMap, true);
  const nextFloorY = getBaseFloorYAt(project, obj, nextX, nextZ, prevY);

  if (targetSupport) {
    // Automatically lift onto top of the bed/table/sofa if coming from below or gliding across surfaces!
    if (prevY <= targetSupport.surfaceY + 0.08 || wasOnSurface) {
      nextY = targetSupport.surfaceY;
    }
  } else if (wasOnSurface && obj.mountMode === 'floor') {
    // Smoothly land back on the room floor when sliding off the bed/table onto open floor!
    nextY = nextFloorY;
  } else if (Math.abs(prevY - prevFloorY) < 0.03 && obj.mountMode === 'floor') {
    nextY = nextFloorY;
  }

  // 2) Solid boundary enforcement against non-stackable solid obstacles at overlapping vertical ranges!
  //    (Never lets a nightstand/chair/sofa slide underneath or through a bed; never traps already-overlapping items!)
  if (obj.mountMode !== 'rug' && obj.mountMode !== 'ceiling') {
    const prevOBB = objToOBB2D(obj, prevX, prevZ);

    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;
      const candOBB = objToOBB2D(obj, nextX, nextZ);

      for (const other of project.objects) {
        if (other.id === obj.id) continue;
        if (other.mountMode === 'rug' || other.mountMode === 'ceiling') continue;
        if (other.mountMode === 'wall' && other.depthM < 0.14) continue;
        // Skip the host we are currently sitting cleanly ON TOP of!
        if (targetSupport && targetSupport.host.id === other.id && nextY >= targetSupport.surfaceY - 0.03) {
          continue;
        }
        // Check 3D vertical overlap: if completely above or below `other`, no collision!
        const otherTop = other.y + other.heightM;
        const vertOverlaps = nextY < otherTop - 0.025 && nextY + obj.heightM > other.y + 0.025;
        if (!vertOverlaps) continue;

        const otherOBB = objToOBB2D(other);
        const mtv = computeOBBOverlapMTV(candOBB, otherOBB, 0.008);
        if (!mtv) continue;

        // Non-trapping guard: if ALREADY overlapping at `prev` (e.g. tight Pinterest import),
        // only block moves that make overlap WORSE; allow pulling items apart smoothly!
        const prevMtv = computeOBBOverlapMTV(prevOBB, otherOBB, 0.004);
        if (prevMtv) {
          if (mtv.overlap > prevMtv.overlap + 0.015) {
            hitObstacle = true;
          }
          continue;
        }

        // Clean sliding along obstacle boundary: try keeping X or Z component before pushing out along MTV
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

  // Final vertical safety check against resolved (nextX, nextZ)
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
    support: finalSupport,
    minAllowedY,
    maxAllowedY,
    clampedBySupport,
  };
}

/**
 * Vertical elevation solver (for ▲ Yukarı / ▼ Aşağı buttons, Y-axis 3D dragging, and Yerden Y input).
 * Guarantees objects NEVER sink below the floor or underneath a solid furniture piece (like a bed) below them!
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
  // Check ANY overlapping solid support surface beneath (obj.x, obj.z) so you can't sink into a bed/table!
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
