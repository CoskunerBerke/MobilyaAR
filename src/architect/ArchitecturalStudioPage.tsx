import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Building2,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Download,
  Footprints,
  FolderOpen,
  Grid3X3,
  Home,
  Layers,
  Loader2,
  Maximize2,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  Search,
  Sofa,
  Sparkles,
  Sun,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { PRODUCTS, type Product } from '../lib/products';
import {
  fetchCloudCatalog,
  fetchStorageConfig,
  loadLocalCustomCatalog,
  saveLocalCustomProduct,
  saveProductToCloudStorage,
} from '../lib/storageClient';
import { buildParametricObject3D } from './parametricFurniture';
import { convertCadFileToGlb } from '../lib/cadImport';
import { clampToRoomWalls, findOpenSpawnPosition, parseProductFootprintM, type OBB2D } from '../lib/collision2d';
import { ArchViewport3D, type ArchCameraMode, type ArchViewportHandle } from './ArchViewport3D';
import { BrandCatalogPanel } from './BrandCatalogPanel';
import {
  SUPPLIER_SHORT,
  type CountertopCatalogItem,
  type DoorPanelCatalogItem,
  type FurniturePanelCatalogItem,
  type ParquetCatalogItem,
  type SkirtingTrimCatalogItem,
  type WallPanelCatalogItem,
} from './materialCatalogs';
import { NumericInput } from './NumericInput';
import { PinterestAIPanel, type PinterestMaterialEntry } from './PinterestAIPanel';
import { SelectionInspector } from './SelectionInspector';
import { autoLinkNestedAssemblies } from './surfacePhysics';
import { ClientProjectModal } from './ClientProjectModal';
import {
  createClientProjectRecord,
  loadActiveClientId,
  loadClientProjects,
  saveActiveClientId,
  saveClientProjects,
  updateRecordWithProject,
  type ClientProjectRecord,
} from './clientProjects';
import { QUICK_ADD_SUGGESTIONS, parseQuickAddQuery } from './quickAddParser';
import { runUniversalSearch, type UniversalSearchGroup, type UniversalSearchResult } from './universalSearch';
import {
  ROOM_KIND_DEFAULTS,
  attachAdjacentRoom,
  buildApartmentPreset,
  type ApartmentPresetId,
} from './multiRoomTemplates';
import { bearingToCompassLabel, bearingToShortCode, computeSolarLighting } from './solarMath';
import {
  DOOR_KIND_LABELS,
  PASSAGE_STYLE_LABELS,
  ROOM_KIND_LABELS,
  WALL_LABELS,
  WINDOW_KIND_LABELS,
  createDefaultArchitectProject,
  getHouseBounds,
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
  type PassageStyle,
  type RoomKind,
  type SolarSeason,
  type WallId,
  type WallPattern,
  type WindowKind,
} from './types';

type StudioTab = 'room' | 'catalog' | 'objects' | 'sun' | 'pinterest';
type RoomAccordion = 'houses' | 'dims' | 'openings' | 'structure';
type StructureSubTab = 'loft' | 'cove' | 'col';
type ObjectsSubTab = 'catalog' | 'modules' | 'placed';
type ModuleCategoryFilter = 'all' | 'living' | 'kitchen_bath' | 'decor';

const WALL_IDS: WallId[] = ['north', 'east', 'south', 'west'];

const PARAMETRIC_CARDS: Array<{
  kind: ParametricFurnitureKind;
  group: Exclude<ModuleCategoryFilter, 'all'>;
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
  { kind: 'wall_tv', group: 'living', name: 'Duvar OLED TV', sub: '145 × 6 × 84 cm', w: 1.45, d: 0.06, h: 0.84, y: 1.15, mount: 'wall', c1: '#18181b', c2: '#0b0c10' },
  { kind: 'fireplace_marble', group: 'living', name: 'Mermer Şömine', sub: '200 × 44 × 260 cm', w: 2.0, d: 0.44, h: 2.6, y: 0, mount: 'wall', c1: '#ece9e2', c2: '#252423' },
  { kind: 'tv_wall_unit', group: 'living', name: 'Çıtalı TV Ünitesi', sub: '240 × 42 × 245 cm', w: 2.4, d: 0.42, h: 2.45, y: 0, mount: 'wall', c1: '#b78e66', c2: '#252423' },
  { kind: 'wardrobe', group: 'living', name: 'Mimari Gardırop', sub: '220 × 60 × 240 cm', w: 2.2, d: 0.6, h: 2.4, y: 0, mount: 'wall', c1: '#ebe6dd', c2: '#2b2a28' },
  { kind: 'kitchen_counter', group: 'kitchen_bath', name: 'Laminat Tezgah', sub: '220 × 65 × 90 cm', w: 2.2, d: 0.65, h: 0.9, y: 0, mount: 'wall', c1: '#efede7', c2: '#3f4247' },
  { kind: 'kitchen_upper_cabinet', group: 'kitchen_bath', name: 'Üst Mutfak Dolabı', sub: '220 × 36 × 72 cm', w: 2.2, d: 0.36, h: 0.72, y: 1.48, mount: 'wall', c1: '#f3f1eb', c2: '#262628' },
  { kind: 'fridge', group: 'kitchen_bath', name: 'Inox Buzdolabı', sub: '75 × 70 × 192 cm', w: 0.75, d: 0.7, h: 1.92, y: 0, mount: 'wall', c1: '#c6c9ce', c2: '#2b2d31' },
  { kind: 'toilet_wc', group: 'kitchen_bath', name: 'VitrA Klozet (WC)', sub: '42 × 68 × 110 cm', w: 0.42, d: 0.68, h: 1.1, y: 0, mount: 'wall', c1: '#f7f6f2', c2: '#c8cdd4' },
  { kind: 'bathroom_vanity', group: 'kitchen_bath', name: 'Banyo Lavabo', sub: '100 × 48 × 195 cm', w: 1.0, d: 0.48, h: 1.95, y: 0, mount: 'wall', c1: '#b99268', c2: '#c8cdd4' },
  { kind: 'shower_cabin', group: 'kitchen_bath', name: 'Cam Duşakabin', sub: '95 × 95 × 205 cm', w: 0.95, d: 0.95, h: 2.05, y: 0, mount: 'floor', c1: '#242528', c2: '#cfd4da' },
  { kind: 'washer', group: 'kitchen_bath', name: 'Çamaşır Makinesi', sub: '60 × 60 × 85 cm', w: 0.6, d: 0.6, h: 0.85, y: 0, mount: 'floor', c1: '#f4f4f2', c2: '#2c2e33' },
  { kind: 'dining_table', group: 'living', name: 'Yemek Masası', sub: '180 × 95 × 75 cm', w: 1.8, d: 0.95, h: 0.75, y: 0, mount: 'floor', c1: '#9b7452', c2: '#232325' },
  { kind: 'bookshelf', group: 'living', name: 'Işıklı Kitaplık', sub: '160 × 36 × 220 cm', w: 1.6, d: 0.36, h: 2.2, y: 0, mount: 'wall', c1: '#876246', c2: '#242322' },
  { kind: 'bed_frame', group: 'living', name: 'Çift Kişilik Yatak', sub: '175 × 212 × 112 cm', w: 1.75, d: 2.12, h: 1.12, y: 0, mount: 'floor', c1: '#dcd5c9', c2: '#f5f2ec' },
  { kind: 'console_table', group: 'living', name: 'Modern Konsol', sub: '165 × 44 × 78 cm', w: 1.65, d: 0.44, h: 0.78, y: 0, mount: 'wall', c1: '#a47e5a', c2: '#232324' },
  { kind: 'ac_unit', group: 'decor', name: 'Duvar Kliması', sub: '95 × 24 × 32 cm', w: 0.95, d: 0.24, h: 0.32, y: 2.35, mount: 'wall', c1: '#f5f5f3', c2: '#2d2f33' },
  { kind: 'wall_mirror', group: 'decor', name: 'Duvar Aynası', sub: '90 × 4 × 185 cm', w: 0.9, d: 0.04, h: 1.85, y: 0.2, mount: 'wall', c1: '#c8a86b', c2: '#dce6ee' },
  { kind: 'wall_art', group: 'decor', name: 'Duvar Tablosu', sub: '120 × 4 × 90 cm', w: 1.2, d: 0.04, h: 0.9, y: 1.2, mount: 'wall', c1: '#2a2826', c2: '#dfd6c8' },
  { kind: 'floor_lamp', group: 'decor', name: 'Modern Lambader', sub: '42 × 42 × 168 cm', w: 0.42, d: 0.42, h: 1.68, y: 0, mount: 'floor', c1: '#242322', c2: '#f5efe2' },
  { kind: 'rug_custom', group: 'decor', name: 'Özel Ölçü Halı', sub: '260 × 190 cm', w: 2.6, d: 1.9, h: 0.015, y: 0, mount: 'rug', c1: '#e6dfd3', c2: '#b8ad9b' },
  { kind: 'chandelier', group: 'decor', name: 'Pirinç Avize', sub: '85 × 85 cm', w: 0.85, d: 0.85, h: 0.5, y: 2.32, mount: 'ceiling', c1: '#c8a86b', c2: '#fff4dc' },
];

