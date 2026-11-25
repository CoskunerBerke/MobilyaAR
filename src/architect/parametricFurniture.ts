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
    const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.48 });
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.36, metalness: 0.42 });
    disposables.push(() => {
      topMat.dispose();
      legMat.dispose();
    });
    const topT = 0.045;
    const legH = Math.max(0.3, H - topT);
    const isRound = /yuvarlak|round|oval|daire/i.test(obj.name);
    if (isRound) {
      const r = Math.max(W, D) * 0.5;
      const topGeo = new THREE.CylinderGeometry(r, r, topT, 40);
      const colGeo = new THREE.CylinderGeometry(r * 0.22, r * 0.28, legH, 28);
      const baseGeo = new THREE.CylinderGeometry(r * 0.48, r * 0.5, 0.035, 32);
      disposables.push(() => {
        topGeo.dispose();
        colGeo.dispose();
        baseGeo.dispose();
      });
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.set(0, H - topT * 0.5, 0);
      top.scale.set(W / (r * 2), 1, D / (r * 2));
      top.castShadow = true;
      top.receiveShadow = true;
      grp.add(top);
      const col = new THREE.Mesh(colGeo, legMat);
      col.position.set(0, legH * 0.5, 0);
      col.castShadow = true;
      grp.add(col);
      const base = new THREE.Mesh(baseGeo, legMat);
      base.position.set(0, 0.018, 0);
      grp.add(base);
    } else {
      addBox(W, topT, D, 0, H - topT * 0.5, 0, topMat);
      // Apron frame beneath tabletop for realistic carpentry look
      addBox(W - 0.14, 0.05, D - 0.14, 0, H - topT - 0.025, 0, topMat, false);
      const ix = Math.max(0.12, W * 0.5 - 0.09);
      const iz = Math.max(0.12, D * 0.5 - 0.09);
      for (const sx of [-ix, ix]) {
        for (const sz of [-iz, iz]) {
          addBox(0.055, legH, 0.055, sx, legH * 0.5, sz, legMat);
        }
      }
    }
  } else if (obj.parametricKind === 'dining_chair') {
    const seatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.78 });
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.36, metalness: 0.45 });
    disposables.push(() => {
      seatMat.dispose();
      legMat.dispose();
    });
    const seatY = Math.min(0.47, H * 0.54);
    addBox(W * 0.9, 0.065, D * 0.84, 0, seatY, 0.02, seatMat);
    addBox(W * 0.88, H - seatY, 0.065, 0, seatY + (H - seatY) * 0.5, -D * 0.38, seatMat);
    const ix = W * 0.38;
    const iz = D * 0.35;
    for (const sx of [-ix, ix]) {
      for (const sz of [-iz, iz]) {
        addBox(0.032, seatY, 0.032, sx, seatY * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'sofa') {
    const fabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.9 });
    const cushionMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex).lerp(new THREE.Color('#ffffff'), 0.06),
      roughness: 0.92,
    });
    const pillowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.86 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x262422, roughness: 0.38, metalness: 0.55 });
    disposables.push(() => {
      fabMat.dispose();
      cushionMat.dispose();
      pillowMat.dispose();
      legMat.dispose();
    });
    const legH = 0.12;
    const armW = Math.min(0.18, W * 0.11);
    const seatH = Math.min(0.32, Math.max(0.22, H * 0.34));
    const backD = Math.min(0.22, D * 0.24);
    const innerW = Math.max(0.4, W - armW * 2);
    // Base deck
    addBox(W, 0.14, D - 0.04, 0, legH + 0.07, 0, fabMat);
    // Backrest
    addBox(W, H - legH - 0.08, backD, 0, legH + 0.08 + (H - legH - 0.08) * 0.5, -D * 0.5 + backD * 0.5, fabMat);
    // Left & Right Armrests
    const armH = Math.min(H * 0.72, legH + seatH + 0.2);
    addBox(armW, armH - legH, D, -W * 0.5 + armW * 0.5, legH + (armH - legH) * 0.5, 0, fabMat);
    addBox(armW, armH - legH, D, W * 0.5 - armW * 0.5, legH + (armH - legH) * 0.5, 0, fabMat);
    // Seat cushions (2 or 3 distinct tufted sections)
    const seats = W >= 2.0 ? 3 : W >= 1.25 ? 2 : 1;
    const cw = (innerW - 0.02 * (seats - 1)) / seats;
    for (let i = 0; i < seats; i++) {
      const cx = -innerW * 0.5 + cw * (i + 0.5) + i * 0.02;
      addBox(cw, seatH * 0.58, D - backD - 0.03, cx, legH + 0.14 + seatH * 0.29, backD * 0.5 + 0.01, cushionMat);
      addBox(cw - 0.02, H - legH - 0.14 - seatH * 0.55, 0.14, cx, legH + 0.14 + seatH * 0.55 + (H - legH - 0.14 - seatH * 0.55) * 0.48, -D * 0.5 + backD + 0.07, cushionMat);
    }
    // Throw accent pillows on corners
    if (W >= 1.2) {
      addBox(0.32, 0.3, 0.11, -innerW * 0.38, legH + 0.14 + seatH * 0.6 + 0.14, -D * 0.5 + backD + 0.18, pillowMat);
      addBox(0.32, 0.3, 0.11, innerW * 0.38, legH + 0.14 + seatH * 0.6 + 0.14, -D * 0.5 + backD + 0.18, pillowMat);
    }
    // Tapered legs
    const lx = W * 0.5 - 0.12;
    const lz = D * 0.5 - 0.1;
    for (const sx of [-lx, lx]) {
      for (const sz of [-lz, lz]) {
        addBox(0.04, legH, 0.04, sx, legH * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'armchair') {
    const fabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.9 });
    const cushionMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex).lerp(new THREE.Color('#ffffff'), 0.05),
      roughness: 0.92,
    });
    const pillowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.86 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x262422, roughness: 0.4, metalness: 0.4 });
    disposables.push(() => {
      fabMat.dispose();
      cushionMat.dispose();
      pillowMat.dispose();
      legMat.dispose();
    });
    const legH = 0.1;
    const armW = Math.min(0.15, W * 0.18);
    const innerW = Math.max(0.36, W - armW * 2);
    const backD = Math.min(0.18, D * 0.24);
    addBox(W, 0.16, D - 0.03, 0, legH + 0.08, 0, fabMat);
    addBox(W, H - legH - 0.08, backD, 0, legH + 0.08 + (H - legH - 0.08) * 0.5, -D * 0.5 + backD * 0.5, fabMat);
    const armH = H * 0.72;
    addBox(armW, armH - legH, D, -W * 0.5 + armW * 0.5, legH + (armH - legH) * 0.5, 0, fabMat);
    addBox(armW, armH - legH, D, W * 0.5 - armW * 0.5, legH + (armH - legH) * 0.5, 0, fabMat);
    addBox(innerW, 0.17, D - backD - 0.03, 0, legH + 0.24, backD * 0.5 + 0.01, cushionMat);
    // Decorative accent pillow
    addBox(Math.min(0.34, innerW * 0.58), 0.28, 0.1, 0, legH + 0.46, -D * 0.5 + backD + 0.12, pillowMat);
    for (const sx of [-W * 0.38, W * 0.38]) {
      for (const sz of [-D * 0.36, D * 0.36]) {
        addBox(0.038, legH, 0.038, sx, legH * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'coffee_table_round') {
    const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.42, metalness: 0.08 });
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.5, metalness: 0.2 });
    const bookMat = new THREE.MeshStandardMaterial({ color: 0xeae5db, roughness: 0.8 });
    disposables.push(() => {
      topMat.dispose();
      baseMat.dispose();
      bookMat.dispose();
    });
    const r = Math.max(W, D) * 0.5;
    const topT = 0.04;
    const topGeo = new THREE.CylinderGeometry(r, r, topT, 40);
    const pedGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.46, Math.max(0.15, H - topT), 32);
    disposables.push(() => {
      topGeo.dispose();
      pedGeo.dispose();
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.set(0, H - topT * 0.5, 0);
    top.scale.set(W / (r * 2), 1, D / (r * 2));
    top.castShadow = true;
    top.receiveShadow = true;
    grp.add(top);
    const ped = new THREE.Mesh(pedGeo, baseMat);
    ped.position.set(0, (H - topT) * 0.5, 0);
    ped.castShadow = true;
    grp.add(ped);
    // Subtle decorative coffee-table book
    addBox(Math.min(0.26, W * 0.35), 0.028, Math.min(0.2, D * 0.28), -W * 0.1, H + 0.014, 0.02, bookMat, false);
  } else if (obj.parametricKind === 'coffee_table_rect') {
    const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.45 });
    const legMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.35, metalness: 0.5 });
    disposables.push(() => {
      topMat.dispose();
      legMat.dispose();
    });
    const topT = 0.042;
    addBox(W, topT, D, 0, H - topT * 0.5, 0, topMat);
    if (H > 0.28) {
      addBox(W - 0.14, 0.022, D - 0.14, 0, H * 0.36, 0, topMat, false);
    }
    const legH = Math.max(0.15, H - topT);
    for (const sx of [-W * 0.44, W * 0.44]) {
      for (const sz of [-D * 0.42, D * 0.42]) {
        addBox(0.036, legH, 0.036, sx, legH * 0.5, sz, legMat);
      }
    }
  } else if (obj.parametricKind === 'desk' || obj.parametricKind === 'vanity_table') {
    const topMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.5 });
    const cabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.58 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x252527, roughness: 0.35, metalness: 0.7 });
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.14, metalness: 0.35 });
    disposables.push(() => {
      topMat.dispose();
      cabMat.dispose();
      metalMat.dispose();
      screenMat.dispose();
    });
    const topT = 0.04;
    const legH = Math.max(0.45, H - topT);
    addBox(W, topT, D, 0, H - topT * 0.5, 0, topMat);
    if (obj.parametricKind === 'desk' && W >= 1.0) {
      // Right pedestal drawer unit + left slim steel frame legs
      const pedW = Math.min(0.45, W * 0.3);
      addBox(pedW, legH, D - 0.06, W * 0.5 - pedW * 0.5 - 0.03, legH * 0.5, 0, cabMat);
      for (let d = 0; d < 3; d++) {
        const dy = legH * (0.2 + d * 0.3);
        addBox(pedW * 0.35, 0.012, 0.02, W * 0.5 - pedW * 0.5 - 0.03, dy, (D - 0.06) * 0.5 + 0.01, metalMat, false);
      }
      // Left leg pair
      addBox(0.036, legH, 0.036, -W * 0.5 + 0.06, legH * 0.5, -D * 0.5 + 0.06, metalMat);
      addBox(0.036, legH, 0.036, -W * 0.5 + 0.06, legH * 0.5, D * 0.5 - 0.06, metalMat);
      // Slim desktop monitor
      addBox(0.56, 0.34, 0.024, -W * 0.08, H + 0.25, -D * 0.26, screenMat);
      addBox(0.04, 0.12, 0.04, -W * 0.08, H + 0.06, -D * 0.28, metalMat, false);
      addBox(0.18, 0.012, 0.14, -W * 0.08, H + 0.006, -D * 0.26, metalMat, false);
    } else {
      // Vanity / console desk with slim apron drawers & 4 legs
      addBox(W - 0.08, 0.13, D - 0.06, 0, H - topT - 0.065, 0, topMat);
      addBox(0.02, 0.015, 0.02, -W * 0.22, H - topT - 0.065, D * 0.5 - 0.01, metalMat, false);
      addBox(0.02, 0.015, 0.02, W * 0.22, H - topT - 0.065, D * 0.5 - 0.01, metalMat, false);
      for (const sx of [-W * 0.45, W * 0.45]) {
        for (const sz of [-D * 0.42, D * 0.42]) {
          addBox(0.036, legH, 0.036, sx, legH * 0.5, sz, cabMat);
        }
      }
    }
  } else if (obj.parametricKind === 'office_chair') {
    const seatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.62 });
    const metalMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.32, metalness: 0.72 });
    disposables.push(() => {
      seatMat.dispose();
      metalMat.dispose();
    });
    const seatY = Math.min(0.48, H * 0.52);
    // 5-star caster base + gas lift cylinder
    const stemGeo = new THREE.CylinderGeometry(0.025, 0.028, seatY - 0.08, 16);
    disposables.push(() => stemGeo.dispose());
    const stem = new THREE.Mesh(stemGeo, metalMat);
    stem.position.y = 0.08 + (seatY - 0.08) * 0.5;
    grp.add(stem);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const armGeo = new THREE.BoxGeometry(0.03, 0.026, Math.min(0.28, W * 0.45));
      disposables.push(() => armGeo.dispose());
      const arm = new THREE.Mesh(armGeo, metalMat);
      arm.rotation.y = ang;
      arm.position.set(Math.sin(ang) * 0.13, 0.06, Math.cos(ang) * 0.13);
      grp.add(arm);
    }
    // Contoured upholstered seat + backrest + armrests
    addBox(W * 0.82, 0.08, D * 0.78, 0, seatY, 0.02, seatMat);
    addBox(W * 0.78, H - seatY - 0.04, 0.08, 0, seatY + (H - seatY) * 0.5, -D * 0.34, seatMat);
    addBox(0.04, 0.2, D * 0.52, -W * 0.42, seatY + 0.12, 0, metalMat, false);
    addBox(0.04, 0.2, D * 0.52, W * 0.42, seatY + 0.12, 0, metalMat, false);
  } else if (obj.parametricKind === 'nightstand') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.56 });
    const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.36, metalness: 0.65 });
    disposables.push(() => {
      bodyMat.dispose();
      accentMat.dispose();
    });
    const legH = Math.min(0.1, H * 0.18);
    const boxH = Math.max(0.2, H - legH);
    addBox(W, boxH, D, 0, legH + boxH * 0.5, 0, bodyMat);
    addBox(W * 0.34, 0.014, 0.02, 0, legH + boxH * 0.72, D * 0.5 + 0.01, accentMat, false);
    addBox(W * 0.34, 0.014, 0.02, 0, legH + boxH * 0.32, D * 0.5 + 0.01, accentMat, false);
    for (const sx of [-W * 0.42, W * 0.42]) {
      for (const sz of [-D * 0.4, D * 0.4]) {
        addBox(0.028, legH, 0.028, sx, legH * 0.5, sz, accentMat);
      }
    }
  } else if (obj.parametricKind === 'sideboard') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.58 });
    const seamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex).multiplyScalar(0.82), roughness: 0.65 });
    const handleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.34, metalness: 0.68 });
    disposables.push(() => {
      bodyMat.dispose();
      seamMat.dispose();
      handleMat.dispose();
    });
    const legH = Math.min(0.14, H * 0.18);
    const cabH = Math.max(0.25, H - legH);
    addBox(W, cabH, D - 0.02, 0, legH + cabH * 0.5, -0.01, bodyMat);
    const doors = Math.max(2, Math.min(5, Math.round(W / 0.48)));
    const dw = (W - 0.02) / doors;
    for (let i = 0; i < doors; i++) {
      const dx = -W * 0.5 + 0.01 + dw * (i + 0.5);
      addBox(dw - 0.012, cabH - 0.04, 0.02, dx, legH + cabH * 0.5, D * 0.5 - 0.01, bodyMat);
      if (i > 0) addBox(0.008, cabH - 0.04, 0.01, dx - dw * 0.5, legH + cabH * 0.5, D * 0.5 - 0.014, seamMat, false);
      addBox(0.02, 0.02, 0.02, dx + (i % 2 === 0 ? dw * 0.34 : -dw * 0.34), legH + cabH * 0.72, D * 0.5 + 0.008, handleMat, false);
    }
    for (const sx of [-W * 0.45, W * 0.45]) {
      for (const sz of [-D * 0.38, D * 0.38]) {
        addBox(0.032, legH, 0.032, sx, legH * 0.5, sz, handleMat);
      }
    }
  } else if (obj.parametricKind === 'ottoman') {
    const fabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.92 });
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.5 });
    disposables.push(() => {
      fabMat.dispose();
      baseMat.dispose();
    });
    const r = Math.max(W, D) * 0.5;
    const bodyGeo = new THREE.CylinderGeometry(r, r * 0.96, Math.max(0.18, H - 0.03), 32);
    const rimGeo = new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.03, 28);
    disposables.push(() => {
      bodyGeo.dispose();
      rimGeo.dispose();
    });
    const body = new THREE.Mesh(bodyGeo, fabMat);
    body.position.set(0, 0.03 + (H - 0.03) * 0.5, 0);
    body.scale.set(W / (r * 2), 1, D / (r * 2));
    body.castShadow = true;
    body.receiveShadow = true;
    grp.add(body);
    const rim = new THREE.Mesh(rimGeo, baseMat);
    rim.position.set(0, 0.015, 0);
    grp.add(rim);
  } else if (obj.parametricKind === 'potted_plant') {
    // Primary color = foliage / pot tint so user can even recolor the pot or foliage!
    const isGreenish = (() => {
      const c = new THREE.Color(primaryHex);
      return c.g > c.r * 1.06 && c.g > c.b * 1.02;
    })();
    const potColor = isGreenish ? accentHex || '#3a3835' : primaryHex;
    const leafColor = isGreenish ? primaryHex : '#4c6444';
    const potMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(potColor), roughness: 0.72 });
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.96 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x624936, roughness: 0.88 });
    const leafMat1 = new THREE.MeshStandardMaterial({ color: new THREE.Color(leafColor), roughness: 0.82 });
    const leafMat2 = new THREE.MeshStandardMaterial({
      color: new THREE.Color(leafColor).multiplyScalar(0.78),
      roughness: 0.85,
    });
    disposables.push(() => {
      potMat.dispose();
      soilMat.dispose();
      trunkMat.dispose();
      leafMat1.dispose();
      leafMat2.dispose();
    });

    const potR = Math.min(0.24, Math.min(W, D) * 0.3);
    const potH = Math.min(0.42, H * 0.24);
    const potGeo = new THREE.CylinderGeometry(potR, potR * 0.76, potH, 24);
    const soilGeo = new THREE.CylinderGeometry(potR * 0.92, potR * 0.92, 0.02, 20);
    const trunkH = Math.max(0.2, H * 0.46);
    const trunkGeo = new THREE.CylinderGeometry(0.018, 0.032, trunkH, 10);
    disposables.push(() => {
      potGeo.dispose();
      soilGeo.dispose();
      trunkGeo.dispose();
    });

    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.y = potH * 0.5;
    pot.castShadow = true;
    pot.receiveShadow = true;
    grp.add(pot);

    const soil = new THREE.Mesh(soilGeo, soilMat);
    soil.position.y = potH - 0.01;
    grp.add(soil);

    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = potH + trunkH * 0.45;
    trunk.castShadow = true;
    grp.add(trunk);

    // Organic multi-cluster canopy (looks like realistic olive / ficus tree!)
    const canopyR = Math.min(W, D) * 0.46;
    const crownBaseY = potH + trunkH * 0.72;
    const crownTopY = H - canopyR * 0.38;
    const clusters: Array<[number, number, number, number, boolean]> = [
      [0, crownTopY, 0, canopyR * 0.58, true],
      [-canopyR * 0.42, (crownBaseY + crownTopY) * 0.52, canopyR * 0.24, canopyR * 0.48, false],
      [canopyR * 0.4, (crownBaseY + crownTopY) * 0.55, -canopyR * 0.2, canopyR * 0.46, true],
      [canopyR * 0.16, crownBaseY + (crownTopY - crownBaseY) * 0.25, canopyR * 0.4, canopyR * 0.42, false],
      [-canopyR * 0.24, crownBaseY + (crownTopY - crownBaseY) * 0.22, -canopyR * 0.36, canopyR * 0.44, true],
      [0, crownBaseY + (crownTopY - crownBaseY) * 0.65, -canopyR * 0.14, canopyR * 0.5, false],
    ];
    const leafGeo = new THREE.DodecahedronGeometry(1, 1);
    disposables.push(() => leafGeo.dispose());
    clusters.forEach(([cx, cy, cz, cr, bright], idx) => {
      const m = new THREE.Mesh(leafGeo, bright ? leafMat1 : leafMat2);
      m.position.set(cx, Math.max(potH + 0.12, cy), cz);
      m.scale.set(cr, cr * 0.88, cr);
      m.rotation.set(idx * 0.5, idx * 0.9, idx * 0.3);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    });
  } else if (obj.parametricKind === 'table_lamp') {
    const baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.32, metalness: 0.65 });
    const shadeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex || '#fff4dc'),
      emissive: new THREE.Color(0xffdfa6),
      emissiveIntensity: 0.65,
      roughness: 0.45,
    });
    const r = Math.min(W, D) * 0.46;
    const baseGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.52, H * 0.45, 24);
    const domeGeo = new THREE.SphereGeometry(r, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
    disposables.push(() => {
      baseMat.dispose();
      shadeMat.dispose();
      baseGeo.dispose();
      domeGeo.dispose();
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = H * 0.225;
    base.castShadow = true;
    grp.add(base);
    const dome = new THREE.Mesh(domeGeo, shadeMat);
    dome.position.y = H - r * 0.62;
    grp.add(dome);
  } else if (obj.parametricKind === 'stairs') {
    const treadMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.58 });
    const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.35, metalness: 0.72 });
    disposables.push(() => {
      treadMat.dispose();
      steelMat.dispose();
    });
    const steps = Math.max(5, Math.min(12, Math.round(H / 0.21)));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const sy = H * t;
      const sz = -D * 0.5 + D * t;
      addBox(W, 0.048, (D / steps) * 1.15, 0, sy, sz, treadMat);
    }
    // Side steel stringers
    const diagLen = Math.hypot(D, H);
    const angle = Math.atan2(H, D);
    for (const sx of [-W * 0.44, W * 0.44]) {
      const stGeo = new THREE.BoxGeometry(0.05, 0.14, diagLen);
      disposables.push(() => stGeo.dispose());
      const st = new THREE.Mesh(stGeo, steelMat);
      st.position.set(sx, H * 0.5 - 0.06, 0);
      st.rotation.x = -angle;
      st.castShadow = true;
      grp.add(st);
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
