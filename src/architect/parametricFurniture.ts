import * as THREE from 'three';
import type { ArchPlacedObject } from './types';
import { createFloorTexture, createWallTexture, createWovenRugTexture } from './textures';

/**
 * Builds high-craft procedural 3D architectural elements (Marble Fireplace + TV Wall,
 * Slatted TV Wall Unit, Frameless OLED Wall TV, Custom Woven Rug, Brass Architectural Chandelier)
 * centered at X=0, Z=0 with bottom resting strictly at Y=0.
 */
export function buildParametricObject3D(obj: ArchPlacedObject): { group: THREE.Group; dispose: () => void } {
  const grp = new THREE.Group();
  const disposables: Array<() => void> = [];

  const W = Math.max(0.25, obj.widthM);
  const D = Math.max(0.04, obj.depthM);
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
    const marbleTex = createFloorTexture('marble', primaryHex, W * 1.4, H * 1.4);
    disposables.push(() => marbleTex.dispose());
    const marbleMat = new THREE.MeshStandardMaterial({
      map: marbleTex,
      roughness: 0.28,
      metalness: 0.04,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.42,
      metalness: 0.55,
    });
    const screenMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0e11,
      roughness: 0.08,
      metalness: 0.25,
      clearcoat: 0.9,
    });
    const fireGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8c2b });
    const fireCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff5e8,
      transparent: true,
      opacity: 0.18,
      roughness: 0.05,
    });
    disposables.push(() => {
      marbleMat.dispose();
      darkSteelMat.dispose();
      screenMat.dispose();
      fireGlowMat.dispose();
      fireCoreMat.dispose();
      glassMat.dispose();
    });

    // Low marble hearth bench across full width
    const hearthH = Math.min(0.32, H * 0.14);
    addBox(W, hearthH, D, 0, hearthH * 0.5, 0, marbleMat);

    // Main chimney monolith rising behind hearth
    const bodyW = W * 0.72;
    const bodyD = D * 0.82;
    const bodyZ = -(D - bodyD) * 0.5;
    const fireW = Math.min(bodyW * 0.72, 1.15);
    const fireH = Math.min(0.42, H * 0.2);
    const fireBottom = hearthH + 0.06;
    const fireTop = fireBottom + fireH;

    // Left & right marble piers beside firebox
    const pierW = (bodyW - fireW) * 0.5;
    if (pierW > 0.05) {
      addBox(pierW, fireH + 0.06, bodyD, -bodyW * 0.5 + pierW * 0.5, hearthH + (fireH + 0.06) * 0.5, bodyZ, marbleMat);
      addBox(pierW, fireH + 0.06, bodyD, bodyW * 0.5 - pierW * 0.5, hearthH + (fireH + 0.06) * 0.5, bodyZ, marbleMat);
    }
    // Back dark steel firebox wall + base
    addBox(fireW + 0.04, fireH + 0.06, bodyD * 0.45, 0, hearthH + (fireH + 0.06) * 0.5, bodyZ - bodyD * 0.25, darkSteelMat);
    addBox(fireW, 0.06, bodyD * 0.92, 0, hearthH + 0.03, bodyZ, darkSteelMat);

    // Glowing linear bio-ethanol / wood flames
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
    // Ember strip & protective glass front
    addBox(fireW * 0.85, 0.025, 0.08, 0, fireBottom + 0.015, bodyZ + 0.03, fireGlowMat, false);
    addBox(fireW, fireH * 0.88, 0.01, 0, fireBottom + fireH * 0.46, bodyZ + bodyD * 0.46, glassMat, false);

    // Warm hearth PointLight
    const hearthLight = new THREE.PointLight(0xff9438, 1.15, 3.6, 1.8);
    hearthLight.position.set(0, fireBottom + fireH * 0.5, bodyZ + bodyD * 0.65);
    grp.add(hearthLight);

    // Upper marble monolith above firebox up to H
    const upperH = Math.max(0.25, H - fireTop);
    addBox(bodyW, upperH, bodyD, 0, fireTop + upperH * 0.5, bodyZ, marbleMat);

    // Integrated slim OLED TV mounted on upper marble monolith (if tall enough)
    if (H >= 1.9 && bodyW >= 1.2) {
      const tvW = Math.min(bodyW * 0.82, 1.48);
      const tvH = tvW * 0.5625;
      const tvY = Math.min(H - tvH * 0.5 - 0.25, fireTop + 0.3 + tvH * 0.5);
      addBox(tvW + 0.02, tvH + 0.02, 0.032, 0, tvY, bodyZ + bodyD * 0.5 + 0.016, darkSteelMat);
      addBox(tvW, tvH, 0.008, 0, tvY, bodyZ + bodyD * 0.5 + 0.034, screenMat, false);
    }
  } else if (obj.parametricKind === 'tv_wall_unit') {
    const slatTex = createWallTexture('slats', primaryHex);
    disposables.push(() => slatTex.dispose());
    const slatMat = new THREE.MeshStandardMaterial({ map: slatTex, roughness: 0.65 });
    const consoleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.48,
      metalness: 0.08,
    });
    const screenMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0c10,
      roughness: 0.08,
      metalness: 0.25,
      clearcoat: 0.9,
    });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffdca8 });
    disposables.push(() => {
      slatMat.dispose();
      consoleMat.dispose();
      screenMat.dispose();
      ledMat.dispose();
    });

    // Full-height acoustic walnut slatted backboard
    addBox(W, H, 0.05, 0, H * 0.5, -D * 0.5 + 0.025, slatMat);
    // Floating media console
    const consH = 0.36;
    addBox(W * 0.94, consH, D - 0.05, 0, 0.22 + consH * 0.5, 0.025, consoleMat);
    // Subtle warm LED strip under console
    addBox(W * 0.88, 0.015, 0.03, 0, 0.215, D * 0.25, ledMat, false);
    // Mounted OLED TV
    const tvW = Math.min(W * 0.64, 1.55);
    const tvH = tvW * 0.5625;
    const tvY = Math.min(H - tvH * 0.5 - 0.2, 1.32);
    addBox(tvW + 0.025, tvH + 0.025, 0.036, 0, tvY, -D * 0.5 + 0.07, consoleMat);
    addBox(tvW, tvH, 0.008, 0, tvY, -D * 0.5 + 0.09, screenMat, false);
  } else if (obj.parametricKind === 'wall_tv') {
    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.35, metalness: 0.6 });
    const screenMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0c10,
      roughness: 0.07,
      metalness: 0.25,
      clearcoat: 0.95,
    });
    disposables.push(() => {
      bezelMat.dispose();
      screenMat.dispose();
    });
    addBox(W, H, Math.max(0.035, D * 0.7), 0, H * 0.5, 0, bezelMat);
    addBox(W - 0.025, H - 0.025, 0.008, 0, H * 0.5, Math.max(0.02, D * 0.38), screenMat, false);
  } else if (obj.parametricKind === 'rug_custom') {
    const rugTex = createWovenRugTexture(primaryHex, accentHex);
    disposables.push(() => rugTex.dispose());
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.94, metalness: 0.01 });
    disposables.push(() => rugMat.dispose());
    addBox(W, Math.max(0.012, H), D, 0, Math.max(0.006, H * 0.5), 0, rugMat, false);
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

    // Ceiling canopy at top (y = H)
    const canGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.035, 24);
    disposables.push(() => canGeo.dispose());
    const can = new THREE.Mesh(canGeo, brassMat);
    can.position.set(0, H - 0.018, 0);
    grp.add(can);

    // Outer & inner luminous rings
    const ring1Geo = new THREE.TorusGeometry(outerR, 0.018, 12, 48);
    ring1Geo.rotateX(Math.PI / 2);
    const ring2Geo = new THREE.TorusGeometry(innerR, 0.014, 12, 40);
    ring2Geo.rotateX(Math.PI / 2);
    disposables.push(() => {
      ring1Geo.dispose();
      ring2Geo.dispose();
    });

    const ring1 = new THREE.Mesh(ring1Geo, brassMat);
    ring1.position.y = 0.08;
    grp.add(ring1);

    const glow1Geo = new THREE.TorusGeometry(outerR - 0.01, 0.009, 8, 48);
    glow1Geo.rotateX(Math.PI / 2);
    disposables.push(() => glow1Geo.dispose());
    const glow1 = new THREE.Mesh(glow1Geo, glowMat);
    glow1.position.y = 0.072;
    grp.add(glow1);

    const ring2 = new THREE.Mesh(ring2Geo, brassMat);
    ring2.position.y = 0.2;
    grp.add(ring2);

    const glow2Geo = new THREE.TorusGeometry(innerR - 0.008, 0.008, 8, 40);
    glow2Geo.rotateX(Math.PI / 2);
    disposables.push(() => glow2Geo.dispose());
    const glow2 = new THREE.Mesh(glow2Geo, glowMat);
    glow2.position.y = 0.193;
    grp.add(glow2);

    // Thin suspension cables
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const pts = [
        new THREE.Vector3(Math.cos(a) * 0.07, H - 0.02, Math.sin(a) * 0.07),
        new THREE.Vector3(Math.cos(a) * outerR, 0.08, Math.sin(a) * outerR),
      ];
      const wGeo = new THREE.BufferGeometry().setFromPoints(pts);
      disposables.push(() => wGeo.dispose());
      grp.add(new THREE.Line(wGeo, wireMat));
    }

    const pendantLight = new THREE.PointLight(new THREE.Color(accentHex), 1.0, 5.5, 1.6);
    pendantLight.position.set(0, 0.04, 0);
    grp.add(pendantLight);
  }

  return {
    group: grp,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
