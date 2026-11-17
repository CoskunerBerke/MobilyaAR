import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ArrowLeft,
  Camera,
  Download,
  Eye,
  ImageIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import type { Product } from '../lib/products';
import {
  reconstructRoom3D,
  type ReconstructRoomResult,
  type ReconstructedObject3D,
} from '../lib/server';
import {
  buildClientStudioFromPhotos,
  buildDemoStudioRoom,
  DEMO_STUDIO_PRESETS,
  type DemoStudioPresetId,
} from '../lib/demoRooms';
import {
  findOpenSpawnPosition,
  parseProductFootprintM,
  resolveMoveOBB,
  resolveRotateOBB,
  type OBB2D,
} from '../lib/collision2d';
import { buildContactShadow } from '../lib/contactShadow';
import {
  buildRoomEnvironment,
  loadHtmlImage,
  loadThreeTexture,
  normalizeRoomPhoto,
  preparePhotorealMaterial,
} from '../lib/roomRendering';

interface Props {
  product: Product;
  products: Product[];
  serverUrl: string;
  serverOnline?: boolean;
  initialPreset?: DemoStudioPresetId;
  onBack: () => void;
}

interface CapturedView {
  id: string;
  dataUrl: string;
  exifFocal35mm?: number;
}

interface PlacedItem3D {
  id: string;
  label: string;
  dimensionsCm: string;
  product?: Product;
  existingSpec?: ReconstructedObject3D;
  x: number;
  z: number;
  rot: number;
  halfW: number;
  halfD: number;
  isScanned?: boolean;
}

type Step = 'capture' | 'reconstructing' | 'studio' | 'error';
type WallMode = 'auto' | 'all' | 'floor';
type ClipAxis = 'none' | 'x' | 'z' | 'y';
type DrawerFilter = 'all' | 'seating' | 'tables' | 'storage';

function buildExistingFurnitureGroup(
  obj: ReconstructedObject3D,
  clipPlane: THREE.Plane,
  disposeFns: Array<() => void>
): THREE.Group {
  const [w, h, d] = obj.size;
  const grp = new THREE.Group();

  const rawCol = new THREE.Color(obj.colorHex || '#a39c93');
  const mainCol = rawCol.clone().lerp(new THREE.Color(0xe7e3dc), 0.35);
  const darkTrimCol = rawCol.clone().multiplyScalar(0.65);

  const mainMat = new THREE.MeshStandardMaterial({
    color: mainCol,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.32,
    clippingPlanes: [clipPlane],
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: darkTrimCol,
    roughness: 0.72,
    metalness: 0.05,
    envMapIntensity: 0.3,
    clippingPlanes: [clipPlane],
  });
  const beddingMat = new THREE.MeshStandardMaterial({
    color: 0xf4f1ea,
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.28,
    clippingPlanes: [clipPlane],
  });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x18191d,
    roughness: 0.25,
    metalness: 0.2,
    envMapIntensity: 0.55,
    clippingPlanes: [clipPlane],
  });
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x52525b,
    transparent: true,
    opacity: 0.24,
  });

  disposeFns.push(() => {
    mainMat.dispose();
    trimMat.dispose();
    beddingMat.dispose();
    screenMat.dispose();
    edgeMat.dispose();
  });

  const addBox = (
    bx: number,
    by: number,
    bz: number,
    px: number,
    py: number,
    pz: number,
    mat: THREE.Material,
    withEdges = true
  ) => {
    const geo = new THREE.BoxGeometry(Math.max(0.02, bx), Math.max(0.02, by), Math.max(0.02, bz));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (withEdges) {
      const eGeo = new THREE.EdgesGeometry(geo);
      const lines = new THREE.LineSegments(eGeo, edgeMat);
      lines.userData.isHelper = true;
      mesh.add(lines);
      disposeFns.push(() => eGeo.dispose());
    }
    disposeFns.push(() => geo.dispose());
    grp.add(mesh);
  };

  if (obj.kind === 'bed') {
    const baseH = Math.min(0.24, h * 0.36);
    const matH = Math.min(0.26, h * 0.42);
    const headThick = 0.08;
    const headH = Math.max(baseH + matH + 0.16, h);
    const bodyD = d - headThick;
    addBox(w, headH, headThick, 0, headH * 0.5, -d * 0.5 + headThick * 0.5, trimMat);
    addBox(w, baseH, bodyD, 0, baseH * 0.5, headThick * 0.5, mainMat);
    addBox(w * 0.96, matH, bodyD * 0.96, 0, baseH + matH * 0.5, headThick * 0.5, beddingMat);
  } else if (obj.kind === 'sofa' || obj.kind === 'armchair') {
    const legH = 0.08;
    const seatTop = Math.min(0.45, h * 0.54);
    const seatH = seatTop - legH;
    const backT = Math.min(0.2, d * 0.24);
    const armW = obj.kind === 'armchair' ? Math.min(0.14, w * 0.18) : Math.min(0.18, w * 0.12);
    const armH = Math.min(h * 0.78, Math.max(seatTop + 0.16, 0.62));
    addBox(w * 0.94, legH, d * 0.92, 0, legH * 0.5, 0, trimMat, false);
    addBox(w, seatH, d, 0, legH + seatH * 0.5, 0, mainMat);
    const backH = Math.max(0.25, h - seatTop);
    addBox(w - armW * 2, backH, backT, 0, seatTop + backH * 0.5, -d * 0.5 + backT * 0.5, mainMat);
    addBox(armW, armH - legH, d, -w * 0.5 + armW * 0.5, legH + (armH - legH) * 0.5, 0, mainMat);
    addBox(armW, armH - legH, d, w * 0.5 - armW * 0.5, legH + (armH - legH) * 0.5, 0, mainMat);
  } else if (obj.kind === 'desk' || obj.kind === 'table' || obj.kind === 'coffee_table') {
    const topT = 0.045;
    const legH = Math.max(0.15, h - topT);
    const legT = 0.045;
    addBox(w, topT, d, 0, h - topT * 0.5, 0, mainMat);
    const ox = w * 0.5 - legT;
    const oz = d * 0.5 - legT;
    addBox(legT, legH, legT, -ox, legH * 0.5, -oz, trimMat, false);
    addBox(legT, legH, legT, ox, legH * 0.5, -oz, trimMat, false);
    addBox(legT, legH, legT, -ox, legH * 0.5, oz, trimMat, false);
    addBox(legT, legH, legT, ox, legH * 0.5, oz, trimMat, false);
  } else if (obj.kind === 'chair') {
    const seatY = Math.min(0.45, h * 0.52);
    const legT = 0.038;
    const ox = w * 0.36;
    const oz = d * 0.36;
    addBox(legT, seatY, legT, -ox, seatY * 0.5, -oz, trimMat, false);
    addBox(legT, seatY, legT, ox, seatY * 0.5, -oz, trimMat, false);
    addBox(legT, seatY, legT, -ox, seatY * 0.5, oz, trimMat, false);
    addBox(legT, seatY, legT, ox, seatY * 0.5, oz, trimMat, false);
    addBox(w * 0.88, 0.06, d * 0.88, 0, seatY, 0, mainMat);
    const backH = Math.max(0.24, h - seatY);
    addBox(w * 0.86, backH, 0.06, 0, seatY + backH * 0.5, -d * 0.42, mainMat);
  } else if (obj.kind === 'bookcase') {
    const sideT = 0.035;
    addBox(w, h, d * 0.25, 0, h * 0.5, -d * 0.37, trimMat);
    addBox(sideT, h, d, -w * 0.5 + sideT * 0.5, h * 0.5, 0, mainMat);
    addBox(sideT, h, d, w * 0.5 - sideT * 0.5, h * 0.5, 0, mainMat);
    for (let i = 0; i <= 4; i++) {
      const sy = i === 0 ? 0.025 : i === 4 ? h - 0.025 : (h / 4) * i;
      addBox(w - sideT * 2, 0.03, d * 0.96, 0, sy, 0.01, mainMat);
    }
  } else if (obj.kind === 'tv') {
    const standH = Math.min(0.18, h * 0.22);
    addBox(w * 0.42, 0.03, Math.max(0.18, d), 0, 0.015, 0, trimMat, false);
    addBox(0.06, standH, 0.04, 0, standH * 0.5, 0, trimMat, false);
    addBox(w, h - standH * 0.6, Math.min(0.06, d), 0, standH * 0.6 + (h - standH * 0.6) * 0.5, 0, screenMat);
  } else {
    const plinthH = 0.06;
    addBox(w * 0.96, plinthH, d * 0.92, 0, plinthH * 0.5, 0, trimMat, false);
    addBox(w, h - plinthH, d, 0, plinthH + (h - plinthH) * 0.5, 0, mainMat);
  }

  return grp;
}

