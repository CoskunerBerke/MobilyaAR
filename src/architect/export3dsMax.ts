import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import type { BuiltRoomResult } from './roomGeometryBuilder';
import type { ArchRoomProject } from './types';

export interface Scene3dsMaxContext {
  roomRoot: THREE.Group;
  objectsRoot: THREE.Group;
  builtRoom: BuiltRoomResult | null;
  cameraPos: [number, number, number];
  cameraTarget: [number, number, number];
  cameraFov: number;
}

export interface Export3dsMaxOptions {
  includeCeiling: boolean;
  includeFurniture: boolean;
  /** Convert OBJ coordinates to 3ds Max Z-up centimeters (1 unit = 1 cm) */
  objZUpCentimeters: boolean;
}

export interface Export3dsMaxStats {
  meshCount: number;
  triangleCount: number;
  furnitureCount: number;
  roomCount: number;
  slug: string;
}

export function sanitizeSlug(raw: string): string {
  const s = String(raw || 'mekanar-oda')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'mekanar-oda';
}

function sanitizeNodeName(raw: string, fallback: string): string {
  const cleaned = String(raw || fallback)
    .replace(/ğ/g, 'g')
    .replace(/Ğ/g, 'G')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U')
    .replace(/ş/g, 's')
    .replace(/Ş/g, 'S')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ö/g, 'o')
    .replace(/Ö/g, 'O')
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'C')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/**
 * Clones ONLY genuine solid 3D architectural walls, floors, ceilings, openings, panels, and furniture
 * (strictly excluding cutaway ghost meshes, 2D plan sprites, compass rings, contact-shadow decals, grids, and lights).
 */
function cloneCleanMeshTree(
  source: THREE.Object3D,
  excludedSet: Set<THREE.Object3D>,
  stats: { meshes: number; triangles: number }
): THREE.Group {
  const out = new THREE.Group();
  out.name = source.name || 'MekanAR_Group';

  source.updateMatrixWorld(true);
  const tempPos = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();

  const walk = (node: THREE.Object3D, parentHidden: boolean) => {
    if (excludedSet.has(node)) return;
    if (
      node instanceof THREE.Light ||
      node instanceof THREE.Sprite ||
      node instanceof THREE.Line ||
      node instanceof THREE.LineSegments ||
      node instanceof THREE.GridHelper ||
      node instanceof THREE.Points
    ) {
      return;
    }

    const isMesh = (node as THREE.Mesh).isMesh;
    if (isMesh) {
      if (parentHidden || !node.visible) return;
      const srcMesh = node as THREE.Mesh;
      if (!srcMesh.geometry) return;

      // Skip subtle flat contact-shadow floor decals (PlaneGeometry with transparent alphaMap)
      const mat0 = Array.isArray(srcMesh.material) ? srcMesh.material[0] : srcMesh.material;
      if (mat0 && 'transparent' in mat0 && mat0.transparent && 'alphaMap' in mat0 && (mat0 as THREE.MeshBasicMaterial).alphaMap) {
        return;
      }

      const geo = srcMesh.geometry.clone();
      const mat = Array.isArray(srcMesh.material)
        ? srcMesh.material.map((m) => (m ? m.clone() : m))
        : srcMesh.material
        ? srcMesh.material.clone()
        : new THREE.MeshStandardMaterial({ color: 0xe5e0d8 });

      const mesh = new THREE.Mesh(geo, mat);
      srcMesh.matrixWorld.decompose(tempPos, tempQuat, tempScale);
      mesh.position.copy(tempPos);
      mesh.quaternion.copy(tempQuat);
      mesh.scale.copy(tempScale);
      mesh.name = srcMesh.name || `Mesh_${stats.meshes + 1}`;
      out.add(mesh);

      stats.meshes += 1;
      const idx = geo.getIndex();
      const posAttr = geo.getAttribute('position');
      if (idx) stats.triangles += Math.round(idx.count / 3);
      else if (posAttr) stats.triangles += Math.round(posAttr.count / 3);
      return;
    }

    const nextHidden = parentHidden || !node.visible;
    for (const child of node.children) {
      walk(child, nextHidden);
    }
  };

  walk(source, false);
  return out;
}

/**
 * Builds a clean, self-contained Three.js scene group containing ALL 4 solid room walls
 * (temporarily restoring any cutaway walls!), optional ceiling, and every placed furniture piece
 * cleanly organized into named 3ds Max layers (`Mimari_Yapi` + `Mobilya_<Name>`).
 */
