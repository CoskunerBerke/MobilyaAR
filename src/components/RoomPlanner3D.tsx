import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ArrowLeft,
  Camera,
  CopyPlus,
  Download,
  Eye,
  Grid3X3,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Product } from '../lib/products';
import {
  buildCustomFloorTexture,
  buildCustomWallTexture,
  type DemoStudioPresetId,
  type FloorSurfaceKind,
} from '../lib/demoRooms';
import { convertCadFileToGlb } from '../lib/cadImport';
import {
  clampToRoomWalls,
  findOpenSpawnPosition,
  getWorldAABBSpan,
  parseProductFootprintM,
  resolveMoveOBB,
  resolveRotateOBB,
  type OBB2D,
} from '../lib/collision2d';
import { buildContactShadow } from '../lib/contactShadow';
import { loadThreeTexture, preparePhotorealMaterial } from '../lib/roomRendering';

interface Props {
  initialProduct?: Product;
  products: Product[];
  initialPreset?: DemoStudioPresetId;
  onAddCustomProduct?: (product: Product) => void;
  onOpenProductAR: (product: Product) => void;
  onOpenAiBuilder?: () => void;
  onBack: () => void;
}

interface PlacedItem3D {
  id: string;
  product: Product;
  x: number;
  z: number;
  rot: number;
  halfW: number;
  halfD: number;
}

type CamPreset = 'free' | 'top' | 'inside';
type DrawerFilter = 'all' | 'seating' | 'tables' | 'storage' | 'custom';

interface RoomTemplate {
  id: DemoStudioPresetId;
  title: string;
  w: number;
  d: number;
  ch: number;
  floorId: FloorPresetId;
  wallId: WallPresetId;
  hasRug: boolean;
}

type FloorPresetId = 'oak' | 'walnut' | 'travertine' | 'concrete';
type WallPresetId = 'ivory' | 'stone' | 'sage' | 'charcoal';

const FLOOR_PRESETS: Record<
  FloorPresetId,
  { label: string; kind: FloorSurfaceKind; rgb: [number, number, number]; swatch: string }
> = {
  oak: { label: 'Meşe Parke', kind: 'wood', rgb: [196, 168, 134], swatch: '#c4a886' },
  walnut: { label: 'Ceviz Parke', kind: 'wood', rgb: [134, 102, 76], swatch: '#86664c' },
  travertine: { label: 'Traverten', kind: 'tile', rgb: [222, 216, 204], swatch: '#ded8cc' },
  concrete: { label: 'Minimal Beton', kind: 'matte', rgb: [198, 196, 191], swatch: '#c6c4bf' },
};

const WALL_PRESETS: Record<WallPresetId, { label: string; rgb: [number, number, number]; swatch: string }> = {
  ivory: { label: 'Kırık Beyaz', rgb: [242, 240, 234], swatch: '#f2f0ea' },
  stone: { label: 'Sıcak Taş', rgb: [224, 218, 208], swatch: '#e0dad0' },
  sage: { label: 'Adaçayı', rgb: [208, 216, 205], swatch: '#d0d8cd' },
  charcoal: { label: 'Antrasit', rgb: [112, 110, 106], swatch: '#706e6a' },
};

const ROOM_TEMPLATES: RoomTemplate[] = [
  { id: 'living', title: 'Modern Salon', w: 4.6, d: 5.2, ch: 2.7, floorId: 'oak', wallId: 'ivory', hasRug: true },
  { id: 'bedroom', title: 'Yatak & Çalışma', w: 3.6, d: 4.2, ch: 2.65, floorId: 'oak', wallId: 'stone', hasRug: false },
  { id: 'grand', title: 'Geniş Salon', w: 5.6, d: 6.4, ch: 2.8, floorId: 'travertine', wallId: 'ivory', hasRug: true },
];

