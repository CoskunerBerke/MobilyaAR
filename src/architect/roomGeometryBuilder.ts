import * as THREE from 'three';
import {
  WALL_LABELS,
  getHouseBounds,
  getMezzanineBounds,
  type ArchCurtainCove,
  type ArchDoor,
  type ArchRoomProject,
  type ArchSelection,
  type ArchWindow,
  type PassageStyle,
  type WallId,
} from './types';
import { createFloorTexture, createWallTexture } from './textures';

export interface WallRuntimeRef {
  side: WallId;
  visualGroup: THREE.Group;
  shadowGhost: THREE.Mesh;
  inwardNormal: THREE.Vector3;
  center: THREE.Vector3;
}

export interface BuiltRoomResult {
  walls: WallRuntimeRef[];
  ceilingVisualGroup: THREE.Group;
  ceilingShadowGhost: THREE.Object3D;
  gridHelper: THREE.LineSegments;
  compassRingGroup: THREE.Group;
  planOverlayGroup: THREE.Group;
  planLabelsGroup: THREE.Group;
  room3dLabelsGroup: THREE.Group;
  interiorFillLight: THREE.PointLight | null;
  warnings: string[];
  dispose: () => void;
}

interface HoleBox2D {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function tagPickTarget(obj: THREE.Object3D, target: NonNullable<ArchSelection>) {
  obj.traverse((n) => {
    n.userData.pickTarget = target;
  });
}

function boxesOverlap(a: HoleBox2D, b: HoleBox2D, pad = 0.04): boolean {
  return !(a.x1 + pad <= b.x0 || b.x1 + pad <= a.x0 || a.y1 + pad <= b.y0 || b.y1 + pad <= a.y0);
}

function addRectangularHole(shape: THREE.Shape, x0: number, y0: number, x1: number, y1: number) {
  const p = new THREE.Path();
  p.moveTo(x0, y0);
  p.lineTo(x0, y1);
  p.lineTo(x1, y1);
  p.lineTo(x1, y0);
  p.closePath();
  shape.holes.push(p);
}

function addRoundHole(shape: THREE.Shape, cx: number, cy: number, r: number) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  shape.holes.push(p);
}

function addOvalHole(shape: THREE.Shape, cx: number, cy: number, rx: number, ry: number) {
  const p = new THREE.Path();
  p.absellipse(cx, cy, rx, ry, 0, Math.PI * 2, true, 0);
  shape.holes.push(p);
}

function addArchedHole(shape: THREE.Shape, x0: number, y0: number, x1: number, y1: number) {
  const w = x1 - x0;
  const h = y1 - y0;
  const r = Math.min(w * 0.5, h * 0.46);
  const cx = (x0 + x1) * 0.5;
  const ySpring = y1 - r;
  const p = new THREE.Path();
  p.moveTo(x0, y0);
  p.lineTo(x0, ySpring);
  p.absarc(cx, ySpring, r, Math.PI, 0, true);
  p.lineTo(x1, y0);
  p.closePath();
  shape.holes.push(p);
}

function createWindowAssembly(
  win: ArchWindow,
  cx: number,
  y0: number,
  w: number,
  h: number,
  wallT: number,
  ceilingH: number,
  coveOnWall: ArchCurtainCove | undefined,
  glassMat: THREE.MeshStandardMaterial,
  disposables: Array<() => void>
): THREE.Group {
  const grp = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(win.frameColorHex),
    roughness: 0.42,
    metalness: 0.25,
  });
  const handleMat = new THREE.MeshStandardMaterial({
    color: 0xd8d6d0,
    roughness: 0.28,
    metalness: 0.8,
  });
  const sillMat = new THREE.MeshStandardMaterial({
    color: 0xeeeae2,
    roughness: 0.25,
    metalness: 0.05,
  });
  disposables.push(() => {
    frameMat.dispose();
    handleMat.dispose();
    sillMat.dispose();
  });

  const frameD = Math.min(wallT * 0.62, 0.09);
  const frameZ = -wallT * 0.48;
  const fThick = 0.048;
  const cy = y0 + h * 0.5;

  const addBox = (bw: number, bh: number, bd: number, px: number, py: number, pz: number, mat: THREE.Material) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    disposables.push(() => geo.dispose());
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  if (win.kind === 'round') {
    const r = Math.min(w, h) * 0.5;
    const outerShape = new THREE.Shape();
    outerShape.absarc(0, 0, r + 0.004, 0, Math.PI * 2, false);
    const innerHole = new THREE.Path();
    innerHole.absarc(0, 0, Math.max(0.08, r - fThick), 0, Math.PI * 2, true);
    outerShape.holes.push(innerHole);

    const frameGeo = new THREE.ExtrudeGeometry(outerShape, { depth: frameD, bevelEnabled: false, curveSegments: 32 });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, cy, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    const glassGeo = new THREE.CircleGeometry(Math.max(0.08, r - fThick + 0.005), 32);
    disposables.push(() => glassGeo.dispose());
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(cx, cy, frameZ);
    grp.add(glass);
  } else if (win.kind === 'oval') {
    const rx = w * 0.5;
    const ry = h * 0.5;
    const outerShape = new THREE.Shape();
    outerShape.absellipse(0, 0, rx + 0.004, ry + 0.004, 0, Math.PI * 2, false, 0);
    const innerHole = new THREE.Path();
    innerHole.absellipse(0, 0, Math.max(0.08, rx - fThick), Math.max(0.08, ry - fThick), 0, Math.PI * 2, true, 0);
    outerShape.holes.push(innerHole);

    const frameGeo = new THREE.ExtrudeGeometry(outerShape, { depth: frameD, bevelEnabled: false, curveSegments: 36 });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, cy, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    addBox(0.028, Math.max(0.1, h - fThick * 2), frameD * 0.55, cx, cy, frameZ, frameMat);

    const glassShape = new THREE.Shape();
    glassShape.absellipse(0, 0, Math.max(0.08, rx - fThick + 0.005), Math.max(0.08, ry - fThick + 0.005), 0, Math.PI * 2, false, 0);
    const glassGeo = new THREE.ShapeGeometry(glassShape, 32);
    disposables.push(() => glassGeo.dispose());
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(cx, cy, frameZ);
    grp.add(glass);
  } else if (win.kind === 'arched') {
    const r = Math.min(w * 0.5, h * 0.46);
    const springLocalY = h - r;
    const outer = new THREE.Shape();
    outer.moveTo(-w * 0.5, 0);
    outer.lineTo(-w * 0.5, springLocalY);
    outer.absarc(0, springLocalY, r, Math.PI, 0, true);
    outer.lineTo(w * 0.5, 0);
    outer.closePath();

    const innerR = Math.max(0.08, r - fThick);
    const inner = new THREE.Path();
    inner.moveTo(-w * 0.5 + fThick, fThick);
    inner.lineTo(-w * 0.5 + fThick, springLocalY);
    inner.absarc(0, springLocalY, innerR, Math.PI, 0, true);
    inner.lineTo(w * 0.5 - fThick, fThick);
    inner.closePath();
    outer.holes.push(inner);

    const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: frameD, bevelEnabled: false, curveSegments: 28 });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, y0, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    addBox(w - fThick * 1.4, 0.032, frameD * 0.65, cx, y0 + springLocalY, frameZ, frameMat);
    addBox(0.032, springLocalY - fThick, frameD * 0.65, cx, y0 + (springLocalY + fThick) * 0.5, frameZ, frameMat);

    const gShape = new THREE.Shape();
    gShape.moveTo(-w * 0.5 + fThick * 0.8, fThick * 0.8);
    gShape.lineTo(-w * 0.5 + fThick * 0.8, springLocalY);
    gShape.absarc(0, springLocalY, innerR + 0.008, Math.PI, 0, true);
    gShape.lineTo(w * 0.5 - fThick * 0.8, fThick * 0.8);
    gShape.closePath();
    const gGeo = new THREE.ShapeGeometry(gShape, 24);
    disposables.push(() => gGeo.dispose());
    const gMesh = new THREE.Mesh(gGeo, glassMat);
    gMesh.position.set(cx, y0, frameZ);
    grp.add(gMesh);
  } else {
    addBox(w, fThick, frameD, cx, y0 + fThick * 0.5, frameZ, frameMat);
    addBox(w, fThick, frameD, cx, y0 + h - fThick * 0.5, frameZ, frameMat);
    addBox(fThick, h, frameD, cx - w * 0.5 + fThick * 0.5, cy, frameZ, frameMat);
    addBox(fThick, h, frameD, cx + w * 0.5 - fThick * 0.5, cy, frameZ, frameMat);

    const innerW = Math.max(0.1, w - fThick * 2);
    const innerH = Math.max(0.1, h - fThick * 2);
    const paneCount =
      win.kind === 'single'
        ? 1
        : win.kind === 'double' || win.kind === 'sliding'
        ? 2
        : win.kind === 'triple'
        ? 3
        : win.kind === 'quad'
        ? 4
        : w >= 2.2
        ? 3
        : 2;

    if (win.kind === 'sliding') {
      const sashW = innerW * 0.52;
      const addSash = (sx: number, sz: number) => {
        const st = 0.032;
        addBox(sashW, st, 0.026, sx, y0 + fThick + st * 0.5, sz, frameMat);
        addBox(sashW, st, 0.026, sx, y0 + h - fThick - st * 0.5, sz, frameMat);
        addBox(st, innerH, 0.026, sx - sashW * 0.5 + st * 0.5, cy, sz, frameMat);
        addBox(st, innerH, 0.026, sx + sashW * 0.5 - st * 0.5, cy, sz, frameMat);
        const gGeo = new THREE.PlaneGeometry(sashW - st * 1.6, innerH - st * 1.6);
        disposables.push(() => gGeo.dispose());
        const gm = new THREE.Mesh(gGeo, glassMat);
        gm.position.set(sx, cy, sz);
        grp.add(gm);
      };
      addSash(cx - innerW * 0.24, frameZ + 0.014);
      addSash(cx + innerW * 0.24, frameZ - 0.014);
      addBox(0.016, 0.22, 0.024, cx - innerW * 0.46, y0 + Math.min(h * 0.45, 1.05), frameZ + 0.034, handleMat);
    } else {
      for (let i = 1; i < paneCount; i++) {
        const mx = cx - innerW * 0.5 + (innerW * i) / paneCount;
        addBox(0.036, innerH, frameD * 0.78, mx, cy, frameZ, frameMat);
      }
      if (win.kind === 'french' && h >= 1.9) {
        addBox(innerW, 0.032, frameD * 0.72, cx, y0 + h - 0.45, frameZ, frameMat);
      }
      const handleY = y0 + Math.min(h * 0.44, 1.08);
      const hx = paneCount === 1 ? cx + innerW * 0.48 : cx - innerW * 0.5 + innerW / paneCount - 0.03;
      addBox(0.016, 0.12, 0.03, hx, handleY, frameZ + frameD * 0.55, handleMat);
      const gGeo = new THREE.PlaneGeometry(innerW, innerH);
      disposables.push(() => gGeo.dispose());
      const glass = new THREE.Mesh(gGeo, glassMat);
      glass.position.set(cx, cy, frameZ);
      grp.add(glass);
    }
  }

  if (win.hasSill && win.kind !== 'round' && win.kind !== 'oval' && y0 >= 0.08) {
    addBox(w + 0.08, 0.032, wallT + 0.06, cx, y0 - 0.008, -wallT * 0.5 + 0.025, sillMat);
  }

  if (win.curtainStyle !== 'none') {
    const topY = coveOnWall ? ceilingH - 0.03 : Math.min(ceilingH - 0.04, y0 + h + 0.16);
    const botY = win.curtainStyle === 'roman_blind' ? Math.max(y0 + h * (1 - 0.35 * (1 - win.curtainOpenRatio)), y0 + 0.15) : 0.018;
    const curtH = Math.max(0.25, topY - botY);
    const curtZ = coveOnWall ? Math.max(0.07, coveOnWall.depthCm / 100 - 0.09) : 0.075;
    const spanW = w + 0.42;

    if (!coveOnWall) {
      addBox(spanW + 0.12, 0.02, 0.024, cx, topY + 0.01, curtZ, frameMat);
    }

    const buildPleatedCurtain = (cw: number, ch: number, px: number, py: number, pz: number, mat: THREE.Material, amp = 0.02) => {
      const segsX = Math.max(10, Math.round(cw * 20));
      const geo = new THREE.PlaneGeometry(cw, ch, segsX, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        pos.setZ(i, Math.sin((vx / Math.max(0.05, cw)) * Math.PI * Math.max(6, Math.round(cw * 12))) * amp);
      }
      geo.computeVertexNormals();
      disposables.push(() => geo.dispose());
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.receiveShadow = true;
      grp.add(m);
    };

    if (win.curtainStyle === 'roman_blind') {
      const blindMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(win.curtainColorHex), roughness: 0.9, side: THREE.DoubleSide });
      disposables.push(() => blindMat.dispose());
      const dropH = Math.max(0.2, h * (0.28 + 0.65 * (1 - win.curtainOpenRatio)));
      const bGeo = new THREE.BoxGeometry(w + 0.04, dropH, 0.025);
      disposables.push(() => bGeo.dispose());
      const bm = new THREE.Mesh(bGeo, blindMat);
      bm.position.set(cx, y0 + h - dropH * 0.5 + 0.03, 0.035);
      grp.add(bm);
    } else {
      const sheerMat = new THREE.MeshStandardMaterial({
        color: 0xfbfaf6,
        roughness: 0.92,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      disposables.push(() => sheerMat.dispose());
      buildPleatedCurtain(spanW, curtH, cx, botY + curtH * 0.5, curtZ - 0.022, sheerMat, 0.014);

      if (win.curtainStyle === 'sheer_and_drape') {
        const drapeMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(win.curtainColorHex),
          roughness: 0.9,
          side: THREE.DoubleSide,
        });
        disposables.push(() => drapeMat.dispose());
        const panelW = Math.max(0.22, spanW * (0.5 - win.curtainOpenRatio * 0.34));
        buildPleatedCurtain(panelW, curtH, cx - spanW * 0.5 + panelW * 0.5, botY + curtH * 0.5, curtZ + 0.024, drapeMat, 0.025);
        buildPleatedCurtain(panelW, curtH, cx + spanW * 0.5 - panelW * 0.5, botY + curtH * 0.5, curtZ + 0.024, drapeMat, 0.025);
      }
    }
  }

  tagPickTarget(grp, { type: 'window', id: win.id });
  return grp;
}

