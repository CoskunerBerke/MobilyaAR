import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Camera,
  Copy,
  Download,
  Eraser,
  ImageIcon,
  Info,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { Product } from '../lib/products';
import { analyzeRoom, buildShareUrl, eraseObjectInRoom, type RoomAnalysis } from '../lib/server';
import {
  buildCalibratedRoomAnalysis,
  buildClientPhotoAnalysis,
  DEMO_PHOTO_ROOMS,
  type DemoPhotoRoom,
} from '../lib/demoRooms';
import { buildContactShadow } from '../lib/contactShadow';
import {
  buildRoomEnvironment,
  loadHtmlImage,
  normalizeRoomPhoto,
  preparePhotorealMaterial,
} from '../lib/roomRendering';

interface Props {
  product: Product;
  products: Product[];
  serverUrl: string;
  serverOnline?: boolean;
  initialDemoRoomId?: DemoPhotoRoom['id'];
  initialColorHex?: string;
  onBack: () => void;
}

interface PlacedItem {
  id: string;
  product: Product;
  x: number;
  z: number;
  rot: number;
  colorHex?: string;
}

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

type Step = 'capture' | 'analyzing' | 'design' | 'error';

/** RGBA8 texture — tüm mobil GPU'larda (iOS WebKit & Android) uzantı gerektirmez. */
async function decodeDepthTexture(a: RoomAnalysis): Promise<THREE.Texture> {
  const img = await loadHtmlImage(a.depthMap);
  const tex = new THREE.Texture(img);
  tex.flipY = false;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Odadaki gerçek eşyalar ürünün önündeyse ürünü örter (mm derinlik karşılaştırması). */
function patchOcclusion(
  mat: THREE.Material,
  uniforms: {
    uDepthTex: { value: THREE.Texture | null };
    uRes: { value: THREE.Vector2 };
    uRoomScale: { value: number };
  }
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDepthTex = uniforms.uDepthTex;
    shader.uniforms.uRes = uniforms.uRes;
    shader.uniforms.uRoomScale = uniforms.uRoomScale;
    shader.fragmentShader =
      'uniform sampler2D uDepthTex;\nuniform vec2 uRes;\nuniform float uRoomScale;\n' +
      shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          vec2 sUv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
          vec4 dS = texture2D(uDepthTex, sUv);
          float hi = floor(dS.r * 255.0 + 0.5);
          float lo = floor(dS.g * 255.0 + 0.5);
          float roomDepthM = (hi * 256.0 + lo) * 0.001 * uRoomScale;
          if (dS.b < 0.5 && roomDepthM > 0.15 && roomDepthM < vViewPosition.z - 0.15) discard;
        }`
      );
  };
  mat.needsUpdate = true;
}

function computeSpawnPoint(camera: THREE.PerspectiveCamera, ndcY = -0.22) {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, ndcY), camera);
  const hit = new THREE.Vector3();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  if (rc.ray.intersectPlane(floorPlane, hit) && Number.isFinite(hit.x) && Number.isFinite(hit.z)) {
    const dist = Math.hypot(hit.x, hit.z);
    if (dist > 0.1) {
      const clamped = Math.min(4.8, Math.max(1.85, dist));
      const s = clamped / dist;
      const x = hit.x * s;
      const z = hit.z * s;
      return { x, z, rot: Math.atan2(-x, -z) };
    }
  }
  return { x: 0, z: -2.6, rot: 0 };
}

export const RoomDesigner: React.FC<Props> = ({
  product,
  products,
  serverUrl,
  serverOnline = false,
  initialDemoRoomId,
  initialColorHex,
  onBack,
}) => {
  const [step, setStep] = useState<Step>('capture');
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RoomAnalysis | null>(null);
  const [undoStack, setUndoStack] = useState<Array<{ photo: string; analysis: RoomAnalysis }>>([]);

  const [items, setItems] = useState<PlacedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCount, setLoadingCount] = useState(0);

  const [showInfo, setShowInfo] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'add' | 'swap' | null>(null);
  const [eraseMode, setEraseMode] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sizePct, setSizePct] = useState(100);
  const [isClientFallback, setIsClientFallback] = useState(false);
  const [pitchDeg, setPitchDeg] = useState(13);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const mobilePhotoUrl = buildShareUrl({
    productId: product.id,
    glbUrl: product.glbUrl,
    productName: product.name,
    dimensionsCm: product.dimensionsCm,
    mode: 'photo',
    colorHex: initialColorHex,
    serverOnline,
    serverUrl,
  });

  const copyMobilePhotoUrl = () => {
    navigator.clipboard?.writeText(mobilePhotoUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const itemsRef = useRef<PlacedItem[]>([]);
  itemsRef.current = items;
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const eraseModeRef = useRef(false);
  eraseModeRef.current = eraseMode;
  const sizePctRef = useRef(100);
  sizePctRef.current = sizePct;
  const exifFocalRef = useRef<number | undefined>(undefined);
  const defaultSpawnRef = useRef<{ x: number; z: number; rot: number } | null>(null);

  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    itemsRoot: THREE.Group;
    groups: Map<string, { url: string; root: THREE.Group }>;
    ring: THREE.Mesh;
    hemi: THREE.HemisphereLight;
    light: THREE.DirectionalLight;
    occl: {
      uDepthTex: { value: THREE.Texture | null };
      uRes: { value: THREE.Vector2 };
      uRoomScale: { value: number };
    };
    photoImg: HTMLImageElement;
    envTex: THREE.Texture | null;
    gltfCache: Map<string, THREE.Group>;
    loadingKeys: Set<string>;
  } | null>(null);

  const alive = useRef(true);
  const initializing = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const disposeScene = useCallback(() => {
    const t = three.current;
    if (!t) return;
    t.occl.uDepthTex.value?.dispose();
    t.envTex?.dispose();
    t.renderer.dispose();
    three.current = null;
  }, []);

  // ---- 1) Hazır Demo Oda Yükleme & Fotoğraf Analizi ----
  const loadDemoRoom = useCallback(
    (demo: DemoPhotoRoom) => {
      disposeScene();
      setItems([]);
      setSelectedId(null);
      setUndoStack([]);
      setEraseMode(false);
      setDrawerMode(null);
      setIsClientFallback(false);
      sizePctRef.current = 100;
      setSizePct(100);
      setPitchDeg(demo.pitchDownDeg);
      defaultSpawnRef.current = demo.defaultSpawn;
      setPhoto(demo.imageUrl);
      setAnalysis(buildCalibratedRoomAnalysis(demo));
      setStep('design');
    },
    [disposeScene]
  );

  useEffect(() => {
    if (!initialDemoRoomId) return;
    const found = DEMO_PHOTO_ROOMS.find((r) => r.id === initialDemoRoomId);
    if (found) loadDemoRoom(found);
  }, [initialDemoRoomId, loadDemoRoom]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    disposeScene();
    setItems([]);
    setSelectedId(null);
    setUndoStack([]);
    setEraseMode(false);
    setDrawerMode(null);
    defaultSpawnRef.current = null;
    sizePctRef.current = 100;
    setSizePct(100);
    setStep('analyzing');
    try {
      const { dataUrl, exifFocal35mm } = await normalizeRoomPhoto(file, 1600);
      exifFocalRef.current = exifFocal35mm;
      setPhoto(dataUrl);

      if (serverOnline) {
        try {
          const a = await analyzeRoom(serverUrl, dataUrl, exifFocal35mm);
          setIsClientFallback(false);
          setPitchDeg(Math.round(a.pitchDownDeg));
          setAnalysis(a);
          setStep('design');
          return;
        } catch (srvErr) {
          const msg = srvErr instanceof Error ? srvErr.message : '';
          // Sunucu ulaşılamıyorsa veya zaman aşımıysa tarayıcı kalibrasyonuna düş; ölçüm reddiyse kullanıcıya göster
          if (msg.includes('Fotoğrafta yeterince zemin') || msg.includes('Zemin düzlemi bulunamadı')) {
            throw srvErr;
          }
        }
      }

      const img = await loadHtmlImage(dataUrl);
      const fallback = buildClientPhotoAnalysis(img.naturalWidth || 1280, img.naturalHeight || 960, exifFocal35mm);
      setIsClientFallback(true);
      setPitchDeg(Math.round(fallback.pitchDownDeg));
      setAnalysis(fallback);
      setStep('design');
      showToast('Hızlı demo kalibrasyonu aktif — Boyut ve Eğim ile ince ayar yapabilirsiniz');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Oda analiz edilemedi');
      setStep('error');
    }
  };

  // ---- 2) Ekrana sığdırma (fotoğraf oranı korunur, kırpma YOK) ----
  useEffect(() => {
    if (step !== 'design' || !analysis || !stageRef.current) return;
    const el = stageRef.current;
    const fit = () => {
      const aw = el.clientWidth;
      const ah = el.clientHeight;
      const ar = analysis.imageWidth / analysis.imageHeight;
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
  }, [step, analysis]);

  const renderScene = useCallback(() => {
    const t = three.current;
    if (!t) return;

    const currentItems = itemsRef.current;
    let avgX = 0;
    let avgZ = -2.5;
    if (currentItems.length > 0) {
      avgX = currentItems.reduce((s, it) => s + it.x, 0) / currentItems.length;
      avgZ = currentItems.reduce((s, it) => s + it.z, 0) / currentItems.length;
    }

    for (const it of currentItems) {
      const grp = t.groups.get(it.id)?.root;
      if (grp) {
        grp.position.set(it.x, 0, it.z);
        grp.rotation.set(0, it.rot, 0);
      }
    }

    const sel = currentItems.find((i) => i.id === selectedIdRef.current);
    if (sel && !eraseModeRef.current) {
      t.ring.visible = true;
      t.ring.position.set(sel.x, 0.003, sel.z);
    } else {
      t.ring.visible = false;
    }

    t.light.target.position.set(avgX, 0, avgZ);
    t.light.position.set(avgX + (t.light.userData.ox || 0), 4.8, avgZ + 1.6);
    t.light.target.updateMatrixWorld();
    t.renderer.render(t.scene, t.camera);
  }, []);

  // ---- 3) 3D sahneyi sunucunun ölçtüğü kamerayla BİREBİR kur (ve oda güncellendiğinde sahneyi koru) ----
  useEffect(() => {
    if (step !== 'design' || !analysis || !photo || !canvasHostRef.current || disp.w === 0) return;

    // Sahne zaten kuruluysa (örn. Eşya Sil / Geri Al sonrası): sadece kamera, ışık ve derinlik haritasını güncelle!
    if (three.current) {
      (async () => {
        const t = three.current;
        if (!t) return;
        const [photoImg, depthTex] = await Promise.all([loadHtmlImage(photo), decodeDepthTexture(analysis)]);
        if (!alive.current || !three.current) return;

        t.camera.fov = analysis.vfovDeg;
        t.camera.aspect = analysis.imageWidth / analysis.imageHeight;
        t.camera.updateProjectionMatrix();
        const b = analysis.cameraBasis;
        const basis = new THREE.Matrix4().makeBasis(
          new THREE.Vector3(...(b.right as [number, number, number])),
          new THREE.Vector3(...(b.up as [number, number, number])),
          new THREE.Vector3(...(b.back as [number, number, number]))
        );
        const roomScale = 100 / sizePctRef.current;
        t.camera.quaternion.setFromRotationMatrix(basis);
        t.camera.position.set(0, analysis.cameraHeightM * roomScale, 0);
        t.camera.updateMatrixWorld(true);

        t.occl.uDepthTex.value?.dispose();
        t.occl.uDepthTex.value = depthTex;
        t.occl.uRoomScale.value = roomScale;
        t.photoImg = photoImg;

        const lt = buildRoomEnvironment(photoImg, t.renderer);
        t.envTex?.dispose();
        t.envTex = lt.env;
        t.scene.environment = lt.env;
        t.renderer.toneMappingExposure = 0.84 + lt.lum * 0.42;
        t.hemi.color.copy(lt.sky);
        t.hemi.groundColor.copy(lt.ground);
        t.light.intensity = 1.2 + lt.lum * 0.85;
        t.light.userData.ox = lt.sideBias * 5.5;
        renderScene();
      })();
      return;
    }

    if (initializing.current) return;
    initializing.current = true;

    (async () => {
      const [photoImg, depthTex] = await Promise.all([loadHtmlImage(photo), decodeDepthTexture(analysis)]);
      initializing.current = false;
      if (!alive.current || !canvasHostRef.current) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(disp.w, disp.h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x000000, 0);
      canvasHostRef.current.innerHTML = '';
      canvasHostRef.current.appendChild(renderer.domElement);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.touchAction = 'none';

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        analysis.vfovDeg,
        analysis.imageWidth / analysis.imageHeight,
        0.05,
        60
      );
      const b = analysis.cameraBasis;
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...(b.right as [number, number, number])),
        new THREE.Vector3(...(b.up as [number, number, number])),
        new THREE.Vector3(...(b.back as [number, number, number]))
      );
      const roomScale = 100 / sizePctRef.current;
      camera.quaternion.setFromRotationMatrix(basis);
      camera.position.set(0, analysis.cameraHeightM * roomScale, 0);
      camera.updateMatrixWorld(true);

      const lt = buildRoomEnvironment(photoImg, renderer);
      scene.environment = lt.env;
      renderer.toneMappingExposure = 0.84 + lt.lum * 0.42;
      const hemi = new THREE.HemisphereLight(lt.sky, lt.ground, 0.65);
      scene.add(hemi);

      const light = new THREE.DirectionalLight(0xfffaf2, 1.2 + lt.lum * 0.85);
      light.userData.ox = lt.sideBias * 5.5;
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.left = -4;
      light.shadow.camera.right = 4;
      light.shadow.camera.top = 4;
      light.shadow.camera.bottom = -4;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 14;
      light.shadow.bias = -0.0003;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 6;
      scene.add(light);
      scene.add(light.target);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
        new THREE.ShadowMaterial({ opacity: 0.34 })
      );
      floor.receiveShadow = true;
      floor.userData.isHelper = true;
      scene.add(floor);

      // Seçili eşya altındaki ince halka (Kaydet sırasında gizlenir)
      const ringGeo = new THREE.RingGeometry(0.45, 0.49, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.renderOrder = 2;
      ring.visible = false;
      ring.userData.isHelper = true;
      scene.add(ring);

      const itemsRoot = new THREE.Group();
      scene.add(itemsRoot);

      const uRes = { value: new THREE.Vector2() };
      renderer.getDrawingBufferSize(uRes.value);
      const occl = {
        uDepthTex: { value: depthTex },
        uRes,
        uRoomScale: { value: roomScale },
      };

      three.current = {
        renderer,
        scene,
        camera,
        itemsRoot,
        groups: new Map(),
        ring,
        hemi,
        light,
        occl,
        photoImg,
        envTex: lt.env,
        gltfCache: new Map(),
        loadingKeys: new Set(),
      };

      // İlk ürünü fotoğrafın orta-alt zeminine koy (veya hazır demo oda koordinatına oturt)
      if (itemsRef.current.length === 0) {
        const sp = defaultSpawnRef.current || computeSpawnPoint(camera, -0.22);
        const firstId = `it-${Date.now()}`;
        const defaultHex = initialColorHex || product.swatches?.[0]?.hex;
        setItems([{ id: firstId, product, x: sp.x, z: sp.z, rot: sp.rot, colorHex: defaultHex }]);
        setSelectedId(firstId);
      }

      renderScene();
    })();
  }, [step, analysis, photo, disp.w, disp.h, product, initialColorHex, renderScene]);

  // ---- 4) items[] dizisini Three.js gruplarıyla senkronize et ----
  useEffect(() => {
    const t = three.current;
    if (!t || step !== 'design') return;

    const activeIds = new Set(items.map((i) => i.id));
    for (const [id, entry] of t.groups.entries()) {
      if (!activeIds.has(id)) {
        t.itemsRoot.remove(entry.root);
        t.groups.delete(id);
      } else {
        const curItem = items.find((i) => i.id === id);
        if (curItem && curItem.product.glbUrl !== entry.url) {
          t.itemsRoot.remove(entry.root);
          t.groups.delete(id);
        }
      }
    }

    const mountInstance = (item: PlacedItem, template: THREE.Group) => {
      if (!three.current || t.groups.has(item.id)) return;
      const model = template.clone(true);
      const maxAniso = t.renderer.capabilities.getMaxAnisotropy();
      const isFabricCat = item.product.category === 'Kanepe' || item.product.category === 'Berjer';

      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.instanceId = item.id;

        const mats = Array.isArray(m.material) ? m.material.map((mt) => mt.clone()) : [m.material.clone()];
        mats.forEach((mt) => {
          preparePhotorealMaterial(mt, maxAniso, isFabricCat);
          patchOcclusion(mt, t.occl);
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      });

      // 1:1 gerçek ölçü: ölçekleme YOK. Tabanı y=0'a oturt, X/Z merkezle.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const c = new THREE.Vector3();
      box.getCenter(c);
      model.position.x -= c.x;
      model.position.y -= box.min.y;
      model.position.z -= c.z;

      const root = new THREE.Group();
      root.userData.instanceId = item.id;
      root.add(model);
      const shadow = buildContactShadow(model);
      shadow.userData.isHelper = true;
      root.add(shadow);

      root.position.set(item.x, 0, item.z);
      root.rotation.set(0, item.rot, 0);
      applyFabricSwatch(root, item.colorHex);
      t.groups.set(item.id, { url: item.product.glbUrl, root });
      t.itemsRoot.add(root);
      renderScene();
    };

    for (const item of items) {
      if (t.groups.has(item.id)) continue;
      const cached = t.gltfCache.get(item.product.glbUrl);
      if (cached) {
        mountInstance(item, cached);
        continue;
      }
      const key = `${item.id}:${item.product.glbUrl}`;
      if (t.loadingKeys.has(key)) continue;
      t.loadingKeys.add(key);
      setLoadingCount((cnt) => cnt + 1);

      new GLTFLoader().load(
        item.product.glbUrl,
        (gltf) => {
          t.loadingKeys.delete(key);
          setLoadingCount((cnt) => Math.max(0, cnt - 1));
          if (!alive.current || !three.current) return;
          t.gltfCache.set(item.product.glbUrl, gltf.scene);
          mountInstance(item, gltf.scene);
        },
        undefined,
        () => {
          t.loadingKeys.delete(key);
          setLoadingCount((cnt) => Math.max(0, cnt - 1));
          showToast(`${item.product.name} yüklenemedi`);
        }
      );
    }

    renderScene();
  }, [items, selectedId, eraseMode, step, renderScene, showToast]);

  // Boyut değişince yeniden boyutlandır
  useEffect(() => {
    const t = three.current;
    if (!t || disp.w === 0) return;
    t.renderer.setSize(disp.w, disp.h);
    t.renderer.getDrawingBufferSize(t.occl.uRes.value);
    renderScene();
  }, [disp.w, disp.h, renderScene]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      disposeScene();
    };
  }, [disposeScene]);

  // ---- 5) Etkileşim: Dokunarak Seç / Sürükle / İki Parmakla Döndür VEYA AI Eşya Sil ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: string; hx: number; hz: number; px: number; pz: number } | null>(null);
  const twist = useRef<{ id: string; a: number; rot: number } | null>(null);

  const floorHit = (cx: number, cy: number) => {
    const t = three.current;
    const host = canvasHostRef.current;
    if (!t || !host) return null;
    const r = host.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, t.camera);
    const h = new THREE.Vector3();
    return rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), h) ? h : null;
  };

  const angleOf = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };

  const handleTapErase = async (cx: number, cy: number) => {
    const host = canvasHostRef.current;
    if (!host || !photo || !analysis || erasing) return;
    if (!serverOnline) {
      setEraseMode(false);
      showToast('AI eşya silme canlı GPU sunucusu açıkken çalışır');
      return;
    }
    const r = host.getBoundingClientRect();
    const tapU = Math.min(1, Math.max(0, (cx - r.left) / r.width));
    const tapV = Math.min(1, Math.max(0, (cy - r.top) / r.height));

    setErasing(true);
    try {
      const res = await eraseObjectInRoom(serverUrl, {
        image: photo,
        tapU,
        tapV,
        exifFocal35mm: exifFocalRef.current,
      });
      setUndoStack((prev) => [...prev, { photo, analysis }]);
      setPhoto(res.cleanedImage);
      setAnalysis(res.analysis);
      setEraseMode(false);
      showToast(`${res.erasedLabel} odadan temizlendi`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Eşya silinemedi');
    } finally {
      setErasing(false);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (eraseMode) {
      handleTapErase(e.clientX, e.clientY);
      return;
    }

    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const t = three.current;
    const host = canvasHostRef.current;
    if (!t || !host) return;

    if (pointers.current.size === 1) {
      const r = host.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, t.camera);
      const hits = rc.intersectObjects(t.itemsRoot.children, true);
      const meshHit = hits.find((h) => !h.object.userData?.isHelper && h.object.userData?.instanceId);

      let targetId = selectedIdRef.current;
      if (meshHit) {
        targetId = meshHit.object.userData.instanceId as string;
        if (targetId !== selectedIdRef.current) {
          setSelectedId(targetId);
          selectedIdRef.current = targetId;
        }
      }

      const targetItem = itemsRef.current.find((i) => i.id === targetId);
      const fh = floorHit(e.clientX, e.clientY);
      if (targetItem && fh) {
        drag.current = { id: targetItem.id, hx: fh.x, hz: fh.z, px: targetItem.x, pz: targetItem.z };
      } else {
        drag.current = null;
      }
      renderScene();
    } else if (pointers.current.size === 2) {
      drag.current = null;
      const targetItem = itemsRef.current.find((i) => i.id === selectedIdRef.current);
      if (targetItem) {
        twist.current = { id: targetItem.id, a: angleOf(), rot: targetItem.rot };
      }
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (eraseMode || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && twist.current) {
      const nextRot = twist.current.rot - (angleOf() - twist.current.a);
      const tid = twist.current.id;
      itemsRef.current = itemsRef.current.map((it) => (it.id === tid ? { ...it, rot: nextRot } : it));
      setItems(itemsRef.current);
      renderScene();
    } else if (drag.current) {
      const h = floorHit(e.clientX, e.clientY);
      if (!h) return;
      const nx = drag.current.px + (h.x - drag.current.hx);
      const nz = drag.current.pz + (h.z - drag.current.hz);
      if (Math.hypot(nx, nz) < 0.65 || Math.hypot(nx, nz) > 14) return;
      const did = drag.current.id;
      itemsRef.current = itemsRef.current.map((it) => (it.id === did ? { ...it, x: nx, z: nz } : it));
      renderScene();
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) twist.current = null;
    if (pointers.current.size === 0) {
      if (drag.current) {
        setItems([...itemsRef.current]);
      }
      drag.current = null;
    }
  };

  const rotateBy = (deg: number) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const dRad = (deg * Math.PI) / 180;
    const updated = itemsRef.current.map((it) => (it.id === sid ? { ...it, rot: it.rot + dRad } : it));
    itemsRef.current = updated;
    setItems(updated);
    renderScene();
  };

  const removeSelected = () => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const next = itemsRef.current.filter((it) => it.id !== sid);
    itemsRef.current = next;
    setItems(next);
    const nextSel = next[next.length - 1]?.id || null;
    selectedIdRef.current = nextSel;
    setSelectedId(nextSel);
    renderScene();
  };

  const changeSizePct = (nextPct: number) => {
    const clamped = Math.min(135, Math.max(70, Math.round(nextPct)));
    const prevPct = sizePctRef.current;
    if (clamped === prevPct) return;
    const prevRoomScale = 100 / prevPct;
    const nextRoomScale = 100 / clamped;
    const ratio = nextRoomScale / prevRoomScale;

    const updated = itemsRef.current.map((it) => ({
      ...it,
      x: it.x * ratio,
      z: it.z * ratio,
    }));
    itemsRef.current = updated;
    sizePctRef.current = clamped;
    setItems(updated);
    setSizePct(clamped);

    const t = three.current;
    if (t && analysis) {
      t.camera.position.set(0, analysis.cameraHeightM * nextRoomScale, 0);
      t.camera.updateMatrixWorld(true);
      t.occl.uRoomScale.value = nextRoomScale;
      renderScene();
    }
  };

  const changePitchDeg = (nextDeg: number) => {
    const clamped = Math.min(35, Math.max(2, Math.round(nextDeg)));
    setPitchDeg(clamped);
    const t = three.current;
    if (!t || !analysis) return;
    const rad = (clamped * Math.PI) / 180;
    const cosT = Math.cos(rad);
    const sinT = Math.sin(rad);
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, cosT, -sinT),
      new THREE.Vector3(0, sinT, cosT)
    );
    t.camera.quaternion.setFromRotationMatrix(basis);
    t.camera.updateMatrixWorld(true);
    setAnalysis({ ...analysis, pitchDownDeg: clamped });
    renderScene();
  };

  const changeItemColor = (hex: string) => {
    const sid = selectedIdRef.current;
    if (!sid) return;
    const updated = itemsRef.current.map((it) => (it.id === sid ? { ...it, colorHex: hex } : it));
    itemsRef.current = updated;
    setItems(updated);
    const t = three.current;
    const grp = t?.groups.get(sid)?.root;
    if (grp) {
      applyFabricSwatch(grp, hex);
      renderScene();
    }
  };

  const pickProductFromDrawer = (prod: Product) => {
    if (drawerMode === 'swap' && selectedIdRef.current) {
      const sid = selectedIdRef.current;
      const updated = itemsRef.current.map((it) =>
        it.id === sid ? { ...it, product: prod, colorHex: prod.swatches?.[0]?.hex } : it
      );
      itemsRef.current = updated;
      setItems(updated);
      setDrawerMode(null);
      setEraseMode(false);
      showToast(`${prod.name} ile değiştirildi`);
      return;
    }

    const t = three.current;
    const sp = t ? computeSpawnPoint(t.camera, -0.22) : { x: 0, z: -2.6, rot: 0 };
    let spawnX = sp.x;
    const spawnZ = sp.z;
    const spawnRot = sp.rot;

    // Var olan ürünlerin tam üstüne binmemesi için boş yan nokta bul
    const offsets = [0, 0.75, -0.75, 1.35, -1.35, 0.35, -0.35];
    for (const ox of offsets) {
      const candX = spawnX + ox;
      const busy = itemsRef.current.some((it) => Math.hypot(it.x - candX, it.z - spawnZ) < 0.48);
      if (!busy) {
        spawnX = candX;
        break;
      }
    }

    const newId = `it-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const nextItem: PlacedItem = {
      id: newId,
      product: prod,
      x: spawnX,
      z: spawnZ,
      rot: spawnRot,
      colorHex: prod.swatches?.[0]?.hex,
    };
    const nextList = [...itemsRef.current, nextItem];
    itemsRef.current = nextList;
    selectedIdRef.current = newId;
    setItems(nextList);
    setSelectedId(newId);
    setDrawerMode(null);
    setEraseMode(false);
  };

  const handleUndoErase = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setPhoto(prev.photo);
    setAnalysis(prev.analysis);
    showToast('Önceki oda görüntüsüne dönüldü');
  };

  // ---- 6) Fotoğrafı kaydet (seçim halkası gizli, tam çözünürlük) ----
  const save = async () => {
    const t = three.current;
    if (!t || !analysis) return;
    setSaving(true);
    try {
      const W = analysis.imageWidth;
      const H = analysis.imageHeight;
      const dpr = t.renderer.getPixelRatio();
      const prevRingVis = t.ring.visible;
      t.ring.visible = false;

      t.renderer.setPixelRatio(1);
      t.renderer.setSize(W, H, false);
      t.renderer.getDrawingBufferSize(t.occl.uRes.value);
      t.renderer.render(t.scene, t.camera);

      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(t.photoImg, 0, 0, W, H);
      ctx.drawImage(t.renderer.domElement, 0, 0, W, H);

      t.renderer.setPixelRatio(dpr);
      t.renderer.setSize(disp.w, disp.h);
      t.renderer.getDrawingBufferSize(t.occl.uRes.value);
      t.ring.visible = prevRingVis;
      renderScene();

      const a = document.createElement('a');
      a.href = out.toDataURL('image/jpeg', 0.92);
      a.download = `odamda-tasarim-${Date.now()}.jpg`;
      a.click();
    } finally {
      setSaving(false);
    }
  };

  const selectedItem = items.find((i) => i.id === selectedId) || null;
  const suspicious =
    analysis && (analysis.cameraHeightM < 0.6 || analysis.cameraHeightM > 2.4 || analysis.floorInlierRatio < 0.35);

  return (
    <div className="fixed inset-0 h-[100dvh] z-50 bg-zinc-950 text-white flex flex-col">
      <header className="h-14 px-3 flex items-center justify-between gap-2 border-b border-zinc-800 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold whitespace-nowrap shrink-0">
          <ArrowLeft className="w-4 h-4" />
          <span>Geri</span>
        </button>
        <div className="min-w-0 text-center">
          <p className="text-xs font-bold truncate">
            {selectedItem ? selectedItem.product.name : 'Oda Tasarımı'}
          </p>
          <p className="text-[10px] text-zinc-400 font-mono">
            {selectedItem ? selectedItem.product.dimensionsCm : `${items.length} ürün odada`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {undoStack.length > 0 && (
            <button
              onClick={handleUndoErase}
              className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-zinc-800 rounded text-zinc-200 whitespace-nowrap"
              title="Orijinal Odaya Dön"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Geri Al</span>
            </button>
          )}
          {step === 'design' && (
            <button
              type="button"
              onClick={() => setStep('capture')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-100 whitespace-nowrap shrink-0"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Yeni Oda</span>
            </button>
          )}
          <button
            onClick={() => setShowInfo((v) => !v)}
            disabled={!analysis}
            className="p-2 text-zinc-300 disabled:opacity-30 shrink-0"
            aria-label="Ölçüm bilgisi"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {step === 'capture' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="min-h-full flex flex-col justify-center max-w-lg w-full mx-auto space-y-5 text-center py-2">
            <div className="space-y-2">
              <h2 className="text-lg font-bold">Kendi odanı yükle veya örnek salonda dene</h2>
              <p className="text-xs text-zinc-400">
                1:1 gerçek ölçülü ürünü zemine oturtun, sürükleyin ve iki parmakla döndürün.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="relative overflow-hidden w-full py-3.5 px-4 bg-white text-zinc-950 font-bold text-xs sm:text-sm rounded-lg flex items-center justify-center gap-2 cursor-pointer">
                <Camera className="w-4 h-4" />
                <span>Fotoğraf Çek</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    e.currentTarget.value = '';
                    onFile(f);
                  }}
                />
              </label>
              <label className="relative overflow-hidden w-full py-3.5 px-4 border border-zinc-700 hover:border-white text-zinc-200 font-semibold text-xs sm:text-sm rounded-lg flex items-center justify-center gap-2 cursor-pointer">
                <ImageIcon className="w-4 h-4" />
                <span>Galeriden Yükle</span>
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    e.currentTarget.value = '';
                    onFile(f);
                  }}
                />
              </label>
            </div>

            {/* Masaüstünden telefona QR geçiş kartı */}
            <div className="hidden sm:flex items-center gap-4 p-4 border border-zinc-800 bg-zinc-900/75 rounded-lg text-left">
              <div className="bg-white p-2 rounded shrink-0">
                <QRCodeSVG value={mobilePhotoUrl} size={112} />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-xs font-bold text-white">Telefonunuzda Odanızı Çekin veya Yükleyin</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Telefon kamerasıyla QR kodu okutun; doğrudan bu ekran telefonunuzda açılsın, odanızın fotoğrafını çekip veya galeriden seçip 1:1 ürünü yerleştirin.
                </p>
                <button
                  type="button"
                  onClick={copyMobilePhotoUrl}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-zinc-700 hover:border-white rounded text-[11px] font-semibold text-zinc-200 whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedLink ? 'Kopyalandı' : 'Linki Kopyala'}</span>
                </button>
              </div>
            </div>

            {/* Mobilde isteğe bağlı QR paylaşım açma/kapama */}
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
                    <QRCodeSVG value={mobilePhotoUrl} size={140} />
                  </div>
                  <button
                    type="button"
                    onClick={copyMobilePhotoUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-zinc-700 rounded text-[11px] font-semibold text-zinc-200"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? 'Kopyalandı' : 'Linki Kopyala'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-zinc-800 space-y-2.5 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Hazır Örnek Salonda Anında Dene
              </p>
              <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                {DEMO_PHOTO_ROOMS.map((room, idx) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => loadDemoRoom(room)}
                    className="group border border-zinc-800 hover:border-white rounded-lg overflow-hidden bg-zinc-900 text-left transition"
                  >
                    <div className="aspect-[16/10] bg-zinc-800 overflow-hidden">
                      <img
                        src={room.imageUrl}
                        alt={room.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />
                    </div>
                    <div className="p-2">
                      <p className="text-[10px] font-mono text-zinc-400">
                        {String(idx + 1).padStart(2, '0')}
                      </p>
                      <p className="text-[11px] sm:text-xs font-bold text-white leading-snug mt-0.5 line-clamp-2">{room.title}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'analyzing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
          <p className="text-sm font-semibold">Odanız ölçülüyor...</p>
          <p className="text-xs text-zinc-400 max-w-xs">
            Sunucu derinliği, zemini, kamera yüksekliğini ve açısını hesaplıyor.
          </p>
        </div>
      )}

      {step === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-red-300 max-w-xs">{error}</p>
          <button
            onClick={() => {
              setError('');
              setPhoto(null);
              setAnalysis(null);
              setStep('capture');
            }}
            className="px-5 py-3 bg-white text-zinc-950 rounded-lg text-sm font-bold"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {step === 'design' && analysis && photo && (
        <>
          <div ref={stageRef} className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden">
            <div className="relative" style={{ width: disp.w, height: disp.h }}>
              <img src={photo} alt="Odanız" className="absolute inset-0 w-full h-full select-none pointer-events-none" draggable={false} />
              <div
                ref={canvasHostRef}
                className={`absolute inset-0 ${eraseMode ? 'cursor-crosshair' : 'cursor-grab'}`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
              {(loadingCount > 0 || erasing) && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none">
                  <span className="bg-black/80 border border-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    {erasing ? 'Mevcut eşya odadan siliniyor...' : 'Ürün yükleniyor...'}
                  </span>
                </div>
              )}
            </div>

            {eraseMode && !erasing && (
              <div className="absolute top-2 left-2 right-2 bg-zinc-900/95 border border-emerald-500 rounded-lg px-3 py-2.5 flex items-center justify-between gap-2 shadow-xl">
                <span className="text-xs font-semibold text-white">
                  Kaldırmak istediğiniz mevcut eşyanın üzerine dokunun
                </span>
                <button
                  onClick={() => setEraseMode(false)}
                  className="px-2.5 py-1 bg-zinc-800 rounded text-xs font-semibold text-zinc-200 shrink-0"
                >
                  İptal
                </button>
              </div>
            )}

            {toastMsg && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-black/85 border border-zinc-700 px-3.5 py-2 rounded-lg text-xs font-medium text-white shadow-xl pointer-events-none whitespace-nowrap">
                {toastMsg}
              </div>
            )}

            {showInfo && (
              <div className="absolute top-2 left-2 right-2 bg-black/85 border border-zinc-700 rounded-lg p-3 text-[11px] font-mono space-y-0.5">
                <p>Kamera yüksekliği: {(analysis.cameraHeightM * (100 / sizePct)).toFixed(2)} m</p>
                <p>Aşağı eğim: {analysis.pitchDownDeg.toFixed(1)}° • yatay eğim: {analysis.rollDeg.toFixed(1)}°</p>
                <p>Görüş açısı: {analysis.hfovDeg.toFixed(0)}° yatay / {analysis.vfovDeg.toFixed(0)}° dikey</p>
                <p>Zemin uyumu: %{Math.round(analysis.floorInlierRatio * 100)} • kalibrasyon x{(analysis.scaleFactor ?? 1).toFixed(2)} • {analysis.elapsedMs} ms</p>
              </div>
            )}

            {suspicious && !showInfo && !eraseMode && (
              <div className="absolute top-2 left-2 right-2 bg-amber-900/90 border border-amber-600 rounded-lg p-2.5 text-[11px]">
                Ölçüm güvenilir görünmüyor. Daha aydınlık, zemini daha çok gösteren bir fotoğrafla tekrar deneyin.
              </div>
            )}

            {/* + Ürün Ekle / Değiştir Slide-Up Picker */}
            {drawerMode && (
              <div className="absolute bottom-0 left-0 right-0 z-30 bg-zinc-900/98 border-t border-zinc-700 p-3 space-y-2.5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">
                    {drawerMode === 'swap' ? 'Seçili Ürünü Değiştir' : `Odaya Ürün Ekle (${products.length})`}
                  </span>
                  <button onClick={() => setDrawerMode(null)} className="p-1 text-zinc-400 hover:text-white" aria-label="Kapat">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {products.map((p) => (
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

          <div className="shrink-0 border-t border-zinc-800 px-3 pt-2 pb-3 space-y-2">
            {selectedItem?.product.swatches && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[11px] text-zinc-400 shrink-0">Kumaş:</span>
                {selectedItem.product.swatches.map((sw) => {
                  const active = (selectedItem.colorHex || selectedItem.product.swatches![0].hex) === sw.hex;
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
            <div className="flex items-center justify-between gap-2 text-[11px]">
              {isClientFallback ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-zinc-400">Eğim:</span>
                  <button
                    type="button"
                    onClick={() => changePitchDeg(pitchDeg - 2)}
                    disabled={pitchDeg <= 2}
                    className="w-6 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-35 text-xs font-bold flex items-center justify-center"
                    aria-label="Eğimi azalt"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-mono font-bold text-white">{pitchDeg}°</span>
                  <button
                    type="button"
                    onClick={() => changePitchDeg(pitchDeg + 2)}
                    disabled={pitchDeg >= 35}
                    className="w-6 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-35 text-xs font-bold flex items-center justify-center"
                    aria-label="Eğimi artır"
                  >
                    +
                  </button>
                </div>
              ) : (
                <span className="text-zinc-400 truncate">Sürükle • İki parmakla çevir</span>
              )}
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-zinc-400">Boyut:</span>
                <button
                  type="button"
                  onClick={() => changeSizePct(sizePct - 5)}
                  disabled={sizePct <= 70}
                  className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-35 text-sm font-bold flex items-center justify-center"
                  aria-label="Boyutu küçült"
                >
                  −
                </button>
                <span className="w-11 text-center font-mono font-bold text-white">%{sizePct}</span>
                <button
                  type="button"
                  onClick={() => changeSizePct(sizePct + 5)}
                  disabled={sizePct >= 135}
                  className="w-7 h-7 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-35 text-sm font-bold flex items-center justify-center"
                  aria-label="Boyutu büyüt"
                >
                  +
                </button>
                {sizePct !== 100 && (
                  <button
                    type="button"
                    onClick={() => changeSizePct(100)}
                    className="px-2 h-7 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] font-semibold text-zinc-200 whitespace-nowrap"
                  >
                    Sıfırla
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <button
                onClick={() => {
                  setEraseMode(false);
                  setDrawerMode((m) => (m === 'add' ? null : 'add'));
                }}
                className={`px-3 py-3 rounded-lg text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                  drawerMode === 'add' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-white'
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>Ürün Ekle</span>
              </button>

              <button
                onClick={() => {
                  setEraseMode(false);
                  setDrawerMode((m) => (m === 'swap' ? null : 'swap'));
                }}
                disabled={!selectedItem}
                className={`px-3 py-3 rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-40 whitespace-nowrap shrink-0 ${
                  drawerMode === 'swap' ? 'bg-white text-zinc-950' : 'bg-zinc-800 text-zinc-200'
                }`}
              >
                <RefreshCw className="w-4 h-4" />
                <span>Değiştir</span>
              </button>

              <button
                onClick={() => {
                  setDrawerMode(null);
                  setEraseMode((v) => !v);
                }}
                disabled={erasing}
                className={`px-3 py-3 rounded-lg text-xs font-bold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                  eraseMode ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-200'
                }`}
                title="Odadaki eski koltuğu / eşyayı sil"
              >
                <Eraser className="w-4 h-4" />
                <span>Eşya Sil</span>
              </button>

              <button
                onClick={() => rotateBy(-15)}
                disabled={!selectedItem}
                className="p-3 rounded-lg bg-zinc-800 disabled:opacity-40 shrink-0"
                aria-label="Sola döndür"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => rotateBy(15)}
                disabled={!selectedItem}
                className="p-3 rounded-lg bg-zinc-800 disabled:opacity-40 shrink-0"
                aria-label="Sağa döndür"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <button
                onClick={removeSelected}
                disabled={!selectedItem}
                className="p-3 rounded-lg bg-zinc-800 text-red-300 disabled:opacity-35 shrink-0"
                aria-label="Seçili ürünü kaldır"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setStep('capture')}
                className="p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                title="Yeni Oda Fotoğrafı Çek veya Yükle"
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                onClick={save}
                disabled={items.length === 0 || saving}
                className="flex-1 min-w-[84px] py-3 px-3 rounded-lg bg-white text-zinc-950 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap shrink-0"
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
