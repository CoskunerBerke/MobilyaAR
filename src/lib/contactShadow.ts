import * as THREE from 'three';

/**
 * Ürünün gerçek geometrisinden zemin temas gölgesi üretir.
 * Zemine 0-5 cm yakın her köşe (ayak uçları) koyu ve keskin,
 * gövdenin altı yüksekliğe göre yumuşak gölge alır.
 */
export function buildContactShadow(model: THREE.Object3D): THREE.Mesh {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const planeW = Math.max(size.x * 1.4, 0.4);
  const planeD = Math.max(size.z * 1.4, 0.4);
  const res = 256;
  const minH = new Float32Array(res * res).fill(99);
  const p = new THREE.Vector3();

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const h = p.y - box.min.y;
      if (h > 0.6) continue;
      const gx = Math.round(((p.x - center.x) / planeW + 0.5) * (res - 1));
      const gz = Math.round(((p.z - center.z) / planeD + 0.5) * (res - 1));
      if (gx < 0 || gz < 0 || gx >= res || gz >= res) continue;
      const k = gz * res + gx;
      if (h < minH[k]) minH[k] = h;
    }
  });

  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = res;
    return c;
  };
  const foot = make();
  const body = make();
  const fImg = foot.getContext('2d')!.createImageData(res, res);
  const bImg = body.getContext('2d')!.createImageData(res, res);
  for (let i = 0; i < res * res; i++) {
    const h = minH[i];
    if (h > 0.6) continue;
    if (h <= 0.05) fImg.data[i * 4 + 3] = 255;
    bImg.data[i * 4 + 3] = Math.round(Math.exp(-h * 3.2) * 200);
  }
  foot.getContext('2d')!.putImageData(fImg, 0, 0);
  body.getContext('2d')!.putImageData(bImg, 0, 0);

  const out = make();
  const ctx = out.getContext('2d')!;
  ctx.filter = 'blur(14px)';
  ctx.globalAlpha = 0.75;
  ctx.drawImage(body, 0, 0);
  ctx.filter = 'blur(5px)';
  ctx.globalAlpha = 0.7;
  ctx.drawImage(body, 0, 0);
  ctx.filter = 'blur(3px)';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(foot, 0, 0);
  ctx.filter = 'blur(1px)';
  ctx.globalAlpha = 1;
  ctx.drawImage(foot, 0, 0);
  ctx.filter = 'none';

  const tex = new THREE.CanvasTexture(out);
  tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(planeW, planeD);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(center.x, box.min.y + 0.002, center.z);
  mesh.renderOrder = 1;
  return mesh;
}