function createDoorAssembly(
  door: ArchDoor,
  cx: number,
  w: number,
  h: number,
  wallT: number,
  disposables: Array<() => void>
): { doorGroup: THREE.Group; swingArcGroup: THREE.Group } {
  const doorGroup = new THREE.Group();
  const swingArcGroup = new THREE.Group();

  const pStyle = door.panelStyle || 'classic';
  const leafTex =
    pStyle === 'wood'
      ? createFloorTexture('plank_oak', door.colorHex, w * 1.4, h * 0.9)
      : pStyle === 'fluted'
      ? createWallTexture('slats', door.colorHex, w * 1.6, h * 0.9)
      : null;
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafTex ? 0xffffff : new THREE.Color(door.colorHex),
    map: leafTex || undefined,
    roughness: pStyle === 'modern' ? 0.36 : 0.56,
    metalness: 0.04,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.colorHex).multiplyScalar(0.93), roughness: 0.48 });
  const grooveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.colorHex).multiplyScalar(0.76), roughness: 0.65 });
  const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.handleColorHex), roughness: 0.3, metalness: 0.82 });
  const thresholdMat = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.35 });
  disposables.push(() => {
    leafMat.dispose();
    trimMat.dispose();
    grooveMat.dispose();
    handleMat.dispose();
    thresholdMat.dispose();
  });

  const addBox = (
    parent: THREE.Object3D,
    bw: number,
    bh: number,
    bd: number,
    px: number,
    py: number,
    pz: number,
    mat: THREE.Material
  ) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    disposables.push(() => geo.dispose());
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  addBox(doorGroup, w, 0.012, wallT + 0.01, cx, 0.006, -wallT * 0.5, thresholdMat);

  if (door.kind === 'archway') {
    const r = Math.min(w * 0.5, h * 0.44);
    const springY = h - r;
    const trimW = 0.06;
    const outer = new THREE.Shape();
    outer.moveTo(-w * 0.5 - trimW, 0);
    outer.lineTo(-w * 0.5 - trimW, springY);
    outer.absarc(0, springY, r + trimW, Math.PI, 0, true);
    outer.lineTo(w * 0.5 + trimW, 0);
    outer.lineTo(w * 0.5, 0);
    outer.lineTo(w * 0.5, springY);
    outer.absarc(0, springY, r, 0, Math.PI, false);
    outer.lineTo(-w * 0.5, 0);
    outer.closePath();

    const trimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.022, bevelEnabled: false, curveSegments: 24 });
    disposables.push(() => trimGeo.dispose());
    const frontTrim = new THREE.Mesh(trimGeo, trimMat);
    frontTrim.position.set(cx, 0, 0.001);
    doorGroup.add(frontTrim);
    tagPickTarget(doorGroup, { type: 'door', id: door.id });
    return { doorGroup, swingArcGroup };
  }

  const casingW = 0.055;
  const casingD = wallT + 0.032;
  addBox(doorGroup, casingW, h + casingW, casingD, cx - w * 0.5 + casingW * 0.25, (h + casingW) * 0.5, -wallT * 0.5, trimMat);
  addBox(doorGroup, casingW, h + casingW, casingD, cx + w * 0.5 - casingW * 0.25, (h + casingW) * 0.5, -wallT * 0.5, trimMat);
  addBox(doorGroup, w + casingW, casingW, casingD, cx, h + casingW * 0.25, -wallT * 0.5, trimMat);

  const leafThick = 0.044;
  const clearW = Math.max(0.45, w - casingW * 1.1);
  const clearH = Math.max(1.75, h - casingW * 0.5);
  const openRatio = Math.max(0, Math.min(1, door.openAngleDeg / 110));

  if (door.kind === 'sliding') {
    const slideDir = door.hinge === 'left' ? -1 : 1;
    addBox(doorGroup, clearW * 2, 0.055, 0.055, cx + slideDir * clearW * 0.45, h + 0.04, 0.032, handleMat);
    const leafCenterX = cx + slideDir * clearW * 0.85 * openRatio;
    addBox(doorGroup, clearW + 0.04, clearH, leafThick, leafCenterX, clearH * 0.5 + 0.01, 0.038, leafMat);
    addBox(doorGroup, 0.022, 0.24, 0.055, leafCenterX - slideDir * (clearW * 0.42), 1.02, 0.038, handleMat);
    tagPickTarget(doorGroup, { type: 'door', id: door.id });
    return { doorGroup, swingArcGroup };
  }

  const buildHingedLeaf = (pivotX: number, pivotZ: number, leafW: number, leafSign: 1 | -1, rotY: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(pivotX, 0.01, pivotZ);
    pivot.rotation.y = rotY;
    doorGroup.add(pivot);

    addBox(pivot, leafW, clearH, leafThick, leafSign * leafW * 0.5, clearH * 0.5, 0, leafMat);
    const panelW = Math.max(0.2, leafW - 0.18);
    if (pStyle === 'classic') {
      addBox(pivot, panelW, clearH * 0.36, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.72, 0, trimMat);
      addBox(pivot, panelW, clearH * 0.32, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.26, 0, trimMat);
    } else if (pStyle === 'modern') {
      // Sleek minimal horizontal CNC grooves (VarioDor Lake / Supramat style)
      for (const ratio of [0.22, 0.42, 0.62, 0.82]) {
        addBox(pivot, leafW - 0.1, 0.008, leafThick + 0.004, leafSign * leafW * 0.5, clearH * ratio, 0, grooveMat);
      }
    } else if (pStyle === 'fluted') {
      // Vertical architectural ribs (VarioDor Luxury / AGT Soft Touch style)
      const ribCount = Math.max(4, Math.round(panelW / 0.075));
      for (let r = 0; r < ribCount; r++) {
        const rx = leafSign * (0.1 + ((r + 0.5) / ribCount) * panelW);
        addBox(pivot, 0.016, clearH - 0.22, leafThick + 0.01, rx, clearH * 0.5, 0, trimMat);
      }
    }

    const hx = leafSign * (leafW - 0.09);
    addBox(pivot, 0.03, 0.03, leafThick + 0.09, hx, 1.02, 0, handleMat);
    addBox(pivot, 0.115, 0.02, 0.018, hx - leafSign * 0.045, 1.02, leafThick * 0.5 + 0.042, handleMat);
    addBox(pivot, 0.115, 0.02, 0.018, hx - leafSign * 0.045, 1.02, -leafThick * 0.5 - 0.042, handleMat);

    const arcSign =
      rotY === 0
        ? door.swing === 'inward'
          ? leafSign === 1
            ? -1
            : 1
          : leafSign === 1
          ? 1
          : -1
        : Math.sign(rotY);
    const maxArcRad = Math.max(Math.abs(rotY), Math.PI * 0.5) * arcSign;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (maxArcRad * i) / 20;
      pts.push(new THREE.Vector3(pivotX + leafSign * leafW * Math.cos(a), 0.014, pivotZ - leafSign * leafW * Math.sin(a)));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const arcMat = new THREE.LineBasicMaterial({
      color: door.swing === 'inward' ? 0x2563eb : 0xb45309,
      transparent: true,
      opacity: 0.7,
    });
    disposables.push(() => {
      arcGeo.dispose();
      arcMat.dispose();
    });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.raycast = () => {};
    swingArcGroup.add(arcLine);

    const radGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pivotX, 0.014, pivotZ),
      new THREE.Vector3(pivotX + leafSign * leafW * Math.cos(maxArcRad), 0.014, pivotZ - leafSign * leafW * Math.sin(maxArcRad)),
    ]);
    disposables.push(() => radGeo.dispose());
    const radLine = new THREE.Line(radGeo, arcMat);
    radLine.raycast = () => {};
    swingArcGroup.add(radLine);
  };

  const openRad = (door.openAngleDeg * Math.PI) / 180;
  const pivotZ = door.swing === 'inward' ? -0.01 : -wallT + 0.01;

  if (door.kind === 'double') {
    const halfLeaf = clearW * 0.5 - 0.004;
    buildHingedLeaf(cx - clearW * 0.5, pivotZ, halfLeaf, 1, door.swing === 'inward' ? -openRad : openRad);
    buildHingedLeaf(cx + clearW * 0.5, pivotZ, halfLeaf, -1, door.swing === 'inward' ? openRad : -openRad);
  } else if (door.hinge === 'left') {
    buildHingedLeaf(cx - clearW * 0.5, pivotZ, clearW, 1, door.swing === 'inward' ? -openRad : openRad);
  } else {
    buildHingedLeaf(cx + clearW * 0.5, pivotZ, clearW, -1, door.swing === 'inward' ? openRad : -openRad);
  }

  tagPickTarget(doorGroup, { type: 'door', id: door.id });
  return { doorGroup, swingArcGroup };
}

