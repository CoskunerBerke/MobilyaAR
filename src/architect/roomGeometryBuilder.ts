import * as THREE from 'three';
import {
  getWallLengthM,
  type ArchBeam,
  type ArchColumn,
  type ArchCurtainCove,
  type ArchDoor,
  type ArchRoomProject,
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
  coveLights: THREE.PointLight[];
  spotLights: THREE.PointLight[];
  warnings: string[];
  dispose: () => void;
}

interface HoleBox2D {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  label: string;
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

    const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: frameD,
      bevelEnabled: false,
      curveSegments: 40,
    });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, cy, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    const glassGeo = new THREE.CircleGeometry(Math.max(0.08, r - fThick + 0.005), 40);
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

    const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: frameD,
      bevelEnabled: false,
      curveSegments: 44,
    });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, cy, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    // Subtle vertical divider bar
    addBox(0.028, Math.max(0.1, h - fThick * 2), frameD * 0.55, cx, cy, frameZ, frameMat);

    const glassShape = new THREE.Shape();
    glassShape.absellipse(0, 0, Math.max(0.08, rx - fThick + 0.005), Math.max(0.08, ry - fThick + 0.005), 0, Math.PI * 2, false, 0);
    const glassGeo = new THREE.ShapeGeometry(glassShape, 40);
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

    const frameGeo = new THREE.ExtrudeGeometry(outer, {
      depth: frameD,
      bevelEnabled: false,
      curveSegments: 32,
    });
    frameGeo.translate(0, 0, -frameD * 0.5);
    disposables.push(() => frameGeo.dispose());
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.set(cx, y0, frameZ);
    frameMesh.castShadow = true;
    grp.add(frameMesh);

    // Transom bar at arch spring line + center vertical mullion
    addBox(w - fThick * 1.4, 0.032, frameD * 0.65, cx, y0 + springLocalY, frameZ, frameMat);
    addBox(0.032, springLocalY - fThick, frameD * 0.65, cx, y0 + (springLocalY + fThick) * 0.5, frameZ, frameMat);

    const gShape = new THREE.Shape();
    gShape.moveTo(-w * 0.5 + fThick * 0.8, fThick * 0.8);
    gShape.lineTo(-w * 0.5 + fThick * 0.8, springLocalY);
    gShape.absarc(0, springLocalY, innerR + 0.008, Math.PI, 0, true);
    gShape.lineTo(w * 0.5 - fThick * 0.8, fThick * 0.8);
    gShape.closePath();
    const gGeo = new THREE.ShapeGeometry(gShape, 32);
    disposables.push(() => gGeo.dispose());
    const gMesh = new THREE.Mesh(gGeo, glassMat);
    gMesh.position.set(cx, y0, frameZ);
    grp.add(gMesh);
  } else {
    // Rectangular window types: single, double, triple, quad, french, sliding
    // Outer frame rails
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
        : 2; // french

    if (win.kind === 'sliding') {
      // Offset overlapping sliding sashes
      const sashW = innerW * 0.52;
      const zA = frameZ + 0.014;
      const zB = frameZ - 0.014;
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
      addSash(cx - innerW * 0.24, zA);
      addSash(cx + innerW * 0.24, zB);
      // Slim vertical pull handle on inner sash
      addBox(0.016, 0.22, 0.024, cx - innerW * 0.46, y0 + Math.min(h * 0.45, 1.05), zA + 0.02, handleMat);
    } else {
      // Mullions between panes
      for (let i = 1; i < paneCount; i++) {
        const mx = cx - innerW * 0.5 + (innerW * i) / paneCount;
        addBox(0.036, innerH, frameD * 0.78, mx, cy, frameZ, frameMat);
      }
      // French window subtle architectural transom near top
      if (win.kind === 'french' && h >= 1.9) {
        addBox(innerW, 0.032, frameD * 0.72, cx, y0 + h - 0.45, frameZ, frameMat);
      }
      // Window handle(s)
      const handleY = y0 + Math.min(h * 0.44, 1.08);
      if (paneCount === 1) {
        addBox(0.016, 0.12, 0.03, cx + innerW * 0.48, handleY, frameZ + frameD * 0.55, handleMat);
      } else {
        const mx = cx - innerW * 0.5 + innerW / paneCount;
        addBox(0.016, 0.12, 0.03, mx - 0.03, handleY, frameZ + frameD * 0.55, handleMat);
      }
      const gGeo = new THREE.PlaneGeometry(innerW, innerH);
      disposables.push(() => gGeo.dispose());
      const glass = new THREE.Mesh(gGeo, glassMat);
      glass.position.set(cx, cy, frameZ);
      grp.add(glass);
    }
  }

  // Marble / stone window sill (denizlik) for non-round/non-oval windows above floor
  if (win.hasSill && win.kind !== 'round' && win.kind !== 'oval' && y0 >= 0.08) {
    addBox(w + 0.08, 0.032, wallT + 0.06, cx, y0 - 0.008, -wallT * 0.5 + 0.025, sillMat);
  }

  // Curtains (Sheer + Drapes or Roman Blind)
  if (win.curtainStyle !== 'none') {
    const topY = coveOnWall ? ceilingH - 0.03 : Math.min(ceilingH - 0.04, y0 + h + 0.16);
    const botY = win.curtainStyle === 'roman_blind' ? Math.max(y0 + h * (1 - 0.35 * (1 - win.curtainOpenRatio)), y0 + 0.15) : 0.018;
    const curtH = Math.max(0.25, topY - botY);
    const curtZ = coveOnWall ? Math.max(0.07, coveOnWall.depthCm / 100 - 0.09) : 0.075;
    const spanW = w + 0.42;

    if (!coveOnWall) {
      // Exposed minimalist matte curtain rail above window
      addBox(spanW + 0.12, 0.02, 0.024, cx, topY + 0.01, curtZ, frameMat);
    }

    const buildPleatedCurtain = (
      cw: number,
      ch: number,
      px: number,
      py: number,
      pz: number,
      mat: THREE.Material,
      amp = 0.022
    ) => {
      const segsX = Math.max(12, Math.round(cw * 28));
      const geo = new THREE.PlaneGeometry(cw, ch, segsX, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const wave = Math.sin((vx / Math.max(0.05, cw)) * Math.PI * Math.max(6, Math.round(cw * 14))) * amp;
        pos.setZ(i, wave);
      }
      geo.computeVertexNormals();
      disposables.push(() => geo.dispose());
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = false;
      m.receiveShadow = true;
      grp.add(m);
    };

    if (win.curtainStyle === 'roman_blind') {
      const blindMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(win.curtainColorHex),
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
      disposables.push(() => blindMat.dispose());
      const dropH = Math.max(0.2, h * (0.28 + 0.65 * (1 - win.curtainOpenRatio)));
      const bGeo = new THREE.BoxGeometry(w + 0.04, dropH, 0.025);
      disposables.push(() => bGeo.dispose());
      const bm = new THREE.Mesh(bGeo, blindMat);
      bm.position.set(cx, y0 + h - dropH * 0.5 + 0.03, 0.035);
      grp.add(bm);
    } else {
      // Sheer (tül) across full span
      const sheerMat = new THREE.MeshStandardMaterial({
        color: 0xfbfaf6,
        roughness: 0.92,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      disposables.push(() => sheerMat.dispose());
      buildPleatedCurtain(spanW, curtH, cx, botY + curtH * 0.5, curtZ - 0.022, sheerMat, 0.015);

      if (win.curtainStyle === 'sheer_and_drape') {
        const drapeMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(win.curtainColorHex),
          roughness: 0.9,
          side: THREE.DoubleSide,
        });
        disposables.push(() => drapeMat.dispose());
        // Each side drape width shrinks when curtainOpenRatio increases
        const panelW = Math.max(0.22, spanW * (0.5 - win.curtainOpenRatio * 0.34));
        const leftCenter = cx - spanW * 0.5 + panelW * 0.5;
        const rightCenter = cx + spanW * 0.5 - panelW * 0.5;
        buildPleatedCurtain(panelW, curtH, leftCenter, botY + curtH * 0.5, curtZ + 0.025, drapeMat, 0.028);
        buildPleatedCurtain(panelW, curtH, rightCenter, botY + curtH * 0.5, curtZ + 0.025, drapeMat, 0.028);
      }
    }
  }

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

  const leafMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(door.colorHex),
    roughness: 0.55,
    metalness: 0.04,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(door.colorHex).multiplyScalar(0.95),
    roughness: 0.5,
    metalness: 0.05,
  });
  const handleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(door.handleColorHex),
    roughness: 0.3,
    metalness: 0.82,
  });
  const thresholdMat = new THREE.MeshStandardMaterial({
    color: 0xd9d4ca,
    roughness: 0.35,
    metalness: 0.1,
  });
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

  // Subtle floor threshold bar covering the 4mm hole clearance
  addBox(doorGroup, w, 0.012, wallT + 0.01, cx, 0.006, -wallT * 0.5, thresholdMat);

  if (door.kind === 'archway') {
    // Clean arched trim reveal only
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

    const trimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.022, bevelEnabled: false, curveSegments: 28 });
    disposables.push(() => trimGeo.dispose());
    const frontTrim = new THREE.Mesh(trimGeo, trimMat);
    frontTrim.position.set(cx, 0, 0.001);
    doorGroup.add(frontTrim);
    return { doorGroup, swingArcGroup };
  }

  // Jamb casing (interior + exterior trim)
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
    // Top aluminum track on interior side + sliding leaf
    const slideDir = door.hinge === 'left' ? -1 : 1;
    const trackLen = clearW * 2;
    addBox(doorGroup, trackLen, 0.055, 0.055, cx + slideDir * clearW * 0.45, h + 0.04, 0.032, handleMat);
    const slideShift = slideDir * clearW * 0.85 * openRatio;
    const leafCenterX = cx + slideShift;
    addBox(doorGroup, clearW + 0.04, clearH, leafThick, leafCenterX, clearH * 0.5 + 0.01, 0.038, leafMat);
    // Vertical recessed pull handle
    addBox(doorGroup, 0.022, 0.24, 0.055, leafCenterX - slideDir * (clearW * 0.42), 1.02, 0.038, handleMat);
    return { doorGroup, swingArcGroup };
  }

  const buildHingedLeaf = (
    pivotX: number,
    pivotZ: number,
    leafW: number,
    leafSign: 1 | -1,
    rotY: number
  ) => {
    const pivot = new THREE.Group();
    pivot.position.set(pivotX, 0.01, pivotZ);
    pivot.rotation.y = rotY;
    doorGroup.add(pivot);

    // Main door slab
    addBox(pivot, leafW, clearH, leafThick, leafSign * leafW * 0.5, clearH * 0.5, 0, leafMat);
    // Architectural recessed molding panels on both faces
    const panelW = Math.max(0.2, leafW - 0.18);
    addBox(pivot, panelW, clearH * 0.36, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.72, 0, trimMat);
    addBox(pivot, panelW, clearH * 0.32, leafThick + 0.008, leafSign * leafW * 0.5, clearH * 0.26, 0, trimMat);

    // Lever handles on both faces
    const hx = leafSign * (leafW - 0.09);
    const hy = 1.02;
    addBox(pivot, 0.03, 0.03, leafThick + 0.09, hx, hy, 0, handleMat);
    addBox(pivot, 0.115, 0.02, 0.018, hx - leafSign * 0.045, hy, leafThick * 0.5 + 0.042, handleMat);
    addBox(pivot, 0.115, 0.02, 0.018, hx - leafSign * 0.045, hy, -leafThick * 0.5 - 0.042, handleMat);

    // 2D Architectural floor swing arc (90° standard clearance arc + current door line)
    const arcSign = rotY === 0 ? (door.swing === 'inward' ? (leafSign === 1 ? -1 : 1) : leafSign === 1 ? 1 : -1) : Math.sign(rotY);
    const maxArcRad = (Math.max(Math.abs(rotY), Math.PI * 0.5) * arcSign);
    const pts: THREE.Vector3[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const a = (maxArcRad * i) / steps;
      pts.push(
        new THREE.Vector3(
          pivotX + leafSign * leafW * Math.cos(a),
          0.014,
          pivotZ - leafSign * leafW * Math.sin(a)
        )
      );
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
    swingArcGroup.add(new THREE.Line(arcGeo, arcMat));

    // Straight radius line showing door leaf sweep boundary at 90°
    const endA = maxArcRad;
    const radGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(pivotX, 0.014, pivotZ),
      new THREE.Vector3(
        pivotX + leafSign * leafW * Math.cos(endA),
        0.014,
        pivotZ - leafSign * leafW * Math.sin(endA)
      ),
    ]);
    disposables.push(() => radGeo.dispose());
    swingArcGroup.add(new THREE.Line(radGeo, arcMat));
  };

  const openRad = (door.openAngleDeg * Math.PI) / 180;
  const pivotZ = door.swing === 'inward' ? -0.01 : -wallT + 0.01;

  if (door.kind === 'double') {
    const halfLeaf = clearW * 0.5 - 0.004;
    const leftRot = door.swing === 'inward' ? -openRad : openRad;
    const rightRot = door.swing === 'inward' ? openRad : -openRad;
    buildHingedLeaf(cx - clearW * 0.5, pivotZ, halfLeaf, 1, leftRot);
    buildHingedLeaf(cx + clearW * 0.5, pivotZ, halfLeaf, -1, rightRot);
  } else {
    // Single door
    if (door.hinge === 'left') {
      const rot = door.swing === 'inward' ? -openRad : openRad;
      buildHingedLeaf(cx - clearW * 0.5, pivotZ, clearW, 1, rot);
    } else {
      const rot = door.swing === 'inward' ? openRad : -openRad;
      buildHingedLeaf(cx + clearW * 0.5, pivotZ, clearW, -1, rot);
    }
  }

  return { doorGroup, swingArcGroup };
}

