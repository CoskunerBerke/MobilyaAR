import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
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
  Save,
  Search,
  Sofa,
  Sparkles,
  Sun,
  Upload,
} from 'lucide-react';
import { PRODUCTS, type Product } from '../lib/products';
import { fetchCloudCatalog } from '../lib/storageClient';
import { convertCadFileToGlb } from '../lib/cadImport';
import { clampToRoomWalls, findOpenSpawnPosition, parseProductFootprintM, type OBB2D } from '../lib/collision2d';
import { ArchViewport3D, type ArchCameraMode, type ArchViewportHandle } from './ArchViewport3D';
import { NumericInput } from './NumericInput';
import { PinterestAIPanel } from './PinterestAIPanel';
import { SelectionInspector } from './SelectionInspector';
import { QUICK_ADD_SUGGESTIONS, parseQuickAddQuery } from './quickAddParser';
import { bearingToCompassLabel, bearingToShortCode, computeSolarLighting } from './solarMath';
import {
  DOOR_KIND_LABELS,
  WALL_LABELS,
  WINDOW_KIND_LABELS,
  createDefaultArchitectProject,
  getWallLengthM,
  type ArchBeam,
  type ArchColumn,
  type ArchCurtainCove,
  type ArchDoor,
  type ArchPlacedObject,
  type ArchRoomProject,
  type ArchSelection,
  type ArchWallZone,
  type ArchWindow,
  type DoorKind,
  type ParametricFurnitureKind,
  type SolarSeason,
  type WallId,
  type WallPattern,
  type WindowKind,
} from './types';

type StudioTab = 'room' | 'objects' | 'sun' | 'pinterest';
type RoomAccordion = 'dims' | 'openings' | 'structure';

const WALL_IDS: WallId[] = ['north', 'east', 'south', 'west'];

const PARAMETRIC_CARDS: Array<{
  kind: ParametricFurnitureKind;
  name: string;
  sub: string;
  w: number;
  d: number;
  h: number;
  y: number;
  mount: ArchPlacedObject['mountMode'];
  c1: string;
  c2: string;
}> = [
  { kind: 'wall_tv', name: 'Duvar OLED TV', sub: '145 × 6 × 84 cm', w: 1.45, d: 0.06, h: 0.84, y: 1.15, mount: 'wall', c1: '#18181b', c2: '#0b0c10' },
  { kind: 'fireplace_marble', name: 'Mermer Şömine', sub: '200 × 44 × 260 cm', w: 2.0, d: 0.44, h: 2.6, y: 0, mount: 'wall', c1: '#ece9e2', c2: '#252423' },
  { kind: 'tv_wall_unit', name: 'Çıtalı TV Ünitesi', sub: '240 × 42 × 245 cm', w: 2.4, d: 0.42, h: 2.45, y: 0, mount: 'wall', c1: '#b78e66', c2: '#252423' },
  { kind: 'wardrobe', name: 'Mimari Gardırop', sub: '220 × 60 × 240 cm', w: 2.2, d: 0.6, h: 2.4, y: 0, mount: 'wall', c1: '#ebe6dd', c2: '#2b2a28' },
  { kind: 'dining_table', name: 'Yemek Masası', sub: '180 × 95 × 75 cm', w: 1.8, d: 0.95, h: 0.75, y: 0, mount: 'floor', c1: '#9b7452', c2: '#232325' },
  { kind: 'bookshelf', name: 'Işıklı Kitaplık', sub: '160 × 36 × 220 cm', w: 1.6, d: 0.36, h: 2.2, y: 0, mount: 'wall', c1: '#876246', c2: '#242322' },
  { kind: 'bed_frame', name: 'Çift Kişilik Yatak', sub: '175 × 212 × 112 cm', w: 1.75, d: 2.12, h: 1.12, y: 0, mount: 'floor', c1: '#dcd5c9', c2: '#f5f2ec' },
  { kind: 'console_table', name: 'Modern Konsol', sub: '165 × 44 × 78 cm', w: 1.65, d: 0.44, h: 0.78, y: 0, mount: 'wall', c1: '#a47e5a', c2: '#232324' },
  { kind: 'ac_unit', name: 'Duvar Kliması', sub: '95 × 24 × 32 cm', w: 0.95, d: 0.24, h: 0.32, y: 2.35, mount: 'wall', c1: '#f5f5f3', c2: '#2d2f33' },
  { kind: 'wall_mirror', name: 'Duvar Aynası', sub: '90 × 4 × 185 cm', w: 0.9, d: 0.04, h: 1.85, y: 0.2, mount: 'wall', c1: '#c8a86b', c2: '#dce6ee' },
  { kind: 'wall_art', name: 'Duvar Tablosu', sub: '120 × 4 × 90 cm', w: 1.2, d: 0.04, h: 0.9, y: 1.2, mount: 'wall', c1: '#2a2826', c2: '#dfd6c8' },
  { kind: 'floor_lamp', name: 'Modern Lambader', sub: '42 × 42 × 168 cm', w: 0.42, d: 0.42, h: 1.68, y: 0, mount: 'floor', c1: '#242322', c2: '#f5efe2' },
  { kind: 'rug_custom', name: 'Özel Ölçü Halı', sub: '260 × 190 cm', w: 2.6, d: 1.9, h: 0.015, y: 0, mount: 'rug', c1: '#e6dfd3', c2: '#b8ad9b' },
  { kind: 'chandelier', name: 'Pirinç Avize', sub: '85 × 85 cm', w: 0.85, d: 0.85, h: 0.5, y: 2.32, mount: 'ceiling', c1: '#c8a86b', c2: '#fff4dc' },
];