export function buildCleanExportScene(
  ctx: Scene3dsMaxContext,
  project: ArchRoomProject,
  opts: Export3dsMaxOptions
): { root: THREE.Group; stats: Export3dsMaxStats; dispose: () => void } {
  const br = ctx.builtRoom;
  const savedWallVis: boolean[] = [];
  const savedGhostVis: boolean[] = [];
  const prevCeilVis = br?.ceilingVisualGroup.visible ?? false;
  const prevCeilGhostVis = br?.ceilingShadowGhost.visible ?? false;

  const excluded = new Set<THREE.Object3D>();
  if (br) {
    excluded.add(br.gridHelper);
    excluded.add(br.compassRingGroup);
    excluded.add(br.planOverlayGroup);
    excluded.add(br.planLabelsGroup);
    excluded.add(br.room3dLabelsGroup);
    excluded.add(br.ceilingShadowGhost);
    if (!opts.includeCeiling) excluded.add(br.ceilingVisualGroup);

    // Temporarily un-hide cutaway walls so ALL 4 room walls export solid into 3ds Max!
    br.walls.forEach((w, i) => {
      savedWallVis[i] = w.visualGroup.visible;
      savedGhostVis[i] = w.shadowGhost.visible;
      w.visualGroup.visible = true;
      w.shadowGhost.visible = false;
      excluded.add(w.shadowGhost);
    });
    br.ceilingVisualGroup.visible = opts.includeCeiling;
    br.ceilingShadowGhost.visible = false;
  }

  const root = new THREE.Group();
  root.name = `MekanAR_${sanitizeNodeName(project.projectName, 'Proje')}`;
  const rawStats = { meshes: 0, triangles: 0 };

  try {
    // 1) Architectural Shell (Walls, Floor, Ceiling, Windows, Doors, Panels, Baseboards, Adjacent Rooms)
    const archGroup = cloneCleanMeshTree(ctx.roomRoot, excluded, rawStats);
    archGroup.name = '01_Mimari_Yapi_Duvar_Zemin';
    root.add(archGroup);

    // 2) Furniture & Decor Objects (cleanly named per object for 3ds Max Scene Explorer)
    if (opts.includeFurniture) {
      const furnRoot = new THREE.Group();
      furnRoot.name = '02_Mobilya_ve_Dekor';
      ctx.objectsRoot.updateMatrixWorld(true);
      let idx = 1;
      for (const child of ctx.objectsRoot.children) {
        const objId = child.userData?.objectId as string | undefined;
        const meta = objId ? project.objects.find((o) => o.id === objId) : undefined;
        const pieceGroup = cloneCleanMeshTree(child, excluded, rawStats);
        if (pieceGroup.children.length > 0) {
          pieceGroup.name = `${String(idx).padStart(2, '0')}_${sanitizeNodeName(meta?.name || child.name, `Esya_${idx}`)}`;
          furnRoot.add(pieceGroup);
          idx += 1;
        }
      }
      root.add(furnRoot);
    }
  } finally {
    // Strictly restore live 3D viewport cutaway state!
    if (br) {
      br.walls.forEach((w, i) => {
        w.visualGroup.visible = savedWallVis[i];
        w.shadowGhost.visible = savedGhostVis[i];
      });
      br.ceilingVisualGroup.visible = prevCeilVis;
      br.ceilingShadowGhost.visible = prevCeilGhostVis;
    }
  }

  const dispose = () => {
    root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mt) => mt?.dispose());
      }
    });
  };

  return {
    root,
    stats: {
      meshCount: rawStats.meshes,
      triangleCount: rawStats.triangles,
      furnitureCount: opts.includeFurniture ? project.objects.length : 0,
      roomCount: 1 + (project.adjacentRooms?.length || 0),
      slug: sanitizeSlug(project.projectName),
    },
    dispose,
  };
}

/**
 * Exports full 3D room + furniture as a binary glTF 2.0 `.glb` (1:1 meters, Y-up, embedded PBR textures).
 * Opens natively via File -> Import in Autodesk 3ds Max 2023–2026, Blender, Unreal, Cinema4D & SketchUp!
 */
export async function exportSceneToGlb(
  ctx: Scene3dsMaxContext,
  project: ArchRoomProject,
  opts: Export3dsMaxOptions
): Promise<{ bytes: Uint8Array; filename: string; stats: Export3dsMaxStats }> {
  const { root, stats, dispose } = buildCleanExportScene(ctx, project, opts);
  try {
    const exporter = new GLTFExporter();
    const ab = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('GLB binary çıktısı oluşturulamadı.'));
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
        { binary: true, onlyVisible: true }
      );
    });
    return {
      bytes: new Uint8Array(ab),
      filename: `${stats.slug}-3dsmax.glb`,
      stats,
    };
  } finally {
    dispose();
  }
}