function buildCurtainCoveOnWall(
  cove: ArchCurtainCove,
  wallLen: number,
  ceilingH: number,
  coveLights: THREE.PointLight[],
  disposables: Array<() => void>
): THREE.Group {
  const grp = new THREE.Group();
  const depthM = Math.max(0.1, Math.min(0.45, cove.depthCm / 100));
  const dropM = Math.max(0.08, Math.min(0.4, cove.dropCm / 100));
  const fasciaT = 0.045;

  const gypsumMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cove.colorHex),
    roughness: 0.88,
    metalness: 0.02,
  });
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0xd8d6d0,
    roughness: 0.35,
    metalness: 0.65,
  });
  disposables.push(() => {
    gypsumMat.dispose();
    trackMat.dispose();
  });

  // 1) Front vertical alçıpan fascia dropping from ceiling, sitting `depthM` inward from wall
  const fasciaGeo = new THREE.BoxGeometry(wallLen, dropM, fasciaT);
  disposables.push(() => fasciaGeo.dispose());
  const fascia = new THREE.Mesh(fasciaGeo, gypsumMat);
  fascia.position.set(0, ceilingH - dropM * 0.5, depthM - fasciaT * 0.5);
  fascia.castShadow = true;
  fascia.receiveShadow = true;
  grp.add(fascia);

  // 2) Inner recessed horizontal light lip (gizli LED dudağı)
  const lipGeo = new THREE.BoxGeometry(wallLen, 0.022, 0.042);
  disposables.push(() => lipGeo.dispose());
  const lip = new THREE.Mesh(lipGeo, gypsumMat);
  lip.position.set(0, ceilingH - dropM + 0.011, depthM - fasciaT - 0.021);
  grp.add(lip);

  // 3) Double aluminum ceiling curtain track (korniş) tucked inside hollow channel
  for (const tz of [depthM * 0.34, depthM * 0.62]) {
    const trGeo = new THREE.BoxGeometry(wallLen - 0.06, 0.016, 0.018);
    disposables.push(() => trGeo.dispose());
    const tr = new THREE.Mesh(trGeo, trackMat);
    tr.position.set(0, ceilingH - 0.012, tz);
    grp.add(tr);
  }

  // 4) Emissive hidden LED strip + warm PointLights washing curtain & wall
  if (cove.ledEnabled) {
    const ledCol = new THREE.Color(cove.ledColorHex);
    const ledMat = new THREE.MeshBasicMaterial({ color: ledCol });
    disposables.push(() => ledMat.dispose());
    const stripGeo = new THREE.BoxGeometry(wallLen - 0.08, 0.016, 0.024);
    disposables.push(() => stripGeo.dispose());
    const strip = new THREE.Mesh(stripGeo, ledMat);
    strip.position.set(0, ceilingH - dropM + 0.028, depthM - fasciaT - 0.022);
    grp.add(strip);

    const lightCount = Math.max(2, Math.min(3, Math.round(wallLen / 1.8)));
    for (let i = 0; i < lightCount; i++) {
      const lx = -wallLen * 0.36 + (wallLen * 0.72 * i) / Math.max(1, lightCount - 1);
      const pl = new THREE.PointLight(ledCol, cove.ledIntensity * 1.15, 4.2, 1.8);
      pl.position.set(lx, ceilingH - dropM * 0.65, Math.max(0.08, depthM * 0.55));
      grp.add(pl);
      coveLights.push(pl);
    }
  }

  return grp;
}

