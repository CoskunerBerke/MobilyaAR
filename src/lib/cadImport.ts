import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export interface ConvertedCadResult {
  glbBuffer: ArrayBuffer;
  dimensionsCm: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
}

/**
 * Tarayıcıda .GLB / .GLTF / .OBJ / .STL CAD dosyalarını okur, eksen & cm ölçeğini
 * uniform hizalayarak minY=0 zemin kilitli standart binary .GLB üretir.
 */
export async function convertCadFileToGlb(
  file: File,
  opts: { targetWidthCm?: number; zUp?: boolean } = {}
): Promise<ConvertedCadResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const defaultMat = new THREE.MeshStandardMaterial({
    color: 0xe6e3dc,
    roughness: 0.55,
    metalness: 0.08,
  });

  let loadedObj: THREE.Object3D;
  if (ext === 'glb' || ext === 'gltf') {
    const buf = await file.arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    loadedObj = gltf.scene;
  } else if (ext === 'obj') {
    const txt = await file.text();
    loadedObj = new OBJLoader().parse(txt);
  } else if (ext === 'stl') {
    const buf = await file.arrayBuffer();
    const geo = new STLLoader().parse(buf);
    geo.computeVertexNormals();
    loadedObj = new THREE.Mesh(geo, defaultMat);
  } else {
    throw new Error('Desteklenen CAD formatları: .glb, .gltf, .obj, .stl');
  }

  const root = new THREE.Group();
  root.add(loadedObj);

  if (opts.zUp) {
    loadedObj.rotation.x = -Math.PI / 2;
  }

  loadedObj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const upgraded = mats.map((m) => {
      if (!m || m.type === 'MeshPhongMaterial' || m.type === 'MeshLambertMaterial') {
        const std = defaultMat.clone();
        const phong = m as THREE.MeshPhongMaterial | undefined;
        if (phong?.color) std.color.copy(phong.color);
        if (phong?.map) std.map = phong.map;
        return std;
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
  });

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-5) {
    throw new Error('CAD dosyasında geçerli 3D geometri bulunamadı.');
  }

  let scale = 1.0;
  if (opts.targetWidthCm && Number.isFinite(opts.targetWidthCm) && opts.targetWidthCm > 1 && size.x > 1e-5) {
    scale = opts.targetWidthCm / 100 / size.x;
  } else if (maxDim > 20) {
    // Tipik milimetre CAD ihracatı -> metre
    scale = 0.001;
  } else if (maxDim > 5) {
    // Santimetre CAD ihracatı -> metre
    scale = 0.01;
  }

  loadedObj.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  loadedObj.position.x -= center.x;
  loadedObj.position.y -= scaledBox.min.y;
  loadedObj.position.z -= center.z;
  root.updateMatrixWorld(true);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);
  const widthCm = Math.max(1, Math.round(finalSize.x * 100));
  const depthCm = Math.max(1, Math.round(finalSize.z * 100));
  const heightCm = Math.max(1, Math.round(finalSize.y * 100));

  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (out) => {
        if (out instanceof ArrayBuffer) {
          resolve(out);
        } else {
          reject(new Error('GLB dışa aktarım formatı beklenmedi.'));
        }
      },
      (err) => reject(err instanceof Error ? err : new Error('GLB dışa aktarım hatası')),
      { binary: true }
    );
  });

  return {
    glbBuffer,
    dimensionsCm: `${widthCm} × ${depthCm} × ${heightCm} cm`,
    widthCm,
    depthCm,
    heightCm,
  };
}

/**
 * AI (TRELLIS / Hunyuan3D / RunPod) tarafından üretilen ham .GLB dosyasını
 * kullanıcının girdiği gerçek fiziksel santimetre ölçülerine (1:1 metre) ölçekler,
 * tabanını tam y=0 zeminine oturtur ve iPhone AR Quick Look / Android WebXR için paketler.
 */
export async function normalizeGlbArrayBufferToMetricCm(
  glbInput: ArrayBuffer,
  target: { widthCm?: number; depthCm?: number; heightCm?: number; rotateYDeg?: number } = {}
): Promise<ConvertedCadResult> {
  const gltf = await new GLTFLoader().parseAsync(glbInput, '');
  const loadedObj = gltf.scene;
  const root = new THREE.Group();
  root.add(loadedObj);

  if (target.rotateYDeg && Number.isFinite(target.rotateYDeg)) {
    loadedObj.rotation.y += (target.rotateYDeg * Math.PI) / 180;
  }

  loadedObj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
  });

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-5) {
    throw new Error('Üretilen 3B modelde geçerli geometri bulunamadı.');
  }

  // En geniş yatay ekseni X (genişlik) olarak hizala: eğer hedef en > derinlik ama model Z'de daha uzunsa 90° döndür
  const tw = target.widthCm && target.widthCm > 1 ? target.widthCm / 100 : 0;
  const td = target.depthCm && target.depthCm > 1 ? target.depthCm / 100 : 0;
  const th = target.heightCm && target.heightCm > 1 ? target.heightCm / 100 : 0;

  if (tw > 0 && td > 0 && ((tw > td * 1.15 && size.z > size.x * 1.15) || (td > tw * 1.15 && size.x > size.z * 1.15))) {
    loadedObj.rotation.y += Math.PI / 2;
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    box.getSize(size);
  }

  // Orantıyı bozmadan (veya makul sınırlı eksen uyumuyla) 1:1 gerçek metre ölçeğine getir
  if (tw > 0 && th > 0 && td > 0 && size.x > 1e-4 && size.y > 1e-4 && size.z > 1e-4) {
    const sx = tw / size.x;
    const sy = th / size.y;
    const sz = td / size.z;
    // Uniform medyan ölçek ile eksen başına en fazla ±%18 düzeltme (mobilyayı ezmeden birebir ölçü!)
    const sorted = [sx, sy, sz].sort((a, b) => a - b);
    const base = sorted[1];
    const clampRatio = (v: number) => Math.max(base * 0.84, Math.min(base * 1.18, v));
    loadedObj.scale.set(
      loadedObj.scale.x * clampRatio(sx),
      loadedObj.scale.y * clampRatio(sy),
      loadedObj.scale.z * clampRatio(sz)
    );
  } else if (tw > 0 && size.x > 1e-4) {
    loadedObj.scale.multiplyScalar(tw / size.x);
  } else if (th > 0 && size.y > 1e-4) {
    loadedObj.scale.multiplyScalar(th / size.y);
  } else if (maxDim > 20) {
    loadedObj.scale.multiplyScalar(0.001);
  } else if (maxDim > 5) {
    loadedObj.scale.multiplyScalar(0.01);
  }

  root.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  loadedObj.position.x -= center.x;
  loadedObj.position.y -= scaledBox.min.y;
  loadedObj.position.z -= center.z;
  root.updateMatrixWorld(true);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);
  const widthCm = Math.max(1, Math.round(finalSize.x * 100));
  const depthCm = Math.max(1, Math.round(finalSize.z * 100));
  const heightCm = Math.max(1, Math.round(finalSize.y * 100));

  const exporter = new GLTFExporter();
  const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (out) => {
        if (out instanceof ArrayBuffer) resolve(out);
        else reject(new Error('GLB dışa aktarım formatı beklenmedi.'));
      },
      (err) => reject(err instanceof Error ? err : new Error('GLB dışa aktarım hatası')),
      { binary: true }
    );
  });

  return {
    glbBuffer,
    dimensionsCm: `${widthCm} × ${depthCm} × ${heightCm} cm`,
    widthCm,
    depthCm,
    heightCm,
  };
}
