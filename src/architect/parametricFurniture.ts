import * as THREE from 'three';
import type { ArchPlacedObject } from './types';
import { createFloorTexture, createWallTexture, createWovenRugTexture } from './textures';

/**
 * Builds crisp, low-overhead procedural 3D architectural furniture & fixtures
 * centered at X=0, Z=0 with bottom resting strictly at Y=0.
 * Cached textures from textures.ts are NEVER disposed here.
 */
export function buildParametricObject3D(
  obj: ArchPlacedObject,
  onTextureReady?: () => void
): { group: THREE.Group; dispose: () => void } {
  const grp = new THREE.Group();
  const disposables: Array<() => void> = [];

  const W = Math.max(0.2, obj.widthM);
  const D = Math.max(0.03, obj.depthM);
  const H = Math.max(0.01, obj.heightM);
  const primaryHex = obj.parametricColorHex || '#ece9e2';
  const accentHex = obj.parametricAccentHex || '#272624';

  const addBox = (
    bw: number,
    bh: number,
    bd: number,
    px: number,
    py: number,
    pz: number,
    mat: THREE.Material,
    castShadow = true
  ) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    disposables.push(() => geo.dispose());
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    grp.add(m);
    return m;
  };

  if (obj.parametricKind === 'fireplace_marble') {
    // Pure marble fireplace monolith (TV is now a separate movable object!)
    const marbleTex = createFloorTexture('marble', primaryHex, W * 1.4, H * 1.4);
    const marbleMat = new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.28, metalness: 0.04 });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.42,
      metalness: 0.55,
    });
    const fireGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8c2b });
    const fireCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xfff5e8,
      transparent: true,
      opacity: 0.16,
      roughness: 0.1,
      metalness: 0.2,
      depthWrite: false,
    });
    disposables.push(() => {
      marbleMat.dispose();
      darkSteelMat.dispose();
      fireGlowMat.dispose();
      fireCoreMat.dispose();
      glassMat.dispose();
    });

    const hearthH = Math.min(0.32, H * 0.14);
    addBox(W, hearthH, D, 0, hearthH * 0.5, 0, marbleMat);

    const bodyW = W * 0.74;
    const bodyD = D * 0.82;
    const bodyZ = -(D - bodyD) * 0.5;
    const fireW = Math.min(bodyW * 0.74, 1.15);
    const fireH = Math.min(0.42, H * 0.22);
    const fireBottom = hearthH + 0.06;
    const fireTop = fireBottom + fireH;

    const pierW = (bodyW - fireW) * 0.5;
    if (pierW > 0.05) {
      addBox(pierW, fireH + 0.06, bodyD, -bodyW * 0.5 + pierW * 0.5, hearthH + (fireH + 0.06) * 0.5, bodyZ, marbleMat);
      addBox(pierW, fireH + 0.06, bodyD, bodyW * 0.5 - pierW * 0.5, hearthH + (fireH + 0.06) * 0.5, bodyZ, marbleMat);
    }
    addBox(fireW + 0.04, fireH + 0.06, bodyD * 0.45, 0, hearthH + (fireH + 0.06) * 0.5, bodyZ - bodyD * 0.25, darkSteelMat);
    addBox(fireW, 0.06, bodyD * 0.92, 0, hearthH + 0.03, bodyZ, darkSteelMat);

    const flameCount = 7;
    for (let i = 0; i < flameCount; i++) {
      const fx = -fireW * 0.38 + (fireW * 0.76 * i) / (flameCount - 1);
      const fh = 0.12 + (i % 3) * 0.04;
      const coneGeo = new THREE.ConeGeometry(0.036, fh, 6);
      disposables.push(() => coneGeo.dispose());
      const f = new THREE.Mesh(coneGeo, i % 2 === 0 ? fireGlowMat : fireCoreMat);
      f.position.set(fx, fireBottom + fh * 0.45, bodyZ + 0.03);
      grp.add(f);
    }
    addBox(fireW * 0.85, 0.025, 0.08, 0, fireBottom + 0.015, bodyZ + 0.03, fireGlowMat, false);
    addBox(fireW, fireH * 0.88, 0.01, 0, fireBottom + fireH * 0.46, bodyZ + bodyD * 0.46, glassMat, false);

    // Single warm hearth PointLight for realistic ambiance
    const hearthLight = new THREE.PointLight(0xff9438, 1.05, 3.8, 1.8);
    hearthLight.position.set(0, fireBottom + fireH * 0.5, bodyZ + bodyD * 0.7);
    grp.add(hearthLight);

    const upperH = Math.max(0.2, H - fireTop);
    addBox(bodyW, upperH, bodyD, 0, fireTop + upperH * 0.5, bodyZ, marbleMat);
  } else if (obj.parametricKind === 'tv_wall_unit') {
    const slatTex = createWallTexture('slats', primaryHex);
    const slatMat = new THREE.MeshStandardMaterial({ map: slatTex, roughness: 0.65 });
    const consoleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.48,
      metalness: 0.08,
    });
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.14, metalness: 0.35 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffdca8 });
    disposables.push(() => {
      slatMat.dispose();
      consoleMat.dispose();
      screenMat.dispose();
      ledMat.dispose();
    });

    addBox(W, H, 0.05, 0, H * 0.5, -D * 0.5 + 0.025, slatMat);
    const consH = 0.36;
    addBox(W * 0.94, consH, D - 0.05, 0, 0.22 + consH * 0.5, 0.025, consoleMat);
    addBox(W * 0.88, 0.015, 0.03, 0, 0.215, D * 0.25, ledMat, false);
    const tvW = Math.min(W * 0.64, 1.55);
    const tvH = tvW * 0.5625;
    const tvY = Math.min(H - tvH * 0.5 - 0.2, 1.32);
    addBox(tvW + 0.025, tvH + 0.025, 0.036, 0, tvY, -D * 0.5 + 0.07, consoleMat);
    addBox(tvW, tvH, 0.008, 0, tvY, -D * 0.5 + 0.09, screenMat, false);
  } else if (obj.parametricKind === 'wall_tv') {
    const bezelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex),
      roughness: 0.34,
      metalness: 0.55,
    });
    const screenMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex || '#0b0c10'),
      roughness: 0.12,
      metalness: 0.4,
    });
    const ledDotMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    disposables.push(() => {
      bezelMat.dispose();
      screenMat.dispose();
      ledDotMat.dispose();
    });
    const thick = Math.max(0.03, Math.min(0.08, D));
    addBox(W, H, thick * 0.72, 0, H * 0.5, 0, bezelMat);
    addBox(W - 0.024, H - 0.024, 0.008, 0, H * 0.5, thick * 0.4, screenMat, false);
    // Subtle slim wall-mount bracket behind TV
    addBox(W * 0.4, H * 0.3, thick * 0.28, 0, H * 0.5, -thick * 0.42, bezelMat, false);
    addBox(0.018, 0.006, 0.006, 0, 0.014, thick * 0.43, ledDotMat, false);
  } else if (obj.parametricKind === 'wardrobe') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.62 });
    const seamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex).multiplyScalar(0.84), roughness: 0.7 });
    const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.32, metalness: 0.7 });
    disposables.push(() => {
      bodyMat.dispose();
      seamMat.dispose();
      handleMat.dispose();
    });
    addBox(W, H, D - 0.02, 0, H * 0.5, -0.01, bodyMat);
    const doors = Math.max(2, Math.min(6, Math.round(W / 0.52)));
    const dw = (W - 0.02) / doors;
    for (let i = 0; i < doors; i++) {
      const dx = -W * 0.5 + 0.01 + dw * (i + 0.5);
      addBox(dw - 0.012, H - 0.08, 0.022, dx, H * 0.5 + 0.02, D * 0.5 - 0.011, bodyMat);
      // Recessed vertical seam + slim handle
      if (i > 0) addBox(0.008, H - 0.08, 0.01, dx - dw * 0.5, H * 0.5 + 0.02, D * 0.5 - 0.015, seamMat, false);
      const hx = i % 2 === 0 ? dx + dw * 0.36 : dx - dw * 0.36;
      addBox(0.014, Math.min(0.45, H * 0.22), 0.024, hx, Math.min(H * 0.48, 1.15), D * 0.5 + 0.008, handleMat, false);
    }
    // Kick plinth
    addBox(W - 0.04, 0.07, D - 0.05, 0, 0.035, -0.015, seamMat, false);
  } else if (obj.parametricKind === 'dining_table') {
    const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.52 });
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.38, metalness: 0.45 });
    disposables.push(() => {
      topMat.dispose();
      legMat.dispose();
    });
    const topT = 0.045;
    addBox(W, topT, D, 0, H - topT * 0.5, 0, topMat);
    const legH = H - topT;
    const ix = W * 0.5 - 0.1;
    const iz = D * 0.5 - 0.1;
    for (const sx of [-ix, ix]) {
      for (const sz of [-iz, iz]) {
        addBox(0.06, legH, 0.06, sx, legH * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'bookshelf') {
    const woodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.8 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffe4b8 });
    disposables.push(() => {
      woodMat.dispose();
      backMat.dispose();
      ledMat.dispose();
    });
    const th = 0.032;
    addBox(W, H, 0.02, 0, H * 0.5, -D * 0.5 + 0.01, backMat);
    addBox(th, H, D, -W * 0.5 + th * 0.5, H * 0.5, 0, woodMat);
    addBox(th, H, D, W * 0.5 - th * 0.5, H * 0.5, 0, woodMat);
    const shelves = Math.max(4, Math.min(7, Math.round(H / 0.38)));
    for (let i = 0; i <= shelves; i++) {
      const sy = (H - th) * (i / shelves) + th * 0.5;
      addBox(W - th * 2, th, D, 0, sy, 0, woodMat);
      if (i > 0 && i < shelves) {
        addBox(W - th * 2.4, 0.008, 0.012, 0, sy - th * 0.6, -D * 0.5 + 0.04, ledMat, false);
      }
    }
  } else if (obj.parametricKind === 'bed_frame') {
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.85 });
    const sheetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.88 });
    const blanketMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex).multiplyScalar(0.82), roughness: 0.9 });
    disposables.push(() => {
      frameMat.dispose();
      sheetMat.dispose();
      blanketMat.dispose();
    });
    // Headboard at -Z
    addBox(W + 0.08, H, 0.12, 0, H * 0.5, -D * 0.5 + 0.06, frameMat);
    // Base frame
    addBox(W, 0.3, D - 0.08, 0, 0.15, 0.04, frameMat);
    // Mattress
    addBox(W - 0.06, 0.24, D - 0.16, 0, 0.42, 0.04, sheetMat);
    // Folded duvet on lower 60%
    addBox(W - 0.02, 0.26, (D - 0.16) * 0.58, 0, 0.43, D * 0.21, blanketMat);
    // 2 Pillows
    const pw = Math.min(0.68, W * 0.42);
    addBox(pw, 0.15, 0.42, -W * 0.24, 0.59, -D * 0.5 + 0.38, sheetMat);
    if (W > 1.3) addBox(pw, 0.15, 0.42, W * 0.24, 0.59, -D * 0.5 + 0.38, sheetMat);
  } else if (obj.parametricKind === 'ac_unit') {
    const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.32, metalness: 0.08 });
    const ventMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.5 });
    disposables.push(() => {
      shellMat.dispose();
      ventMat.dispose();
    });
    addBox(W, H, D, 0, H * 0.5, 0, shellMat);
    addBox(W * 0.88, H * 0.18, 0.02, 0, H * 0.18, D * 0.5 + 0.002, ventMat, false);
    addBox(W * 0.94, 0.012, 0.01, 0, H * 0.52, D * 0.5 + 0.003, ventMat, false);
  } else if (obj.parametricKind === 'wall_mirror') {
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.28, metalness: 0.8 });
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex || '#dbe5ee'),
      roughness: 0.08,
      metalness: 0.88,
    });
    disposables.push(() => {
      frameMat.dispose();
      mirrorMat.dispose();
    });
    const isRoundMirror = /yuvarlak|round|daire|oval/i.test(obj.name);
    if (isRoundMirror) {
      const r = Math.min(W, H) * 0.5;
      const rx = W * 0.5;
      const ry = H * 0.5;
      const rimGeo = new THREE.CylinderGeometry(r, r, D, 40);
      rimGeo.rotateX(Math.PI / 2);
      const glassGeo = new THREE.CylinderGeometry(Math.max(0.05, r - 0.025), Math.max(0.05, r - 0.025), 0.008, 40);
      glassGeo.rotateX(Math.PI / 2);
      disposables.push(() => {
        rimGeo.dispose();
        glassGeo.dispose();
      });
      const rim = new THREE.Mesh(rimGeo, frameMat);
      rim.position.set(0, H * 0.5, 0);
      rim.scale.set(rx / r, ry / r, 1);
      rim.castShadow = true;
      grp.add(rim);
      const glass = new THREE.Mesh(glassGeo, mirrorMat);
      glass.position.set(0, H * 0.5, D * 0.5 + 0.003);
      glass.scale.set(rx / r, ry / r, 1);
      grp.add(glass);
    } else {
      addBox(W, H, D, 0, H * 0.5, 0, frameMat);
      addBox(W - 0.05, H - 0.05, 0.01, 0, H * 0.5, D * 0.5 + 0.003, mirrorMat, false);
    }
  } else if (obj.parametricKind === 'wall_art') {
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.45 });
    disposables.push(() => frameMat.dispose());
    addBox(W, H, D, 0, H * 0.5, 0, frameMat);
    if (obj.thumbUrl) {
      const tex = new THREE.TextureLoader().load(obj.thumbUrl, () => onTextureReady?.());
      tex.colorSpace = THREE.SRGBColorSpace;
      const artMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.02 });
      disposables.push(() => {
        tex.dispose();
        artMat.dispose();
      });
      addBox(Math.max(0.1, W - 0.05), Math.max(0.1, H - 0.05), 0.01, 0, H * 0.5, D * 0.5 + 0.003, artMat, false);
    } else {
      const canvasMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.85 });
      const accentBlock = new THREE.MeshStandardMaterial({ color: 0xb67d65, roughness: 0.85 });
      disposables.push(() => {
        canvasMat.dispose();
        accentBlock.dispose();
      });
      addBox(W - 0.07, H - 0.07, 0.012, 0, H * 0.5, D * 0.5 + 0.002, canvasMat, false);
      addBox(W * 0.42, H * 0.52, 0.014, -W * 0.12, H * 0.48, D * 0.5 + 0.005, accentBlock, false);
    }
  } else if (obj.parametricKind === 'console_table') {
    const woodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.54 });
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.36, metalness: 0.65 });
    disposables.push(() => {
      woodMat.dispose();
      legMat.dispose();
    });
    const cabH = H * 0.66;
    const legH = H - cabH;
    addBox(W, cabH, D, 0, legH + cabH * 0.5, 0, woodMat);
    const ix = W * 0.5 - 0.08;
    const iz = D * 0.5 - 0.06;
    for (const sx of [-ix, ix]) {
      for (const sz of [-iz, iz]) {
        addBox(0.032, legH, 0.032, sx, legH * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'floor_lamp') {
    const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.32, metalness: 0.72 });
    const shadeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      emissive: new THREE.Color(0xffdfa8),
      emissiveIntensity: 0.45,
      roughness: 0.8,
    });
    const baseGeo = new THREE.CylinderGeometry(Math.min(W, D) * 0.45, Math.min(W, D) * 0.48, 0.035, 24);
    const poleGeo = new THREE.CylinderGeometry(0.014, 0.014, H - 0.25, 12);
    const shadeGeo = new THREE.CylinderGeometry(Math.min(W, D) * 0.34, Math.min(W, D) * 0.48, 0.34, 24, 1, true);
    disposables.push(() => {
      poleMat.dispose();
      shadeMat.dispose();
      baseGeo.dispose();
      poleGeo.dispose();
      shadeGeo.dispose();
    });
    const base = new THREE.Mesh(baseGeo, poleMat);
    base.position.y = 0.018;
    base.castShadow = true;
    grp.add(base);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = (H - 0.25) * 0.5;
    grp.add(pole);
    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.y = H - 0.17;
    grp.add(shade);
  } else if (obj.parametricKind === 'rug_custom') {
    const isRoundRug = /yuvarlak|round|daire/i.test(obj.name);
    let rugTex: THREE.Texture;
    let disposeTex = false;
    if (obj.thumbUrl) {
      rugTex = new THREE.TextureLoader().load(obj.thumbUrl, () => onTextureReady?.());
      rugTex.colorSpace = THREE.SRGBColorSpace;
      disposeTex = true;
    } else {
      rugTex = createWovenRugTexture(primaryHex, accentHex);
    }
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.94, metalness: 0.01 });
    disposables.push(() => {
      if (disposeTex) rugTex.dispose();
      rugMat.dispose();
    });
    const rugH = Math.max(0.012, Math.min(0.025, H));
    if (isRoundRug) {
      const r = Math.max(W, D) * 0.5;
      const geo = new THREE.CylinderGeometry(r, r, rugH, 48);
      disposables.push(() => geo.dispose());
      const m = new THREE.Mesh(geo, rugMat);
      m.position.set(0, rugH * 0.5, 0);
      m.scale.set(W / (r * 2), 1, D / (r * 2));
      m.receiveShadow = true;
      grp.add(m);
    } else {
      addBox(W, rugH, D, 0, rugH * 0.5, 0, rugMat, false);
    }
  } else if (obj.parametricKind === 'chandelier') {
    const brassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex),
      roughness: 0.25,
      metalness: 0.88,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentHex) });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x2c2b29 });
    disposables.push(() => {
      brassMat.dispose();
      glowMat.dispose();
      wireMat.dispose();
    });

    const outerR = Math.min(W, D) * 0.48;
    const innerR = outerR * 0.62;

    const canGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.03, 20);
    const ring1Geo = new THREE.TorusGeometry(outerR, 0.016, 10, 36);
    ring1Geo.rotateX(Math.PI / 2);
    const ring2Geo = new THREE.TorusGeometry(innerR, 0.013, 10, 32);
    ring2Geo.rotateX(Math.PI / 2);
    const glow1Geo = new THREE.TorusGeometry(outerR - 0.008, 0.008, 8, 36);
    glow1Geo.rotateX(Math.PI / 2);
    const glow2Geo = new THREE.TorusGeometry(innerR - 0.007, 0.007, 8, 32);
    glow2Geo.rotateX(Math.PI / 2);

    disposables.push(() => {
      canGeo.dispose();
      ring1Geo.dispose();
      ring2Geo.dispose();
      glow1Geo.dispose();
      glow2Geo.dispose();
    });

    const can = new THREE.Mesh(canGeo, brassMat);
    can.position.set(0, H - 0.015, 0);
    grp.add(can);

    const ring1 = new THREE.Mesh(ring1Geo, brassMat);
    ring1.position.y = 0.06;
    grp.add(ring1);
    const glow1 = new THREE.Mesh(glow1Geo, glowMat);
    glow1.position.y = 0.052;
    grp.add(glow1);

    const ring2 = new THREE.Mesh(ring2Geo, brassMat);
    ring2.position.y = 0.17;
    grp.add(ring2);
    const glow2 = new THREE.Mesh(glow2Geo, glowMat);
    glow2.position.y = 0.163;
    grp.add(glow2);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pts = [
        new THREE.Vector3(Math.cos(a) * 0.06, H - 0.02, Math.sin(a) * 0.06),
        new THREE.Vector3(Math.cos(a) * outerR, 0.06, Math.sin(a) * outerR),
      ];
      const wGeo = new THREE.BufferGeometry().setFromPoints(pts);
      disposables.push(() => wGeo.dispose());
      const wire = new THREE.Line(wGeo, wireMat);
      wire.raycast = () => {};
      grp.add(wire);
    }
  }

  return {
    group: grp,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