function buildCurtainCoveOnWall(
  cove: ArchCurtainCove,
  wallLen: number,
  ceilingH: number,
  disposables: Array<() => void>
): THREE.Group {
  const grp = new THREE.Group();
  const depthM = Math.max(0.1, Math.min(0.45, cove.depthCm / 100));
  const dropM = Math.max(0.08, Math.min(0.4, cove.dropCm / 100));
  const fasciaT = 0.045;

  const gypsumMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cove.colorHex), roughness: 0.88 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.35, metalness: 0.65 });
  disposables.push(() => {
    gypsumMat.dispose();
    trackMat.dispose();
  });

  const fasciaGeo = new THREE.BoxGeometry(wallLen, dropM, fasciaT);
  const lipGeo = new THREE.BoxGeometry(wallLen, 0.022, 0.042);
  disposables.push(() => {
    fasciaGeo.dispose();
    lipGeo.dispose();
  });
  const fascia = new THREE.Mesh(fasciaGeo, gypsumMat);
  fascia.position.set(0, ceilingH - dropM * 0.5, depthM - fasciaT * 0.5);
  fascia.castShadow = true;
  fascia.receiveShadow = true;
  grp.add(fascia);

  const lip = new THREE.Mesh(lipGeo, gypsumMat);
  lip.position.set(0, ceilingH - dropM + 0.011, depthM - fasciaT - 0.021);
  grp.add(lip);

  for (const tz of [depthM * 0.34, depthM * 0.62]) {
    const trGeo = new THREE.BoxGeometry(wallLen - 0.06, 0.016, 0.018);
    disposables.push(() => trGeo.dispose());
    const tr = new THREE.Mesh(trGeo, trackMat);
    tr.position.set(0, ceilingH - 0.012, tz);
    grp.add(tr);
  }

  if (cove.ledEnabled) {
    const ledCol = new THREE.Color(cove.ledColorHex);
    const ledMat = new THREE.MeshBasicMaterial({ color: ledCol });
    const stripGeo = new THREE.BoxGeometry(wallLen - 0.08, 0.018, 0.028);
    // Subtle emissive warm wash plane inside the recess (0 GPU PointLight cost!)
    const washMat = new THREE.MeshBasicMaterial({
      color: ledCol,
      transparent: true,
      opacity: Math.min(0.45, 0.16 * cove.ledIntensity),
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const washGeo = new THREE.PlaneGeometry(wallLen - 0.04, Math.min(0.45, dropM * 1.9));
    disposables.push(() => {
      ledMat.dispose();
      stripGeo.dispose();
      washMat.dispose();
      washGeo.dispose();
    });
    const strip = new THREE.Mesh(stripGeo, ledMat);
    strip.position.set(0, ceilingH - dropM + 0.028, depthM - fasciaT - 0.022);
    grp.add(strip);

    const wash = new THREE.Mesh(washGeo, washMat);
    wash.position.set(0, ceilingH - dropM * 0.85, 0.014);
    wash.raycast = () => {};
    grp.add(wash);
  }

  return grp;
}

export function buildArchitecturalRoom(project: ArchRoomProject, roomRoot: THREE.Group): BuiltRoomResult {
  const disposables: Array<() => void> = [];
  const warnings: string[] = [];
  const walls: WallRuntimeRef[] = [];

  const W = project.widthM;
  const D = project.depthM;
  const H = project.ceilingM;
  const T = project.wallThicknessM;

  // 1) Floor & architectural plinth slab (cached texture -> NOT disposed)
  const floorTex = createFloorTexture(project.floorMaterial, project.floorTintHex, W, D);
  const floorRough =
    project.floorMaterial === 'marble'
      ? 0.24
      : project.floorMaterial === 'travertine'
      ? 0.44
      : project.floorMaterial === 'terrazzo'
      ? 0.36
      : 0.68;

  const floorGeo = new THREE.PlaneGeometry(W, D);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: floorRough, metalness: 0.04 });
  disposables.push(() => {
    floorGeo.dispose();
    floorMat.dispose();
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.userData.pickTarget = { type: 'floor' } satisfies ArchSelection;
  roomRoot.add(floorMesh);

  const slabGeo = new THREE.BoxGeometry(W + T * 2 + 0.14, 0.14, D + T * 2 + 0.14);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xd5d0c7, roughness: 0.92 });
  disposables.push(() => {
    slabGeo.dispose();
    slabMat.dispose();
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -0.095;
  slab.receiveShadow = true;
  slab.raycast = () => {};
  roomRoot.add(slab);

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdcf0ff,
    transparent: true,
    opacity: 0.24,
    roughness: 0.1,
    metalness: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowOnlyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  disposables.push(() => {
    glassMat.dispose();
    shadowOnlyMat.dispose();
  });

  const planOverlayGroup = new THREE.Group();
  roomRoot.add(planOverlayGroup);
  const planLabelsGroup = new THREE.Group();
  roomRoot.add(planLabelsGroup);
  const room3dLabelsGroup = new THREE.Group();
  roomRoot.add(room3dLabelsGroup);

  const wallSpecs: Array<{
    side: WallId;
    len: number;
    extendCorners: boolean;
    pos: [number, number, number];
    rotY: number;
    inward: [number, number, number];
  }> = [
    { side: 'north', len: W, extendCorners: true, pos: [0, 0, -D / 2], rotY: 0, inward: [0, 0, 1] },
    { side: 'south', len: W, extendCorners: true, pos: [0, 0, D / 2], rotY: Math.PI, inward: [0, 0, -1] },
    { side: 'west', len: D, extendCorners: false, pos: [-W / 2, 0, 0], rotY: Math.PI / 2, inward: [1, 0, 0] },
    { side: 'east', len: D, extendCorners: false, pos: [W / 2, 0, 0], rotY: -Math.PI / 2, inward: [-1, 0, 0] },
  ];

  const baseboardH = Math.max(0.06, Math.min(0.18, (project.baseboardHeightCm ?? 10) / 100));
  const baseboardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(project.baseboardColorHex), roughness: 0.55 });
  const cornerTrimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(project.cornerTrimColorHex || project.baseboardColorHex),
    roughness: 0.45,
    metalness: 0.08,
  });
  disposables.push(() => {
    baseboardMat.dispose();
    cornerTrimMat.dispose();
  });

  const adjacentRooms = project.adjacentRooms || [];
  const hasMultiRoom = adjacentRooms.length > 0;
  const houseBounds = getHouseBounds(project);

  // Unified room-rect list for automatic shared-wall partition detection & Sims-style doorway cutting
  interface RoomBoxMeta {
    id: string;
    cx: number;
    cz: number;
    w: number;
    d: number;
  }
  const allRoomBoxes: RoomBoxMeta[] = [
    { id: 'main', cx: 0, cz: 0, w: W, d: D },
    ...adjacentRooms.map((r) => ({ id: r.id, cx: r.centerXM, cz: r.centerZM, w: r.widthM, d: r.depthM })),
  ];

  const isWallSharedPartition = (roomId: string, side: WallId): boolean => {
    if (!hasMultiRoom) return false;
    const me = allRoomBoxes.find((b) => b.id === roomId);
    if (!me) return false;
    for (const other of allRoomBoxes) {
      if (other.id === roomId) continue;
      if (side === 'east') {
        const gap = other.cx - other.w * 0.5 - (me.cx + me.w * 0.5);
        const ov = Math.min(me.cz + me.d * 0.5, other.cz + other.d * 0.5) - Math.max(me.cz - me.d * 0.5, other.cz - other.d * 0.5);
        if (Math.abs(gap - T) <= 0.08 && ov >= 0.15) return true;
      } else if (side === 'west') {
        const gap = me.cx - me.w * 0.5 - (other.cx + other.w * 0.5);
        const ov = Math.min(me.cz + me.d * 0.5, other.cz + other.d * 0.5) - Math.max(me.cz - me.d * 0.5, other.cz - other.d * 0.5);
        if (Math.abs(gap - T) <= 0.08 && ov >= 0.15) return true;
      } else if (side === 'south') {
        const gap = other.cz - other.d * 0.5 - (me.cz + me.d * 0.5);
        const ov = Math.min(me.cx + me.w * 0.5, other.cx + other.w * 0.5) - Math.max(me.cx - me.w * 0.5, other.cx - other.w * 0.5);
        if (Math.abs(gap - T) <= 0.08 && ov >= 0.15) return true;
      } else {
        const gap = me.cz - me.d * 0.5 - (other.cz + other.d * 0.5);
        const ov = Math.min(me.cx + me.w * 0.5, other.cx + other.w * 0.5) - Math.max(me.cx - me.w * 0.5, other.cx - other.w * 0.5);
        if (Math.abs(gap - T) <= 0.08 && ov >= 0.15) return true;
      }
    }
    return false;
  };

  interface PassageCut {
    roomId: string;
    side: WallId;
    localCx: number;
    widthM: number;
    heightM: number;
    style: PassageStyle;
    renderAssembly: boolean;
    childRoomId: string;
  }

  const oppSide = (s: WallId): WallId =>
    s === 'north' ? 'south' : s === 'south' ? 'north' : s === 'east' ? 'west' : 'east';

  const worldCoordToWallLocal = (room: RoomBoxMeta, side: WallId, worldCoord: number): number => {
    if (side === 'north') return worldCoord - room.cx;
    if (side === 'south') return -(worldCoord - room.cx);
    if (side === 'east') return worldCoord - room.cz;
    return -(worldCoord - room.cz);
  };

  const passageCuts: PassageCut[] = [];
  for (const child of adjacentRooms) {
    const parentBox = allRoomBoxes.find((b) => b.id === child.parentRoomId) || allRoomBoxes[0];
    const childBox = allRoomBoxes.find((b) => b.id === child.id);
    if (!parentBox || !childBox) continue;
    const pSide = child.attachedSide;
    const cSide = oppSide(pSide);

    const isNS = pSide === 'north' || pSide === 'south';
    const pMin = isNS ? parentBox.cx - parentBox.w * 0.5 : parentBox.cz - parentBox.d * 0.5;
    const pMax = isNS ? parentBox.cx + parentBox.w * 0.5 : parentBox.cz + parentBox.d * 0.5;
    const cMin = isNS ? childBox.cx - childBox.w * 0.5 : childBox.cz - childBox.d * 0.5;
    const cMax = isNS ? childBox.cx + childBox.w * 0.5 : childBox.cz + childBox.d * 0.5;
    const ovMin = Math.max(pMin, cMin);
    const ovMax = Math.min(pMax, cMax);
    const ovLen = ovMax - ovMin;
    if (ovLen < 0.72) continue;

    const requestedW = Math.max(0.75, (child.passageWidthCm || 95) / 100);
    const pW =
      child.passageStyle === 'open_wide'
        ? Math.max(1.2, Math.min(ovLen - 0.2, Math.max(requestedW, ovLen * 0.72)))
        : Math.max(0.75, Math.min(ovLen - 0.18, requestedW));
    const pH =
      child.passageStyle === 'open_wide'
        ? Math.max(2.15, H - 0.22)
        : Math.min(2.14, H - 0.12);
    const worldCenter = (ovMin + ovMax) * 0.5;

    passageCuts.push(
      {
        roomId: parentBox.id,
        side: pSide,
        localCx: worldCoordToWallLocal(parentBox, pSide, worldCenter),
        widthM: pW,
        heightM: pH,
        style: child.passageStyle,
        renderAssembly: true,
        childRoomId: child.id,
      },
      {
        roomId: childBox.id,
        side: cSide,
        localCx: worldCoordToWallLocal(childBox, cSide, worldCenter),
        widthM: pW,
        heightM: pH,
        style: child.passageStyle,
        renderAssembly: false,
        childRoomId: child.id,
      }
    );
  }

  const halfT = T * 0.495;
  const primaryShared: Record<WallId, boolean> = {
    north: isWallSharedPartition('main', 'north'),
    south: isWallSharedPartition('main', 'south'),
    east: isWallSharedPartition('main', 'east'),
    west: isWallSharedPartition('main', 'west'),
  };

  for (const ws of wallSpecs) {
    const wallHolder = new THREE.Group();
    wallHolder.position.set(...ws.pos);
    wallHolder.rotation.y = ws.rotY;
    roomRoot.add(wallHolder);

    const visualGroup = new THREE.Group();
    wallHolder.add(visualGroup);

    const wallOverlay = new THREE.Group();
    wallOverlay.position.set(...ws.pos);
    wallOverlay.rotation.y = ws.rotY;
    planOverlayGroup.add(wallOverlay);

    const isShared = primaryShared[ws.side];
    const wallDepth = isShared ? halfT : T;
    const leftExt = ws.extendCorners
      ? ws.side === 'north'
        ? primaryShared.west
          ? halfT
          : T
        : primaryShared.east
        ? halfT
        : T
      : 0;
    const rightExt = ws.extendCorners
      ? ws.side === 'north'
        ? primaryShared.east
          ? halfT
          : T
        : primaryShared.west
        ? halfT
        : T
      : 0;

    const wallShape = new THREE.Shape();
    const xLeftExt = -ws.len * 0.5 - leftExt;
    const xRightExt = ws.len * 0.5 + rightExt;
    wallShape.moveTo(xLeftExt, 0);
    wallShape.lineTo(xRightExt, 0);
    wallShape.lineTo(xRightExt, H);
    wallShape.lineTo(xLeftExt, H);
    wallShape.closePath();

    const acceptedHoles: HoleBox2D[] = [];
    const floorBreakSpans: Array<[number, number]> = [];
    const coveOnWall = project.curtainCoves.find((c) => c.wall === ws.side);

    // Sims-style shared passages to adjacent rooms on this primary wall (cut FIRST so doorways always open cleanly!)
    for (const pc of passageCuts.filter((c) => c.roomId === 'main' && c.side === ws.side)) {
      const x0 = Math.max(-ws.len * 0.5 + 0.06, pc.localCx - pc.widthM * 0.5);
      const x1 = Math.min(ws.len * 0.5 - 0.06, pc.localCx + pc.widthM * 0.5);
      if (x1 - x0 < 0.55) continue;
      const cand: HoleBox2D = { x0, x1, y0: 0.005, y1: pc.heightM };
      acceptedHoles.push(cand);
      floorBreakSpans.push([x0 - 0.04, x1 + 0.04]);
      if (pc.style === 'open_arch') addArchedHole(wallShape, x0, 0.005, x1, pc.heightM);
      else addRectangularHole(wallShape, x0, 0.005, x1, pc.heightM);

      if (pc.renderAssembly) {
        const synDoor: ArchDoor = {
          id: `passage-${pc.childRoomId}`,
          wall: ws.side,
          kind: pc.style === 'door' ? 'single' : 'archway',
          offsetCm: Math.round(((x0 + x1) * 0.5 + ws.len * 0.5) * 100),
          widthCm: Math.round((x1 - x0) * 100),
          heightCm: Math.round(pc.heightM * 100),
          swing: 'outward',
          hinge: 'left',
          openAngleDeg: 58,
          colorHex: '#ede9e0',
          handleColorHex: '#232325',
          panelStyle: 'modern',
        };
        const { doorGroup, swingArcGroup } = createDoorAssembly(synDoor, (x0 + x1) * 0.5, x1 - x0, pc.heightM, T, disposables);
        tagPickTarget(doorGroup, { type: 'adjacentRoom', id: pc.childRoomId });
        visualGroup.add(doorGroup);
        wallOverlay.add(swingArcGroup);
      }
    }

    for (const win of project.windows.filter((w) => w.wall === ws.side)) {
      const wM = Math.max(0.35, Math.min(ws.len - 0.16, win.widthCm / 100));
      const hM = Math.max(0.35, Math.min(H - 0.12, win.heightCm / 100));
      const sillM = Math.max(0.005, Math.min(H - hM - 0.06, win.sillHeightCm / 100));
      const rawCx = win.offsetCm / 100 - ws.len * 0.5;
      const cx = Math.max(-ws.len * 0.5 + wM * 0.5 + 0.08, Math.min(ws.len * 0.5 - wM * 0.5 - 0.08, rawCx));

      const x0 = cx - wM * 0.5;
      const x1 = cx + wM * 0.5;
      const y0 = sillM;
      const y1 = sillM + hM;
      const cand: HoleBox2D = { x0, x1, y0, y1 };
      if (acceptedHoles.some((hBox) => boxesOverlap(cand, hBox, 0.04))) {
        warnings.push(`${WALL_LABELS[ws.side]} üzerinde çakışan pencere kaydırılmalı.`);
        continue;
      }
      acceptedHoles.push(cand);
      if (y0 < 0.12) floorBreakSpans.push([x0 - 0.03, x1 + 0.03]);

      if (win.kind === 'round') addRoundHole(wallShape, cx, y0 + hM * 0.5, Math.min(wM, hM) * 0.5);
      else if (win.kind === 'oval') addOvalHole(wallShape, cx, y0 + hM * 0.5, wM * 0.5, hM * 0.5);
      else if (win.kind === 'arched') addArchedHole(wallShape, x0, y0, x1, y1);
      else addRectangularHole(wallShape, x0, y0, x1, y1);

      visualGroup.add(createWindowAssembly(win, cx, y0, wM, hM, T, H, coveOnWall, glassMat, disposables));
    }

    for (const door of project.doors.filter((d) => d.wall === ws.side)) {
      const wM = Math.max(0.65, Math.min(ws.len - 0.16, door.widthCm / 100));
      const hM = Math.max(1.85, Math.min(H - 0.08, door.heightCm / 100));
      const rawCx = door.offsetCm / 100 - ws.len * 0.5;
      const cx = Math.max(-ws.len * 0.5 + wM * 0.5 + 0.08, Math.min(ws.len * 0.5 - wM * 0.5 - 0.08, rawCx));

      const x0 = cx - wM * 0.5;
      const x1 = cx + wM * 0.5;
      const cand: HoleBox2D = { x0, x1, y0: 0.005, y1: hM };
      if (acceptedHoles.some((hBox) => boxesOverlap(cand, hBox, 0.04))) {
        warnings.push(`${WALL_LABELS[ws.side]} üzerinde çakışan kapı kaydırılmalı.`);
        continue;
      }
      acceptedHoles.push(cand);
      floorBreakSpans.push([x0 - 0.05, x1 + 0.05]);

      if (door.kind === 'archway') addArchedHole(wallShape, x0, 0.005, x1, hM);
      else addRectangularHole(wallShape, x0, 0.005, x1, hM);

      const { doorGroup, swingArcGroup } = createDoorAssembly(door, cx, wM, hM, T, disposables);
      visualGroup.add(doorGroup);
      wallOverlay.add(swingArcGroup);
    }

    const wallGeo = new THREE.ExtrudeGeometry(wallShape, { depth: wallDepth, bevelEnabled: false, curveSegments: 24 });
    wallGeo.translate(0, 0, -wallDepth);
    disposables.push(() => wallGeo.dispose());

    const wFinish = project.walls[ws.side];
    const wTex = createWallTexture(wFinish.pattern, wFinish.colorHex);
    const faceMat = new THREE.MeshStandardMaterial({
      map: wTex,
      roughness: wFinish.pattern === 'mirror' ? 0.1 : wFinish.pattern === 'marble' ? 0.28 : 0.86,
      metalness: wFinish.pattern === 'mirror' ? 0.85 : 0.02,
    });
    const revealMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wFinish.colorHex).multiplyScalar(0.96),
      roughness: 0.88,
    });
    disposables.push(() => {
      faceMat.dispose();
      revealMat.dispose();
    });

    const wallMesh = new THREE.Mesh(wallGeo, [faceMat, revealMat]);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    wallMesh.userData.pickTarget = { type: 'wall', wall: ws.side } satisfies ArchSelection;
    visualGroup.add(wallMesh);

    const shadowGhost = new THREE.Mesh(wallGeo, shadowOnlyMat);
    shadowGhost.castShadow = true;
    shadowGhost.visible = false;
    shadowGhost.raycast = () => {};
    wallHolder.add(shadowGhost);

    // Partial Wall Zones (Duvarın sadece bir kısmına ahşap çıta, mermer, ayna, farklı boya vs.!)
    for (const zone of (project.wallZones || []).filter((z) => z.wall === ws.side)) {
      const zw = Math.max(0.2, Math.min(ws.len, zone.widthCm / 100));
      const zh = Math.max(0.2, Math.min(H, zone.heightCm / 100));
      const zBot = Math.max(0, Math.min(H - zh, zone.bottomCm / 100));
      const rawCx = zone.offsetCm / 100 - ws.len * 0.5;
      const zCx = Math.max(-ws.len * 0.5 + zw * 0.5, Math.min(ws.len * 0.5 - zw * 0.5, rawCx));

      const repeatScale = zone.pattern === 'slats' ? 1.15 : zone.pattern === 'boiserie' ? 0.65 : 0.72;
      const zTex = createWallTexture(zone.pattern, zone.colorHex, zw * repeatScale, zh * repeatScale);
      const zMat = new THREE.MeshStandardMaterial({
        map: zTex,
        roughness: zone.pattern === 'mirror' ? 0.08 : zone.pattern === 'marble' ? 0.26 : zone.pattern === 'slats' ? 0.68 : 0.84,
        metalness: zone.pattern === 'mirror' ? 0.88 : 0.03,
      });
      const zGeo = new THREE.BoxGeometry(zw, zh, zone.pattern === 'slats' ? 0.022 : 0.012);
      disposables.push(() => {
        zMat.dispose();
        zGeo.dispose();
      });
      const zMesh = new THREE.Mesh(zGeo, zMat);
      zMesh.position.set(zCx, zBot + zh * 0.5, zone.pattern === 'slats' ? 0.012 : 0.007);
      zMesh.receiveShadow = true;
      zMesh.userData.pickTarget = { type: 'wallZone', id: zone.id } satisfies ArchSelection;
      visualGroup.add(zMesh);
    }

    // Segmented interior baseboard (AGT / Floorpan / VarioClic adjustable profile height!)
    if (project.showBaseboard) {
      floorBreakSpans.sort((a, b) => a[0] - b[0]);
      let cursor = -ws.len * 0.5;
      const addBbSeg = (a: number, b: number) => {
        if (b - a < 0.04) return;
        const g = new THREE.BoxGeometry(b - a, baseboardH, 0.018);
        const capG = new THREE.BoxGeometry(b - a, 0.014, 0.022);
        disposables.push(() => {
          g.dispose();
          capG.dispose();
        });
        const m = new THREE.Mesh(g, baseboardMat);
        m.position.set((a + b) * 0.5, baseboardH * 0.5, 0.009);
        m.receiveShadow = true;
        m.userData.pickTarget = { type: 'floor' } satisfies ArchSelection;
        visualGroup.add(m);
        const cap = new THREE.Mesh(capG, baseboardMat);
        cap.position.set((a + b) * 0.5, baseboardH - 0.007, 0.011);
        cap.raycast = () => {};
        visualGroup.add(cap);
      };
      for (const [bx0, bx1] of floorBreakSpans) {
        if (bx0 > cursor) addBbSeg(cursor, Math.min(bx0, ws.len * 0.5));
        cursor = Math.max(cursor, bx1);
      }
      if (cursor < ws.len * 0.5) addBbSeg(cursor, ws.len * 0.5);
    }

    // Interior vertical corner trim profiles (AGT / Starwood Köşelik Profilleri) at both ends of each wall!
    if (project.showCornerTrim !== false) {
      const trimW = 0.032;
      const trimD = 0.016;
      const trimGeo = new THREE.BoxGeometry(trimW, H, trimD);
      disposables.push(() => trimGeo.dispose());
      for (const endX of [-ws.len * 0.5 + trimW * 0.5, ws.len * 0.5 - trimW * 0.5]) {
        const tm = new THREE.Mesh(trimGeo, cornerTrimMat);
        tm.position.set(endX, H * 0.5, trimD * 0.5);
        tm.receiveShadow = true;
        tm.raycast = () => {};
        visualGroup.add(tm);
      }
    }

    if (coveOnWall) {
      visualGroup.add(buildCurtainCoveOnWall(coveOnWall, ws.len, H, disposables));
    }

    // Only exterior perimeter walls auto-cutaway in 3D view; interior partition walls stay solid like an architectural dollhouse!
    if (!isShared) {
      walls.push({
        side: ws.side,
        visualGroup,
        shadowGhost,
        inwardNormal: new THREE.Vector3(...ws.inward),
        center: new THREE.Vector3(ws.pos[0], H * 0.5, ws.pos[2]),
      });
    }
  }

  // 2.5) SIMS-STYLE ADJACENT CONNECTED ROOMS (3+1 / 2+1 / 1+1 & custom attached rooms!)
  const ceilingVisualGroup = new THREE.Group();
  roomRoot.add(ceilingVisualGroup);
  const ceilingShadowGhost = new THREE.Group();
  roomRoot.add(ceilingShadowGhost);

  for (const adj of adjacentRooms) {
    const rW = adj.widthM;
    const rD = adj.depthM;
    const rCx = adj.centerXM;
    const rCz = adj.centerZM;

    // Room-specific floor surface
    const adjFloorTex = createFloorTexture(adj.floorMaterial, adj.floorTintHex, rW, rD);
    const adjFloorRough =
      adj.floorMaterial === 'marble'
        ? 0.22
        : adj.floorMaterial === 'travertine'
        ? 0.44
        : adj.floorMaterial === 'terrazzo'
        ? 0.36
        : 0.66;
    const adjFloorGeo = new THREE.PlaneGeometry(rW, rD);
    const adjFloorMat = new THREE.MeshStandardMaterial({ map: adjFloorTex, roughness: adjFloorRough, metalness: 0.04 });
    const adjSlabGeo = new THREE.BoxGeometry(rW + T * 2 + 0.04, 0.14, rD + T * 2 + 0.04);
    disposables.push(() => {
      adjFloorGeo.dispose();
      adjFloorMat.dispose();
      adjSlabGeo.dispose();
    });

    const adjFloor = new THREE.Mesh(adjFloorGeo, adjFloorMat);
    adjFloor.rotation.x = -Math.PI / 2;
    adjFloor.position.set(rCx, 0, rCz);
    adjFloor.receiveShadow = true;
    adjFloor.userData.pickTarget = { type: 'adjacentRoom', id: adj.id } satisfies ArchSelection;
    roomRoot.add(adjFloor);

    const adjSlab = new THREE.Mesh(adjSlabGeo, slabMat);
    adjSlab.position.set(rCx, -0.095, rCz);
    adjSlab.receiveShadow = true;
    adjSlab.raycast = () => {};
    roomRoot.add(adjSlab);

    // Room-specific wall materials & baseboard
    const adjWallTex = createWallTexture(adj.wallPattern, adj.wallColorHex);
    const adjFaceMat = new THREE.MeshStandardMaterial({
      map: adjWallTex,
      roughness: adj.wallPattern === 'mirror' ? 0.1 : adj.wallPattern === 'marble' ? 0.28 : 0.86,
      metalness: adj.wallPattern === 'mirror' ? 0.85 : 0.02,
    });
    const adjRevealMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(adj.wallColorHex).multiplyScalar(0.95),
      roughness: 0.88,
    });
    const adjBbMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(adj.baseboardColorHex || project.baseboardColorHex),
      roughness: 0.55,
    });
    disposables.push(() => {
      adjFaceMat.dispose();
      adjRevealMat.dispose();
      adjBbMat.dispose();
    });

    const adjShared: Record<WallId, boolean> = {
      north: isWallSharedPartition(adj.id, 'north'),
      south: isWallSharedPartition(adj.id, 'south'),
      east: isWallSharedPartition(adj.id, 'east'),
      west: isWallSharedPartition(adj.id, 'west'),
    };

    const adjWallSpecs: Array<{
      side: WallId;
      len: number;
      extendCorners: boolean;
      pos: [number, number, number];
      rotY: number;
      inward: [number, number, number];
    }> = [
      { side: 'north', len: rW, extendCorners: true, pos: [rCx, 0, rCz - rD * 0.5], rotY: 0, inward: [0, 0, 1] },
      { side: 'south', len: rW, extendCorners: true, pos: [rCx, 0, rCz + rD * 0.5], rotY: Math.PI, inward: [0, 0, -1] },
      { side: 'west', len: rD, extendCorners: false, pos: [rCx - rW * 0.5, 0, rCz], rotY: Math.PI / 2, inward: [1, 0, 0] },
      { side: 'east', len: rD, extendCorners: false, pos: [rCx + rW * 0.5, 0, rCz], rotY: -Math.PI / 2, inward: [-1, 0, 0] },
    ];

    for (const aws of adjWallSpecs) {
      const aHolder = new THREE.Group();
      aHolder.position.set(...aws.pos);
      aHolder.rotation.y = aws.rotY;
      roomRoot.add(aHolder);

      const aVis = new THREE.Group();
      aHolder.add(aVis);

      const aOverlay = new THREE.Group();
      aOverlay.position.set(...aws.pos);
      aOverlay.rotation.y = aws.rotY;
      planOverlayGroup.add(aOverlay);

      const isShared = adjShared[aws.side];
      const wDepth = isShared ? halfT : T;
      const leftExt = aws.extendCorners
        ? aws.side === 'north'
          ? adjShared.west
            ? halfT
            : T
          : adjShared.east
          ? halfT
          : T
        : 0;
      const rightExt = aws.extendCorners
        ? aws.side === 'north'
          ? adjShared.east
            ? halfT
            : T
          : adjShared.west
          ? halfT
          : T
        : 0;

      const aShape = new THREE.Shape();
      aShape.moveTo(-aws.len * 0.5 - leftExt, 0);
      aShape.lineTo(aws.len * 0.5 + rightExt, 0);
      aShape.lineTo(aws.len * 0.5 + rightExt, H);
      aShape.lineTo(-aws.len * 0.5 - leftExt, H);
      aShape.closePath();

      const aBreaks: Array<[number, number]> = [];
      const aHoles: HoleBox2D[] = [];

      // Passages on this adjacent room wall
      for (const pc of passageCuts.filter((c) => c.roomId === adj.id && c.side === aws.side)) {
        const x0 = Math.max(-aws.len * 0.5 + 0.06, pc.localCx - pc.widthM * 0.5);
        const x1 = Math.min(aws.len * 0.5 - 0.06, pc.localCx + pc.widthM * 0.5);
        if (x1 - x0 < 0.55) continue;
        aHoles.push({ x0, x1, y0: 0.005, y1: pc.heightM });
        aBreaks.push([x0 - 0.04, x1 + 0.04]);
        if (pc.style === 'open_arch') addArchedHole(aShape, x0, 0.005, x1, pc.heightM);
        else addRectangularHole(aShape, x0, 0.005, x1, pc.heightM);

        if (pc.renderAssembly) {
          const synDoor: ArchDoor = {
            id: `passage-${pc.childRoomId}`,
            wall: aws.side,
            kind: pc.style === 'door' ? 'single' : 'archway',
            offsetCm: Math.round(((x0 + x1) * 0.5 + aws.len * 0.5) * 100),
            widthCm: Math.round((x1 - x0) * 100),
            heightCm: Math.round(pc.heightM * 100),
            swing: 'outward',
            hinge: 'left',
            openAngleDeg: 58,
            colorHex: '#ede9e0',
            handleColorHex: '#232325',
            panelStyle: 'modern',
          };
          const { doorGroup, swingArcGroup } = createDoorAssembly(synDoor, (x0 + x1) * 0.5, x1 - x0, pc.heightM, T, disposables);
          tagPickTarget(doorGroup, { type: 'adjacentRoom', id: pc.childRoomId });
          aVis.add(doorGroup);
          aOverlay.add(swingArcGroup);
        }
      }

      // Optional exterior facade window for bedroom / kitchen / office / balcony
      if (adj.hasWindow && !isShared && adj.windowWall === aws.side && aws.len >= 1.6) {
        const winW = Math.min(aws.len - 0.65, adj.roomKind === 'kitchen' ? 1.5 : 1.75);
        const winH = Math.min(1.5, H - 0.95);
        const sillY = adj.roomKind === 'kitchen' ? 1.05 : 0.85;
        const cand: HoleBox2D = { x0: -winW * 0.5, x1: winW * 0.5, y0: sillY, y1: sillY + winH };
        if (!aHoles.some((h) => boxesOverlap(cand, h, 0.05))) {
          addRectangularHole(aShape, cand.x0, cand.y0, cand.x1, cand.y1);
          const synWin: ArchWindow = {
            id: `win-${adj.id}`,
            wall: aws.side,
            kind: 'double',
            offsetCm: Math.round(aws.len * 50),
            widthCm: Math.round(winW * 100),
            heightCm: Math.round(winH * 100),
            sillHeightCm: Math.round(sillY * 100),
            frameColorHex: '#26282c',
            hasSill: true,
            curtainStyle: adj.roomKind === 'bedroom' ? 'sheer_and_drape' : 'none',
            curtainColorHex: '#dfd8cc',
            curtainOpenRatio: 0.75,
          };
          const winGrp = createWindowAssembly(synWin, 0, sillY, winW, winH, T, H, undefined, glassMat, disposables);
          tagPickTarget(winGrp, { type: 'adjacentRoom', id: adj.id });
          aVis.add(winGrp);
        }
      }

      const aWallGeo = new THREE.ExtrudeGeometry(aShape, { depth: wDepth, bevelEnabled: false, curveSegments: 20 });
      aWallGeo.translate(0, 0, -wDepth);
      disposables.push(() => aWallGeo.dispose());

      const aWallMesh = new THREE.Mesh(aWallGeo, [adjFaceMat, adjRevealMat]);
      aWallMesh.castShadow = true;
      aWallMesh.receiveShadow = true;
      aWallMesh.userData.pickTarget = { type: 'adjacentRoom', id: adj.id } satisfies ArchSelection;
      aVis.add(aWallMesh);

      const aGhost = new THREE.Mesh(aWallGeo, shadowOnlyMat);
      aGhost.castShadow = true;
      aGhost.visible = false;
      aGhost.raycast = () => {};
      aHolder.add(aGhost);

      if (project.showBaseboard && adj.roomKind !== 'bathroom') {
        aBreaks.sort((a, b) => a[0] - b[0]);
        let cur = -aws.len * 0.5;
        const addAdjBb = (a: number, b: number) => {
          if (b - a < 0.04) return;
          const bg = new THREE.BoxGeometry(b - a, baseboardH, 0.016);
          disposables.push(() => bg.dispose());
          const bm = new THREE.Mesh(bg, adjBbMat);
          bm.position.set((a + b) * 0.5, baseboardH * 0.5, 0.008);
          bm.receiveShadow = true;
          bm.raycast = () => {};
          aVis.add(bm);
        };
        for (const [bx0, bx1] of aBreaks) {
          if (bx0 > cur) addAdjBb(cur, Math.min(bx0, aws.len * 0.5));
          cur = Math.max(cur, bx1);
        }
        if (cur < aws.len * 0.5) addAdjBb(cur, aws.len * 0.5);
      }

      // Exterior walls of adjacent rooms also cutaway dynamically so every room in a 3+1 opens cleanly toward camera!
      if (!isShared) {
        walls.push({
          side: aws.side,
          visualGroup: aVis,
          shadowGhost: aGhost,
          inwardNormal: new THREE.Vector3(...aws.inward),
          center: new THREE.Vector3(aws.pos[0], H * 0.5, aws.pos[2]),
        });
      }
    }

    // Room ceiling panel & shadow blocker
    const adjCeilGeo = new THREE.BoxGeometry(rW + T * 2, 0.08, rD + T * 2);
    const adjCeilMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(project.ceilingColorHex), roughness: 0.9 });
    disposables.push(() => {
      adjCeilGeo.dispose();
      adjCeilMat.dispose();
    });
    const adjCeil = new THREE.Mesh(adjCeilGeo, adjCeilMat);
    adjCeil.position.set(rCx, H + 0.04, rCz);
    adjCeil.castShadow = true;
    adjCeil.receiveShadow = true;
    adjCeil.raycast = () => {};
    ceilingVisualGroup.add(adjCeil);

    const adjCeilGhost = new THREE.Mesh(adjCeilGeo, shadowOnlyMat);
    adjCeilGhost.position.set(rCx, H + 0.04, rCz);
    adjCeilGhost.castShadow = true;
    adjCeilGhost.raycast = () => {};
    ceilingShadowGhost.add(adjCeilGhost);
  }

  // 3) Columns
  for (const col of project.columns) {
    const colW = Math.max(0.15, Math.min(1.6, col.widthCm / 100));
    const colD = Math.max(0.15, Math.min(1.6, col.depthCm / 100));
    const colX = Math.max(-W * 0.5 + colW * 0.5, Math.min(W * 0.5 - colW * 0.5, col.xCm / 100));
    const colZ = Math.max(-D * 0.5 + colD * 0.5, Math.min(D * 0.5 - colD * 0.5, col.zCm / 100));

    const colMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col.colorHex), roughness: 0.86 });
    const geo = col.shape === 'round' ? new THREE.CylinderGeometry(0.5, 0.5, H, 28) : new THREE.BoxGeometry(colW, H, colD);
    disposables.push(() => {
      colMat.dispose();
      geo.dispose();
    });
    const mesh = new THREE.Mesh(geo, colMat);
    if (col.shape === 'round') mesh.scale.set(colW, 1, colD);
    mesh.position.set(colX, H * 0.5, colZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pickTarget = { type: 'column', id: col.id } satisfies ArchSelection;
    roomRoot.add(mesh);

    if (project.showBaseboard && col.shape === 'rect') {
      const bGeo = new THREE.BoxGeometry(colW + 0.02, baseboardH, colD + 0.02);
      disposables.push(() => bGeo.dispose());
      const bm = new THREE.Mesh(bGeo, baseboardMat);
      bm.position.set(colX, baseboardH * 0.5, colZ);
      bm.raycast = () => {};
      roomRoot.add(bm);
    }
    if (project.showCornerTrim !== false && col.shape === 'rect') {
      const cTrimGeo = new THREE.BoxGeometry(0.026, H, 0.026);
      disposables.push(() => cTrimGeo.dispose());
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ct = new THREE.Mesh(cTrimGeo, cornerTrimMat);
          ct.position.set(colX + sx * (colW * 0.5 + 0.004), H * 0.5, colZ + sz * (colD * 0.5 + 0.004));
          ct.raycast = () => {};
          roomRoot.add(ct);
        }
      }
    }
  }

  // 4) Ceiling Beams (wall-adjacent beams attach to wall visualGroup so they cut away cleanly!)
  for (const beam of project.beams) {
    const bw = Math.max(0.12, Math.min(0.9, beam.widthCm / 100));
    const drop = Math.max(0.1, Math.min(0.8, beam.dropCm / 100));
    const bMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(beam.colorHex), roughness: 0.85 });
    let geo: THREE.BufferGeometry;
    let px = 0;
    let pz = 0;
    let hostWall: WallId | null = null;
    if (beam.axis === 'x') {
      geo = new THREE.BoxGeometry(W, drop, bw);
      pz = Math.max(-D * 0.5 + bw * 0.5, Math.min(D * 0.5 - bw * 0.5, beam.positionCm / 100));
      if (pz <= -D * 0.5 + bw * 0.5 + 0.18) hostWall = 'north';
      else if (pz >= D * 0.5 - bw * 0.5 - 0.18) hostWall = 'south';
    } else {
      geo = new THREE.BoxGeometry(bw, drop, D);
      px = Math.max(-W * 0.5 + bw * 0.5, Math.min(W * 0.5 - bw * 0.5, beam.positionCm / 100));
      if (px <= -W * 0.5 + bw * 0.5 + 0.18) hostWall = 'west';
      else if (px >= W * 0.5 - bw * 0.5 - 0.18) hostWall = 'east';
    }
    disposables.push(() => {
      bMat.dispose();
      geo.dispose();
    });
    const bm = new THREE.Mesh(geo, bMat);
    bm.castShadow = true;
    bm.receiveShadow = true;
    bm.userData.pickTarget = { type: 'beam', id: beam.id } satisfies ArchSelection;

    const wallRef = hostWall ? walls.find((w) => w.side === hostWall) : null;
    if (wallRef) {
      if (hostWall === 'north') bm.position.set(px, H - drop * 0.5, pz + D * 0.5);
      else if (hostWall === 'south') bm.position.set(-px, H - drop * 0.5, D * 0.5 - pz);
      else if (hostWall === 'west') {
        bm.rotation.y = -Math.PI / 2;
        bm.position.set(-pz, H - drop * 0.5, px + W * 0.5);
      } else if (hostWall === 'east') {
        bm.rotation.y = Math.PI / 2;
        bm.position.set(pz, H - drop * 0.5, W * 0.5 - px);
      }
      wallRef.visualGroup.add(bm);
    } else {
      bm.position.set(px, H - drop * 0.5, pz);
      roomRoot.add(bm);
    }
  }

  // 4.5) 2nd Floor / Architectural Mezzanine Loft Platform (Asma Kat)
  const mezBounds = getMezzanineBounds(project);
  if (mezBounds && project.mezzanine?.enabled) {
    const mez = project.mezzanine;
    const mezGroup = new THREE.Group();
    const cx = (mezBounds.minX + mezBounds.maxX) * 0.5;
    const cz = (mezBounds.minZ + mezBounds.maxZ) * 0.5;
    const mw = mezBounds.widthM;
    const md = mezBounds.depthM;
    const th = mezBounds.thickM;

    const deckTex = createFloorTexture(project.floorMaterial, mez.deckColorHex || project.floorTintHex, mw, md);
    const deckTopMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.62, metalness: 0.04 });
    const fasciaMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(mez.deckColorHex || '#bfa486').multiplyScalar(0.84),
      roughness: 0.72,
    });
    const underMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(project.ceilingColorHex || '#ece9e1').multiplyScalar(0.92),
      roughness: 0.9,
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x262524, roughness: 0.38, metalness: 0.72 });

    const slabGeo = new THREE.BoxGeometry(mw, th, md);
    const topGeo = new THREE.PlaneGeometry(mw, md);
    disposables.push(() => {
      deckTopMat.dispose();
      fasciaMat.dispose();
      underMat.dispose();
      steelMat.dispose();
      slabGeo.dispose();
      topGeo.dispose();
    });

    // Main mezzanine structural deck body
    const slabMesh = new THREE.Mesh(slabGeo, [fasciaMat, fasciaMat, deckTopMat, underMat, fasciaMat, fasciaMat]);
    slabMesh.position.set(cx, mezBounds.bottomY + th * 0.5, cz);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    mezGroup.add(slabMesh);

    // Crisp top floor surface slightly proud for sharp shadow & grain
    const topMesh = new THREE.Mesh(topGeo, deckTopMat);
    topMesh.rotation.x = -Math.PI / 2;
    topMesh.position.set(cx, mezBounds.topY + 0.002, cz);
    topMesh.receiveShadow = true;
    mezGroup.add(topMesh);

    // Subtle recessed warm LED strip & under-loft cozy glow
    if (mez.underLed) {
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xffe0ad });
      const stripLen = mez.anchorWall === 'north' || mez.anchorWall === 'south' ? mw - 0.16 : md - 0.16;
      const stripGeo =
        mez.anchorWall === 'north' || mez.anchorWall === 'south'
          ? new THREE.BoxGeometry(stripLen, 0.014, 0.025)
          : new THREE.BoxGeometry(0.025, 0.014, stripLen);
      const underLight = new THREE.PointLight(0xffdfb0, 0.75, Math.max(mw, md) * 1.9, 1.6);
      underLight.position.set(cx, mezBounds.bottomY - 0.16, cz);
      disposables.push(() => {
        ledMat.dispose();
        stripGeo.dispose();
      });
      const strip = new THREE.Mesh(stripGeo, ledMat);
      if (mez.anchorWall === 'north') strip.position.set(cx, mezBounds.bottomY - 0.004, mezBounds.maxZ - 0.14);
      else if (mez.anchorWall === 'south') strip.position.set(cx, mezBounds.bottomY - 0.004, mezBounds.minZ + 0.14);
      else if (mez.anchorWall === 'west') strip.position.set(mezBounds.maxX - 0.14, mezBounds.bottomY - 0.004, cz);
      else strip.position.set(mezBounds.minX + 0.14, mezBounds.bottomY - 0.004, cz);
      mezGroup.add(strip);
      mezGroup.add(underLight);
    }

    // Optional architectural safety railing along the open front edge
    if (mez.railingStyle !== 'none') {
      const railH = 0.92;
      const isHoriz = mez.anchorWall === 'north' || mez.anchorWall === 'south';
      const railLen = isHoriz ? mw : md;
      const edgeX = mez.anchorWall === 'west' ? mezBounds.maxX - 0.03 : mez.anchorWall === 'east' ? mezBounds.minX + 0.03 : cx;
      const edgeZ = mez.anchorWall === 'north' ? mezBounds.maxZ - 0.03 : mez.anchorWall === 'south' ? mezBounds.minZ + 0.03 : cz;

      // Top sleek matte-black handrail
      const topBarGeo = isHoriz
        ? new THREE.BoxGeometry(railLen, 0.036, 0.044)
        : new THREE.BoxGeometry(0.044, 0.036, railLen);
      disposables.push(() => topBarGeo.dispose());
      const topBar = new THREE.Mesh(topBarGeo, steelMat);
      topBar.position.set(edgeX, mezBounds.topY + railH, edgeZ);
      topBar.castShadow = true;
      mezGroup.add(topBar);

      if (mez.railingStyle === 'glass') {
        const panelGeo = isHoriz
          ? new THREE.BoxGeometry(railLen - 0.04, railH - 0.06, 0.014)
          : new THREE.BoxGeometry(0.014, railH - 0.06, railLen - 0.04);
        disposables.push(() => panelGeo.dispose());
        const panel = new THREE.Mesh(panelGeo, glassMat);
        panel.position.set(edgeX, mezBounds.topY + railH * 0.5, edgeZ);
        mezGroup.add(panel);
      } else {
        // Minimalist vertical black steel balusters
        const postGeo = new THREE.BoxGeometry(0.022, railH, 0.022);
        disposables.push(() => postGeo.dispose());
        const count = Math.max(4, Math.round(railLen / 0.16));
        for (let i = 0; i <= count; i++) {
          const frac = i / count - 0.5;
          const post = new THREE.Mesh(postGeo, steelMat);
          post.position.set(
            isHoriz ? edgeX + frac * (railLen - 0.08) : edgeX,
            mezBounds.topY + railH * 0.5,
            isHoriz ? edgeZ : edgeZ + frac * (railLen - 0.08)
          );
          post.castShadow = true;
          mezGroup.add(post);
        }
      }
    }

    roomRoot.add(mezGroup);
  }

  // 5) Ceiling + Shadow Roof Blocker + Single Balanced Interior Fill Light (60 FPS friendly!)
  const ceilGeo = new THREE.BoxGeometry(W + T * 2, 0.08, D + T * 2);
  const ceilMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(project.ceilingColorHex), roughness: 0.9 });
  disposables.push(() => {
    ceilGeo.dispose();
    ceilMat.dispose();
  });
  const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
  ceilMesh.position.y = H + 0.04;
  ceilMesh.castShadow = true;
  ceilMesh.receiveShadow = true;
  ceilMesh.raycast = () => {};
  ceilingVisualGroup.add(ceilMesh);

  const primaryCeilShadowGhost = new THREE.Mesh(ceilGeo, shadowOnlyMat);
  primaryCeilShadowGhost.position.y = H + 0.04;
  primaryCeilShadowGhost.castShadow = true;
  primaryCeilShadowGhost.raycast = () => {};
  ceilingShadowGhost.add(primaryCeilShadowGhost);

  let interiorFillLight: THREE.PointLight | null = null;
  const hasCoveLed = project.curtainCoves.some((c) => c.ledEnabled);
  if (project.recessedSpots || hasCoveLed) {
    const lightHex = project.recessedSpots ? project.spotWarmthHex : project.curtainCoves.find((c) => c.ledEnabled)?.ledColorHex || '#ffe7c2';
    interiorFillLight = new THREE.PointLight(new THREE.Color(lightHex), 0.85, Math.max(W, D) * 2.1, 1.5);
    interiorFillLight.position.set(0, H - 0.28, 0);
    roomRoot.add(interiorFillLight);
  }

  if (project.recessedSpots) {
    const spotCol = new THREE.Color(project.spotWarmthHex);
    const spotRingMat = new THREE.MeshStandardMaterial({ color: 0xe2dfd8, roughness: 0.4, metalness: 0.3 });
    const spotGlowMat = new THREE.MeshBasicMaterial({ color: spotCol });
    const ringGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 16);
    const bulbGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.014, 14);
    disposables.push(() => {
      spotRingMat.dispose();
      spotGlowMat.dispose();
      ringGeo.dispose();
      bulbGeo.dispose();
    });

    const nx = W >= 5.0 ? 3 : 2;
    const nz = D >= 5.0 ? 3 : 2;
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const sx = -W * 0.32 + (W * 0.64 * ix) / Math.max(1, nx - 1);
        const sz = -D * 0.32 + (D * 0.64 * iz) / Math.max(1, nz - 1);
        const ring = new THREE.Mesh(ringGeo, spotRingMat);
        ring.position.set(sx, H - 0.005, sz);
        ring.raycast = () => {};
        ceilingVisualGroup.add(ring);
        const bulb = new THREE.Mesh(bulbGeo, spotGlowMat);
        bulb.position.set(sx, H - 0.008, sz);
        bulb.raycast = () => {};
        ceilingVisualGroup.add(bulb);
      }
    }
  }

  // 6) 50cm Architectural Floor Grid (covers primary + all connected rooms!)
  const gridVerts: number[] = [];
  for (const box of allRoomBoxes) {
    const x0 = box.cx - box.w * 0.5;
    const x1 = box.cx + box.w * 0.5;
    const z0 = box.cz - box.d * 0.5;
    const z1 = box.cz + box.d * 0.5;
    for (let x = Math.ceil(x0 / 0.5) * 0.5; x <= x1 + 1e-4; x += 0.5) gridVerts.push(x, 0.004, z0, x, 0.004, z1);
    for (let z = Math.ceil(z0 / 0.5) * 0.5; z <= z1 + 1e-4; z += 0.5) gridVerts.push(x0, 0.004, z, x1, 0.004, z);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: 0x3b3832, transparent: true, opacity: 0.13 });
  disposables.push(() => {
    gridGeo.dispose();
    gridMat.dispose();
  });
  const gridHelper = new THREE.LineSegments(gridGeo, gridMat);
  gridHelper.raycast = () => {};
  roomRoot.add(gridHelper);

  // 7) Exterior Compass Ring & 2D Plan Dimension Badges (scales cleanly to full multi-room apartment!)
  const compassRingGroup = new THREE.Group();
  compassRingGroup.position.set(houseBounds.centerX, 0, houseBounds.centerZ);
  const compassR = Math.max(houseBounds.totalW, houseBounds.totalD) * 0.64 + 0.85;
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.sin(a) * compassR, -0.05, -Math.cos(a) * compassR));
  }
  const cRingGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const cRingMat = new THREE.LineBasicMaterial({ color: 0x78716c, transparent: true, opacity: 0.28 });
  const northConeGeo = new THREE.ConeGeometry(0.18, 0.46, 4);
  northConeGeo.rotateX(-Math.PI / 2);
  const northConeMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
  disposables.push(() => {
    cRingGeo.dispose();
    cRingMat.dispose();
    northConeGeo.dispose();
    northConeMat.dispose();
  });
  const cLine = new THREE.Line(cRingGeo, cRingMat);
  cLine.raycast = () => {};
  compassRingGroup.add(cLine);
  const northArrow = new THREE.Mesh(northConeGeo, northConeMat);
  northArrow.position.set(0, -0.03, -compassR - 0.16);
  northArrow.raycast = () => {};
  compassRingGroup.add(northArrow);
  roomRoot.add(compassRingGroup);

  const makeWallBadge = (text: string, px: number, pz: number, rotZ: number, planeW = 1.55, planeH = 0.29) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 96;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(10, 12, 492, 72);
      ctx.strokeStyle = 'rgba(28,25,23,0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 12, 492, 72);
      ctx.fillStyle = '#1c1917';
      ctx.font = '700 32px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 50);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    disposables.push(() => {
      tex.dispose();
      mat.dispose();
      geo.dispose();
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rotZ;
    m.position.set(px, H + 0.04, pz);
    m.raycast = () => {};
    planLabelsGroup.add(m);
  };

  const apronOff = T + 0.5;
  makeWallBadge(
    `KARŞI DUVAR (${Math.round(houseBounds.totalW * 100)} cm)`,
    houseBounds.centerX,
    houseBounds.minZ - apronOff,
    0,
    hasMultiRoom ? 2.2 : 1.75,
    hasMultiRoom ? 0.42 : 0.3
  );
  makeWallBadge(
    `ÖN DUVAR (${Math.round(houseBounds.totalW * 100)} cm)`,
    houseBounds.centerX,
    houseBounds.maxZ + apronOff,
    0,
    hasMultiRoom ? 2.2 : 1.75,
    hasMultiRoom ? 0.42 : 0.3
  );
  makeWallBadge(
    `SOL DUVAR (${Math.round(houseBounds.totalD * 100)} cm)`,
    houseBounds.minX - apronOff,
    houseBounds.centerZ,
    Math.PI / 2,
    hasMultiRoom ? 2.2 : 1.75,
    hasMultiRoom ? 0.42 : 0.3
  );
  makeWallBadge(
    `SAĞ DUVAR (${Math.round(houseBounds.totalD * 100)} cm)`,
    houseBounds.maxX + apronOff,
    houseBounds.centerZ,
    -Math.PI / 2,
    hasMultiRoom ? 2.2 : 1.75,
    hasMultiRoom ? 0.42 : 0.3
  );

  // Room interior name + m² tags in 2D Plan view when multi-room apartment is active!
  if (hasMultiRoom) {
    const makeRoomPlanTag = (title: string, areaM2: number, rx: number, rz: number, maxW: number) => {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 128;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(28,25,23,0.88)';
        ctx.fillRect(8, 12, 496, 104);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.toUpperCase().slice(0, 18), 256, 48);
        ctx.fillStyle = '#d6d3d1';
        ctx.font = '600 26px "JetBrains Mono", monospace';
        ctx.fillText(`${areaM2.toFixed(1)} m²`, 256, 88);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      const pw = Math.min(maxW - 0.25, 1.95);
      const ph = pw * 0.25;
      const geo = new THREE.PlaneGeometry(pw, ph);
      disposables.push(() => {
        tex.dispose();
        mat.dispose();
        geo.dispose();
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(rx, H + 0.05, rz);
      m.raycast = () => {};
      planLabelsGroup.add(m);
    };

    makeRoomPlanTag('Ana Salon', W * D, 0, 0, W);
    for (const adj of adjacentRooms) {
      makeRoomPlanTag(adj.name, adj.widthM * adj.depthM, adj.centerXM, adj.centerZM, adj.widthM);
    }

    // Subtle, clean 3D floating room badges visible while orbiting multi-room apartments in 3B mode!
    const makeRoom3dSprite = (title: string, rx: number, rz: number) => {
      const cv = document.createElement('canvas');
      cv.width = 384;
      cv.height = 84;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(24, 24, 27, 0.78)';
        ctx.fillRect(6, 10, 372, 64);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 3;
        ctx.strokeRect(6, 10, 372, 64);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.slice(0, 18), 192, 43);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      disposables.push(() => {
        tex.dispose();
        mat.dispose();
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(rx, H + 0.24, rz);
      sp.scale.set(1.55, 0.34, 1);
      sp.raycast = () => {};
      room3dLabelsGroup.add(sp);
    };

    makeRoom3dSprite('Ana Salon', 0, 0);
    for (const adj of adjacentRooms) {
      makeRoom3dSprite(adj.name, adj.centerXM, adj.centerZM);
    }
  }

  return {
    walls,
    ceilingVisualGroup,
    ceilingShadowGhost,
    gridHelper,
    compassRingGroup,
    planOverlayGroup,
    planLabelsGroup,
    room3dLabelsGroup,
    interiorFillLight,
    warnings,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