export const ArchitecturalStudioPage: React.FC = () => {
  const [catalog, setCatalog] = useState<Product[]>(PRODUCTS);
  const [clientProjects, setClientProjects] = useState<ClientProjectRecord[]>(() => loadClientProjects());
  const [activeClientId, setActiveClientId] = useState<string | null>(() => {
    const saved = loadClientProjects();
    const lastId = loadActiveClientId();
    return lastId && saved.some((c) => c.id === lastId) ? lastId : null;
  });
  const [clientModalOpen, setClientModalOpen] = useState<boolean>(true);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saved'>('idle');
  const [project, setProject] = useState<ArchRoomProject>(() => {
    const saved = loadClientProjects();
    const lastId = loadActiveClientId();
    const matched = lastId ? saved.find((c) => c.id === lastId) : null;
    if (matched?.project) {
      return {
        ...matched.project,
        wallZones: matched.project.wallZones || [],
        adjacentRooms: matched.project.adjacentRooms || [],
      };
    }
    return createDefaultArchitectProject(PRODUCTS);
  });
  const activeClient = useMemo(
    () => clientProjects.find((c) => c.id === activeClientId) || null,
    [clientProjects, activeClientId]
  );
  const [activeTab, setActiveTab] = useState<StudioTab>('room');
  // Single-open accordion prevents giant vertical scroll walls while keeping every feature 1 tap away
  const [openRoomSection, setOpenRoomSection] = useState<RoomAccordion | null>('dims');
  const toggleSection = (key: RoomAccordion) =>
    setOpenRoomSection((prev) => (prev === key ? null : key));
  const [showAddRoomForm, setShowAddRoomForm] = useState(false);
  const [structureSubTab, setStructureSubTab] = useState<StructureSubTab>('loft');
  const [objectsSubTab, setObjectsSubTab] = useState<ObjectsSubTab>('catalog');
  const [moduleCategoryFilter, setModuleCategoryFilter] = useState<ModuleCategoryFilter>('all');

  // Sims-style "+ Yanına Oda Ekle" form state
  const [newRoomParentId, setNewRoomParentId] = useState<string>('main');
  const [newRoomSide, setNewRoomSide] = useState<WallId>('east');
  const [newRoomKind, setNewRoomKind] = useState<RoomKind>('bedroom');
  const [newRoomPassage, setNewRoomPassage] = useState<PassageStyle>('door');
  const [newRoomW, setNewRoomW] = useState<number>(3.8);
  const [newRoomD, setNewRoomD] = useState<number>(3.6);
  const [newRoomFurnish, setNewRoomFurnish] = useState<boolean>(true);
  const [cameraMode, setCameraMode] = useState<ArchCameraMode>('free');
  const [dragAxis, setDragAxis] = useState<'xz' | 'y'>('xz');
  const [showGrid, setShowGrid] = useState(true);
  const [showSunOrb, setShowSunOrb] = useState(true);
  const [showDoorArcs, setShowDoorArcs] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [tvPresentationMode, setTvPresentationMode] = useState(false);
  const [autoRotate360, setAutoRotate360] = useState(false);

  const [activeWall, setActiveWall] = useState<WallId>('north');
  const [selection, setSelection] = useState<ArchSelection>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loadingCount, setLoadingCount] = useState(0);
  const [uploadingCad, setUploadingCad] = useState(false);
  const [sunPlaying, setSunPlaying] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Universal Smart Search Bar (Colors, codes, nearest shades, 3D items, windows, doors, rooms!)
  const [quickQuery, setQuickQuery] = useState('');
  const [quickFocused, setQuickFocused] = useState(false);
  const [searchFilterGroup, setSearchFilterGroup] = useState<'all' | UniversalSearchGroup>('all');
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
    // Hydrate locally saved custom 2K PBR catalog products immediately
    const localSaved = loadLocalCustomCatalog();
    if (localSaved.length > 0) {
      setCatalog((prev) => {
        const seen = new Set(localSaved.map((p) => p.id));
        return [...localSaved, ...prev.filter((p) => !seen.has(p.id))];
      });
    }
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

  // Auto-save active customer's room whenever project changes (debounced 550ms)
  useEffect(() => {
    if (!activeClientId) return;
    const timer = window.setTimeout(() => {
      setClientProjects((prev) => {
        const idx = prev.findIndex((c) => c.id === activeClientId);
        if (idx < 0) return prev;
        const updated = updateRecordWithProject(prev[idx], project);
        const next = [updated, ...prev.filter((c) => c.id !== activeClientId)];
        saveClientProjects(next);
        return next;
      });
      setAutoSaveState('saved');
    }, 550);
    return () => window.clearTimeout(timer);
  }, [project, activeClientId]);

  const handleSelectClient = useCallback(
    (client: ClientProjectRecord) => {
      // Flush current active client before switching so zero edits are ever lost
      if (activeClientId && activeClientId !== client.id) {
        setClientProjects((prev) => {
          const curIdx = prev.findIndex((c) => c.id === activeClientId);
          if (curIdx < 0) return prev;
          const next = prev.map((c) => (c.id === activeClientId ? updateRecordWithProject(c, project) : c));
          saveClientProjects(next);
          return next;
        });
      }
      setActiveClientId(client.id);
      saveActiveClientId(client.id);
      setProject({
        ...client.project,
        wallZones: client.project.wallZones || [],
        adjacentRooms: client.project.adjacentRooms || [],
      });
      setSelection(null);
      setClientModalOpen(false);
      setAutoSaveState('saved');
      setTimeout(() => viewportRef.current?.resetCamera('free'), 90);
      showToast(`${client.clientName} · ${client.roomTitle} odasına geçildi.`);
    },
    [activeClientId, project, showToast]
  );

  const handleCreateClient = useCallback(
    (opts: {
      clientName: string;
      roomTitle: string;
      phone?: string;
      note?: string;
      preset: ApartmentPresetId | 'keep_current';
    }) => {
      const baseProject: ArchRoomProject =
        opts.preset === 'keep_current'
          ? { ...project, wallZones: project.wallZones || [], adjacentRooms: project.adjacentRooms || [] }
          : opts.preset === 'single'
          ? createDefaultArchitectProject(catalog)
          : buildApartmentPreset(opts.preset, catalog);

      const newRec = createClientProjectRecord({
        clientName: opts.clientName,
        roomTitle: opts.roomTitle,
        phone: opts.phone,
        note: opts.note,
        project: baseProject,
      });

      setClientProjects((prev) => {
        const flushed = activeClientId
          ? prev.map((c) => (c.id === activeClientId ? updateRecordWithProject(c, project) : c))
          : prev;
        const next = [newRec, ...flushed];
        saveClientProjects(next);
        return next;
      });
      setActiveClientId(newRec.id);
      saveActiveClientId(newRec.id);
      setProject(newRec.project);
      setSelection(null);
      setClientModalOpen(false);
      setAutoSaveState('saved');
      if (opts.preset !== 'keep_current') {
        setTimeout(() => viewportRef.current?.resetCamera('free'), 90);
      }
      showToast(`${newRec.clientName} · ${newRec.roomTitle} oluşturuldu ve kaydedildi.`);
    },
    [activeClientId, catalog, project, showToast]
  );

  const handleRenameClient = useCallback(
    (id: string, clientName: string, roomTitle: string, phone?: string, note?: string) => {
      setClientProjects((prev) => {
        const next = prev.map((c) =>
          c.id === id
            ? {
                ...c,
                clientName,
                roomTitle,
                phone: phone || undefined,
                note: note || undefined,
                project: { ...c.project, projectName: `${clientName} · ${roomTitle}` },
              }
            : c
        );
        saveClientProjects(next);
        return next;
      });
      showToast('Müşteri bilgileri güncellendi.');
    },
    [showToast]
  );

  const handleDuplicateClient = useCallback(
    (id: string) => {
      const src = clientProjects.find((c) => c.id === id);
      if (!src) return;
      const copy = createClientProjectRecord({
        clientName: `${src.clientName} (Alternatif)`,
        roomTitle: src.roomTitle,
        phone: src.phone,
        note: src.note,
        project: JSON.parse(JSON.stringify(src.project)) as ArchRoomProject,
      });
      setClientProjects((prev) => {
        const next = [copy, ...prev];
        saveClientProjects(next);
        return next;
      });
      setActiveClientId(copy.id);
      saveActiveClientId(copy.id);
      setProject(copy.project);
      setSelection(null);
      setClientModalOpen(false);
      showToast(`${copy.clientName} kopyalandı ve açıldı.`);
    },
    [clientProjects, showToast]
  );

  const handleDeleteClient = useCallback(
    (id: string) => {
      setClientProjects((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveClientProjects(next);
        return next;
      });
      if (activeClientId === id) {
        setActiveClientId(null);
        saveActiveClientId(null);
      }
      showToast('Müşteri projesi silindi.');
    },
    [activeClientId, showToast]
  );

  // Re-open right inspector panel smoothly whenever user clicks a new element in 3D
  useEffect(() => {
    if (selection) setRightPanelOpen(true);
  }, [selection]);

  // Item #7B: Save any 2K PBR or modeled 3D furniture directly into the permanent Showroom Product Catalog!
  const handleSaveObjectToCatalog = useCallback(
    async (obj: ArchPlacedObject, thumbDataUrl?: string): Promise<boolean> => {
      try {
        showToast(`"${obj.name}" Ürün Kataloğuna kaydediliyor...`);
        let glbBuffer: ArrayBuffer | null = null;

        if (obj.glbUrl) {
          try {
            const resp = await fetch(obj.glbUrl);
            if (resp.ok) glbBuffer = await resp.arrayBuffer();
          } catch {
            /* Remote CORS-restricted URL: fall back to direct URL registration below */
          }
        } else if (obj.parametricKind) {
          const built = buildParametricObject3D(obj);
          const exporter = new GLTFExporter();
          glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            exporter.parse(
              built.group,
              (res) => {
                if (res instanceof ArrayBuffer) resolve(res);
                else reject(new Error('GLB dışa aktarılamadı'));
              },
              (err) => reject(err),
              { binary: true }
            );
          });
          built.dispose();
        }

        const dimsTargetCm = {
          w: Math.round(obj.widthM * 100),
          d: Math.round(obj.depthM * 100),
          h: Math.round(obj.heightM * 100),
        };
        const cleanDims = `${dimsTargetCm.w} × ${dimsTargetCm.d} × ${dimsTargetCm.h} cm`;

        let savedProduct: Product | null = null;
        const storageCfg = await fetchStorageConfig();

        if (storageCfg.configured && glbBuffer) {
          try {
            savedProduct = await saveProductToCloudStorage({
              name: obj.name,
              category: obj.category || 'Özel Tasarım',
              dimensionsCm: cleanDims,
              dimsTargetCm,
              glbBuffer,
              thumbnailDataUrl: thumbDataUrl || obj.thumbUrl || null,
              storageConfig: storageCfg,
              onProgress: (m) => showToast(m),
            });
          } catch {
            /* Fall back to local/session catalog save below */
          }
        }

        if (!savedProduct) {
          const fallbackUrl =
            obj.glbUrl ||
            (glbBuffer ? URL.createObjectURL(new Blob([glbBuffer], { type: 'model/gltf-binary' })) : '');
          if (!fallbackUrl) {
            showToast('Katalog kaydı için 3B model verisi oluşturulamadı.');
            return false;
          }
          savedProduct = {
            id: `pbr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: obj.name,
            category: obj.category || 'Özel Tasarım',
            dimensionsCm: cleanDims,
            dimsTargetCm,
            glbUrl: fallbackUrl,
            remoteGlbUrl: fallbackUrl.startsWith('http') ? fallbackUrl : undefined,
            thumbUrl: thumbDataUrl || obj.thumbUrl,
            source: 'ozel-cad',
            cloudStored: false,
          };
          saveLocalCustomProduct(savedProduct);
        } else {
          saveLocalCustomProduct(savedProduct);
        }

        const finalProd = savedProduct;
        setCatalog((prev) => [finalProd, ...prev.filter((p) => p.id !== finalProd.id)]);
        setProject((prev) => ({
          ...prev,
          objects: prev.objects.map((o) =>
            o.id === obj.id
              ? { ...o, glbUrl: finalProd.glbUrl, productRef: finalProd, thumbUrl: finalProd.thumbUrl || o.thumbUrl }
              : o
          ),
        }));
        showToast(
          `✓ "${finalProd.name}" Ürün Kataloğuna kaydedildi! (Mobilya sekmesinde ve Canlı AR'da kullanıma hazır)`
        );
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Katalog kaydı sırasında hata oluştu.');
        return false;
      }
    },
    [showToast]
  );

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
  const houseBounds = useMemo(() => getHouseBounds(project), [project]);
  const totalRoomCount = 1 + (project.adjacentRooms?.length || 0);

  const applyApartmentPreset = useCallback(
    (preset: ApartmentPresetId) => {
      const built = buildApartmentPreset(preset, catalog);
      setProject(built);
      setSelection(null);
      setNewRoomParentId('main');
      setTimeout(() => viewportRef.current?.resetCamera(cameraMode === 'plan' ? 'plan' : 'free'), 80);
      const label =
        preset === 'single'
          ? 'Tek Oda (Salon) yüklendi.'
          : `${preset} Daire Planı (${1 + (built.adjacentRooms?.length || 0)} oda) kuruldu!`;
      showToast(label);
    },
    [catalog, cameraMode, showToast]
  );

  const handleAttachAdjacentRoom = useCallback(
    (opts: {
      parentRoomId: string;
      side: WallId;
      roomKind: RoomKind;
      widthM?: number;
      depthM?: number;
      passageStyle?: PassageStyle;
      autoFurnish?: boolean;
    }) => {
      let createdRoomId = '';
      let createdName = '';
      setProject((prev) => {
        const { room, newObjects } = attachAdjacentRoom(prev, opts);
        createdRoomId = room.id;
        createdName = room.name;
        // Automatically clear any overlapping exterior facade window/door on main's attached wall so the new passage opens cleanly with zero warnings
        const nextWindows =
          opts.parentRoomId === 'main' ? prev.windows.filter((w) => w.wall !== opts.side) : prev.windows;
        const nextDoors =
          opts.parentRoomId === 'main' ? prev.doors.filter((d) => d.wall !== opts.side) : prev.doors;
        return {
          ...prev,
          windows: nextWindows,
          doors: nextDoors,
          adjacentRooms: [...(prev.adjacentRooms || []), room],
          objects: [...prev.objects, ...newObjects],
        };
      });
      setTimeout(() => {
        if (createdRoomId) setSelection({ type: 'adjacentRoom', id: createdRoomId });
        viewportRef.current?.resetCamera(cameraMode === 'plan' ? 'plan' : 'free');
      }, 90);
      showToast(`${createdName || ROOM_KIND_LABELS[opts.roomKind]} eklendi ve kapı geçişi açıldı.`);
    },
    [cameraMode, showToast]
  );
  const parsedQuick = useMemo(
    () => parseQuickAddQuery(quickQuery, catalog, project.ceilingM),
    [quickQuery, catalog, project.ceilingM]
  );
  const universalSearch = useMemo(
    () => runUniversalSearch(quickQuery, catalog, searchFilterGroup, 26),
    [quickQuery, catalog, searchFilterGroup]
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

  // Shared 10-brand material-apply callbacks (used by BOTH Katalog tab & Universal Search!)
  const applyParquetItem = (item: ParquetCatalogItem) => {
    setProject((p) => ({
      ...p,
      floorMaterial: item.floorMaterial,
      floorTintHex: item.hex,
      floorBrandLabel: `${SUPPLIER_SHORT[item.brand]} ${item.series} ${item.code} · ${item.name}`,
    }));
    showToast(`Zemin → ${SUPPLIER_SHORT[item.brand]} ${item.code} (${item.name})`);
  };

  const applyWallPanelItem = (item: WallPanelCatalogItem, mode: 'full' | 'all' | 'zone') => {
    const label = `${SUPPLIER_SHORT[item.brand]} ${item.code} · ${item.name}`;
    if (mode === 'zone') {
      const wallLenCm = Math.round(getWallLengthM(activeWall, project.widthM, project.depthM) * 100);
      const ceilCm = Math.round(project.ceilingM * 100);
      const zone: ArchWallZone = {
        id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        wall: activeWall,
        label,
        offsetCm: Math.round(wallLenCm * 0.5),
        widthCm: Math.min(wallLenCm, 190),
        bottomCm: 0,
        heightCm: ceilCm,
        pattern: item.pattern,
        colorHex: item.hex,
        brandLabel: label,
      };
      setProject((p) => ({ ...p, wallZones: [...(p.wallZones || []), zone] }));
      setSelection({ type: 'wallZone', id: zone.id });
      if (cameraMode === 'free') viewportRef.current?.focusWall(activeWall);
      showToast(`${WALL_LABELS[activeWall]} → ${label} panel eklendi.`);
    } else if (mode === 'all') {
      setProject((p) => ({
        ...p,
        walls: {
          north: { colorHex: item.hex, pattern: item.pattern, brandLabel: label },
          east: { colorHex: item.hex, pattern: item.pattern, brandLabel: label },
          south: { colorHex: item.hex, pattern: item.pattern, brandLabel: label },
          west: { colorHex: item.hex, pattern: item.pattern, brandLabel: label },
        },
      }));
      showToast(`4 Duvar → ${label}`);
    } else {
      setProject((p) => ({
        ...p,
        walls: {
          ...p.walls,
          [activeWall]: { colorHex: item.hex, pattern: item.pattern, brandLabel: label },
        },
      }));
      if (cameraMode === 'free') viewportRef.current?.focusWall(activeWall);
      showToast(`${WALL_LABELS[activeWall]} → ${label}`);
    }
  };

  const applySkirtingItem = (item: SkirtingTrimCatalogItem, target: 'baseboard' | 'corner' | 'both') => {
    const label = `${SUPPLIER_SHORT[item.brand]} ${item.code} · ${item.name}`;
    setProject((p) => ({
      ...p,
      ...(target === 'both' || target === 'baseboard'
        ? {
            showBaseboard: true,
            baseboardColorHex: item.hex,
            baseboardHeightCm: p.baseboardHeightCm || item.defaultHeightCm,
            baseboardBrandLabel: label,
          }
        : {}),
      ...(target === 'both' || target === 'corner'
        ? {
            showCornerTrim: true,
            cornerTrimColorHex: item.hex,
            cornerTrimBrandLabel: `${SUPPLIER_SHORT[item.brand]} ${item.code} · Köşelik`,
          }
        : {}),
    }));
    showToast(
      `${target === 'corner' ? 'Köşelik' : target === 'baseboard' ? 'Süpürgelik' : 'Süpürgelik & Köşelik'} → ${label}`
    );
  };

  const applyDoorPanelItem = (item: DoorPanelCatalogItem) => {
    const label = `${SUPPLIER_SHORT[item.brand]} ${item.code} · ${item.name}`;
    if (project.doors.length === 0) {
      const wallLenCm = Math.round(getWallLengthM(activeWall, project.widthM, project.depthM) * 100);
      const door: ArchDoor = {
        id: `door-${Date.now()}`,
        wall: activeWall,
        kind: 'single',
        offsetCm: Math.round(wallLenCm * 0.35),
        widthCm: 95,
        heightCm: Math.min(215, Math.round(project.ceilingM * 100) - 15),
        swing: 'inward',
        hinge: 'left',
        openAngleDeg: 40,
        colorHex: item.hex,
        handleColorHex: item.handleHex,
        panelStyle: item.panelStyle,
        brandLabel: label,
      };
      setProject((p) => ({ ...p, doors: [door] }));
      setSelection({ type: 'door', id: door.id });
      showToast(`${label} kapı eklendi.`);
      return;
    }
    const targetDoorId = selection?.type === 'door' ? selection.id : null;
    setProject((p) => ({
      ...p,
      doors: p.doors.map((d) =>
        !targetDoorId || d.id === targetDoorId
          ? {
              ...d,
              colorHex: item.hex,
              handleColorHex: item.handleHex,
              panelStyle: item.panelStyle,
              brandLabel: label,
            }
          : d
      ),
    }));
    showToast(`Kapı Paneli → ${label}`);
  };

  const applyCountertopItem = (item: CountertopCatalogItem) => {
    const label = `${SUPPLIER_SHORT[item.brand]} ${item.code} · ${item.name}`;
    const existing =
      (selection?.type === 'object'
        ? project.objects.find((o) => o.id === selection.id && o.parametricKind === 'kitchen_counter')
        : undefined) || project.objects.find((o) => o.parametricKind === 'kitchen_counter');
    if (existing) {
      setProject((p) => ({
        ...p,
        objects: p.objects.map((o) =>
          o.id === existing.id
            ? {
                ...o,
                parametricColorHex: item.hex,
                parametricAccentHex: item.recommendedCabinetHex,
                countertopSurface: item.surfaceKind,
                materialBrandLabel: label,
              }
            : o
        ),
      }));
      setSelection({ type: 'object', id: existing.id });
      showToast(`Tezgah → ${label}`);
      return;
    }
    const snap = computeWallSnapTransform(activeWall, 0.65, project);
    const obj: ArchPlacedObject = {
      id: `mod-kitchen_counter-${Date.now()}`,
      name: `${item.series} (${item.code})`,
      category: 'Tezgah & Mutfak',
      dimensionsCm: '220 × 65 × 90 cm',
      parametricKind: 'kitchen_counter',
      parametricColorHex: item.hex,
      parametricAccentHex: item.recommendedCabinetHex,
      countertopSurface: item.surfaceKind,
      materialBrandLabel: label,
      x: snap.x,
      y: 0,
      z: snap.z,
      rot: snap.rot,
      widthM: 2.2,
      depthM: 0.65,
      heightM: 0.9,
      mountMode: 'wall',
      attachedWall: activeWall,
      source: 'parametric',
    };
    setProject((p) => ({ ...p, objects: [...p.objects, obj] }));
    setSelection({ type: 'object', id: obj.id });
    if (cameraMode === 'free') viewportRef.current?.focusWall(activeWall);
    showToast(`${label} tezgah modülü eklendi.`);
  };

  const applyFurniturePanelItem = (item: FurniturePanelCatalogItem) => {
    const label = `${SUPPLIER_SHORT[item.brand]} ${item.code} · ${item.name}`;
    const targetObj = selection?.type === 'object' ? project.objects.find((o) => o.id === selection.id) : null;
    if (!targetObj) {
      showToast('Önce 3B sahneden bir mobilyaya (dolap, kitaplık, masa, koltuk vb.) tıklayın.');
      return;
    }
    setProject((p) => ({
      ...p,
      objects: p.objects.map((o) =>
        o.id === targetObj.id
          ? o.parametricKind
            ? {
                ...o,
                parametricColorHex: item.hex,
                parametricAccentHex: item.accentHex,
                materialBrandLabel: label,
              }
            : { ...o, tintHex: item.hex, materialBrandLabel: label }
          : o
      ),
    }));
    showToast(`${targetObj.name} → ${label}`);
  };

  const executeUniversalResult = (res: UniversalSearchResult, altWallAll = false) => {
    if (res.subKind === 'parquet') {
      applyParquetItem(res.item);
    } else if (res.subKind === 'wall') {
      applyWallPanelItem(res.item, altWallAll ? 'all' : res.item.isProfile ? 'zone' : 'all');
    } else if (res.subKind === 'skirting') {
      applySkirtingItem(res.item, 'both');
    } else if (res.subKind === 'doorPanel') {
      applyDoorPanelItem(res.item);
    } else if (res.subKind === 'countertop') {
      applyCountertopItem(res.item);
    } else if (res.subKind === 'furniturePanel') {
      applyFurniturePanelItem(res.item);
    } else if (res.subKind === 'parametric') {
      spawnParametricObject(res.spec);
    } else if (res.subKind === 'catalogProduct') {
      addCatalogProduct(res.product);
    } else if (res.subKind === 'window') {
      addWindowOnWall(activeWall, res.windowKind);
    } else if (res.subKind === 'door') {
      addDoorOnWall(activeWall, res.doorKind);
    } else if (res.subKind === 'action') {
      if (res.actionId === 'add_cove') toggleCurtainCove(activeWall);
      else if (res.actionId === 'add_column') addColumn('rect');
      else if (res.actionId === 'add_beam') addBeam('x');
      else if (res.actionId === 'toggle_mezzanine') {
        setActiveTab('room');
        setOpenRoomSection('structure');
        setStructureSubTab('loft');
        setProject((prev) => {
          const enabling = !prev.mezzanine?.enabled;
          return {
            ...prev,
            ceilingM: enabling ? Math.max(4.0, prev.ceilingM) : prev.ceilingM,
            mezzanine: enabling
              ? {
                  enabled: true,
                  anchorWall: 'north',
                  heightM: 2.05,
                  depthM: Math.round(prev.depthM * 52) / 100,
                  widthRatio: 0.78,
                  stairGapSide: 'west',
                  thicknessM: 0.16,
                  deckColorHex: prev.floorTintHex || '#c9b092',
                  railingStyle: 'none',
                  underLed: true,
                }
              : { ...(prev.mezzanine as any), enabled: false },
          };
        });
        showToast('2. Kat / Asma Kat güncellendi.');
      } else if (res.actionId === 'template_1plus1') {
        applyApartmentPreset('1+1');
      } else if (res.actionId === 'template_2plus1') {
        applyApartmentPreset('2+1');
      } else if (res.actionId === 'template_3plus1') {
        applyApartmentPreset('3+1');
      } else if (res.actionId === 'add_room_bedroom') {
        handleAttachAdjacentRoom({ parentRoomId: 'main', side: activeWall, roomKind: 'bedroom', autoFurnish: true });
      } else if (res.actionId === 'add_room_kitchen') {
        handleAttachAdjacentRoom({ parentRoomId: 'main', side: activeWall, roomKind: 'kitchen', passageStyle: 'open_arch', autoFurnish: true });
      } else if (res.actionId === 'add_room_bathroom') {
        handleAttachAdjacentRoom({ parentRoomId: 'main', side: activeWall, roomKind: 'bathroom', autoFurnish: true });
      } else if (res.actionId === 'add_room_hallway') {
        handleAttachAdjacentRoom({ parentRoomId: 'main', side: activeWall, roomKind: 'hallway', passageStyle: 'open_arch', autoFurnish: false });
      } else {
        setActiveTab('room');
        setOpenRoomSection('houses');
        setShowAddRoomForm(true);
      }
    }
    setQuickFocused(false);
    setMobileSearchOpen(false);
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

  const moveOpeningToWall = useCallback(
    (kind: 'window' | 'door' | 'wallZone', id: string, targetWall: WallId) => {
      const targetLenCm = Math.round(getWallLengthM(targetWall, project.widthM, project.depthM) * 100);
      const findFreeOffset = (prev: ArchRoomProject, spanW: number, preferredRatio: number): number => {
        const occupied = [
          ...prev.windows.filter((w) => w.wall === targetWall && w.id !== id).map((w) => [w.offsetCm - w.widthCm * 0.5, w.offsetCm + w.widthCm * 0.5]),
          ...prev.doors.filter((d) => d.wall === targetWall && d.id !== id).map((d) => [d.offsetCm - d.widthCm * 0.5, d.offsetCm + d.widthCm * 0.5]),
        ];
        const minC = Math.round(spanW * 0.5) + 12;
        const maxC = Math.max(minC, targetLenCm - Math.round(spanW * 0.5) - 12);
        const candidates = [
          Math.round(targetLenCm * preferredRatio),
          Math.round(targetLenCm * 0.5),
          Math.round(targetLenCm * 0.78),
          Math.round(targetLenCm * 0.22),
          maxC,
          minC,
        ];
        for (const c of candidates) {
          const clamped = Math.max(minC, Math.min(maxC, c));
          const a = clamped - spanW * 0.5 - 8;
          const b = clamped + spanW * 0.5 + 8;
          if (!occupied.some(([e0, e1]) => !(b <= e0 || a >= e1))) {
            return clamped;
          }
        }
        return Math.max(minC, Math.min(maxC, Math.round(targetLenCm * preferredRatio)));
      };

      setProject((prev) => {
        if (kind === 'window') {
          return {
            ...prev,
            windows: prev.windows.map((w) => {
              if (w.id !== id) return w;
              const safeW = Math.min(w.widthCm, targetLenCm - 30);
              const safeOff = findFreeOffset(prev, safeW, 0.5);
              return { ...w, wall: targetWall, widthCm: safeW, offsetCm: safeOff };
            }),
          };
        }
        if (kind === 'door') {
          return {
            ...prev,
            doors: prev.doors.map((d) => {
              if (d.id !== id) return d;
              const safeW = Math.min(d.widthCm, targetLenCm - 30);
              const safeOff = findFreeOffset(prev, safeW, 0.35);
              return { ...d, wall: targetWall, widthCm: safeW, offsetCm: safeOff };
            }),
          };
        }
        return {
          ...prev,
          wallZones: (prev.wallZones || []).map((z) => {
            if (z.id !== id) return z;
            const safeW = Math.min(z.widthCm, targetLenCm);
            return { ...z, wall: targetWall, widthCm: safeW, offsetCm: Math.round(targetLenCm * 0.5) };
          }),
        };
      });
      setActiveWall(targetWall);
      if (cameraMode === 'free') viewportRef.current?.focusWall(targetWall);
      showToast(`${WALL_LABELS[targetWall]} üzerine taşındı.`);
    },
    [project.widthM, project.depthM, cameraMode, showToast]
  );

  const enterDoorWalkthrough = useCallback(() => {
    setAutoRotate360(false);
    setProject((prev) => {
      if (prev.doors.length === 0) return prev;
      const first = prev.doors[0];
      if (first.openAngleDeg >= 65) return prev;
      return {
        ...prev,
        doors: prev.doors.map((d, i) => (i === 0 ? { ...d, openAngleDeg: 82 } : d)),
      };
    });
    setSelection((prev) => (prev?.type === 'object' ? prev : null));
    setMobileSidebarOpen(false);
    setCameraMode('inside');
    setTimeout(() => viewportRef.current?.enterFromDoor(), 40);
  }, []);

  const toggleTvPresentationMode = useCallback(() => {
    setTvPresentationMode((prev) => {
      const next = !prev;
      const docEl = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      const doc = document as Document & { webkitExitFullscreen?: () => Promise<void>; webkitFullscreenElement?: Element };
      if (next) {
        setMobileSidebarOpen(false);
        setMobileSearchOpen(false);
        setSelection(null);
        try {
          if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
          else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen().catch(() => {});
        } catch {
          /* ignore unsupported browsers */
        }
      } else {
        setAutoRotate360(false);
        try {
          if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
          else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) doc.webkitExitFullscreen().catch(() => {});
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

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
        setProject({ ...parsed, wallZones: parsed.wallZones || [], adjacentRooms: parsed.adjacentRooms || [] });
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

  const TABS: Array<{ id: StudioTab; label: string; title: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'room', label: 'Oda', title: 'Daire planı, oda ölçüleri, pencere/kapı ve 2. kat', icon: Building2 },
    { id: 'catalog', label: 'Malzeme', title: '10 marka parke, duvar boya/profil, süpürgelik, kapı ve tezgah', icon: Layers },
    { id: 'objects', label: 'Mobilya', title: '3B mobilyalar, mutfak/banyo modülleri ve CAD yükleme', icon: Sofa },
    { id: 'sun', label: 'Işık', title: 'Güneş saati, mevsim ve cephe yönü', icon: Sun },
    { id: 'pinterest', label: 'Foto 3B', title: 'Pinterest veya kamera fotoğrafından anında 3B oda oluştur', icon: Sparkles },
  ];

  const renderLeftSidebar = () => {
    if (activeTab === 'room') {
      const adjList = project.adjacentRooms || [];
      const structureSummaryParts: string[] = [];
      if (project.mezzanine?.enabled) structureSummaryParts.push('2. Kat Aktif');
      if (project.curtainCoves.length > 0) structureSummaryParts.push(`${project.curtainCoves.length} Perde Havuzu`);
      const structColBeamCount = project.columns.length + project.beams.length;
      if (structColBeamCount > 0) structureSummaryParts.push(`${structColBeamCount} Kolon/Kiriş`);
      const structureSubtitle =
        structureSummaryParts.length > 0 ? structureSummaryParts.join(' · ') : 'Asma Kat · Perde · Kolon';

      return (
        <div className="divide-y divide-stone-200 text-xs">
          {/* Top Always-Visible Quick Apartment Strip & Live Room Summary */}
          <div className="p-3 bg-[#faf9f6] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                Daire Planı (Tek Tık)
              </span>
              <span className="text-[10px] font-mono font-semibold text-stone-700 whitespace-nowrap">
                {totalRoomCount} Oda · {Math.round(houseBounds.totalAreaM2)} m²
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: 'single' as ApartmentPresetId, lbl: 'Tek Oda' },
                  { id: '1+1' as ApartmentPresetId, lbl: '1+1' },
                  { id: '2+1' as ApartmentPresetId, lbl: '2+1' },
                  { id: '3+1' as ApartmentPresetId, lbl: '3+1' },
                ]
              ).map((pr) => {
                const active =
                  (pr.id === 'single' && adjList.length === 0) ||
                  (pr.id !== 'single' && project.projectName.startsWith(pr.id));
                return (
                  <button
                    key={pr.id}
                    type="button"
                    onClick={() => applyApartmentPreset(pr.id)}
                    className={`py-1.5 px-1 border text-[11px] font-semibold whitespace-nowrap transition ${
                      active
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-300 bg-white text-stone-800 hover:border-stone-950'
                    }`}
                  >
                    {pr.lbl}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card 1: Odalar & Yanına Oda Ekle */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection('houses')}
              className={`w-full px-3.5 py-3 flex items-center justify-between gap-2.5 text-left transition ${
                openRoomSection === 'houses' ? 'bg-white' : 'bg-[#faf9f6] hover:bg-stone-100/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Home className="w-4 h-4 text-stone-700 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-stone-950 leading-tight truncate">Odalar &amp; Yanına Oda Ekle</p>
                  <p className="text-[10px] text-stone-500 truncate mt-0.5">
                    {totalRoomCount} Oda · {Math.round(houseBounds.totalAreaM2)} m² · Geçişli oda ekle
                  </p>
                </div>
              </div>
              {openRoomSection === 'houses' ? (
                <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
              )}
            </button>
            {openRoomSection === 'houses' && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-3 bg-white">
                {/* Active Rooms List */}
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase text-stone-500">
                    Evdeki Odalar (Düzenlemek İçin Seç)
                  </span>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-0.5">
                    <button
                      type="button"
                      onClick={() => setSelection({ type: 'floor' })}
                      className={`w-full px-2.5 py-1.5 border flex items-center justify-between text-[11px] transition ${
                        selection?.type === 'floor'
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 hover:border-stone-950 bg-[#faf9f6] text-stone-900'
                      }`}
                    >
                      <span className="font-semibold">Ana Salon</span>
                      <span className="font-mono text-[10px] opacity-75">
                        {project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m · {(project.widthM * project.depthM).toFixed(0)} m²
                      </span>
                    </button>
                    {adjList.map((r) => {
                      const active = selection?.type === 'adjacentRoom' && selection.id === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelection({ type: 'adjacentRoom', id: r.id })}
                          className={`w-full px-2.5 py-1.5 border flex items-center justify-between text-[11px] transition ${
                            active
                              ? 'border-stone-950 bg-stone-950 text-white'
                              : 'border-stone-200 bg-white hover:border-stone-950 text-stone-900'
                          }`}
                        >
                          <span className="truncate font-medium">{r.name}</span>
                          <span className="font-mono text-[10px] opacity-75 shrink-0 ml-2">
                            {r.widthM.toFixed(1)}×{r.depthM.toFixed(1)} m · {(r.widthM * r.depthM).toFixed(0)} m²
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Collapsible "+ Yanına Yeni Oda Ekle" Sims Form */}
                <button
                  type="button"
                  onClick={() => setShowAddRoomForm((v) => !v)}
                  className={`w-full py-2 px-2.5 border text-[11px] font-semibold flex items-center justify-between transition ${
                    showAddRoomForm
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-950 bg-white text-stone-950 hover:bg-stone-950 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    <span>Yanına Yeni Oda Ekle</span>
                  </span>
                  {showAddRoomForm ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {showAddRoomForm && (
                  <div className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-stone-500 block">Bağlanacak Oda</span>
                        <select
                          value={newRoomParentId}
                          onChange={(e) => setNewRoomParentId(e.target.value)}
                          className="w-full px-1.5 py-1 border border-stone-300 bg-white text-[11px]"
                        >
                          <option value="main">Ana Salon</option>
                          {adjList.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px] text-stone-500 block">Oda Tipi</span>
                        <select
                          value={newRoomKind}
                          onChange={(e) => {
                            const k = e.target.value as RoomKind;
                            setNewRoomKind(k);
                            setNewRoomW(ROOM_KIND_DEFAULTS[k].w);
                            setNewRoomD(ROOM_KIND_DEFAULTS[k].d);
                            setNewRoomPassage(ROOM_KIND_DEFAULTS[k].passageStyle);
                          }}
                          className="w-full px-1.5 py-1 border border-stone-300 bg-white text-[11px]"
                        >
                          {(Object.keys(ROOM_KIND_LABELS) as RoomKind[]).map((rk) => (
                            <option key={rk} value={rk}>
                              {ROOM_KIND_LABELS[rk]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-stone-500 block">Hangi Duvara Eklensin?</span>
                      <div className="grid grid-cols-4 gap-1">
                        {(
                          [
                            { id: 'north' as WallId, lbl: 'Üst A' },
                            { id: 'east' as WallId, lbl: 'Sağ B' },
                            { id: 'south' as WallId, lbl: 'Alt C' },
                            { id: 'west' as WallId, lbl: 'Sol D' },
                          ]
                        ).map((sd) => (
                          <button
                            key={sd.id}
                            type="button"
                            onClick={() => setNewRoomSide(sd.id)}
                            className={`py-1 border text-[10px] font-semibold ${
                              newRoomSide === sd.id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'
                            }`}
                          >
                            {sd.lbl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-stone-500 block">Geçiş Şekli</span>
                      <div className="grid grid-cols-3 gap-1">
                        {(['door', 'open_arch', 'open_wide'] as PassageStyle[]).map((ps) => (
                          <button
                            key={ps}
                            type="button"
                            onClick={() => setNewRoomPassage(ps)}
                            className={`py-1 border text-[10px] font-semibold truncate ${
                              newRoomPassage === ps ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'
                            }`}
                          >
                            {PASSAGE_STYLE_LABELS[ps].split(' ')[0]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="text-[10px] text-stone-600">
                        En (m)
                        <NumericInput
                          min={1.4}
                          max={8}
                          step={0.2}
                          decimals={1}
                          value={newRoomW}
                          onChange={setNewRoomW}
                          className="w-full px-2 py-1 border border-stone-300 bg-white font-mono text-xs"
                        />
                      </label>
                      <label className="text-[10px] text-stone-600">
                        Derinlik (m)
                        <NumericInput
                          min={1.4}
                          max={8}
                          step={0.2}
                          decimals={1}
                          value={newRoomD}
                          onChange={setNewRoomD}
                          className="w-full px-2 py-1 border border-stone-300 bg-white font-mono text-xs"
                        />
                      </label>
                    </div>

                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRoomFurnish}
                        onChange={(e) => setNewRoomFurnish(e.target.checked)}
                        className="accent-stone-950"
                      />
                      <span>Eşyalarıyla birlikte hazır kur (WC / Tezgah / Yatak)</span>
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        handleAttachAdjacentRoom({
                          parentRoomId: newRoomParentId,
                          side: newRoomSide,
                          roomKind: newRoomKind,
                          widthM: newRoomW,
                          depthM: newRoomD,
                          passageStyle: newRoomPassage,
                          autoFurnish: newRoomFurnish,
                        })
                      }
                      className="w-full py-2 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Odayı Ekle &amp; Geçiş Aç</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 2: Ölçü, Tavan & Duvarlar */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection('dims')}
              className={`w-full px-3.5 py-3 flex items-center justify-between gap-2.5 text-left transition ${
                openRoomSection === 'dims' ? 'bg-white' : 'bg-[#faf9f6] hover:bg-stone-100/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Ruler className="w-4 h-4 text-stone-700 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-stone-950 leading-tight truncate">Ölçü, Tavan &amp; Duvarlar</p>
                  <p className="text-[10px] text-stone-500 truncate mt-0.5">
                    {project.widthM.toFixed(1)} × {project.depthM.toFixed(1)} m · Tavan {project.ceilingM.toFixed(2)} m
                  </p>
                </div>
              </div>
              {openRoomSection === 'dims' ? (
                <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
              )}
            </button>
            {openRoomSection === 'dims' && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-3 bg-white">
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
                      max={6.0}
                      step={0.05}
                      decimals={2}
                      value={project.ceilingM}
                      onChange={(v) => updateRoomDim({ ceilingM: v })}
                      className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] font-mono text-xs"
                    />
                  </label>
                </div>
                <p className="text-[10px] text-stone-400">
                  Ölçüyü yazıp <strong>Enter</strong>&apos;a bas (örn. <code className="font-mono">7,5</code>).
                </p>

                <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[11px] pt-1 border-t border-stone-100">
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
                      checked={project.showCornerTrim !== false}
                      onChange={(e) => setProject((p) => ({ ...p, showCornerTrim: e.target.checked }))}
                      className="accent-stone-950"
                    />
                    <span>Köşelik</span>
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

                <div className="pt-2 border-t border-stone-200 space-y-1.5">
                  <p className="text-[10px] text-stone-500">Duvar veya Zemin Seç (veya 3B&apos;de tıkla):</p>
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
                        className={`px-2 py-1.5 border flex items-center justify-between text-[11px] transition ${
                          selection?.type === 'wall' && selection.wall === wId
                            ? 'border-stone-950 bg-stone-950 text-white'
                            : 'border-stone-200 hover:border-stone-950 bg-white text-stone-800'
                        }`}
                      >
                        <span className="truncate">{WALL_LABELS[wId]}</span>
                        <span className="w-3 h-3 border border-black/20 shrink-0" style={{ backgroundColor: project.walls[wId].colorHex }} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelection({ type: 'floor' })}
                    className={`w-full py-1.5 border text-[11px] font-medium transition ${
                      selection?.type === 'floor'
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 hover:border-stone-950 bg-[#faf9f6] text-stone-800'
                    }`}
                  >
                    Zemin Parkesi &amp; Rengini Düzenle
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Pencere & Kapılar */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection('openings')}
              className={`w-full px-3.5 py-3 flex items-center justify-between gap-2.5 text-left transition ${
                openRoomSection === 'openings' ? 'bg-white' : 'bg-[#faf9f6] hover:bg-stone-100/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <DoorOpen className="w-4 h-4 text-stone-700 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-stone-950 leading-tight truncate">Pencere &amp; Kapılar</p>
                  <p className="text-[10px] text-stone-500 truncate mt-0.5">
                    {project.windows.length} Pencere · {project.doors.length} Kapı
                  </p>
                </div>
              </div>
              {openRoomSection === 'openings' ? (
                <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
              )}
            </button>
            {openRoomSection === 'openings' && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-3 bg-white">
                <div className="space-y-1">
                  <span className="text-[10px] text-stone-500 block">Eklenecek Duvar</span>
                  <div className="grid grid-cols-4 gap-1">
                    {WALL_IDS.map((wId) => (
                      <button
                        key={wId}
                        type="button"
                        onClick={() => {
                          setActiveWall(wId);
                          if (cameraMode === 'free') viewportRef.current?.focusWall(wId);
                        }}
                        className={`py-1.5 border text-[10px] font-semibold truncate transition ${
                          activeWall === wId ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-[#faf9f6] text-stone-700'
                        }`}
                      >
                        {wId === 'north' ? 'Üst A' : wId === 'east' ? 'Sağ B' : wId === 'south' ? 'Alt C' : 'Sol D'}
                      </button>
                    ))}
                  </div>
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

                {(project.windows.length > 0 || project.doors.length > 0) && (
                  <div className="border-t border-stone-200 pt-2.5 space-y-1">
                    <span className="text-[10px] font-mono uppercase text-stone-500">Mevcut Pencere &amp; Kapılar</span>
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
                        <span className="text-[10px] font-mono opacity-75">
                          {w.wall === 'north' ? 'Üst A' : w.wall === 'east' ? 'Sağ B' : w.wall === 'south' ? 'Alt C' : 'Sol D'}
                        </span>
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
                        <span className="text-[10px] font-mono opacity-75">
                          {d.wall === 'north' ? 'Üst A' : d.wall === 'east' ? 'Sağ B' : d.wall === 'south' ? 'Alt C' : 'Sol D'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 4: 2. Kat & Mimari Detaylar (3 Focused Sub-Tabs!) */}
          <div>
            <button
              type="button"
              onClick={() => toggleSection('structure')}
              className={`w-full px-3.5 py-3 flex items-center justify-between gap-2.5 text-left transition ${
                openRoomSection === 'structure' ? 'bg-white' : 'bg-[#faf9f6] hover:bg-stone-100/80'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Layers className="w-4 h-4 text-stone-700 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-stone-950 leading-tight truncate">2. Kat &amp; Mimari Detaylar</p>
                  <p className="text-[10px] text-stone-500 truncate mt-0.5">{structureSubtitle}</p>
                </div>
              </div>
              {openRoomSection === 'structure' ? (
                <ChevronDown className="w-4 h-4 text-stone-500 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
              )}
            </button>
            {openRoomSection === 'structure' && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-3 bg-white">
                {/* 3-way sub-tab switcher keeps Asma Kat, Perde Havuzu, and Kolon/Kiriş separated & clean */}
                <div className="grid grid-cols-3 gap-1 bg-[#faf9f6] p-1 border border-stone-200">
                  {(
                    [
                      { id: 'loft' as StructureSubTab, lbl: '2. Kat (Loft)' },
                      { id: 'cove' as StructureSubTab, lbl: 'Perde Havuzu' },
                      { id: 'col' as StructureSubTab, lbl: 'Kolon & Kiriş' },
                    ]
                  ).map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStructureSubTab(st.id)}
                      className={`py-1.5 px-1 text-[10px] font-semibold truncate transition ${
                        structureSubTab === st.id
                          ? 'bg-stone-950 text-white'
                          : 'text-stone-700 hover:text-stone-950'
                      }`}
                    >
                      {st.lbl}
                    </button>
                  ))}
                </div>

                {structureSubTab === 'loft' && (
                  <div className="border border-stone-200 bg-[#faf9f6] p-2.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-stone-900">
                        Asma Kat (Mezzanine)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setProject((prev) => {
                            const enabling = !prev.mezzanine?.enabled;
                            const nextCeil = enabling ? Math.max(4.0, prev.ceilingM) : prev.ceilingM;
                            return {
                              ...prev,
                              ceilingM: nextCeil,
                              mezzanine: enabling
                                ? {
                                    enabled: true,
                                    anchorWall: prev.mezzanine?.anchorWall || 'north',
                                    heightM: prev.mezzanine?.heightM || 2.05,
                                    depthM: prev.mezzanine?.depthM || Math.round(prev.depthM * 52) / 100,
                                    widthRatio: prev.mezzanine?.widthRatio || 0.78,
                                    stairGapSide: prev.mezzanine?.stairGapSide || 'west',
                                    thicknessM: 0.16,
                                    deckColorHex: prev.mezzanine?.deckColorHex || prev.floorTintHex || '#c9b092',
                                    railingStyle: prev.mezzanine?.railingStyle || 'none',
                                    underLed: prev.mezzanine?.underLed ?? true,
                                  }
                                : { ...(prev.mezzanine as any), enabled: false },
                            };
                          });
                        }}
                        className={`px-2.5 py-1 border text-[10px] font-semibold transition ${
                          project.mezzanine?.enabled
                            ? 'border-stone-950 bg-stone-950 text-white'
                            : 'border-stone-400 bg-white text-stone-800 hover:border-stone-950'
                        }`}
                      >
                        {project.mezzanine?.enabled ? '✓ 2. Kat Aktif' : '+ 2. Kat Ekle'}
                      </button>
                    </div>

                    {!project.mezzanine?.enabled && (
                      <p className="text-[11px] text-stone-500 leading-snug">
                        Yüksek tavanlı loft odalar için tek tıkla 2. kat ekler; kat yüksekliği ve korkuluk tipini özelleştirebilirsin.
                      </p>
                    )}

                    {project.mezzanine?.enabled && (
                      <div className="space-y-2.5 pt-2 border-t border-stone-200">
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-stone-600">
                          <label>
                            Kat Yüksekliği <strong className="font-mono text-stone-900">{Math.round(project.mezzanine.heightM * 100)} cm</strong>
                            <input
                              type="range"
                              min={170}
                              max={Math.max(220, Math.round((project.ceilingM - 1.25) * 100))}
                              step={5}
                              value={Math.round(project.mezzanine.heightM * 100)}
                              onChange={(e) =>
                                setProject((p) =>
                                  p.mezzanine
                                    ? { ...p, mezzanine: { ...p.mezzanine, heightM: Number(e.target.value) / 100 } }
                                    : p
                                )
                              }
                              className="w-full accent-stone-950 mt-1"
                            />
                          </label>
                          <label>
                            Derinlik <strong className="font-mono text-stone-900">{Math.round(project.mezzanine.depthM * 100)} cm</strong>
                            <input
                              type="range"
                              min={130}
                              max={Math.round(project.depthM * 70)}
                              step={10}
                              value={Math.round(project.mezzanine.depthM * 100)}
                              onChange={(e) =>
                                setProject((p) =>
                                  p.mezzanine
                                    ? { ...p, mezzanine: { ...p.mezzanine, depthM: Number(e.target.value) / 100 } }
                                    : p
                                )
                              }
                              className="w-full accent-stone-950 mt-1"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-3 gap-1">
                          {(['west', 'none', 'east'] as const).map((side) => (
                            <button
                              key={side}
                              type="button"
                              onClick={() =>
                                setProject((p) =>
                                  p.mezzanine
                                    ? {
                                        ...p,
                                        mezzanine: {
                                          ...p.mezzanine,
                                          stairGapSide: side,
                                          widthRatio: side === 'none' ? 1.0 : 0.78,
                                        },
                                      }
                                    : p
                                )
                              }
                              className={`py-1 border text-[10px] font-semibold ${
                                project.mezzanine?.stairGapSide === side
                                  ? 'border-stone-950 bg-stone-950 text-white'
                                  : 'border-stone-200 bg-white'
                              }`}
                            >
                              {side === 'west' ? 'Sol Merdiven' : side === 'east' ? 'Sağ Merdiven' : 'Tam Genişlik'}
                            </button>
                          ))}
                        </div>

                        <div className="grid grid-cols-3 gap-1">
                          {(['none', 'glass', 'metal'] as const).map((rs) => (
                            <button
                              key={rs}
                              type="button"
                              onClick={() =>
                                setProject((p) =>
                                  p.mezzanine ? { ...p, mezzanine: { ...p.mezzanine, railingStyle: rs } } : p
                                )
                              }
                              className={`py-1 border text-[10px] font-semibold ${
                                project.mezzanine?.railingStyle === rs
                                  ? 'border-stone-950 bg-stone-950 text-white'
                                  : 'border-stone-200 bg-white'
                              }`}
                            >
                              {rs === 'none' ? 'Korkuluksuz' : rs === 'glass' ? 'Cam Korkuluk' : 'Metal Korkuluk'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {structureSubTab === 'cove' && (
                  <div className="space-y-2">
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
                        className="text-[10px] font-semibold underline text-stone-700 hover:text-stone-950"
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
                            className={`px-2 py-1.5 border text-[10px] font-semibold transition ${
                              active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700 hover:border-stone-950'
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
                )}

                {structureSubTab === 'col' && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-stone-500 leading-snug">
                      Odadaki taşıyıcı kolon veya tavan kirişlerini ekleyip 3B sahneden konumlandırabilirsin.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => addColumn('rect')}
                        className="px-2 py-2 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[11px] font-semibold transition"
                      >
                        + Kare Kolon
                      </button>
                      <button
                        type="button"
                        onClick={() => addColumn('round')}
                        className="px-2 py-2 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[11px] font-semibold transition"
                      >
                        + Yuvarlak Kolon
                      </button>
                      <button
                        type="button"
                        onClick={() => addBeam('x')}
                        className="px-2 py-2 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[11px] font-semibold transition"
                      >
                        + Yatay Kiriş
                      </button>
                      <button
                        type="button"
                        onClick={() => addBeam('z')}
                        className="px-2 py-2 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-[11px] font-semibold transition"
                      >
                        + Dikey Kiriş
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === 'catalog') {
      return (
        <BrandCatalogPanel
          project={project}
          activeWall={activeWall}
          selection={selection}
          onSelectWall={(wId) => {
            setActiveWall(wId);
            if (cameraMode === 'free') viewportRef.current?.focusWall(wId);
          }}
          onApplyParquet={applyParquetItem}
          onApplyWallPanel={applyWallPanelItem}
          onApplySkirtingTrim={applySkirtingItem}
          onUpdateSkirtingHeight={(cm) => {
            setProject((p) => ({ ...p, showBaseboard: true, baseboardHeightCm: cm }));
            showToast(`Süpürgelik yüksekliği: ${cm} cm`);
          }}
          onToggleCornerTrim={(enabled) => {
            setProject((p) => ({ ...p, showCornerTrim: enabled }));
          }}
          onApplyDoorPanel={applyDoorPanelItem}
          onApplyCountertop={applyCountertopItem}
          onApplyFurniturePanel={applyFurniturePanelItem}
        />
      );
    }

    if (activeTab === 'objects') {
      const filteredModules =
        moduleCategoryFilter === 'all'
          ? PARAMETRIC_CARDS
          : PARAMETRIC_CARDS.filter((m) => m.group === moduleCategoryFilter);

      return (
        <div className="p-3.5 space-y-3 text-xs">
          {/* Compact Top CAD Upload Bar */}
          <label className="w-full py-2 px-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition">
            {uploadingCad ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            <span>CAD Model Yükle (.GLB / .FBX / .OBJ / .STL)</span>
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

          {/* Clean 3-Way Sub-Tab Bar (Eliminates long mixed scrolling!) */}
          <div className="grid grid-cols-3 gap-1 bg-[#faf9f6] p-1 border border-stone-200">
            {(
              [
                { id: 'catalog' as ObjectsSubTab, lbl: `3B Katalog (${catalog.length})` },
                { id: 'modules' as ObjectsSubTab, lbl: `Modüller (${PARAMETRIC_CARDS.length})` },
                { id: 'placed' as ObjectsSubTab, lbl: `Odadakiler (${project.objects.length})` },
              ]
            ).map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setObjectsSubTab(st.id)}
                className={`py-1.5 px-1 text-[10px] font-semibold truncate transition ${
                  objectsSubTab === st.id
                    ? 'bg-stone-950 text-white'
                    : 'text-stone-700 hover:text-stone-950'
                }`}
              >
                {st.lbl}
              </button>
            ))}
          </div>

          {/* Sub-Tab 1: 3D GLB Furniture Catalog */}
          {objectsSubTab === 'catalog' && (
            <div className="grid grid-cols-2 gap-1.5">
              {catalog.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addCatalogProduct(p)}
                  className="text-left border border-stone-200 hover:border-stone-950 bg-white overflow-hidden transition"
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
          )}

          {/* Sub-Tab 2: Parametric Architectural & Kitchen/Bath Modules */}
          {objectsSubTab === 'modules' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-4 gap-1">
                {(
                  [
                    { id: 'all' as ModuleCategoryFilter, lbl: 'Tümü' },
                    { id: 'living' as ModuleCategoryFilter, lbl: 'Salon' },
                    { id: 'kitchen_bath' as ModuleCategoryFilter, lbl: 'Mutfak/WC' },
                    { id: 'decor' as ModuleCategoryFilter, lbl: 'Dekor' },
                  ]
                ).map((mf) => (
                  <button
                    key={mf.id}
                    type="button"
                    onClick={() => setModuleCategoryFilter(mf.id)}
                    className={`py-1 border text-[10px] font-semibold truncate transition ${
                      moduleCategoryFilter === mf.id
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-500'
                    }`}
                  >
                    {mf.lbl}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {filteredModules.map((m) => (
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
          )}

          {/* Sub-Tab 3: Active Placed Objects in Scene */}
          {objectsSubTab === 'placed' && (
            <div className="space-y-1.5">
              {project.objects.length === 0 ? (
                <p className="text-[11px] text-stone-500 py-6 text-center border border-dashed border-stone-300 bg-[#faf9f6]">
                  Odada henüz eşya yok — 3B Katalog veya Modüllerden ekleyebilirsin.
                </p>
              ) : (
                project.objects.map((o) => {
                  const isSel = selection?.type === 'object' && selection.id === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setSelection({ type: 'object', id: o.id })}
                      className={`w-full px-2.5 py-2 border flex items-center justify-between gap-2 text-left transition ${
                        isSel
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-white text-stone-900 hover:border-stone-950'
                      }`}
                    >
                      <span className="font-semibold text-[11px] truncate">{o.name}</span>
                      <span className="font-mono text-[10px] opacity-75 shrink-0">{o.dimensionsCm}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
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

    return null;
  };

  // Item #7A: Persistent always-mounted Pinterest panel so switching tabs (Katalog / Oda / Eşya) NEVER loses photo or 2K PBR state!
  const renderPersistentPinterestPanel = () => (
    <div className={activeTab === 'pinterest' ? 'p-3.5 block' : 'hidden'}>
      <PinterestAIPanel
        project={project}
        activeTargetRoomId={selection?.type === 'adjacentRoom' ? selection.id : undefined}
        onApplySingleMaterial={(mat: PinterestMaterialEntry, targetRoomId?: string) => {
          setProject((prev) => {
            if (targetRoomId && targetRoomId !== 'main') {
              return {
                ...prev,
                adjacentRooms: (prev.adjacentRooms || []).map((r) => {
                  if (r.id !== targetRoomId) return r;
                  if (mat.kind === 'floor') {
                    return {
                      ...r,
                      floorMaterial: mat.floorMaterial || r.floorMaterial,
                      floorTintHex: mat.colorHex,
                    };
                  }
                  if (mat.kind === 'wall' || mat.kind === 'accentWall') {
                    return {
                      ...r,
                      wallColorHex: mat.colorHex,
                      wallPattern: mat.wallPattern || r.wallPattern,
                    };
                  }
                  return r;
                }),
              };
            }
            if (mat.kind === 'floor') {
              return {
                ...prev,
                floorMaterial: mat.floorMaterial || prev.floorMaterial,
                floorTintHex: mat.colorHex,
                floorBrandLabel: `${mat.sourceLabel} · ${mat.label}`,
              };
            }
            if (mat.kind === 'curtain') {
              return {
                ...prev,
                windows: prev.windows.map((w) => ({
                  ...w,
                  curtainStyle: w.curtainStyle === 'none' ? 'sheer_and_drape' : w.curtainStyle,
                  curtainColorHex: mat.colorHex,
                })),
              };
            }
            if (mat.kind === 'accentWall') {
              return {
                ...prev,
                walls: {
                  ...prev.walls,
                  [activeWall]: {
                    colorHex: mat.colorHex,
                    pattern: mat.wallPattern || 'slats',
                    brandLabel: `${mat.sourceLabel} · ${mat.label}`,
                  },
                },
              };
            }
            // kind === 'wall': apply to all 4 walls
            return {
              ...prev,
              walls: {
                north: { colorHex: mat.colorHex, pattern: mat.wallPattern || 'smooth', brandLabel: `${mat.sourceLabel} · ${mat.label}` },
                east: { colorHex: mat.colorHex, pattern: mat.wallPattern || 'smooth', brandLabel: `${mat.sourceLabel} · ${mat.label}` },
                south: { colorHex: mat.colorHex, pattern: mat.wallPattern || 'smooth', brandLabel: `${mat.sourceLabel} · ${mat.label}` },
                west: { colorHex: mat.colorHex, pattern: mat.wallPattern || 'smooth', brandLabel: `${mat.sourceLabel} · ${mat.label}` },
              },
            };
          });
          showToast(`${mat.sourceLabel} · ${mat.label} uygulandı.`);
        }}
        onApplyRoomStyle={(style, targetRoomId) => {
          setProject((prev) => {
            if (targetRoomId && targetRoomId !== 'main') {
              return {
                ...prev,
                adjacentRooms: (prev.adjacentRooms || []).map((r) =>
                  r.id === targetRoomId
                    ? {
                        ...r,
                        floorMaterial: style.floorMaterial || r.floorMaterial,
                        floorTintHex: style.floorTintHex || r.floorTintHex,
                        wallColorHex: style.wallColorHex || r.wallColorHex,
                        wallPattern: style.wallPattern || r.wallPattern,
                      }
                    : r
                ),
              };
            }
            return {
              ...prev,
              floorMaterial: style.floorMaterial || prev.floorMaterial,
              floorTintHex: style.floorTintHex || prev.floorTintHex,
              walls: {
                north: { colorHex: style.wallColorHex || prev.walls.north.colorHex, pattern: 'smooth' },
                south: { colorHex: style.wallColorHex || prev.walls.south.colorHex, pattern: style.wallPattern || 'smooth' },
                west: {
                  colorHex: style.accentWallColorHex || style.wallColorHex || prev.walls.west.colorHex,
                  pattern: style.wallPattern || 'smooth',
                },
                east: { colorHex: style.wallColorHex || prev.walls.east.colorHex, pattern: 'smooth' },
              },
              windows: prev.windows.map((w) => ({ ...w, curtainColorHex: style.curtainColorHex || w.curtainColorHex })),
              sun: {
                ...prev.sun,
                hour: style.suggestedSunHour ? Math.max(8, Math.min(18, style.suggestedSunHour)) : prev.sun.hour,
              },
            };
          });
        }}
        onApplyPinterestScene={(objects, style, replaceExisting, targetRoomId) => {
          const isAdjTarget = Boolean(targetRoomId && targetRoomId !== 'main');
          setProject((prev) => {
            if (isAdjTarget) {
              const adj = (prev.adjacentRooms || []).find((r) => r.id === targetRoomId);
              const keepObjs =
                replaceExisting && adj
                  ? prev.objects.filter(
                      (o) =>
                        !(
                          o.x >= adj.centerXM - adj.widthM * 0.5 - 0.1 &&
                          o.x <= adj.centerXM + adj.widthM * 0.5 + 0.1 &&
                          o.z >= adj.centerZM - adj.depthM * 0.5 - 0.1 &&
                          o.z <= adj.centerZM + adj.depthM * 0.5 + 0.1
                        )
                    )
                  : prev.objects;
              return {
                ...prev,
                adjacentRooms:
                  style && adj
                    ? (prev.adjacentRooms || []).map((r) =>
                        r.id === adj.id
                          ? {
                              ...r,
                              floorMaterial: style.floorMaterial || r.floorMaterial,
                              floorTintHex: style.floorTintHex || r.floorTintHex,
                              wallColorHex: style.wallColorHex || r.wallColorHex,
                            }
                          : r
                      )
                    : prev.adjacentRooms,
                objects: [...keepObjs, ...objects],
              };
            }

            const nextCeil = style?.hasMezzanine
              ? Math.max(3.85, Math.min(4.8, (style.suggestedCeilingCm || 410) / 100))
              : style?.suggestedCeilingCm && replaceExisting
              ? Math.max(2.5, Math.min(4.5, style.suggestedCeilingCm / 100))
              : prev.ceilingM;
            const nextMez = style?.hasMezzanine
              ? {
                  enabled: true,
                  anchorWall: style.mezzanine?.anchorWall || ('north' as WallId),
                  heightM: Math.max(1.85, Math.min(nextCeil - 1.5, (style.mezzanine?.heightCm || 205) / 100)),
                  depthM: Math.max(1.6, Math.min(prev.depthM * 0.65, (style.mezzanine?.depthRatio || 0.52) * prev.depthM)),
                  widthRatio: Math.max(0.55, Math.min(1.0, style.mezzanine?.widthRatio || 0.78)),
                  stairGapSide: style.mezzanine?.stairGapSide || ('west' as const),
                  thicknessM: 0.16,
                  deckColorHex: style.mezzanine?.deckColorHex || style.floorTintHex || '#c9b092',
                  railingStyle: style.mezzanine?.railingStyle || ('none' as const),
                  underLed: true,
                }
              : replaceExisting
              ? undefined
              : prev.mezzanine;

            const winWall = style?.primaryWindowWall || 'west';
            const nextWindows =
              replaceExisting && style
                ? style.hasVisibleWindow === false
                  ? []
                  : [
                      {
                        id: `pin-win-${Date.now()}`,
                        wall: winWall,
                        kind: (style.hasMezzanine ? 'french' : 'triple') as WindowKind,
                        offsetCm: Math.round(
                          getWallLengthM(winWall, prev.widthM, prev.depthM) * (style.hasMezzanine ? 32 : 50)
                        ),
                        widthCm: style.hasMezzanine ? 150 : 210,
                        heightCm: Math.min(Math.round(nextCeil * 100) - 35, style.hasMezzanine ? 340 : 220),
                        sillHeightCm: style.hasMezzanine ? 25 : 40,
                        frameColorHex: '#232325',
                        hasSill: true,
                        curtainStyle: 'sheer_and_drape' as const,
                        curtainColorHex: style.curtainColorHex || '#e5dfd3',
                        curtainOpenRatio: 0.62,
                      },
                    ]
                : prev.windows.map((w) => ({
                    ...w,
                    curtainColorHex: style?.curtainColorHex || w.curtainColorHex,
                  }));

            const nextCoves =
              replaceExisting && style
                ? style.hasVisibleWindow === false
                  ? []
                  : [
                      {
                        id: `pin-cove-${winWall}-${Date.now()}`,
                        wall: winWall,
                        depthCm: 20,
                        dropCm: 16,
                        ledEnabled: true,
                        ledColorHex: '#ffddb0',
                        ledIntensity: 1.0,
                        colorHex: prev.ceilingColorHex,
                      },
                    ]
                : prev.curtainCoves;

            const keepOtherRoomObjs =
              replaceExisting && (prev.adjacentRooms?.length || 0) > 0
                ? prev.objects.filter(
                    (o) =>
                      !(
                        o.x >= -prev.widthM * 0.5 - 0.1 &&
                        o.x <= prev.widthM * 0.5 + 0.1 &&
                        o.z >= -prev.depthM * 0.5 - 0.1 &&
                        o.z <= prev.depthM * 0.5 + 0.1
                      )
                  )
                : [];

            return {
              ...prev,
              ceilingM: nextCeil,
              mezzanine: nextMez,
              ...(replaceExisting ? { wallZones: [], curtainCoves: nextCoves } : {}),
              ...(style
                ? {
                    floorMaterial: style.floorMaterial || prev.floorMaterial,
                    floorTintHex: style.floorTintHex || prev.floorTintHex,
                    walls: {
                      north: { colorHex: style.wallColorHex || prev.walls.north.colorHex, pattern: 'smooth' },
                      south: { colorHex: style.wallColorHex || prev.walls.south.colorHex, pattern: 'smooth' },
                      west: {
                        colorHex: style.accentWallColorHex || style.wallColorHex || prev.walls.west.colorHex,
                        pattern: style.hasMezzanine ? 'smooth' : style.wallPattern || 'smooth',
                      },
                      east: { colorHex: style.wallColorHex || prev.walls.east.colorHex, pattern: 'smooth' },
                    },
                    windows: nextWindows,
                    sun: {
                      ...prev.sun,
                      hour: style.suggestedSunHour ? Math.max(8, Math.min(18, style.suggestedSunHour)) : prev.sun.hour,
                    },
                  }
                : {}),
              objects: autoLinkNestedAssemblies(
                replaceExisting ? [...keepOtherRoomObjs, ...objects] : [...prev.objects, ...objects]
              ),
            };
          });
          if (replaceExisting && !isAdjTarget) {
            setTimeout(() => viewportRef.current?.resetCamera('free'), 120);
          }
          if (objects[0]) {
            setSelection({ type: 'object', id: objects[0].id });
          } else {
            setSelection(null);
          }
        }}
        onRefinePinterestScene={(nextObjects, roomFixes) => {
          setProject((prev) => {
            const nextCeil = roomFixes?.enableMezzanine && prev.ceilingM < 3.85 ? 4.1 : prev.ceilingM;
            const nextMez =
              roomFixes?.enableMezzanine === true
                ? {
                    enabled: true,
                    anchorWall: prev.mezzanine?.anchorWall || ('north' as WallId),
                    heightM: (roomFixes.mezzanineHeightCm || 205) / 100,
                    depthM: prev.mezzanine?.depthM || Math.round(prev.depthM * 52) / 100,
                    widthRatio: prev.mezzanine?.widthRatio || 0.78,
                    stairGapSide: prev.mezzanine?.stairGapSide || ('west' as const),
                    thicknessM: 0.16,
                    deckColorHex: prev.mezzanine?.deckColorHex || prev.floorTintHex || '#c9b092',
                    railingStyle: prev.mezzanine?.railingStyle || ('none' as const),
                    underLed: true,
                  }
                : roomFixes?.enableMezzanine === false
                ? undefined
                : prev.mezzanine;

            const nextWalls =
              roomFixes?.wallColorHex && /^#[0-9a-fA-F]{6}$/.test(roomFixes.wallColorHex)
                ? {
                    north: { ...prev.walls.north, colorHex: roomFixes.wallColorHex },
                    south: { ...prev.walls.south, colorHex: roomFixes.wallColorHex },
                    west: { ...prev.walls.west, colorHex: roomFixes.wallColorHex },
                    east: { ...prev.walls.east, colorHex: roomFixes.wallColorHex },
                  }
                : prev.walls;

            return {
              ...prev,
              ceilingM: nextCeil,
              mezzanine: nextMez,
              walls: nextWalls,
              floorTintHex:
                roomFixes?.floorTintHex && /^#[0-9a-fA-F]{6}$/.test(roomFixes.floorTintHex)
                  ? roomFixes.floorTintHex
                  : prev.floorTintHex,
              ...(roomFixes?.removeWindows ? { windows: [], curtainCoves: [] } : {}),
              objects: autoLinkNestedAssemblies(nextObjects),
            };
          });
        }}
        onAddGeneratedObject={(obj) => {
          setProject((prev) => {
            const existingIdx = obj.pinterestItemId
              ? prev.objects.findIndex((o) => o.pinterestItemId === obj.pinterestItemId)
              : -1;
            if (existingIdx >= 0) {
              const cur = prev.objects[existingIdx];
              const replaced: ArchPlacedObject = {
                ...obj,
                id: cur.id,
                x: cur.x,
                y: cur.y,
                z: cur.z,
                rot: cur.rot,
                widthM: cur.widthM,
                depthM: cur.depthM,
                heightM: cur.heightM,
                tintHex: cur.tintHex,
                lockedParentId: cur.lockedParentId,
                allowOverlap: cur.allowOverlap,
              };
              const next = [...prev.objects];
              next[existingIdx] = replaced;
              return { ...prev, objects: next };
            }
            return { ...prev, objects: [...prev.objects, obj] };
          });
          setSelection((curSel) => {
            const matched = obj.pinterestItemId
              ? project.objects.find((o) => o.pinterestItemId === obj.pinterestItemId)
              : undefined;
            return { type: 'object', id: matched?.id || obj.id };
          });
        }}
        onSelectObjectInRoom={(objId) => setSelection({ type: 'object', id: objId })}
        onRemoveObjectInRoom={(objId) => {
          setProject((prev) => ({ ...prev, objects: prev.objects.filter((o) => o.id !== objId) }));
          setSelection((cur) => (cur?.type === 'object' && cur.id === objId ? null : cur));
        }}
        onSaveToCatalog={handleSaveObjectToCatalog}
        onCaptureViewport={() => viewportRef.current?.captureSnapshot(true) || null}
        onToast={showToast}
      />
    </div>
  );

  return (
    <div className="arch-studio-root fixed inset-0 h-[100dvh] bg-[#e8e5de] text-stone-950 flex flex-col overflow-hidden">
      {/* Ultra-Clean Single-Row Top Header (Responsive: Phone, iPad, Desktop, 4K TV) */}
      {!tvPresentationMode && (
        <header className="min-h-14 px-2.5 sm:px-4 pt-[env(safe-area-inset-top)] bg-white border-b border-stone-200 flex items-center justify-between gap-2 sm:gap-3 shrink-0 z-30">
          {/* Brand + Live Room Size */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              className="lg:hidden p-2 border border-stone-300 text-stone-800 shrink-0"
              aria-label="Menü"
            >
              {mobileSidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setDesktopLeftOpen((v) => !v)}
              className="hidden lg:inline-flex p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 shrink-0 transition"
              title={desktopLeftOpen ? 'Sol Paneli Gizle (Geniş 3B Alan)' : 'Sol Paneli Aç'}
              aria-label={desktopLeftOpen ? 'Sol Paneli Gizle' : 'Sol Paneli Aç'}
            >
              {desktopLeftOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
            <div>
              <p className="font-display text-sm 2xl:text-base font-extrabold tracking-tight text-stone-950 whitespace-nowrap leading-none">
                MekanAR <span className="font-normal text-stone-500 hidden xs:inline sm:inline">Mimari</span>
              </p>
              <p className="text-[10px] font-mono text-stone-500 whitespace-nowrap mt-0.5">
                {totalRoomCount > 1
                  ? `${totalRoomCount} Oda · ${Math.round(houseBounds.totalAreaM2)} m² · ${solar.formattedTime}`
                  : `${project.widthM.toFixed(1)}×${project.depthM.toFixed(1)} m · ${solar.formattedTime} (${bearingToShortCode(project.sun.northAngleDeg)})`}
              </p>
            </div>

            {/* Active Customer Project Switcher Button */}
            <button
              type="button"
              onClick={() => setClientModalOpen(true)}
              className={`ml-1 px-2.5 py-1.5 border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition max-w-[165px] sm:max-w-[215px] ${
                activeClient
                  ? 'border-stone-950 bg-stone-950 text-white hover:bg-stone-800'
                  : 'border-stone-300 bg-[#faf9f6] text-stone-900 hover:border-stone-950'
              }`}
              title={
                activeClient
                  ? `Aktif Müşteri: ${activeClient.clientName} (${activeClient.roomTitle}) — Değiştirmek için tıklayın`
                  : 'Müşteri odası seçin veya yeni müşteri oluşturun'
              }
            >
              {activeClient ? <User className="w-3.5 h-3.5 shrink-0" /> : <Users className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">
                {activeClient ? activeClient.clientName : `Müşteriler${clientProjects.length > 0 ? ` (${clientProjects.length})` : ''}`}
              </span>
              {activeClient && autoSaveState === 'saved' && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Otomatik kaydedildi" />
              )}
            </button>
          </div>

          {/* Center: Universal Smart Search Bar (Colors, codes, nearest shades, 3D furniture, windows, doors, 3+1 rooms!) */}
          <div className="relative flex-1 min-w-0 max-w-2xl hidden lg:block">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (parsedQuick && !quickQuery.trim().startsWith('#') && universalSearch.results[0]?.group !== 'material') {
                  executeQuickAdd();
                } else if (universalSearch.results[0]) {
                  executeUniversalResult(universalSearch.results[0]);
                } else {
                  executeQuickAdd();
                }
              }}
              className="flex items-center border border-stone-300 focus-within:border-stone-950 bg-[#faf9f6] transition"
            >
              <Search className="w-3.5 h-3.5 text-stone-500 ml-2.5 shrink-0" />
              <input
                type="text"
                value={quickQuery}
                onFocus={() => setQuickFocused(true)}
                onBlur={() => setTimeout(() => setQuickFocused(false), 220)}
                onChange={(e) => setQuickQuery(e.target.value)}
                placeholder='Her şeyi ara: renk/kod ("kaşmir", "PRK901", "10678", "#3f4247"), eşya ("klozet", "koltuk"), pencere, 3+1...'
                className="flex-1 min-w-0 px-2 py-1.5 bg-transparent text-xs text-stone-950 placeholder:text-stone-400 focus:outline-none"
              />
              {quickQuery && (
                <button
                  type="button"
                  onClick={() => setQuickQuery('')}
                  className="p-1 text-stone-400 hover:text-stone-900"
                  aria-label="Temizle"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                className="px-3 py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-semibold whitespace-nowrap shrink-0 flex items-center gap-1"
              >
                <Search className="w-3 h-3" />
                <span>Bul &amp; Ekle</span>
              </button>
            </form>

            {quickFocused && (
              <div
                onMouseDown={(e) => e.preventDefault()}
                className="absolute left-0 right-0 top-full mt-1 bg-white border border-stone-300 shadow-2xl p-2.5 z-50 text-xs space-y-2 max-h-[70vh] flex flex-col"
              >
                {/* Category Filter Tabs inside Universal Search */}
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-stone-200 shrink-0">
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { id: 'all', lbl: 'Tümü' },
                        { id: 'material', lbl: 'Renk & Malzeme' },
                        { id: 'furniture', lbl: 'Eşya & 3B' },
                        { id: 'opening', lbl: 'Pencere & Kapı' },
                        { id: 'room', lbl: 'Oda & 3+1 Ev' },
                      ] as const
                    ).map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setSearchFilterGroup(g.id)}
                        className={`px-2 py-0.5 border text-[10px] font-semibold transition ${
                          searchFilterGroup === g.id
                            ? 'border-stone-950 bg-stone-950 text-white'
                            : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-500'
                        }`}
                      >
                        {g.lbl}
                      </button>
                    ))}
                  </div>
                  {universalSearch.detectedColor && (
                    <div className="flex items-center gap-1.5 text-[10px] text-stone-700 shrink-0">
                      <span
                        className="w-3.5 h-3.5 border border-black/25"
                        style={{ backgroundColor: universalSearch.detectedColor.hex }}
                      />
                      <span className="font-semibold">{universalSearch.detectedColor.label}</span>
                    </div>
                  )}
                </div>

                {/* Custom cm sizing strip when user types explicit parametric item like "televizyon 180x100" */}
                {parsedQuick && (parsedQuick.kind === 'parametric' || parsedQuick.kind === 'wallZone') && (
                  <div className="bg-[#faf9f6] border border-stone-200 p-2 flex flex-wrap items-center gap-2 shrink-0">
                    <span className="font-semibold text-stone-950 text-[11px]">
                      Özel Ölçüyle Hemen Ekle: {parsedQuick.kind === 'parametric' ? parsedQuick.name : 'Duvar Paneli'}
                    </span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        En
                        <input
                          type="number"
                          value={quickW}
                          onChange={(e) => setQuickW(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-12 px-1 py-0.5 border border-stone-300 font-mono text-stone-950 bg-white"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        Der.
                        <input
                          type="number"
                          value={quickD}
                          onChange={(e) => setQuickD(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-12 px-1 py-0.5 border border-stone-300 font-mono text-stone-950 bg-white"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-stone-600">
                        Yük.
                        <input
                          type="number"
                          value={quickH}
                          onChange={(e) => setQuickH(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="w-12 px-1 py-0.5 border border-stone-300 font-mono text-stone-950 bg-white"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => executeQuickAdd()}
                        className="px-2.5 py-1 bg-stone-950 text-white text-[10px] font-semibold"
                      >
                        + Ekle
                      </button>
                    </div>
                  </div>
                )}

                {/* Search Results List OR Quick Suggestions when empty */}
                {quickQuery.trim() ? (
                  universalSearch.results.length > 0 ? (
                    <div className="overflow-y-auto space-y-1 pr-0.5">
                      {universalSearch.results.map((res) => (
                        <button
                          key={res.id}
                          type="button"
                          onClick={() => executeUniversalResult(res)}
                          className="w-full px-2 py-1.5 border border-stone-200 hover:border-stone-950 hover:bg-[#faf9f6] flex items-center gap-2.5 text-left transition"
                        >
                          {'hex' in res && res.hex ? (
                            <span
                              className="w-7 h-7 border border-black/20 shrink-0"
                              style={{ backgroundColor: res.hex }}
                            />
                          ) : 'thumbUrl' in res && res.thumbUrl ? (
                            <img
                              src={res.thumbUrl}
                              alt={res.title}
                              className="w-7 h-7 object-contain bg-[#f5f4f0] border border-stone-200 shrink-0"
                            />
                          ) : (
                            <span className="w-7 h-7 bg-stone-950 text-white font-mono text-[9px] font-bold flex items-center justify-center shrink-0">
                              {res.badge.slice(0, 3).toUpperCase()}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-stone-950 truncate">{res.title}</span>
                              {'similarityPct' in res && res.similarityPct && (
                                <span className="text-[9px] font-mono font-bold px-1 bg-stone-200 text-stone-800 shrink-0">
                                  %{res.similarityPct} yakın
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-stone-500 truncate">{res.subtitle}</p>
                          </div>
                          <span className="px-2 py-1 border border-stone-300 bg-white text-[10px] font-semibold text-stone-900 whitespace-nowrap shrink-0">
                            {res.subKind === 'parquet'
                              ? 'Zemine'
                              : res.subKind === 'wall'
                              ? res.item.isProfile
                                ? 'Duvar Profili'
                                : 'Duvarlara'
                              : res.subKind === 'skirting'
                              ? 'Süpürgelik'
                              : res.subKind === 'doorPanel'
                              ? 'Kapıya'
                              : res.subKind === 'countertop'
                              ? 'Tezgah Kur'
                              : res.subKind === 'furniturePanel'
                              ? 'Mobilyaya'
                              : '+ Ekle'}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-stone-500 py-3 text-center">
                      Eşleşme bulunamadı — renk adı (örn. <strong>kaşmir</strong>, <strong>adaçayı</strong>), kod (<strong>PRK901</strong>, <strong>10678</strong>), eşya (<strong>klozet</strong>, <strong>koltuk</strong>) veya pencere yazabilirsiniz.
                    </p>
                  )
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] font-mono uppercase text-stone-500">
                      Örnek Aramalar (Renk, Kod, Eşya, Pencere veya 3+1 Ev)
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        'kaşmir',
                        'adaçayı yeşili',
                        'PRK901',
                        '10678 Space',
                        'LB-2050',
                        'oval pencere',
                        'klozet',
                        'laminat tezgah',
                        '3+1 daire',
                        ...QUICK_ADD_SUGGESTIONS.slice(0, 6),
                      ].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setQuickQuery(s)}
                          className="px-2 py-1 border border-stone-200 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-[#faf9f6] text-[11px] font-medium transition"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: 3 Camera Modes + TV Showroom Mode + Save/Export */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Phone & Portrait Tablet Quick-Add Search Toggle */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen((v) => !v)}
              className={`lg:hidden p-2 border shrink-0 ${
                mobileSearchOpen ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-300 bg-[#faf9f6] text-stone-800'
              }`}
              aria-label="Hızlı Ekle"
            >
              <Search className="w-4 h-4" />
            </button>

            <div className="hidden md:flex items-center border border-stone-200 bg-[#faf9f6]">
              {(
                [
                  { id: 'free', label: '3B', icon: Layers },
                  { id: 'plan', label: '2D Plan', icon: Grid3X3 },
                  { id: 'inside', label: 'Kapıdan Gez', icon: Footprints },
                ] as const
              ).map((c) => {
                const Icon = c.icon;
                const active = cameraMode === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => (c.id === 'inside' ? enterDoorWalkthrough() : setCameraMode(c.id))}
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
              onClick={toggleTvPresentationMode}
              className="p-2 sm:px-2.5 sm:py-1.5 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
              title="Tam Ekran TV / Showroom Sunum Modu"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">TV Sunum</span>
            </button>

            <button
              type="button"
              onClick={handleSaveProjectJson}
              className="hidden sm:inline-flex p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 shrink-0"
              title="Projeyi Kaydet (.json)"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <label
              className="hidden sm:inline-flex p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-800 cursor-pointer shrink-0"
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
      )}

      {/* Phone & Portrait Tablet Full-Width Universal Smart Search Drop Strip (< 1024px) */}
      {!tvPresentationMode && mobileSearchOpen && (
        <div className="lg:hidden bg-white border-b border-stone-200 px-3 py-2.5 space-y-2 z-30 shrink-0 max-h-[65dvh] flex flex-col">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (universalSearch.results[0]) executeUniversalResult(universalSearch.results[0]);
              else executeQuickAdd();
              setMobileSearchOpen(false);
            }}
            className="flex items-center border border-stone-300 focus-within:border-stone-950 bg-[#faf9f6] shrink-0"
          >
            <Search className="w-3.5 h-3.5 text-stone-500 ml-2.5 shrink-0" />
            <input
              type="text"
              autoFocus
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder='Renk/kod ("kaşmir", "PRK901"), eşya ("klozet"), pencere, 3+1...'
              className="flex-1 min-w-0 px-2 py-2 bg-transparent text-xs focus:outline-none"
            />
            {quickQuery && (
              <button type="button" onClick={() => setQuickQuery('')} className="p-1.5 text-stone-400">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button type="submit" className="px-3 py-2 bg-stone-950 text-white text-xs font-semibold whitespace-nowrap">
              Bul &amp; Ekle
            </button>
          </form>

          {quickQuery.trim() ? (
            <div className="overflow-y-auto space-y-1 pr-0.5">
              {universalSearch.results.slice(0, 10).map((res) => (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => executeUniversalResult(res)}
                  className="w-full px-2 py-1.5 border border-stone-200 bg-[#faf9f6] flex items-center gap-2 text-left"
                >
                  {'hex' in res && res.hex ? (
                    <span className="w-6 h-6 border border-black/20 shrink-0" style={{ backgroundColor: res.hex }} />
                  ) : (
                    <span className="w-6 h-6 bg-stone-950 text-white font-mono text-[9px] font-bold flex items-center justify-center shrink-0">
                      {res.badge.slice(0, 3).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-stone-950 text-xs truncate">{res.title}</span>
                      {'similarityPct' in res && res.similarityPct && (
                        <span className="text-[9px] font-mono font-bold px-1 bg-stone-200 text-stone-800 shrink-0">
                          %{res.similarityPct}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-stone-500 truncate">{res.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-1 overflow-x-auto pb-0.5 shrink-0">
              {['kaşmir', 'PRK901', '10678', 'klozet', 'oval pencere', '3+1 daire', ...QUICK_ADD_SUGGESTIONS.slice(0, 4)].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuickQuery(s)}
                  className="px-2 py-1 border border-stone-200 bg-[#faf9f6] text-[11px] font-medium whitespace-nowrap shrink-0"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main 3-Zone Workspace: Responsive for Phone, iPad, Laptop, Desktop & 4K TV */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {/* Tap-outside backdrop for mobile/tablet drawer */}
        {!tvPresentationMode && mobileSidebarOpen && (
          <div
            onClick={() => setMobileSidebarOpen(false)}
            className="fixed inset-0 top-14 bg-black/40 z-20 lg:hidden"
          />
        )}

        {/* Left Collapsible 5-Tab Panel: Always stays mounted on desktop/tablet when toggled via CSS so Pinterest state is NEVER lost! */}
        {!tvPresentationMode && (
          <aside
            className={`${
              mobileSidebarOpen
                ? 'fixed inset-y-14 left-0 z-30 flex'
                : desktopLeftOpen
                ? 'hidden lg:flex'
                : 'hidden'
            } w-[88vw] max-w-[330px] lg:w-[292px] xl:w-[324px] 2xl:w-[360px] bg-white border-r border-stone-200 flex-col shrink-0 shadow-2xl lg:shadow-none pb-[env(safe-area-inset-bottom)]`}
          >
            <nav className="grid grid-cols-5 border-b border-stone-200 bg-[#faf9f6] shrink-0">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.title}
                    onClick={() => setActiveTab(t.id)}
                    className={`py-2.5 px-1 flex flex-col items-center justify-center gap-1 border-b-2 text-[10px] 2xl:text-[11px] font-semibold transition whitespace-nowrap ${
                      active ? 'border-stone-950 bg-white text-stone-950' : 'border-transparent text-stone-500 hover:text-stone-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {renderLeftSidebar()}
              {renderPersistentPinterestPanel()}
            </div>
          </aside>
        )}

        {/* Center Full-Bleed Multi-Touch & Tablet/4K TV-Safe 3D Viewport */}
        <main className="flex-1 min-w-0 relative overflow-hidden">
          {/* Desktop & Landscape Tablet Edge Collapse/Expand Handles (Item #4) */}
          {!tvPresentationMode && (
            <button
              type="button"
              onClick={() => setDesktopLeftOpen((v) => !v)}
              className="hidden lg:flex items-center gap-1 absolute top-1/2 -translate-y-1/2 left-0 z-20 px-1.5 py-3 bg-white/95 hover:bg-stone-950 text-stone-800 hover:text-white border border-l-0 border-stone-300 shadow-md transition"
              title={desktopLeftOpen ? 'Sol Paneli Gizle' : 'Sol Paneli Aç'}
              aria-label={desktopLeftOpen ? 'Sol Paneli Gizle' : 'Sol Paneli Aç'}
            >
              {desktopLeftOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
            </button>
          )}
          {!tvPresentationMode && selection && (
            <button
              type="button"
              onClick={() => setRightPanelOpen((v) => !v)}
              className="hidden lg:flex items-center gap-1 absolute top-1/2 -translate-y-1/2 right-0 z-20 px-1.5 py-3 bg-white/95 hover:bg-stone-950 text-stone-800 hover:text-white border border-r-0 border-stone-300 shadow-md transition"
              title={rightPanelOpen ? 'Sağ Özellikler Panelini Gizle' : 'Sağ Özellikler Panelini Aç'}
              aria-label={rightPanelOpen ? 'Sağ Paneli Gizle' : 'Sağ Paneli Aç'}
            >
              {rightPanelOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            </button>
          )}
          <ArchViewport3D
            ref={viewportRef}
            project={project}
            cameraMode={cameraMode}
            dragAxis={dragAxis}
            showGrid={showGrid && !tvPresentationMode}
            showSunOrb={showSunOrb && !tvPresentationMode}
            showDoorArcs={showDoorArcs && !tvPresentationMode}
            autoRotate={autoRotate360}
            selection={tvPresentationMode ? null : selection}
            onSelect={(sel) => {
              if (!tvPresentationMode) {
                setSelection(sel);
                if (sel) setRightPanelOpen(true);
                if (sel?.type !== 'object') setDragAxis('xz');
              }
            }}
            onMoveObject={(id, x, z, y) =>
              setProject((prev) => ({
                ...prev,
                objects: prev.objects.map((o) =>
                  o.id === id ? { ...o, x, z, ...(typeof y === 'number' ? { y } : {}) } : o
                ),
              }))
            }
            onMoveObjectsBatch={(updates) =>
              setProject((prev) => {
                const map = new Map(updates.map((u) => [u.id, u]));
                return {
                  ...prev,
                  objects: prev.objects.map((o) => {
                    const u = map.get(o.id);
                    return u ? { ...o, x: u.x, z: u.z, ...(typeof u.y === 'number' ? { y: u.y } : {}) } : o;
                  }),
                };
              })
            }
            onExitWalkthrough={() => setCameraMode('free')}
            onWarningsChange={setWarnings}
            onLoadingChange={setLoadingCount}
            onToast={showToast}
          />

          {/* Mobile Camera Switcher */}
          {!tvPresentationMode && (
            <div className="md:hidden absolute top-3 left-3 flex items-center gap-1 bg-white/95 border border-stone-300 p-1 shadow-sm">
              {(
                [
                  { id: 'free', label: '3B' },
                  { id: 'plan', label: '2D' },
                  { id: 'inside', label: 'Gez' },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => (c.id === 'inside' ? enterDoorWalkthrough() : setCameraMode(c.id))}
                  className={`px-2.5 py-1.5 text-[11px] font-bold ${cameraMode === c.id ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {loadingCount > 0 && (
            <div className="absolute top-3 left-3 hidden md:flex items-center gap-2 bg-white/95 border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-800 shadow-sm pointer-events-none">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>3B modeller yükleniyor...</span>
            </div>
          )}

          {warnings.length > 0 && !tvPresentationMode && (
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
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-stone-950 text-white px-4 py-2 text-xs font-medium shadow-lg pointer-events-none max-w-[90vw] truncate z-40">
              {toastMsg}
            </div>
          )}

          {/* TV / Showroom Full-Screen Presentation Floating Remote Bar */}
          {tvPresentationMode && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-white/95 border border-stone-300 shadow-2xl px-3 py-2 flex flex-wrap items-center justify-center gap-2 text-xs z-40 max-w-[95vw]">
              <span className="font-display font-bold text-stone-950 px-1.5 hidden sm:inline">
                MekanAR · {project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m
              </span>
              <span className="h-4 w-px bg-stone-300 hidden sm:inline-block" />
              <button
                type="button"
                onClick={() => setCameraMode('free')}
                className={`px-3 py-1.5 font-semibold border ${cameraMode === 'free' ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'}`}
              >
                3B
              </button>
              <button
                type="button"
                onClick={() => {
                  setAutoRotate360(false);
                  setCameraMode('plan');
                }}
                className={`px-3 py-1.5 font-semibold border ${cameraMode === 'plan' ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'}`}
              >
                2D Plan
              </button>
              <button
                type="button"
                onClick={enterDoorWalkthrough}
                className={`px-3 py-1.5 font-semibold border ${cameraMode === 'inside' ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white'}`}
              >
                Kapıdan Gez
              </button>
              <button
                type="button"
                onClick={() => {
                  setCameraMode('free');
                  setAutoRotate360((v) => !v);
                }}
                className={`px-3 py-1.5 font-semibold border flex items-center gap-1 ${autoRotate360 ? 'border-amber-600 bg-amber-600 text-white' : 'border-stone-200 bg-white'}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${autoRotate360 ? 'animate-spin' : ''}`} />
                <span>360° Tur</span>
              </button>
              <button
                type="button"
                onClick={() => setSunPlaying((v) => !v)}
                className={`px-3 py-1.5 font-semibold border flex items-center gap-1 ${sunPlaying ? 'border-amber-600 bg-amber-600 text-white' : 'border-stone-200 bg-white'}`}
              >
                {sunPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>Güneş</span>
              </button>
              <button
                type="button"
                onClick={toggleTvPresentationMode}
                className="px-3 py-1.5 bg-stone-950 text-white font-semibold flex items-center gap-1"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Çık</span>
              </button>
            </div>
          )}

          {/* First-Person Walkthrough Controls HUD (Touch/iPad/TV-Remote + Keyboard Friendly!) */}
          {!tvPresentationMode && cameraMode === 'inside' ? (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/95 border border-stone-300 shadow-lg px-2.5 sm:px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-center gap-2 text-xs max-w-[96vw]">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => viewportRef.current?.turnLook(22)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="Sola Bak"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => viewportRef.current?.walkStep(0, -0.45)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="Sola Adım (A)"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => viewportRef.current?.walkStep(0.55, 0)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="İleri Yürü (W / Tekerlek)"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => viewportRef.current?.walkStep(-0.55, 0)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="Geri Adım (S)"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => viewportRef.current?.walkStep(0, 0.45)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="Sağa Adım (D)"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => viewportRef.current?.turnLook(-22)}
                  className="p-2 border border-stone-300 hover:border-stone-950 bg-[#faf9f6]"
                  title="Sağa Bak"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <span className="text-[11px] text-stone-600 hidden lg:inline whitespace-nowrap">
                Boş alan sürükle: Bak · Ürüne tıkla/sürükle: Taşı &amp; Düzenle · <strong className="font-mono text-stone-900">WASD</strong>: Yürü
              </span>
              <button
                type="button"
                onClick={() => viewportRef.current?.enterFromDoor()}
                className="px-2.5 py-1.5 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
              >
                <DoorOpen className="w-3.5 h-3.5" />
                <span>Kapıdan Gir</span>
              </button>
              <button
                type="button"
                onClick={() => setCameraMode('free')}
                className="px-2.5 py-1.5 bg-stone-950 text-white text-[11px] font-semibold whitespace-nowrap"
              >
                3B
              </button>
            </div>
          ) : (
            !tvPresentationMode &&
            !selection && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/92 border border-stone-200 px-3.5 py-1.5 text-[11px] text-stone-700 shadow-sm pointer-events-none whitespace-nowrap hidden sm:block">
                Düzenlemek için odada herhangi bir duvara, zemine, pencereye, kapıya veya eşyaya tıklayın
              </div>
            )
          )}
        </main>

        {/* Right Contextual Inspector: Collapsible Side Panel on Desktop/Landscape Tablet; Clean Bottom Sheet on Phone/Portrait Tablet! */}
        {!tvPresentationMode && selection && rightPanelOpen && (
          <aside className="fixed inset-x-0 bottom-0 max-h-[48dvh] border-t-2 border-stone-950 shadow-2xl pb-[env(safe-area-inset-bottom)] lg:static lg:inset-auto lg:max-h-none lg:border-t-0 lg:border-l lg:border-stone-200 lg:shadow-none lg:pb-0 lg:w-[276px] xl:w-[306px] 2xl:w-[348px] bg-white shrink-0 flex flex-col z-30">
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
              onNudgeObject={(objId, fwdM, rightM) => viewportRef.current?.nudgeObjectRelative(objId, fwdM, rightM)}
              onNudgeObjectVertical={(objId, deltaYM) => viewportRef.current?.nudgeObjectVertical(objId, deltaYM)}
              onSetObjectElevation={(objId, targetYM) => viewportRef.current?.setObjectElevation(objId, targetYM)}
              onSnapObjectToSurface={(objId) => viewportRef.current?.snapObjectToSurface(objId)}
              dragAxis={dragAxis}
              onDragAxisChange={setDragAxis}
              onMoveOpeningToWall={moveOpeningToWall}
              onDuplicateObject={duplicateObject}
              onAttachRoom={(parentRoomId, side, roomKind) =>
                handleAttachAdjacentRoom({ parentRoomId, side, roomKind, autoFurnish: true })
              }
              onSaveToCatalog={handleSaveObjectToCatalog}
              onToast={showToast}
            />
          </aside>
        )}
      </div>

      {/* Customer Project Picker & Auto-Save Manager Modal */}
      <ClientProjectModal
        open={clientModalOpen}
        clients={clientProjects}
        activeClientId={activeClientId}
        hasUnsavedWork={!activeClientId && (project.objects.length > 0 || (project.adjacentRooms?.length || 0) > 0)}
        onClose={() => setClientModalOpen(false)}
        onSelectClient={handleSelectClient}
        onCreateClient={handleCreateClient}
        onRenameClient={handleRenameClient}
        onDuplicateClient={handleDuplicateClient}
        onDeleteClient={handleDeleteClient}
      />
    </div>
  );
};

export default ArchitecturalStudioPage;
