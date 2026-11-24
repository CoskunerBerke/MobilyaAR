import * as THREE from 'three';
import {
  type ArchCurtainCove,
  type ArchDoor,
  type ArchRoomProject,
  type ArchSelection,
  type ArchWindow,
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
  ceilingShadowGhost: THREE.Mesh;
  gridHelper: THREE.LineSegments;
  compassRingGroup: THREE.Group;
  planOverlayGroup: THREE.Group;
  planLabelsGroup: THREE.Group;
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
  glassMat: THREE.MeshPhysicalMaterial,
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

  const leafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.colorHex), roughness: 0.55, metalness: 0.04 });
  const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.colorHex).multiplyScalar(0.95), roughness: 0.5 });
  const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(door.handleColorHex), roughness: 0.3, metalness: 0.82 });
  const thresholdMat = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.35 });
  disposables.push(() => {
    leafMat.dispose();
    trimMat.dispose();
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
    addBox(pivot, panelW, clearH * 0.36, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.72, 0, trimMat);
    addBox(pivot, panelW, clearH * 0.32, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.26, 0, trimMat);

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
  slab.position.y = -0.072;
  slab.receiveShadow = true;
  slab.raycast = () => {};
  roomRoot.add(slab);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdcf0ff,
    transparent: true,
    opacity: 0.24,
    roughness: 0.06,
    metalness: 0.1,
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

  const baseboardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(project.baseboardColorHex), roughness: 0.65 });
  disposables.push(() => baseboardMat.dispose());

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

    const wallShape = new THREE.Shape();
    const xLeftExt = ws.extendCorners ? -ws.len * 0.5 - T : -ws.len * 0.5;
    const xRightExt = ws.extendCorners ? ws.len * 0.5 + T : ws.len * 0.5;
    wallShape.moveTo(xLeftExt, 0);
    wallShape.lineTo(xRightExt, 0);
    wallShape.lineTo(xRightExt, H);
    wallShape.lineTo(xLeftExt, H);
    wallShape.closePath();

    const acceptedHoles: HoleBox2D[] = [];
    const floorBreakSpans: Array<[number, number]> = [];
    const coveOnWall = project.curtainCoves.find((c) => c.wall === ws.side);

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
        warnings.push(`${ws.side.toUpperCase()} duvarında çakışan pencere kaydırılmalı.`);
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
        warnings.push(`${ws.side.toUpperCase()} duvarında çakışan kapı kaydırılmalı.`);
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

    const wallGeo = new THREE.ExtrudeGeometry(wallShape, { depth: T, bevelEnabled: false, curveSegments: 24 });
    wallGeo.translate(0, 0, -T);
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

    // Segmented interior baseboard
    if (project.showBaseboard) {
      floorBreakSpans.sort((a, b) => a[0] - b[0]);
      let cursor = -ws.len * 0.5;
      const addBbSeg = (a: number, b: number) => {
        if (b - a < 0.04) return;
        const g = new THREE.BoxGeometry(b - a, 0.095, 0.018);
        disposables.push(() => g.dispose());
        const m = new THREE.Mesh(g, baseboardMat);
        m.position.set((a + b) * 0.5, 0.0475, 0.009);
        m.receiveShadow = true;
        m.raycast = () => {};
        visualGroup.add(m);
      };
      for (const [bx0, bx1] of floorBreakSpans) {
        if (bx0 > cursor) addBbSeg(cursor, Math.min(bx0, ws.len * 0.5));
        cursor = Math.max(cursor, bx1);
      }
      if (cursor < ws.len * 0.5) addBbSeg(cursor, ws.len * 0.5);
    }

    if (coveOnWall) {
      visualGroup.add(buildCurtainCoveOnWall(coveOnWall, ws.len, H, disposables));
    }

    walls.push({
      side: ws.side,
      visualGroup,
      shadowGhost,
      inwardNormal: new THREE.Vector3(...ws.inward),
      center: new THREE.Vector3(ws.pos[0], H * 0.5, ws.pos[2]),
    });
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
      const bGeo = new THREE.BoxGeometry(colW + 0.02, 0.095, colD + 0.02);
      disposables.push(() => bGeo.dispose());
      const bm = new THREE.Mesh(bGeo, baseboardMat);
      bm.position.set(colX, 0.0475, colZ);
      bm.raycast = () => {};
      roomRoot.add(bm);
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

  // 5) Ceiling + Shadow Roof Blocker + Single Balanced Interior Fill Light (60 FPS friendly!)
  const ceilingVisualGroup = new THREE.Group();
  roomRoot.add(ceilingVisualGroup);

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

  const ceilingShadowGhost = new THREE.Mesh(ceilGeo, shadowOnlyMat);
  ceilingShadowGhost.position.y = H + 0.04;
  ceilingShadowGhost.castShadow = true;
  ceilingShadowGhost.raycast = () => {};
  roomRoot.add(ceilingShadowGhost);

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

  // 6) 50cm Architectural Floor Grid
  const gridVerts: number[] = [];
  const halfW = W * 0.5;
  const halfD = D * 0.5;
  for (let x = -Math.floor(halfW / 0.5) * 0.5; x <= halfW + 1e-4; x += 0.5) gridVerts.push(x, 0.004, -halfD, x, 0.004, halfD);
  for (let z = -Math.floor(halfD / 0.5) * 0.5; z <= halfD + 1e-4; z += 0.5) gridVerts.push(-halfW, 0.004, z, halfW, 0.004, z);
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

  // 7) Exterior Compass Ring & 2D Plan Dimension Badges
  const compassRingGroup = new THREE.Group();
  const compassR = Math.max(W, D) * 0.68 + 0.7;
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.sin(a) * compassR, -0.05, -Math.cos(a) * compassR));
  }
  const cRingGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const cRingMat = new THREE.LineBasicMaterial({ color: 0x78716c, transparent: true, opacity: 0.28 });
  const northConeGeo = new THREE.ConeGeometry(0.16, 0.42, 4);
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
  northArrow.position.set(0, -0.03, -compassR - 0.14);
  northArrow.raycast = () => {};
  compassRingGroup.add(northArrow);
  roomRoot.add(compassRingGroup);

  const makeWallBadge = (text: string, px: number, pz: number, rotZ: number) => {
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
      ctx.font = '700 34px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 50);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1.55, 0.29);
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

  const apronOff = T + 0.44;
  makeWallBadge(`A · ÜST (${Math.round(W * 100)} cm)`, 0, -D * 0.5 - apronOff, 0);
  makeWallBadge(`C · ALT (${Math.round(W * 100)} cm)`, 0, D * 0.5 + apronOff, 0);
  makeWallBadge(`D · SOL (${Math.round(D * 100)} cm)`, -W * 0.5 - apronOff, 0, Math.PI / 2);
  makeWallBadge(`B · SAĞ (${Math.round(D * 100)} cm)`, W * 0.5 + apronOff, 0, -Math.PI / 2);

  return {
    walls,
    ceilingVisualGroup,
    ceilingShadowGhost,
    gridHelper,
    compassRingGroup,
    planOverlayGroup,
    planLabelsGroup,
    interiorFillLight,
    warnings,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