/**
 * Exports full 3D room + furniture as universal `.obj` + `.mtl` (with optional 3ds Max native Z-up Centimeters!).
 * Opens cleanly in EVERY 3ds Max version (2018–2026), SketchUp, Rhino, Blender, and Maya!
 */
export function exportSceneToObjMtl(
  ctx: Scene3dsMaxContext,
  project: ArchRoomProject,
  opts: Export3dsMaxOptions
): {
  objText: string;
  mtlText: string;
  objFilename: string;
  mtlFilename: string;
  stats: Export3dsMaxStats;
} {
  const { root, stats, dispose } = buildCleanExportScene(ctx, project, opts);
  const objFilename = `${stats.slug}-3dsmax.obj`;
  const mtlFilename = `${stats.slug}-3dsmax.mtl`;

  try {
    // Convert Three.js Y-up meters -> Autodesk 3ds Max Z-up centimeters (exact right-handed +90deg X rotation & x100 scale)
    if (opts.objZUpCentimeters) {
      root.rotation.x = Math.PI / 2;
      root.scale.setScalar(100);
      root.updateMatrixWorld(true);
    }

    // Build clean .MTL material definitions & assign deterministic unique names to every mesh material
    const mtlLines: string[] = [
      `# MekanAR Mimari 3ds Max MTL Material Library`,
      `# Project: ${project.projectName}`,
      '',
    ];
    const seenMats = new Map<string, string>();
    let matIdx = 1;

    root.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const srcMat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!srcMat) return;
      const std = srcMat as THREE.MeshStandardMaterial;
      const col = std.color ? std.color : new THREE.Color(0xd8d3ca);
      const rough = typeof std.roughness === 'number' ? std.roughness : 0.65;
      const metal = typeof std.metalness === 'number' ? std.metalness : 0.05;
      const opacity = std.transparent && typeof std.opacity === 'number' ? std.opacity : 1.0;
      const key = `${col.getHexString()}_${rough.toFixed(2)}_${metal.toFixed(2)}_${opacity.toFixed(2)}`;

      let matName = seenMats.get(key);
      if (!matName) {
        matName = `MekanAR_Mat_${String(matIdx).padStart(2, '0')}_${col.getHexString()}`;
        seenMats.set(key, matName);
        matIdx += 1;
        const ns = Math.round(Math.max(8, (1 - rough) * 180));
        const spec = (0.12 + (1 - rough) * 0.45 + metal * 0.3).toFixed(3);
        mtlLines.push(
          `newmtl ${matName}`,
          `Kd ${col.r.toFixed(4)} ${col.g.toFixed(4)} ${col.b.toFixed(4)}`,
          `Ka ${(col.r * 0.15).toFixed(4)} ${(col.g * 0.15).toFixed(4)} ${(col.b * 0.15).toFixed(4)}`,
          `Ks ${spec} ${spec} ${spec}`,
          `Ns ${ns}`,
          `d ${opacity.toFixed(3)}`,
          `illum ${opacity < 0.98 ? 4 : 2}`,
          ''
        );
      }
      srcMat.name = matName;
      m.material = srcMat;
    });

    const exporter = new OBJExporter();
    const rawObj = exporter.parse(root);
    const header = [
      `# MekanAR Mimari 3D Studio -> Autodesk 3ds Max Export`,
      `# Project: ${project.projectName} (${project.widthM.toFixed(2)}m x ${project.depthM.toFixed(2)}m x ${project.ceilingM.toFixed(2)}m)`,
      `# Coordinate System: ${opts.objZUpCentimeters ? '3ds Max Z-Up Centimeters (1 unit = 1 cm)' : 'Y-Up Meters'}`,
      `mtllib ${mtlFilename}`,
      '',
    ].join('\n');

    return {
      objText: header + rawObj,
      mtlText: mtlLines.join('\n'),
      objFilename,
      mtlFilename,
      stats,
    };
  } finally {
    dispose();
  }
}

/**
 * Generates a ready-to-run Autodesk 3ds Max MaxScript (.ms) that:
 *  1. Configures Metric Centimeter system/display units
 *  2. Auto-imports the adjacent .GLB (3ds Max 2023+) or .OBJ scene cleanly
 *  3. Creates the exact matching MekanAR Target Camera (position, target, FOV)
 *  4. Creates a Directional Sun matching the MekanAR sun angle
 */