export const ArchitecturalStudioPage: React.FC = () => {
  const [catalog, setCatalog] = useState<Product[]>(PRODUCTS);
  const [project, setProject] = useState<ArchRoomProject>(() => createDefaultArchitectProject(PRODUCTS));
  const [activeTab, setActiveTab] = useState<StudioTab>('room');
  const [openAccordion, setOpenAccordion] = useState<RoomAccordion>('openings');
  const [cameraMode, setCameraMode] = useState<ArchCameraMode>('free');
  const [showGrid, setShowGrid] = useState(true);
  const [showSunOrb, setShowSunOrb] = useState(true);
  const [showDoorArcs, setShowDoorArcs] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [activeWall, setActiveWall] = useState<WallId>('north');
  const [selection, setSelection] = useState<ArchSelection>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingCount, setLoadingCount] = useState(0);
  const [uploadingCad, setUploadingCad] = useState(false);
  const [sunPlaying, setSunPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Quick-Add Command Bar ("televizyon 160x90", "şömine 200 cm", "gardırop", "oval pencere"...)
  const [quickQuery, setQuickQuery] = useState('');
  const [quickFocused, setQuickFocused] = useState(false);
  const [quickW, setQuickW] = useState('');
  const [quickD, setQuickD] = useState('');
  const [quickH, setQuickH] = useState('');

  const viewportRef = useRef<ArchViewportHandle | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 2800);
  }, []);

  useEffect(() => {
    document.title = 'MekanAR · Mimari 3B Stüdyo';
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

  useEffect(() => {
    if (!sunPlaying) return;
    const id = window.setInterval(() => {
      setProject((prev) => {
        const nextH = prev.sun.hour + 0.2;
        return { ...prev, sun: { ...prev.sun, hour: nextH > 20.2 ? 6.2 : Number(nextH.toFixed(2)) } };
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [sunPlaying]);

  // Keep activeWall in sync when clicking a wall or wallZone in 3D
  useEffect(() => {
    if (selection?.type === 'wall') setActiveWall(selection.wall);
    else if (selection?.type === 'wallZone') {
      const z = (project.wallZones || []).find((wz) => wz.id === selection.id);
      if (z) setActiveWall(z.wall);
    }
  }, [selection, project.wallZones]);

  const solar = useMemo(() => computeSolarLighting(project.sun), [project.sun]);
  const parsedQuick = useMemo(
    () => parseQuickAddQuery(quickQuery, catalog, project.ceilingM),
    [quickQuery, catalog, project.ceilingM]
  );

  // Sync editable quick-size boxes whenever parsed command changes
  useEffect(() => {
    if (!parsedQuick) {
      setQuickW('');
      setQuickD('');
      setQuickH('');
      return;
    }
    if (parsedQuick.kind === 'parametric') {
      setQuickW(String(parsedQuick.widthCm));
      setQuickD(String(parsedQuick.depthCm));
      setQuickH(String(parsedQuick.heightCm));
    } else if (parsedQuick.kind === 'wallZone') {
      setQuickW(String(parsedQuick.widthCm));
      setQuickD('2');
      setQuickH(String(parsedQuick.heightCm || Math.round(project.ceilingM * 100)));
    } else {
      setQuickW('');
      setQuickD('');
      setQuickH('');
    }
  }, [parsedQuick, project.ceilingM]);

  const updateRoomDim = (patch: Partial<Pick<ArchRoomProject, 'widthM' | 'depthM' | 'ceilingM'>>) => {
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

  // Helper: place object cleanly snapped onto a wall
  const computeWallSnapTransform = (wall: WallId, depthM: number, p: ArchRoomProject) => {
    if (wall === 'north') return { x: 0, z: -p.depthM * 0.5 + depthM * 0.5 + 0.015, rot: 0 };
    if (wall === 'south') return { x: 0, z: p.depthM * 0.5 - depthM * 0.5 - 0.015, rot: Math.PI };
    if (wall === 'west') return { x: -p.widthM * 0.5 + depthM * 0.5 + 0.015, z: 0, rot: Math.PI / 2 };
    return { x: p.widthM * 0.5 - depthM * 0.5 - 0.015, z: 0, rot: -Math.PI / 2 };
  };

  const addWindowOnWall = useCallback(
    (wall: WallId, kind: WindowKind, customW?: number, customH?: number) => {
      const wallLenCm = Math.round(getWallLengthM(wall, project.widthM, project.depthM) * 100);
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
      const pr = preset[kind];
      const safeW = Math.min(customW || pr.w, wallLenCm - 40);
      const safeH = Math.min(customH || pr.h, Math.round(project.ceilingM * 100) - 18);

      const existing = [
        ...project.windows.filter((w) => w.wall === wall).map((w) => [w.offsetCm - w.widthCm / 2, w.offsetCm + w.widthCm / 2]),
        ...project.doors.filter((d) => d.wall === wall).map((d) => [d.offsetCm - d.widthCm / 2, d.offsetCm + d.widthCm / 2]),
      ];
      let offsetCm = Math.round(wallLenCm / 2);
      for (const cand of [wallLenCm * 0.5, wallLenCm * 0.25, wallLenCm * 0.75, wallLenCm * 0.18, wallLenCm * 0.82]) {
        const a = cand - safeW / 2 - 8;
        const b = cand + safeW / 2 + 8;
        if (a >= 10 && b <= wallLenCm - 10 && !existing.some(([e0, e1]) => !(b <= e0 || a >= e1))) {
          offsetCm = Math.round(cand);
          break;
        }
      }

      const win: ArchWindow = {
        id: `win-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        wall,
        kind,
        offsetCm,
        widthCm: safeW,
        heightCm: safeH,
        sillHeightCm: pr.sill,
        frameColorHex: '#26282c',
        hasSill: kind !== 'round' && kind !== 'oval' && pr.sill > 10,
        curtainStyle: 'none',
        curtainColorHex: '#d9d1c3',
        curtainOpenRatio: 0.72,
      };
      setProject((prev) => ({ ...prev, windows: [...prev.windows, win] }));
      setSelection({ type: 'window', id: win.id });
      if (cameraMode === 'free') viewportRef.current?.focusWall(wall);
      showToast(`${WALL_LABELS[wall]} → ${WINDOW_KIND_LABELS[kind]} eklendi.`);
    },
    [project.widthM, project.depthM, project.ceilingM, project.windows, project.doors, cameraMode, showToast]
  );

  const addDoorOnWall = useCallback(
    (wall: WallId, kind: DoorKind, customW?: number) => {
      const wallLenCm = Math.round(getWallLengthM(wall, project.widthM, project.depthM) * 100);
      const wCm = Math.min(customW || (kind === 'double' ? 160 : kind === 'archway' ? 130 : 95), wallLenCm - 40);
      const door: ArchDoor = {
        id: `door-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        wall,
        kind,
        offsetCm: Math.round(Math.min(wallLenCm - wCm * 0.5 - 20, Math.max(wCm * 0.5 + 20, wallLenCm * 0.3))),
        widthCm: wCm,
        heightCm: Math.min(215, Math.round(project.ceilingM * 100) - 15),
        swing: 'inward',
        hinge: 'left',
        openAngleDeg: 45,
        colorHex: '#f3f1eb',
        handleColorHex: '#262626',
      };
      setProject((prev) => ({ ...prev, doors: [...prev.doors, door] }));
      setSelection({ type: 'door', id: door.id });
      if (cameraMode === 'free') viewportRef.current?.focusWall(wall);
      showToast(`${WALL_LABELS[wall]} → ${DOOR_KIND_LABELS[kind]} eklendi.`);
    },
    [project.widthM, project.depthM, project.ceilingM, cameraMode, showToast]
  );

  const addWallZoneOnWall = useCallback(
    (wall: WallId, pattern: WallPattern = 'slats', colorHex = '#b9936c', widthCm = 180, heightCm?: number) => {
      const wallLenCm = Math.round(getWallLengthM(wall, project.widthM, project.depthM) * 100);
      const ceilCm = Math.round(project.ceilingM * 100);
      const zone: ArchWallZone = {
        id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        wall,
        label: 'Özel Bölge',
        offsetCm: Math.round(wallLenCm * 0.5),
        widthCm: Math.min(wallLenCm, Math.max(30, widthCm)),
        bottomCm: 0,
        heightCm: Math.min(ceilCm, heightCm || ceilCm),
        pattern,
        colorHex,
      };
      setProject((prev) => ({ ...prev, wallZones: [...(prev.wallZones || []), zone] }));
      setSelection({ type: 'wallZone', id: zone.id });
      if (cameraMode === 'free') viewportRef.current?.focusWall(wall);
      showToast(`${WALL_LABELS[wall]} üzerine kısmi kaplama/boya bölgesi eklendi.`);
    },
    [project.widthM, project.depthM, project.ceilingM, cameraMode, showToast]
  );

  const toggleCurtainCove = useCallback((wall: WallId) => {
    setProject((prev) => {
      const exists = prev.curtainCoves.some((c) => c.wall === wall);
      if (exists) return { ...prev, curtainCoves: prev.curtainCoves.filter((c) => c.wall !== wall) };
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
  }, []);

  const addColumn = (shape: 'rect' | 'round', widthCm = 40, depthCm = 40) => {
    const col: ArchColumn = {
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: shape === 'round' ? 'Yuvarlak Kolon' : 'Kolon',
      shape,
      xCm: Math.round((project.widthM * 100) / 2 - widthCm / 2 - 2),
      zCm: Math.round(-(project.depthM * 100) / 2 + depthCm / 2 + 2),
      widthCm,
      depthCm,
      colorHex: project.walls.north.colorHex,
    };
    setProject((prev) => ({ ...prev, columns: [...prev.columns, col] }));
    setSelection({ type: 'column', id: col.id });
    showToast(`${col.label} (${widthCm}×${depthCm} cm) eklendi.`);
  };

  const addBeam = (axis: 'x' | 'z', widthCm = 30, dropCm = 32) => {
    const pos = axis === 'z' ? Math.round(-project.widthM * 25) : Math.round(project.depthM * 25);
    const beam: ArchBeam = {
      id: `beam-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      label: axis === 'x' ? 'Yatay Kiriş' : 'Dikey Kiriş',
      axis,
      positionCm: pos,
      widthCm,
      dropCm,
      colorHex: project.ceilingColorHex,
    };
    setProject((prev) => ({ ...prev, beams: [...prev.beams, beam] }));
    setSelection({ type: 'beam', id: beam.id });
    showToast(`${beam.label} eklendi.`);
  };

  const spawnParametricObject = (spec: {
    kind: ParametricFurnitureKind;
    name: string;
    category: string;
    wM: number;
    dM: number;
    hM: number;
    yM: number;
    mount: ArchPlacedObject['mountMode'];
    c1: string;
    c2: string;
    wall?: WallId;
  }) => {
    let x = 0;
    let z = 0;
    let rot = 0;
    const targetWall = spec.wall || activeWall;

    if (spec.mount === 'wall') {
      const snap = computeWallSnapTransform(targetWall, spec.dM, project);
      x = snap.x;
      z = snap.z;
      rot = snap.rot;
      // Avoid spawning inside an existing wall item (e.g. fireplace) on the same wall
      const wallSpan = getWallLengthM(targetWall, project.widthM, project.depthM);
      const isHoriz = targetWall === 'north' || targetWall === 'south';
      const sameWallItems = project.objects.filter(
        (o) =>
          o.mountMode === 'wall' &&
          o.attachedWall === targetWall &&
          Math.abs(o.y - spec.yM) < Math.max(o.heightM, spec.hM) * 0.85
      );
      const overlapsAt = (shift: number) => {
        const cx = isHoriz ? shift : x;
        const cz = isHoriz ? z : shift;
        return sameWallItems.some((o) => {
          const distAlong = isHoriz ? Math.abs(cx - o.x) : Math.abs(cz - o.z);
          return distAlong < (spec.wM + o.widthM) * 0.5 + 0.06;
        });
      };
      if (sameWallItems.length > 0 && overlapsAt(0)) {
        const maxShift = Math.max(0, wallSpan * 0.5 - spec.wM * 0.5 - 0.12);
        const candidates = [maxShift * 0.85, -maxShift * 0.85, maxShift * 0.5, -maxShift * 0.5];
        const openShift = candidates.find((s) => Math.abs(s) <= maxShift + 1e-3 && !overlapsAt(s));
        if (openShift !== undefined) {
          if (isHoriz) x = openShift;
          else z = openShift;
        } else {
          // If this wall is full, place slightly in front of existing surface (e.g. TV over marble panel)
          const frontDepth = Math.max(...sameWallItems.map((o) => o.depthM));
          const frontSnap = computeWallSnapTransform(targetWall, frontDepth * 2 + spec.dM, project);
          x = frontSnap.x;
          z = frontSnap.z;
        }
      }
    } else if (spec.mount === 'floor') {
      const others: OBB2D[] = project.objects
        .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 1.0)
        .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
      const pos = findOpenSpawnPosition(spec.wM * 0.5, spec.dM * 0.5, 0, others, project.widthM, project.depthM, [0, 0]);
      if (pos) {
        x = pos.x;
        z = pos.z;
        rot = pos.rot;
      }
    }

    const obj: ArchPlacedObject = {
      id: `mod-${spec.kind}-${Date.now()}`,
      name: spec.name,
      category: spec.category,
      dimensionsCm: `${Math.round(spec.wM * 100)} × ${Math.round(spec.dM * 100)} × ${Math.round(spec.hM * 100)} cm`,
      parametricKind: spec.kind,
      parametricColorHex: spec.c1,
      parametricAccentHex: spec.c2,
      x,
      y: spec.mount === 'ceiling' ? Math.max(0.8, project.ceilingM - spec.hM) : spec.yM,
      z,
      rot,
      widthM: spec.wM,
      depthM: spec.dM,
      heightM: spec.hM,
      mountMode: spec.mount,
      attachedWall: spec.mount === 'wall' ? targetWall : undefined,
      source: 'parametric',
    };
    setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
    setSelection({ type: 'object', id: obj.id });
    if (spec.mount === 'wall' && cameraMode === 'free') {
      viewportRef.current?.focusWall(targetWall);
    }
    showToast(`${spec.name} (${obj.dimensionsCm}) eklendi.`);
  };

  const addCatalogProduct = (p: Product, customDims?: { w?: number; d?: number; h?: number }) => {
    const fp = parseProductFootprintM(p.dimensionsCm);
    const nums = p.dimensionsCm.match(/\d+(?:[.,]\d+)?/g);
    const wM = customDims?.w ? customDims.w / 100 : nums?.[0] ? Math.max(0.25, parseFloat(nums[0].replace(',', '.')) / 100) : fp.halfW * 2;
    const dM = customDims?.d ? customDims.d / 100 : nums?.[1] ? Math.max(0.25, parseFloat(nums[1].replace(',', '.')) / 100) : fp.halfD * 2;
    const hM = customDims?.h ? customDims.h / 100 : nums?.[2] ? Math.max(0.25, parseFloat(nums[2].replace(',', '.')) / 100) : 0.85;

    const others: OBB2D[] = project.objects
      .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 1.0)
      .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
    const pos = findOpenSpawnPosition(wM * 0.5, dM * 0.5, 0, others, project.widthM, project.depthM, [0, 0]);

    const obj: ArchPlacedObject = {
      id: `cat-${p.id}-${Date.now()}`,
      name: p.name,
      category: p.category,
      dimensionsCm: `${Math.round(wM * 100)} × ${Math.round(dM * 100)} × ${Math.round(hM * 100)} cm`,
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
    setSelection({ type: 'object', id: obj.id });
    showToast(`${p.name} odaya eklendi.`);
  };

  // Execute Quick-Add natural Turkish command ("televizyon 160x90", "gardırop", "şömine 200 cm"...)
  const executeQuickAdd = (overrideText?: string) => {
    const qStr = overrideText ?? quickQuery;
    const cmd = parseQuickAddQuery(qStr, catalog, project.ceilingM);
    if (!cmd) {
      showToast('Tanınamadı — örn: "televizyon 160x90", "şömine", "koltuk", "gardırop", "oval pencere" yazın.');
      return;
    }

    const ow = !overrideText && Number(quickW) > 10 ? Number(quickW) : undefined;
    const od = !overrideText && Number(quickD) > 2 ? Number(quickD) : undefined;
    const oh = !overrideText && Number(quickH) > 10 ? Number(quickH) : undefined;

    if (cmd.kind === 'parametric') {
      spawnParametricObject({
        kind: cmd.parametricKind,
        name: cmd.name,
        category: cmd.category,
        wM: (ow || cmd.widthCm) / 100,
        dM: (od || cmd.depthCm) / 100,
        hM: (oh || cmd.heightCm) / 100,
        yM: cmd.yCm / 100,
        mount: cmd.mountMode,
        c1: cmd.colorHex,
        c2: cmd.accentHex,
      });
    } else if (cmd.kind === 'catalog') {
      addCatalogProduct(cmd.product, { w: ow || cmd.widthCm, d: od || cmd.depthCm, h: oh || cmd.heightCm });
    } else if (cmd.kind === 'window') {
      addWindowOnWall(activeWall, cmd.windowKind, ow || cmd.widthCm, oh || cmd.heightCm);
    } else if (cmd.kind === 'door') {
      addDoorOnWall(activeWall, cmd.doorKind, ow || cmd.widthCm);
    } else if (cmd.kind === 'column') {
      addColumn(cmd.shape, ow || cmd.widthCm, od || cmd.depthCm);
    } else if (cmd.kind === 'beam') {
      addBeam(cmd.axis, ow || cmd.widthCm, od || cmd.dropCm);
    } else if (cmd.kind === 'cove') {
      toggleCurtainCove(activeWall);
      showToast(`${WALL_LABELS[activeWall]} perde havuzu güncellendi.`);
    } else if (cmd.kind === 'wallZone') {
      addWallZoneOnWall(activeWall, cmd.pattern, cmd.colorHex, ow || cmd.widthCm, oh || cmd.heightCm);
    }

    setQuickQuery('');
    setQuickFocused(false);
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
      setSelection({ type: 'object', id: obj.id });
      showToast(`${cleanName} (1:1 CAD) odaya eklendi.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'CAD dosyası okunamadı.');
    } finally {
      setUploadingCad(false);
    }
  };

  const snapObjectToWall = (objId: string, wall: WallId) => {
    setProject((prev) => ({
      ...prev,
      objects: prev.objects.map((o) => {
        if (o.id !== objId) return o;
        const snap = computeWallSnapTransform(wall, o.depthM, prev);
        const clamped = clampToRoomWalls(snap.x, snap.z, snap.rot, o.widthM * 0.5, o.depthM * 0.5, prev.widthM, prev.depthM, 0.01);
        return { ...o, x: clamped.x, z: clamped.z, rot: snap.rot, attachedWall: wall };
      }),
    }));
    showToast(`${WALL_LABELS[wall]} yüzeyine sıfır yaslandı.`);
  };

  const duplicateObject = (objId: string) => {
    const src = project.objects.find((o) => o.id === objId);
    if (!src) return;
    const copy: ArchPlacedObject = {
      ...src,
      id: `copy-${Date.now()}`,
      x: Math.min(project.widthM * 0.4, src.x + 0.35),
      z: Math.min(project.depthM * 0.4, src.z + 0.35),
    };
    setProject((prev) => ({ ...prev, objects: [...prev.objects, copy] }));
    setSelection({ type: 'object', id: copy.id });
  };

  const handleSaveProjectJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mekanar-mimari-proje-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Proje kaydedildi (.json).');
  };

  const handleLoadProjectJson = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '')) as ArchRoomProject;
        if (!parsed || typeof parsed.widthM !== 'number' || !parsed.walls) throw new Error('Geçersiz dosya');
        setProject({ ...parsed, wallZones: parsed.wallZones || [] });
        setSelection(null);
        showToast('Proje yüklendi.');
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
    showToast('Yüksek çözünürlüklü görüntü indirildi.');
  };

  const TABS: Array<{ id: StudioTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'room', label: 'Oda & Yapı', icon: Building2 },
    { id: 'objects', label: 'Eşya', icon: Sofa },
    { id: 'sun', label: 'Güneş', icon: Sun },
    { id: 'pinterest', label: 'Pinterest', icon: Sparkles },
  ];

  const renderLeftSidebar = () => {
    if (activeTab === 'room') {
      return (
        <div className="divide-y divide-stone-200 text-xs">
          {/* Accordion 1: Oda Ölçüleri */}
          <div>
            <button
              type="button"
              onClick={() => setOpenAccordion(openAccordion === 'dims' ? 'openings' : 'dims')}
              className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-stone-900 bg-[#faf9f6] hover:bg-stone-100"
            >
              <span>01 · Oda Ölçüleri &amp; Tavan</span>
              {openAccordion === 'dims' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {openAccordion === 'dims' && (
              <div className="p-3.5 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] text-stone-500 block">En (m)</span>
                    <NumericInput
                      ariaLabel="En (m)"
                      min={2.2}
                      max={15}
                      step={0.1}
                      decimals={2}
                      value={project.widthM}
                      onChange={(v) => updateRoomDim({ widthM: v })}
                      className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-stone-500 block">Derinlik (m)</span>
                    <NumericInput
                      ariaLabel="Derinlik (m)"
                      min={2.2}
                      max={15}
                      step={0.1}
                      decimals={2}
                      value={project.depthM}
                      onChange={(v) => updateRoomDim({ depthM: v })}
                      className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-stone-500 block">Tavan (m)</span>
                    <NumericInput
                      ariaLabel="Tavan (m)"
                      min={2.1}
                      max={5.0}
                      step={0.05}
                      decimals={2}
                      value={project.ceilingM}
                      onChange={(v) => updateRoomDim({ ceilingM: v })}
                      className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-stone-400">
                  İstediğin ölçüyü doğrudan yazıp <strong>Enter</strong>&apos;a bas (örn. <code className="font-mono">7,5</code> veya <code className="font-mono">10</code>).
                </p>
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={project.showCeiling}
                      onChange={(e) => setProject((p) => ({ ...p, showCeiling: e.target.checked }))}
                      className="accent-stone-950"
                    />
                    <span>Tavan</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={project.showBaseboard}
                      onChange={(e) => setProject((p) => ({ ...p, showBaseboard: e.target.checked }))}
                      className="accent-stone-950"
                    />
                    <span>Süpürgelik</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={project.recessedSpots}
                      onChange={(e) => setProject((p) => ({ ...p, recessedSpots: e.target.checked }))}
                      className="accent-stone-950"
                    />
                    <span>Spot Işık</span>
                  </label>
                </div>
                <div className="pt-1 border-t border-stone-200 space-y-1.5">
                  <p className="text-[10px] text-stone-500">Hızlı Yüzey Seç (veya 3B&apos;de doğrudan tıkla):</p>
                  <div className="grid grid-cols-2 gap-1">
                    {WALL_IDS.map((wId) => (
                      <button
                        key={wId}
                        type="button"
                        onClick={() => {
                          setActiveWall(wId);
                          setSelection({ type: 'wall', wall: wId });
                          if (cameraMode === 'free') viewportRef.current?.focusWall(wId);
                        }}
                        className="px-2 py-1.5 border border-stone-200 hover:border-stone-950 bg-white flex items-center justify-between text-[11px]"
                      >
                        <span className="truncate">{WALL_LABELS[wId]}</span>
                        <span className="w-3 h-3 border border-black/20" style={{ backgroundColor: project.walls[wId].colorHex }} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelection({ type: 'floor' })}
                    className="w-full py-1.5 border border-stone-200 hover:border-stone-950 bg-white text-[11px] font-medium"
                  >
                    Zemin Malzemesi &amp; Rengini Düzenle
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Accordion 2: Pencere & Kapı */}
          <div>
            <button
              type="button"
              onClick={() => setOpenAccordion(openAccordion === 'openings' ? 'structure' : 'openings')}
              className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-stone-900 bg-[#faf9f6] hover:bg-stone-100"
            >
              <span>
                02 · Pencere &amp; Kapı ({project.windows.length}P · {project.doors.length}K)
              </span>
              {openAccordion === 'openings' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {openAccordion === 'openings' && (
              <div className="p-3.5 space-y-3">
                <div className="grid grid-cols-2 gap-1">
                  {WALL_IDS.map((wId) => (
                    <button
                      key={wId}
                      type="button"
                      onClick={() => {
                        setActiveWall(wId);
                        if (cameraMode === 'free') viewportRef.current?.focusWall(wId);
                      }}
                      className={`px-2 py-1.5 border text-[11px] font-semibold truncate ${
                        activeWall === wId ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700'
                      }`}
                    >
                      {WALL_LABELS[wId]}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-stone-500">Pencere Ekle</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(Object.keys(WINDOW_KIND_LABELS) as WindowKind[]).map((wk) => (
                      <button
                        key={wk}
                        type="button"
                        onClick={() => addWindowOnWall(activeWall, wk)}
                        className="px-1.5 py-1.5 border border-stone-200 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[10px] font-semibold truncate transition"
                      >
                        + {WINDOW_KIND_LABELS[wk].split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-stone-500">Kapı Ekle</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(Object.keys(DOOR_KIND_LABELS) as DoorKind[]).map((dk) => (
                      <button
                        key={dk}
                        type="button"
                        onClick={() => addDoorOnWall(activeWall, dk)}
                        className="px-2 py-1.5 border border-stone-200 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[10px] font-semibold truncate transition"
                      >
                        + {DOOR_KIND_LABELS[dk].replace(' Salon Kapısı', '')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clickable list of existing openings to inspect in right panel */}
                <div className="border-t border-stone-200 pt-2.5 space-y-1">
                  <span className="text-[10px] font-mono uppercase text-stone-500">Düzenlemek İçin Seç</span>
                  {project.windows.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setSelection({ type: 'window', id: w.id });
                        if (cameraMode === 'free') viewportRef.current?.focusWall(w.wall);
                      }}
                      className={`w-full px-2 py-1.5 border text-left flex items-center justify-between text-[11px] ${
                        selection?.type === 'window' && selection.id === w.id
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-white hover:border-stone-500'
                      }`}
                    >
                      <span className="truncate">{WINDOW_KIND_LABELS[w.kind]}</span>
                      <span className="text-[10px] font-mono opacity-75">{w.wall === 'north' ? 'A' : w.wall === 'east' ? 'B' : w.wall === 'south' ? 'C' : 'D'}</span>
                    </button>
                  ))}
                  {project.doors.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        setSelection({ type: 'door', id: d.id });
                        if (cameraMode === 'free') viewportRef.current?.focusWall(d.wall);
                      }}
                      className={`w-full px-2 py-1.5 border text-left flex items-center justify-between text-[11px] ${
                        selection?.type === 'door' && selection.id === d.id
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-white hover:border-stone-500'
                      }`}
                    >
                      <span className="truncate">
                        {DOOR_KIND_LABELS[d.kind]} ({d.swing === 'inward' ? 'İçeri' : 'Dışarı'})
                      </span>
                      <span className="text-[10px] font-mono opacity-75">{d.wall === 'north' ? 'A' : d.wall === 'east' ? 'B' : d.wall === 'south' ? 'C' : 'D'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Accordion 3: Kolon, Kiriş & Perde Havuzu */}
          <div>
            <button
              type="button"
              onClick={() => setOpenAccordion(openAccordion === 'structure' ? 'dims' : 'structure')}
              className="w-full px-3.5 py-2.5 flex items-center justify-between font-semibold text-stone-900 bg-[#faf9f6] hover:bg-stone-100"
            >
              <span>03 · Kolon, Kiriş &amp; Perde Havuzu</span>
              {openAccordion === 'structure' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {openAccordion === 'structure' && (
              <div className="p-3.5 space-y-3.5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-stone-500">Perde Havuzu &amp; Gizli LED</span>
                    <button
                      type="button"
                      onClick={() => {
                        setProject((prev) => {
                          const existing = new Set(prev.curtainCoves.map((c) => c.wall));
                          const adds: ArchCurtainCove[] = WALL_IDS.filter((w) => !existing.has(w)).map((w) => ({
                            id: `cove-${w}-${Date.now()}`,
                            wall: w,
                            depthCm: 22,
                            dropCm: 18,
                            ledEnabled: true,
                            ledColorHex: '#ffddb0',
                            ledIntensity: 1.2,
                            colorHex: prev.ceilingColorHex,
                          }));
                          return { ...prev, curtainCoves: [...prev.curtainCoves, ...adds] };
                        });
                        showToast('4 duvara LED’li perde havuzu eklendi.');
                      }}
                      className="text-[10px] font-semibold underline text-stone-700"
                    >
                      4 Duvara Ekle
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {WALL_IDS.map((wId) => {
                      const active = project.curtainCoves.some((c) => c.wall === wId);
                      return (
                        <button
                          key={wId}
                          type="button"
                          onClick={() => toggleCurtainCove(wId)}
                          className={`px-2 py-1.5 border text-[10px] font-semibold ${
                            active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {WALL_LABELS[wId]}
                        </button>
                      );
                    })}
                  </div>
                  {project.curtainCoves.map((cove) => (
                    <div key={cove.id} className="border border-stone-200 bg-[#faf9f6] p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold">{WALL_LABELS[cove.wall]}</span>
                        <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cove.ledEnabled}
                            onChange={(e) =>
                              setProject((p) => ({
                                ...p,
                                curtainCoves: p.curtainCoves.map((c) =>
                                  c.id === cove.id ? { ...c, ledEnabled: e.target.checked } : c
                                ),
                              }))
                            }
                            className="accent-amber-600"
                          />
                          <span>LED</span>
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] text-stone-600">
                        <label>
                          Derinlik {cove.depthCm}cm
                          <input
                            type="range"
                            min={12}
                            max={35}
                            value={cove.depthCm}
                            onChange={(e) =>
                              setProject((p) => ({
                                ...p,
                                curtainCoves: p.curtainCoves.map((c) =>
                                  c.id === cove.id ? { ...c, depthCm: Number(e.target.value) } : c
                                ),
                              }))
                            }
                            className="w-full accent-stone-950"
                          />
                        </label>
                        <label>
                          Sarkma {cove.dropCm}cm
                          <input
                            type="range"
                            min={10}
                            max={30}
                            value={cove.dropCm}
                            onChange={(e) =>
                              setProject((p) => ({
                                ...p,
                                curtainCoves: p.curtainCoves.map((c) =>
                                  c.id === cove.id ? { ...c, dropCm: Number(e.target.value) } : c
                                ),
                              }))
                            }
                            className="w-full accent-stone-950"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-stone-200 pt-2.5 space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-stone-500">Kolon &amp; Kiriş Ekle</span>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => addColumn('rect')}
                      className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                    >
                      + Kare Kolon
                    </button>
                    <button
                      type="button"
                      onClick={() => addColumn('round')}
                      className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                    >
                      + Yuvarlak Kolon
                    </button>
                    <button
                      type="button"
                      onClick={() => addBeam('x')}
                      className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                    >
                      + Yatay Kiriş
                    </button>
                    <button
                      type="button"
                      onClick={() => addBeam('z')}
                      className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[10px] font-semibold"
                    >
                      + Dikey Kiriş
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'objects') {
      return (
        <div className="p-3.5 space-y-4 text-xs">
          {/* Active Room Scene Chips (easy selection of chandelier, rug, TV, fireplace!) */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              Odadaki Eşyalar ({project.objects.length})
            </span>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
              {project.objects.map((o) => {
                const isSel = selection?.type === 'object' && selection.id === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setSelection({ type: 'object', id: o.id })}
                    className={`px-2 py-1 border text-[10px] font-semibold truncate max-w-[135px] ${
                      isSel ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
                    }`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Parametric Modules */}
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              Mimari Modüller (Ölçü &amp; Renk Ayarlı)
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {PARAMETRIC_CARDS.map((m) => (
                <button
                  key={m.kind}
                  type="button"
                  onClick={() =>
                    spawnParametricObject({
                      kind: m.kind,
                      name: m.name,
                      category: 'Mimari Modül',
                      wM: m.w,
                      dM: m.d,
                      hM: m.h,
                      yM: m.y,
                      mount: m.mount,
                      c1: m.c1,
                      c2: m.c2,
                    })
                  }
                  className="text-left px-2.5 py-2 border border-stone-200 hover:border-stone-950 bg-white transition"
                >
                  <p className="text-[11px] font-semibold text-stone-950 truncate">{m.name}</p>
                  <p className="text-[9px] font-mono text-stone-500 truncate">{m.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* CAD Upload */}
          <label className="w-full py-2 px-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition">
            {uploadingCad ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>CAD Yükle (.FBX / .OBJ / .GLB / .STL)</span>
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

          {/* 3D Furniture Catalog */}
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              3B Mobilya Kataloğu ({catalog.length})
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {catalog.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addCatalogProduct(p)}
                  className="text-left border border-stone-200 hover:border-stone-950 bg-white overflow-hidden"
                >
                  <div className="h-16 bg-[#f5f4f0] flex items-center justify-center p-1 border-b border-stone-200">
                    {p.thumbUrl ? (
                      <img src={p.thumbUrl} alt={p.name} className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[9px] font-mono text-stone-500">3B</span>
                    )}
                  </div>
                  <div className="p-1.5">
                    <p className="text-[10px] font-semibold text-stone-950 truncate">{p.name}</p>
                    <p className="text-[9px] font-mono text-stone-500 truncate">{p.dimensionsCm}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'sun') {
      const northWallDir = bearingToCompassLabel(project.sun.northAngleDeg);
      return (
        <div className="p-3.5 space-y-4 text-xs">
          <div className="border border-stone-200 bg-[#faf9f6] p-3 flex flex-col items-center gap-1.5">
            <svg viewBox="0 0 160 160" className="w-32 h-32">
              <circle cx="80" cy="80" r="64" fill="#ffffff" stroke="#d6d3d1" strokeWidth="1.5" />
              <rect x="65" y="67" width="30" height="26" fill="#faf9f6" stroke="#1c1917" strokeWidth="1.5" />
              <text x="80" y="62" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="#1c1917" fontWeight="700">
                Üst (A)
              </text>
              <g transform={`rotate(${-project.sun.northAngleDeg} 80 80)`}>
                <polygon points="80,16 74,30 86,30" fill="#dc2626" />
                <text x="80" y="13" textAnchor="middle" fontSize="9" fontWeight="800" fill="#dc2626">
                  K
                </text>
                <text x="146" y="83" textAnchor="middle" fontSize="8" fill="#78716c">
                  D
                </text>
                <text x="80" y="154" textAnchor="middle" fontSize="8" fill="#78716c">
                  G
                </text>
                <text x="14" y="83" textAnchor="middle" fontSize="8" fill="#78716c">
                  B
                </text>
              </g>
              {!solar.isNight && (
                <g transform={`rotate(${solar.azimuthDeg - project.sun.northAngleDeg} 80 80)`}>
                  <line x1="80" y1="80" x2="80" y2="28" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2 2" />
                  <circle cx="80" cy="26" r="5.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                </g>
              )}
            </svg>
            <p className="text-[11px] text-stone-700">
              Üst Cephe: <strong className="text-stone-950">{northWallDir}</strong>
            </p>
          </div>

          <label className="block text-[10px] text-stone-600">
            Pusula Yönü: <strong className="font-mono">{Math.round(project.sun.northAngleDeg)}°</strong>
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
                  Math.abs(project.sun.northAngleDeg - dir.deg) < 12 ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'
                }`}
              >
                {dir.l}
              </button>
            ))}
          </div>

          <div className="border-t border-stone-200 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase text-stone-500">Güneş Saati</span>
              <span className="font-mono font-bold text-stone-950">{solar.formattedTime} ({solar.elevationDeg.toFixed(0)}°)</span>
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
                { l: '09:00', h: 9 },
                { l: '12:30', h: 12.5 },
                { l: '16:00', h: 16 },
                { l: '20:00', h: 20 },
              ].map((t) => (
                <button
                  key={t.l}
                  type="button"
                  onClick={() => setProject((p) => ({ ...p, sun: { ...p.sun, hour: t.h } }))}
                  className="py-1 border border-stone-200 hover:border-stone-950 bg-white text-[10px] font-mono font-semibold"
                >
                  {t.l}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSunPlaying((v) => !v)}
              className={`w-full py-2 font-semibold flex items-center justify-center gap-1.5 ${
                sunPlaying ? 'bg-amber-600 text-white' : 'bg-stone-950 text-white hover:bg-stone-800'
              }`}
            >
              {sunPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{sunPlaying ? 'Durdur' : 'Gün Boyu Güneşi Oynat'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: 'summer', label: 'Yaz' },
                { id: 'equinox', label: 'Bahar' },
                { id: 'winter', label: 'Kış' },
              ] as Array<{ id: SolarSeason; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setProject((p) => ({ ...p, sun: { ...p.sun, season: s.id } }))}
                className={`py-1.5 border text-[10px] font-semibold ${
                  project.sun.season === s.id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-1 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showSunOrb} onChange={(e) => setShowSunOrb(e.target.checked)} className="accent-stone-950" />
              <span>Güneş Işını</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="accent-stone-950" />
              <span>Izgara</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showDoorArcs} onChange={(e) => setShowDoorArcs(e.target.checked)} className="accent-stone-950" />
              <span>Kapı Yayı</span>
            </label>
          </div>
        </div>
      );
    }

    return (
      <div className="p-3.5">
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
              windows: prev.windows.map((w) => ({ ...w, curtainColorHex: style.curtainColorHex || w.curtainColorHex })),
              sun: { ...prev.sun, hour: style.suggestedSunHour ? Math.max(8, Math.min(18, style.suggestedSunHour)) : prev.sun.hour },
            }));
          }}
          onAddGeneratedObject={(obj) => {
            setProject((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
            setSelection({ type: 'object', id: obj.id });
          }}
          onCaptureViewport={() => viewportRef.current?.captureSnapshot(true) || null}
          onToast={showToast}
        />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 h-[100dvh] bg-[#e8e5de] text-stone-950 flex flex-col overflow-hidden">
      {/* Ultra-Clean Single-Row Top Header with Smart Quick-Add Bar */}
      <header className="h-14 px-3 sm:px-4 bg-white border-b border-stone-200 flex items-center justify-between gap-3 shrink-0 z-30">
        {/* Brand + Live Room Size */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen((v) => !v)}
            className="lg:hidden p-1.5 border border-stone-300 text-stone-800"
            aria-label="Menü"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div>
            <p className="font-display text-sm font-extrabold tracking-tight text-stone-950 whitespace-nowrap leading-none">
              MekanAR <span className="font-normal text-stone-500">Mimari</span>
            </p>
            <p className="text-[10px] font-mono text-stone-500 whitespace-nowrap mt-0.5">
              {project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m · {solar.formattedTime} ({bearingToShortCode(project.sun.northAngleDeg)})
            </p>
          </div>
        </div>

        {/* Center: Smart Turkish Quick-Add Bar ("televizyon 160x90", "gardırop 220x60x240"...) */}
        <div className="relative flex-1 max-w-xl">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              executeQuickAdd();
            }}
            className="flex items-center border border-stone-300 focus-within:border-stone-950 bg-[#faf9f6] transition"
          >
            <Search className="w-3.5 h-3.5 text-stone-400 ml-2.5 shrink-0" />
            <input
              type="text"
              value={quickQuery}
              onFocus={() => setQuickFocused(true)}
              onBlur={() => setTimeout(() => setQuickFocused(false), 180)}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder='Ne eklemek istersin? Örn: "televizyon 160x90", "gardırop", "şömine", "oval pencere"'
              className="flex-1 min-w-0 px-2 py-1.5 bg-transparent text-xs text-stone-950 placeholder:text-stone-400 focus:outline-none"
            />
            <button
              type="submit"
              className="px-3 py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ekle</span>
            </button>
          </form>

          {/* Instant Live Preview + Editable cm Dimensions OR Quick Chips */}
          {quickFocused && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="absolute left-0 right-0 top-full mt-1 bg-white border border-stone-300 shadow-xl p-2.5 z-50 text-xs space-y-2"
            >
              {parsedQuick ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-stone-950">
                      {parsedQuick.kind === 'parametric'
                        ? parsedQuick.name
                        : parsedQuick.kind === 'catalog'
                        ? parsedQuick.product.name
                        : parsedQuick.kind === 'window'
                        ? WINDOW_KIND_LABELS[parsedQuick.windowKind]
                        : parsedQuick.kind === 'door'
                        ? DOOR_KIND_LABELS[parsedQuick.doorKind]
                        : parsedQuick.kind === 'wallZone'
                        ? `Kısmi Duvar Paneli (${parsedQuick.pattern})`
                        : parsedQuick.kind === 'cove'
                        ? 'Perde Havuzu & LED'
                        : parsedQuick.kind === 'column'
                        ? 'Taşıyıcı Kolon'
                        : 'Tavan Kirişi'}
                    </span>
                    <span className="text-[10px] font-mono text-stone-500">Enter ile hemen ekle</span>
                  </div>
                  {(parsedQuick.kind === 'parametric' || parsedQuick.kind === 'wallZone') && (
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        En
                        <input
                          type="number"
                          value={quickW}
                          onChange={(e) => setQuickW(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 px-1.5 py-0.5 border border-stone-300 font-mono text-stone-950"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        Der.
                        <input
                          type="number"
                          value={quickD}
                          onChange={(e) => setQuickD(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 px-1.5 py-0.5 border border-stone-300 font-mono text-stone-950"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        Yük.
                        <input
                          type="number"
                          value={quickH}
                          onChange={(e) => setQuickH(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-14 px-1.5 py-0.5 border border-stone-300 font-mono text-stone-950"
                        />
                      </label>
                      <span className="text-[10px] font-mono text-stone-400">cm</span>
                      <button
                        type="button"
                        onClick={() => executeQuickAdd()}
                        className="ml-auto px-3 py-1 bg-stone-950 text-white text-[11px] font-semibold"
                      >
                        Odaya Koy
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-mono uppercase text-stone-500">Hızlı Ekle (Tıkla veya Ölçüsüyle Yaz)</p>
                  <div className="flex flex-wrap gap-1">
                    {QUICK_ADD_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => executeQuickAdd(s)}
                        className="px-2 py-1 border border-stone-200 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-[#faf9f6] text-[11px] font-medium transition"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: 3 Camera Modes + Save/Export */}
        <div className="flex items-center gap-1 shrink-0">
          <div className="hidden md:flex items-center border border-stone-200 bg-[#faf9f6]">
            {(
              [
                { id: 'free', label: '3B', icon: Layers },
                { id: 'plan', label: '2D Plan', icon: Grid3X3 },
                { id: 'inside', label: 'İçeriden', icon: Eye },
              ] as const
            ).map((c) => {
              const Icon = c.icon;
              const active = cameraMode === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCameraMode(c.id)}
                  className={`px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 ${
                    active ? 'bg-stone-950 text-white' : 'text-stone-700 hover:text-stone-950'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSaveProjectJson}
            className="p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 shrink-0"
            title="Projeyi Kaydet (.json)"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          <label
            className="p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 cursor-pointer shrink-0"
            title="Proje Aç (.json)"
          >
            <FolderOpen className="w-3.5 h-3.5" />
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
            <span className="hidden sm:inline">PNG</span>
          </button>
        </div>
      </header>

      {/* Main 3-Zone Workspace: Slim Left Drawer + Breathing 3D Canvas + Contextual Right Inspector */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Left Slim 4-Tab Panel */}
        <aside
          className={`${
            mobileSidebarOpen ? 'fixed inset-y-14 left-0 z-30 flex' : 'hidden lg:flex'
          } w-[290px] xl:w-[308px] bg-white border-r border-stone-200 flex-col shrink-0 shadow-xl lg:shadow-none`}
        >
          <nav className="grid grid-cols-4 border-b border-stone-200 bg-[#faf9f6] shrink-0">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`py-2.5 px-1 flex flex-col items-center justify-center gap-1 border-b-2 text-[10px] font-semibold transition whitespace-nowrap ${
                    active ? 'border-stone-950 bg-white text-stone-950' : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex-1 min-h-0 overflow-y-auto">{renderLeftSidebar()}</div>
        </aside>

        {/* Center Full-Bleed 60 FPS 3D Architectural Viewport */}
        <main className="flex-1 min-w-0 relative overflow-hidden">
          <ArchViewport3D
            ref={viewportRef}
            project={project}
            cameraMode={cameraMode}
            showGrid={showGrid}
            showSunOrb={showSunOrb}
            showDoorArcs={showDoorArcs}
            selection={selection}
            onSelect={setSelection}
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
                className={`px-2 py-1 text-[11px] font-bold ${cameraMode === c.id ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {loadingCount > 0 && (
            <div className="absolute top-3 left-3 hidden md:flex items-center gap-2 bg-white/95 border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm pointer-events-none">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>3B modeller yükleniyor...</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="absolute top-3 right-3 max-w-xs bg-amber-50 border border-amber-400 px-3 py-2 text-[11px] text-amber-950 shadow-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}

          {toastMsg && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-stone-950 text-white px-4 py-2 text-xs font-medium shadow-lg pointer-events-none max-w-[90vw] truncate">
              {toastMsg}
            </div>
          )}

          {/* Subtle Teaching Hint when nothing is selected */}
          {!selection && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/92 border border-stone-200 px-3.5 py-1.5 text-[11px] text-stone-700 shadow-sm pointer-events-none whitespace-nowrap hidden sm:block">
              Düzenlemek için odada herhangi bir duvara, zemine, pencereye, kapıya veya eşyaya tıklayın
            </div>
          )}
        </main>

        {/* Right Contextual Inspector — Opens ONLY when user clicks a wall, wall zone, floor, window, door, column, beam, or object! */}
        {selection && (
          <aside className="w-[290px] xl:w-[310px] bg-white border-l border-stone-200 shrink-0 flex flex-col z-20 shadow-lg lg:shadow-none">
            <SelectionInspector
              project={project}
              selection={selection}
              onClose={() => setSelection(null)}
              onSelect={setSelection}
              onUpdateProject={setProject}
              onAddWindow={(w, k) => addWindowOnWall(w, k)}
              onAddDoor={(w, k) => addDoorOnWall(w, k)}
              onToggleCove={toggleCurtainCove}
              onAddWallZone={(w, pat, hex) => addWallZoneOnWall(w, pat, hex)}
              onAddTvOnWall={(w) =>
                spawnParametricObject({
                  kind: 'wall_tv',
                  name: 'Duvar OLED TV (65")',
                  category: 'Televizyon',
                  wM: 1.45,
                  dM: 0.06,
                  hM: 0.84,
                  yM: 1.15,
                  mount: 'wall',
                  c1: '#18181b',
                  c2: '#0b0c10',
                  wall: w,
                })
              }
              onSnapObjectToWall={snapObjectToWall}
              onDuplicateObject={duplicateObject}
              onToast={showToast}
            />
          </aside>
        )}
      </div>
    </div>
  );
};

export default ArchitecturalStudioPage;