export const RoomPlanner3D: React.FC<Props> = ({
  initialProduct,
  products,
  initialPreset = 'living',
  onAddCustomProduct,
  onOpenProductAR,
  onOpenAiBuilder,
  onBack,
}) => {
  const startTpl = ROOM_TEMPLATES.find((t) => t.id === initialPreset) || ROOM_TEMPLATES[0];

  const [roomW, setRoomW] = useState(startTpl.w);
  const [roomD, setRoomD] = useState(startTpl.d);
  const [ceilingH, setCeilingH] = useState(startTpl.ch);
  const [floorId, setFloorId] = useState<FloorPresetId>(startTpl.floorId);
  const [wallId, setWallId] = useState<WallPresetId>(startTpl.wallId);
  const [hasRug, setHasRug] = useState(startTpl.hasRug);
  const [showGrid, setShowGrid] = useState(true);

  const [camPreset, setCamPreset] = useState<CamPreset>('free');
  const [showRoomPanel, setShowRoomPanel] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'add' | 'swap' | null>(null);
  const [drawerFilter, setDrawerFilter] = useState<DrawerFilter>('all');

  const [items, setItems] = useState<PlacedItem3D[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploadingCad, setUploadingCad] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<PlacedItem3D[]>([]);
  itemsRef.current = items;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const camPresetRef = useRef<CamPreset>('free');
  camPresetRef.current = camPreset;
  const dimsRef = useRef({ w: roomW, d: roomD, ch: ceilingH });
  dimsRef.current = { w: roomW, d: roomD, ch: ceilingH };

  const dragRef = useRef<{ id: string; hx: number; hz: number; px: number; pz: number } | null>(null);
  const hitWallRef = useRef(false);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rafId: number;
    itemsRoot: THREE.Group;
    roomRoot: THREE.Group;
    gridHelper: THREE.LineSegments | null;
    walls: Array<{
      side: 'north' | 'south' | 'west' | 'east';
      mesh: THREE.Mesh;
      inwardNormal: THREE.Vector3;
      center: THREE.Vector3;
    }>;
    selFrame: THREE.LineLoop;
    selMat: THREE.LineBasicMaterial;
    gltfCache: Map<string, THREE.Group>;
    groups: Map<string, { url: string; root: THREE.Group }>;
    loadingKeys: Set<string>;
    disposeTextures: Array<() => void>;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 2800);
  }, []);

  const toOBB = (it: PlacedItem3D): OBB2D => ({
    id: it.id,
    x: it.x,
    z: it.z,
    rot: it.rot,
    halfW: it.halfW,
    halfD: it.halfD,
  });

  // Başlangıçta seçili ürünü odaya düzenli şekilde yerleştir
  useEffect(() => {
    const startProd = initialProduct || products[0];
    if (!startProd) return;
    const fp = parseProductFootprintM(startProd.dimensionsCm);
    const placed: PlacedItem3D = {
      id: `item-${Date.now()}`,
      product: startProd,
      x: 0,
      z: -Math.min(1.1, Math.max(0.3, startTpl.d * 0.5 - fp.halfD - 0.35)),
      rot: 0,
      halfW: fp.halfW,
      halfD: fp.halfD,
    };
    setItems([placed]);
    setSelectedId(placed.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oda boyutu değiştiğinde eşyaları güvenli şekilde yeni duvar sınırları içine al
  useEffect(() => {
    setItems((prev) =>
      prev.map((it) => {
        const clamped = clampToRoomWalls(it.x, it.z, it.rot, it.halfW, it.halfD, roomW, roomD, 0.02);
        return { ...it, x: clamped.x, z: clamped.z };
      })
    );
  }, [roomW, roomD]);

  // 1) Ana Three.js sahnesini bir kez kur
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight - 160;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeae7e0);

    const camera = new THREE.PerspectiveCamera(44, w / Math.max(1, h), 0.08, 60);
    camera.position.set(4.8, 4.3, 5.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 1.1;
    controls.maxDistance = 16;
    controls.target.set(0, 0.55, 0);
    controls.update();

    // Sıcak doğal showroom aydınlatması
    const hemi = new THREE.HemisphereLight(0xfffdf8, 0xcac3b6, 1.05);
    scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xfff9ee, 1.25);
    dirLight.position.set(4.5, 7.5, 4.0);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 24;
    const sBound = 6.5;
    dirLight.shadow.camera.left = -sBound;
    dirLight.shadow.camera.right = sBound;
    dirLight.shadow.camera.top = sBound;
    dirLight.shadow.camera.bottom = -sBound;
    dirLight.shadow.bias = -0.0004;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xeef4ff, 0.42);
    fillLight.position.set(-4.5, 3.8, -3.5);
    scene.add(fillLight);

    const roomRoot = new THREE.Group();
    scene.add(roomRoot);

    const itemsRoot = new THREE.Group();
    scene.add(itemsRoot);

    // Seçili eşya taban çerçevesi
    const framePts = [
      new THREE.Vector3(-0.5, 0.015, -0.5),
      new THREE.Vector3(0.5, 0.015, -0.5),
      new THREE.Vector3(0.5, 0.015, 0.5),
      new THREE.Vector3(-0.5, 0.015, 0.5),
    ];
    const selGeo = new THREE.BufferGeometry().setFromPoints(framePts);
    const selMat = new THREE.LineBasicMaterial({ color: 0x111110 });
    const selFrame = new THREE.LineLoop(selGeo, selMat);
    selFrame.visible = false;
    scene.add(selFrame);

    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const state = {
      renderer,
      scene,
      camera,
      controls,
      rafId: 0,
      itemsRoot,
      roomRoot,
      gridHelper: null as THREE.LineSegments | null,
      walls: [] as Array<{
        side: 'north' | 'south' | 'west' | 'east';
        mesh: THREE.Mesh;
        inwardNormal: THREE.Vector3;
        center: THREE.Vector3;
      }>,
      selFrame,
      selMat,
      gltfCache: new Map<string, THREE.Group>(),
      groups: new Map<string, { url: string; root: THREE.Group }>(),
      loadingKeys: new Set<string>(),
      disposeTextures: [] as Array<() => void>,
    };
    sceneRef.current = state;

    const toCam = new THREE.Vector3();
    const animate = () => {
      state.rafId = requestAnimationFrame(animate);
      controls.update();

      // IKEA tarzı otomatik duvar gizleme: kameranın arkasında kalan duvarlar görünür, önündeki açılır
      for (const wall of state.walls) {
        if (camPresetRef.current === 'inside') {
          wall.mesh.visible = true;
        } else if (camPresetRef.current === 'top') {
          wall.mesh.visible = true;
        } else {
          toCam.subVectors(camera.position, wall.center);
          wall.mesh.visible = toCam.dot(wall.inwardNormal) > 0.05;
        }
      }

      // Seçim çerçevesini güncelle
      const sel = itemsRef.current.find((i) => i.id === selectedIdRef.current);
      if (sel) {
        selFrame.visible = true;
        selFrame.position.set(sel.x, 0, sel.z);
        selFrame.rotation.y = sel.rot;
        selFrame.scale.set(sel.halfW * 2 + 0.08, 1, sel.halfD * 2 + 0.08);
        selMat.color.setHex(hitWallRef.current ? 0xdc2626 : 0x111110);
      } else {
        selFrame.visible = false;
      }

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!hostRef.current) return;
      const nw = hostRef.current.clientWidth || window.innerWidth;
      const nh = hostRef.current.clientHeight || window.innerHeight - 160;
      camera.aspect = nw / Math.max(1, nh);
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(state.rafId);
      state.disposeTextures.forEach((fn) => fn());
      controls.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
  }, []);

  // 2) Oda duvarlarını, zeminini ve 1m ızgarayı ölçüler/doku değiştikçe güncelle
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    let cancelled = false;

    const clearRoom = () => {
      s.disposeTextures.forEach((fn) => fn());
      s.disposeTextures = [];
      while (s.roomRoot.children.length > 0) {
        const ch = s.roomRoot.children[0];
        s.roomRoot.remove(ch);
        ch.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mt) => mt.dispose());
          }
        });
      }
      s.walls = [];
      s.gridHelper = null;
    };

    (async () => {
      const fSpec = FLOOR_PRESETS[floorId];
      const wSpec = WALL_PRESETS[wallId];

      const floorUrl = buildCustomFloorTexture(fSpec.kind, fSpec.rgb, {
        rugColor: hasRug ? '#e8e3d9' : undefined,
        rugBorder: hasRug ? 'rgba(60,55,48,0.16)' : undefined,
        herringbone: floorId === 'oak',
      });
      const northWallUrl = buildCustomWallTexture(wSpec.rgb, { windowSpan: [0.28, 0.72] });
      const plainWallUrl = buildCustomWallTexture(wSpec.rgb);

      const [floorTex, northTex, plainTex] = await Promise.all([
        loadThreeTexture(floorUrl),
        loadThreeTexture(northWallUrl),
        loadThreeTexture(plainWallUrl),
      ]);
      if (cancelled) {
        floorTex.dispose();
        northTex.dispose();
        plainTex.dispose();
        return;
      }

      clearRoom();
      s.disposeTextures.push(
        () => floorTex.dispose(),
        () => northTex.dispose(),
        () => plainTex.dispose()
      );

      // Zemin
      const floorMat = new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: fSpec.kind === 'tile' ? 0.38 : 0.72,
        metalness: 0.04,
      });
      const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      s.roomRoot.add(floorMesh);

      // Alt mimari döşeme kalınlığı (IKEA maket tabanı hissi)
      const slabMat = new THREE.MeshStandardMaterial({ color: 0xd6d2c9, roughness: 0.9 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(roomW + 0.16, 0.12, roomD + 0.16), slabMat);
      slab.position.y = -0.065;
      s.roomRoot.add(slab);

      // 4 Duvar (kuzeyde geniş gün ışığı penceresi)
      const makeWallMat = (tex: THREE.Texture) =>
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.02 });

      const wallConfigs: Array<{
        side: 'north' | 'south' | 'west' | 'east';
        w: number;
        pos: [number, number, number];
        rotY: number;
        inward: [number, number, number];
        tex: THREE.Texture;
      }> = [
        {
          side: 'north',
          w: roomW,
          pos: [0, ceilingH / 2, -roomD / 2],
          rotY: 0,
          inward: [0, 0, 1],
          tex: northTex,
        },
        {
          side: 'south',
          w: roomW,
          pos: [0, ceilingH / 2, roomD / 2],
          rotY: Math.PI,
          inward: [0, 0, -1],
          tex: plainTex,
        },
        {
          side: 'west',
          w: roomD,
          pos: [-roomW / 2, ceilingH / 2, 0],
          rotY: Math.PI / 2,
          inward: [1, 0, 0],
          tex: plainTex,
        },
        {
          side: 'east',
          w: roomD,
          pos: [roomW / 2, ceilingH / 2, 0],
          rotY: -Math.PI / 2,
          inward: [-1, 0, 0],
          tex: plainTex,
        },
      ];

      for (const wc of wallConfigs) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wc.w, ceilingH), makeWallMat(wc.tex));
        mesh.position.set(...wc.pos);
        mesh.rotation.y = wc.rotY;
        mesh.receiveShadow = true;
        s.roomRoot.add(mesh);
        s.walls.push({
          side: wc.side,
          mesh,
          inwardNormal: new THREE.Vector3(...wc.inward),
          center: new THREE.Vector3(...wc.pos),
        });
      }

      // 50 cm / 1 m mimari zemin ızgarası
      const gridVerts: number[] = [];
      const halfW = roomW / 2;
      const halfD = roomD / 2;
      const step = 0.5;
      for (let x = -Math.floor(halfW / step) * step; x <= halfW + 1e-4; x += step) {
        gridVerts.push(x, 0.004, -halfD, x, 0.004, halfD);
      }
      for (let z = -Math.floor(halfD / step) * step; z <= halfD + 1e-4; z += step) {
        gridVerts.push(-halfW, 0.004, z, halfW, 0.004, z);
      }
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
      const gridMat = new THREE.LineBasicMaterial({
        color: 0x3f3d38,
        transparent: true,
        opacity: 0.14,
      });
      const gridLines = new THREE.LineSegments(gridGeo, gridMat);
      gridLines.visible = showGrid;
      s.roomRoot.add(gridLines);
      s.gridHelper = gridLines;
    })();

    return () => {
      cancelled = true;
    };
  }, [roomW, roomD, ceilingH, floorId, wallId, hasRug, showGrid]);

  // 3) Kamera açı önayarlarını uygula
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const maxSpan = Math.max(roomW, roomD);
    if (camPreset === 'top') {
      s.camera.position.set(0, maxSpan * 1.48, 0.01);
      s.controls.target.set(0, 0, 0);
      s.controls.maxPolarAngle = Math.PI * 0.49;
    } else if (camPreset === 'inside') {
      s.camera.position.set(0, 1.52, roomD * 0.44);
      s.controls.target.set(0, 0.85, -roomD * 0.35);
      s.controls.maxPolarAngle = Math.PI * 0.62;
    } else {
      s.camera.position.set(roomW * 0.92, Math.max(3.6, maxSpan * 0.82), roomD * 0.96);
      s.controls.target.set(0, 0.55, 0);
      s.controls.maxPolarAngle = Math.PI * 0.49;
    }
    s.controls.update();
  }, [camPreset, roomW, roomD]);

  // 4) Yerleştirilen mobilyaları Three.js sahnesiyle senkronize et
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const loader = new GLTFLoader();

    const activeIds = new Set(items.map((it) => it.id));
    for (const [id, entry] of s.groups.entries()) {
      if (!activeIds.has(id)) {
        s.itemsRoot.remove(entry.root);
        s.groups.delete(id);
      }
    }

    const mountModel = (it: PlacedItem3D, template: THREE.Group) => {
      const cur = sceneRef.current;
      if (!cur) return;
      if (!itemsRef.current.some((x) => x.id === it.id && x.product.glbUrl === it.product.glbUrl)) {
        return;
      }
      const existing = cur.groups.get(it.id);
      if (existing) {
        cur.itemsRoot.remove(existing.root);
      }
      const root = new THREE.Group();
      root.userData.itemId = it.id;
      const clone = template.clone(true);
      const maxAniso = Math.min(8, cur.renderer.capabilities.getMaxAnisotropy());
      const isFabric = it.product.category === 'Kanepe' || it.product.category === 'Berjer' || it.product.category === 'Yatak';
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.itemId = it.id;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => {
            if (m) preparePhotorealMaterial(m, maxAniso, isFabric);
          });
        }
      });
      root.add(clone);

      try {
        const shadow = buildContactShadow(clone);
        shadow.userData.itemId = it.id;
        root.add(shadow);
      } catch {
        /* ignore shadow fallback */
      }

      const live = itemsRef.current.find((x) => x.id === it.id) || it;
      root.position.set(live.x, 0, live.z);
      root.rotation.y = live.rot;
      cur.itemsRoot.add(root);
      cur.groups.set(it.id, { url: it.product.glbUrl, root });
    };

    for (const it of items) {
      const curEntry = s.groups.get(it.id);
      if (curEntry && curEntry.url === it.product.glbUrl) {
        curEntry.root.position.set(it.x, 0, it.z);
        curEntry.root.rotation.y = it.rot;
        continue;
      }

      const cached = s.gltfCache.get(it.product.glbUrl);
      if (cached) {
        mountModel(it, cached);
        continue;
      }

      const loadKey = `${it.id}::${it.product.glbUrl}`;
      if (s.loadingKeys.has(loadKey)) continue;
      s.loadingKeys.add(loadKey);
      setLoadingCount((c) => c + 1);

      loader.load(
        it.product.glbUrl,
        (gltf) => {
          const cur = sceneRef.current;
          if (!cur) return;
          cur.loadingKeys.delete(loadKey);
          setLoadingCount((c) => Math.max(0, c - 1));

          // Taban y=0 ve X/Z merkez güvencesi
          const wrap = new THREE.Group();
          wrap.add(gltf.scene);
          wrap.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(wrap);
          const center = new THREE.Vector3();
          box.getCenter(center);
          gltf.scene.position.x -= center.x;
          gltf.scene.position.y -= box.min.y;
          gltf.scene.position.z -= center.z;
          wrap.updateMatrixWorld(true);

          cur.gltfCache.set(it.product.glbUrl, wrap);
          mountModel(it, wrap);
        },
        undefined,
        () => {
          const cur = sceneRef.current;
          if (cur) cur.loadingKeys.delete(loadKey);
          setLoadingCount((c) => Math.max(0, c - 1));
          showToast(`${it.product.name} yüklenemedi`);
        }
      );
    }
  }, [items, showToast]);

  // Raycast yardımcısı: zemin (y=0) düzlemine nokta çıkar
  const raycastFloor = (clientX: number, clientY: number): THREE.Vector3 | null => {
    const s = sceneRef.current;
    if (!s) return null;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, s.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  };

  const findHitItemId = (clientX: number, clientY: number): string | null => {
    const s = sceneRef.current;
    if (!s) return null;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, s.camera);
    const hits = ray.intersectObjects(s.itemsRoot.children, true);
    for (const h of hits) {
      let cur: THREE.Object3D | null = h.object;
      while (cur) {
        if (typeof cur.userData?.itemId === 'string') {
          return cur.userData.itemId;
        }
        cur = cur.parent;
      }
    }
    return null;
  };

  const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = sceneRef.current;
    if (!s) return;
    const hitId = findHitItemId(e.clientX, e.clientY);
    if (!hitId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(hitId);
    const pt = raycastFloor(e.clientX, e.clientY);
    const it = itemsRef.current.find((x) => x.id === hitId);
    if (pt && it) {
      dragRef.current = { id: hitId, hx: pt.x, hz: pt.z, px: it.x, pz: it.z };
      s.controls.enabled = false;
      hitWallRef.current = false;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const s = sceneRef.current;
    if (!d || !s) return;
    const pt = raycastFloor(e.clientX, e.clientY);
    if (!pt) return;
    const it = itemsRef.current.find((x) => x.id === d.id);
    if (!it) return;

    const targetX = d.px + (pt.x - d.hx);
    const targetZ = d.pz + (pt.z - d.hz);
    const others = itemsRef.current.filter((x) => x.id !== d.id).map(toOBB);
    const resolved = resolveMoveOBB(toOBB(it), targetX, targetZ, others, dimsRef.current.w, dimsRef.current.d);
    hitWallRef.current = resolved.hitObstacle;

    const grp = s.groups.get(d.id);
    if (grp) {
      grp.root.position.set(resolved.x, 0, resolved.z);
    }
    setItems((prev) =>
      prev.map((x) => (x.id === d.id ? { ...x, x: resolved.x, z: resolved.z } : x))
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      hitWallRef.current = false;
      if (sceneRef.current) sceneRef.current.controls.enabled = true;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const addProductToRoom = (p: Product) => {
    const fp = parseProductFootprintM(p.dimensionsCm);
    const others = itemsRef.current.map(toOBB);
    const pos = findOpenSpawnPosition(fp.halfW, fp.halfD, 0, others, roomW, roomD, [0, 0]);
    if (!pos) {
      showToast('Oda dolu — önce bir eşyayı kaydırın veya oda ölçüsünü genişletin');
      return;
    }
    const created: PlacedItem3D = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      product: p,
      x: pos.x,
      z: pos.z,
      rot: pos.rot,
      halfW: fp.halfW,
      halfD: fp.halfD,
    };
    setItems((prev) => [...prev, created]);
    setSelectedId(created.id);
    setDrawerMode(null);
    showToast(`${p.name} eklendi — sürükleyip düzenleyebilirsiniz`);
  };

  const swapSelectedProduct = (p: Product) => {
    const sel = itemsRef.current.find((x) => x.id === selectedIdRef.current);
    if (!sel) {
      addProductToRoom(p);
      return;
    }
    const fp = parseProductFootprintM(p.dimensionsCm);
    const others = itemsRef.current.filter((x) => x.id !== sel.id).map(toOBB);
    const pos = findOpenSpawnPosition(fp.halfW, fp.halfD, sel.rot, others, roomW, roomD, [sel.x, sel.z]);
    if (!pos) {
      showToast('Bu ürün bu noktaya sığmıyor — önce etrafı açın');
      return;
    }
    setItems((prev) =>
      prev.map((x) =>
        x.id === sel.id
          ? { ...x, product: p, x: pos.x, z: pos.z, rot: pos.rot, halfW: fp.halfW, halfD: fp.halfD }
          : x
      )
    );
    setDrawerMode(null);
  };

  const rotateSelected = (deg: number) => {
    const sel = itemsRef.current.find((x) => x.id === selectedIdRef.current);
    if (!sel) return;
    const nextRot = sel.rot + (deg * Math.PI) / 180;
    const others = itemsRef.current.filter((x) => x.id !== sel.id).map(toOBB);
    const res = resolveRotateOBB(toOBB(sel), nextRot, others, roomW, roomD);
    if (!res.ok) {
      showToast('Döndürmek için duvar veya diğer eşyalardan biraz uzaklaştırın');
      return;
    }
    setItems((prev) =>
      prev.map((x) => (x.id === sel.id ? { ...x, x: res.x, z: res.z, rot: res.rot } : x))
    );
  };

  const duplicateSelected = () => {
    const sel = itemsRef.current.find((x) => x.id === selectedIdRef.current);
    if (!sel) return;
    addProductToRoom(sel.product);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setItems((prev) => prev.filter((x) => x.id !== selectedId));
    setSelectedId(null);
  };

  // IKEA tarzı tek tık örnek salon kurgusu
  const populateSampleLayout = () => {
    const pick = (id: string) => products.find((p) => p.id === id);
    const specs: Array<{ p?: Product; x: number; z: number; rot: number }> = [
      { p: pick('ikea-landskrona-sofa') || products[0], x: 0, z: -roomD * 0.5 + 0.65, rot: 0 },
      { p: pick('ikea-stockholm-coffee'), x: 0, z: -roomD * 0.5 + 1.85, rot: 0 },
      { p: pick('ikea-strandmon-chair'), x: Math.min(roomW * 0.5 - 0.65, 1.55), z: -0.1, rot: -Math.PI * 0.62 },
      { p: pick('ikea-hemnes-tv'), x: 0, z: roomD * 0.5 - 0.42, rot: Math.PI },
      { p: pick('ikea-billy-bookcase'), x: -roomW * 0.5 + 0.35, z: -roomD * 0.5 + 1.15, rot: Math.PI / 2 },
    ];
    const placed: PlacedItem3D[] = [];
    for (const sp of specs) {
      if (!sp.p) continue;
      const fp = parseProductFootprintM(sp.p.dimensionsCm);
      const others = placed.map(toOBB);
      const pos = findOpenSpawnPosition(fp.halfW, fp.halfD, sp.rot, others, roomW, roomD, [sp.x, sp.z]);
      if (pos) {
        placed.push({
          id: `sample-${sp.p.id}-${Date.now()}-${placed.length}`,
          product: sp.p,
          x: pos.x,
          z: pos.z,
          rot: pos.rot,
          halfW: fp.halfW,
          halfD: fp.halfD,
        });
      }
    }
    setItems(placed);
    setSelectedId(placed[0]?.id || null);
    showToast(`${placed.length} mobilyalı örnek salon dizilimi kuruldu`);
  };

  const applyTemplate = (tpl: RoomTemplate) => {
    setRoomW(tpl.w);
    setRoomD(tpl.d);
    setCeilingH(tpl.ch);
    setFloorId(tpl.floorId);
    setWallId(tpl.wallId);
    setHasRug(tpl.hasRug);
  };

  const handleQuickCadImport = async (file: File | null) => {
    if (!file) return;
    setUploadingCad(true);
    try {
      const converted = await convertCadFileToGlb(file);
      const blobUrl = URL.createObjectURL(new Blob([converted.glbBuffer], { type: 'model/gltf-binary' }));
      const cleanName = file.name.replace(/\.[^.]+$/, '') || 'Özel 3B Mobilya';
      const customProd: Product = {
        id: `cad-local-${Date.now()}`,
        name: cleanName,
        category: 'Özel CAD',
        dimensionsCm: converted.dimensionsCm,
        glbUrl: blobUrl,
        source: 'ozel-cad',
      };
      onAddCustomProduct?.(customProd);
      addProductToRoom(customProd);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CAD dosyası okunamadı');
    } finally {
      setUploadingCad(false);
    }
  };

  const saveSnapshot = () => {
    const s = sceneRef.current;
    if (!s) return;
    setSaving(true);
    try {
      const prevVis = s.selFrame.visible;
      s.selFrame.visible = false;
      s.renderer.render(s.scene, s.camera);
      const url = s.renderer.domElement.toDataURL('image/jpeg', 0.93);
      s.selFrame.visible = prevVis;
      s.renderer.render(s.scene, s.camera);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mekanar-3b-oda-plan-${Date.now()}.jpg`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  const selectedItem = items.find((i) => i.id === selectedId) || null;
  const selectedWallClearance = (() => {
    if (!selectedItem) return null;
    const { extX, extZ } = getWorldAABBSpan(selectedItem.rot, selectedItem.halfW, selectedItem.halfD);
    const leftCm = Math.max(0, Math.round((selectedItem.x - extX + roomW / 2) * 100));
    const rightCm = Math.max(0, Math.round((roomW / 2 - (selectedItem.x + extX)) * 100));
    const backCm = Math.max(0, Math.round((selectedItem.z - extZ + roomD / 2) * 100));
    return { leftCm, rightCm, backCm };
  })();

  const drawerProducts = products.filter((p) => {
    if (drawerFilter === 'all') return true;
    if (drawerFilter === 'custom') return p.source === 'ozel-cad';
    if (drawerFilter === 'seating') return p.category === 'Kanepe' || p.category === 'Berjer';
    if (drawerFilter === 'tables') return p.category === 'Masa' || p.category === 'Sandalye' || p.category === 'Sehpa';
    if (drawerFilter === 'storage') {
      return p.category === 'Kitaplık' || p.category === 'Raf' || p.category === 'TV Ünitesi' || p.category === 'Yatak';
    }
    return true;
  });

  return (
    <div className="fixed inset-0 h-[100dvh] z-50 bg-[#eae7e0] text-stone-950 flex flex-col">
      {/* Üst Başlık */}
      <header className="h-14 px-3 sm:px-5 flex items-center justify-between gap-2 bg-white border-b border-stone-200 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-stone-700 hover:text-stone-950 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Geri</span>
        </button>

        <div className="min-w-0 text-center">
          <p className="font-display text-xs sm:text-sm font-bold text-stone-950 truncate">
            3B Oda Planlayıcı · {roomW.toFixed(1)} × {roomD.toFixed(1)} m ({(roomW * roomD).toFixed(1)} m²)
          </p>
          <p className="text-[10px] font-mono text-stone-500 truncate">
            {selectedItem
              ? `${selectedItem.product.name} · ${selectedItem.product.dimensionsCm}${
                  selectedWallClearance
                    ? ` · Duvar boşluğu: Arka ${selectedWallClearance.backCm} cm`
                    : ''
                }`
              : `${items.length} eşya yerleştirildi · 1:1 çarpışma koruması aktif`}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {selectedItem && (
            <button
              type="button"
              onClick={() => onOpenProductAR(selectedItem.product)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-bold whitespace-nowrap shrink-0 transition"
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Canlı AR&apos;da Gör</span>
              <span className="sm:hidden">AR</span>
            </button>
          )}
          <button
            type="button"
            onClick={saveSnapshot}
            disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-stone-900 text-[11px] font-semibold whitespace-nowrap shrink-0 transition"
            title="Plan görüntüsünü indir"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kaydet</span>
          </button>
        </div>
      </header>

      {/* İkinci Araç Çubuğu: Kamera, Oda Ölçüsü, Örnek Dizilim */}
      <div className="bg-[#faf9f6] border-b border-stone-200 px-3 sm:px-5 py-1.5 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
        {(
          [
            { id: 'free', label: 'Serbest 3B', icon: Layers },
            { id: 'top', label: 'Kuşbakışı Plan', icon: Grid3X3 },
            { id: 'inside', label: 'Göz Hizası', icon: Eye },
          ] as const
        ).map((c) => {
          const Icon = c.icon;
          const active = camPreset === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCamPreset(c.id)}
              className={`px-2.5 py-1.5 font-semibold flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition ${
                active
                  ? 'border-stone-950 bg-stone-950 text-white'
                  : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{c.label}</span>
            </button>
          );
        })}

        <span className="h-4 w-px bg-stone-300 mx-1 shrink-0" />

        <button
          type="button"
          onClick={() => setShowRoomPanel((v) => !v)}
          className={`px-2.5 py-1.5 font-semibold flex items-center gap-1.5 border whitespace-nowrap shrink-0 transition ${
            showRoomPanel
              ? 'border-stone-950 bg-stone-950 text-white'
              : 'border-stone-200 bg-white text-stone-800 hover:border-stone-500'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Oda Ölçüsü &amp; Yüzey</span>
        </button>

        <button
          type="button"
          onClick={() => setShowGrid((v) => !v)}
          className={`px-2.5 py-1.5 font-semibold flex items-center gap-1 border whitespace-nowrap shrink-0 transition ${
            showGrid
              ? 'border-stone-400 bg-stone-200/80 text-stone-950'
              : 'border-stone-200 bg-white text-stone-600'
          }`}
        >
          <Ruler className="w-3 h-3" />
          <span>50 cm Izgara</span>
        </button>

        <span className="h-4 w-px bg-stone-300 mx-1 shrink-0" />

        <button
          type="button"
          onClick={populateSampleLayout}
          className="px-2.5 py-1.5 font-semibold flex items-center gap-1 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 whitespace-nowrap shrink-0 transition"
        >
          <Sparkles className="w-3 h-3" />
          <span>Örnek Salon Diz</span>
        </button>

        {items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setItems([]);
              setSelectedId(null);
              showToast('Oda boşaltıldı');
            }}
            className="px-2.5 py-1.5 font-semibold border border-stone-200 hover:border-red-400 bg-white text-stone-600 hover:text-red-700 whitespace-nowrap shrink-0 transition"
          >
            Odayı Boşalt
          </button>
        )}
      </div>

      {/* Oda Özelleştirme Paneli (Açılır) */}
      {showRoomPanel && (
        <div className="bg-white border-b border-stone-200 px-4 py-3.5 shrink-0">
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Şablon & Ölçü */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  Oda Şablonu &amp; Ölçü
                </span>
                <span className="font-mono text-[11px] font-bold text-stone-950">
                  {roomW.toFixed(1)} × {roomD.toFixed(1)} × {ceilingH.toFixed(2)} m
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ROOM_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="px-2.5 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[11px] font-semibold text-stone-800 transition"
                  >
                    {tpl.title}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <label className="space-y-1">
                  <span className="text-[10px] text-stone-500 block">En (m)</span>
                  <input
                    type="number"
                    min={2.6}
                    max={9}
                    step={0.1}
                    value={roomW}
                    onChange={(e) => setRoomW(Math.max(2.6, Math.min(9, Number(e.target.value) || 4.6)))}
                    className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-stone-500 block">Derinlik (m)</span>
                  <input
                    type="number"
                    min={2.6}
                    max={9}
                    step={0.1}
                    value={roomD}
                    onChange={(e) => setRoomD(Math.max(2.6, Math.min(9, Number(e.target.value) || 5.2)))}
                    className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-stone-500 block">Tavan (m)</span>
                  <input
                    type="number"
                    min={2.3}
                    max={3.8}
                    step={0.05}
                    value={ceilingH}
                    onChange={(e) => setCeilingH(Math.max(2.3, Math.min(3.8, Number(e.target.value) || 2.7)))}
                    className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                  />
                </label>
              </div>
            </div>

            {/* Zemin Dokusu */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  Zemin Kaplaması
                </span>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasRug}
                    onChange={(e) => setHasRug(e.target.checked)}
                    className="accent-stone-950"
                  />
                  <span>Orta Halı</span>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(FLOOR_PRESETS) as FloorPresetId[]).map((id) => {
                  const fp = FLOOR_PRESETS[id];
                  const active = floorId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFloorId(id)}
                      className={`px-2.5 py-2 border flex items-center gap-2 text-[11px] font-semibold transition ${
                        active
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 border border-black/15 shrink-0"
                        style={{ backgroundColor: fp.swatch }}
                      />
                      <span className="truncate">{fp.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Duvar Boyası */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  Duvar Boyası
                </span>
                <button
                  type="button"
                  onClick={() => setShowRoomPanel(false)}
                  className="text-stone-400 hover:text-stone-950"
                  aria-label="Kapat"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(WALL_PRESETS) as WallPresetId[]).map((id) => {
                  const wp = WALL_PRESETS[id];
                  const active = wallId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWallId(id)}
                      className={`px-2.5 py-2 border flex items-center gap-2 text-[11px] font-semibold transition ${
                        active
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
                      }`}
                    >
                      <span
                        className="w-3.5 h-3.5 border border-black/15 shrink-0"
                        style={{ backgroundColor: wp.swatch }}
                      />
                      <span className="truncate">{wp.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3B Sahne Alanı */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          ref={hostRef}
          className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
          onPointerDownCapture={onPointerDownCapture}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {loadingCount > 0 && (
          <div className="absolute top-3 left-3 bg-white/95 border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-800 flex items-center gap-2 shadow-sm pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>3B mobilya yükleniyor...</span>
          </div>
        )}

        {toastMsg && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-stone-950 text-white px-4 py-2 text-xs font-medium shadow-lg pointer-events-none whitespace-nowrap max-w-[92vw] truncate">
            {toastMsg}
          </div>
        )}

        {items.length === 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 border border-stone-300 px-4 py-2.5 flex items-center gap-3 shadow-md">
            <span className="text-xs text-stone-700">Oda boş — mobilya ekleyin veya örnek salon dizin</span>
            <button
              type="button"
              onClick={() => setDrawerMode('add')}
              className="px-3 py-1.5 bg-stone-950 text-white text-xs font-bold whitespace-nowrap"
            >
              + Mobilya Ekle
            </button>
          </div>
        )}
      </div>

      {/* Alt Kontrol Çubuğu */}
      <div className="bg-white border-t border-stone-200 px-3 sm:px-5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerMode('add')}
              className="px-4 py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition"
            >
              <Plus className="w-4 h-4" />
              <span>Mobilya Ekle ({products.length})</span>
            </button>

            <label className="relative overflow-hidden px-3 py-2.5 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-stone-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition">
              {uploadingCad ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Kendi CAD (.GLB/.OBJ)</span>
              <span className="sm:hidden">CAD</span>
              <input
                type="file"
                accept=".glb,.gltf,.obj,.stl"
                className="hidden"
                onChange={(e) => {
                  handleQuickCadImport(e.target.files?.[0] || null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>

          {selectedItem ? (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => rotateSelected(-15)}
                className="p-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-800"
                title="15° Sola Döndür"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => rotateSelected(15)}
                className="p-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-800"
                title="15° Sağa Döndür"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => rotateSelected(90)}
                className="px-2.5 py-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-900 text-xs font-mono font-bold whitespace-nowrap"
                title="90° Döndür"
              >
                90°
              </button>
              <button
                type="button"
                onClick={duplicateSelected}
                className="p-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-800"
                title="Çoğalt"
              >
                <CopyPlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setDrawerMode('swap')}
                className="px-2.5 py-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-800 text-xs font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Değiştir</span>
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                className="p-2 border border-red-200 hover:border-red-600 bg-red-50 text-red-700"
                title="Sil"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-stone-500 hidden md:block">
              Taşımak veya döndürmek için odadaki bir mobilyaya dokunun · Boş alanı sürükleyerek odayı çevirin
            </p>
          )}
        </div>
      </div>

      {/* Mobilya Kataloğu Çekmecesi */}
      {drawerMode && (
        <div
          className="fixed inset-0 z-50 bg-black/55 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setDrawerMode(null)}
        >
          <div
            className="bg-white border border-stone-200 w-full sm:max-w-2xl max-h-[84dvh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 border-b border-stone-200 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-stone-950">
                  {drawerMode === 'swap' ? 'Seçili Mobilyayı Değiştir' : 'Odaya 1:1 Mobilya Ekle'}
                </h3>
                <p className="text-[11px] text-stone-500">
                  Tüm modeller gerçek santimetre ölçüsüyle otomatik boş alana yerleşir.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerMode(null)}
                className="p-1 text-stone-500 hover:text-stone-950"
                aria-label="Kapat"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 py-2.5 border-b border-stone-200 flex items-center justify-between gap-2 overflow-x-auto bg-[#faf9f6]">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `Tümü (${products.length})` },
                    { id: 'seating', label: 'Koltuk & Berjer' },
                    { id: 'tables', label: 'Masa & Sehpa' },
                    { id: 'storage', label: 'Depolama & Yatak' },
                    { id: 'custom', label: 'Özel 3B' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setDrawerFilter(t.id)}
                    className={`px-3 py-1.5 text-xs font-semibold border whitespace-nowrap transition ${
                      drawerFilter === t.id
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {onOpenAiBuilder && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawerMode(null);
                    onOpenAiBuilder();
                  }}
                  className="px-3 py-1.5 border border-stone-950 text-stone-950 hover:bg-stone-950 hover:text-white text-xs font-bold whitespace-nowrap shrink-0 transition"
                >
                  + Fotoğraftan 3B Üret
                </button>
              )}
            </div>

            <div className="p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3">
              {drawerProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => (drawerMode === 'swap' ? swapSelectedProduct(p) : addProductToRoom(p))}
                  className="text-left border border-stone-200 hover:border-stone-950 bg-white flex flex-col overflow-hidden transition group"
                >
                  <div className="h-28 bg-[#f5f4f0] flex items-center justify-center p-2 border-b border-stone-200/80">
                    {p.thumbUrl ? (
                      <img
                        src={p.thumbUrl}
                        alt={p.name}
                        className="w-full h-full object-contain group-hover:scale-105 transition"
                      />
                    ) : (
                      <span className="text-[11px] font-mono text-stone-500 text-center px-2">
                        1:1 3B Model
                      </span>
                    )}
                  </div>
                  <div className="p-2.5 space-y-0.5">
                    <p className="text-xs font-bold text-stone-950 line-clamp-2 leading-snug">{p.name}</p>
                    <p className="text-[10px] font-mono text-stone-500">{p.dimensionsCm}</p>
                  </div>
                </button>
              ))}
              {drawerProducts.length === 0 && (
                <p className="col-span-full text-center text-xs text-stone-500 py-8">
                  Bu kategoride henüz özel 3B ürün yok. Fotoğraftan 3B üretebilir veya CAD yükleyebilirsiniz.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