export function generate3dsMaxScript(
  ctx: Scene3dsMaxContext,
  project: ArchRoomProject,
  slug: string
): { scriptText: string; filename: string } {
  // Convert Three.js Y-up meters -> 3ds Max Z-up centimeters: (x*100, -z*100, y*100)
  const toMaxCm = (v: [number, number, number]) =>
    `[${(v[0] * 100).toFixed(1)}, ${(-v[2] * 100).toFixed(1)}, ${(v[1] * 100).toFixed(1)}]`;

  const camPos = toMaxCm(ctx.cameraPos);
  const camTgt = toMaxCm(ctx.cameraTarget);
  const camFov = Math.max(24, Math.min(85, ctx.cameraFov || 50)).toFixed(1);

  // Sun vector from sun hour & north angle
  const hourAngle = ((project.sun.hour - 12) / 6) * (Math.PI * 0.42);
  const azim = ((project.sun.northAngleDeg || 0) * Math.PI) / 180 + hourAngle;
  const elev = Math.max(0.28, Math.cos(hourAngle) * 0.95);
  const sunDist = 900; // 9 meters in cm
  const sx = (Math.sin(azim) * Math.cos(elev) * sunDist).toFixed(1);
  const sy = (-Math.cos(azim) * Math.cos(elev) * sunDist).toFixed(1);
  const sz = (Math.sin(elev) * sunDist).toFixed(1);

  const glbFile = `${slug}-3dsmax.glb`;
  const objFile = `${slug}-3dsmax.obj`;

  const scriptText = `-- ============================================================================
-- MekanAR Mimari -> Autodesk 3ds Max Otomatik Sahne Kurulum Betigi (MaxScript)
-- Proje: ${project.projectName}
-- Olculer: ${project.widthM.toFixed(2)}m x ${project.depthM.toFixed(2)}m x Tavan ${project.ceilingM.toFixed(2)}m
-- Kullanim: Bu .ms dosyasini 3ds Max penceresine surukleyip birakin
--           (veya Scripting -> Run Script ile calistirin).
-- ============================================================================

(
    -- 1. Metrik Santimetre Birim Ayari (1 birim = 1 cm)
    units.DisplayType = #Metric
    units.MetricType = #Centimeters
    units.SystemType = #Centimeters
    units.SystemScale = 1.0

    -- 2. Ayni klasordeki .GLB (3ds Max 2023+) veya .OBJ sahnesini ice aktar
    local scriptDir = getFilenamePath (getThisScriptFilename())
    local glbPath = scriptDir + "${glbFile}"
    local objPath = scriptDir + "${objFile}"
    local importedOk = false

    if doesFileExist glbPath then (
        try (
            importFile glbPath #noPrompt
            importedOk = true
        ) catch (
            importedOk = false
        )
    )

    if (not importedOk) and (doesFileExist objPath) then (
        try (
            importFile objPath #noPrompt
            importedOk = true
        ) catch (
            importedOk = false
        )
    )

    if not importedOk then (
        local picked = getOpenFileName caption:"MekanAR 3B Sahne Dosyasini Secin (.glb veya .obj)" types:"3D Sahne (*.glb;*.obj)|*.glb;*.obj|Tumu (*.*)|*.*|"
        if picked != undefined do (
            importFile picked #noPrompt
            importedOk = true
        )
    )

    -- 3. MekanAR Birebir Kamera Acisi (Target Camera)
    local existingCam = getNodeByName "MekanAR_Kamera"
    if existingCam != undefined do delete existingCam
    local camTgtObj = Targetobject pos:${camTgt} name:"MekanAR_Kamera.Target"
    local camObj = Targetcamera pos:${camPos} target:camTgtObj fov:${camFov} name:"MekanAR_Kamera"
    try ( viewport.setCamera camObj ) catch ()

    -- 4. MekanAR Gunes Isigi (V-Ray Sun / Corona Sun ile kolayca degistirilebilir)
    local existingSun = getNodeByName "MekanAR_Gunes"
    if existingSun != undefined do delete existingSun
    local sunTgt = Targetobject pos:[0, 0, ${(project.ceilingM * 35).toFixed(1)}] name:"MekanAR_Gunes.Target"
    local sunObj = TargetDirectionallight pos:[${sx}, ${sy}, ${sz}] target:sunTgt multiplier:1.2 castShadows:true name:"MekanAR_Gunes"
    sunObj.rgb = color 255 244 228

    max views redraw
    messageBox "MekanAR 3B sahnesi 1:1 cm olceginde ve kamera acisiyla kuruldu!\\nV-Ray veya Corona materyallerini atayip dogrudan render alabilirsiniz." title:"MekanAR -> 3ds Max Hazir"
)
`;

  return {
    scriptText,
    filename: `${slug}-3dsMax-Sahne-Kur.ms`,
  };
}