export function buildArchitecturalRoom(project: ArchRoomProject, roomRoot: THREE.Group): BuiltRoomResult {
  const disposables: Array<() => void> = [];
  const warnings: string[] = [];
  const walls: WallRuntimeRef[] = [];
  const coveLights: THREE.PointLight[] = [];
  const spotLights: THREE.PointLight[] = [];

  const W = project.widthM;
  const D = project.depthM;
  const H = project.ceilingM;
  const T = project.wallThicknessM;

  // 1) Floor & architectural plinth slab
  const floorTex = createFloorTexture(project.floorMaterial, project.floorTintHex, W, D);
  disposables.push(() => floorTex.dispose());
  const floorRough =
    project.floorMaterial === 'marble'
      ? 0.24
      : project.floorMaterial === 'travertine'
      ? 0.44
      : project.floorMaterial === 'terrazzo'
      ? 0.36
      : 0.68;

  const floorGeo = new THREE.PlaneGeometry(W, D);
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTex,
    roughness: floorRough,
    metalness: 0.04,
  });
  disposables.push(() => {
    floorGeo.dispose();
    floorMat.dispose();
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  roomRoot.add(floorMesh);

  // Exterior structural floor slab underneath walls
  const slabGeo = new THREE.BoxGeometry(W + T * 2 + 0.14, 0.14, D + T * 2 + 0.14);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xd5d0c7, roughness: 0.92 });
  disposables.push(() => {
    slabGeo.dispose();
    slabMat.dispose();
  });
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.y = -0.072;
  slab.receiveShadow = true;
  roomRoot.add(slab);

  // Shared physical glass material & shadow-only ghost material
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdcf0ff,
    transparent: true,
    opacity: 0.24,
    roughness: 0.06,
    metalness: 0.1,
    reflectivity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shadowOnlyMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
  });
  disposables.push(() => {
    glassMat.dispose();
    shadowOnlyMat.dispose();
  });

  // Plan overlay group (2D door swing arcs) + dedicated 2D Plan wall dimension labels
  const planOverlayGroup = new THREE.Group();
  roomRoot.add(planOverlayGroup);
  const planLabelsGroup = new THREE.Group();
  roomRoot.add(planLabelsGroup);

  // 2) Build all 4 perforated 3D walls with interlocking exterior corners
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

  const baseboardMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(project.baseboardColorHex),
    roughness: 0.65,
    metalness: 0.04,
  });
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

    // Cut windows on this wall
    const wallWindows = project.windows.filter((w) => w.wall === ws.side);
    for (const win of wallWindows) {
      const wM = Math.max(0.35, Math.min(ws.len - 0.16, win.widthCm / 100));
      const hM = Math.max(0.35, Math.min(H - 0.12, win.heightCm / 100));
      const sillM = Math.max(0.005, Math.min(H - hM - 0.06, win.sillHeightCm / 100));
      const rawCx = win.offsetCm / 100 - ws.len * 0.5;
      const cx = Math.max(-ws.len * 0.5 + wM * 0.5 + 0.08, Math.min(ws.len * 0.5 - wM * 0.5 - 0.08, rawCx));

      const x0 = cx - wM * 0.5;
      const x1 = cx + wM * 0.5;
      const y0 = sillM;
      const y1 = sillM + hM;
      const cand: HoleBox2D = { x0, x1, y0, y1, label: `Pencere (${win.kind})` };

      if (acceptedHoles.some((hBox) => boxesOverlap(cand, hBox, 0.04))) {
        warnings.push(`${ws.side.toUpperCase()} duvarında çakışan pencere kaydırılmalı.`);
        continue;
      }
      acceptedHoles.push(cand);
      if (y0 < 0.12) {
        floorBreakSpans.push([x0 - 0.03, x1 + 0.03]);
      }

      if (win.kind === 'round') {
        addRoundHole(wallShape, cx, y0 + hM * 0.5, Math.min(wM, hM) * 0.5);
      } else if (win.kind === 'oval') {
        addOvalHole(wallShape, cx, y0 + hM * 0.5, wM * 0.5, hM * 0.5);
      } else if (win.kind === 'arched') {
        addArchedHole(wallShape, x0, y0, x1, y1);
      } else {
        addRectangularHole(wallShape, x0, y0, x1, y1);
      }

      const winAsm = createWindowAssembly(win, cx, y0, wM, hM, T, H, coveOnWall, glassMat, disposables);
      visualGroup.add(winAsm);
    }

    // Cut doors on this wall
    const wallDoors = project.doors.filter((d) => d.wall === ws.side);
    for (const door of wallDoors) {
      const wM = Math.max(0.65, Math.min(ws.len - 0.16, door.widthCm / 100));
      const hM = Math.max(1.85, Math.min(H - 0.08, door.heightCm / 100));
      const rawCx = door.offsetCm / 100 - ws.len * 0.5;
      const cx = Math.max(-ws.len * 0.5 + wM * 0.5 + 0.08, Math.min(ws.len * 0.5 - wM * 0.5 - 0.08, rawCx));

      const x0 = cx - wM * 0.5;
      const x1 = cx + wM * 0.5;
      const y0 = 0.005; // 5mm clearance so hole never coincides with outer y=0 boundary
      const y1 = hM;
      const cand: HoleBox2D = { x0, x1, y0, y1, label: 'Kapı' };

      if (acceptedHoles.some((hBox) => boxesOverlap(cand, hBox, 0.04))) {
        warnings.push(`${ws.side.toUpperCase()} duvarında çakışan kapı kaydırılmalı.`);
        continue;
      }
      acceptedHoles.push(cand);
      floorBreakSpans.push([x0 - 0.05, x1 + 0.05]);

      if (door.kind === 'archway') {
        addArchedHole(wallShape, x0, y0, x1, y1);
      } else {
        addRectangularHole(wallShape, x0, y0, x1, y1);
      }

      const { doorGroup, swingArcGroup } = createDoorAssembly(door, cx, wM, hM, T, disposables);
      visualGroup.add(doorGroup);
      wallOverlay.add(swingArcGroup);
    }

    // Extrude perforated wall outward from z=0 to z=-T
    const wallGeo = new THREE.ExtrudeGeometry(wallShape, {
      depth: T,
      bevelEnabled: false,
      curveSegments: 32,
    });
    wallGeo.translate(0, 0, -T);
    disposables.push(() => wallGeo.dispose());

    const wFinish = project.walls[ws.side];
    const wTex = createWallTexture(wFinish.pattern, wFinish.colorHex);
    disposables.push(() => wTex.dispose());

    const faceMat = new THREE.MeshStandardMaterial({
      map: wTex,
      roughness: wFinish.pattern === 'stone' ? 0.78 : wFinish.pattern === 'slats' ? 0.72 : 0.88,
      metalness: 0.02,
    });
    const revealMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(wFinish.colorHex).multiplyScalar(0.96),
      roughness: 0.88,
      metalness: 0.02,
    });
    disposables.push(() => {
      faceMat.dispose();
      revealMat.dispose();
    });

    const wallMesh = new THREE.Mesh(wallGeo, [faceMat, revealMat]);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    visualGroup.add(wallMesh);

    // Shadow-only ghost mesh (active ONLY when wall is cut away in Free 3D so sunlight STILL beams strictly through window cutouts!)
    const shadowGhost = new THREE.Mesh(wallGeo, shadowOnlyMat);
    shadowGhost.castShadow = true;
    shadowGhost.receiveShadow = false;
    shadowGhost.visible = false;
    wallHolder.add(shadowGhost);

    // Segmented interior baseboard (süpürgelik) skipping door/French openings
    if (project.showBaseboard) {
      floorBreakSpans.sort((a, b) => a[0] - b[0]);
      let cursor = -ws.len * 0.5;
      const bbH = 0.095;
      const bbD = 0.016;
      const addBbSeg = (a: number, b: number) => {
        const segW = b - a;
        if (segW < 0.04) return;
        const g = new THREE.BoxGeometry(segW, bbH, bbD);
        disposables.push(() => g.dispose());
        const m = new THREE.Mesh(g, baseboardMat);
        m.position.set((a + b) * 0.5, bbH * 0.5, bbD * 0.5);
        m.receiveShadow = true;
        visualGroup.add(m);
      };
      for (const [bx0, bx1] of floorBreakSpans) {
        if (bx0 > cursor) addBbSeg(cursor, Math.min(bx0, ws.len * 0.5));
        cursor = Math.max(cursor, bx1);
      }
      if (cursor < ws.len * 0.5) addBbSeg(cursor, ws.len * 0.5);
    }

    // Perde Havuzu (Curtain Cove) on this wall
    if (coveOnWall) {
      const coveGrp = buildCurtainCoveOnWall(coveOnWall, ws.len, H, coveLights, disposables);
      visualGroup.add(coveGrp);
    }

    walls.push({
      side: ws.side,
      visualGroup,
      shadowGhost,
      inwardNormal: new THREE.Vector3(...ws.inward),
      center: new THREE.Vector3(ws.pos[0], H * 0.5, ws.pos[2]),
    });
  }

  // 3) Columns (Kolonlar: Kare/Dikdörtgen & Yuvarlak/Oval)
  for (const col of project.columns) {
    const colW = Math.max(0.15, Math.min(1.6, col.widthCm / 100));
    const colD = Math.max(0.15, Math.min(1.6, col.depthCm / 100));
    const colX = Math.max(-W * 0.5 + colW * 0.5, Math.min(W * 0.5 - colW * 0.5, col.xCm / 100));
    const colZ = Math.max(-D * 0.5 + colD * 0.5, Math.min(D * 0.5 - colD * 0.5, col.zCm / 100));

    const colMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(col.colorHex),
      roughness: 0.86,
      metalness: 0.02,
    });
    disposables.push(() => colMat.dispose());

    let geo: THREE.BufferGeometry;
    if (col.shape === 'round') {
      geo = new THREE.CylinderGeometry(0.5, 0.5, H, 32);
    } else {
      geo = new THREE.BoxGeometry(colW, H, colD);
    }
    disposables.push(() => geo.dispose());
    const mesh = new THREE.Mesh(geo, colMat);
    if (col.shape === 'round') {
      mesh.scale.set(colW, 1, colD);
    }
    mesh.position.set(colX, H * 0.5, colZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    roomRoot.add(mesh);

    if (project.showBaseboard && col.shape === 'rect') {
      const bGeo = new THREE.BoxGeometry(colW + 0.02, 0.095, colD + 0.02);
      disposables.push(() => bGeo.dispose());
      const bm = new THREE.Mesh(bGeo, baseboardMat);
      bm.position.set(colX, 0.0475, colZ);
      roomRoot.add(bm);
    }
  }

  // 4) Ceiling Beams (Tavan Kirişleri)
  // Wall-adjacent beams attach to that wall's visualGroup so they cut away cleanly with the wall!
  for (const beam of project.beams) {
    const bw = Math.max(0.12, Math.min(0.9, beam.widthCm / 100));
    const drop = Math.max(0.1, Math.min(0.8, beam.dropCm / 100));
    const bMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(beam.colorHex),
      roughness: 0.85,
      metalness: 0.02,
    });
    disposables.push(() => bMat.dispose());

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
    disposables.push(() => geo.dispose());
    const bm = new THREE.Mesh(geo, bMat);
    bm.castShadow = true;
    bm.receiveShadow = true;

    const wallRef = hostWall ? walls.find((w) => w.side === hostWall) : null;
    if (wallRef) {
      // Transform world (px, H - drop/2, pz) into wall local space
      if (hostWall === 'north') {
        bm.position.set(px, H - drop * 0.5, pz + D * 0.5);
      } else if (hostWall === 'south') {
        bm.position.set(-px, H - drop * 0.5, D * 0.5 - pz);
      } else if (hostWall === 'west') {
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

  // 5) Ceiling + Shadow-only roof blocker + Recessed LED Spots
  const ceilingVisualGroup = new THREE.Group();
  roomRoot.add(ceilingVisualGroup);

  const ceilGeo = new THREE.BoxGeometry(W + T * 2, 0.08, D + T * 2);
  const ceilMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(project.ceilingColorHex),
    roughness: 0.9,
    metalness: 0.01,
  });
  disposables.push(() => {
    ceilGeo.dispose();
    ceilMat.dispose();
  });

  const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
  ceilMesh.position.y = H + 0.04;
  ceilMesh.castShadow = true;
  ceilMesh.receiveShadow = true;
  ceilingVisualGroup.add(ceilMesh);

  // Invisible shadow roof so outdoor sun ONLY enters through perforated windows even when ceiling is hidden in Free 3D!
  const ceilingShadowGhost = new THREE.Mesh(ceilGeo, shadowOnlyMat);
  ceilingShadowGhost.position.y = H + 0.04;
  ceilingShadowGhost.castShadow = true;
  ceilingShadowGhost.receiveShadow = false;
  roomRoot.add(ceilingShadowGhost);

  if (project.recessedSpots) {
    const spotCol = new THREE.Color(project.spotWarmthHex);
    const spotRingMat = new THREE.MeshStandardMaterial({ color: 0xe2dfd8, roughness: 0.4, metalness: 0.3 });
    const spotGlowMat = new THREE.MeshBasicMaterial({ color: spotCol });
    const ringGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.012, 18);
    const bulbGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.014, 16);
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
        ceilingVisualGroup.add(ring);
        const bulb = new THREE.Mesh(bulbGeo, spotGlowMat);
        bulb.position.set(sx, H - 0.008, sz);
        ceilingVisualGroup.add(bulb);
      }
    }
    // 2 balanced interior ceiling fill PointLights (kept light on GPU!)
    for (const sx of [-W * 0.22, W * 0.22]) {
      const pl = new THREE.PointLight(spotCol, 0.7, Math.max(W, D) * 1.5, 1.6);
      pl.position.set(sx, H - 0.16, 0);
      roomRoot.add(pl);
      spotLights.push(pl);
    }
  }

  // 6) 50cm Architectural Floor Grid
  const gridVerts: number[] = [];
  const halfW = W * 0.5;
  const halfD = D * 0.5;
  const step = 0.5;
  for (let x = -Math.floor(halfW / step) * step; x <= halfW + 1e-4; x += step) {
    gridVerts.push(x, 0.004, -halfD, x, 0.004, halfD);
  }
  for (let z = -Math.floor(halfD / step) * step; z <= halfD + 1e-4; z += step) {
    gridVerts.push(-halfW, 0.004, z, halfW, 0.004, z);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
  const gridMat = new THREE.LineBasicMaterial({ color: 0x3b3832, transparent: true, opacity: 0.14 });
  disposables.push(() => {
    gridGeo.dispose();
    gridMat.dispose();
  });
  const gridHelper = new THREE.LineSegments(gridGeo, gridMat);
  roomRoot.add(gridHelper);

  // 7) Subtle exterior architectural compass ring + wall side dimension badges (A/B/C/D)
  const compassRingGroup = new THREE.Group();
  const compassR = Math.max(W, D) * 0.68 + 0.7;
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.sin(a) * compassR, -0.05, -Math.cos(a) * compassR));
  }
  const cRingGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const cRingMat = new THREE.LineBasicMaterial({ color: 0x78716c, transparent: true, opacity: 0.3 });
  disposables.push(() => {
    cRingGeo.dispose();
    cRingMat.dispose();
  });
  compassRingGroup.add(new THREE.Line(cRingGeo, cRingMat));

  // True North red pointer cone on the compass ring (rotates by northAngleDeg in scene loop!)
  const northConeGeo = new THREE.ConeGeometry(0.16, 0.42, 4);
  northConeGeo.rotateX(-Math.PI / 2);
  const northConeMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
  disposables.push(() => {
    northConeGeo.dispose();
    northConeMat.dispose();
  });
  const northArrow = new THREE.Mesh(northConeGeo, northConeMat);
  northArrow.position.set(0, -0.03, -compassR - 0.14);
  compassRingGroup.add(northArrow);
  roomRoot.add(compassRingGroup);

  // Architectural wall labels (A/B/C/D + exact cm) on outer floor apron (shown in 3D & 2D Plan)
  const makeWallBadge = (text: string, px: number, pz: number, rotZ: number) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 96;
    const ctx = cv.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(10, 12, 492, 72);
      ctx.strokeStyle = 'rgba(28, 25, 23, 0.35)';
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
    tex.anisotropy = 4;
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
    // Place cleanly at wall-top elevation so 3D walls never occlude dimension badges in 2D Plan!
    m.position.set(px, H + 0.04, pz);
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
    coveLights,
    spotLights,
    warnings,
    dispose: () => {
      disposables.forEach((fn) => fn());
    },
  };
}
