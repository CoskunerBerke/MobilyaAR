import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Camera,
  Copy,
  Download,
  Eraser,
  Eye,
  Grid3X3,
  ImageIcon,
  Layers,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  Scissors,
  Server,
  Trash2,
  Undo2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type { Product } from '../lib/products';
import {
  buildShareUrl,
  type ReconstructRoomResult,
  type ReconstructedObject3D,
} from '../lib/server';
import {
  buildCustomFloorTexture,
  buildDemoStudioRoom,
  DEMO_STUDIO_PRESETS,
  type DemoStudioPresetId,
  type FloorSurfaceKind,
} from '../lib/demoRooms';
import { convertCadFileToGlb } from '../lib/cadImport';
import { extractFramesFromVideo, preparePhotoForScan, type PreparedScanFrame } from '../lib/videoFrames';
import {
  clearErasedObstaclesForKeyframe,
  inpaintPhotoRegion,
  type ErasePoint,
} from '../lib/photoInpaint';
import {
  createFreeFloorOverlayMesh,
  createKeyframeDepthOccluderMesh,
  createScannedRoomSurfaceObject,
  decodeScannedRoom,
  findOpenSpawnInScannedRoom,
  resolveMoveInScannedRoom,
  resolveRotateInScannedRoom,
  type DecodedScannedRoom,
  type ScannedRoomPayload,
} from '../lib/pointCloudRoom';
import {
  canRunScan,
  getActivePlan,
  getMembershipState,
  GPU_TIERS,
  recordCompletedScan,
  resetCustomerTrials,
  updateRunpodCredentials,
  type GpuTierId,
  type MembershipState,
} from '../lib/membership';
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
  initialColorHex?: string;
  onOpenServerSettings?: () => void;
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
  colorHex?: string;
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

function applyFabricSwatch(root: THREE.Object3D, hex?: string) {
  if (!hex) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData?.isHelper) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mt) => {
      if (mt && mt.name.startsWith('CAD_Fabric')) {
        (mt as THREE.MeshStandardMaterial).color.set(hex);
      }
    });
  });
}