/** Lightweight standards-compliant ZIP builder (STORE method 0 + IEEE CRC-32, zero external deps!) */
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZipArchive(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.byteLength;

    // Local file header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true); // version needed
    ldv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    ldv.setUint16(8, 0, true); // STORE (no compression)
    ldv.setUint16(10, 0, true);
    ldv.setUint16(12, 0, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, f.data);

    // Central directory header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);

    centralParts.push(ch);
    offset += lh.byteLength + size;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.byteLength, 0);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.byteLength;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of localParts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  for (const p of centralParts) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  out.set(eocd, pos);
  return out;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const m = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/s);
  if (!m) return null;
  const bin = atob(m[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function triggerBinaryDownload(bytes: Uint8Array, filename: string, mime = 'application/octet-stream') {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Builds the complete 1-click Architect 3ds Max Bundle (.ZIP):
 *  - .GLB (3ds Max 2023+ PBR embedded)
 *  - .OBJ + .MTL (3ds Max 2018-2026 / SketchUp / Rhino, Z-up cm)
 *  - 3dsMax_Sahne_Kur.ms (MaxScript auto-import + exact camera + sun)
 *  - Optional V-Ray Render reference .PNG
 *  - Turkish README instructions
 */
export async function exportFull3dsMaxZipBundle(
  ctx: Scene3dsMaxContext,
  project: ArchRoomProject,
  opts: Export3dsMaxOptions,
  latestRenderDataUrl?: string | null
): Promise<{ filename: string; byteLength: number; stats: Export3dsMaxStats }> {
  const enc = new TextEncoder();
  const glb = await exportSceneToGlb(ctx, project, opts);
  const obj = exportSceneToObjMtl(ctx, project, opts);
  const ms = generate3dsMaxScript(ctx, project, glb.stats.slug);

  const readme = [
    `MEKANAR MIMARI -> AUTODESK 3DS MAX SAHNE PAKETI`,
    `================================================`,
    `Proje: ${project.projectName}`,
    `Oda Sayisi: ${glb.stats.roomCount} | Mobilya: ${glb.stats.furnitureCount} | 3B Ucgen: ${glb.stats.triangleCount.toLocaleString('tr-TR')}`,
    ``,
    `HIZLI KURULUM (3 ADIM):`,
    `1. Bu ZIP dosyasini tek bir klasore cikarin.`,
    `2. 3ds Max'i acin ve "${ms.filename}" dosyasini 3ds Max ekranina surukleyip birakin`,
    `   (veya File -> Import ile "${glb.filename}" [Max 2023+] ya da "${obj.objFilename}" [Tum surumler] secin).`,
    `3. Sahne 1:1 santimetre olceginde, tum 4 duvar, katmanli mobilyalar ve MekanAR kamera acisiyla acilacaktir.`,
    `   V-Ray veya Corona materyal/isik atayarak nihai renderinizi alabilirsiniz.`,
    ``,
    `NOT: .max uzantisi Autodesk'e ozel kapali ikili format oldugu icin 3ds Max tarafindan`,
    `resmi olarak desteklenen glTF 2.0 (.GLB), Wavefront (.OBJ/.MTL) ve MaxScript (.MS)`,
    `birlikte sunulmustur.`,
  ].join('\r\n');

  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: glb.filename, data: glb.bytes },
    { name: obj.objFilename, data: enc.encode(obj.objText) },
    { name: obj.mtlFilename, data: enc.encode(obj.mtlText) },
    { name: ms.filename, data: enc.encode(ms.scriptText) },
    { name: 'BENI_OKU_3dsMax.txt', data: enc.encode(readme) },
  ];

  if (latestRenderDataUrl) {
    const pngBytes = dataUrlToBytes(latestRenderDataUrl);
    if (pngBytes) {
      entries.push({ name: `${glb.stats.slug}-VRay-Referans-Render.png`, data: pngBytes });
    }
  }

  const zipBytes = buildZipArchive(entries);
  const zipName = `${glb.stats.slug}-3dsMax-Paketi.zip`;
  triggerBinaryDownload(zipBytes, zipName, 'application/zip');
  return { filename: zipName, byteLength: zipBytes.byteLength, stats: glb.stats };
}
