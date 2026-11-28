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

  if (obj.parametricKind === 'linear_fireplace' && H <= 0.25) {
    // Sleek tabletop glass-shielded bioethanol linear burner strip (sits cleanly ON TOP OF floating console/baza!)
    const steelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex || '#242322'),
      roughness: 0.34,
      metalness: 0.65,
    });
    const fireGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8c2b });
    const fireCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xf4f9ff,
      transparent: true,
      opacity: 0.24,
      roughness: 0.06,
      metalness: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    disposables.push(() => {
      steelMat.dispose();
      fireGlowMat.dispose();
      fireCoreMat.dispose();
      glassMat.dispose();
    });

    const trayH = Math.max(0.032, Math.min(0.06, H * 0.34));
    const glassH = Math.max(0.08, H - trayH * 0.5);
    // Matte-black steel burner base tray + center combustion slot
    addBox(W, trayH, D, 0, trayH * 0.5, 0, steelMat);
    addBox(W * 0.84, 0.012, Math.max(0.03, D * 0.26), 0, trayH + 0.005, 0, fireGlowMat, false);
    // Warm linear bioethanol flame ribbon
    const flames = Math.max(6, Math.min(12, Math.round(W * 10)));
    for (let i = 0; i < flames; i++) {
      const fx = -W * 0.38 + (W * 0.76 * i) / Math.max(1, flames - 1);
      const fh = Math.min(glassH * 0.72, 0.065 + (i % 3) * 0.022);
      const coneGeo = new THREE.ConeGeometry(0.018, fh, 6);
      disposables.push(() => coneGeo.dispose());
      const f = new THREE.Mesh(coneGeo, i % 2 === 0 ? fireGlowMat : fireCoreMat);
      f.position.set(fx, trayH + fh * 0.45, 0);
      grp.add(f);
    }
    // Front & back crystal-clear tempered glass wind-guard shields
    addBox(W * 0.96, glassH, 0.008, 0, trayH * 0.5 + glassH * 0.5, D * 0.44, glassMat, false);
    addBox(W * 0.96, glassH, 0.008, 0, trayH * 0.5 + glassH * 0.5, -D * 0.44, glassMat, false);
    const hearthLight = new THREE.PointLight(0xff9438, 0.85, 2.8, 1.8);
    hearthLight.position.set(0, trayH + glassH * 0.7, D * 0.45);
    grp.add(hearthLight);
  } else if (obj.parametricKind === 'linear_fireplace' || (obj.parametricKind === 'fireplace_marble' && H <= 1.05)) {
    // Modern low horizontal fireplace bench / TV baza (Şömineli Alçak TV Bazası)
    const isStone = /mermer|taş|stone|marble|beton|concrete/i.test(obj.name);
    const bodyTex = isStone ? createFloorTexture('marble', primaryHex, W * 1.2, H * 1.4) : null;
    const bodyMat = new THREE.MeshStandardMaterial({
      ...(bodyTex ? { map: bodyTex } : { color: new THREE.Color(primaryHex) }),
      roughness: isStone ? 0.3 : 0.5,
      metalness: 0.05,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex || '#1e1e20'), roughness: 0.36, metalness: 0.55 });
    const fireGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8c2b });
    const fireCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xfff5e8,
      transparent: true,
      opacity: 0.18,
      roughness: 0.08,
      metalness: 0.2,
      depthWrite: false,
    });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffdca8 });
    disposables.push(() => {
      bodyMat.dispose();
      darkMat.dispose();
      fireGlowMat.dispose();
      fireCoreMat.dispose();
      glassMat.dispose();
      ledMat.dispose();
    });

    const baseH = Math.max(0.08, H * 0.24);
    const topT = Math.max(0.05, H * 0.16);
    const fireH = Math.max(0.14, H - baseH - topT);
    const fireW = Math.min(W * 0.62, Math.max(0.75, W * 0.48));
    const sideW = Math.max(0.12, (W - fireW) * 0.5);

    // Lower hearth plinth + top slab
    addBox(W, baseH, D, 0, baseH * 0.5, 0, bodyMat);
    addBox(W, topT, D, 0, H - topT * 0.5, 0, bodyMat);
    // Flanking cabinet bays left & right of linear fire ribbon
    addBox(sideW, fireH, D, -W * 0.5 + sideW * 0.5, baseH + fireH * 0.5, 0, bodyMat);
    addBox(sideW, fireH, D, W * 0.5 - sideW * 0.5, baseH + fireH * 0.5, 0, bodyMat);
    // Dark recessed burner firebox + glass shield + warm horizontal ribbon flames
    addBox(fireW + 0.02, fireH, D * 0.55, 0, baseH + fireH * 0.5, -D * 0.18, darkMat);
    addBox(fireW * 0.92, 0.03, D * 0.32, 0, baseH + 0.015, D * 0.05, darkMat, false);
    const flames = Math.max(7, Math.min(13, Math.round(fireW * 9)));
    for (let i = 0; i < flames; i++) {
      const fx = -fireW * 0.42 + (fireW * 0.84 * i) / Math.max(1, flames - 1);
      const fh = Math.min(fireH * 0.68, 0.09 + (i % 3) * 0.032);
      const coneGeo = new THREE.ConeGeometry(0.026, fh, 6);
      disposables.push(() => coneGeo.dispose());
      const f = new THREE.Mesh(coneGeo, i % 2 === 0 ? fireGlowMat : fireCoreMat);
      f.position.set(fx, baseH + 0.02 + fh * 0.45, D * 0.08);
      grp.add(f);
    }
    addBox(fireW * 0.94, 0.018, 0.05, 0, baseH + 0.02, D * 0.08, fireGlowMat, false);
    addBox(fireW, fireH * 0.92, 0.01, 0, baseH + fireH * 0.48, D * 0.46, glassMat, false);
    addBox(W * 0.9, 0.012, 0.022, 0, 0.008, D * 0.35, ledMat, false);

    const hearthLight = new THREE.PointLight(0xff9438, 0.95, 3.4, 1.8);
    hearthLight.position.set(0, baseH + fireH * 0.5, D * 0.65);
    grp.add(hearthLight);
  } else if (obj.parametricKind === 'fireplace_marble') {
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
  } else if (obj.parametricKind === 'tv_baza') {
    // Sleek modern floating or floor low TV media console / baza with minimalist doors, media niche & warm under-LED
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.48, metalness: 0.04 });
    const seamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex).multiplyScalar(0.76), roughness: 0.65 });
    const nicheMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex || '#202022'), roughness: 0.52 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffdca8 });
    disposables.push(() => {
      bodyMat.dispose();
      seamMat.dispose();
      nicheMat.dispose();
      ledMat.dispose();
    });

    // Main monolithic body with crisp top chamfer
    addBox(W, H, D - 0.02, 0, H * 0.5, -0.01, bodyMat);
    addBox(W + 0.006, 0.022, D, 0, H - 0.011, 0, bodyMat);

    // 3 or 4 minimalist handleless drawer/door fronts (optionally dark open center media niche if wide)
    const cols = W >= 2.2 ? 4 : W >= 1.45 ? 3 : 2;
    const cw = (W - 0.03) / cols;
    const hasOpenCenter = cols === 3 && /ceviz|ahşap|wood|walnut|meşe|open|açık/i.test(`${obj.name} ${primaryHex}`);
    for (let i = 0; i < cols; i++) {
      const cx = -W * 0.5 + 0.015 + cw * (i + 0.5);
      if (hasOpenCenter && i === 1) {
        addBox(cw - 0.02, H - 0.07, 0.04, cx, H * 0.48, D * 0.5 - 0.025, nicheMat, false);
      } else {
        addBox(cw - 0.01, H - 0.035, 0.02, cx, H * 0.49, D * 0.5 - 0.01, bodyMat);
      }
      if (i > 0) addBox(0.007, H - 0.035, 0.012, cx - cw * 0.5, H * 0.49, D * 0.5 - 0.012, seamMat, false);
    }
    // Subtle warm recessed under-glow strip
    addBox(W * 0.9, 0.012, 0.022, 0, 0.008, D * 0.22, ledMat, false);
  } else if (obj.parametricKind === 'wall_shelf') {
    // Floating wall shelf, open box cubby, or multi-tier architectural wall bookcase (never a pitch-black TV box!)
    const baseCol = new THREE.Color(primaryHex || '#f2f0ec');
    const woodMat = new THREE.MeshStandardMaterial({ color: baseCol, roughness: 0.5 });
    const backCol = baseCol.clone().multiplyScalar(0.92);
    const backMat = new THREE.MeshStandardMaterial({ color: backCol, roughness: 0.76 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffe4b8 });
    disposables.push(() => {
      woodMat.dispose();
      backMat.dispose();
      ledMat.dispose();
    });
    if (H >= 0.42) {
      // Multi-tier recessed / floating wall bookcase with crisp horizontal shelves, books & small framed art prints!
      const t = 0.026;
      const tiers = Math.max(2, Math.min(5, Math.round(H / 0.34)));
      addBox(W, t, D, 0, t * 0.5, 0, woodMat);
      addBox(W, t, D, 0, H - t * 0.5, 0, woodMat);
      addBox(t, H, D, -W * 0.5 + t * 0.5, H * 0.5, 0, woodMat);
      addBox(t, H, D, W * 0.5 - t * 0.5, H * 0.5, 0, woodMat);
      // Soft recessed back panel matching shelf tone (never pitch-black!)
      addBox(W - t * 2, H - t * 2, 0.014, 0, H * 0.5, -D * 0.5 + 0.008, backMat, false);

      const innerH = H - t * 2;
      const tierH = innerH / tiers;
      for (let ti = 1; ti < tiers; ti++) {
        addBox(W - t * 2, 0.022, D - 0.016, 0, t + tierH * ti, 0.004, woodMat);
      }

      // Curated Scandinavian books & leaning small art frames on each shelf tier
      const decorPalette = [0x3b3a38, 0xc8b9a6, 0x8f6b53, 0xded9cf, 0x4c5d54, 0x252422];
      const decorMats = decorPalette.map((hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.72 }));
      const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.85 });
      disposables.push(() => {
        decorMats.forEach((m) => m.dispose());
        paperMat.dispose();
      });

      const innerW = Math.max(0.25, W - t * 2 - 0.06);
      const itemsPerTier = Math.max(2, Math.min(6, Math.round(innerW / 0.28)));
      for (let ti = 0; ti < tiers; ti++) {
        const shelfTopY = t + tierH * ti + (ti > 0 ? 0.011 : 0);
        const maxObjH = Math.max(0.12, tierH - 0.065);
        for (let bi = 0; bi < itemsPerTier; bi++) {
          const seed = ti * 11 + bi * 7;
          const frac = (bi + 0.5) / itemsPerTier;
          const bx = -innerW * 0.5 + frac * innerW + (((seed % 5) - 2) * 0.014);
          const isFrame = (seed % 3) !== 0;
          if (isFrame) {
            // Leaning framed art print / cover-out coffee-table book
            const fw = Math.min(innerW / itemsPerTier * 0.76, 0.14 + (seed % 4) * 0.032);
            const fh = Math.min(maxObjH * 0.86, 0.16 + ((seed + 1) % 3) * 0.045);
            const fMat = decorMats[seed % decorMats.length];
            addBox(fw, fh, 0.018, bx, shelfTopY + fh * 0.5, -D * 0.14, fMat, false);
            addBox(fw * 0.76, fh * 0.76, 0.006, bx, shelfTopY + fh * 0.5, -D * 0.14 + 0.011, paperMat, false);
          } else {
            // Small standing book cluster (2-3 books side by side)
            for (let k = 0; k < 3; k++) {
              const bh = Math.min(maxObjH * 0.82, 0.17 + ((seed + k) % 3) * 0.032);
              const bw = 0.024 + ((seed + k) % 2) * 0.008;
              const bd = Math.min(D * 0.72, 0.14);
              addBox(bw, bh, bd, bx + (k - 1) * 0.03, shelfTopY + bh * 0.5, -0.01, decorMats[(seed + k * 2) % decorMats.length], false);
            }
          }
        }
      }
    } else if (H >= 0.16) {
      // Open box cubby shelf
      const t = 0.026;
      addBox(W, t, D, 0, t * 0.5, 0, woodMat);
      addBox(W, t, D, 0, H - t * 0.5, 0, woodMat);
      addBox(t, H, D, -W * 0.5 + t * 0.5, H * 0.5, 0, woodMat);
      addBox(t, H, D, W * 0.5 - t * 0.5, H * 0.5, 0, woodMat);
      addBox(W - t * 2, H - t * 2, 0.016, 0, H * 0.5, -D * 0.5 + 0.01, backMat, false);
      addBox(W * 0.72, 0.008, 0.015, 0, H - t - 0.005, 0, ledMat, false);
    } else {
      // Thick architectural floating plank shelf
      addBox(W, H, D, 0, H * 0.5, 0, woodMat);
      addBox(W * 0.78, 0.008, 0.016, 0, 0.004, -D * 0.12, ledMat, false);
    }
  } else if (obj.parametricKind === 'decorative_vase') {
    const isWovenBasket =
      /sepet|basket|has[ıi]r|rattan|wicker/i.test(obj.name) &&
      !/çiçek|cicek|vazo|vase|buket|bouquet|mum|candle/i.test(obj.name);
    if (isWovenBasket) {
      // Authentic hollow woven rattan / wicker floor basket (open top, braided rim, zero snowballs!)
      const rattanCol = new THREE.Color(primaryHex && primaryHex !== '#e7e2d9' ? primaryHex : '#9c7552');
      const rattanMat = new THREE.MeshStandardMaterial({ color: rattanCol, roughness: 0.88, side: THREE.DoubleSide });
      const innerMat = new THREE.MeshStandardMaterial({ color: rattanCol.clone().multiplyScalar(0.56), roughness: 0.94 });
      const ribMat = new THREE.MeshStandardMaterial({ color: rattanCol.clone().multiplyScalar(0.84), roughness: 0.9 });
      const rTop = Math.min(0.26, Math.max(0.11, Math.min(W, D) * 0.48));
      const rBot = rTop * 0.82;
      const bH = Math.max(0.18, Math.min(0.46, H));
      const wallGeo = new THREE.CylinderGeometry(rTop, rBot, bH, 28, 1, true);
      const baseGeo = new THREE.CylinderGeometry(rBot * 0.98, rBot * 0.98, 0.02, 24);
      const rimGeo = new THREE.TorusGeometry(rTop, 0.016, 10, 28);
      rimGeo.rotateX(Math.PI / 2);
      disposables.push(() => {
        rattanMat.dispose();
        innerMat.dispose();
        ribMat.dispose();
        wallGeo.dispose();
        baseGeo.dispose();
        rimGeo.dispose();
      });
      const wall = new THREE.Mesh(wallGeo, rattanMat);
      wall.position.y = bH * 0.5;
      wall.castShadow = true;
      wall.receiveShadow = true;
      grp.add(wall);
      const base = new THREE.Mesh(baseGeo, innerMat);
      base.position.y = 0.012;
      grp.add(base);
      const rim = new THREE.Mesh(rimGeo, ribMat);
      rim.position.y = bH - 0.008;
      rim.castShadow = true;
      grp.add(rim);
      // Subtle horizontal woven rattan bands
      for (let ri = 1; ri <= 4; ri++) {
        const frac = ri / 5;
        const rr = rBot + (rTop - rBot) * frac + 0.003;
        const ringG = new THREE.TorusGeometry(rr, 0.005, 6, 26);
        ringG.rotateX(Math.PI / 2);
        disposables.push(() => ringG.dispose());
        const ringM = new THREE.Mesh(ringG, ribMat);
        ringM.position.y = bH * frac;
        grp.add(ringM);
      }
    } else {
      // Sculpted stoneware/ceramic tabletop vase + natural airy botanical stems & delicate blossoms (no giant snowballs!)
      const vaseMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(primaryHex || '#a36b43'),
        roughness: 0.42,
        metalness: 0.05,
      });
      const leafCol = (() => {
        const c = new THREE.Color(accentHex || '#476140');
        // Keep foliage genuinely leafy green even if Vision sent white/cream as accentColorHex for white flowers!
        return c.g > c.r * 1.05 && c.g > c.b * 1.02 ? c : new THREE.Color('#476140');
      })();
      const foliageMat = new THREE.MeshStandardMaterial({ color: leafCol, roughness: 0.82 });
      const foliageDarkMat = new THREE.MeshStandardMaterial({ color: leafCol.clone().multiplyScalar(0.78), roughness: 0.85 });
      const bloomMat = new THREE.MeshStandardMaterial({ color: 0xf7f4ec, roughness: 0.68 });
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x3b5235, roughness: 0.88 });
      disposables.push(() => {
        vaseMat.dispose();
        foliageMat.dispose();
        foliageDarkMat.dispose();
        bloomMat.dispose();
        stemMat.dispose();
      });

      const r = Math.min(0.11, Math.max(0.05, Math.min(W, D) * 0.28));
      const vaseH = Math.max(0.1, H * 0.52);
      // Smooth curved pottery silhouette via LatheGeometry (foot -> rounded belly -> shoulder -> tapered neck -> lip)
      const lathePts = [
        new THREE.Vector2(0.001, 0),
        new THREE.Vector2(r * 0.72, 0),
        new THREE.Vector2(r * 0.96, vaseH * 0.22),
        new THREE.Vector2(r * 1.0, vaseH * 0.54),
        new THREE.Vector2(r * 0.84, vaseH * 0.78),
        new THREE.Vector2(r * 0.48, vaseH * 0.92),
        new THREE.Vector2(r * 0.54, vaseH),
        new THREE.Vector2(r * 0.44, vaseH),
      ];
      const bodyGeo = new THREE.LatheGeometry(lathePts, 24);
      disposables.push(() => bodyGeo.dispose());
      const vase = new THREE.Mesh(bodyGeo, vaseMat);
      vase.castShadow = true;
      vase.receiveShadow = true;
      grp.add(vase);

      const isCandleTray = /mum|candle|tepsi|tray/i.test(obj.name);
      if (isCandleTray) {
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd580 });
        disposables.push(() => glowMat.dispose());
        addBox(Math.min(0.36, W), 0.016, Math.min(0.26, D), 0, 0.008, 0, vaseMat);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), glowMat);
        flame.position.set(0, vaseH + 0.032, 0);
        disposables.push(() => flame.geometry.dispose());
        grp.add(flame);
      } else {
        // Airy organic bouquet: 9 delicate fanned stems with small layered leaves & crisp white petals
        const bouquetH = Math.max(0.1, H - vaseH);
        const leafGeo = new THREE.SphereGeometry(1, 8, 6);
        const petalGeo = new THREE.IcosahedronGeometry(1, 1);
        disposables.push(() => {
          leafGeo.dispose();
          petalGeo.dispose();
        });
        const stemCount = 9;
        for (let i = 0; i < stemCount; i++) {
          const angle = (i / stemCount) * Math.PI * 2 + (i % 2) * 0.28;
          const spread = r * (0.45 + (i % 3) * 0.42);
          const tipH = bouquetH * (0.58 + (i % 4) * 0.12);
          const tipX = Math.cos(angle) * spread;
          const tipZ = Math.sin(angle) * spread;
          const tipY = vaseH + tipH;

          // Slender tilted stem emerging from vase mouth
          const len = Math.hypot(tipX, tipH + 0.03, tipZ);
          const stemGeo = new THREE.CylinderGeometry(0.0025, 0.0035, len, 6);
          disposables.push(() => stemGeo.dispose());
          const stem = new THREE.Mesh(stemGeo, stemMat);
          stem.position.set(tipX * 0.5, vaseH - 0.02 + (tipH + 0.02) * 0.5, tipZ * 0.5);
          stem.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(tipX, tipH + 0.02, tipZ).normalize()
          );
          grp.add(stem);

          // 2 small flat leaves mid-stem
          for (let li = 0; li < 2; li++) {
            const lf = 0.48 + li * 0.28;
            const leaf = new THREE.Mesh(leafGeo, (i + li) % 2 === 0 ? foliageMat : foliageDarkMat);
            leaf.position.set(
              tipX * lf + Math.cos(angle + 0.8 * (li ? 1 : -1)) * 0.018,
              vaseH + tipH * lf,
              tipZ * lf + Math.sin(angle + 0.8 * (li ? 1 : -1)) * 0.018
            );
            leaf.scale.set(0.024, 0.008, 0.014);
            leaf.rotation.set(0.3, angle + li, 0.4);
            grp.add(leaf);
          }

          // Delicate small flower blossom cluster at stem tip (compact 1.6-2.4cm buds, never giant snowballs!)
          const bl = new THREE.Mesh(petalGeo, bloomMat);
          bl.position.set(tipX, tipY, tipZ);
          const br = 0.016 + (i % 3) * 0.004;
          bl.scale.set(br * 1.15, br * 0.85, br * 1.15);
          bl.castShadow = true;
          grp.add(bl);
        }
      }
    }
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
    const seatY = Math.min(0.47, H * 0.56);
    const isCurved = /kavis|yuvarlak|buklet|boucl|kadife|velvet|curved|organic|oval|döşemeli|ahşap/i.test(obj.name);
    if (isCurved) {
      const sr = Math.min(W, D) * 0.46;
      const seatGeo = new THREE.CylinderGeometry(sr, sr * 0.96, 0.068, 28);
      const backH = Math.max(0.18, H - seatY - 0.02);
      const backGeo = new THREE.CylinderGeometry(sr * 1.02, sr * 1.02, backH, 28, 1, true, Math.PI * 0.58, Math.PI * 0.84);
      const backMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(accentHex),
        roughness: 0.55,
        side: THREE.DoubleSide,
      });
      const legGeo = new THREE.CylinderGeometry(0.017, 0.013, seatY, 12);
      disposables.push(() => {
        seatGeo.dispose();
        backGeo.dispose();
        backMat.dispose();
        legGeo.dispose();
      });
      const seat = new THREE.Mesh(seatGeo, seatMat);
      seat.position.set(0, seatY, 0.02);
      seat.scale.set(W / (sr * 2), 1, D / (sr * 2));
      seat.castShadow = true;
      seat.receiveShadow = true;
      grp.add(seat);
      const back = new THREE.Mesh(backGeo, backMat);
      back.position.set(0, seatY + backH * 0.52, 0.01);
      back.castShadow = true;
      grp.add(back);
      const ix = W * 0.34;
      const iz = D * 0.32;
      for (const sx of [-ix, ix]) {
        for (const sz of [-iz, iz]) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(sx, seatY * 0.5, sz);
          leg.castShadow = true;
          grp.add(leg);
        }
      }
    } else {
      addBox(W * 0.9, 0.065, D * 0.84, 0, seatY, 0.02, seatMat);
      addBox(W * 0.88, H - seatY, 0.065, 0, seatY + (H - seatY) * 0.5, -D * 0.38, seatMat);
      const ix = W * 0.38;
      const iz = D * 0.35;
      for (const sx of [-ix, ix]) {
        for (const sz of [-iz, iz]) {
          addBox(0.032, seatY, 0.032, sx, seatY * 0.5, sz, legMat);
        }
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
    const isWovenBasketOnly =
      /sepet|basket|has[ıi]r|rattan|wicker/i.test(obj.name) &&
      !/bitki|ağaç|agac|saks[ıi]|çiçek|cicek|plant|tree|ficus|monstera|zeytin/i.test(obj.name);
    if (isWovenBasketOnly) {
      const rattanCol = new THREE.Color(primaryHex && primaryHex !== '#4b6343' ? primaryHex : '#9c7552');
      const rattanMat = new THREE.MeshStandardMaterial({ color: rattanCol, roughness: 0.88, side: THREE.DoubleSide });
      const innerMat = new THREE.MeshStandardMaterial({ color: rattanCol.clone().multiplyScalar(0.56), roughness: 0.94 });
      const ribMat = new THREE.MeshStandardMaterial({ color: rattanCol.clone().multiplyScalar(0.84), roughness: 0.9 });
      const rTop = Math.min(0.28, Math.max(0.12, Math.min(W, D) * 0.46));
      const rBot = rTop * 0.82;
      const bH = Math.max(0.2, Math.min(0.46, H));
      const wallGeo = new THREE.CylinderGeometry(rTop, rBot, bH, 28, 1, true);
      const baseGeo = new THREE.CylinderGeometry(rBot * 0.98, rBot * 0.98, 0.02, 24);
      const rimGeo = new THREE.TorusGeometry(rTop, 0.016, 10, 28);
      rimGeo.rotateX(Math.PI / 2);
      disposables.push(() => {
        rattanMat.dispose();
        innerMat.dispose();
        ribMat.dispose();
        wallGeo.dispose();
        baseGeo.dispose();
        rimGeo.dispose();
      });
      const wall = new THREE.Mesh(wallGeo, rattanMat);
      wall.position.y = bH * 0.5;
      wall.castShadow = true;
      wall.receiveShadow = true;
      grp.add(wall);
      const base = new THREE.Mesh(baseGeo, innerMat);
      base.position.y = 0.012;
      grp.add(base);
      const rim = new THREE.Mesh(rimGeo, ribMat);
      rim.position.y = bH - 0.008;
      rim.castShadow = true;
      grp.add(rim);
    } else if (H <= 0.62) {
      // Compact tabletop / windowsill potted plant (small terracotta/ceramic pot + delicate leafy sprigs!)
      const isGreenish = (() => {
        const c = new THREE.Color(primaryHex);
        return c.g > c.r * 1.06 && c.g > c.b * 1.02;
      })();
      const potColor = isGreenish ? accentHex || '#9f5f42' : primaryHex || '#9f5f42';
      const leafColor = isGreenish ? primaryHex : '#55734a';
      const potMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(potColor), roughness: 0.74 });
      const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.96 });
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x4b6440, roughness: 0.86 });
      const leafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(leafColor), roughness: 0.8 });
      const potR = Math.min(0.11, Math.max(0.055, Math.min(W, D) * 0.34));
      const potH = Math.min(0.16, Math.max(0.09, H * 0.38));
      const potGeo = new THREE.CylinderGeometry(potR, potR * 0.76, potH, 22);
      const soilGeo = new THREE.CylinderGeometry(potR * 0.9, potR * 0.9, 0.015, 18);
      const leafGeo = new THREE.SphereGeometry(1, 8, 6);
      disposables.push(() => {
        potMat.dispose();
        soilMat.dispose();
        stemMat.dispose();
        leafMat.dispose();
        potGeo.dispose();
        soilGeo.dispose();
        leafGeo.dispose();
      });
      const pot = new THREE.Mesh(potGeo, potMat);
      pot.position.y = potH * 0.5;
      pot.castShadow = true;
      grp.add(pot);
      const soil = new THREE.Mesh(soilGeo, soilMat);
      soil.position.y = potH - 0.008;
      grp.add(soil);
      const sprigH = Math.max(0.1, H - potH);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.3;
        const dx = Math.cos(ang) * potR * (0.7 + (i % 2) * 0.6);
        const dz = Math.sin(ang) * potR * (0.7 + (i % 2) * 0.6);
        const dy = sprigH * (0.65 + (i % 3) * 0.16);
        const len = Math.hypot(dx, dy, dz);
        const sGeo = new THREE.CylinderGeometry(0.003, 0.004, len, 6);
        disposables.push(() => sGeo.dispose());
        const st = new THREE.Mesh(sGeo, stemMat);
        st.position.set(dx * 0.5, potH + dy * 0.5, dz * 0.5);
        st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
        grp.add(st);
        for (let k = 0; k < 2; k++) {
          const lf = new THREE.Mesh(leafGeo, leafMat);
          const tFrac = 0.62 + k * 0.34;
          lf.position.set(dx * tFrac, potH + dy * tFrac, dz * tFrac);
          lf.scale.set(0.026, 0.008, 0.016);
          lf.rotation.set(0.25, ang + k * 0.8, 0.35);
          grp.add(lf);
        }
      }
    } else {
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

      const potR = Math.min(0.24, Math.min(W, D) * 0.28);
      const potH = Math.min(0.42, H * 0.23);
      const potGeo = new THREE.CylinderGeometry(potR, potR * 0.78, potH, 28);
      const potRimGeo = new THREE.TorusGeometry(potR * 0.98, 0.016, 10, 28);
      potRimGeo.rotateX(Math.PI / 2);
      const soilGeo = new THREE.CylinderGeometry(potR * 0.92, potR * 0.92, 0.02, 20);
      const trunkH = Math.max(0.24, H * 0.44);
      const trunkGeo = new THREE.CylinderGeometry(0.015, 0.028, trunkH, 10);
      const branchGeo = new THREE.CylinderGeometry(0.007, 0.014, H * 0.3, 8);
      const leafMat3 = new THREE.MeshStandardMaterial({
        color: new THREE.Color(leafColor).multiplyScalar(1.16),
        roughness: 0.8,
      });
      const leafGeo = new THREE.IcosahedronGeometry(1, 1);
      disposables.push(() => {
        potGeo.dispose();
        potRimGeo.dispose();
        soilGeo.dispose();
        trunkGeo.dispose();
        branchGeo.dispose();
        leafMat3.dispose();
        leafGeo.dispose();
      });

      const pot = new THREE.Mesh(potGeo, potMat);
      pot.position.y = potH * 0.5;
      pot.castShadow = true;
      pot.receiveShadow = true;
      grp.add(pot);

      const potRim = new THREE.Mesh(potRimGeo, potMat);
      potRim.position.y = potH - 0.01;
      grp.add(potRim);

      const soil = new THREE.Mesh(soilGeo, soilMat);
      soil.position.y = potH - 0.01;
      grp.add(soil);

      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = potH + trunkH * 0.44;
      trunk.rotation.z = 0.04;
      trunk.castShadow = true;
      grp.add(trunk);

      // 4 architectural wooden branches fanning out organically
      const forkY = potH + trunkH * 0.78;
      const branchAngles: Array<[number, number]> = [
        [0.38, 0.4],
        [-0.42, 2.0],
        [0.35, 3.6],
        [-0.36, 5.1],
      ];
      branchAngles.forEach(([tilt, yaw]) => {
        const b = new THREE.Mesh(branchGeo, trunkMat);
        b.position.set(Math.sin(yaw) * 0.07, forkY + H * 0.1, Math.cos(yaw) * 0.07);
        b.rotation.set(tilt * Math.cos(yaw), 0, -tilt * Math.sin(yaw));
        b.castShadow = true;
        grp.add(b);
      });

      // Airy natural layered olive-tree foliage (18 varied small organic leaf tufts instead of 6 chunky spheres!)
      const canopyR = Math.min(W, D) * 0.48;
      const crownBaseY = forkY + 0.05;
      const crownSpan = Math.max(0.32, H - crownBaseY - 0.08);
      const leafMats = [leafMat1, leafMat2, leafMat3];
      for (let i = 0; i < 18; i++) {
        const frac = i / 18;
        const theta = i * 2.39996; // golden angle natural distribution
        const layerY = crownBaseY + crownSpan * (0.12 + 0.84 * Math.pow(frac, 0.75));
        const radSpread = canopyR * (0.18 + 0.82 * Math.sin(Math.PI * (0.15 + 0.8 * frac)));
        const tuftR = canopyR * (0.19 + (i % 4) * 0.032);
        const m = new THREE.Mesh(leafGeo, leafMats[i % 3]);
        m.position.set(Math.cos(theta) * radSpread * 0.72, layerY, Math.sin(theta) * radSpread * 0.72);
        m.scale.set(tuftR * 1.15, tuftR * 0.72, tuftR * 0.95);
        m.rotation.set(i * 0.6, theta, i * 0.4);
        m.castShadow = true;
        m.receiveShadow = true;
        grp.add(m);
      }
    }
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
    const treadMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.56 });
    const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.34, metalness: 0.72 });
    disposables.push(() => {
      treadMat.dispose();
      steelMat.dispose();
    });
    const steps = Math.max(6, Math.min(13, Math.round(H / 0.21)));
    const treadD = (D / steps) * 1.18;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const sy = H * t;
      // Climbs from +Z (front bottom entry) up toward -Z (back mezzanine landing)!
      const sz = D * 0.5 - D * t;
      addBox(W, 0.046, treadD, 0, sy, sz, treadMat);
    }
    const diagLen = Math.hypot(D, H);
    const angle = Math.atan2(H, D);
    for (const sx of [-W * 0.42, W * 0.42]) {
      const stGeo = new THREE.BoxGeometry(0.048, 0.13, diagLen);
      disposables.push(() => stGeo.dispose());
      const st = new THREE.Mesh(stGeo, steelMat);
      st.position.set(sx, H * 0.5 - 0.06, 0);
      st.rotation.x = angle;
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
    const duvetMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.86 });
    const frameWoodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex || '#b9936c'), roughness: 0.72 });
    const sheetMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.88 });
    const pillowAccentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex).lerp(new THREE.Color(accentHex || '#b9936c'), 0.35),
      roughness: 0.86,
    });
    disposables.push(() => {
      duvetMat.dispose();
      frameWoodMat.dispose();
      sheetMat.dispose();
      pillowAccentMat.dispose();
    });
    const isLowPallet = H < 0.72;
    const hbH = isLowPallet ? Math.max(0.45, H) : Math.max(0.88, H);
    // Clean wood or vertical fluted upholstered headboard at -Z
    const isFlutedUpholstered = /oluklu|kadife|döşemeli|dosemeli|kiremit|terracotta|fluted|velvet|upholstered|tufted|yeşil|yesil/i.test(
      obj.name
    );
    if (!isLowPallet) {
      if (isFlutedUpholstered) {
        const hbMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.88 });
        disposables.push(() => hbMat.dispose());
        addBox(W + 0.1, hbH, 0.08, 0, hbH * 0.5, -D * 0.5 + 0.04, hbMat);
        const channels = Math.max(8, Math.min(16, Math.round(W / 0.14)));
        const chW = (W + 0.04) / channels;
        const fluteGeo = new THREE.CylinderGeometry(chW * 0.46, chW * 0.46, hbH - 0.06, 12);
        disposables.push(() => fluteGeo.dispose());
        for (let i = 0; i < channels; i++) {
          const fx = -(W + 0.04) * 0.5 + chW * (i + 0.5);
          const fl = new THREE.Mesh(fluteGeo, hbMat);
          fl.position.set(fx, hbH * 0.5, -D * 0.5 + 0.085);
          fl.scale.set(1, 1, 0.45);
          fl.castShadow = true;
          grp.add(fl);
        }
      } else {
        addBox(W + 0.08, hbH, 0.09, 0, hbH * 0.5, -D * 0.5 + 0.045, frameWoodMat);
        addBox(W * 0.45, hbH * 0.5, 0.045, -W * 0.24, hbH * 0.64, -D * 0.5 + 0.105, sheetMat);
        addBox(W * 0.45, hbH * 0.5, 0.045, W * 0.24, hbH * 0.64, -D * 0.5 + 0.105, sheetMat);
      }
    }
    // Natural wood bed/pallet base frame (uses accentHex instead of harsh black!)
    addBox(W + 0.04, 0.2, D - 0.04, 0, 0.1, 0.02, frameWoodMat);
    // Crisp white mattress
    addBox(W - 0.04, 0.22, D - 0.12, 0, 0.31, 0.03, sheetMat);
    // Quilted plush duvet grid (3x3 soft puff segments in true duvet color primaryHex!)
    const duvZ0 = -D * 0.08;
    const duvD = D * 0.58;
    const cols = 3;
    const rows = 3;
    const cellW = (W + 0.02) / cols;
    const cellD = duvD / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let cz = 0; cz < rows; cz++) {
        addBox(
          cellW - 0.025,
          0.14,
          cellD - 0.025,
          -W * 0.5 + cellW * (cx + 0.5),
          0.44,
          duvZ0 + cellD * (cz + 0.5),
          duvetMat
        );
      }
    }
    // Folded sheet collar above duvet
    addBox(W + 0.01, 0.1, 0.2, 0, 0.44, duvZ0 - 0.1, sheetMat);
    // Sleeping pillows + front accent cushions
    const pw = Math.min(0.68, W * 0.42);
    addBox(pw, 0.16, 0.34, -W * 0.24, 0.5, -D * 0.5 + 0.32, sheetMat);
    if (W > 1.2) {
      addBox(pw, 0.16, 0.34, W * 0.24, 0.5, -D * 0.5 + 0.32, sheetMat);
      addBox(pw * 0.68, 0.15, 0.2, -W * 0.2, 0.52, -D * 0.5 + 0.52, pillowAccentMat);
      addBox(pw * 0.68, 0.15, 0.2, W * 0.2, 0.52, -D * 0.5 + 0.52, pillowAccentMat);
    }
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
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.3, metalness: 0.65 });
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: 0xe3ecf4,
      emissive: 0x3b4856,
      emissiveIntensity: 0.18,
      roughness: 0.12,
      metalness: 0.62,
    });
    disposables.push(() => {
      frameMat.dispose();
      mirrorMat.dispose();
    });
    // Arched/organic/wavy full-length mirror, round mirror, or crisp rectangular mirror
    const isArchedMirror = /kemer|arched|kavis|ark|kubbe|dalga|organik|wavy|organic|asimetrik|kaps[üu]l/i.test(obj.name);
    const isTallRect = !isArchedMirror && (H / Math.max(0.2, W) > 1.45 || /boy|dikdörtgen|köşeli|full.?length|zemin/i.test(obj.name));
    const isRoundMirror = !isArchedMirror && !isTallRect && /yuvarlak|round|daire|circular|oval/i.test(obj.name);
    if (isArchedMirror) {
      const r = W * 0.5;
      const rectH = Math.max(0.2, H - r);
      const border = 0.024;
      // Lower rectangular section
      addBox(W, rectH, D, 0, rectH * 0.5, 0, frameMat);
      addBox(Math.max(0.08, W - border * 2), Math.max(0.1, rectH - border), 0.01, 0, rectH * 0.5 + border * 0.5, D * 0.5 + 0.003, mirrorMat, false);
      // Upper semi-circular arch crown
      const archFrameGeo = new THREE.CylinderGeometry(r, r, D, 36, 1, false, 0, Math.PI);
      archFrameGeo.rotateX(Math.PI / 2);
      archFrameGeo.rotateZ(-Math.PI / 2);
      const archGlassGeo = new THREE.CylinderGeometry(Math.max(0.06, r - border), Math.max(0.06, r - border), 0.01, 36, 1, false, 0, Math.PI);
      archGlassGeo.rotateX(Math.PI / 2);
      archGlassGeo.rotateZ(-Math.PI / 2);
      disposables.push(() => {
        archFrameGeo.dispose();
        archGlassGeo.dispose();
      });
      const archFrame = new THREE.Mesh(archFrameGeo, frameMat);
      archFrame.position.set(0, rectH, 0);
      archFrame.castShadow = true;
      grp.add(archFrame);
      const archGlass = new THREE.Mesh(archGlassGeo, mirrorMat);
      archGlass.position.set(0, rectH, D * 0.5 + 0.003);
      grp.add(archGlass);
    } else if (isRoundMirror) {
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
      // Sleek architectural thin-frame rectangular mirror (great for Boy Aynası & wall mirrors!)
      const border = 0.028;
      addBox(W, H, D, 0, H * 0.5, 0, frameMat);
      addBox(Math.max(0.1, W - border * 2), Math.max(0.1, H - border * 2), 0.01, 0, H * 0.5, D * 0.5 + 0.003, mirrorMat, false);
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
  } else if (obj.parametricKind === 'kitchen_counter') {
    // Realistic Technotop / Laminate Countertop & Lower Cabinet Assembly (Mutfak & Ada Tezgahı)
    const surfKind = obj.countertopSurface || 'marble';
    const topTex = createFloorTexture(surfKind, primaryHex, W * 1.1, D * 1.4);
    const topMat = new THREE.MeshStandardMaterial({
      map: topTex,
      roughness: surfKind === 'marble' ? 0.24 : surfKind === 'travertine' ? 0.42 : 0.55,
      metalness: 0.04,
    });
    const cabMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex),
      roughness: 0.52,
      metalness: 0.06,
    });
    const seamMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accentHex).multiplyScalar(0.75),
      roughness: 0.65,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0xcbd0d6,
      roughness: 0.25,
      metalness: 0.85,
    });
    const sinkMat = new THREE.MeshStandardMaterial({
      color: 0x2a2c30,
      roughness: 0.35,
      metalness: 0.5,
    });
    disposables.push(() => {
      topMat.dispose();
      cabMat.dispose();
      seamMat.dispose();
      steelMat.dispose();
      sinkMat.dispose();
    });

    const plinthH = 0.1;
    const topT = 0.044;
    const cabH = Math.max(0.45, H - plinthH - topT);
    // Recessed dark toe-kick plinth
    addBox(W - 0.04, plinthH, D - 0.08, 0, plinthH * 0.5, -0.02, seamMat, false);
    // Main lower cabinet body
    addBox(W - 0.02, cabH, D - 0.04, 0, plinthH + cabH * 0.5, -0.01, cabMat);
    // Individual cabinet doors + recessed handles
    const doors = Math.max(2, Math.min(6, Math.round(W / 0.55)));
    const dw = (W - 0.03) / doors;
    for (let i = 0; i < doors; i++) {
      const dx = -W * 0.5 + 0.015 + dw * (i + 0.5);
      addBox(dw - 0.01, cabH - 0.02, 0.022, dx, plinthH + cabH * 0.5, D * 0.5 - 0.015, cabMat);
      if (i > 0) addBox(0.008, cabH - 0.02, 0.012, dx - dw * 0.5, plinthH + cabH * 0.5, D * 0.5 - 0.012, seamMat, false);
      // Sleek horizontal aluminum Gola profile handle near top of door
      addBox(dw * 0.36, 0.014, 0.02, dx, plinthH + cabH - 0.055, D * 0.5 + 0.005, steelMat, false);
    }
    // Thick Technotop / Laminate countertop slab with slight front overhang
    addBox(W + 0.02, topT, D + 0.03, 0, H - topT * 0.5, 0.01, topMat);
    // Matching 16cm rear splashback strip
    addBox(W + 0.02, 0.16, 0.024, 0, H + 0.08, -D * 0.5 + 0.012, topMat);
    // Integrated matte granite/steel sink basin + minimalist gooseneck faucet
    if (W >= 1.1) {
      const sinkX = W * 0.22;
      addBox(0.56, 0.012, 0.4, sinkX, H + 0.006, 0.02, sinkMat, false);
      addBox(0.026, 0.24, 0.026, sinkX, H + 0.12, -0.2, steelMat, false);
      addBox(0.022, 0.022, 0.16, sinkX, H + 0.23, -0.13, steelMat, false);
    }
  } else if (obj.parametricKind === 'kitchen_upper_cabinet') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.48, metalness: 0.05 });
    const seamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex).multiplyScalar(0.78), roughness: 0.65 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xffe4b8 });
    disposables.push(() => {
      bodyMat.dispose();
      seamMat.dispose();
      ledMat.dispose();
    });
    addBox(W, H, D - 0.02, 0, H * 0.5, -0.01, bodyMat);
    const doors = Math.max(2, Math.min(6, Math.round(W / 0.52)));
    const dw = (W - 0.02) / doors;
    for (let i = 0; i < doors; i++) {
      const dx = -W * 0.5 + 0.01 + dw * (i + 0.5);
      addBox(dw - 0.01, H - 0.02, 0.022, dx, H * 0.5, D * 0.5 - 0.01, bodyMat);
      if (i > 0) addBox(0.008, H - 0.02, 0.01, dx - dw * 0.5, H * 0.5, D * 0.5 - 0.012, seamMat, false);
    }
    addBox(W - 0.06, 0.012, 0.022, 0, 0.006, -D * 0.2, ledMat, false);
  } else if (obj.parametricKind === 'fridge') {
    const steelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.26, metalness: 0.62 });
    const trimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.35, metalness: 0.72 });
    disposables.push(() => {
      steelMat.dispose();
      trimMat.dispose();
    });
    addBox(W, H, D - 0.04, 0, H * 0.5, -0.02, steelMat);
    // Upper fridge door + lower freezer door + sleek vertical handles
    addBox(W - 0.015, H * 0.63, 0.04, 0, H * 0.675, D * 0.5 - 0.02, steelMat);
    addBox(W - 0.015, H * 0.33, 0.04, 0, H * 0.175, D * 0.5 - 0.02, steelMat);
    addBox(W - 0.02, 0.014, 0.02, 0, H * 0.35, D * 0.5 - 0.015, trimMat, false);
    addBox(0.02, H * 0.34, 0.032, -W * 0.4, H * 0.58, D * 0.5 + 0.012, trimMat, false);
    addBox(0.02, H * 0.2, 0.032, -W * 0.4, H * 0.2, D * 0.5 + 0.012, trimMat, false);
  } else if (obj.parametricKind === 'toilet_wc') {
    // VitrA Wall-Hung Toilet + Concealed Cistern Panel
    const ceramicMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.16, metalness: 0.04 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.22, metalness: 0.85 });
    const wallBoxMat = new THREE.MeshStandardMaterial({ color: 0xeae7e0, roughness: 0.75 });
    disposables.push(() => {
      ceramicMat.dispose();
      chromeMat.dispose();
      wallBoxMat.dispose();
    });
    // Concealed flush cistern box against wall
    addBox(W + 0.16, Math.max(1.05, H), 0.16, 0, Math.max(1.05, H) * 0.5, -D * 0.5 + 0.08, wallBoxMat);
    // Chrome dual-flush actuator plate
    addBox(0.22, 0.14, 0.012, 0, 0.92, -D * 0.5 + 0.165, chromeMat, false);
    // Wall-hung ceramic bowl + seat lid
    const bowlGeo = new THREE.CylinderGeometry(W * 0.44, W * 0.32, 0.32, 24);
    disposables.push(() => bowlGeo.dispose());
    const bowl = new THREE.Mesh(bowlGeo, ceramicMat);
    bowl.position.set(0, 0.28, 0.04);
    bowl.scale.set(1, 1, 1.32);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    grp.add(bowl);
    addBox(W * 0.86, 0.036, D * 0.72, 0, 0.45, 0.05, ceramicMat);
  } else if (obj.parametricKind === 'bathroom_vanity') {
    const cabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.48 });
    const basinMat = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.16, metalness: 0.05 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.24, metalness: 0.85 });
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe3ecf4, roughness: 0.1, metalness: 0.65 });
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xfff0d4 });
    disposables.push(() => {
      cabMat.dispose();
      basinMat.dispose();
      chromeMat.dispose();
      mirrorMat.dispose();
      ledMat.dispose();
    });
    // Floating vanity cabinet
    addBox(W, 0.52, D - 0.02, 0, 0.54, 0, cabMat);
    addBox(W * 0.44, 0.016, 0.022, 0, 0.72, D * 0.5 + 0.004, chromeMat, false);
    // White ceramic countertop basin + recessed sink + faucet
    addBox(W + 0.02, 0.05, D + 0.02, 0, 0.825, 0.01, basinMat);
    addBox(Math.min(0.5, W * 0.56), 0.02, D * 0.6, 0, 0.855, 0.02, chromeMat, false);
    addBox(0.024, 0.18, 0.024, 0, 0.94, -D * 0.34, chromeMat, false);
    addBox(0.02, 0.02, 0.12, 0, 1.02, -D * 0.28, chromeMat, false);
    // Backlit bathroom mirror above basin
    addBox(W * 0.92, 0.78, 0.024, 0, 1.56, -D * 0.5 + 0.02, ledMat, false);
    addBox(W * 0.88, 0.74, 0.016, 0, 1.56, -D * 0.5 + 0.036, mirrorMat, false);
  } else if (obj.parametricKind === 'shower_cabin') {
    const trayMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.28 });
    const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.32, metalness: 0.72 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xdcf0ff,
      transparent: true,
      opacity: 0.26,
      roughness: 0.08,
      metalness: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const chromeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.22, metalness: 0.86 });
    disposables.push(() => {
      trayMat.dispose();
      frameMat.dispose();
      glassMat.dispose();
      chromeMat.dispose();
    });
    // Low-profile architectural shower tray
    addBox(W, 0.06, D, 0, 0.03, 0, trayMat);
    // Matte-black/chrome corner profiles + 2 glass enclosure walls (front & right)
    const gh = Math.max(1.85, H - 0.06);
    addBox(W, gh, 0.012, 0, 0.06 + gh * 0.5, D * 0.5 - 0.01, glassMat, false);
    addBox(0.012, gh, D, W * 0.5 - 0.01, 0.06 + gh * 0.5, 0, glassMat, false);
    addBox(W, 0.028, 0.028, 0, 0.06 + gh, D * 0.5 - 0.01, frameMat);
    addBox(0.028, 0.028, D, W * 0.5 - 0.01, 0.06 + gh, 0, frameMat);
    addBox(0.028, gh, 0.028, W * 0.5 - 0.01, 0.06 + gh * 0.5, D * 0.5 - 0.01, frameMat);
    addBox(0.028, gh, 0.028, -W * 0.5 + 0.01, 0.06 + gh * 0.5, D * 0.5 - 0.01, frameMat);
    addBox(0.028, gh, 0.028, W * 0.5 - 0.01, 0.06 + gh * 0.5, -D * 0.5 + 0.01, frameMat);
    // Rain shower riser column & overhead head
    addBox(0.024, 1.35, 0.024, 0, 1.35, -D * 0.5 + 0.05, chromeMat, false);
    addBox(0.24, 0.022, 0.24, 0, 2.02, -D * 0.5 + 0.26, chromeMat, false);
  } else if (obj.parametricKind === 'washer') {
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(primaryHex), roughness: 0.28, metalness: 0.18 });
    const drumMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accentHex), roughness: 0.2, metalness: 0.72 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.12, metalness: 0.55 });
    disposables.push(() => {
      bodyMat.dispose();
      drumMat.dispose();
      glassMat.dispose();
    });
    addBox(W, H, D, 0, H * 0.5, 0, bodyMat);
    addBox(W - 0.04, 0.12, 0.02, 0, H - 0.09, D * 0.5 + 0.005, drumMat, false);
    const doorGeo = new THREE.CylinderGeometry(W * 0.34, W * 0.34, 0.035, 28);
    doorGeo.rotateX(Math.PI / 2);
    const innerGeo = new THREE.CylinderGeometry(W * 0.24, W * 0.24, 0.04, 24);
    innerGeo.rotateX(Math.PI / 2);
    disposables.push(() => {
      doorGeo.dispose();
      innerGeo.dispose();
    });
    const dRing = new THREE.Mesh(doorGeo, drumMat);
    dRing.position.set(0, H * 0.45, D * 0.5 + 0.012);
    grp.add(dRing);
    const dGlass = new THREE.Mesh(innerGeo, glassMat);
    dGlass.position.set(0, H * 0.45, D * 0.5 + 0.015);
    grp.add(dGlass);
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
    // Always use clean woven architectural rug texture tinted to the rug's true colors (no warped camera crop legs + live recolorable!)
    const rugTex = createWovenRugTexture(primaryHex, accentHex);
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.94, metalness: 0.01 });
    disposables.push(() => {
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
    const primaryLum = (() => {
      const c = new THREE.Color(primaryHex || '#c9a66b');
      return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    })();
    const isPaperLantern =
      /fener|ka[ğg][ıi]t|paper|lantern|kubbe|dome|kuma[şs]|has[ıi]r|rattan|akari|japon|abajur|linen|keten/i.test(
        obj.name
      ) ||
      (primaryLum > 0.72 && !/halka|ring|kristal|crystal|tel|wire|kafes|çoklu|coklu|cluster/i.test(obj.name));
    const isPendantCluster =
      !isPaperLantern && /tel|kablo|çoklu|coklu|wire|cluster|kafes/i.test(obj.name);
    const brassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primaryHex),
      roughness: 0.28,
      metalness: 0.82,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(accentHex || '#fff2d2') });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x222224 });
    disposables.push(() => {
      brassMat.dispose();
      glowMat.dispose();
      wireMat.dispose();
    });

    const canGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 20);
    disposables.push(() => canGeo.dispose());
    const can = new THREE.Mesh(canGeo, isPaperLantern ? new THREE.MeshStandardMaterial({ color: 0xf4f2ed, roughness: 0.75 }) : brassMat);
    can.position.set(0, H - 0.015, 0);
    grp.add(can);
    if (isPaperLantern) disposables.push(() => (can.material as THREE.Material).dispose());

    if (isPaperLantern) {
      // Sculptural Scandinavian / Japanese two-tier ribbed rice-paper lantern pendant!
      const shadeColor = primaryLum > 0.5 ? new THREE.Color(primaryHex) : new THREE.Color('#f4f1ea');
      const paperMat = new THREE.MeshStandardMaterial({
        color: shadeColor,
        emissive: new THREE.Color(0xfff1d6),
        emissiveIntensity: 0.24,
        roughness: 0.92,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      const ribMat = new THREE.MeshStandardMaterial({
        color: shadeColor.clone().multiplyScalar(0.86),
        roughness: 0.9,
      });
      const collarMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(accentHex && accentHex !== '#fff2d2' ? accentHex : '#2a221d'),
        roughness: 0.45,
        metalness: 0.15,
      });
      const cordMat = new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.8 });
      const rMain = Math.min(0.42, Math.max(0.18, Math.min(W, D) * 0.48));
      const upperH = rMain * 0.88;
      const lowerR = rMain * 0.68;
      const lowerH = rMain * 0.46;
      const upperCenterY = Math.max(lowerH + upperH * 0.48, H * 0.56);
      const collarY = upperCenterY - upperH * 0.42;
      const lowerCenterY = collarY - lowerH * 0.32;
      const cordTopY = H - 0.03;
      const cordBotY = upperCenterY + upperH * 0.4;
      const cordLen = Math.max(0.08, cordTopY - cordBotY);

      const cordGeo = new THREE.CylinderGeometry(0.006, 0.006, cordLen, 8);
      const upperGeo = new THREE.SphereGeometry(rMain, 32, 20);
      const collarGeo = new THREE.CylinderGeometry(rMain * 0.46, rMain * 0.46, 0.045, 28);
      const lowerGeo = new THREE.SphereGeometry(lowerR, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
      const innerBulbGeo = new THREE.SphereGeometry(rMain * 0.22, 16, 12);
      disposables.push(() => {
        paperMat.dispose();
        ribMat.dispose();
        collarMat.dispose();
        cordMat.dispose();
        cordGeo.dispose();
        upperGeo.dispose();
        collarGeo.dispose();
        lowerGeo.dispose();
        innerBulbGeo.dispose();
      });

      const cord = new THREE.Mesh(cordGeo, cordMat);
      cord.position.y = (cordTopY + cordBotY) * 0.5;
      grp.add(cord);

      const upper = new THREE.Mesh(upperGeo, paperMat);
      upper.scale.set(1, upperH / (rMain * 2), 1);
      upper.position.y = upperCenterY;
      upper.castShadow = true;
      grp.add(upper);

      // Subtle horizontal bamboo paper-lantern rib rings
      for (const latFrac of [-0.55, -0.2, 0.15, 0.5]) {
        const rr = rMain * Math.sqrt(Math.max(0.08, 1 - latFrac * latFrac)) + 0.002;
        const ribG = new THREE.TorusGeometry(rr, 0.0022, 6, 32);
        ribG.rotateX(Math.PI / 2);
        disposables.push(() => ribG.dispose());
        const rib = new THREE.Mesh(ribG, ribMat);
        rib.position.y = upperCenterY + latFrac * (upperH * 0.5);
        grp.add(rib);
      }

      const collar = new THREE.Mesh(collarGeo, collarMat);
      collar.position.y = collarY;
      grp.add(collar);

      const lower = new THREE.Mesh(lowerGeo, paperMat);
      lower.scale.set(1, lowerH / lowerR, 1);
      lower.position.y = lowerCenterY;
      lower.castShadow = true;
      grp.add(lower);

      const bulb = new THREE.Mesh(innerBulbGeo, glowMat);
      bulb.position.y = lowerCenterY + lowerH * 0.28;
      grp.add(bulb);
    } else if (isPendantCluster) {
      // Sculptural multi-drop architectural wire/globe pendant cluster!
      const drops: Array<[number, number, number, number]> = [
        [0, 0, 0.14, 0.13],
        [-W * 0.28, -D * 0.14, 0.34, 0.1],
        [W * 0.26, D * 0.16, 0.24, 0.11],
        [-W * 0.16, D * 0.26, 0.44, 0.09],
        [W * 0.18, -D * 0.24, 0.38, 0.095],
      ];
      const cageMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(primaryHex || '#1e1e20'),
        roughness: 0.32,
        metalness: 0.78,
        wireframe: true,
      });
      disposables.push(() => cageMat.dispose());
      drops.forEach(([dx, dz, yBottom, r]) => {
        const dropY = Math.min(H - 0.18, Math.max(0.08, yBottom));
        const cordPts = [new THREE.Vector3(dx * 0.3, H - 0.02, dz * 0.3), new THREE.Vector3(dx, dropY + r, dz)];
        const cordGeo = new THREE.BufferGeometry().setFromPoints(cordPts);
        const cageGeo = new THREE.IcosahedronGeometry(r, 1);
        const bulbGeo = new THREE.SphereGeometry(r * 0.42, 14, 12);
        disposables.push(() => {
          cordGeo.dispose();
          cageGeo.dispose();
          bulbGeo.dispose();
        });
        const cord = new THREE.Line(cordGeo, wireMat);
        cord.raycast = () => {};
        grp.add(cord);
        const cage = new THREE.Mesh(cageGeo, cageMat);
        cage.position.set(dx, dropY + r * 0.6, dz);
        grp.add(cage);
        const bulb = new THREE.Mesh(bulbGeo, glowMat);
        bulb.position.set(dx, dropY + r * 0.6, dz);
        grp.add(bulb);
      });
    } else {
      const outerR = Math.min(W, D) * 0.48;
      const innerR = outerR * 0.62;
      const ring1Geo = new THREE.TorusGeometry(outerR, 0.016, 10, 36);
      ring1Geo.rotateX(Math.PI / 2);
      const ring2Geo = new THREE.TorusGeometry(innerR, 0.013, 10, 32);
      ring2Geo.rotateX(Math.PI / 2);
      const glow1Geo = new THREE.TorusGeometry(outerR - 0.008, 0.008, 8, 36);
      glow1Geo.rotateX(Math.PI / 2);
      const glow2Geo = new THREE.TorusGeometry(innerR - 0.007, 0.007, 8, 32);
      glow2Geo.rotateX(Math.PI / 2);

      disposables.push(() => {
        ring1Geo.dispose();
        ring2Geo.dispose();
        glow1Geo.dispose();
        glow2Geo.dispose();
      });

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
  }

  return {
    group: grp,
    dispose: () => disposables.forEach((fn) => fn()),
  };
}
