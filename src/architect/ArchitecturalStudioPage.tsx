import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Camera,
  Columns,
  Compass,
  CopyPlus,
  DoorOpen,
  Download,
  Eye,
  FolderOpen,
  Grid3X3,
  Layers,
  Loader2,
  Menu,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Sofa,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PRODUCTS, type Product } from '../lib/products';
import { fetchCloudCatalog } from '../lib/storageClient';
import { convertCadFileToGlb } from '../lib/cadImport';
import {
  clampToRoomWalls,
  findOpenSpawnPosition,
  getWorldAABBSpan,
  parseProductFootprintM,
  type OBB2D,
} from '../lib/collision2d';
import { ArchViewport3D, type ArchCameraMode, type ArchViewportHandle } from './ArchViewport3D';
import { PinterestAIPanel } from './PinterestAIPanel';
import { bearingToCompassLabel, bearingToShortCode, computeSolarLighting } from './solarMath';
import {
  ARCHITECTURAL_PAINT_SWATCHES,
  DOOR_KIND_LABELS,
  FLOOR_MATERIAL_LABELS,
  FRAME_COLOR_SWATCHES,
  WALL_LABELS,
  WALL_PATTERN_LABELS,
  WINDOW_KIND_LABELS,
  createDefaultArchitectProject,
  getWallLengthM,
  type ArchBeam,
  type ArchColumn,
  type ArchCurtainCove,
  type ArchDoor,
  type ArchPlacedObject,
  type ArchRoomProject,
  type ArchWindow,
  type CurtainStyle,
  type DoorKind,
  type FloorMaterialKind,
  type ParametricFurnitureKind,
  type SolarSeason,
  type WallId,
  type WallPattern,
  type WindowKind,
} from './types';

type StudioTab = 'room' | 'openings' | 'structure' | 'sun' | 'objects' | 'pinterest';

const WALL_IDS: WallId[] = ['north', 'east', 'south', 'west'];