function buildMiniMapGridDataUrl(room: DecodedScannedRoom): string {
  const { w, d, cells } = room.grid;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = d;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const imgData = ctx.createImageData(w, d);
  for (let i = 0; i < w * d; i++) {
    const val = cells[i] ?? 2;
    const o = i * 4;
    if (val === 0) {
      // Boş zemin (zümrüt yeşili)
      imgData.data[o] = 16;
      imgData.data[o + 1] = 185;
      imgData.data[o + 2] = 129;
      imgData.data[o + 3] = 105;
    } else if (val === 1) {
      // Mevcut eşya / duvar engeli (kırmızı/mercan)
      imgData.data[o] = 239;
      imgData.data[o + 1] = 68;
      imgData.data[o + 2] = 68;
      imgData.data[o + 3] = 165;
    } else {
      imgData.data[o] = 39;
      imgData.data[o + 1] = 39;
      imgData.data[o + 2] = 42;
      imgData.data[o + 3] = 90;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c.toDataURL();
}

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
  initialColorHex,
  onOpenServerSettings,
  onBack,
}) => {
  const [step, setStep] = useState<Step>('capture');
  const [captureMode, setCaptureMode] = useState<'video' | 'photos'>('video');
  const [videoFrames, setVideoFrames] = useState<PreparedScanFrame[]>([]);
  const [scanHdFrames, setScanHdFrames] = useState<string[]>([]);
  const [activeKeyframeIdx, setActiveKeyframeIdx] = useState<number | null>(null);
  const [stageBoxSize, setStageBoxSize] = useState<{ w: number; h: number } | null>(null);
  const [extractPct, setExtractPct] = useState<number | null>(null);
  const [views, setViews] = useState<CapturedView[]>([]);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<ReconstructRoomResult | null>(null);
  const [scannedRoom, setScannedRoom] = useState<DecodedScannedRoom | null>(null);
  const [miniMapGridUrl, setMiniMapGridUrl] = useState<string>('');
  const [showFreeFloor, setShowFreeFloor] = useState(false);
  const [sceneReady, setSceneReady] = useState(0);

  const [memberState, setMemberState] = useState<MembershipState>(() => getMembershipState());
  const [serverEnvConfigured, setServerEnvConfigured] = useState<boolean | null>(null);
  const [showQuickRunpod, setShowQuickRunpod] = useState(false);
  const [quickEndpoint, setQuickEndpoint] = useState(() => getMembershipState().runpodEndpointId);
  const [quickApiKey, setQuickApiKey] = useState(() => getMembershipState().runpodApiKey);
  const [quickTier, setQuickTier] = useState<GpuTierId>(() => getMembershipState().gpuTier);

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
  const [activeCamIdx, setActiveCamIdx] = useState<'free' | 'top'>('free');
  const [showExistingArch, setShowExistingArch] = useState(true);
  const [enableDepthOcc, setEnableDepthOcc] = useState(true);
  const [eraseMode, setEraseMode] = useState(false);
  const [erasingBusy, setErasingBusy] = useState(false);
  const [erasedHdMap, setErasedHdMap] = useState<Record<number, string>>({});
  const [eraseVersion, setEraseVersion] = useState(0);
  const [previewPhotoIdx, setPreviewPhotoIdx] = useState<number | null>(null);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [floorStyle, setFloorStyle] = useState<FloorSurfaceKind>('wood');
  const [customProducts, setCustomProducts] = useState<Product[]>([]);
  const [uploadingCad, setUploadingCad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [reconstructMsg, setReconstructMsg] = useState('');
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    fetch('/api/scan?action=config')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.serverConfigured === 'boolean') {
          setServerEnvConfigured(j.serverConfigured);
        }
      })
      .catch(() => setServerEnvConfigured(false));
  }, []);

  useEffect(() => {
    if (step === 'capture') {
      const latest = getMembershipState();
      setMemberState(latest);
      setQuickEndpoint(latest.runpodEndpointId);
      setQuickApiKey(latest.runpodApiKey);
      setQuickTier(latest.gpuTier);
    }
  }, [step]);

  const mobileStudioUrl = buildShareUrl({
    productId: product.id,
    glbUrl: product.glbUrl,
    productName: product.name,
    dimensionsCm: product.dimensionsCm,
    mode: 'studio',
    colorHex: initialColorHex,
    serverOnline,
    serverUrl,
  });

  const copyMobileStudioUrl = () => {
    navigator.clipboard?.writeText(mobileStudioUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const brushCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eraseStrokeRef = useRef<ErasePoint[] | null>(null);

  const itemsRef = useRef<PlacedItem3D[]>([]);
  itemsRef.current = items;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const wallModeRef = useRef<WallMode>('auto');
  wallModeRef.current = wallMode;
  const emptyRoomRef = useRef(true);
  emptyRoomRef.current = emptyRoom;
  const scannedRoomRef = useRef<DecodedScannedRoom | null>(null);
  scannedRoomRef.current = scannedRoom;
  const showFreeFloorRef = useRef(false);
  showFreeFloorRef.current = showFreeFloor;
  const activeKeyframeIdxRef = useRef<number | null>(null);
  activeKeyframeIdxRef.current = activeKeyframeIdx;
  const scanHdFramesRef = useRef<string[]>([]);
  scanHdFramesRef.current = scanHdFrames;
  const roomDimsRef = useRef<{ w: number; d: number; ch: number }>({ w: 4.8, d: 5.4, ch: 2.75 });
  const hitObstacleRef = useRef(false);
  const blobUrlsRef = useRef<string[]>([]);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    rafId: number;
    itemsRoot: THREE.Group;
    floorMesh: THREE.Mesh;
    floorMat?: THREE.MeshStandardMaterial;
    floorRgb?: [number, number, number];
    pointMat?: THREE.PointsMaterial;
    roomSurfaceObj?: THREE.Object3D;
    existingArchGroup?: THREE.Group;
    occluderEntry?: { mesh: THREE.Mesh; dispose: () => void };
    freeFloorMesh?: THREE.Mesh;
    borderLines: THREE.LineSegments;
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
    s.occluderEntry?.dispose();
    s.occluderEntry = undefined;
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

  const MAX_VIEWS = 16;

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList).slice(0, Math.max(0, MAX_VIEWS - views.length));
    if (picked.length === 0) {
      showToast(`En fazla ${MAX_VIEWS} fotoğraf yükleyebilirsiniz`);
      return;
    }
    setAddingPhotos(true);
    try {
      const parsed: CapturedView[] = [];
      for (const f of picked) {
        try {
          const res = await normalizeRoomPhoto(f, 1080);
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
        setViews((prev) => [...prev, ...parsed].slice(0, MAX_VIEWS));
      } else {
        showToast('Seçilen fotoğraf okunamadı — lütfen JPG veya PNG deneyin');
      }
    } finally {
      setAddingPhotos(false);
    }
  };

  const handleVideoUpload = async (file: File | null) => {
    if (!file) return;
    setExtractPct(0);
    try {
      const frames = await extractFramesFromVideo(file, 16, 518, (pct) => {
        if (alive.current) setExtractPct(pct);
      });
      if (frames.length < 4) {
        showToast('Videodan en az 4 kare çıkarılamadı — lütfen 10–25 sn arası bir video seçin');
        setVideoFrames([]);
      } else {
        setVideoFrames(frames);
        showToast(`${frames.length} video karesi çıkarıldı ve 3D taramaya hazır`);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Video okunamadı');
    } finally {
      if (alive.current) setExtractPct(null);
    }
  };

  const applyRoomResult = useCallback((res: ReconstructRoomResult) => {
    setScannedRoom(null);
    setScanHdFrames([]);
    setActiveKeyframeIdx(null);
    setMiniMapGridUrl('');
    roomDimsRef.current = { w: res.roomWidthM, d: res.roomDepthM, ch: res.ceilingHeightM };
    setRoomData(res);
    setEmptyRoom(true);
    setClipAxis('none');
    setShowClipBar(false);
    setShowSizeBar(false);
    setWallMode('auto');
    setActiveCamIdx('free');
    setPreviewPhotoIdx(null);

    itemsRef.current = [];
    setItems([]);
    selectedIdRef.current = null;
    setSelectedId(null);
    setStep('studio');
  }, []);

  const loadDemoPreset = useCallback(
    (presetId: DemoStudioPresetId) => {
      disposeStudio();
      setFloorStyle(presetId === 'grand' ? 'tile' : 'wood');
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

  const startGpuScan = async () => {
    const hasVideo = captureMode === 'video';
    const rawCount = hasVideo ? videoFrames.length : views.length;
    if (rawCount < 4) return;

    const latestMem = getMembershipState();
    setMemberState(latestMem);
    const quota = canRunScan(latestMem);
    if (!quota.ok) {
      showToast(quota.reason || 'Tarama kotası doldu');
      return;
    }

    const hasLocalCreds = Boolean(latestMem.runpodEndpointId && latestMem.runpodApiKey);
    if (!serverEnvConfigured && !hasLocalCreds) {
      setShowQuickRunpod(true);
      showToast('Gerçek 3D tarama için önce RunPod Serverless Endpoint ID ve API Key girin');
      return;
    }

    disposeStudio();
    setStep('reconstructing');
    setReconstructMsg('Kareler GPU için hazırlanıyor...');
    try {
      const prepared: PreparedScanFrame[] = hasVideo
        ? videoFrames
        : await Promise.all(views.map((v) => preparePhotoForScan(v.dataUrl)));

      // Vercel 4.5 MB POST güvenlik sınırı: toplam gövde > 3.5 MB ise eşit aralıklı alt-örnekle
      let selectedPrepared = prepared;
      const maxPostBytes = 3_500_000;
      const calcBytes = (arr: PreparedScanFrame[]) =>
        arr.reduce((sum, f) => sum + f.gpuDataUrl.length + 4, 32);
      if (calcBytes(selectedPrepared) > maxPostBytes && selectedPrepared.length > 8) {
        const avg = calcBytes(selectedPrepared) / selectedPrepared.length;
        const keep = Math.max(8, Math.floor(maxPostBytes / Math.max(1, avg)));
        const sub: PreparedScanFrame[] = [];
        for (let i = 0; i < keep; i++) {
          const idx = Math.round((i / (keep - 1)) * (selectedPrepared.length - 1));
          sub.push(selectedPrepared[idx]);
        }
        selectedPrepared = sub;
      }

      const gpuFrames = selectedPrepared.map((f) => f.gpuDataUrl);
      const hdFrames = selectedPrepared.map((f) => f.hdDataUrl);

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (hasLocalCreds) {
        headers['x-runpod-endpoint'] = latestMem.runpodEndpointId;
        headers['x-runpod-key'] = latestMem.runpodApiKey;
        headers['x-gpu-tier'] = latestMem.gpuTier;
      }

      setReconstructMsg(`${gpuFrames.length} kare RunPod Serverless GPU'ya gönderiliyor...`);
      const startRes = await fetch('/api/scan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ images: gpuFrames }),
      });
      const startJson = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startJson.ok || !startJson.jobId) {
        const msg =
          startRes.status === 413
            ? 'Kare boyutu sınırı aşıldı, lütfen daha az fotoğraf seçin'
            : startJson.error || `RunPod tarama işi başlatılamadı (${startRes.status})`;
        throw new Error(msg);
      }

      const jobId = startJson.jobId as string;
      const t0 = Date.now();
      let payload: ScannedRoomPayload | null = null;
      let billedSec = 0;
      let costUsd = 0;

      for (let attempt = 0; attempt < 168; attempt++) {
        await new Promise((r) => setTimeout(r, 2500));
        if (!alive.current) return;

        const sec = Math.round((Date.now() - t0) / 1000);
        const stRes = await fetch(`/api/scan?jobId=${encodeURIComponent(jobId)}`, {
          method: 'GET',
          headers: hasLocalCreds
            ? {
                'x-runpod-endpoint': latestMem.runpodEndpointId,
                'x-runpod-key': latestMem.runpodApiKey,
                'x-gpu-tier': latestMem.gpuTier,
              }
            : undefined,
        });
        const stJson = await stRes.json().catch(() => ({}));
        if (!stRes.ok || !stJson.ok) {
          throw new Error(stJson.error || `RunPod tarama durumu alınamadı (${stRes.status})`);
        }

        const st = stJson.status as string;
        if (st === 'COMPLETED') {
          const out = stJson.output as ScannedRoomPayload | undefined;
          if (!out || !out.ok) {
            throw new Error(out?.error || 'MapAnything 3D oda çıktısı üretilemedi');
          }
          payload = out;
          billedSec = Number(stJson.executionTimeMs || 0) / 1000 || out.stats?.totalSec || sec;
          costUsd = Number(stJson.estimatedCostUsd || 0);
          break;
        }
        if (st === 'FAILED' || st === 'CANCELLED' || st === 'TIMED_OUT') {
          throw new Error(stJson.error || `RunPod işlemi başarısız (${st})`);
        }
        setReconstructMsg(
          st === 'IN_PROGRESS'
            ? `MapAnything metrik zemin, derinlik maskeleri ve temiz 3B oda planını çıkarıyor (${sec} sn)...`
            : `Serverless GPU uyanıyor / sırada (${sec} sn)...`
        );
      }

      if (!payload) {
        throw new Error('Tarama zaman aşımına uğradı (420 sn). İlk RunPod başlatması bittiyse lütfen tekrar deneyin.');
      }

      const decoded = decodeScannedRoom(payload);
      const updatedMem = recordCompletedScan(gpuFrames.length, billedSec, costUsd);
      setMemberState(updatedMem);

      setRoomData(null);
      setScannedRoom(decoded);
      setScanHdFrames(hdFrames);
      setErasedHdMap({});
      setEraseMode(false);
      setEraseVersion(0);
      setShowExistingArch(true);
      setEnableDepthOcc(true);
      setMiniMapGridUrl(buildMiniMapGridDataUrl(decoded));
      roomDimsRef.current = {
        w: decoded.bounds.halfW * 2,
        d: decoded.bounds.halfD * 2,
        ch: decoded.bounds.ceilingM,
      };
      itemsRef.current = [];
      setItems([]);
      selectedIdRef.current = null;
      setSelectedId(null);
      setEmptyRoom(true);
      setClipAxis('none');
      setShowClipBar(false);
      setShowSizeBar(false);
      setWallMode('auto');
      setActiveCamIdx('free');
      // v8: Açılışta en ferah ve %100 net HD Fotoğraf açısı (sıfır bulanıklık!)
      const initialKf =
        decoded.keyframes.length > 0 && hdFrames.length > 0 ? decoded.bestKeyframeIdx : null;
      setActiveKeyframeIdx(initialKf);
      setPreviewPhotoIdx(null);
      setShowFreeFloor(false);
      setStep('studio');
      showToast(
        `Odanız hazır (${decoded.keyframes.length} HD açı • ${decoded.archBlocks.length} mimari kütle • ${billedSec.toFixed(1)} sn • ~$${costUsd.toFixed(3)})`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gerçek 3D oda oluşturulamadı');
      setStep('error');
    }
  };

  // ---- 3D Oda Sahnesini Kur (Temiz Mimari 3B İkiz VEYA Boş Demo Oda) ----
  const setupKey = scannedRoom
    ? `scan:${scannedRoom.mode}:${scannedRoom.archBlocks.length}:${scannedRoom.keyframes.length}:${scannedRoom.bounds.halfW.toFixed(2)}:${scannedRoom.bounds.halfD.toFixed(2)}`
    : roomData
    ? `demo:${roomData.floorTexture.slice(0, 64)}:${roomData.viewCount}`
    : '';

  useEffect(() => {
    if (step !== 'studio' || (!roomData && !scannedRoom) || !hostRef.current) return;
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

      const initialHdMode =
        Boolean(scannedRoom) &&
        activeKeyframeIdxRef.current !== null &&
        Boolean(scannedRoom?.keyframes[activeKeyframeIdxRef.current]);
      const bgHex = 0xe4e4e7;
      const scene = new THREE.Scene();
      scene.background = initialHdMode ? null : new THREE.Color(bgHex);
      renderer.setClearColor(initialHdMode ? 0x000000 : bgHex, initialHdMode ? 0 : 1);

      const camera = new THREE.PerspectiveCamera(52, w / h, 0.08, 60);
      const rw = roomDimsRef.current.w;
      const rd = roomDimsRef.current.d;
      const ch = roomDimsRef.current.ch;
      camera.position.set(rw * 0.65, ch * 1.15, rd * 0.85);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.9;
      controls.maxDistance = 16;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.target.set(0, 0.72, 0);
      controls.enabled = !initialHdMode;
      if (controls.enabled) controls.update();

      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const disposeFns: Array<() => void> = [];
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);

      let envTex: THREE.Texture | null = null;
      let floorMesh: THREE.Mesh;
      let floorMat: THREE.MeshStandardMaterial | undefined;
      let floorRgb: [number, number, number] | undefined;
      let pointMat: THREE.PointsMaterial | undefined;
      let roomSurfaceObj: THREE.Object3D | undefined;
      let existingArchGroup: THREE.Group | undefined;
      let freeFloorMesh: THREE.Mesh | undefined;
      let borderLines: THREE.LineSegments;
      const walls: Array<{
        side: 'north' | 'south' | 'west' | 'east';
        mesh: THREE.Mesh;
        inwardNormal: THREE.Vector3;
        center: THREE.Vector3;
      }> = [];

      const light = new THREE.DirectionalLight(0xfffcf5, 1.45);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const ext = Math.max(rw, rd) * 0.85;
      light.shadow.camera.left = -ext;
      light.shadow.camera.right = ext;
      light.shadow.camera.top = ext;
      light.shadow.camera.bottom = -ext;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 20;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 4;

      if (scannedRoom) {
        const surfObj = await createScannedRoomSurfaceObject(scannedRoom, scanHdFramesRef.current, clipPlane);
        if (cancelled || !alive.current) {
          surfObj.dispose();
          controls.dispose();
          renderer.dispose();
          return;
        }

        host.innerHTML = '';
        host.appendChild(renderer.domElement);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.touchAction = 'none';

        const hemi = new THREE.HemisphereLight(0xffffff, 0xd4d0c8, 1.15);
        scene.add(hemi);
        scene.add(new THREE.AmbientLight(0xffffff, 0.28));
        light.position.set(-rw * 0.65, Math.max(4.2, ch * 1.65), rd * 0.65);
        scene.add(light);

        const shadowGeo = new THREE.PlaneGeometry(rw + 4, rd + 4).rotateX(-Math.PI / 2);
        const shadowMat = new THREE.ShadowMaterial({ opacity: 0.34 });
        floorMesh = new THREE.Mesh(shadowGeo, shadowMat);
        floorMesh.position.y = 0.003;
        floorMesh.renderOrder = 1;
        floorMesh.receiveShadow = true;
        floorMesh.userData.isHelper = true;
        scene.add(floorMesh);
        disposeFns.push(() => {
          shadowGeo.dispose();
          shadowMat.dispose();
        });

        const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, 0.012, rd));
        const borderMat = new THREE.LineBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.45 });
        borderLines = new THREE.LineSegments(borderGeo, borderMat);
        borderLines.position.y = 0.004;
        borderLines.visible = !initialHdMode;
        scene.add(borderLines);
        disposeFns.push(() => {
          borderGeo.dispose();
          borderMat.dispose();
        });

        surfObj.object.visible = !initialHdMode;
        if (surfObj.walls) {
          walls.push(...surfObj.walls);
        }
        existingArchGroup = surfObj.existingGroup;
        scene.add(surfObj.object);
        roomSurfaceObj = surfObj.object;
        pointMat = surfObj.pointMat;
        disposeFns.push(surfObj.dispose);

        const ffObj = createFreeFloorOverlayMesh(scannedRoom);
        ffObj.mesh.position.y = 0.008;
        ffObj.mesh.renderOrder = 2;
        ffObj.mesh.visible = showFreeFloorRef.current;
        scene.add(ffObj.mesh);
        freeFloorMesh = ffObj.mesh;
        disposeFns.push(ffObj.dispose);
      } else {
        const rdData = roomData!;
        const [floorImg, floorTex, northTex, southTex, westTex, eastTex] = await Promise.all([
          loadHtmlImage(rdData.floorTexture),
          loadThreeTexture(rdData.floorTexture),
          loadThreeTexture(rdData.wallTextures.north),
          loadThreeTexture(rdData.wallTextures.south),
          loadThreeTexture(rdData.wallTextures.west),
          loadThreeTexture(rdData.wallTextures.east),
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
        envTex = envInfo.env;
        scene.environment = envInfo.env;

        const hemi = new THREE.HemisphereLight(0xffffff, 0xd6d3cd, 0.95);
        scene.add(hemi);

        const ld = rdData.lightDir;
        light.position.set(ld[0] * 6, Math.max(3.5, ld[1] * 6), ld[2] * 6);
        scene.add(light);

        floorRgb = [208, 198, 182];
        try {
          const sc = document.createElement('canvas');
          sc.width = 4;
          sc.height = 4;
          const sctx = sc.getContext('2d');
          if (sctx) {
            sctx.drawImage(floorImg, 0, 0, 4, 4);
            const px = sctx.getImageData(1, 1, 1, 1).data;
            floorRgb = [px[0], px[1], px[2]];
            const mx = Math.max(px[0], px[1], px[2]);
            const mn = Math.min(px[0], px[1], px[2]);
            setFloorStyle((mx - mn) / Math.max(1, mx) < 0.17 ? 'tile' : 'wood');
          }
        } catch {
          /* use default */
        }

        const floorGeo = new THREE.PlaneGeometry(rw, rd).rotateX(-Math.PI / 2);
        floorMat = new THREE.MeshStandardMaterial({
          map: floorTex,
          roughness: 0.86,
          metalness: 0.0,
          envMapIntensity: 0.28,
          side: THREE.DoubleSide,
        });
        floorMesh = new THREE.Mesh(floorGeo, floorMat);
        floorMesh.receiveShadow = true;
        scene.add(floorMesh);
        disposeFns.push(() => {
          floorMesh.geometry.dispose();
          floorMat?.map?.dispose();
          floorMat?.dispose();
        });

        const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(rw, 0.012, rd));
        const borderMat = new THREE.LineBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.4 });
        borderLines = new THREE.LineSegments(borderGeo, borderMat);
        borderLines.position.y = 0.006;
        scene.add(borderLines);
        disposeFns.push(() => {
          borderLines.geometry.dispose();
          borderMat.dispose();
        });

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
        floorMat,
        floorRgb,
        pointMat,
        roomSurfaceObj,
        existingArchGroup,
        freeFloorMesh,
        borderLines,
        groups: new Map(),
        walls,
        clipPlane,
        selFrame,
        selMat,
        light,
        envTex,
        gltfCache: new Map(),
        loadingKeys: new Set(),
        disposeFns,
      };
      setSceneReady((v) => v + 1);

      const onResize = () => {
        if (!hostRef.current || !sceneRef.current) return;
        const nw = hostRef.current.clientWidth;
        const nh = hostRef.current.clientHeight;
        if (nw > 0 && nh > 0) {
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
        if (controls.enabled) {
          controls.update();
        }
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

        const sel = itemsRef.current.find(
          (it) => it.id === selectedIdRef.current && (!it.isScanned || !emptyRoomRef.current)
        );
        if (sel) {
          selFrame.visible = true;
          selFrame.position.set(sel.x, 0.007, sel.z);
          selFrame.rotation.set(0, sel.rot, 0);
          selFrame.scale.set(sel.halfW + 0.025, 1, sel.halfD + 0.025);
          selMat.color.setHex(hitObstacleRef.current ? 0xdc2626 : scannedRoomRef.current ? 0xf4f4f5 : 0x18181b);
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
    const rw = Math.min(12.0, Math.max(2.6, Math.round(newW * 10) / 10));
    const rd = Math.min(12.0, Math.max(2.6, Math.round(newD * 10) / 10));
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

  const switchFloorStyle = useCallback(async (kind: FloorSurfaceKind) => {
    setFloorStyle(kind);
    const s = sceneRef.current;
    if (!s || !s.floorMat || !s.floorRgb) return;
    const texUrl = buildCustomFloorTexture(kind, s.floorRgb);
    const newTex = await loadThreeTexture(texUrl);
    if (!alive.current || !sceneRef.current || !sceneRef.current.floorMat) {
      newTex.dispose();
      return;
    }
    newTex.anisotropy = s.renderer.capabilities.getMaxAnisotropy();
    s.floorMat.map?.dispose();
    s.floorMat.map = newTex;
    s.floorMat.needsUpdate = true;
  }, []);

  const focusWallAngle = useCallback(
    (idx: number) => {
      setActiveCamIdx('free');
      setPreviewPhotoIdx((cur) => (cur === idx ? null : idx));
      const s = sceneRef.current;
      if (!s) return;
      const total = Math.max(4, roomData?.cameras.length || 4);
      const yaw = (idx / total) * Math.PI * 2;
      const { w: rw, d: rd, ch } = roomDimsRef.current;
      s.camera.position.set(-Math.sin(yaw) * rw * 0.72, ch * 1.08, Math.cos(yaw) * rd * 0.72);
      s.controls.target.set(0, 0.65, 0);
      s.controls.update();
    },
    [roomData]
  );

  // ---- HD Açı Kare Kutusu & Serbest 3D / Kuşbakışı Kamera Modu ----
  useEffect(() => {
    const stage = stageRef.current;
    const kf =
      step === 'studio' && scannedRoom && activeKeyframeIdx !== null
        ? scannedRoom.keyframes[activeKeyframeIdx]
        : undefined;
    if (!stage || !kf) {
      setStageBoxSize(null);
      return;
    }
    const update = () => {
      const aw = stage.clientWidth;
      const ah = stage.clientHeight;
      if (aw <= 0 || ah <= 0 || kf.aspect <= 0) return;
      let bw = aw;
      let bh = bw / kf.aspect;
      if (bh > ah) {
        bh = ah;
        bw = bh * kf.aspect;
      }
      setStageBoxSize({ w: Math.round(bw), h: Math.round(bh) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [step, scannedRoom, activeKeyframeIdx]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s || (!roomData && !scannedRoom) || step !== 'studio') return;

    if (s.occluderEntry) {
      s.scene.remove(s.occluderEntry.mesh);
      s.occluderEntry.dispose();
      s.occluderEntry = undefined;
    }

    const kf =
      scannedRoom && activeKeyframeIdx !== null ? scannedRoom.keyframes[activeKeyframeIdx] : undefined;

    if (kf) {
      s.scene.background = null;
      s.renderer.setClearColor(0x000000, 0);
      if (s.roomSurfaceObj) s.roomSurfaceObj.visible = false;
      s.borderLines.visible = false;
      s.floorMesh.visible = true;
      s.controls.enabled = false;

      s.camera.fov = kf.fovY;
      s.camera.aspect = kf.aspect;
      s.camera.position.set(kf.pos[0], kf.pos[1], kf.pos[2]);
      s.camera.quaternion.set(kf.quat[0], kf.quat[1], kf.quat[2], kf.quat[3]);
      s.camera.updateProjectionMatrix();

      if (enableDepthOcc) {
        const occ = createKeyframeDepthOccluderMesh(kf, scannedRoom!.bounds.ceilingM);
        s.scene.add(occ.mesh);
        s.occluderEntry = occ;
      }
      return;
    }

    const rw = roomDimsRef.current.w;
    const rd = roomDimsRef.current.d;
    const ch = roomDimsRef.current.ch;
    const bgHex = 0xe4e4e7;

    s.scene.background = new THREE.Color(bgHex);
    s.renderer.setClearColor(bgHex, 1);
    if (s.roomSurfaceObj) s.roomSurfaceObj.visible = true;
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
    s.controls.enabled = true;
    s.controls.minDistance = 0.9;
    s.controls.maxDistance = 16;
    s.controls.minPolarAngle = 0;
    s.controls.maxPolarAngle = Math.PI * 0.495;

    if (activeCamIdx === 'top') {
      s.camera.position.set(0, Math.max(rw, rd) * 1.42, 0.01);
      s.controls.target.set(0, 0, 0);
    } else {
      s.camera.position.set(rw * 0.65, ch * 1.15, rd * 0.85);
      s.controls.target.set(0, 0.72, 0);
    }
    s.controls.update();
  }, [activeCamIdx, activeKeyframeIdx, enableDepthOcc, eraseVersion, roomData, scannedRoom, sceneReady, step]);

  // ---- Mimari 3B Mevcut Eşya Kütleleri Görünürlüğü ----
  useEffect(() => {
    const s = sceneRef.current;
    if (s?.existingArchGroup) {
      s.existingArchGroup.visible = showExistingArch;
    }
  }, [showExistingArch, sceneReady]);

  // ---- Kesit düzlemi ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || (!roomData && !scannedRoom)) return;
    const { w: rw, d: rd, ch } = roomDimsRef.current;

    if (clipAxis === 'none') {
      s.clipPlane.set(new THREE.Vector3(0, -1, 0), 100);
    } else if (clipAxis === 'y') {
      const maxH = 0.25 + (clipPct / 100) * ch;
      s.clipPlane.set(new THREE.Vector3(0, -1, 0), maxH);
    } else if (clipAxis === 'x') {
      const cutoff = -rw * 0.5 + (clipPct / 100) * rw;
      s.clipPlane.set(new THREE.Vector3(-1, 0, 0), cutoff);
    } else if (clipAxis === 'z') {
      const cutoff = -rd * 0.5 + (clipPct / 100) * rd;
      s.clipPlane.set(new THREE.Vector3(0, 0, -1), cutoff);
    }
  }, [clipAxis, clipPct, roomData, scannedRoom, sceneReady]);

  // ---- Boş Zemin Vurgusu Canlı Güncellemesi ----
  useEffect(() => {
    const s = sceneRef.current;
    if (s?.freeFloorMesh) {
      s.freeFloorMesh.visible = showFreeFloor;
    }
  }, [showFreeFloor, sceneReady]);

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
        m.renderOrder = 1;
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
        const sr = scannedRoomRef.current;
        const candObb = { id: item.id, x: px, z: pz, rot: prot, halfW: exactHalfW, halfD: exactHalfD };
        const settled = sr
          ? resolveMoveInScannedRoom(candObb, px, pz, others, sr)
          : resolveMoveOBB(candObb, px, pz, others, rw, rd);
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
      applyFabricSwatch(root, item.colorHex);
      s.groups.set(item.id, { key: itemKey, root });
      s.itemsRoot.add(root);
    };

    for (const item of items) {
      const existing = s.groups.get(item.id);
      if (existing) {
        existing.root.position.set(item.x, 0, item.z);
        existing.root.rotation.set(0, item.rot, 0);
        existing.root.visible = !item.isScanned || !emptyRoom;
        applyFabricSwatch(existing.root, item.colorHex);
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
  }, [items, step, emptyRoom, sceneReady, showToast]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      blobUrlsRef.current = [];
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
    if (!drag.current || (!roomData && !scannedRoomRef.current)) return;
    const fh = floorRayHit(e.clientX, e.clientY);
    if (!fh) return;

    const did = drag.current.id;
    const cur = itemsRef.current.find((it) => it.id === did);
    if (!cur) return;

    const rawX = drag.current.px + (fh.x - drag.current.hx);
    const rawZ = drag.current.pz + (fh.z - drag.current.hz);
    const { w: rw, d: rd } = roomDimsRef.current;
    const sr = scannedRoomRef.current;
    const res = sr
      ? resolveMoveInScannedRoom(toOBB(cur), rawX, rawZ, getOtherOBBs(did), sr)
      : resolveMoveOBB(toOBB(cur), rawX, rawZ, getOtherOBBs(did), rw, rd);

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
    if (sceneRef.current) {
      sceneRef.current.controls.enabled = activeKeyframeIdxRef.current === null;
    }
  };

  const rotateBy = (deg: number) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const cur = itemsRef.current.find((it) => it.id === sid);
    if (!cur) return;

    const nextRot = cur.rot + (deg * Math.PI) / 180;
    const { w: rw, d: rd } = roomDimsRef.current;
    const sr = scannedRoomRef.current;
    const res = sr
      ? resolveRotateInScannedRoom(toOBB(cur), nextRot, getOtherOBBs(sid), sr)
      : resolveRotateOBB(toOBB(cur), nextRot, getOtherOBBs(sid), rw, rd);
    if (!res.ok) {
      showToast('Mevcut eşyalar veya duvar nedeniyle burada döndürülemiyor');
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
    showToast('Eklenen mobilyalar kaldırıldı');
  };

  const addProductAtPoint = (prod: Product, targetX?: number, targetZ?: number): boolean => {
    const { halfW, halfD } = parseProductFootprintM(prod.dimensionsCm);
    const { w: rw, d: rd } = roomDimsRef.current;
    const sr = scannedRoomRef.current;
    const baseXZ: [number, number] | undefined =
      targetX !== undefined && targetZ !== undefined
        ? [targetX, targetZ]
        : sr
        ? sr.spawnXZ
        : roomData?.spawnXZ || [0, 0];
    const pos = sr
      ? findOpenSpawnInScannedRoom(halfW, halfD, getOtherOBBs('__none__'), sr, baseXZ)
      : findOpenSpawnPosition(halfW, halfD, 0, getOtherOBBs('__none__'), rw, rd, baseXZ);
    if (!pos) {
      showToast(`Odada bu ürün (${prod.dimensionsCm}) için yeterli boş zemin bulunamadı`);
      return false;
    }

    const nid = `it-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nextItem: PlacedItem3D = {
      id: nid,
      label: prod.name,
      dimensionsCm: prod.dimensionsCm,
      product: prod,
      colorHex: prod.id === product.id ? (initialColorHex || prod.swatches?.[0]?.hex) : prod.swatches?.[0]?.hex,
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

  const addProductToRoom = (prod: Product): boolean => addProductAtPoint(prod);

  const changeItemColor = (hex: string) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const updated = itemsRef.current.map((it) => (it.id === sid ? { ...it, colorHex: hex } : it));
    itemsRef.current = updated;
    setItems(updated);
    const root = sceneRef.current?.groups.get(sid)?.root;
    if (root) applyFabricSwatch(root, hex);
  };

  const handleCustomCadUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingCad(true);
    try {
      const converted = await convertCadFileToGlb(file);
      const blobUrl = URL.createObjectURL(new Blob([converted.glbBuffer], { type: 'model/gltf-binary' }));
      blobUrlsRef.current.push(blobUrl);
      const cleanName = file.name.replace(/\.[^.]+$/, '') || 'Özel 3D Ürün';
      const created: Product = {
        id: `studio-cad-${Date.now()}`,
        name: cleanName,
        category: 'Özel CAD',
        dimensionsCm: converted.dimensionsCm,
        glbUrl: blobUrl,
        source: 'ozel-cad',
      };
      setCustomProducts((prev) => [created, ...prev]);
      setDrawerMode(null);
      addProductAtPoint(created);
      showToast(`${cleanName} (${converted.dimensionsCm}) odaya eklendi`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '3D model dosyası okunamadı');
    } finally {
      setUploadingCad(false);
    }
  };

  const allProducts = [...customProducts, ...products];

  const handleStageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const prodId = e.dataTransfer.getData('text/plain');
    if (!prodId) return;
    const dropped = allProducts.find((p) => p.id === prodId);
    if (!dropped) return;
    const hit = floorRayHit(e.clientX, e.clientY);
    addProductAtPoint(dropped, hit?.x, hit?.z);
  };

  const pickProductFromDrawer = (prod: Product) => {
    if (drawerMode === 'swap' && selectedIdRef.current) {
      const sid = selectedIdRef.current;
      const cur = itemsRef.current.find((it) => it.id === sid);
      if (cur) {
        const { halfW, halfD } = parseProductFootprintM(prod.dimensionsCm);
        const { w: rw, d: rd } = roomDimsRef.current;
        const others = getOtherOBBs(sid);
        const sr = scannedRoomRef.current;
        let nx = cur.x;
        let nz = cur.z;
        let nrot = cur.rot;

        const rotFit = sr
          ? resolveRotateInScannedRoom({ id: sid, x: cur.x, z: cur.z, rot: cur.rot, halfW, halfD }, cur.rot, others, sr)
          : resolveRotateOBB({ id: sid, x: cur.x, z: cur.z, rot: cur.rot, halfW, halfD }, cur.rot, others, rw, rd);
        if (rotFit.ok) {
          nx = rotFit.x;
          nz = rotFit.z;
          nrot = rotFit.rot;
        } else {
          const openFit = sr
            ? findOpenSpawnInScannedRoom(halfW, halfD, others, sr, [cur.x, cur.z])
            : findOpenSpawnPosition(halfW, halfD, cur.rot, others, rw, rd, [cur.x, cur.z]);
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
                colorHex: prod.swatches?.[0]?.hex,
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
      if (!addProductAtPoint(prod)) return;
    }
    setDrawerMode(null);
  };

  const onErasePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!eraseMode || erasingBusy || !brushCanvasRef.current) return;
    e.stopPropagation();
    const cvs = brushCanvasRef.current;
    const rect = cvs.getBoundingClientRect();
    if (cvs.width !== Math.round(rect.width) || cvs.height !== Math.round(rect.height)) {
      cvs.width = Math.max(1, Math.round(rect.width));
      cvs.height = Math.max(1, Math.round(rect.height));
    }
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    eraseStrokeRef.current = [{ u, v }];
    const ctx = cvs.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const r = Math.max(12, 0.045 * Math.min(cvs.width, cvs.height));
      ctx.fillStyle = 'rgba(239, 68, 68, 0.48)';
      ctx.beginPath();
      ctx.arc(u * cvs.width, v * cvs.height, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onErasePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!eraseStrokeRef.current || !brushCanvasRef.current) return;
    e.stopPropagation();
    const cvs = brushCanvasRef.current;
    const rect = cvs.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    eraseStrokeRef.current.push({ u, v });
    const ctx = cvs.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      const r = Math.max(12, 0.045 * Math.min(cvs.width, cvs.height));
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.48)';
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(eraseStrokeRef.current[0].u * cvs.width, eraseStrokeRef.current[0].v * cvs.height);
      for (let i = 1; i < eraseStrokeRef.current.length; i++) {
        ctx.lineTo(eraseStrokeRef.current[i].u * cvs.width, eraseStrokeRef.current[i].v * cvs.height);
      }
      ctx.stroke();
    }
  };

  const onErasePointerUp = async () => {
    const stroke = eraseStrokeRef.current;
    eraseStrokeRef.current = null;
    if (brushCanvasRef.current) {
      const ctx = brushCanvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, brushCanvasRef.current.width, brushCanvasRef.current.height);
    }
    if (!stroke || stroke.length === 0 || !scannedRoom || activeKeyframeIdx === null) return;
    const kf = scannedRoom.keyframes[activeKeyframeIdx];
    if (!kf) return;
    const curSrc = erasedHdMap[kf.viewIdx] || scanHdFrames[kf.viewIdx];
    if (!curSrc) return;

    setErasingBusy(true);
    try {
      const cleaned = await inpaintPhotoRegion(curSrc, [stroke], 0.045);
      clearErasedObstaclesForKeyframe(scannedRoom, kf, [stroke], 0.045);
      setErasedHdMap((prev) => ({ ...prev, [kf.viewIdx]: cleaned }));
      setMiniMapGridUrl(buildMiniMapGridDataUrl(scannedRoom));
      setEraseVersion((v) => v + 1);
      showToast('Eski eşya temizlendi — yeni mobilyayı bu alana sürükleyebilirsiniz');
    } catch {
      showToast('Eşya silme işlemi tamamlanamadı');
    } finally {
      setErasingBusy(false);
    }
  };

  const undoEraseCurrentAngle = () => {
    if (!scannedRoom || activeKeyframeIdx === null) return;
    const kf = scannedRoom.keyframes[activeKeyframeIdx];
    if (!kf) return;
    kf.occDepthMm.set(kf.origOccDepthMm);
    scannedRoom.grid.cells.set(scannedRoom.grid.origCells);
    setErasedHdMap((prev) => {
      const next = { ...prev };
      delete next[kf.viewIdx];
      return next;
    });
    setMiniMapGridUrl(buildMiniMapGridDataUrl(scannedRoom));
    setEraseVersion((v) => v + 1);
    showToast('Orijinal oda fotoğrafı ve derinlik haritası geri yüklendi');
  };

  const saveSnapshot = async () => {
    const s = sceneRef.current;
    if (!s || (!roomData && !scannedRoom)) return;
    setSaving(true);
    try {
      const prevFrame = s.selFrame.visible;
      s.selFrame.visible = false;
      s.renderer.render(s.scene, s.camera);

      const kf =
        scannedRoom && activeKeyframeIdx !== null ? scannedRoom.keyframes[activeKeyframeIdx] : undefined;
      const hdUrl = kf ? erasedHdMap[kf.viewIdx] || scanHdFrames[kf.viewIdx] : undefined;
      let url: string;
      if (kf && hdUrl) {
        const bgImg = await loadHtmlImage(hdUrl);
        const glCanvas = s.renderer.domElement;
        const cw = glCanvas.width || 1280;
        const ch = glCanvas.height || 960;
        const comp = document.createElement('canvas');
        comp.width = cw;
        comp.height = ch;
        const ctx = comp.getContext('2d');
        if (ctx) {
          ctx.drawImage(bgImg, 0, 0, cw, ch);
          ctx.drawImage(glCanvas, 0, 0, cw, ch);
          url = comp.toDataURL('image/jpeg', 0.92);
        } else {
          url = glCanvas.toDataURL('image/jpeg', 0.92);
        }
      } else {
        url = s.renderer.domElement.toDataURL('image/jpeg', 0.92);
      }

      s.selFrame.visible = prevFrame;
      s.renderer.render(s.scene, s.camera);
      const a = document.createElement('a');
      a.href = url;
      a.download = `3d-oda-simulasyon-${Date.now()}.jpg`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  const visibleItems = items.filter((it) => !it.isScanned || !emptyRoom);
  const hasScannedItems = items.some((it) => it.isScanned);
  const selectedItem = visibleItems.find((i) => i.id === selectedId) || null;

  const drawerProducts = allProducts.filter((p) => {
    if (drawerFilter === 'all') return true;
    if (drawerFilter === 'seating') return p.category === 'Kanepe' || p.category === 'Berjer';
    if (drawerFilter === 'tables') return p.category === 'Masa' || p.category === 'Sandalye' || p.category === 'Sehpa';
    if (drawerFilter === 'storage') {
      return p.category === 'Kitaplık' || p.category === 'Raf' || p.category === 'TV Ünitesi' || p.category === 'Yatak';
    }
    return true;
  });

  const activePlan = getActivePlan(memberState);
  const remainingTrials = Math.max(0, activePlan.perCustomerLimit - memberState.customerUsedScans);
  const gpuReady = Boolean(serverEnvConfigured || (memberState.runpodEndpointId && memberState.runpodApiKey));
  const activeFrameCount = captureMode === 'video' ? videoFrames.length : views.length;
  const activeKf =
    scannedRoom && activeKeyframeIdx !== null ? scannedRoom.keyframes[activeKeyframeIdx] : undefined;
  const activeHdUrl = activeKf ? erasedHdMap[activeKf.viewIdx] || scanHdFrames[activeKf.viewIdx] : undefined;
  const currentAngleErased = Boolean(activeKf && erasedHdMap[activeKf.viewIdx]);

  return (
    <div className="fixed inset-0 h-[100dvh] z-50 bg-zinc-950 text-white flex flex-col">
      <header className="h-14 px-3 flex items-center justify-between gap-2 border-b border-zinc-800 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold whitespace-nowrap shrink-0">
          <ArrowLeft className="w-4 h-4" />
          <span>Geri</span>
        </button>

        <div className="min-w-0 text-center">
          <p className="text-xs font-bold truncate">
            {step === 'studio' && scannedRoom
              ? `Gerçek 3D Oda (${(scannedRoom.bounds.halfW * 2).toFixed(1)} × ${(scannedRoom.bounds.halfD * 2).toFixed(1)} m)`
              : step === 'studio' && roomData
              ? `3D Oda (${roomData.roomWidthM.toFixed(1)} × ${roomData.roomDepthM.toFixed(1)} m)`
              : 'Gerçek 3D Oda Tarama Stüdyosu'}
          </p>
          <p className="text-[10px] text-zinc-400 font-mono truncate">
            {selectedItem
              ? `${selectedItem.label} • ${selectedItem.dimensionsCm}`
              : step === 'studio' && scannedRoom
              ? activeKf && activeHdUrl
                ? `${visibleItems.length} mobilya • HD Fotoğraf Açı ${(activeKeyframeIdx ?? 0) + 1}/${scannedRoom.keyframes.length} • ${
                    enableDepthOcc ? 'Derinlik Gizleme Açık' : 'Derinlik Maskesi Kapalı'
                  }`
                : `${visibleItems.length} mobilya • Temiz Mimari 3B İkiz (${scannedRoom.archBlocks.length} mevcut eşya)`
              : step === 'studio'
              ? `${visibleItems.length} ürün odada • Çarpışma koruması açık`
              : 'Video / foto çekin veya boş oda seçin'}
          </p>
        </div>

        {step === 'studio' ? (
          <button
            type="button"
            onClick={() => setStep('capture')}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-[11px] font-semibold whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Oda Çek</span>
          </button>
        ) : (
          <div className="w-12 shrink-0" />
        )}
      </header>

      {step === 'capture' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
          <div className="min-h-full flex flex-col justify-center max-w-lg w-full mx-auto space-y-4 py-2">
            {toastMsg && (
              <div className="bg-zinc-900 border border-amber-700/80 px-3.5 py-2.5 rounded-lg text-xs font-medium text-amber-200 text-center">
                {toastMsg}
              </div>
            )}

            {/* Kota & Serverless GPU Durum Çubuğu */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border border-zinc-800 bg-zinc-900/90 rounded-lg text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">Deneme Hakkı:</span>
                <span className={`font-mono font-bold ${remainingTrials > 0 ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {remainingTrials} / {activePlan.perCustomerLimit}
                </span>
                {remainingTrials < activePlan.perCustomerLimit && (
                  <button
                    type="button"
                    onClick={() => {
                      setMemberState(resetCustomerTrials());
                      showToast('Müşteri deneme sayacı sıfırlandı');
                    }}
                    className="underline text-zinc-300 hover:text-white"
                  >
                    Sıfırla
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowQuickRunpod((v) => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-semibold ${
                  gpuReady
                    ? 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300'
                    : 'border-amber-700/70 bg-amber-950/40 text-amber-200'
                }`}
              >
                <Server className="w-3 h-3" />
                <span>{gpuReady ? 'RunPod Hazır (İstek Başı)' : 'RunPod Bağla'}</span>
              </button>
            </div>

            {showQuickRunpod && (
              <div className="p-3.5 border border-zinc-700 bg-zinc-900 rounded-lg space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">RunPod Serverless Bağlantısı (İstek Başı Ödeme)</span>
                  <button type="button" onClick={() => setShowQuickRunpod(false)} className="text-zinc-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Bekleyen GPU ücreti ödenmez; sadece tarama yapılan saniye faturalanır (~0.01–0.05 USD). Vercel Ortam Değişkenlerine eklediğinizde tüm telefonlar otomatik bağlanır.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={quickEndpoint}
                    onChange={(e) => setQuickEndpoint(e.target.value)}
                    placeholder="Endpoint ID (örn: abc123xyz)"
                    className="px-2.5 py-2 bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-white"
                  />
                  <input
                    type="password"
                    value={quickApiKey}
                    onChange={(e) => setQuickApiKey(e.target.value)}
                    placeholder="RunPod API Key (rpa_...)"
                    className="px-2.5 py-2 bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-white"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={quickTier}
                    onChange={(e) => setQuickTier(e.target.value as GpuTierId)}
                    className="px-2.5 py-2 bg-zinc-950 border border-zinc-700 rounded text-xs text-white"
                  >
                    {Object.values(GPU_TIERS).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.vram})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const next = updateRunpodCredentials(quickEndpoint, quickApiKey, quickTier);
                      setMemberState(next);
                      setShowQuickRunpod(false);
                      showToast('RunPod Serverless bağlantısı kaydedildi');
                    }}
                    className="flex-1 py-2 bg-white text-zinc-950 font-bold rounded text-xs"
                  >
                    Kaydet ve Bağlan
                  </button>
                  {onOpenServerSettings && (
                    <button
                      type="button"
                      onClick={onOpenServerSettings}
                      className="px-2.5 py-2 border border-zinc-700 rounded text-[11px] text-zinc-300 hover:text-white"
                    >
                      Ayarlar
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3 border border-zinc-800 bg-zinc-900/70 rounded-lg p-4">
              <div className="space-y-1 text-center">
                <h2 className="text-base font-bold text-white">
                  Odanızın Gerçek 3D Simülasyonunu Çıkarın
                </h2>
                <p className="text-xs text-zinc-400">
                  Mevcut koltuk, masa, sıra ve duvarlar fotoğraftaki görüntüsüyle gerçek 3D&apos;ye dönüşür; mobilyaları yalnızca gerçek boş alanlara koyabilirsiniz.
                </p>
              </div>

              <div className="grid grid-cols-2 border border-zinc-800 bg-zinc-950 rounded-lg p-1 gap-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setCaptureMode('video')}
                  className={`py-2 rounded flex items-center justify-center gap-1.5 transition ${
                    captureMode === 'video' ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>15–20 sn Video (Önerilen)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureMode('photos')}
                  className={`py-2 rounded flex items-center justify-center gap-1.5 transition ${
                    captureMode === 'photos' ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>4–16 Fotoğraf</span>
                </button>
              </div>

              {captureMode === 'video' ? (
                <div className="space-y-3">
                  <label className="relative overflow-hidden border border-dashed border-zinc-700 hover:border-white bg-zinc-950/75 rounded-lg p-5 flex flex-col items-center justify-center gap-2 cursor-pointer text-center">
                    <Video className="w-6 h-6 text-emerald-400" />
                    <span className="text-xs font-bold text-white">
                      {extractPct !== null
                        ? `Video kareleri çıkarılıyor (%${extractPct})...`
                        : videoFrames.length > 0
                        ? `${videoFrames.length} kare hazır — değiştirmek için tıklayın`
                        : 'Oda Videosu Çek veya Seç (MP4 / MOV)'}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      Telefonu göz hizasında tutup odanın içinde yavaşça yürüyerek 15–25 saniyelik video çekin; tarayıcı en net 16 HD kareyi ayırır (~5 sn GPU analizi).
                    </span>
                    <input
                      type="file"
                      accept="video/*"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        e.currentTarget.value = '';
                        handleVideoUpload(f);
                      }}
                    />
                  </label>

                  {videoFrames.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span>Çıkarılan Kareler ({videoFrames.length} adet)</span>
                        <button
                          type="button"
                          onClick={() => setVideoFrames([])}
                          className="text-red-300 hover:text-red-200 font-semibold"
                        >
                          Temizle
                        </button>
                      </div>
                      <div className="flex gap-1.5 overflow-x-auto pb-1">
                        {videoFrames.map((vf, i) => (
                          <img
                            key={`vf-${i}`}
                            src={vf.hdDataUrl}
                            alt={`Kare ${i + 1}`}
                            className="w-16 h-12 object-cover rounded border border-zinc-800 shrink-0"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Array.from({
                      length: Math.min(MAX_VIEWS, Math.max(4, views.length + (views.length < MAX_VIEWS ? 1 : 0))),
                    }).map((_, idx) => {
                      const view = views[idx];
                      const slotLabels = ['1. Açı', '2. Açı', '3. Açı', '4. Açı'];
                      const slotTitle = idx < slotLabels.length ? slotLabels[idx] : `${idx + 1}. Açı`;
                      if (view) {
                        return (
                          <div
                            key={view.id}
                            className="relative aspect-[4/3] bg-zinc-950 border border-emerald-500/60 rounded overflow-hidden"
                          >
                            <img src={view.dataUrl} alt={slotTitle} className="w-full h-full object-cover" />
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/80 text-[9px] font-mono rounded text-white">
                              {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => setViews((prev) => prev.filter((item) => item.id !== view.id))}
                              className="absolute top-1 right-1 w-5 h-5 bg-black/80 rounded-full flex items-center justify-center text-white"
                              aria-label="Sil"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      }
                      return (
                        <label
                          key={`slot-${idx}`}
                          className="relative overflow-hidden aspect-[4/3] border border-dashed border-zinc-700 hover:border-white bg-zinc-950/70 rounded flex flex-col items-center justify-center p-1.5 text-center cursor-pointer"
                        >
                          <Camera className="w-4 h-4 text-zinc-400 mb-1" />
                          <span className="text-[10px] font-semibold text-zinc-300 leading-tight">
                            + {slotTitle}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            onChange={(e) => {
                              addFiles(e.target.files);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="relative overflow-hidden py-3 px-3 bg-white text-zinc-950 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-pointer">
                      <Camera className="w-4 h-4" />
                      <span>Kamera ({views.length}/{MAX_VIEWS})</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>

                    <label className="relative overflow-hidden py-3 px-3 border border-zinc-700 hover:border-white text-zinc-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer">
                      <ImageIcon className="w-4 h-4" />
                      <span>Galeriden Çoklu Seç</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={startGpuScan}
                disabled={activeFrameCount < 4 || extractPct !== null || addingPhotos}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-zinc-800 disabled:text-zinc-500 font-bold text-xs sm:text-sm rounded-lg flex items-center justify-center gap-2"
              >
                {extractPct !== null || addingPhotos ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>
                  {extractPct !== null
                    ? `Video İşleniyor (%${extractPct})...`
                    : addingPhotos
                    ? 'Fotoğraflar hazırlanıyor...'
                    : activeFrameCount < 4
                    ? captureMode === 'video'
                      ? 'Devam Etmek İçin 15–20 sn Oda Videosu Seçin'
                      : `En Az 4 Fotoğraf Ekleyin (${activeFrameCount}/4)`
                    : `Gerçek 3D Odamı Oluştur (${activeFrameCount} Kare • Serverless GPU)`}
                </span>
              </button>
            </div>

            {/* Masaüstünden telefona QR geçiş kartı */}
            <div className="hidden sm:flex items-center gap-4 p-4 border border-zinc-800 bg-zinc-900/75 rounded-lg text-left">
              <div className="bg-white p-2 rounded shrink-0">
                <QRCodeSVG value={mobileStudioUrl} size={104} />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-bold text-white">Telefonunuzda Odanızı Çekin veya Yükleyin</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Telefon kamerasıyla QR kodu okutun; 4–5 açılı çekim ve 3D mini-map simülasyonu telefonunuzda açılsın.
                </p>
                <button
                  type="button"
                  onClick={copyMobileStudioUrl}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-zinc-700 hover:border-white rounded text-[11px] font-semibold text-zinc-200 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedLink ? 'Kopyalandı' : 'Linki Kopyala'}</span>
                </button>
              </div>
            </div>

            <div className="sm:hidden space-y-2">
              <button
                type="button"
                onClick={() => setShowMobileQr((v) => !v)}
                className="w-full py-2.5 px-3 border border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 rounded-lg text-[11px] font-semibold text-zinc-300 flex items-center justify-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{showMobileQr ? 'QR Kodu Gizle' : 'Başka Telefonda Açmak İçin QR Kodu Göster'}</span>
              </button>
              {showMobileQr && (
                <div className="p-3.5 border border-zinc-800 bg-zinc-900/80 rounded-lg flex flex-col items-center gap-2.5">
                  <div className="bg-white p-2 rounded">
                    <QRCodeSVG value={mobileStudioUrl} size={136} />
                  </div>
                  <button
                    type="button"
                    onClick={copyMobileStudioUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 rounded text-[11px] font-semibold text-zinc-200"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? 'Kopyalandı' : 'Linki Kopyala'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2 border border-zinc-800 bg-zinc-900/70 rounded-lg p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Fotoğraf Çekmeden Hazır Boş Odada Dene
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
          </div>
        </div>
      )}

      {step === 'reconstructing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
          <p className="text-sm font-semibold">
            {Math.max(activeFrameCount, 4)} kare birleştirilip gerçek 3D oda kuruluyor...
          </p>
          <p className="text-xs text-zinc-400 max-w-xs">{reconstructMsg}</p>
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

      {step === 'studio' && (roomData || scannedRoom) && (
        <>
          {/* Üst Kamera, HD Fotoğraf, Temiz Mimari 3B, Eşya Sil & Mini-Map Sekmeleri */}
          <div className="bg-zinc-900 border-b border-zinc-800 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
            {scannedRoom && scannedRoom.keyframes.length > 0 && scanHdFrames.length > 0 && (
              <button
                onClick={() => {
                  setActiveKeyframeIdx((cur) => (cur !== null ? cur : scannedRoom.bestKeyframeIdx));
                  setActiveCamIdx('free');
                }}
                className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                  activeKeyframeIdx !== null
                    ? 'bg-emerald-500 text-zinc-950'
                    : 'bg-emerald-950/70 border border-emerald-700/70 text-emerald-200 hover:bg-emerald-900/70'
                }`}
              >
                HD Fotoğraf
              </button>
            )}

            <button
              onClick={() => {
                setEraseMode(false);
                setActiveKeyframeIdx(null);
                setActiveCamIdx('free');
              }}
              className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                activeKeyframeIdx === null && activeCamIdx === 'free'
                  ? 'bg-white text-zinc-950'
                  : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              {scannedRoom ? 'Mimari 3B' : 'Serbest 3D'}
            </button>
            <button
              onClick={() => {
                setEraseMode(false);
                setActiveKeyframeIdx(null);
                setActiveCamIdx('top');
              }}
              className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                activeKeyframeIdx === null && activeCamIdx === 'top'
                  ? 'bg-white text-zinc-950'
                  : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              Kuşbakışı
            </button>

            {scannedRoom && activeKeyframeIdx !== null && (
              <>
                <button
                  onClick={() => setEraseMode((v) => !v)}
                  className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    eraseMode ? 'bg-red-500 text-white' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  <Eraser className="w-3 h-3" />
                  <span>{eraseMode ? 'Silgi Açık' : 'Eşya Sil'}</span>
                </button>
                {currentAngleErased && (
                  <button
                    onClick={undoEraseCurrentAngle}
                    className="px-2 py-1 rounded font-semibold flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-amber-300 whitespace-nowrap shrink-0"
                  >
                    <Undo2 className="w-3 h-3" />
                    <span>Geri Al</span>
                  </button>
                )}
                <button
                  onClick={() => setEnableDepthOcc((v) => !v)}
                  className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                    enableDepthOcc ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {enableDepthOcc ? 'Derinlik: Açık' : 'Derinlik: Kapalı'}
                </button>
              </>
            )}

            {scannedRoom && activeKeyframeIdx === null && scannedRoom.archBlocks.length > 0 && (
              <button
                onClick={() => setShowExistingArch((v) => !v)}
                className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                  showExistingArch ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{showExistingArch ? 'Mevcut Eşyalar' : 'Boş Oda'}</span>
              </button>
            )}

            <button
              onClick={() => setShowMiniMap((v) => !v)}
              className={`px-2.5 py-1 rounded font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                showMiniMap ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300'
              }`}
            >
              <Grid3X3 className="w-3 h-3" />
              <span>Mini-Map</span>
            </button>

            {scannedRoom ? (
              <button
                onClick={() => setShowFreeFloor((v) => !v)}
                className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                  showFreeFloor ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                Boş Alan ({(scannedRoom.stats.freeFloorM2 ?? 0).toFixed(1)}m²)
              </button>
            ) : (
              roomData && (
                <>
                  {roomData.cameras.map((cam) => (
                    <button
                      key={cam.index}
                      onClick={() => focusWallAngle(cam.index)}
                      className={`px-2.5 py-1 rounded font-semibold whitespace-nowrap shrink-0 ${
                        previewPhotoIdx === cam.index ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {cam.label}
                    </button>
                  ))}

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
                      Ölçü &amp; Zemin: {roomData.roomWidthM.toFixed(1)}×{roomData.roomDepthM.toFixed(1)}m
                    </span>
                  </button>
                </>
              )
            )}
          </div>

          {/* 3D Zemin Simülasyonu, HD Gerçek Açı, Eşya Sil & İnteraktif 2D Mini-Map */}
          <div
            ref={stageRef}
            className={`relative flex-1 min-h-0 flex items-center justify-center overflow-hidden ${
              activeKf && activeHdUrl ? 'bg-zinc-950' : 'bg-zinc-200'
            }`}
          >
            <div
              style={
                activeKf && activeHdUrl && stageBoxSize
                  ? { width: `${stageBoxSize.w}px`, height: `${stageBoxSize.h}px` }
                  : undefined
              }
              className={`relative overflow-hidden ${activeKf && activeHdUrl && stageBoxSize ? 'shrink-0' : 'w-full h-full'}`}
            >
              {activeKf && activeHdUrl && (
                <img
                  src={activeHdUrl}
                  alt={`Oda HD Açı ${(activeKeyframeIdx ?? 0) + 1}`}
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                />
              )}
              <div
                ref={hostRef}
                className={`relative z-10 w-full h-full ${
                  activeKf && activeHdUrl ? 'cursor-move' : 'cursor-grab active:cursor-grabbing'
                }`}
                onPointerDownCapture={onPointerDownCapture}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleStageDrop}
              />
              {activeKf && activeHdUrl && eraseMode && (
                <canvas
                  ref={brushCanvasRef}
                  className="absolute inset-0 z-20 w-full h-full cursor-crosshair touch-none"
                  onPointerDown={onErasePointerDown}
                  onPointerMove={onErasePointerMove}
                  onPointerUp={onErasePointerUp}
                  onPointerCancel={onErasePointerUp}
                />
              )}
            </div>

            {/* Eşya Sil Modu İpucu Çubuğu */}
            {activeKf && activeHdUrl && eraseMode && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-zinc-950/95 border border-red-500/70 rounded-lg px-3 py-1.5 text-[11px] text-white shadow-xl max-w-[92vw]">
                <Eraser className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="truncate">
                  {erasingBusy
                    ? 'Eski eşya temizleniyor...'
                    : 'Silmek istediğiniz eski eşyanın üzerinden fırçayla geçin'}
                </span>
                <button
                  type="button"
                  onClick={() => setEraseMode(false)}
                  className="px-2 py-0.5 rounded bg-white text-zinc-950 font-bold text-[10px] shrink-0"
                >
                  Bitti
                </button>
              </div>
            )}

            {/* HD Fotoğraf Modunda Görsel Küçük Resimli Açı Seçici */}
            {scannedRoom && activeKf && activeHdUrl && scannedRoom.keyframes.length > 1 && (
              <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-zinc-950/90 border border-zinc-700 rounded-lg p-1.5 shadow-xl max-w-[calc(100%-10rem)]">
                <button
                  type="button"
                  onClick={() => {
                    const n = scannedRoom.keyframes.length;
                    setActiveKeyframeIdx(((activeKeyframeIdx ?? 0) - 1 + n) % n);
                  }}
                  className="w-6 h-10 rounded bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-white flex items-center justify-center shrink-0"
                  aria-label="Önceki açı"
                >
                  ‹
                </button>
                <div className="flex items-center gap-1 overflow-x-auto">
                  {scannedRoom.keyframes.map((kf, kIdx) => {
                    const thumbSrc = erasedHdMap[kf.viewIdx] || scanHdFrames[kf.viewIdx];
                    if (!thumbSrc) return null;
                    const isAct = activeKeyframeIdx === kIdx;
                    return (
                      <button
                        key={`ang-${kf.viewIdx}`}
                        type="button"
                        onClick={() => setActiveKeyframeIdx(kIdx)}
                        className={`relative w-10 h-10 rounded overflow-hidden border transition shrink-0 ${
                          isAct ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-zinc-700 opacity-75 hover:opacity-100'
                        }`}
                        title={`Açı ${kIdx + 1}`}
                      >
                        <img src={thumbSrc} alt={`Açı ${kIdx + 1}`} className="w-full h-full object-cover" />
                        <span
                          className={`absolute bottom-0 right-0 px-1 text-[9px] font-mono font-bold leading-tight ${
                            isAct ? 'bg-emerald-500 text-zinc-950' : 'bg-black/80 text-zinc-200'
                          }`}
                        >
                          {kIdx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const n = scannedRoom.keyframes.length;
                    setActiveKeyframeIdx(((activeKeyframeIdx ?? 0) + 1) % n);
                  }}
                  className="w-6 h-10 rounded bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-white flex items-center justify-center shrink-0"
                  aria-label="Sonraki açı"
                >
                  ›
                </button>
              </div>
            )}

            {/* Açılı Referans Fotoğraf Küçük Penceresi (3D zemini bozmadan) */}
            {previewPhotoIdx !== null && roomData && roomData.cameras[previewPhotoIdx] && (
              <div className="absolute top-3 left-3 w-32 sm:w-44 bg-zinc-950/95 border border-zinc-700 rounded-lg overflow-hidden shadow-2xl z-20">
                <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800 text-[10px] font-semibold text-zinc-200">
                  <span className="truncate">{roomData.cameras[previewPhotoIdx].label}</span>
                  <button
                    type="button"
                    onClick={() => setPreviewPhotoIdx(null)}
                    className="text-zinc-400 hover:text-white shrink-0"
                    aria-label="Referans fotoğrafı kapat"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <img
                  src={roomData.cameras[previewPhotoIdx].photoUrl}
                  alt={roomData.cameras[previewPhotoIdx].label}
                  className="w-full aspect-[4/3] object-cover"
                />
              </div>
            )}

            {/* Canlı 2D Kat Planı / Mini-Map HUD */}
            {showMiniMap && !showSizeBar && (
              <div className="absolute top-3 right-3 z-20 bg-zinc-950/90 border border-zinc-700 rounded-lg p-2 shadow-xl w-32 sm:w-40 select-none">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className="text-[10px] font-mono font-bold text-zinc-200">MİNİ-MAP</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveKeyframeIdx(null);
                      setActiveCamIdx((m) => (m === 'top' ? 'free' : 'top'));
                    }}
                    className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[9px] font-semibold text-zinc-100 whitespace-nowrap"
                  >
                    {activeKeyframeIdx === null && activeCamIdx === 'top' ? '3D' : '2D Plan'}
                  </button>
                </div>
                {(() => {
                  const rw = scannedRoom ? scannedRoom.bounds.halfW * 2 : roomData!.roomWidthM;
                  const rd = scannedRoom ? scannedRoom.bounds.halfD * 2 : roomData!.roomDepthM;
                  const padX = rw * 0.58;
                  const padZ = rd * 0.58;
                  const gxStart = -Math.floor(rw * 0.5);
                  const gxEnd = Math.floor(rw * 0.5);
                  const gzStart = -Math.floor(rd * 0.5);
                  const gzEnd = Math.floor(rd * 0.5);
                  const totalCams = Math.max(4, roomData?.cameras.length || 4);

                  return (
                    <svg viewBox={`${-padX} ${-padZ} ${padX * 2} ${padZ * 2}`} className="w-full h-auto block">
                      <rect
                        x={-rw * 0.5}
                        y={-rd * 0.5}
                        width={rw}
                        height={rd}
                        fill="#18181b"
                        stroke="#71717a"
                        strokeWidth={0.07}
                      />
                      {scannedRoom && miniMapGridUrl && (
                        <image
                          href={miniMapGridUrl}
                          x={-rw * 0.5}
                          y={-rd * 0.5}
                          width={rw}
                          height={rd}
                          preserveAspectRatio="none"
                          opacity={0.9}
                          style={{ imageRendering: 'pixelated' }}
                        />
                      )}
                      {Array.from({ length: Math.max(0, gxEnd - gxStart + 1) }).map((_, k) => {
                        const xLine = gxStart + k;
                        return (
                          <line
                            key={`vx-${xLine}`}
                            x1={xLine}
                            y1={-rd * 0.5}
                            x2={xLine}
                            y2={rd * 0.5}
                            stroke="#27272a"
                            strokeWidth={0.03}
                          />
                        );
                      })}
                      {Array.from({ length: Math.max(0, gzEnd - gzStart + 1) }).map((_, k) => {
                        const zLine = gzStart + k;
                        return (
                          <line
                            key={`hz-${zLine}`}
                            x1={-rw * 0.5}
                            y1={zLine}
                            x2={rw * 0.5}
                            y2={zLine}
                            stroke="#27272a"
                            strokeWidth={0.03}
                          />
                        );
                      })}

                      {visibleItems.map((it) => {
                        const isSel = it.id === selectedId;
                        return (
                          <g
                            key={`mm-${it.id}`}
                            transform={`translate(${it.x}, ${it.z}) rotate(${(-it.rot * 180) / Math.PI})`}
                            onClick={() => {
                              selectedIdRef.current = it.id;
                              setSelectedId(it.id);
                            }}
                            className="cursor-pointer"
                          >
                            <rect
                              x={-it.halfW}
                              y={-it.halfD}
                              width={it.halfW * 2}
                              height={it.halfD * 2}
                              fill={isSel ? '#10b981' : it.isScanned ? '#71717a' : '#e4e4e7'}
                              fillOpacity={isSel ? 0.85 : 0.65}
                              stroke={isSel ? '#ffffff' : '#52525b'}
                              strokeWidth={0.06}
                              rx={0.05}
                            />
                          </g>
                        );
                      })}

                      {scannedRoom
                        ? scannedRoom.cameras.slice(0, 12).map(([cx, cy, cz], idx) => {
                            const kfMatchIdx = scannedRoom.keyframes.findIndex((k) => k.viewIdx === idx);
                            const activePin = kfMatchIdx >= 0 && activeKeyframeIdx === kfMatchIdx;
                            return (
                              <g
                                key={`scan-cam-${idx}`}
                                transform={`translate(${cx}, ${cz})`}
                                onClick={() => {
                                  if (kfMatchIdx >= 0 && scanHdFrames[idx]) {
                                    setActiveKeyframeIdx(kfMatchIdx);
                                    setActiveCamIdx('free');
                                  } else {
                                    setActiveKeyframeIdx(null);
                                    setActiveCamIdx('free');
                                    const s = sceneRef.current;
                                    if (s) {
                                      s.camera.position.set(cx, Math.max(1.35, cy), cz);
                                      s.controls.target.set(0, 0.55, 0);
                                      s.controls.update();
                                    }
                                  }
                                }}
                                className="cursor-pointer"
                              >
                                <circle
                                  r={0.2}
                                  fill={activePin ? '#10b981' : kfMatchIdx >= 0 ? '#059669' : '#27272a'}
                                  stroke="#ffffff"
                                  strokeWidth={0.04}
                                />
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fill="#ffffff"
                                  fontSize={0.2}
                                  fontWeight="bold"
                                >
                                  {idx + 1}
                                </text>
                              </g>
                            );
                          })
                        : roomData?.cameras.map((cam) => {
                            const yaw = (cam.index / totalCams) * Math.PI * 2;
                            const cx = -Math.sin(yaw) * rw * 0.45;
                            const cz = Math.cos(yaw) * rd * 0.45;
                            const activePin = previewPhotoIdx === cam.index;
                            return (
                              <g
                                key={`pin-${cam.index}`}
                                transform={`translate(${cx}, ${cz})`}
                                onClick={() => focusWallAngle(cam.index)}
                                className="cursor-pointer"
                              >
                                <circle
                                  r={0.26}
                                  fill={activePin ? '#10b981' : '#27272a'}
                                  stroke="#ffffff"
                                  strokeWidth={0.05}
                                />
                                <text
                                  textAnchor="middle"
                                  dominantBaseline="central"
                                  fill="#ffffff"
                                  fontSize={0.26}
                                  fontWeight="bold"
                                >
                                  {cam.index + 1}
                                </text>
                              </g>
                            );
                          })}
                    </svg>
                  );
                })()}
              </div>
            )}

            {(loadingCount > 0 || uploadingCad) && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/85 border border-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 pointer-events-none z-20">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                <span>{uploadingCad ? '3D model dönüştürülüyor...' : 'Mobilya yükleniyor...'}</span>
              </div>
            )}

            {/* Boş Oda Başlangıç Hızlı Ekleme Paneli */}
            {visibleItems.length === 0 && !drawerMode && !showClipBar && !showSizeBar && (
              <div className="absolute bottom-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-max bg-zinc-950/92 border border-zinc-700 rounded-lg px-3.5 py-2.5 flex flex-col sm:flex-row items-center gap-2.5 shadow-xl z-20">
                <span className="text-xs text-zinc-200 font-medium">
                  3D simülasyon zemini hazır — mobilya ekleyin ve sürükleyip yerleştirin
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
                    Katalog ({allProducts.length})
                  </button>
                </div>
              </div>
            )}

            {/* Oda Ölçü & Zemin Tipi Ayarı Popover */}
            {showSizeBar && roomData && (
              <div className="absolute top-3 left-3 right-3 sm:left-auto sm:w-80 bg-zinc-950/95 border border-zinc-700 rounded-lg p-3 space-y-3 z-20 shadow-xl">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold">Oda Ölçüleri &amp; Zemin</span>
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
                <div className="space-y-1.5 pt-2 border-t border-zinc-800">
                  <span className="text-[11px] text-zinc-400 block">Zemin Kaplaması</span>
                  <div className="grid grid-cols-3 gap-1.5 text-[11px] font-semibold">
                    {(
                      [
                        { id: 'tile', label: 'Seramik Karo' },
                        { id: 'wood', label: 'Ahşap Parke' },
                        { id: 'matte', label: 'Düz Zemin' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => switchFloorStyle(opt.id)}
                        className={`py-1.5 px-2 rounded border ${
                          floorStyle === opt.id
                            ? 'bg-white text-zinc-950 border-white'
                            : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
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
              <div className="absolute top-14 left-1/2 -translate-x-1/2 w-max max-w-[90%] text-center bg-black/90 border border-zinc-700 px-3.5 py-2 rounded-lg text-xs font-medium text-white shadow-xl pointer-events-none z-30">
                {toastMsg}
              </div>
            )}

            {drawerMode && (
              <div className="absolute bottom-0 left-0 right-0 z-30 bg-zinc-900/98 border-t border-zinc-700 p-3 space-y-2.5 shadow-2xl">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white shrink-0">
                      {drawerMode === 'swap' ? 'Seçili Ürünü Değiştir' : `Odaya Ürün Ekle (${drawerProducts.length})`}
                    </span>
                    <label className="relative overflow-hidden px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0">
                      <Upload className="w-3 h-3" />
                      <span>+ 3D Model (.GLB/.OBJ/.STL)</span>
                      <input
                        type="file"
                        accept=".glb,.gltf,.obj,.stl"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          const f = e.target.files?.[0] || null;
                          e.currentTarget.value = '';
                          handleCustomCadUpload(f);
                        }}
                      />
                    </label>
                  </div>
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
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                      }}
                      onClick={() => pickProductFromDrawer(p)}
                      className="w-36 shrink-0 border border-zinc-700 hover:border-white bg-zinc-950 rounded-lg p-2 text-left transition flex flex-col justify-between gap-1.5 cursor-grab active:cursor-grabbing"
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
                        <p className="text-[9px] text-emerald-400 mt-0.5">Tıkla veya sahneye sürükle</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Kumaş / Renk Seçimi + 2 Satırlı Kompakt Mobil Alt Kontroller */}
          <div className="shrink-0 border-t border-zinc-800 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-1.5 bg-zinc-950">
            {selectedItem?.product?.swatches && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[11px] text-zinc-400 shrink-0">Kumaş:</span>
                {selectedItem.product.swatches.map((sw) => {
                  const active = (selectedItem.colorHex || selectedItem.product!.swatches![0].hex) === sw.hex;
                  return (
                    <button
                      key={sw.name}
                      type="button"
                      onClick={() => changeItemColor(sw.hex)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border whitespace-nowrap shrink-0 ${
                        active ? 'border-white bg-zinc-800 text-white' : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: sw.hex }} />
                      <span>{sw.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

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
                  <span>{emptyRoom ? 'Mevcut Eşyaları Göster' : 'Mevcut Eşyaları Gizle'}</span>
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

              {roomData && (
                <button
                  onClick={() =>
                    setWallMode((m) => (m === 'auto' ? 'all' : m === 'all' ? 'floor' : 'auto'))
                  }
                  className="flex-1 py-2 px-2 rounded-lg bg-zinc-800 text-zinc-200 font-semibold flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>{wallMode === 'auto' ? 'Duvar: Akıllı' : wallMode === 'all' ? '4 Duvar' : 'Sadece Zemin'}</span>
                </button>
              )}

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
