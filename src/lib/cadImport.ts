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