export const ArchitecturalStudioPage: React.FC = () => {
  const [catalog, setCatalog] = useState<Product[]>(PRODUCTS);
  const [project, setProject] = useState<ArchRoomProject>(() => createDefaultArchitectProject(PRODUCTS));
  const [activeTab, setActiveTab] = useState<StudioTab>('room');
  const [cameraMode, setCameraMode] = useState<ArchCameraMode>('free');
  const [showGrid, setShowGrid] = useState(true);
  const [showSunOrb, setShowSunOrb] = useState(true);
  const [showDoorArcs, setShowDoorArcs] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [selectedWall, setSelectedWall] = useState<WallId>('north');
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingCount, setLoadingCount] = useState(0);
  const [uploadingCad, setUploadingCad] = useState(false);
  const [sunPlaying, setSunPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const viewportRef = useRef<ArchViewportHandle | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 3000);
  }, []);

  // Load permanent Cloudflare R2 cloud catalog products so architect can place them too!
  useEffect(() => {
    document.title = 'MekanAR · Mimari 3B Oda Stüdyosu';
    let cancelled = false;
    fetchCloudCatalog().then((cloudList) => {
      if (cancelled || cloudList.length === 0) return;
      setCatalog((prev) => {
        const seen = new Set(cloudList.map((p) => p.id));
        return [...cloudList, ...prev.filter((p) => !seen.has(p.id))];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sun day-cycle animation
  useEffect(() => {
    if (!sunPlaying) return;
    const id = window.setInterval(() => {
      setProject((prev) => {
        const nextH = prev.sun.hour + 0.18;
        return {
          ...prev,
          sun: { ...prev.sun, hour: nextH > 20.2 ? 6.2 : Number(nextH.toFixed(2)) },
        };
      });
    }, 90);
    return () => window.clearInterval(id);
  }, [sunPlaying]);

  const solar = useMemo(() => computeSolarLighting(project.sun), [project.sun]);

  const selectedObj = useMemo(
    () => project.objects.find((o) => o.id === selectedObjectId) || null,
    [project.objects, selectedObjectId]
  );

  // Room dimension clamping for placed objects
  const updateRoomDim = (patch: Partial<Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM' | 'wallThicknessM'>>) => {
    setProject((prev) => {
      const nextW = patch.widthM ?? prev.widthM;
      const nextD = patch.depthM ?? prev.depthM;
      const nextC = patch.ceilingM ?? prev.ceilingM;
      const objects = prev.objects.map((o) => {
        const clamped = clampToRoomWalls(o.x, o.z, o.rot, o.widthM * 0.5, o.depthM * 0.5, nextW, nextD, 0.015);
        const y = o.mountMode === 'ceiling' ? Math.max(0.5, nextC - o.heightM) : Math.min(o.y, Math.max(0, nextC - 0.1));
        return { ...o, x: clamped.x, z: clamped.z, y };
      });
      return { ...prev, ...patch, widthM: nextW, depthM: nextD, ceilingM: nextC, objects };
    });
  };

  // --- Windows CRUD ---
  const addWindow = (kind: WindowKind) => {
    const wallLenCm = Math.round(getWallLengthM(selectedWall, project.widthM, project.depthM) * 100);
    const preset: Record<WindowKind, { w: number; h: number; sill: number }> = {
      single: { w: 90, h: 140, sill: 90 },
      double: { w: 160, h: 150, sill: 85 },
      triple: { w: 230, h: 160, sill: 80 },
      quad: { w: 300, h: 165, sill: 75 },
      french: { w: 240, h: Math.min(245, Math.round(project.ceilingM * 100) - 25), sill: 2 },
      sliding: { w: 260, h: Math.min(235, Math.round(project.ceilingM * 100) - 30), sill: 2 },
      round: { w: 100, h: 100, sill: 115 },
      oval: { w: 120, h: 160, sill: 80 },
      arched: { w: 115, h: 185, sill: 55 },
    };
    const p = preset[kind];
    const safeW = Math.min(p.w, wallLenCm - 40);
    // Find non-overlapping horizontal spot along selectedWall
    const existing = [
      ...project.windows.filter((w) => w.wall === selectedWall).map((w) => [w.offsetCm - w.widthCm / 2, w.offsetCm + w.widthCm / 2]),
      ...project.doors.filter((d) => d.wall === selectedWall).map((d) => [d.offsetCm - d.widthCm / 2, d.offsetCm + d.widthCm / 2]),
    ];
    let offsetCm = Math.round(wallLenCm / 2);
    for (const candidate of [wallLenCm * 0.5, wallLenCm * 0.25, wallLenCm * 0.75, wallLenCm * 0.18, wallLenCm * 0.82]) {
      const a = candidate - safeW / 2 - 8;
      const b = candidate + safeW / 2 + 8;
      if (a >= 10 && b <= wallLenCm - 10 && !existing.some(([e0, e1]) => !(b <= e0 || a >= e1))) {
        offsetCm = Math.round(candidate);
        break;
      }
    }

    const win: ArchWindow = {
      id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      wall: selectedWall,
      kind,
      offsetCm,
      widthCm: safeW,
      heightCm: Math.min(p.h, Math.round(project.ceilingM * 100) - 18),
      sillHeightCm: p.sill,
      frameColorHex: '#26282c',
      hasSill: kind !== 'round' && kind !== 'oval' && p.sill > 10,
      curtainStyle: 'none',
      curtainColorHex: '#d9d1c3',
      curtainOpenRatio: 0.72,
    };
    setProject((prev) => ({ ...prev, windows: [...prev.windows, win] }));
    if (cameraMode === 'free') viewportRef.current?.focusWall(selectedWall);
    showToast(`${WALL_LABELS[selectedWall]} üzerine ${WINDOW_KIND_LABELS[kind]} eklendi.`);
  };

  const updateWindow = (id: string, patch: Partial<ArchWindow>) => {
    setProject((prev) => ({
      ...prev,
      windows: prev.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  };

  const removeWindow = (id: string) => {
    setProject((prev) => ({ ...prev, windows: prev.windows.filter((w) => w.id !== id) }));
  };

  // --- Doors CRUD ---
  const addDoor = (kind: DoorKind) => {
    const wallLenCm = Math.round(getWallLengthM(selectedWall, project.widthM, project.depthM) * 100);
    const wCm = kind === 'double' ? 160 : kind === 'archway' ? 130 : 95;
    const door: ArchDoor = {
      id: `door-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      wall: selectedWall,
      kind,
      offsetCm: Math.round(Math.min(wallLenCm - wCm * 0.5 - 20, Math.max(wCm * 0.5 + 20, wallLenCm * 0.28))),
      widthCm: Math.min(wCm, wallLenCm - 40),
      heightCm: Math.min(215, Math.round(project.ceilingM * 100) - 15),
      swing: 'inward',
      hinge: 'left',
      openAngleDeg: 45,
      colorHex: '#f3f1eb',
      handleColorHex: '#262626',
    };
    setProject((prev) => ({ ...prev, doors: [...prev.doors, door] }));
    if (cameraMode === 'free') viewportRef.current?.focusWall(selectedWall);
    showToast(`${WALL_LABELS[selectedWall]} üzerine ${DOOR_KIND_LABELS[kind]} eklendi.`);
  };

  const updateDoor = (id: string, patch: Partial<ArchDoor>) => {
    setProject((prev) => ({
      ...prev,
      doors: prev.doors.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  };

  const removeDoor = (id: string) => {
    setProject((prev) => ({ ...prev, doors: prev.doors.filter((d) => d.id !== id) }));
  };

  // --- Columns CRUD ---
  const addColumn = (shape: 'rect' | 'round') => {
    const col: ArchColumn = {
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: shape === 'round' ? 'Yuvarlak Kolon' : 'Taşıyıcı Kolon',
      shape,
      xCm: Math.round((project.widthM * 100) / 2 - 22),
      zCm: Math.round(-(project.depthM * 100) / 2 + 22),
      widthCm: 40,
      depthCm: 40,
      colorHex: project.walls.north.colorHex,
    };
    setProject((prev) => ({ ...prev, columns: [...prev.columns, col] }));
    showToast(`${col.label} eklendi.`);
  };

  const updateColumn = (id: string, patch: Partial<ArchColumn>) => {
    setProject((prev) => ({
      ...prev,
      columns: prev.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const removeColumn = (id: string) => {
    setProject((prev) => ({ ...prev, columns: prev.columns.filter((c) => c.id !== id) }));
  };

  // --- Beams CRUD ---
  const addBeam = (axis: 'x' | 'z') => {
    const defaultPos =
      axis === 'z'
        ? Math.round(-project.widthM * 25)
        : Math.round(project.depthM * 25);
    const beam: ArchBeam = {
      id: `beam-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: axis === 'x' ? 'Yatay Kiriş' : 'Dikey Kiriş',
      axis,
      positionCm: defaultPos,
      widthCm: 30,
      dropCm: 32,
      colorHex: project.ceilingColorHex,
    };
    setProject((prev) => ({ ...prev, beams: [...prev.beams, beam] }));
    showToast(`${beam.label} tavana eklendi.`);
  };

  const updateBeam = (id: string, patch: Partial<ArchBeam>) => {
    setProject((prev) => ({
      ...prev,
      beams: prev.beams.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };

  const removeBeam = (id: string) => {
    setProject((prev) => ({ ...prev, beams: prev.beams.filter((b) => b.id !== id) }));
  };

  // --- Curtain Coves (Perde Havuzu) CRUD ---
  const toggleCurtainCove = (wall: WallId) => {
    setProject((prev) => {
      const exists = prev.curtainCoves.some((c) => c.wall === wall);
      if (exists) {
        return { ...prev, curtainCoves: prev.curtainCoves.filter((c) => c.wall !== wall) };
      }
      const next: ArchCurtainCove = {
        id: `cove-${wall}-${Date.now()}`,
        wall,
        depthCm: 22,
        dropCm: 18,
        ledEnabled: true,
        ledColorHex: '#ffddb0',
        ledIntensity: 1.2,
        colorHex: prev.ceilingColorHex,
      };
      return { ...prev, curtainCoves: [...prev.curtainCoves, next] };
    });
  };

  const addAllPerimeterCoves = () => {
    setProject((prev) => {
      const existingWalls = new Set(prev.curtainCoves.map((c) => c.wall));
      const additions: ArchCurtainCove[] = WALL_IDS.filter((w) => !existingWalls.has(w)).map((w) => ({
        id: `cove-${w}-${Date.now()}`,
        wall: w,
        depthCm: 22,
        dropCm: 18,
        ledEnabled: true,
        ledColorHex: '#ffddb0',
        ledIntensity: 1.15,
        colorHex: prev.ceilingColorHex,
      }));
      return { ...prev, curtainCoves: [...prev.curtainCoves, ...additions] };
    });
    showToast('4 duvar çevresine gizli LED’li perde havuzu eklendi.');
  };

  const updateCurtainCove = (id: string, patch: Partial<ArchCurtainCove>) => {
    setProject((prev) => ({
      ...prev,
      curtainCoves: prev.curtainCoves.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  // --- Objects CRUD ---
  const addParametricModule = (kind: ParametricFurnitureKind) => {
    const specs: Record<
      ParametricFurnitureKind,
      {
        name: string;
        w: number;
        d: number;
        h: number;
        y: number;
        mount: ArchPlacedObject['mountMode'];
        c1: string;
        c2: string;
      }
    > = {
      fireplace_marble: {
        name: 'Mermer Şömine & TV Duvarı',
        w: 2.2,
        d: 0.44,
        h: Math.min(2.8, project.ceilingM),
        y: 0,
        mount: 'wall',
        c1: '#ece9e2',
        c2: '#252423',
      },
      tv_wall_unit: {
        name: 'Ahşap Çıtalı TV Duvar Ünitesi',
        w: 2.4,
        d: 0.42,
        h: Math.min(2.5, project.ceilingM - 0.15),
        y: 0,
        mount: 'wall',
        c1: '#b78e66',
        c2: '#2a2927',
      },
      wall_tv: {
        name: 'Duvar OLED TV (65")',
        w: 1.45,
        d: 0.06,
        h: 0.84,
        y: 1.1,
        mount: 'wall',
        c1: '#18181b',
        c2: '#09090b',
      },
      rug_custom: {
        name: 'Özel Ölçü Dokuma Halı',
        w: 2.6,
        d: 1.9,
        h: 0.015,
        y: 0,
        mount: 'rug',
        c1: '#e6dfd3',
        c2: '#b8ad9b',
      },
      chandelier: {
        name: 'Pirinç Halka Mimari Avize',
        w: 0.9,
        d: 0.9,
        h: 0.55,
        y: Math.max(1.8, project.ceilingM - 0.55),
        mount: 'ceiling',
        c1: '#c8a86b',
        c2: '#fff4dc',
      },
    };
    const sp = specs[kind];
    let x = 0;
    let z = 0;
    let rot = 0;
    if (sp.mount === 'wall') {
      z = -project.depthM * 0.5 + sp.d * 0.5 + 0.01;
      rot = 0;
    }
    const obj: ArchPlacedObject = {
      id: `mod-${kind}-${Date.now()}`,
      name: sp.name,
      category: 'Mimari Modül',
      dimensionsCm: `${Math.round(sp.w * 100)} × ${Math.round(sp.d * 100)} × ${Math.round(sp.h * 100)} cm`,
      parametricKind: kind,
      parametricColorHex: sp.c1,
      parametricAccentHex: sp.c2,
      x,
      y: sp.y,
      z,
      rot,
      widthM: sp.w,
      depthM: sp.d,
      heightM: sp.h,
      mountMode: sp.mount,
      attachedWall: sp.mount === 'wall' ? 'north' : undefined,
      source: 'parametric',
    };
    setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
    setSelectedObjectId(obj.id);
    showToast(`${sp.name} eklendi — sağa-sola sürükleyip duvara yaslayabilirsiniz.`);
  };

  const addCatalogProduct = (p: Product) => {
    const fp = parseProductFootprintM(p.dimensionsCm);
    const dims = p.dimensionsCm.match(/\d+(?:[.,]\d+)?/g);
    const wM = dims?.[0] ? Math.max(0.25, parseFloat(dims[0].replace(',', '.')) / 100) : fp.halfW * 2;
    const dM = dims?.[1] ? Math.max(0.25, parseFloat(dims[1].replace(',', '.')) / 100) : fp.halfD * 2;
    const hM = dims?.[2] ? Math.max(0.25, parseFloat(dims[2].replace(',', '.')) / 100) : 0.85;

    const others: OBB2D[] = project.objects
      .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling')
      .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
    const pos = findOpenSpawnPosition(wM * 0.5, dM * 0.5, 0, others, project.widthM, project.depthM, [0, 0]);
    const obj: ArchPlacedObject = {
      id: `cat-${p.id}-${Date.now()}`,
      name: p.name,
      category: p.category,
      dimensionsCm: p.dimensionsCm,
      glbUrl: p.glbUrl,
      x: pos ? pos.x : 0,
      y: 0,
      z: pos ? pos.z : 0,
      rot: pos ? pos.rot : 0,
      widthM: wM,
      depthM: dM,
      heightM: hM,
      mountMode: 'floor',
      thumbUrl: p.thumbUrl,
      source: 'catalog',
      productRef: p,
    };
    setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
    setSelectedObjectId(obj.id);
    showToast(`${p.name} odaya eklendi.`);
  };

  const handleCadUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingCad(true);
    try {
      const converted = await convertCadFileToGlb(file);
      const blobUrl = URL.createObjectURL(new Blob([converted.glbBuffer], { type: 'model/gltf-binary' }));
      const cleanName = file.name.replace(/\.[^.]+$/, '') || 'Özel CAD Model';
      const dims = converted.dimensionsCm.match(/\d+(?:[.,]\d+)?/g);
      const wM = dims?.[0] ? parseFloat(dims[0].replace(',', '.')) / 100 : 1.2;
      const dM = dims?.[1] ? parseFloat(dims[1].replace(',', '.')) / 100 : 0.8;
      const hM = dims?.[2] ? parseFloat(dims[2].replace(',', '.')) / 100 : 0.85;
      const obj: ArchPlacedObject = {
        id: `cad-${Date.now()}`,
        name: cleanName,
        category: 'Özel CAD',
        dimensionsCm: converted.dimensionsCm,
        glbUrl: blobUrl,
        x: 0,
        y: 0,
        z: 0,
        rot: 0,
        widthM: Math.max(0.2, wM),
        depthM: Math.max(0.2, dM),
        heightM: Math.max(0.2, hM),
        mountMode: 'floor',
        source: 'cad',
      };
      setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
      setSelectedObjectId(obj.id);
      showToast(`${cleanName} (1:1 CAD) odaya eklendi.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CAD dosyası okunamadı.');
    } finally {
      setUploadingCad(false);
    }
  };

  const updateSelectedObject = (patch: Partial<ArchPlacedObject>) => {
    if (!selectedObjectId) return;
    setProject((prev) => ({
      ...prev,
      objects: prev.objects.map((o) => {
        if (o.id !== selectedObjectId) return o;
        const next = { ...o, ...patch };
        next.dimensionsCm = `${Math.round(next.widthM * 100)} × ${Math.round(next.depthM * 100)} × ${Math.round(
          next.heightM * 100
        )} cm`;
        return next;
      }),
    }));
  };

  const snapSelectedToWall = (wall: WallId) => {
    if (!selectedObj) return;
    let x = selectedObj.x;
    let z = selectedObj.z;
    let rot = selectedObj.rot;
    if (wall === 'north') {
      z = -project.depthM * 0.5 + selectedObj.depthM * 0.5 + 0.01;
      rot = 0;
    } else if (wall === 'south') {
      z = project.depthM * 0.5 - selectedObj.depthM * 0.5 - 0.01;
      rot = Math.PI;
    } else if (wall === 'west') {
      x = -project.widthM * 0.5 + selectedObj.depthM * 0.5 + 0.01;
      rot = Math.PI / 2;
    } else if (wall === 'east') {
      x = project.widthM * 0.5 - selectedObj.depthM * 0.5 - 0.01;
      rot = -Math.PI / 2;
    }
    const clamped = clampToRoomWalls(
      x,
      z,
      rot,
      selectedObj.widthM * 0.5,
      selectedObj.depthM * 0.5,
      project.widthM,
      project.depthM,
      0.01
    );
    updateSelectedObject({ x: clamped.x, z: clamped.z, rot, attachedWall: wall });
    showToast(`${WALL_LABELS[wall]} yüzeyine sıfır yaslandı.`);
  };

  const duplicateSelected = () => {
    if (!selectedObj) return;
    const copy: ArchPlacedObject = {
      ...selectedObj,
      id: `copy-${Date.now()}`,
      x: Math.min(project.widthM * 0.4, selectedObj.x + 0.4),
      z: Math.min(project.depthM * 0.4, selectedObj.z + 0.4),
    };
    setProject((prev) => ({ ...prev, objects: [...prev.objects, copy] }));
    setSelectedObjectId(copy.id);
  };

  const deleteSelected = () => {
    if (!selectedObjectId) return;
    setProject((prev) => ({ ...prev, objects: prev.objects.filter((o) => o.id !== selectedObjectId) }));
    setSelectedObjectId(null);
  };

  // --- Save / Load / Export ---
  const handleSaveProjectJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName.toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'mimari-proje'}.mekanar.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Mimari proje dosyası (.json) indirildi.');
  };

  const handleLoadProjectJson = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '')) as ArchRoomProject;
        if (!parsed || typeof parsed.widthM !== 'number' || !parsed.walls) {
          throw new Error('Geçersiz proje formatı');
        }
        setProject(parsed);
        setSelectedObjectId(null);
        showToast(`${parsed.projectName || 'Proje'} yüklendi.`);
      } catch {
        showToast('Proje dosyası okunamadı.');
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadSnapshot = () => {
    const url = viewportRef.current?.captureSnapshot(true);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `mekanar-mimari-${cameraMode}-${Date.now()}.jpg`;
    a.click();
    showToast('Yüksek çözünürlüklü sahne görüntüsü indirildi.');
  };

  const selectedWallClearance = useMemo(() => {
    if (!selectedObj) return null;
    const { extX, extZ } = getWorldAABBSpan(selectedObj.rot, selectedObj.widthM * 0.5, selectedObj.depthM * 0.5);
    return {
      left: Math.max(0, Math.round((selectedObj.x - extX + project.widthM * 0.5) * 100)),
      right: Math.max(0, Math.round((project.widthM * 0.5 - (selectedObj.x + extX)) * 100)),
      north: Math.max(0, Math.round((selectedObj.z - extZ + project.depthM * 0.5) * 100)),
      south: Math.max(0, Math.round((project.depthM * 0.5 - (selectedObj.z + extZ)) * 100)),
    };
  }, [selectedObj, project.widthM, project.depthM]);

  const wallWindows = project.windows.filter((w) => w.wall === selectedWall);
  const wallDoors = project.doors.filter((d) => d.wall === selectedWall);

  const TABS: Array<{ id: StudioTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'room', label: 'Oda', icon: Building2 },
    { id: 'openings', label: 'Açıklık', icon: DoorOpen },
    { id: 'structure', label: 'Yapı', icon: Columns },
    { id: 'sun', label: 'Güneş', icon: Sun },
    { id: 'objects', label: 'Eşya', icon: Sofa },
    { id: 'pinterest', label: 'Pinterest', icon: Sparkles },
  ];

  const renderSidebarContent = () => {
    if (activeTab === 'room') {
      const curWallFinish = project.walls[selectedWall];
      return (
        <div className="space-y-5 text-xs">
          {/* Dimensions */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                01 · Oda Ölçüleri
              </span>
              <span className="font-mono font-bold text-stone-950">
                {(project.widthM * project.depthM).toFixed(1)} m²
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-stone-500 block">En (m)</span>
                <input
                  type="number"
                  min={2.2}
                  max={12}
                  step={0.1}
                  value={project.widthM}
                  onChange={(e) => updateRoomDim({ widthM: Math.max(2.2, Math.min(12, Number(e.target.value) || 5.4)) })}
                  className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-stone-500 block">Derinlik (m)</span>
                <input
                  type="number"
                  min={2.2}
                  max={12}
                  step={0.1}
                  value={project.depthM}
                  onChange={(e) => updateRoomDim({ depthM: Math.max(2.2, Math.min(12, Number(e.target.value) || 4.8)) })}
                  className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-stone-500 block">Tavan (m)</span>
                <input
                  type="number"
                  min={2.2}
                  max={4.5}
                  step={0.05}
                  value={project.ceilingM}
                  onChange={(e) => updateRoomDim({ ceilingM: Math.max(2.2, Math.min(4.5, Number(e.target.value) || 2.85)) })}
                  className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={project.showCeiling}
                  onChange={(e) => setProject((p) => ({ ...p, showCeiling: e.target.checked }))}
                  className="accent-stone-950"
                />
                <span>Tavanı Göster</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={project.showBaseboard}
                  onChange={(e) => setProject((p) => ({ ...p, showBaseboard: e.target.checked }))}
                  className="accent-stone-950"
                />
                <span>Süpürgelik</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                <input
                  type="checkbox"
                  checked={project.recessedSpots}
                  onChange={(e) => setProject((p) => ({ ...p, recessedSpots: e.target.checked }))}
                  className="accent-stone-950"
                />
                <span>Tavan Spotları</span>
              </label>
            </div>
          </div>

          {/* Per-Wall Paint & Finish */}
          <div className="border-t border-stone-200 pt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                02 · Duvar Rengi &amp; Kaplama
              </span>
              <button
                type="button"
                onClick={() => {
                  const f = project.walls[selectedWall];
                  setProject((p) => ({
                    ...p,
                    walls: { north: { ...f }, east: { ...f }, south: { ...f }, west: { ...f } },
                  }));
                  showToast('Seçili duvar stili tüm 4 duvara uygulandı.');
                }}
                className="text-[10px] font-semibold underline text-stone-600 hover:text-stone-950"
              >
                Tüm Duvarlara Uygula
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {WALL_IDS.map((wId) => (
                <button
                  key={wId}
                  type="button"
                  onClick={() => setSelectedWall(wId)}
                  className={`px-2 py-1.5 border text-[11px] font-semibold flex items-center justify-between transition ${
                    selectedWall === wId
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-400'
                  }`}
                >
                  <span className="truncate">{WALL_LABELS[wId]}</span>
                  <span
                    className="w-3 h-3 border border-black/20 shrink-0"
                    style={{ backgroundColor: project.walls[wId].colorHex }}
                  />
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] text-stone-500 block">Kaplama Tipi</span>
              <div className="grid grid-cols-2 gap-1">
                {(Object.keys(WALL_PATTERN_LABELS) as WallPattern[]).map((pat) => (
                  <button
                    key={pat}
                    type="button"
                    onClick={() =>
                      setProject((p) => ({
                        ...p,
                        walls: { ...p.walls, [selectedWall]: { ...p.walls[selectedWall], pattern: pat } },
                      }))
                    }
                    className={`px-2 py-1.5 border text-[11px] font-medium text-left truncate transition ${
                      curWallFinish.pattern === pat
                        ? 'border-stone-950 bg-stone-900 text-white'
                        : 'border-stone-200 bg-white text-stone-800 hover:border-stone-500'
                    }`}
                  >
                    {WALL_PATTERN_LABELS[pat]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-stone-500">Mimari Boya Kartelası &amp; Özel HEX</span>
                <label className="flex items-center gap-1.5 text-[10px] font-mono text-stone-700 cursor-pointer">
                  <span>{curWallFinish.colorHex.toUpperCase()}</span>
                  <input
                    type="color"
                    value={curWallFinish.colorHex}
                    onChange={(e) =>
                      setProject((p) => ({
                        ...p,
                        walls: { ...p.walls, [selectedWall]: { ...p.walls[selectedWall], colorHex: e.target.value } },
                      }))
                    }
                    className="w-6 h-5 border border-stone-300 cursor-pointer bg-transparent"
                  />
                </label>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {ARCHITECTURAL_PAINT_SWATCHES.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    title={sw.name}
                    onClick={() =>
                      setProject((p) => ({
                        ...p,
                        walls: { ...p.walls, [selectedWall]: { ...p.walls[selectedWall], colorHex: sw.hex } },
                      }))
                    }
                    className={`h-7 border transition ${
                      curWallFinish.colorHex.toLowerCase() === sw.hex.toLowerCase()
                        ? 'border-stone-950 ring-1 ring-stone-950'
                        : 'border-stone-300 hover:border-stone-600'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Floor Material & Unlimited Tint */}
          <div className="border-t border-stone-200 pt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                03 · Zemin Kaplaması &amp; Renk
              </span>
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-stone-700 cursor-pointer">
                <span>{project.floorTintHex.toUpperCase()}</span>
                <input
                  type="color"
                  value={project.floorTintHex}
                  onChange={(e) => setProject((p) => ({ ...p, floorTintHex: e.target.value }))}
                  className="w-6 h-5 border border-stone-300 cursor-pointer bg-transparent"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(FLOOR_MATERIAL_LABELS) as FloorMaterialKind[]).map((fm) => {
                const info = FLOOR_MATERIAL_LABELS[fm];
                const active = project.floorMaterial === fm;
                return (
                  <button
                    key={fm}
                    type="button"
                    onClick={() => setProject((p) => ({ ...p, floorMaterial: fm, floorTintHex: info.defaultTint }))}
                    className={`px-2 py-1.5 border flex items-center gap-2 text-[11px] font-medium transition ${
                      active
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
                    }`}
                  >
                    <span className="w-3 h-3 border border-black/20 shrink-0" style={{ backgroundColor: info.defaultTint }} />
                    <span className="truncate">{info.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
                <span className="text-[10px] text-stone-600">Tavan Rengi</span>
                <input
                  type="color"
                  value={project.ceilingColorHex}
                  onChange={(e) => setProject((p) => ({ ...p, ceilingColorHex: e.target.value }))}
                  className="w-6 h-5 border border-stone-300 cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
                <span className="text-[10px] text-stone-600">Süpürgelik</span>
                <input
                  type="color"
                  value={project.baseboardColorHex}
                  onChange={(e) => setProject((p) => ({ ...p, baseboardColorHex: e.target.value }))}
                  className="w-6 h-5 border border-stone-300 cursor-pointer"
                />
              </label>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'openings') {
      const wallLenCm = Math.round(getWallLengthM(selectedWall, project.widthM, project.depthM) * 100);
      return (
        <div className="space-y-4 text-xs">
          {/* Active Wall Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                İşlem Yapılacak Duvar ({wallLenCm} cm)
              </span>
              <button
                type="button"
                onClick={() => {
                  if (cameraMode !== 'free') setCameraMode('free');
                  setTimeout(() => viewportRef.current?.focusWall(selectedWall), 40);
                }}
                className="text-[10px] font-semibold underline text-stone-700 hover:text-stone-950"
              >
                Bu Duvara Bak
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {WALL_IDS.map((wId) => {
                const wc = project.windows.filter((w) => w.wall === wId).length;
                const dc = project.doors.filter((d) => d.wall === wId).length;
                return (
                  <button
                    key={wId}
                    type="button"
                    onClick={() => {
                      setSelectedWall(wId);
                      if (cameraMode === 'free') viewportRef.current?.focusWall(wId);
                    }}
                    className={`px-2 py-1.5 border text-[11px] font-semibold flex items-center justify-between transition ${
                      selectedWall === wId
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-400'
                    }`}
                  >
                    <span className="truncate">{WALL_LABELS[wId]}</span>
                    <span className="text-[10px] font-mono opacity-75">
                      {wc}P · {dc}K
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add Any Window Shape */}
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              01 · Pencere Ekle (Tüm Çeşitler)
            </span>
            <div className="grid grid-cols-3 gap-1">
              {(Object.keys(WINDOW_KIND_LABELS) as WindowKind[]).map((wk) => (
                <button
                  key={wk}
                  type="button"
                  onClick={() => addWindow(wk)}
                  className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[10px] font-semibold text-stone-800 transition truncate"
                  title={WINDOW_KIND_LABELS[wk]}
                >
                  + {WINDOW_KIND_LABELS[wk].split(' ')[0]}
                </button>
              ))}
            </div>

            {wallWindows.length === 0 ? (
              <p className="text-[11px] text-stone-500 py-1">Bu duvarda pencere yok. Yukarıdan ekleyin.</p>
            ) : (
              <div className="space-y-2.5 pt-1">
                {wallWindows.map((win, idx) => (
                  <div key={win.id} className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <select
                        value={win.kind}
                        onChange={(e) => updateWindow(win.id, { kind: e.target.value as WindowKind })}
                        className="flex-1 px-1.5 py-1 border border-stone-300 bg-white text-[11px] font-semibold"
                      >
                        {(Object.keys(WINDOW_KIND_LABELS) as WindowKind[]).map((k) => (
                          <option key={k} value={k}>
                            P{idx + 1}: {WINDOW_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeWindow(win.id)}
                        className="p-1 text-stone-500 hover:text-red-700"
                        title="Pencereyi Sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] text-stone-600">
                        Soldan Konum: <strong className="font-mono">{Math.round(win.offsetCm)} cm</strong>
                        <input
                          type="range"
                          min={Math.round(win.widthCm * 0.5) + 10}
                          max={Math.max(Math.round(win.widthCm * 0.5) + 12, wallLenCm - Math.round(win.widthCm * 0.5) - 10)}
                          value={win.offsetCm}
                          onChange={(e) => updateWindow(win.id, { offsetCm: Number(e.target.value) })}
                          className="w-full accent-stone-950"
                        />
                      </label>
                      <label className="text-[10px] text-stone-600">
                        Parapet (Yerden): <strong className="font-mono">{Math.round(win.sillHeightCm)} cm</strong>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(10, Math.round(project.ceilingM * 100 - win.heightCm - 10))}
                          value={win.sillHeightCm}
                          onChange={(e) => updateWindow(win.id, { sillHeightCm: Number(e.target.value) })}
                          className="w-full accent-stone-950"
                        />
                      </label>
                      <label className="text-[10px] text-stone-600">
                        Genişlik (cm)
                        <input
                          type="number"
                          min={40}
                          max={wallLenCm - 20}
                          step={5}
                          value={win.widthCm}
                          onChange={(e) => updateWindow(win.id, { widthCm: Math.max(40, Number(e.target.value) || 120) })}
                          className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                        />
                      </label>
                      <label className="text-[10px] text-stone-600">
                        Yükseklik (cm)
                        <input
                          type="number"
                          min={40}
                          max={Math.round(project.ceilingM * 100) - 12}
                          step={5}
                          value={win.heightCm}
                          onChange={(e) => updateWindow(win.id, { heightCm: Math.max(40, Number(e.target.value) || 140) })}
                          className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1">
                        {FRAME_COLOR_SWATCHES.map((fc) => (
                          <button
                            key={fc.hex}
                            type="button"
                            title={fc.name}
                            onClick={() => updateWindow(win.id, { frameColorHex: fc.hex })}
                            className={`w-4 h-4 border ${
                              win.frameColorHex === fc.hex ? 'border-stone-950 ring-1 ring-stone-950' : 'border-stone-300'
                            }`}
                            style={{ backgroundColor: fc.hex }}
                          />
                        ))}
                      </div>
                      <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={win.hasSill}
                          onChange={(e) => updateWindow(win.id, { hasSill: e.target.checked })}
                          className="accent-stone-950"
                        />
                        <span>Denizlik</span>
                      </label>
                    </div>

                    {/* Perde ayarları */}
                    <div className="border-t border-stone-200 pt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={win.curtainStyle}
                          onChange={(e) => updateWindow(win.id, { curtainStyle: e.target.value as CurtainStyle })}
                          className="flex-1 px-1.5 py-1 border border-stone-300 bg-white text-[10px] font-semibold"
                        >
                          <option value="none">Perde Yok</option>
                          <option value="sheer_and_drape">Tül + Fon Perde</option>
                          <option value="sheer_only">Sadece Tül Perde</option>
                          <option value="roman_blind">Stor / Katlamalı Perde</option>
                        </select>
                        {win.curtainStyle !== 'none' && (
                          <input
                            type="color"
                            value={win.curtainColorHex}
                            onChange={(e) => updateWindow(win.id, { curtainColorHex: e.target.value })}
                            title="Fon Perde Rengi"
                            className="w-6 h-6 border border-stone-300 cursor-pointer"
                          />
                        )}
                      </div>
                      {win.curtainStyle !== 'none' && (
                        <label className="block text-[10px] text-stone-600">
                          Perde Açıklığı: <strong className="font-mono">{Math.round(win.curtainOpenRatio * 100)}%</strong>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={win.curtainOpenRatio}
                            onChange={(e) => updateWindow(win.id, { curtainOpenRatio: Number(e.target.value) })}
                            className="w-full accent-stone-950"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Doors CRUD */}
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              02 · Kapı Ekle &amp; Açılış Yönü
            </span>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(DOOR_KIND_LABELS) as DoorKind[]).map((dk) => (
                <button
                  key={dk}
                  type="button"
                  onClick={() => addDoor(dk)}
                  className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[10px] font-semibold text-stone-800 transition truncate"
                >
                  + {DOOR_KIND_LABELS[dk]}
                </button>
              ))}
            </div>

            {wallDoors.map((door, idx) => (
              <div key={door.id} className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <select
                    value={door.kind}
                    onChange={(e) => updateDoor(door.id, { kind: e.target.value as DoorKind })}
                    className="flex-1 px-1.5 py-1 border border-stone-300 bg-white text-[11px] font-semibold"
                  >
                    {(Object.keys(DOOR_KIND_LABELS) as DoorKind[]).map((k) => (
                      <option key={k} value={k}>
                        K{idx + 1}: {DOOR_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeDoor(door.id)}
                    className="p-1 text-stone-500 hover:text-red-700"
                    title="Kapıyı Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {door.kind !== 'archway' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    {door.kind !== 'sliding' && (
                      <div className="flex border border-stone-300 bg-white">
                        <button
                          type="button"
                          onClick={() => updateDoor(door.id, { swing: 'inward' })}
                          className={`flex-1 py-1 text-[10px] font-semibold ${
                            door.swing === 'inward' ? 'bg-stone-950 text-white' : 'text-stone-700'
                          }`}
                        >
                          İçeri Açılır
                        </button>
                        <button
                          type="button"
                          onClick={() => updateDoor(door.id, { swing: 'outward' })}
                          className={`flex-1 py-1 text-[10px] font-semibold ${
                            door.swing === 'outward' ? 'bg-stone-950 text-white' : 'text-stone-700'
                          }`}
                        >
                          Dışarı Açılır
                        </button>
                      </div>
                    )}
                    {door.kind !== 'double' && (
                      <div className="flex border border-stone-300 bg-white">
                        <button
                          type="button"
                          onClick={() => updateDoor(door.id, { hinge: 'left' })}
                          className={`flex-1 py-1 text-[10px] font-semibold ${
                            door.hinge === 'left' ? 'bg-stone-950 text-white' : 'text-stone-700'
                          }`}
                        >
                          Sol Menteşe
                        </button>
                        <button
                          type="button"
                          onClick={() => updateDoor(door.id, { hinge: 'right' })}
                          className={`flex-1 py-1 text-[10px] font-semibold ${
                            door.hinge === 'right' ? 'bg-stone-950 text-white' : 'text-stone-700'
                          }`}
                        >
                          Sağ Menteşe
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-stone-600">
                    Soldan Konum: <strong className="font-mono">{Math.round(door.offsetCm)} cm</strong>
                    <input
                      type="range"
                      min={Math.round(door.widthCm * 0.5) + 10}
                      max={Math.max(Math.round(door.widthCm * 0.5) + 12, wallLenCm - Math.round(door.widthCm * 0.5) - 10)}
                      value={door.offsetCm}
                      onChange={(e) => updateDoor(door.id, { offsetCm: Number(e.target.value) })}
                      className="w-full accent-stone-950"
                    />
                  </label>
                  {door.kind !== 'archway' && (
                    <label className="text-[10px] text-stone-600">
                      Açılış Açısı: <strong className="font-mono">{Math.round(door.openAngleDeg)}°</strong>
                      <input
                        type="range"
                        min={0}
                        max={110}
                        value={door.openAngleDeg}
                        onChange={(e) => updateDoor(door.id, { openAngleDeg: Number(e.target.value) })}
                        className="w-full accent-stone-950"
                      />
                    </label>
                  )}
                  <label className="text-[10px] text-stone-600">
                    Genişlik (cm)
                    <input
                      type="number"
                      min={70}
                      max={260}
                      step={5}
                      value={door.widthCm}
                      onChange={(e) => updateDoor(door.id, { widthCm: Math.max(70, Number(e.target.value) || 95) })}
                      className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                    />
                  </label>
                  <label className="text-[10px] text-stone-600">
                    Kanat Rengi
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input
                        type="color"
                        value={door.colorHex}
                        onChange={(e) => updateDoor(door.id, { colorHex: e.target.value })}
                        className="w-7 h-6 border border-stone-300 cursor-pointer"
                      />
                      <span className="font-mono text-[10px]">{door.colorHex}</span>
                    </div>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (activeTab === 'structure') {
      return (
        <div className="space-y-5 text-xs">
          {/* Perde Havuzu (Curtain Cove + Hidden LED) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                01 · Perde Havuzu &amp; Gizli LED
              </span>
              <button
                type="button"
                onClick={addAllPerimeterCoves}
                className="text-[10px] font-semibold underline text-stone-700 hover:text-stone-950"
              >
                4 Duvara Ekle
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {WALL_IDS.map((wId) => {
                const active = project.curtainCoves.some((c) => c.wall === wId);
                return (
                  <button
                    key={wId}
                    type="button"
                    onClick={() => toggleCurtainCove(wId)}
                    className={`px-2 py-1.5 border text-[11px] font-semibold transition ${
                      active
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}
                    {WALL_LABELS[wId]}
                  </button>
                );
              })}
            </div>

            {project.curtainCoves.map((cove) => (
              <div key={cove.id} className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-900">{WALL_LABELS[cove.wall]} Perde Havuzu</span>
                  <label className="flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cove.ledEnabled}
                      onChange={(e) => updateCurtainCove(cove.id, { ledEnabled: e.target.checked })}
                      className="accent-amber-600"
                    />
                    <span>Gizli LED</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] text-stone-600">
                    Havuz Derinliği: <strong className="font-mono">{cove.depthCm} cm</strong>
                    <input
                      type="range"
                      min={12}
                      max={35}
                      value={cove.depthCm}
                      onChange={(e) => updateCurtainCove(cove.id, { depthCm: Number(e.target.value) })}
                      className="w-full accent-stone-950"
                    />
                  </label>
                  <label className="text-[10px] text-stone-600">
                    Sarkma: <strong className="font-mono">{cove.dropCm} cm</strong>
                    <input
                      type="range"
                      min={10}
                      max={30}
                      value={cove.dropCm}
                      onChange={(e) => updateCurtainCove(cove.id, { dropCm: Number(e.target.value) })}
                      className="w-full accent-stone-950"
                    />
                  </label>
                </div>
                {cove.ledEnabled && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1">
                      {[
                        { label: '2700K', hex: '#ffc985' },
                        { label: '3000K', hex: '#ffddb0' },
                        { label: '4000K', hex: '#fff4e0' },
                      ].map((k) => (
                        <button
                          key={k.label}
                          type="button"
                          onClick={() => updateCurtainCove(cove.id, { ledColorHex: k.hex })}
                          className={`px-1.5 py-0.5 border text-[10px] font-mono ${
                            cove.ledColorHex === k.hex ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-300 bg-white'
                          }`}
                        >
                          {k.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={2.2}
                      step={0.1}
                      value={cove.ledIntensity}
                      onChange={(e) => updateCurtainCove(cove.id, { ledIntensity: Number(e.target.value) })}
                      className="w-20 accent-amber-600"
                      title="LED Parlaklığı"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Columns */}
          <div className="border-t border-stone-200 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                02 · Kolonlar ({project.columns.length})
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addColumn('rect')}
                  className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                >
                  + Dikdörtgen
                </button>
                <button
                  type="button"
                  onClick={() => addColumn('round')}
                  className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                >
                  + Yuvarlak/Oval
                </button>
              </div>
            </div>

            {project.columns.map((col) => {
              const halfW = Math.round(project.widthM * 50);
              const halfD = Math.round(project.depthM * 50);
              return (
                <div key={col.id} className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900">
                      {col.shape === 'round' ? 'Yuvarlak/Oval Kolon' : 'Kare/Dikdörtgen Kolon'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={col.colorHex}
                        onChange={(e) => updateColumn(col.id, { colorHex: e.target.value })}
                        className="w-5 h-5 border border-stone-300 cursor-pointer"
                      />
                      <button type="button" onClick={() => removeColumn(col.id)} className="text-stone-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-stone-600">
                      En (cm)
                      <input
                        type="number"
                        min={15}
                        max={140}
                        step={5}
                        value={col.widthCm}
                        onChange={(e) => updateColumn(col.id, { widthCm: Number(e.target.value) || 40 })}
                        className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                      />
                    </label>
                    <label className="text-[10px] text-stone-600">
                      Derinlik (cm)
                      <input
                        type="number"
                        min={15}
                        max={140}
                        step={5}
                        value={col.depthCm}
                        onChange={(e) => updateColumn(col.id, { depthCm: Number(e.target.value) || 40 })}
                        className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                      />
                    </label>
                    <label className="text-[10px] text-stone-600">
                      X Konum: <strong className="font-mono">{col.xCm} cm</strong>
                      <input
                        type="range"
                        min={-halfW + 15}
                        max={halfW - 15}
                        value={col.xCm}
                        onChange={(e) => updateColumn(col.id, { xCm: Number(e.target.value) })}
                        className="w-full accent-stone-950"
                      />
                    </label>
                    <label className="text-[10px] text-stone-600">
                      Z Konum: <strong className="font-mono">{col.zCm} cm</strong>
                      <input
                        type="range"
                        min={-halfD + 15}
                        max={halfD - 15}
                        value={col.zCm}
                        onChange={(e) => updateColumn(col.id, { zCm: Number(e.target.value) })}
                        className="w-full accent-stone-950"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { l: 'Sol-Üst', x: -halfW + col.widthCm / 2, z: -halfD + col.depthCm / 2 },
                      { l: 'Sağ-Üst', x: halfW - col.widthCm / 2, z: -halfD + col.depthCm / 2 },
                      { l: 'Sol-Alt', x: -halfW + col.widthCm / 2, z: halfD - col.depthCm / 2 },
                      { l: 'Sağ-Alt', x: halfW - col.widthCm / 2, z: halfD - col.depthCm / 2 },
                    ].map((cr) => (
                      <button
                        key={cr.l}
                        type="button"
                        onClick={() => updateColumn(col.id, { xCm: Math.round(cr.x), zCm: Math.round(cr.z) })}
                        className="px-1.5 py-0.5 border border-stone-300 bg-white hover:border-stone-950 text-[10px]"
                      >
                        {cr.l}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Ceiling Beams */}
          <div className="border-t border-stone-200 pt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                03 · Tavan Kirişleri ({project.beams.length})
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addBeam('x')}
                  className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                >
                  + Yatay Kiriş
                </button>
                <button
                  type="button"
                  onClick={() => addBeam('z')}
                  className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                >
                  + Dikey Kiriş
                </button>
              </div>
            </div>

            {project.beams.map((beam) => {
              const spanHalf = Math.round((beam.axis === 'x' ? project.depthM : project.widthM) * 50);
              return (
                <div key={beam.id} className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900">
                      {beam.axis === 'x' ? 'Yatay Tavan Kirişi (Sol→Sağ)' : 'Dikey Tavan Kirişi (Üst→Alt)'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        value={beam.colorHex}
                        onChange={(e) => updateBeam(beam.id, { colorHex: e.target.value })}
                        className="w-5 h-5 border border-stone-300 cursor-pointer"
                      />
                      <button type="button" onClick={() => removeBeam(beam.id)} className="text-stone-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <label className="block text-[10px] text-stone-600">
                    Konum: <strong className="font-mono">{beam.positionCm} cm</strong>
                    <input
                      type="range"
                      min={-spanHalf + 15}
                      max={spanHalf - 15}
                      value={beam.positionCm}
                      onChange={(e) => updateBeam(beam.id, { positionCm: Number(e.target.value) })}
                      className="w-full accent-stone-950"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10px] text-stone-600">
                      Genişlik (cm)
                      <input
                        type="number"
                        min={15}
                        max={80}
                        step={5}
                        value={beam.widthCm}
                        onChange={(e) => updateBeam(beam.id, { widthCm: Number(e.target.value) || 30 })}
                        className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                      />
                    </label>
                    <label className="text-[10px] text-stone-600">
                      Sarkma (cm)
                      <input
                        type="number"
                        min={10}
                        max={75}
                        step={5}
                        value={beam.dropCm}
                        onChange={(e) => updateBeam(beam.id, { dropCm: Number(e.target.value) || 32 })}
                        className="w-full px-1.5 py-1 border border-stone-300 bg-white font-mono text-[11px]"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (activeTab === 'sun') {
      const northWallDir = bearingToCompassLabel(project.sun.northAngleDeg);
      const eastWallDir = bearingToShortCode(project.sun.northAngleDeg + 90);
      const southWallDir = bearingToShortCode(project.sun.northAngleDeg + 180);
      const westWallDir = bearingToShortCode(project.sun.northAngleDeg + 270);

      return (
        <div className="space-y-5 text-xs">
          {/* Interactive Compass Rose */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                01 · Cephe &amp; Pusula Yönü
              </span>
              <span className="font-mono font-bold text-stone-950">{Math.round(project.sun.northAngleDeg)}°</span>
            </div>

            <div className="border border-stone-200 bg-[#faf9f6] p-3 flex flex-col items-center gap-2">
              <svg viewBox="0 0 160 160" className="w-36 h-36">
                <circle cx="80" cy="80" r="66" fill="#ffffff" stroke="#d6d3d1" strokeWidth="1.5" />
                <circle cx="80" cy="80" r="46" fill="none" stroke="#e7e5e4" strokeDasharray="3 3" />
                {/* Room schematic square in center */}
                <rect x="64" y="66" width="32" height="28" fill="#faf9f6" stroke="#1c1917" strokeWidth="1.5" />
                <text x="80" y="61" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#1c1917" fontWeight="700">
                  Üst (A)
                </text>
                {/* Rotating True North arrow */}
                <g transform={`rotate(${-project.sun.northAngleDeg} 80 80)`}>
                  <polygon points="80,14 74,30 86,30" fill="#dc2626" />
                  <text x="80" y="11" textAnchor="middle" fontSize="9" fontWeight="800" fill="#dc2626">
                    K
                  </text>
                  <text x="148" y="83" textAnchor="middle" fontSize="8" fill="#78716c">
                    D
                  </text>
                  <text x="80" y="155" textAnchor="middle" fontSize="8" fill="#78716c">
                    G
                  </text>
                  <text x="12" y="83" textAnchor="middle" fontSize="8" fill="#78716c">
                    B
                  </text>
                </g>
                {/* Live sun position dot on compass perimeter */}
                {!solar.isNight && (
                  <g transform={`rotate(${solar.azimuthDeg - project.sun.northAngleDeg} 80 80)`}>
                    <line x1="80" y1="80" x2="80" y2="26" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2 2" />
                    <circle cx="80" cy="24" r="6" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                  </g>
                )}
              </svg>

              <p className="text-[11px] text-center text-stone-700">
                Üst Pencere Cephesi: <strong className="text-stone-950">{northWallDir}</strong>
              </p>
              <div className="grid grid-cols-4 gap-1 w-full text-center text-[10px] font-mono text-stone-500">
                <span>A: {bearingToShortCode(project.sun.northAngleDeg)}</span>
                <span>B: {eastWallDir}</span>
                <span>C: {southWallDir}</span>
                <span>D: {westWallDir}</span>
              </div>
            </div>

            <label className="block text-[10px] text-stone-600">
              Pusula Açısı (0°–355°)
              <input
                type="range"
                min={0}
                max={355}
                step={5}
                value={project.sun.northAngleDeg}
                onChange={(e) => setProject((p) => ({ ...p, sun: { ...p.sun, northAngleDeg: Number(e.target.value) } }))}
                className="w-full accent-stone-950"
              />
            </label>

            <div className="grid grid-cols-4 gap-1">
              {[
                { l: 'Kuzey', deg: 0 },
                { l: 'Doğu', deg: 90 },
                { l: 'Güney', deg: 180 },
                { l: 'Batı', deg: 270 },
              ].map((dir) => (
                <button
                  key={dir.l}
                  type="button"
                  onClick={() => setProject((p) => ({ ...p, sun: { ...p.sun, northAngleDeg: dir.deg } }))}
                  className={`py-1.5 border text-[10px] font-semibold ${
                    Math.abs(project.sun.northAngleDeg - dir.deg) < 12
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-white text-stone-700 hover:border-stone-500'
                  }`}
                >
                  {dir.l}
                </button>
              ))}
            </div>
          </div>

          {/* Solar Hour & Day Simulation */}
          <div className="border-t border-stone-200 pt-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                02 · Gün Saati &amp; Güneş Açısı
              </span>
              <span className="font-mono text-sm font-bold text-stone-950">{solar.formattedTime}</span>
            </div>

            <input
              type="range"
              min={6}
              max={20.5}
              step={0.1}
              value={project.sun.hour}
              onChange={(e) => setProject((p) => ({ ...p, sun: { ...p.sun, hour: Number(e.target.value) } }))}
              className="w-full accent-amber-600"
            />

            <div className="grid grid-cols-4 gap-1">
              {[
                { l: 'Sabah 09', h: 9.0 },
                { l: 'Öğle 12', h: 12.5 },
                { l: 'İkindi 16', h: 16.2 },
                { l: 'Akşam 20', h: 20.0 },
              ].map((t) => (
                <button
                  key={t.l}
                  type="button"
                  onClick={() => setProject((p) => ({ ...p, sun: { ...p.sun, hour: t.h } }))}
                  className="py-1 border border-stone-200 hover:border-stone-950 bg-white text-[10px] font-semibold text-stone-700"
                >
                  {t.l}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setSunPlaying((v) => !v)}
              className={`w-full py-2 border font-semibold flex items-center justify-center gap-1.5 transition ${
                sunPlaying
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-stone-950 bg-stone-950 text-white hover:bg-stone-800'
              }`}
            >
              {sunPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{sunPlaying ? 'Güneş Hareketini Durdur' : 'Gün Boyu Güneş Simülasyonu Oynat'}</span>
            </button>
          </div>

          {/* Season & Telemetry */}
          <div className="border-t border-stone-200 pt-4 space-y-2.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · Mevsim (41°K Türkiye Enlemi)
            </span>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'summer', label: 'Yaz (21 Haz)' },
                  { id: 'equinox', label: 'Bahar / Güz' },
                  { id: 'winter', label: 'Kış (21 Ara)' },
                ] as Array<{ id: SolarSeason; label: string }>
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setProject((p) => ({ ...p, sun: { ...p.sun, season: s.id } }))}
                  className={`py-1.5 border text-[10px] font-semibold ${
                    project.sun.season === s.id
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-white text-stone-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <label className="block text-[10px] text-stone-600">
              Güneş Parlaklığı: <strong className="font-mono">{Math.round(project.sun.sunIntensity * 100)}%</strong>
              <input
                type="range"
                min={0.5}
                max={2.6}
                step={0.1}
                value={project.sun.sunIntensity}
                onChange={(e) => setProject((p) => ({ ...p, sun: { ...p.sun, sunIntensity: Number(e.target.value) } }))}
                className="w-full accent-stone-950"
              />
            </label>

            <div className="grid grid-cols-2 gap-2 border border-stone-200 bg-[#faf9f6] p-2.5 font-mono text-[10px]">
              <div>
                <span className="text-stone-500 block">Güneş Eğimi</span>
                <strong className="text-stone-950">{solar.elevationDeg.toFixed(1)}°</strong>
              </div>
              <div>
                <span className="text-stone-500 block">Güneş Azimut</span>
                <strong className="text-stone-950">{solar.azimuthDeg.toFixed(0)}°</strong>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'objects') {
      return (
        <div className="space-y-4 text-xs">
          {/* Built-in Parametric Architectural Modules */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              01 · Hazır Mimari Modüller (Ölçü &amp; Renk Ayarlı)
            </span>
            <div className="grid grid-cols-1 gap-1.5">
              {(
                [
                  { id: 'fireplace_marble', title: 'Mermer Şömine + OLED TV Duvarı', sub: '220 × 44 × 280 cm · Alev Işıklı' },
                  { id: 'tv_wall_unit', title: 'Ahşap Çıtalı TV Duvar Ünitesi', sub: '240 × 42 × 250 cm · Gizli LED' },
                  { id: 'wall_tv', title: 'Duvara Asılı OLED TV (65")', sub: '145 × 6 × 84 cm · Yükseklik Ayarlı' },
                  { id: 'rug_custom', title: 'Özel Ölçü Dokuma Halı', sub: '260 × 190 cm · Alt Çarpışmasız' },
                  { id: 'chandelier', title: 'Pirinç Halka Mimari Avize', sub: '90 × 90 cm · Tavana Asılı' },
                ] as Array<{ id: ParametricFurnitureKind; title: string; sub: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addParametricModule(m.id)}
                  className="text-left px-3 py-2 border border-stone-200 hover:border-stone-950 bg-white flex items-center justify-between gap-2 transition"
                >
                  <div>
                    <p className="font-semibold text-stone-950">{m.title}</p>
                    <p className="text-[10px] font-mono text-stone-500">{m.sub}</p>
                  </div>
                  <Plus className="w-4 h-4 text-stone-700 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Direct CAD Upload */}
          <div className="border-t border-stone-200 pt-3">
            <label className="w-full py-2.5 px-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 font-semibold flex items-center justify-center gap-2 cursor-pointer transition">
              {uploadingCad ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>Kendi 3B CAD Dosyanı Yükle (.FBX/.OBJ/.GLB/.STL)</span>
              <input
                type="file"
                accept=".fbx,.glb,.gltf,.obj,.stl"
                className="hidden"
                onChange={(e) => {
                  handleCadUpload(e.target.files?.[0] || null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>

          {/* Placed Objects List */}
          <div className="border-t border-stone-200 pt-3 space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              02 · Odadaki Parçalar ({project.objects.length})
            </span>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {project.objects.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSelectedObjectId(o.id)}
                  className={`w-full px-2.5 py-1.5 border text-left flex items-center justify-between gap-2 text-[11px] ${
                    selectedObjectId === o.id
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-400'
                  }`}
                >
                  <span className="truncate font-medium">{o.name}</span>
                  <span className="text-[10px] font-mono opacity-75 shrink-0">{o.dimensionsCm.split(' ')[0]}cm</span>
                </button>
              ))}
            </div>
          </div>

          {/* Catalog 3D Furniture */}
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · 1:1 3B Mobilya Kütüphanesi ({catalog.length})
            </span>
            <div className="grid grid-cols-2 gap-2">
              {catalog.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addCatalogProduct(p)}
                  className="text-left border border-stone-200 hover:border-stone-950 bg-white overflow-hidden transition group"
                >
                  <div className="h-20 bg-[#f5f4f0] flex items-center justify-center p-1.5 border-b border-stone-200">
                    {p.thumbUrl ? (
                      <img src={p.thumbUrl} alt={p.name} className="w-full h-full object-contain group-hover:scale-105 transition" />
                    ) : (
                      <span className="text-[10px] font-mono text-stone-500">3B Model</span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] font-semibold text-stone-950 line-clamp-1">{p.name}</p>
                    <p className="text-[9px] font-mono text-stone-500 truncate">{p.dimensionsCm}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Pinterest AI Tab
    return (
      <PinterestAIPanel
        project={project}
        onApplyRoomStyle={(style) => {
          setProject((prev) => ({
            ...prev,
            floorMaterial: style.floorMaterial || prev.floorMaterial,
            floorTintHex: style.floorTintHex || prev.floorTintHex,
            walls: {
              north: { colorHex: style.wallColorHex || prev.walls.north.colorHex, pattern: 'smooth' },
              south: { colorHex: style.wallColorHex || prev.walls.south.colorHex, pattern: style.wallPattern || 'smooth' },
              west: { colorHex: style.accentWallColorHex || style.wallColorHex || prev.walls.west.colorHex, pattern: style.wallPattern || 'smooth' },
              east: { colorHex: style.wallColorHex || prev.walls.east.colorHex, pattern: 'smooth' },
            },
            windows: prev.windows.map((w) => ({
              ...w,
              curtainColorHex: style.curtainColorHex || w.curtainColorHex,
            })),
            sun: {
              ...prev.sun,
              hour: style.suggestedSunHour ? Math.max(8, Math.min(18, style.suggestedSunHour)) : prev.sun.hour,
            },
          }));
        }}
        onAddGeneratedObject={(obj) => {
          setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
          setSelectedObjectId(obj.id);
        }}
        onCaptureViewport={() => viewportRef.current?.captureSnapshot(true) || null}
        onToast={showToast}
      />
    );
  };

  return (
    <div className="fixed inset-0 h-[100dvh] bg-[#e8e5de] text-stone-950 flex flex-col overflow-hidden">
      {/* Top Architectural Studio Header */}
      <header className="h-14 px-3 sm:px-4 bg-white border-b border-stone-200 flex items-center justify-between gap-2 shrink-0 z-20">
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="lg:hidden p-2 border border-stone-300 text-stone-800"
            aria-label="Araç Paneli"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-sm font-extrabold tracking-tight text-stone-950 whitespace-nowrap">
                MekanAR
              </span>
              <span className="h-3.5 w-px bg-stone-300 hidden sm:inline-block" />
              <span className="text-xs font-semibold text-stone-600 hidden sm:inline whitespace-nowrap">
                Mimari 3B Stüdyo
              </span>
            </div>
            <p className="text-[10px] font-mono text-stone-500 whitespace-nowrap">
              {project.widthM.toFixed(1)} × {project.depthM.toFixed(1)} × {project.ceilingM.toFixed(2)} m ·{' '}
              {(project.widthM * project.depthM).toFixed(1)} m² · {solar.formattedTime} ({bearingToShortCode(project.sun.northAngleDeg)})
            </p>
          </div>
        </div>

        {/* Camera & Display Controls */}
        <div className="hidden md:flex items-center gap-1">
          {(
            [
              { id: 'free', label: 'Serbest 3B', icon: Layers },
              { id: 'plan', label: '2D Plan', icon: Grid3X3 },
              { id: 'inside', label: 'Göz Hizası', icon: Eye },
            ] as const
          ).map((c) => {
            const Icon = c.icon;
            const active = cameraMode === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCameraMode(c.id)}
                className={`px-2.5 py-1.5 border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                  active
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{c.label}</span>
              </button>
            );
          })}

          <span className="h-4 w-px bg-stone-200 mx-1" />

          <button
            type="button"
            onClick={() => setShowGrid((v) => !v)}
            className={`px-2 py-1.5 border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
              showGrid ? 'border-stone-400 bg-stone-200/70 text-stone-950' : 'border-stone-200 bg-white text-stone-500'
            }`}
            title="50 cm Izgara"
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Izgara</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDoorArcs((v) => !v)}
            className={`px-2 py-1.5 border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
              showDoorArcs ? 'border-stone-400 bg-stone-200/70 text-stone-950' : 'border-stone-200 bg-white text-stone-500'
            }`}
            title="Kapı Açılış Yayları"
          >
            <DoorOpen className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Kapı Yayı</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSunOrb((v) => !v)}
            className={`px-2 py-1.5 border text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
              showSunOrb ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-stone-200 bg-white text-stone-500'
            }`}
            title="Güneş Işını Göstergesi"
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Güneş</span>
          </button>
        </div>

        {/* Project Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleSaveProjectJson}
            className="px-2.5 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-stone-800 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Projeyi JSON olarak kaydet"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kaydet</span>
          </button>

          <label
            className="px-2.5 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-stone-800 text-[11px] font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            title="Kayıtlı proje dosyasını aç"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Aç</span>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                handleLoadProjectJson(e.target.files?.[0] || null);
                e.currentTarget.value = '';
              }}
            />
          </label>

          <button
            type="button"
            onClick={handleDownloadSnapshot}
            className="px-2.5 py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Görüntü Al</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace: Left Architectural Inspector + Full 3D Viewport */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Left Inspector Drawer */}
        <aside
          className={`${
            mobileSidebarOpen ? 'fixed inset-y-14 left-0 z-30 flex' : 'hidden lg:flex'
          } w-[340px] xl:w-[376px] bg-white border-r border-stone-200 flex-col shrink-0 shadow-xl lg:shadow-none`}
        >
          {/* 6 Architectural Tool Tabs */}
          <nav className="grid grid-cols-6 border-b border-stone-200 bg-[#faf9f6] shrink-0">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`py-2.5 px-1 flex flex-col items-center justify-center gap-1 border-b-2 text-[10px] font-semibold transition whitespace-nowrap ${
                    active
                      ? 'border-stone-950 bg-white text-stone-950'
                      : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Scrollable Active Tab Body */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">{renderSidebarContent()}</div>
        </aside>

        {/* Right 3D Architectural Viewport */}
        <main className="flex-1 min-w-0 relative overflow-hidden">
          <ArchViewport3D
            ref={viewportRef}
            project={project}
            cameraMode={cameraMode}
            showGrid={showGrid}
            showSunOrb={showSunOrb}
            showDoorArcs={showDoorArcs}
            selectedObjectId={selectedObjectId}
            onSelectObject={setSelectedObjectId}
            onMoveObject={(id, x, z) =>
              setProject((prev) => ({
                ...prev,
                objects: prev.objects.map((o) => (o.id === id ? { ...o, x, z } : o)),
              }))
            }
            onWarningsChange={setWarnings}
            onLoadingChange={setLoadingCount}
            onToast={showToast}
          />

          {/* Mobile Camera Switcher */}
          <div className="md:hidden absolute top-3 left-3 flex items-center gap-1 bg-white/95 border border-stone-300 p-1 shadow-sm">
            {(
              [
                { id: 'free', label: '3B' },
                { id: 'plan', label: '2D' },
                { id: 'inside', label: 'İç' },
              ] as const
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCameraMode(c.id)}
                className={`px-2 py-1 text-[11px] font-bold ${
                  cameraMode === c.id ? 'bg-stone-950 text-white' : 'text-stone-700'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Top-right Live Telemetry & Sun Quick Bar */}
          <div className="absolute top-3 right-3 bg-white/95 border border-stone-200 px-3 py-2 shadow-sm text-[11px] flex items-center gap-3">
            <div className="font-mono text-stone-800">
              <span className="text-stone-500">Saat </span>
              <strong>{solar.formattedTime}</strong>
              <span className="text-stone-400 mx-1.5">·</span>
              <span className="text-stone-500">Eğim </span>
              <strong>{solar.elevationDeg.toFixed(0)}°</strong>
            </div>
            <button
              type="button"
              onClick={() => setSunPlaying((v) => !v)}
              className="p-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
              title="Güneş hareketini oynat / durdur"
            >
              {sunPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            </button>
          </div>

          {/* Loading Indicator */}
          {loadingCount > 0 && (
            <div className="absolute top-3 left-3 hidden md:flex items-center gap-2 bg-white/95 border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm pointer-events-none">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>3B modeller yükleniyor ({loadingCount})...</span>
            </div>
          )}

          {/* Opening Overlap Warnings */}
          {warnings.length > 0 && (
            <div className="absolute top-14 right-3 max-w-xs bg-amber-50 border border-amber-400 px-3 py-2 text-[11px] text-amber-950 shadow-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}

          {/* Toast */}
          {toastMsg && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-stone-950 text-white px-4 py-2 text-xs font-medium shadow-lg pointer-events-none max-w-[90vw] truncate">
              {toastMsg}
            </div>
          )}

          {/* Bottom Floating Selected Object Inspector */}
          {selectedObj && (
            <div className="absolute bottom-3 left-3 right-3 max-w-4xl mx-auto bg-white/98 border border-stone-300 shadow-xl px-3.5 py-2.5 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold text-stone-950 truncate">{selectedObj.name}</p>
                  <p className="text-[10px] font-mono text-stone-500">
                    {selectedObj.dimensionsCm} · Yerden Y: {Math.round(selectedObj.y * 100)} cm
                    {selectedWallClearance &&
                      ` · Sol ${selectedWallClearance.left} · Sağ ${selectedWallClearance.right} · Üst ${selectedWallClearance.north} cm`}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => updateSelectedObject({ rot: selectedObj.rot - Math.PI / 12 })}
                    className="p-1.5 border border-stone-300 hover:border-stone-950 bg-white"
                    title="-15° Döndür"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedObject({ rot: selectedObj.rot + Math.PI / 12 })}
                    className="p-1.5 border border-stone-300 hover:border-stone-950 bg-white"
                    title="+15° Döndür"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedObject({ rot: selectedObj.rot + Math.PI / 2 })}
                    className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white font-mono text-[11px] font-bold"
                  >
                    90°
                  </button>
                  <button
                    type="button"
                    onClick={duplicateSelected}
                    className="p-1.5 border border-stone-300 hover:border-stone-950 bg-white"
                    title="Çoğalt"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                  </button>
                  {selectedObj.glbUrl && (
                    <a
                      href={
                        selectedObj.productRef?.id
                          ? `/?urun=${encodeURIComponent(selectedObj.productRef.id)}&mod=ar`
                          : `/?glb=${encodeURIComponent(selectedObj.glbUrl)}&name=${encodeURIComponent(selectedObj.name)}&mod=ar`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 bg-stone-950 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>AR</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="p-1.5 border border-red-200 hover:border-red-600 bg-red-50 text-red-700"
                    title="Sil"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedObjectId(null)}
                    className="p-1.5 text-stone-400 hover:text-stone-950"
                    title="Seçimi Kapat"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Exact cm resizing + Wall elevation Y + Snap to Wall */}
              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-stone-200 text-[10px]">
                <label className="flex items-center gap-1 text-stone-600">
                  En
                  <input
                    type="number"
                    min={20}
                    max={600}
                    step={5}
                    value={Math.round(selectedObj.widthM * 100)}
                    onChange={(e) => updateSelectedObject({ widthM: Math.max(0.2, (Number(e.target.value) || 100) / 100) })}
                    className="w-14 px-1 py-0.5 border border-stone-300 font-mono text-stone-950"
                  />
                </label>
                <label className="flex items-center gap-1 text-stone-600">
                  Der.
                  <input
                    type="number"
                    min={4}
                    max={500}
                    step={5}
                    value={Math.round(selectedObj.depthM * 100)}
                    onChange={(e) => updateSelectedObject({ depthM: Math.max(0.04, (Number(e.target.value) || 60) / 100) })}
                    className="w-14 px-1 py-0.5 border border-stone-300 font-mono text-stone-950"
                  />
                </label>
                <label className="flex items-center gap-1 text-stone-600">
                  Yük.
                  <input
                    type="number"
                    min={2}
                    max={450}
                    step={5}
                    value={Math.round(selectedObj.heightM * 100)}
                    onChange={(e) => updateSelectedObject({ heightM: Math.max(0.02, (Number(e.target.value) || 80) / 100) })}
                    className="w-14 px-1 py-0.5 border border-stone-300 font-mono text-stone-950"
                  />
                </label>
                <label className="flex items-center gap-1 text-stone-600">
                  Yerden Y
                  <input
                    type="number"
                    min={0}
                    max={Math.round(project.ceilingM * 100)}
                    step={5}
                    value={Math.round(selectedObj.y * 100)}
                    onChange={(e) => updateSelectedObject({ y: Math.max(0, (Number(e.target.value) || 0) / 100) })}
                    className="w-14 px-1 py-0.5 border border-stone-300 font-mono text-stone-950"
                  />
                </label>

                {selectedObj.parametricKind && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedObj.parametricColorHex || '#ece9e2'}
                      onChange={(e) => updateSelectedObject({ parametricColorHex: e.target.value })}
                      title="Ana Renk"
                      className="w-5 h-5 border border-stone-300 cursor-pointer"
                    />
                    <input
                      type="color"
                      value={selectedObj.parametricAccentHex || '#272624'}
                      onChange={(e) => updateSelectedObject({ parametricAccentHex: e.target.value })}
                      title="İkincil Renk"
                      className="w-5 h-5 border border-stone-300 cursor-pointer"
                    />
                  </div>
                )}

                <span className="h-4 w-px bg-stone-200 hidden sm:inline-block" />

                <div className="flex items-center gap-1">
                  <span className="text-stone-500">Duvara Yasla:</span>
                  {WALL_IDS.map((wId) => (
                    <button
                      key={wId}
                      type="button"
                      onClick={() => snapSelectedToWall(wId)}
                      className="px-1.5 py-0.5 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] font-semibold"
                    >
                      {wId === 'north' ? 'Üst' : wId === 'east' ? 'Sağ' : wId === 'south' ? 'Alt' : 'Sol'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ArchitecturalStudioPage;