export const Room3DStudio: React.FC<Props> = ({
  product,
  products,
  serverUrl,
  serverOnline = false,
  initialPreset,
  onBack,
}) => {
  const [step, setStep] = useState<Step>('capture');
  const [views, setViews] = useState<CapturedView[]>([]);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<ReconstructRoomResult | null>(null);
  const [sceneReady, setSceneReady] = useState(0);

  const [items, setItems] = useState<PlacedItem3D[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);

  const [wallMode, setWallMode] = useState<WallMode>('auto');
  const [emptyRoom, setEmptyRoom] = useState(true);
  const [clipAxis, setClipAxis] = useState<ClipAxis>('none');
  const [clipPct, setClipPct] = useState(85);
  const [showClipBar, setShowClipBar] = useState(false);
  const [showSizeBar, setShowSizeBar] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'add' | 'swap' | null>(null);
  const [drawerFilter, setDrawerFilter] = useState<DrawerFilter>('all');
  const [activeCamIdx, setActiveCamIdx] = useState<number | 'free' | 'top'>('free');
  const [disp, setDisp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef<PlacedItem3D[]>([]);
  itemsRef.current = items;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const wallModeRef = useRef<WallMode>('auto');
  wallModeRef.current = wallMode;
  const emptyRoomRef = useRef(true);
  emptyRoomRef.current = emptyRoom;
  const activeCamIdxRef = useRef<number | 'free' | 'top'>('free');
  activeCamIdxRef.current = activeCamIdx;
  const roomDimsRef = useRef<{ w: number; d: number; ch: number }>({ w: 4.6, d: 5.2, ch: 2.7 });
  const hitObstacleRef = useRef(false);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rafId: number;
    itemsRoot: THREE.Group;
    floorMesh: THREE.Mesh;
    borderLines: THREE.LineSegments;
    shadowCatcher: THREE.Mesh;
    groups: Map<string, { key: string; root: THREE.Group }>;
    walls: Array<{ side: 'north' | 'south' | 'west' | 'east'; mesh: THREE.Mesh; inwardNormal: THREE.Vector3; center: THREE.Vector3 }>;
    clipPlane: THREE.Plane;
    selFrame: THREE.LineLoop;
    selMat: THREE.LineBasicMaterial;
    light: THREE.DirectionalLight;
    envTex: THREE.Texture | null;
    gltfCache: Map<string, THREE.Group>;
    loadingKeys: Set<string>;
    disposeFns: Array<() => void>;
  } | null>(null);

  const alive = useRef(true);
  const drag = useRef<{ id: string; hx: number; hz: number; px: number; pz: number } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 3000);
  }, []);

  const disposeStudio = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    cancelAnimationFrame(s.rafId);
    s.disposeFns.forEach((fn) => fn());
    s.controls.dispose();
    s.envTex?.dispose();
    s.renderer.dispose();
    sceneRef.current = null;
  }, []);

  const toOBB = (it: PlacedItem3D): OBB2D => ({
    id: it.id,
    x: it.x,
    z: it.z,
    rot: it.rot,
    halfW: it.halfW,
    halfD: it.halfD,
  });

  const getOtherOBBs = useCallback((excludeId: string): OBB2D[] => {
    return itemsRef.current
      .filter((it) => it.id !== excludeId && (!it.isScanned || !emptyRoomRef.current))
      .map(toOBB);
  }, []);

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList).slice(0, Math.max(0, 6 - views.length));
    const parsed: CapturedView[] = [];
    for (const f of picked) {
      try {
        const res = await normalizeRoomPhoto(f, 1024);
        parsed.push({
          id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl: res.dataUrl,
          exifFocal35mm: res.exifFocal35mm,
        });
      } catch {
        /* ignore unreadable file */
      }
    }
    if (parsed.length > 0) {
      setViews((prev) => [...prev, ...parsed].slice(0, 6));
    }
  };

  const applyRoomResult = useCallback((res: ReconstructRoomResult) => {
    roomDimsRef.current = { w: res.roomWidthM, d: res.roomDepthM, ch: res.ceilingHeightM };
    setRoomData(res);
    setEmptyRoom(true);
    setClipAxis('none');
    setShowClipBar(false);
    setShowSizeBar(false);
    setWallMode('auto');
    setActiveCamIdx('free');

    // Tarama eşyaları varsa hareketli/çarpışmalı öğe olarak hazır tut (başlangıçta oda boş açılır)
    const scanned: PlacedItem3D[] = (res.existingObjects || []).map((obj) => ({
      id: obj.id,
      label: obj.label,
      dimensionsCm: `${Math.round(obj.size[0] * 100)} × ${Math.round(obj.size[2] * 100)} × ${Math.round(obj.size[1] * 100)} cm`,
      existingSpec: obj,
      x: obj.center[0],
      z: obj.center[2],
      rot: obj.yaw,
      halfW: Math.max(0.14, obj.size[0] * 0.5 - 0.01),
      halfD: Math.max(0.14, obj.size[2] * 0.5 - 0.01),
      isScanned: true,
    }));

    itemsRef.current = scanned;
    setItems(scanned);
    selectedIdRef.current = null;
    setSelectedId(null);
    setStep('studio');
  }, []);

  const loadDemoPreset = useCallback(
    (presetId: DemoStudioPresetId) => {
      disposeStudio();
      const res = buildDemoStudioRoom(presetId);
      applyRoomResult(res);
    },
    [disposeStudio, applyRoomResult]
  );

  useEffect(() => {
    if (initialPreset) {
      loadDemoPreset(initialPreset);
    }
  }, [initialPreset, loadDemoPreset]);

  const startReconstruction = async () => {
    if (views.length < 2) return;
    disposeStudio();
    setStep('reconstructing');
    try {
      if (serverOnline) {
        try {
          const res = await reconstructRoom3D(
            serverUrl,
            views.map((v) => v.dataUrl),
            views.map((v) => v.exifFocal35mm)
          );
          applyRoomResult(res);
          return;
        } catch {
          /* Sunucu çevrimdışıysa yerel stüdyoya düş */
        }
      }
      const fallback = await buildClientStudioFromPhotos(views);
      applyRoomResult(fallback);
      showToast('Hızlı demo stüdyosu kuruldu — katalogdan ürün ekleyebilirsiniz');
    } catch (e) {
      setError(e instanceof Error ? e.message : '3D oda oluşturulamadı');
      setStep('error');
    }
  };

  // ---- Gerçek Fotoğraf Açısı Ölçeğini Ekrana Sığdır ----
  useEffect(() => {
    if (step !== 'studio' || !roomData || !stageRef.current || typeof activeCamIdx !== 'number') {
      setDisp({ w: 0, h: 0 });
      return;
    }
    const cam = roomData.cameras[activeCamIdx];
    if (!cam) return;
    const el = stageRef.current;
    const fit = () => {
      const aw = el.clientWidth;
      const ah = el.clientHeight;
      if (aw <= 0 || ah <= 0) return;
      const ar = (cam.imageWidth || 4) / (cam.imageHeight || 3);
      let w = aw;
      let h = aw / ar;
      if (h > ah) {
        h = ah;
        w = ah * ar;
      }
      setDisp({ w: Math.floor(w), h: Math.floor(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, roomData, activeCamIdx]);

  // ---- 3D Oda Sahnesini Kur (Oda boyutu değişikliklerini içeriden hızlı günceller) ----
  const setupKey = roomData ? `${roomData.floorTexture.slice(0, 64)}:${roomData.viewCount}` : '';

  useEffect(() => {
    if (step !== 'studio' || !roomData || !hostRef.current) return;
    const host = hostRef.current;

    let cancelled = false;
    (async () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight - 180;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.localClippingEnabled = true;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf4f4f5);
      renderer.setClearColor(0xf4f4f5, 1);

      const camera = new THREE.PerspectiveCamera(52, w / h, 0.08, 60);
      const rw = roomDimsRef.current.w;
      const rd = roomDimsRef.current.d;
      const ch = roomDimsRef.current.ch;
      camera.position.set(rw * 0.65, ch * 1.15, rd * 0.85);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.9;
      controls.maxDistance = 15;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.target.set(0, 0.72, 0);
      controls.update();

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const disposeFns: Array<() => void> = [];

      const [floorImg, floorTex, northTex, southTex, westTex, eastTex] = await Promise.all([
        loadHtmlImage(roomData.floorTexture),
        loadThreeTexture(roomData.floorTexture),
        loadThreeTexture(roomData.wallTextures.north),
        loadThreeTexture(roomData.wallTextures.south),
        loadThreeTexture(roomData.wallTextures.west),
        loadThreeTexture(roomData.wallTextures.east),
      ]);

      if (cancelled || !alive.current) {
        [floorTex, northTex, southTex, westTex, eastTex].forEach((t) => t.dispose());
        controls.dispose();
        renderer.dispose();
        return;
      }

      [floorTex, northTex, southTex, westTex, eastTex].forEach((t) => {
        t.anisotropy = maxAniso;
      });
      disposeFns.push(() => [floorTex, northTex, southTex, westTex, eastTex].forEach((t) => t.dispose()));

      host.innerHTML = '';
      host.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.touchAction = 'none';

      const envInfo = buildRoomEnvironment(floorImg, renderer);
      scene.environment = envInfo.env;

      const hemi = new THREE.HemisphereLight(0xffffff, 0xd6d3cd, 0.95);
      scene.add(hemi);

      const light = new THREE.DirectionalLight(0xfffcf5, 1.45);
      const ld = roomData.lightDir;
      light.position.set(ld[0] * 6, Math.max(3.5, ld[1] * 6), ld[2] * 6);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const ext = Math.max(rw, rd) * 0.85;
      light.shadow.camera.left = -ext;
      light.shadow.camera.right = ext;
      light.shadow.camera.top = ext;
      light.shadow.camera.bottom = -ext;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 18;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 4;
      scene.add(light);

      const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);

      // Zemin
      const floorGeo = new THREE.PlaneGeometry(rw, rd).rotateX(-Math.PI / 2);
      const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.86,
        metalness: 0.0,
        envMapIntensity: 0.28,
        side: THREE.DoubleSide,
      });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
      disposeFns.push(() => {
        floorMesh.geometry.dispose();
        floorMat.dispose();
      });

      // Fotoğraf açısı gölge yakalayıcı
      const scGeo = new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2);
      const scMat = new THREE.ShadowMaterial({ opacity: 0.34 });
      const shadowCatcher = new THREE.Mesh(scGeo, scMat);
      shadowCatcher.position.y = 0.001;
      shadowCatcher.receiveShadow = true;
      shadowCatcher.visible = false;
      scene.add(shadowCatcher);
      disposeFns.push(() => {
        scGeo.dispose();
        scMat.dispose();
      });

      // Zemin kenar mimari çerçeve çizgisi
      const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, 0.012, rd));
      const borderMat = new THREE.LineBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.4 });
      const borderLines = new THREE.LineSegments(borderGeo, borderMat);
      borderLines.position.y = 0.006;
      scene.add(borderLines);
      disposeFns.push(() => {
        borderLines.geometry.dispose();
        borderMat.dispose();
      });

      // 4 Mimari Duvar
      const hw = rw * 0.5;
      const hd = rd * 0.5;
      const wallSpecs = [
        {
          side: 'north' as const,
          w: rw,
          tex: northTex,
          pos: new THREE.Vector3(0, ch * 0.5, -hd),
          rotY: 0,
          normal: new THREE.Vector3(0, 0, 1),
        },
        {
          side: 'south' as const,
          w: rw,
          tex: southTex,
          pos: new THREE.Vector3(0, ch * 0.5, hd),
          rotY: Math.PI,
          normal: new THREE.Vector3(0, 0, -1),
        },
        {
          side: 'west' as const,
          w: rd,
          tex: westTex,
          pos: new THREE.Vector3(-hw, ch * 0.5, 0),
          rotY: Math.PI / 2,
          normal: new THREE.Vector3(1, 0, 0),
        },
        {
          side: 'east' as const,
          w: rd,
          tex: eastTex,
          pos: new THREE.Vector3(hw, ch * 0.5, 0),
          rotY: -Math.PI / 2,
          normal: new THREE.Vector3(-1, 0, 0),
        },
      ];

      const walls: Array<{
        side: 'north' | 'south' | 'west' | 'east';
        mesh: THREE.Mesh;
        inwardNormal: THREE.Vector3;
        center: THREE.Vector3;
      }> = [];
      for (const ws of wallSpecs) {
        const wGeo = new THREE.PlaneGeometry(ws.w, ch);
        const wMat = new THREE.MeshStandardMaterial({
          map: ws.tex,
          roughness: 0.92,
          metalness: 0.0,
          envMapIntensity: 0.16,
          side: THREE.DoubleSide,
          clippingPlanes: [clipPlane],
        });
        const wMesh = new THREE.Mesh(wGeo, wMat);
        wMesh.position.copy(ws.pos);
        wMesh.rotation.y = ws.rotY;
        wMesh.receiveShadow = true;
        scene.add(wMesh);
        walls.push({ side: ws.side, mesh: wMesh, inwardNormal: ws.normal, center: ws.pos.clone() });
        disposeFns.push(() => {
          wMesh.geometry.dispose();
          wMat.dispose();
        });
      }

      // Seçili OBB dikdörtgen ayak izi çerçevesi
      const selGeo = new THREE.BufferGeometry();
      selGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(
          new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]),
          3
        )
      );
      const selMat = new THREE.LineBasicMaterial({
        color: 0x18181b,
        transparent: true,
        opacity: 0.85,
      });
      const selFrame = new THREE.LineLoop(selGeo, selMat);
      selFrame.visible = false;
      selFrame.userData.isHelper = true;
      scene.add(selFrame);
      disposeFns.push(() => {
        selGeo.dispose();
        selMat.dispose();
      });

      const itemsRoot = new THREE.Group();
      scene.add(itemsRoot);

      sceneRef.current = {
        renderer,
        scene,
        camera,
        controls,
        rafId: 0,
        itemsRoot,
        floorMesh,
        borderLines,
        shadowCatcher,
        groups: new Map(),
        walls,
        clipPlane,
        selFrame,
        selMat,
        light,
        envTex: envInfo.env,
        gltfCache: new Map(),
        loadingKeys: new Set(),
        disposeFns,
      };
      setSceneReady((v) => v + 1);

      const onResize = () => {
        if (!hostRef.current || !sceneRef.current) return;
        const nw = hostRef.current.clientWidth;
        const nh = hostRef.current.clientHeight;
        if (nw > 0 && nh > 0 && typeof activeCamIdxRef.current !== 'number') {
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);
      disposeFns.push(() => ro.disconnect());

      const toCam = new THREE.Vector3();
      const animate = () => {
        if (!sceneRef.current) return;
        sceneRef.current.rafId = requestAnimationFrame(animate);
        const isPhoto = typeof activeCamIdxRef.current === 'number';
        if (!isPhoto) {
          controls.update();
          const wm = wallModeRef.current;
          for (const wall of walls) {
            if (wm === 'floor') {
              wall.mesh.visible = false;
            } else if (wm === 'all') {
              wall.mesh.visible = true;
            } else {
              toCam.subVectors(camera.position, wall.center);
              wall.mesh.visible = toCam.dot(wall.inwardNormal) > 0.05;
            }
          }
        }

        const sel = itemsRef.current.find(
          (it) => it.id === selectedIdRef.current && (!it.isScanned || !emptyRoomRef.current)
        );
        if (sel) {
          selFrame.visible = true;
          selFrame.position.set(sel.x, 0.007, sel.z);
          selFrame.rotation.set(0, sel.rot, 0);
          selFrame.scale.set(sel.halfW + 0.025, 1, sel.halfD + 0.025);
          selMat.color.setHex(hitObstacleRef.current ? 0xdc2626 : 0x18181b);
        } else {
          selFrame.visible = false;
        }

        renderer.render(scene, camera);
      };
      animate();
    })();

    return () => {
      cancelled = true;
      disposeStudio();
    };
  }, [step, setupKey, disposeStudio]);

  // ---- Oda Boyutlarını Yerinde Güncelle (Yeniden yükleme olmadan) ----
  const updateRoomDimensions = (newW: number, newD: number) => {
    const rw = Math.min(8.5, Math.max(2.6, Math.round(newW * 10) / 10));
    const rd = Math.min(8.5, Math.max(2.6, Math.round(newD * 10) / 10));
    if (!roomData) return;

    const ch = roomData.ceilingHeightM;
    roomDimsRef.current = { w: rw, d: rd, ch };
    setRoomData((prev) => (prev ? { ...prev, roomWidthM: rw, roomDepthM: rd } : prev));

    const s = sceneRef.current;
    if (s) {
      s.floorMesh.geometry.dispose();
      s.floorMesh.geometry = new THREE.PlaneGeometry(rw, rd).rotateX(-Math.PI / 2);
      s.borderLines.geometry.dispose();
      s.borderLines.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, 0.012, rd));

      const hw = rw * 0.5;
      const hd = rd * 0.5;
      for (const wall of s.walls) {
        wall.mesh.geometry.dispose();
        if (wall.side === 'north') {
          wall.mesh.geometry = new THREE.PlaneGeometry(rw, ch);
          wall.mesh.position.set(0, ch * 0.5, -hd);
        } else if (wall.side === 'south') {
          wall.mesh.geometry = new THREE.PlaneGeometry(rw, ch);
          wall.mesh.position.set(0, ch * 0.5, hd);
        } else if (wall.side === 'west') {
          wall.mesh.geometry = new THREE.PlaneGeometry(rd, ch);
          wall.mesh.position.set(-hw, ch * 0.5, 0);
        } else {
          wall.mesh.geometry = new THREE.PlaneGeometry(rd, ch);
          wall.mesh.position.set(hw, ch * 0.5, 0);
        }
        wall.center.copy(wall.mesh.position);
      }

      const ext = Math.max(rw, rd) * 0.85;
      s.light.shadow.camera.left = -ext;
      s.light.shadow.camera.right = ext;
      s.light.shadow.camera.top = ext;
      s.light.shadow.camera.bottom = -ext;
      s.light.shadow.camera.updateProjectionMatrix();
    }

    // Eşyaları yeni oda sınırları içine çarpışmasız sığdır
    const settled: PlacedItem3D[] = [];
    for (const it of itemsRef.current) {
      const others = settled.filter((o) => !o.isScanned || !emptyRoomRef.current).map(toOBB);
      const mv = resolveMoveOBB(toOBB(it), it.x, it.z, others, rw, rd);
      settled.push({ ...it, x: mv.x, z: mv.z });
    }
    itemsRef.current = settled;
    setItems(settled);
  };

  // ---- Fotoğraf Açısı / Serbest 3D Mod Senkronizasyonu ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !roomData || step !== 'studio') return;

    const rw = roomDimsRef.current.w;
    const rd = roomDimsRef.current.d;
    const ch = roomDimsRef.current.ch;

    if (typeof activeCamIdx === 'number') {
      const cam = roomData.cameras[activeCamIdx];
      if (!cam) return;
      s.controls.enabled = false;
      s.scene.background = null;
      s.renderer.setClearColor(0x000000, 0);
      if (disp.w > 0 && disp.h > 0) {
        s.renderer.setSize(disp.w, disp.h);
      }
      s.floorMesh.visible = false;
      s.borderLines.visible = false;
      s.shadowCatcher.visible = true;
      for (const wall of s.walls) wall.mesh.visible = false;

      s.camera.fov = cam.vfovDeg || 52;
      s.camera.aspect = (cam.imageWidth || 4) / (cam.imageHeight || 3);
      s.camera.updateProjectionMatrix();
      s.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...(cam.basis.right as [number, number, number])),
        new THREE.Vector3(...(cam.basis.up as [number, number, number])),
        new THREE.Vector3(...(cam.basis.back as [number, number, number]))
      );
      s.camera.quaternion.setFromRotationMatrix(basis);
      s.camera.updateMatrixWorld(true);
    } else {
      s.scene.background = new THREE.Color(0xf4f4f5);
      s.renderer.setClearColor(0xf4f4f5, 1);
      if (hostRef.current && hostRef.current.clientWidth > 0 && hostRef.current.clientHeight > 0) {
        const nw = hostRef.current.clientWidth;
        const nh = hostRef.current.clientHeight;
        s.renderer.setSize(nw, nh);
        s.camera.aspect = nw / nh;
      }
      s.camera.fov = 52;
      s.camera.updateProjectionMatrix();
      s.floorMesh.visible = true;
      s.borderLines.visible = true;
      s.shadowCatcher.visible = false;
      s.controls.enabled = true;

      if (activeCamIdx === 'top') {
        s.camera.position.set(0, Math.max(rw, rd) * 1.42, 0.01);
        s.controls.target.set(0, 0, 0);
      } else {
        s.camera.position.set(rw * 0.65, ch * 1.15, rd * 0.85);
        s.controls.target.set(0, 0.72, 0);
      }
      s.controls.update();
    }
  }, [activeCamIdx, wallMode, roomData, sceneReady, disp.w, disp.h, step]);

  // ---- Kesit düzlemi ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !roomData) return;

    if (clipAxis === 'none') {
      s.clipPlane.set(new THREE.Vector3(0, -1, 0), 100);
    } else if (clipAxis === 'y') {
      const maxH = 0.25 + (clipPct / 100) * roomData.ceilingHeightM;
      s.clipPlane.set(new THREE.Vector3(0, -1, 0), maxH);
    } else if (clipAxis === 'x') {
      const rw = roomData.roomWidthM;
      const cutoff = -rw * 0.5 + (clipPct / 100) * rw;
      s.clipPlane.set(new THREE.Vector3(-1, 0, 0), cutoff);
    } else if (clipAxis === 'z') {
      const rd = roomData.roomDepthM;
      const cutoff = -rd * 0.5 + (clipPct / 100) * rd;
      s.clipPlane.set(new THREE.Vector3(0, 0, -1), cutoff);
    }
  }, [clipAxis, clipPct, roomData, sceneReady]);

  // ---- Tüm Eşyaları (CAD Mobilyalar + Taramadan Gelen Hareketli Eşyalar) Senkronize Et ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || step !== 'studio') return;

    const activeIds = new Set(items.map((i) => i.id));
    for (const [id, entry] of s.groups.entries()) {
      const curItem = items.find((i) => i.id === id);
      const curKey = curItem ? (curItem.product ? curItem.product.glbUrl : `scan:${curItem.id}`) : '';
      if (!activeIds.has(id) || curKey !== entry.key) {
        s.itemsRoot.remove(entry.root);
        s.groups.delete(id);
      }
    }

    const mountInstance = (item: PlacedItem3D, template: THREE.Group, itemKey: string) => {
      if (!sceneRef.current || s.groups.has(item.id)) return;
      const model = template.clone(true);
      const maxAniso = s.renderer.capabilities.getMaxAnisotropy();
      const isFabricCat = item.product?.category === 'Kanepe' || item.product?.category === 'Berjer';

      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.instanceId = item.id;

        if (item.product) {
          const mats = Array.isArray(m.material) ? m.material.map((mt) => mt.clone()) : [m.material.clone()];
          mats.forEach((mt) => preparePhotorealMaterial(mt, maxAniso, isFabricCat));
          m.material = Array.isArray(m.material) ? mats : mats[0];
        }
      });

      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = new THREE.Vector3();
      const sz = new THREE.Vector3();
      box.getCenter(c);
      box.getSize(sz);
      model.position.x -= c.x;
      model.position.y -= box.min.y;
      model.position.z -= c.z;

      const root = new THREE.Group();
      root.userData.instanceId = item.id;
      root.add(model);
      const shadow = buildContactShadow(model);
      shadow.userData.isHelper = true;
      root.add(shadow);

      // Gerçek .glb Box3 ayak izini collision kutusuna uygula ve gerekiyorsa çakışmadan ayır
      const exactHalfW = Math.min(2.8, Math.max(0.14, sz.x * 0.5 - 0.012));
      const exactHalfD = Math.min(2.8, Math.max(0.14, sz.z * 0.5 - 0.012));
      let px = item.x;
      let pz = item.z;
      let prot = item.rot;

      if (Math.abs(exactHalfW - item.halfW) > 0.02 || Math.abs(exactHalfD - item.halfD) > 0.02) {
        const { w: rw, d: rd } = roomDimsRef.current;
        const others = itemsRef.current
          .filter((o) => o.id !== item.id && (!o.isScanned || !emptyRoomRef.current))
          .map(toOBB);
        const settled = resolveMoveOBB(
          { id: item.id, x: px, z: pz, rot: prot, halfW: exactHalfW, halfD: exactHalfD },
          px,
          pz,
          others,
          rw,
          rd
        );
        px = settled.x;
        pz = settled.z;
        const updated = itemsRef.current.map((it) =>
          it.id === item.id
            ? { ...it, halfW: exactHalfW, halfD: exactHalfD, x: px, z: pz, rot: prot }
            : it
        );
        itemsRef.current = updated;
        setItems(updated);
      }

      root.position.set(px, 0, pz);
      root.rotation.set(0, prot, 0);
      root.visible = !item.isScanned || !emptyRoom;
      s.groups.set(item.id, { key: itemKey, root });
      s.itemsRoot.add(root);
    };

    for (const item of items) {
      const existing = s.groups.get(item.id);
      if (existing) {
        existing.root.position.set(item.x, 0, item.z);
        existing.root.rotation.set(0, item.rot, 0);
        existing.root.visible = !item.isScanned || (!emptyRoom && typeof activeCamIdx !== 'number');
        continue;
      }

      if (item.existingSpec) {
        const grp = buildExistingFurnitureGroup(item.existingSpec, s.clipPlane, s.disposeFns);
        mountInstance(item, grp, `scan:${item.id}`);
        continue;
      }

      if (!item.product) continue;
      const glbUrl = item.product.glbUrl;
      const cached = s.gltfCache.get(glbUrl);
      if (cached) {
        mountInstance(item, cached, glbUrl);
        continue;
      }

      const key = `${item.id}:${glbUrl}`;
      if (s.loadingKeys.has(key)) continue;
      s.loadingKeys.add(key);
      setLoadingCount((cnt) => cnt + 1);

      const prodName = item.product.name;
      new GLTFLoader().load(
        glbUrl,
        (gltf) => {
          s.loadingKeys.delete(key);
          setLoadingCount((cnt) => Math.max(0, cnt - 1));
          if (!alive.current || !sceneRef.current) return;
          s.gltfCache.set(glbUrl, gltf.scene);
          mountInstance(item, gltf.scene, glbUrl);
        },
        undefined,
        () => {
          s.loadingKeys.delete(key);
          setLoadingCount((cnt) => Math.max(0, cnt - 1));
          showToast(`${prodName} yüklenemedi`);
        }
      );
    }
  }, [items, step, emptyRoom, activeCamIdx, sceneReady, showToast]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      disposeStudio();
    };
  }, [disposeStudio]);

  const floorRayHit = (cx: number, cy: number) => {
    const s = sceneRef.current;
    const host = hostRef.current;
    if (!s || !host) return null;
    const r = host.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, s.camera);
    const hit = new THREE.Vector3();
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? hit : null;
  };

  const onPointerDownCapture = (e: React.PointerEvent) => {
    const s = sceneRef.current;
    const host = hostRef.current;
    if (!s || !host) return;

    const r = host.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, s.camera);

    const hits = rc.intersectObjects(s.itemsRoot.children, true);
    const meshHit = hits.find((h) => !h.object.userData?.isHelper && h.object.userData?.instanceId && h.object.visible);
    if (meshHit) {
      const targetId = meshHit.object.userData.instanceId as string;
      const item = itemsRef.current.find((i) => i.id === targetId && (!i.isScanned || !emptyRoomRef.current));
      if (!item) return;
      selectedIdRef.current = targetId;
      setSelectedId(targetId);
      const fh = floorRayHit(e.clientX, e.clientY);
      if (fh) {
        s.controls.enabled = false;
        hitObstacleRef.current = false;
        drag.current = { id: targetId, hx: fh.x, hz: fh.z, px: item.x, pz: item.z };
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !roomData) return;
    const fh = floorRayHit(e.clientX, e.clientY);
    if (!fh) return;

    const did = drag.current.id;
    const cur = itemsRef.current.find((it) => it.id === did);
    if (!cur) return;

    const rawX = drag.current.px + (fh.x - drag.current.hx);
    const rawZ = drag.current.pz + (fh.z - drag.current.hz);
    const { w: rw, d: rd } = roomDimsRef.current;
    const res = resolveMoveOBB(toOBB(cur), rawX, rawZ, getOtherOBBs(did), rw, rd);

    hitObstacleRef.current = res.hitObstacle;
    const nextList = itemsRef.current.map((it) => (it.id === did ? { ...it, x: res.x, z: res.z } : it));
    itemsRef.current = nextList;
    const grp = sceneRef.current?.groups.get(did)?.root;
    if (grp) grp.position.set(res.x, 0, res.z);
  };

  const onPointerUp = () => {
    hitObstacleRef.current = false;
    if (drag.current) {
      drag.current = null;
      setItems([...itemsRef.current]);
    }
    if (sceneRef.current && typeof activeCamIdxRef.current !== 'number') {
      sceneRef.current.controls.enabled = true;
    }
  };

  const rotateBy = (deg: number) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const cur = itemsRef.current.find((it) => it.id === sid);
    if (!cur) return;

    const nextRot = cur.rot + (deg * Math.PI) / 180;
    const { w: rw, d: rd } = roomDimsRef.current;
    const res = resolveRotateOBB(toOBB(cur), nextRot, getOtherOBBs(sid), rw, rd);
    if (!res.ok) {
      showToast('Çevredeki eşyalar veya duvar nedeniyle burada döndürülemiyor');
      return;
    }

    const updated = itemsRef.current.map((it) =>
      it.id === sid ? { ...it, x: res.x, z: res.z, rot: res.rot } : it
    );
    itemsRef.current = updated;
    setItems(updated);
  };

  const removeSelected = () => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const next = itemsRef.current.filter((it) => it.id !== sid);
    itemsRef.current = next;
    setItems(next);
    const visibleNext = next.filter((it) => !it.isScanned || !emptyRoomRef.current);
    const nextSel = visibleNext[visibleNext.length - 1]?.id || null;
    selectedIdRef.current = nextSel;
    setSelectedId(nextSel);
  };

  const clearRoom = () => {
    const remaining = itemsRef.current.filter((it) => it.isScanned);
    itemsRef.current = remaining;
    setItems(remaining);
    setEmptyRoom(true);
    selectedIdRef.current = null;
    setSelectedId(null);
    showToast('Oda boşaltıldı');
  };

  const addProductToRoom = (prod: Product): boolean => {
    const { halfW, halfD } = parseProductFootprintM(prod.dimensionsCm);
    const { w: rw, d: rd } = roomDimsRef.current;
    const pos = findOpenSpawnPosition(
      halfW,
      halfD,
      0,
      getOtherOBBs('__none__'),
      rw,
      rd,
      roomData?.spawnXZ || [0, 0]
    );
    if (!pos) {
      showToast(`Odada bu ürün (${prod.dimensionsCm}) için yeterli boş alan kalmadı`);
      return false;
    }

    const nid = `it-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nextItem: PlacedItem3D = {
      id: nid,
      label: prod.name,
      dimensionsCm: prod.dimensionsCm,
      product: prod,
      x: pos.x,
      z: pos.z,
      rot: pos.rot,
      halfW,
      halfD,
    };
    const nextList = [...itemsRef.current, nextItem];
    itemsRef.current = nextList;
    selectedIdRef.current = nid;
    setItems(nextList);
    setSelectedId(nid);
    return true;
  };

  const pickProductFromDrawer = (prod: Product) => {
    if (drawerMode === 'swap' && selectedIdRef.current) {
      const sid = selectedIdRef.current;
      const cur = itemsRef.current.find((it) => it.id === sid);
      if (cur) {
        const { halfW, halfD } = parseProductFootprintM(prod.dimensionsCm);
        const { w: rw, d: rd } = roomDimsRef.current;
        const others = getOtherOBBs(sid);
        let nx = cur.x;
        let nz = cur.z;
        let nrot = cur.rot;

        const rotFit = resolveRotateOBB(
          { id: sid, x: cur.x, z: cur.z, rot: cur.rot, halfW, halfD },
          cur.rot,
          others,
          rw,
          rd
        );
        if (rotFit.ok) {
          nx = rotFit.x;
          nz = rotFit.z;
          nrot = rotFit.rot;
        } else {
          const openFit = findOpenSpawnPosition(halfW, halfD, cur.rot, others, rw, rd, [cur.x, cur.z]);
          if (!openFit) {
            showToast(`Bu ürün (${prod.dimensionsCm}) seçili alana sığmıyor`);
            return;
          }
          nx = openFit.x;
          nz = openFit.z;
          nrot = openFit.rot;
        }

        const updated = itemsRef.current.map((it) =>
          it.id === sid
            ? {
                ...it,
                label: prod.name,
                dimensionsCm: prod.dimensionsCm,
                product: prod,
                existingSpec: undefined,
                isScanned: false,
                x: nx,
                z: nz,
                rot: nrot,
                halfW,
                halfD,
              }
            : it
        );
        itemsRef.current = updated;
        setItems(updated);
        showToast(`${prod.name} ile değiştirildi`);
      }
    } else {
      if (!addProductToRoom(prod)) return;
    }
    setDrawerMode(null);
  };

  const saveSnapshot = async () => {
    const s = sceneRef.current;
    if (!s || !roomData) return;
    setSaving(true);
    try {
      const prevFrame = s.selFrame.visible;
      s.selFrame.visible = false;
      s.renderer.render(s.scene, s.camera);

      let url = '';
      if (typeof activeCamIdx === 'number') {
        const cam = roomData.cameras[activeCamIdx];
        const bgUrl = emptyRoom ? cam.cleanPhotoUrl : cam.photoUrl;
        const bgImg = await loadHtmlImage(bgUrl);
        const c = document.createElement('canvas');
        c.width = cam.imageWidth || bgImg.naturalWidth;
        c.height = cam.imageHeight || bgImg.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bgImg, 0, 0, c.width, c.height);
        ctx.drawImage(s.renderer.domElement, 0, 0, c.width, c.height);
        url = c.toDataURL('image/jpeg', 0.92);
      } else {
        url = s.renderer.domElement.toDataURL('image/jpeg', 0.92);
      }

      s.selFrame.visible = prevFrame;
      s.renderer.render(s.scene, s.camera);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3d-odam-${Date.now()}.jpg`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  const visibleItems = items.filter((it) => !it.isScanned || !emptyRoom);
  const hasScannedItems = items.some((it) => it.isScanned);
  const selectedItem = visibleItems.find((i) => i.id === selectedId) || null;
  const activePhotoCam =
    typeof activeCamIdx === 'number' && roomData ? roomData.cameras[activeCamIdx] : null;

  const drawerProducts = products.filter((p) => {
    if (drawerFilter === 'all') return true;
    if (drawerFilter === 'seating') return p.category === 'Kanepe' || p.category === 'Berjer';
    if (drawerFilter === 'tables') return p.category === 'Masa' || p.category === 'Sandalye' || p.category === 'Sehpa';
    if (drawerFilter === 'storage') {
      return p.category === 'Kitaplık' || p.category === 'Raf' || p.category === 'TV Ünitesi' || p.category === 'Yatak';
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 text-white flex flex-col">
      <header className="h-14 px-3 flex items-center justify-between gap-2 border-b border-zinc-800 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold whitespace-nowrap shrink-0">
          <ArrowLeft className="w-4 h-4" />
          <span>Geri</span>
        </button>

        <div className="min-w-0 text-center">
          <p className="text-xs font-bold truncate">
            {step === 'studio' && roomData
              ? `3D Oda (${roomData.roomWidthM.toFixed(1)} × ${roomData.roomDepthM.toFixed(1)} m)`
              : '3D Oda Tasarım Stüdyosu'}
          </p>
          <p className="text-[10px] text-zinc-400 font-mono truncate">
            {selectedItem
              ? `${selectedItem.label} • ${selectedItem.dimensionsCm}`
              : step === 'studio'
              ? `${visibleItems.length} ürün odada • Çarpışma koruması açık`
              : 'Boş oda seçin veya fotoğraf yükleyin'}
          </p>
        </div>

        <div className="w-12 shrink-0" />
      </header>

      {step === 'capture' && (
        <div className="flex-1 overflow-y-auto p-5 flex items-center justify-center">
          <div className="max-w-lg w-full space-y-5">
            <div className="space-y-2 border border-zinc-800 bg-zinc-900/70 rounded-lg p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Hazır Boş 3D Odalar (Anında Başla)
              </p>
              <div className="grid grid-cols-1 gap-2">
                {DEMO_STUDIO_PRESETS.map((preset, idx) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => loadDemoPreset(preset.id)}
                    className="p-3 border border-zinc-700 hover:border-white bg-zinc-950 rounded-lg text-left transition flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                      <span>{String(idx + 1).padStart(2, '0')} • BOŞ ODA</span>
                      <span>{preset.dimensionsLabel}</span>
                    </div>
                    <p className="text-xs font-bold text-white">{preset.title}</p>
                    <p className="text-[11px] text-zinc-400 leading-snug">{preset.subtitle}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 text-center pt-1">
              <h2 className="text-base font-bold">Veya kendi odanızı 4–5 farklı açıdan çekin</h2>
              <p className="text-xs text-zinc-400">
                Her köşeden zemini ve duvarları görecek şekilde 2–6 fotoğraf seçin; tek 360° 3D sahneye dönüşsün.
              </p>
            </div>

            {views.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {views.map((v, idx) => (
                  <div key={v.id} className="relative aspect-[4/3] bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
                    <img src={v.dataUrl} alt={`Açı ${idx + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/75 text-[10px] font-mono rounded">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => setViews((prev) => prev.filter((item) => item.id !== v.id))}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/80 rounded-full flex items-center justify-center text-white"
                      aria-label="Sil"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <label className="py-3.5 px-3 border border-zinc-700 hover:border-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                <Camera className="w-4 h-4" />
                <span>Kamera ile Ekle</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>

              <label className="py-3.5 px-3 border border-zinc-700 hover:border-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                <ImageIcon className="w-4 h-4" />
                <span>Galeriden Çoklu Seç</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={startReconstruction}
              disabled={views.length < 2}
              className="w-full py-4 bg-white text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-500 font-bold text-sm rounded-lg flex items-center justify-center gap-2"
            >
              <span>3D Odayı Modelle ({views.length}/6 Açı)</span>
            </button>
          </div>
        </div>
      )}

      {step === 'reconstructing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
          <p className="text-sm font-semibold">{views.length} açı birleştirilip 3D oda kuruluyor...</p>
          <p className="text-xs text-zinc-400 max-w-xs">
            Depth Pro, SIFT+Manhattan hizalama ve LaMa temizleme ile boş zemin ve 4 duvar hazırlanıyor.
          </p>
        </div>
      )}

      {step === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-red-300 max-w-xs">{error}</p>
          <button
            onClick={() => {
              setError('');
              setStep('capture');
            }}
            className="px-5 py-3 bg-white text-zinc-950 rounded-lg text-sm font-bold"
          >
            Fotoğraflara Dön
          </button>
        </div>
      )}

      {step === 'studio' && roomData && (
        <>
          {/* Üst Kamera & Oda Ölçü Sekmeleri */}
          <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
            <button
              onClick={() => setActiveCamIdx('free')}
              className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                activeCamIdx === 'free' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Serbest 3D
            </button>
            <button
              onClick={() => setActiveCamIdx('top')}
              className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                activeCamIdx === 'top' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Kuşbakışı
            </button>
            {roomData.cameras.map((cam) => (
              <button
                key={cam.index}
                onClick={() => {
                  setShowSizeBar(false);
                  setActiveCamIdx(cam.index);
                }}
                className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                  activeCamIdx === cam.index ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {cam.label}
              </button>
            ))}

            {typeof activeCamIdx !== 'number' && (
              <>
                <span className="h-4 w-px bg-zinc-700 mx-1 shrink-0" />
                <button
                  onClick={() => {
                    setShowClipBar(false);
                    setShowSizeBar((v) => !v);
                  }}
                  className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    showSizeBar ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-200'
                  }`}
                >
                  <Ruler className="w-3 h-3" />
                  <span>
                    Ölçü: {roomData.roomWidthM.toFixed(1)}×{roomData.roomDepthM.toFixed(1)}m
                  </span>
                </button>
              </>
            )}
          </div>

          {/* 3D Sahne / Gerçek Fotoğraf Açısı */}
          <div ref={stageRef} className="relative flex-1 min-h-0 flex items-center justify-center bg-zinc-950 overflow-hidden">
            <div
              className="relative"
              style={
                activePhotoCam && disp.w > 0
                  ? { width: disp.w, height: disp.h }
                  : { width: '100%', height: '100%' }
              }
            >
              {activePhotoCam && (
                <img
                  src={emptyRoom ? activePhotoCam.cleanPhotoUrl : activePhotoCam.photoUrl}
                  alt={activePhotoCam.label}
                  className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none"
                />
              )}
              <div
                ref={hostRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onPointerDownCapture={onPointerDownCapture}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>

            {loadingCount > 0 && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 border border-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 pointer-events-none">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>Mobilya yükleniyor...</span>
              </div>
            )}

            {/* Boş Oda Başlangıç Hızlı Ekleme Paneli */}
            {visibleItems.length === 0 && !drawerMode && !showClipBar && !showSizeBar && (
              <div className="absolute bottom-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-max bg-zinc-950/92 border border-zinc-700 rounded-lg px-3.5 py-2.5 flex flex-col sm:flex-row items-center gap-2.5 shadow-xl z-20">
                <span className="text-xs text-zinc-200 font-medium">
                  Boş oda hazır — mobilya ekleyin ve sürükleyip yerleştirin
                </span>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => addProductToRoom(product)}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-white text-zinc-950 rounded text-xs font-bold whitespace-nowrap"
                  >
                    + {product.name.split(' ')[0]} Ekle
                  </button>
                  <button
                    onClick={() => setDrawerMode('add')}
                    className="flex-1 sm:flex-initial px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs font-semibold whitespace-nowrap"
                  >
                    Katalog ({products.length})
                  </button>
                </div>
              </div>
            )}

            {/* Oda Ölçü Ayarı Popover */}
            {showSizeBar && (
              <div className="absolute top-3 left-3 right-3 sm:left-auto sm:w-80 bg-zinc-950/95 border border-zinc-700 rounded-lg p-3 space-y-2.5 z-20 shadow-xl">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">Oda Ölçülerini Ayarla</span>
                  <button onClick={() => setShowSizeBar(false)} className="text-zinc-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">En (metre)</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateRoomDimensions(roomData.roomWidthM - 0.4, roomData.roomDepthM)}
                        className="w-7 h-7 bg-zinc-800 rounded font-bold"
                      >
                        −
                      </button>
                      <span className="flex-1 text-center font-mono font-bold">{roomData.roomWidthM.toFixed(1)} m</span>
                      <button
                        onClick={() => updateRoomDimensions(roomData.roomWidthM + 0.4, roomData.roomDepthM)}
                        className="w-7 h-7 bg-zinc-800 rounded font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-zinc-400 block">Boy (metre)</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateRoomDimensions(roomData.roomWidthM, roomData.roomDepthM - 0.4)}
                        className="w-7 h-7 bg-zinc-800 rounded font-bold"
                      >
                        −
                      </button>
                      <span className="flex-1 text-center font-mono font-bold">{roomData.roomDepthM.toFixed(1)} m</span>
                      <button
                        onClick={() => updateRoomDimensions(roomData.roomWidthM, roomData.roomDepthM + 0.4)}
                        className="w-7 h-7 bg-zinc-800 rounded font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showClipBar && (
              <div className="absolute bottom-3 left-3 right-3 bg-zinc-950/95 border border-zinc-700 rounded-lg p-3 space-y-2 z-20">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold">3D Oda Kesiti Al</span>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'none', label: 'Kapalı' },
                        { id: 'y', label: 'Yükseklik' },
                        { id: 'x', label: 'Sol–Sağ' },
                        { id: 'z', label: 'Ön–Arka' },
                      ] as const
                    ).map((ax) => (
                      <button
                        key={ax.id}
                        onClick={() => setClipAxis(ax.id)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold ${
                          clipAxis === ax.id ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {ax.label}
                      </button>
                    ))}
                  </div>
                </div>
                {clipAxis !== 'none' && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-400 font-mono w-10">%{clipPct}</span>
                    <input
                      type="range"
                      min={15}
                      max={100}
                      value={clipPct}
                      onChange={(e) => setClipPct(Number(e.target.value))}
                      className="flex-1 accent-white"
                    />
                  </div>
                )}
              </div>
            )}

            {toastMsg && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-black/90 border border-zinc-700 px-3.5 py-2 rounded-lg text-xs font-medium text-white shadow-xl pointer-events-none whitespace-nowrap z-30">
                {toastMsg}
              </div>
            )}

            {drawerMode && (
              <div className="absolute bottom-0 left-0 right-0 z-30 bg-zinc-900/98 border-t border-zinc-700 p-3 space-y-2.5 shadow-2xl">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white shrink-0">
                    {drawerMode === 'swap' ? 'Seçili Ürünü Değiştir' : `Odaya Ürün Ekle (${drawerProducts.length})`}
                  </span>
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {(
                      [
                        { id: 'all', label: 'Tümü' },
                        { id: 'seating', label: 'Koltuk' },
                        { id: 'tables', label: 'Masa' },
                        { id: 'storage', label: 'Dolap & Yatak' },
                      ] as const
                    ).map((flt) => (
                      <button
                        key={flt.id}
                        onClick={() => setDrawerFilter(flt.id)}
                        className={`px-2 py-1 rounded text-[10px] font-semibold whitespace-nowrap ${
                          drawerFilter === flt.id ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {flt.label}
                      </button>
                    ))}
                    <button onClick={() => setDrawerMode(null)} className="p-1 text-zinc-400 hover:text-white shrink-0" aria-label="Kapat">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {drawerProducts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => pickProductFromDrawer(p)}
                      className="w-36 shrink-0 border border-zinc-700 hover:border-white bg-zinc-950 rounded-lg p-2 text-left transition flex flex-col justify-between gap-1.5"
                    >
                      {p.thumbUrl ? (
                        <img src={p.thumbUrl} alt={p.name} className="w-full h-20 object-contain bg-zinc-100 rounded" />
                      ) : (
                        <div className="w-full h-20 bg-zinc-800 rounded flex items-center justify-center text-[10px] font-mono text-zinc-400">
                          {p.dimensionsCm}
                        </div>
                      )}
                      <div>
                        <p className="text-[11px] font-bold text-white leading-tight line-clamp-2">{p.name}</p>
                        <p className="text-[10px] font-mono text-zinc-400 mt-0.5">{p.dimensionsCm}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2 Satırlı Kompakt Mobil Alt Kontroller */}
          <div className="shrink-0 border-t border-zinc-800 p-2 space-y-1.5 bg-zinc-950">
            {/* Satır 1: Oda & Sahne Araçları */}
            <div className="flex items-center gap-1.5 text-[11px]">
              {hasScannedItems && (
                <button
                  onClick={() => {
                    setDrawerMode(null);
                    setShowClipBar(false);
                    setEmptyRoom((v) => !v);
                  }}
                  className={`flex-1 py-2 px-2 rounded-lg font-semibold flex items-center justify-center gap-1 whitespace-nowrap ${
                    !emptyRoom ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-200'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>{emptyRoom ? 'Eski Eşyaları Aç' : 'Eski Eşyaları Gizle'}</span>
                </button>
              )}

              <button
                onClick={() => {
                  setDrawerMode(null);
                  setShowSizeBar(false);
                  setShowClipBar((v) => !v);
                }}
                className={`flex-1 py-2 px-2 rounded-lg font-semibold flex items-center justify-center gap-1 whitespace-nowrap ${
                  showClipBar || clipAxis !== 'none' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-200'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 shrink-0" />
                <span>Odayı Kes</span>
              </button>

              <button
                onClick={() =>
                  setWallMode((m) => (m === 'auto' ? 'all' : m === 'all' ? 'floor' : 'auto'))
                }
                disabled={typeof activeCamIdx === 'number'}
                className="flex-1 py-2 px-2 rounded-lg bg-zinc-800 text-zinc-200 disabled:opacity-40 font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>{wallMode === 'auto' ? 'Duvar: Akıllı' : wallMode === 'all' ? '4 Duvar' : 'Sadece Zemin'}</span>
              </button>

              <button
                onClick={clearRoom}
                disabled={visibleItems.length === 0}
                className="flex-1 py-2 px-2 rounded-lg bg-zinc-800 text-zinc-200 disabled:opacity-35 font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Odayı Boşalt</span>
              </button>
            </div>

            {/* Satır 2: Ürün Araçları */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                onClick={() => {
                  setShowClipBar(false);
                  setShowSizeBar(false);
                  setDrawerMode((m) => (m === 'add' ? null : 'add'));
                }}
                className={`flex-1 py-2.5 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1 whitespace-nowrap ${
                  drawerMode === 'add' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>Ekle</span>
              </button>

              <button
                onClick={() => {
                  setShowClipBar(false);
                  setShowSizeBar(false);
                  setDrawerMode((m) => (m === 'swap' ? null : 'swap'));
                }}
                disabled={!selectedItem}
                className={`flex-1 py-2.5 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1 disabled:opacity-40 whitespace-nowrap ${
                  drawerMode === 'swap' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-200'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>Değiştir</span>
              </button>

              <button
                onClick={() => rotateBy(-15)}
                disabled={!selectedItem}
                className="p-2.5 rounded-lg bg-zinc-800 disabled:opacity-40 shrink-0"
                aria-label="Sola döndür"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => rotateBy(15)}
                disabled={!selectedItem}
                className="p-2.5 rounded-lg bg-zinc-800 disabled:opacity-40 shrink-0"
                aria-label="Sağa döndür"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => rotateBy(90)}
                disabled={!selectedItem}
                className="px-2 py-2.5 rounded-lg bg-zinc-800 disabled:opacity-40 text-[11px] font-mono font-bold shrink-0"
                aria-label="90 derece çevir"
              >
                90°
              </button>

              <button
                onClick={removeSelected}
                disabled={!selectedItem}
                className="p-2.5 rounded-lg bg-zinc-800 text-red-300 disabled:opacity-35 shrink-0"
                aria-label="Sil"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                onClick={saveSnapshot}
                disabled={saving}
                className="px-3 py-2.5 rounded-lg bg-white text-zinc-950 font-bold flex items-center justify-center gap-1 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Kaydet</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
