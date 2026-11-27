import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Crop,
  Download,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Loader2,
  MousePointerClick,
  Palette,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { findOpenSpawnPosition, type OBB2D } from '../lib/collision2d';
import { normalizeRoomPhoto } from '../lib/roomRendering';
import { generateFurniture3DServerless, fetchProduct3DConfig } from '../lib/product3dClient';
import { getMembershipState } from '../lib/membership';
import { NumericInput } from './NumericInput';
import {
  analyzePinterestRoom,
  cropBoxFromDataUrl,
  cropRawTightDataUrl,
  fetchPinterestConfig,
  generatePhotorealRender,
  getSavedGeminiKey,
  identifyCroppedPinterestObject,
  isGeminiQuotaZeroError,
  isValidHexColor,
  isolatePinterestObject,
  resolvePinterestArchetype,
  sampleDominantHexFromDataUrl,
  saveGeminiKey,
  verifyAndRefinePinterestRoom,
  type PinterestDetectedObject,
  type PinterestRoomStyle,
  type PinterestServerConfig,
} from './pinterestClient';
import {
  applyArchitecturalRelationships,
  applyVisualCritiqueFixes,
  resolveMezzaninePlan,
  type VisualRefineRoomFix,
} from './layoutSolver';
import {
  WALL_LABELS,
  getMezzanineBounds,
  type ArchMezzanine,
  type ArchPlacedObject,
  type ArchRoomProject,
  type FloorMaterialKind,
  type MezzanineBounds,
  type ParametricFurnitureKind,
  type WallId,
  type WallPattern,
} from './types';

export interface PinterestMaterialEntry {
  id: string;
  sourcePhotoId: string;
  sourceLabel: string;
  kind: 'wall' | 'accentWall' | 'floor' | 'curtain';
  label: string;
  colorHex: string;
  wallPattern?: WallPattern;
  floorMaterial?: FloorMaterialKind;
}

interface PinterestSourcePhoto {
  id: string;
  index: number;
  dataUrl: string;
  style: PinterestRoomStyle | null;
  analyzed: boolean;
}

type PoolDetectedItem = PinterestDetectedObject & {
  sourcePhotoId?: string;
  sourcePhotoIndex?: number;
};

const FLOOR_LABELS_TR: Record<FloorMaterialKind, string> = {
  herringbone_oak: 'Balıksırtı Meşe',
  plank_oak: 'Doğal Meşe Parke',
  plank_walnut: 'Ceviz Parke',
  travertine: 'Traverten Taş',
  marble: 'Doğal Mermer',
  microcement: 'Mikrosement',
  terrazzo: 'Terrazzo',
};

const WALL_PATTERN_LABELS_TR: Record<WallPattern, string> = {
  smooth: 'Düz Mat Boya',
  slats: 'Ahşap Çıta Panel',
  boiserie: 'Çerçeve / Boiserie',
  marble: 'Mermer Kaplama',
  concrete: 'Brüt Beton',
  stone: 'Doğal Taş',
  wallpaper: 'Duvar Kağıdı',
  mirror: 'Dekoratif Ayna',
};

function buildMaterialEntriesFromStyle(
  photoId: string,
  sourceLabel: string,
  style: PinterestRoomStyle
): PinterestMaterialEntry[] {
  const entries: PinterestMaterialEntry[] = [];
  if (isValidHexColor(style.wallColorHex)) {
    entries.push({
      id: `${photoId}-mat-wall`,
      sourcePhotoId: photoId,
      sourceLabel,
      kind: 'wall',
      label: `Duvar Boyası (${style.styleNameTr})`,
      colorHex: style.wallColorHex,
      wallPattern: 'smooth',
    });
  }
  if (isValidHexColor(style.accentWallColorHex) || (style.wallPattern && style.wallPattern !== 'smooth')) {
    const pat = style.wallPattern || 'slats';
    entries.push({
      id: `${photoId}-mat-accent`,
      sourcePhotoId: photoId,
      sourceLabel,
      kind: 'accentWall',
      label: `Vurgu Duvar · ${WALL_PATTERN_LABELS_TR[pat] || 'Panel'}`,
      colorHex: isValidHexColor(style.accentWallColorHex) ? style.accentWallColorHex : style.wallColorHex || '#b9936c',
      wallPattern: pat,
    });
  }
  if (isValidHexColor(style.floorTintHex) || style.floorMaterial) {
    const fm = style.floorMaterial || 'herringbone_oak';
    entries.push({
      id: `${photoId}-mat-floor`,
      sourcePhotoId: photoId,
      sourceLabel,
      kind: 'floor',
      label: `Zemin · ${FLOOR_LABELS_TR[fm] || 'Parke'}`,
      colorHex: isValidHexColor(style.floorTintHex) ? style.floorTintHex : '#c5a57d',
      floorMaterial: fm,
    });
  }
  if (isValidHexColor(style.curtainColorHex)) {
    entries.push({
      id: `${photoId}-mat-curtain`,
      sourcePhotoId: photoId,
      sourceLabel,
      kind: 'curtain',
      label: 'Perde Kumaşı',
      colorHex: style.curtainColorHex,
    });
  }
  return entries;
}

interface Props {
  project: ArchRoomProject;
  activeTargetRoomId?: string;
  onApplySingleMaterial?: (mat: PinterestMaterialEntry, targetRoomId?: string) => void;
  onApplyRoomStyle: (style: PinterestRoomStyle, targetRoomId?: string) => void;
  onApplyPinterestScene: (
    objects: ArchPlacedObject[],
    style: PinterestRoomStyle | null,
    replaceExisting: boolean,
    targetRoomId?: string
  ) => void;
  onRefinePinterestScene?: (
    objects: ArchPlacedObject[],
    roomFixes: VisualRefineRoomFix | null,
    targetRoomId?: string
  ) => void;
  onAddGeneratedObject: (obj: ArchPlacedObject) => void;
  onSelectObjectInRoom: (objId: string) => void;
  onRemoveObjectInRoom: (objId: string) => void;
  onSaveToCatalog?: (obj: ArchPlacedObject, thumbDataUrl?: string) => Promise<boolean>;
  onCaptureViewport: () => string | null;
  onOpenRenderStudio?: (opts?: {
    roomId?: string;
    angle?: 'current' | 'corner' | 'eye';
    referencePhoto?: { id: string; label: string; dataUrl: string };
    autoStart?: boolean;
  }) => void;
  onToast: (msg: string) => void;
}

const FOCUS_PROMPT_PRESETS: Array<{ label: string; prompt: string }> = [
  { label: 'Tüm Oda', prompt: '' },
  {
    label: 'Sadece Ana Mobilyalar',
    prompt:
      'Sadece ana mobilyaları (koltuk, sehpa, masa, dolap, gardırop, yatak, TV ünitesi) modelle; çiçek, vazo, çerçeve, tablo, küçük lamba ve halı gibi aksesuarları kesinlikle modelleme.',
  },
  {
    label: 'Sadece Masa / Sehpa',
    prompt:
      'Fotoğraftaki sadece ana sehpa veya masayı modelle; üstündeki çiçek, vazo, lamba, çerçeve ve altındaki halıyı kesinlikle alma.',
  },
  {
    label: 'Sadece Dolap / Ünite',
    prompt:
      'Sadece dolap, gardırop, kitaplık veya TV ünitesini modelle; etraftaki küçük dekorları, bitkileri, tabloları ve halıyı alma.',
  },
];

interface ItemJobState {
  selected: boolean;
  status: 'idle' | 'isolating' | 'modeling' | 'done' | 'error';
  cropPreviewUrl?: string;
  rawCropUrl?: string;
  studioPreviewUrl?: string;
  usedDirectCrop?: boolean;
  progressText?: string;
  errorMsg?: string;
}

interface DraftBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const BOX_COLORS = [
  '#0f172a',
  '#b45309',
  '#0369a1',
  '#15803d',
  '#7c2d12',
  '#4f46e5',
  '#be123c',
  '#0f766e',
  '#6d28d9',
  '#c2410c',
];

const DEFAULT_COLORS_BY_ARCHETYPE: Partial<Record<ParametricFurnitureKind, { c1: string; c2: string }>> = {
  sofa: { c1: '#c8bfb1', c2: '#5d534a' },
  armchair: { c1: '#495a46', c2: '#e4ddd0' },
  coffee_table_round: { c1: '#232325', c2: '#1a1a1c' },
  coffee_table_rect: { c1: '#b99672', c2: '#252527' },
  dining_table: { c1: '#8b684c', c2: '#262524' },
  dining_chair: { c1: '#cfc5b6', c2: '#2d2b29' },
  desk: { c1: '#c5a27a', c2: '#4d5748' },
  office_chair: { c1: '#a25d32', c2: '#222224' },
  vanity_table: { c1: '#53614d', c2: '#3c4638' },
  bed_frame: { c1: '#4c5942', c2: '#ece7dd' },
  nightstand: { c1: '#232325', c2: '#9a7e56' },
  wardrobe: { c1: '#e6e1d7', c2: '#282726' },
  bookshelf: { c1: '#252527', c2: '#b8946e' },
  sideboard: { c1: '#56614d', c2: '#2b2b2b' },
  console_table: { c1: '#7d5d42', c2: '#262626' },
  tv_baza: { c1: '#e6e2da', c2: '#232325' },
  tv_wall_unit: { c1: '#b9936c', c2: '#222224' },
  wall_tv: { c1: '#141518', c2: '#090a0d' },
  wall_shelf: { c1: '#7c5538', c2: '#252423' },
  linear_fireplace: { c1: '#e8e4dc', c2: '#1f1f21' },
  fireplace_marble: { c1: '#eae6de', c2: '#232220' },
  decorative_vase: { c1: '#e6e0d5', c2: '#4d6647' },
  potted_plant: { c1: '#4b6343', c2: '#373532' },
  chandelier: { c1: '#c4a265', c2: '#ffefc8' },
  floor_lamp: { c1: '#232325', c2: '#f3e8d4' },
  table_lamp: { c1: '#202022', c2: '#fff2d6' },
  rug_custom: { c1: '#ddd4c4', c2: '#2b2a28' },
  wall_mirror: { c1: '#222224', c2: '#dbe4ed' },
  wall_art: { c1: '#222224', c2: '#ece8df' },
  ottoman: { c1: '#ddd5c7', c2: '#4a453e' },
  stairs: { c1: '#c3a27a', c2: '#242426' },
  ac_unit: { c1: '#f4f3ef', c2: '#2b2b2b' },
};

interface WallSlot {
  along: number;
  halfW: number;
  y0: number;
  y1: number;
}

const WALL_BACKED_KINDS = new Set<ParametricFurnitureKind>([
  'wall_art',
  'wall_mirror',
  'wall_tv',
  'wall_shelf',
  'fireplace_marble',
  'linear_fireplace',
  'tv_wall_unit',
  'tv_baza',
  'wardrobe',
  'bookshelf',
  'sideboard',
  'console_table',
  'vanity_table',
  'ac_unit',
]);

/** Floor furniture that snaps flush to its wall whenever AI assigns a specific wall (never left floating sideways!) */
const WALL_ANCHORABLE_FLOOR_KINDS = new Set<ParametricFurnitureKind>([
  'bed_frame',
  'sofa',
  'desk',
  'nightstand',
]);

export const PinterestAIPanel: React.FC<Props> = ({
  project,
  activeTargetRoomId,
  onApplySingleMaterial,
  onApplyRoomStyle,
  onApplyPinterestScene,
  onRefinePinterestScene,
  onAddGeneratedObject,
  onSelectObjectInRoom,
  onRemoveObjectInRoom,
  onSaveToCatalog,
  onCaptureViewport,
  onOpenRenderStudio,
  onToast,
}) => {
  const [serverCfg, setServerCfg] = useState<PinterestServerConfig>({
    geminiConfigured: false,
    runpodConfigured: false,
    visionModel: 'gemini-3.8-flash',
    imageModel: 'gemini-3.1-flash-image',
  });
  const [runpodReady, setRunpodReady] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => getSavedGeminiKey());
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyTestResult, setKeyTestResult] = useState<string | null>(null);

  // Multi-photo cumulative Pinterest inspiration & material pool!
  const [photos, setPhotos] = useState<PinterestSourcePhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const nextPhotoNumRef = useRef(1);
  const [materialPool, setMaterialPool] = useState<PinterestMaterialEntry[]>([]);
  const [poolFilter, setPoolFilter] = useState<'all' | string>('all');
  const [showAddMaterialForm, setShowAddMaterialForm] = useState(false);
  const [customMatKind, setCustomMatKind] = useState<PinterestMaterialEntry['kind']>('accentWall');
  const [customMatName, setCustomMatName] = useState('');
  const [customMatHex, setCustomMatHex] = useState('#b89268');
  const [customMatWallPat, setCustomMatWallPat] = useState<WallPattern>('slats');
  const [customMatFloor, setCustomMatFloor] = useState<FloorMaterialKind>('herringbone_oak');

  const activePhoto = photos.find((p) => p.id === activePhotoId) || photos[photos.length - 1] || null;
  const photoDataUrl = activePhoto?.dataUrl || null;
  const roomStyle = activePhoto?.style || null;

  const [userFocusPrompt, setUserFocusPrompt] = useState<string>('');
  const [targetRoomId, setTargetRoomId] = useState<string>(activeTargetRoomId || 'main');
  const [analyzing, setAnalyzing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [autoPopulateOnAnalyze, setAutoPopulateOnAnalyze] = useState(true);
  // Default FALSE so adding a second Pinterest photo NEVER wipes previously built cabinets/furniture!
  const [replaceExistingOnBuild, setReplaceExistingOnBuild] = useState(false);
  const [autoVerifyAfterBuild, setAutoVerifyAfterBuild] = useState(true);
  const [qaResult, setQaResult] = useState<{
    matchScore: number;
    critiqueTr: string;
    fixedCount: number;
    addedCount: number;
    model: string;
    passesRun?: number;
  } | null>(null);
  // Monotonic best-state memory so iterative verification can NEVER drop a score backwards (e.g. 52% -> 28%)!
  const bestQaRef = useRef<{
    score: number;
    objects: ArchPlacedObject[];
    roomFixes: VisualRefineRoomFix | null;
    critiqueTr: string;
    model: string;
    photoSig: string;
  } | null>(null);
  const [savingCatalogId, setSavingCatalogId] = useState<string | null>(null);
  const [savedCatalogIds, setSavedCatalogIds] = useState<Record<string, boolean>>({});
  const [detected, setDetected] = useState<PoolDetectedItem[]>([]);
  const [jobs, setJobs] = useState<Record<string, ItemJobState>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [heroUpgrading, setHeroUpgrading] = useState<{ done: number; total: number } | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [geminiImageQuotaNote, setGeminiImageQuotaNote] = useState(false);
  const geminiImageQuotaBlockedRef = useRef(false);

  const getPhotoUrlForItem = (item: PoolDetectedItem): string | null =>
    (item.sourcePhotoId ? photos.find((p) => p.id === item.sourcePhotoId)?.dataUrl : null) || photoDataUrl;

  // Auto-sync target room when user selects an adjacent room in 3D or sidebar
  useEffect(() => {
    if (activeTargetRoomId) {
      const exists =
        activeTargetRoomId === 'main' ||
        (project.adjacentRooms || []).some((r) => r.id === activeTargetRoomId);
      if (exists) setTargetRoomId(activeTargetRoomId);
    }
  }, [activeTargetRoomId, project.adjacentRooms]);

  // If the selected targetRoomId was deleted, fall back cleanly to 'main'
  useEffect(() => {
    if (targetRoomId !== 'main' && !(project.adjacentRooms || []).some((r) => r.id === targetRoomId)) {
      setTargetRoomId('main');
    }
  }, [targetRoomId, project.adjacentRooms]);

  const getTargetRoomRect = (rid = targetRoomId) => {
    if (rid !== 'main') {
      const adj = (project.adjacentRooms || []).find((r) => r.id === rid);
      if (adj) {
        return {
          id: adj.id,
          name: adj.name,
          cx: adj.centerXM,
          cz: adj.centerZM,
          w: adj.widthM,
          d: adj.depthM,
          isMain: false,
        };
      }
    }
    return {
      id: 'main',
      name: 'Ana Salon',
      cx: 0,
      cz: 0,
      w: project.widthM,
      d: project.depthM,
      isMain: true,
    };
  };

  const isObjInRoomRect = (o: ArchPlacedObject, r: { cx: number; cz: number; w: number; d: number }) =>
    o.x >= r.cx - r.w * 0.5 - 0.1 &&
    o.x <= r.cx + r.w * 0.5 + 0.1 &&
    o.z >= r.cz - r.d * 0.5 - 0.1 &&
    o.z <= r.cz + r.d * 0.5 + 0.1;

  // Interactive photo box drawing (new item OR redrawing an existing item's crop box!)
  const [drawMode, setDrawMode] = useState<'off' | 'new' | string>('off');
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const photoWrapRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounterRef = useRef(0);

  // Prevent accidental browser tab navigation when dropping an image anywhere near the panel
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).some((t) => t === 'Files' || t === 'text/uri-list')) {
        e.preventDefault();
      }
    };
    window.addEventListener('dragover', preventNav);
    window.addEventListener('drop', preventNav);
    return () => {
      window.removeEventListener('dragover', preventNav);
      window.removeEventListener('drop', preventNav);
    };
  }, []);

  const handleDroppedDataTransfer = async (dt: DataTransfer | null) => {
    if (!dt) return;

    // 1) Direct local image file (Windows Explorer / Finder / Desktop / Downloads)
    const files = Array.from(dt.files || []);
    const imgFile = files.find((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif)$/i.test(f.name));
    if (imgFile) {
      await handleUploadInspiration(imgFile);
      onToast('Fotoğraf sürüklenerek yüklendi!');
      return;
    }

    // 2) DataTransferItem file fallback
    for (const item of Array.from(dt.items || [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) {
          await handleUploadInspiration(f);
          onToast('Fotoğraf sürüklenerek yüklendi!');
          return;
        }
      }
    }

    // 3) Image dragged directly from a Pinterest / web browser tab (HTML <img src> or URL)
    const html = dt.getData('text/html') || '';
    const htmlSrcMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const rawUri = (htmlSrcMatch?.[1] || dt.getData('text/uri-list') || dt.getData('text/plain') || '')
      .split(/\r?\n/)
      .find((line) => /^https?:\/\/|^data:image\//i.test(line.trim()))
      ?.trim();

    if (!rawUri) {
      onToast('Lütfen bir fotoğraf dosyası (JPG/PNG/WebP) sürükleyip bırakın.');
      return;
    }

    try {
      if (rawUri.startsWith('data:image/')) {
        const res = await fetch(rawUri);
        const blob = await res.blob();
        await handleUploadInspiration(new File([blob], 'pinterest-drop.jpg', { type: blob.type || 'image/jpeg' }));
        onToast('Fotoğraf sürüklenerek yüklendi!');
        return;
      }

      // Try direct fetch first; fall back cleanly to our HTTPS image proxy (handles Pinterest i.pinimg.com CORS!)
      let fetchedBlob: Blob | null = null;
      try {
        const direct = await fetch(rawUri);
        if (direct.ok) {
          const b = await direct.blob();
          if (b.type.startsWith('image/')) fetchedBlob = b;
        }
      } catch {
        /* CORS blocked -> use server proxy */
      }

      if (!fetchedBlob) {
        const proxyRes = await fetch('/api/pinterest3d?action=fetchImage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUri }),
        });
        const proxyJson = await proxyRes.json().catch(() => null);
        if (proxyRes.ok && proxyJson?.ok && proxyJson?.dataUrl) {
          const r = await fetch(proxyJson.dataUrl);
          fetchedBlob = await r.blob();
        }
      }

      if (fetchedBlob) {
        await handleUploadInspiration(
          new File([fetchedBlob], 'pinterest-drop.jpg', { type: fetchedBlob.type || 'image/jpeg' })
        );
        onToast('Tarayıcıdan sürüklenen fotoğraf yüklendi!');
      } else {
        onToast('Görsel doğrudan alınamadı — sağ tık "Resmi Kopyala" yapıp Ctrl+V ile yapıştırabilirsiniz.');
      }
    } catch {
      onToast('Görsel okunamadı — dosyayı sürükleyebilir veya Ctrl+V ile yapıştırabilirsiniz.');
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    void handleDroppedDataTransfer(e.dataTransfer);
  };

  // Progressive disclosure toggles (keeps main flow clean with zero feature loss)
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showPhotorealSection, setShowPhotorealSection] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);

  const importImageFromUrl = async (rawUrl: string) => {
    const clean = String(rawUrl || '').trim();
    if (!/^https:\/\//i.test(clean)) {
      onToast('Geçerli bir HTTPS görsel bağlantısı yapıştırın.');
      return;
    }
    setImportingUrl(true);
    try {
      const proxyRes = await fetch('/api/pinterest3d?action=fetchImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clean }),
      });
      const proxyJson = await proxyRes.json().catch(() => null);
      if (proxyRes.ok && proxyJson?.ok && proxyJson?.dataUrl) {
        const r = await fetch(proxyJson.dataUrl);
        const blob = await r.blob();
        await handleUploadInspiration(
          new File([blob], 'pinterest-link.jpg', { type: blob.type || 'image/jpeg' })
        );
        setImageUrlInput('');
        onToast('Pinterest görseli bağlantıdan yüklendi!');
      } else {
        onToast(proxyJson?.error || 'Görsel bağlantıdan alınamadı.');
      }
    } catch {
      onToast('Görsel bağlantıdan alınamadı.');
    } finally {
      setImportingUrl(false);
    }
  };

  // Photoreal V-Ray style render state
  const [renderStyleNote, setRenderStyleNote] = useState(
    'Doğal gün ışığı, sıcak mimari atmosfer, mat meşe ve keten dokular'
  );
  const [renderingPhoto, setRenderingPhoto] = useState(false);
  const [photorealResult, setPhotorealResult] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    fetchPinterestConfig().then((c) => {
      setServerCfg(c);
      if (c.runpodConfigured) setRunpodReady(true);
    });
    fetchProduct3DConfig().then((c) => {
      if (c.runpod3dConfigured || c.falConfigured) setRunpodReady(true);
    });
  }, []);

  // Support Ctrl+V direct paste (both copied image AND copied https:// image URL!) from Pinterest browser tab!
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const items = e.clipboardData?.items;
      if (items) {
        for (const it of Array.from(items)) {
          if (it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) {
              handleUploadInspiration(f);
              onToast('Panodan Pinterest görseli yapıştırıldı.');
              return;
            }
          }
        }
      }
      const pastedText = e.clipboardData?.getData('text/plain')?.trim() || '';
      if (/^https:\/\/\S+/i.test(pastedText)) {
        void importImageFromUrl(pastedText);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasGeminiAccess =
    serverCfg.geminiConfigured ||
    Boolean(serverCfg.groqConfigured) ||
    Boolean(serverCfg.openaiConfigured) ||
    Boolean(serverCfg.openrouterConfigured) ||
    Boolean(geminiKey.trim());

  const findPlacedObjForItem = (itemId: string): ArchPlacedObject | undefined =>
    project.objects.find((o) => o.pinterestItemId === itemId);

  /**
   * Builds a clean, collision-free, editable 3D ArchPlacedObject from ANY Pinterest item
   * in < 5ms, preserving exact Pinterest color, silhouette, dimensions, 1st/2nd-floor placement,
   * AND target room coordinates (Ana Salon or any attached multi-room!).
   */
  const buildInstant3DObject = async (
    item: PinterestDetectedObject,
    imgUrl: string,
    occupiedGround: OBB2D[],
    wallCursorsGround: Record<WallId, WallSlot[]>,
    occupiedUpper: OBB2D[] = [],
    wallCursorsUpper: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] },
    effectiveCeilingM: number = project.ceilingM,
    mezBounds: MezzanineBounds | null = getMezzanineBounds(project),
    mezSpec: ArchMezzanine | null = project.mezzanine?.enabled ? project.mezzanine : null,
    targetRoomOverride?: { cx: number; cz: number; w: number; d: number; isMain: boolean }
  ): Promise<{ obj: ArchPlacedObject; cropPreview?: string; rawCrop?: string }> => {
    const tRoom = targetRoomOverride || getTargetRoomRect();
    const roomW = tRoom.w;
    const roomD = tRoom.d;
    const activeMezBounds = tRoom.isMain ? mezBounds : null;
    const activeMezSpec = tRoom.isMain ? mezSpec : null;
    const archetype = resolvePinterestArchetype(item);
    const defaults = DEFAULT_COLORS_BY_ARCHETYPE[archetype] || { c1: '#b8aea0', c2: '#2c2b29' };

    const cropPreview = await cropBoxFromDataUrl(imgUrl, item.box2d, 0.025).catch(() => undefined);
    const needsRawTexture = archetype === 'wall_art';
    const rawCrop = needsRawTexture ? await cropRawTightDataUrl(imgUrl, item.box2d).catch(() => undefined) : undefined;

    let primaryHex = isValidHexColor(item.primaryColorHex) ? item.primaryColorHex : '';
    if (!primaryHex && cropPreview && archetype !== 'potted_plant' && archetype !== 'wall_tv') {
      primaryHex = await sampleDominantHexFromDataUrl(cropPreview);
    }
    if (!primaryHex) primaryHex = defaults.c1;
    const accentHex = isValidHexColor(item.accentColorHex) ? item.accentColorHex : defaults.c2;

    const isUpper = Boolean(activeMezBounds && item.floorLevel === 1 && archetype !== 'stairs');
    const baseFloorY = isUpper && activeMezBounds ? activeMezBounds.topY : 0;
    const headroomM = isUpper && activeMezBounds ? Math.max(1.2, effectiveCeilingM - activeMezBounds.topY) : effectiveCeilingM;
    const activeOccupied = isUpper ? occupiedUpper : occupiedGround;
    const activeWallCursors = isUpper ? wallCursorsUpper : wallCursorsGround;

    // Realistic clamped dimensions (protects against outlier AI estimates while keeping compact tabletop decor small!)
    const isTabletopBurner =
      archetype === 'linear_fireplace' &&
      (item.relation === 'on_top_of' || ((Number(item.heightCm) || 0) > 0 && Number(item.heightCm) <= 24));
    const isWallSconce =
      archetype === 'table_lamp' &&
      (item.mountMode === 'wall' || (Number(item.elevationCm) || 0) >= 110 || /aplik|sconce|duvar/i.test(item.nameTr)) &&
      item.relation !== 'on_top_of';
    const isTabletopDecor =
      isTabletopBurner ||
      archetype === 'decorative_vase' ||
      (archetype === 'table_lamp' && !isWallSconce) ||
      item.relation === 'on_top_of' ||
      (archetype === 'potted_plant' && (Number(item.heightCm) || 0) > 0 && Number(item.heightCm) <= 48);

    // Side-wall W×D auto-swap: if Vision reported world X×Z instead of local W×D for elongated furniture on west/east wall
    // (e.g. a 180cm wide, 60cm deep wardrobe reported as 60×180 on west wall!), swap so wide face runs ALONG the wall!
    let rawW = Number(item.widthCm) || (isTabletopDecor ? 24 : 90);
    let rawD = Number(item.depthCm) || (isTabletopDecor ? 24 : 60);
    const SIDE_WALL_SWAP_KINDS = new Set<ParametricFurnitureKind>([
      'wardrobe',
      'bookshelf',
      'sideboard',
      'console_table',
      'tv_baza',
      'tv_wall_unit',
      'linear_fireplace',
      'sofa',
      'desk',
      'vanity_table',
      'wall_tv',
      'wall_art',
      'wall_mirror',
      'wall_shelf',
    ]);
    if (
      (item.suggestedWall === 'west' || item.suggestedWall === 'east') &&
      SIDE_WALL_SWAP_KINDS.has(archetype) &&
      rawD > rawW * 1.35
    ) {
      [rawW, rawD] = [rawD, rawW];
    }

    let wM = Math.max(isTabletopDecor ? 0.14 : 0.25, Math.min(roomW * 0.78, rawW / 100));
    let dM = Math.max(0.04, Math.min(roomD * 0.78, rawD / 100));
    let hM = Math.max(0.015, Math.min(headroomM - 0.1, (Number(item.heightCm) || (isTabletopDecor ? 28 : 85)) / 100));

    if (archetype === 'rug_custom') {
      hM = 0.016;
      const maxRW = isUpper && activeMezBounds ? activeMezBounds.widthM * 0.88 : roomW * 0.82;
      const maxRD = isUpper && activeMezBounds ? activeMezBounds.depthM * 0.88 : roomD * 0.82;
      wM = Math.max(0.85, Math.min(maxRW, wM));
      dM = Math.max(0.85, Math.min(maxRD, dM));
    } else if (archetype === 'wall_art' || archetype === 'wall_mirror' || archetype === 'wall_tv') {
      dM = Math.min(0.08, Math.max(0.035, dM));
    } else if (archetype === 'wall_shelf') {
      wM = Math.max(0.35, Math.min(2.4, wM));
      dM = Math.max(0.16, Math.min(0.42, dM));
      hM = Math.max(0.04, Math.min(0.95, hM));
    } else if (archetype === 'decorative_vase') {
      wM = Math.max(0.14, Math.min(0.42, wM));
      dM = Math.max(0.14, Math.min(0.42, dM));
      hM = Math.max(0.12, Math.min(0.48, hM));
    } else if (isTabletopBurner) {
      wM = Math.max(0.45, Math.min(1.45, wM));
      dM = Math.max(0.14, Math.min(0.34, dM));
      hM = Math.max(0.1, Math.min(0.24, hM));
    } else if (archetype === 'tv_baza' || archetype === 'linear_fireplace') {
      wM = Math.max(1.1, Math.min(roomW * 0.82, wM));
      dM = Math.max(0.32, Math.min(0.58, dM));
      hM = Math.max(0.26, Math.min(0.68, hM));
    } else if (archetype === 'potted_plant') {
      if (isTabletopDecor) {
        wM = Math.max(0.16, Math.min(0.42, wM));
        dM = Math.max(0.16, Math.min(0.42, dM));
        hM = Math.max(0.16, Math.min(0.48, hM));
      } else {
        wM = Math.max(0.45, Math.min(1.2, wM));
        dM = Math.max(0.45, Math.min(1.2, dM));
        hM = Math.max(0.7, Math.min(headroomM - 0.15, hM));
      }
    } else if (archetype === 'stairs' && activeMezBounds) {
      // Snap stairs height flush to the 2nd floor mezzanine deck!
      hM = activeMezBounds.topY;
      wM = Math.max(0.75, Math.min(1.15, wM));
      dM = Math.max(1.35, Math.min(2.2, dM));
    } else if (isUpper && activeMezBounds) {
      // Keep upstairs furniture comfortably within the mezzanine slab depth/width
      wM = Math.min(wM, activeMezBounds.widthM * 0.78);
      dM = Math.min(dM, activeMezBounds.depthM * 0.85);
    }

    const isRug = archetype === 'rug_custom';
    const isCeiling = archetype === 'chandelier' || item.mountMode === 'ceiling';
    const isFloorMirror =
      archetype === 'wall_mirror' &&
      (hM >= 1.25 || (item.elevationCm !== undefined && item.elevationCm <= 15) || /boy|ayakta|zemin|full.?length|kemer/i.test(item.nameTr));
    const isHighWall =
      isWallSconce ||
      (!isFloorMirror &&
        (archetype === 'wall_art' ||
          archetype === 'wall_mirror' ||
          archetype === 'wall_tv' ||
          archetype === 'wall_shelf' ||
          archetype === 'ac_unit'));
    const isFloatingBaza =
      (archetype === 'tv_baza' ||
        archetype === 'sideboard' ||
        archetype === 'console_table' ||
        archetype === 'wardrobe' ||
        archetype === 'bookshelf') &&
      typeof item.elevationCm === 'number' &&
      item.elevationCm >= 8 &&
      item.elevationCm <= 135;
    const isWallAnchoredFloor =
      WALL_ANCHORABLE_FLOOR_KINDS.has(archetype) && Boolean(item.suggestedWall && item.suggestedWall !== 'center');
    const isWallBacked =
      !isTabletopBurner && (isWallSconce || item.mountMode === 'wall' || WALL_BACKED_KINDS.has(archetype) || isWallAnchoredFloor);

    const mountMode: ArchPlacedObject['mountMode'] = isRug
      ? 'rug'
      : isCeiling
      ? 'ceiling'
      : isWallBacked && !isWallAnchoredFloor
      ? 'wall'
      : 'floor';

    let x = Math.max(-roomW * 0.44, Math.min(roomW * 0.44, (item.relativeX || 0) * (roomW * 0.45)));
    let z = Math.max(-roomD * 0.44, Math.min(roomD * 0.44, (item.relativeZ || 0) * (roomD * 0.45)));
    let rot = ((item.facingDeg || 0) * Math.PI) / 180;
    let y = baseFloorY;
    let attachedWall: WallId | undefined;

    // Clamp upstairs coordinates onto the mezzanine deck bounds
    const clampToMez = (cx: number, cz: number, hw: number, hd: number) => {
      if (!isUpper || !activeMezBounds) return { cx, cz };
      const pad = 0.06;
      const nx = Math.max(activeMezBounds.minX + hw + pad, Math.min(activeMezBounds.maxX - hw - pad, cx));
      const nz = Math.max(activeMezBounds.minZ + hd + pad, Math.min(activeMezBounds.maxZ - hd - pad, cz));
      return { cx: nx, cz: nz };
    };

    if (archetype === 'stairs' && activeMezBounds && activeMezSpec) {
      y = 0;
      if (activeMezSpec.anchorWall === 'north') {
        rot = 0;
        if (activeMezSpec.stairGapSide === 'west') {
          x = Math.max(-roomW * 0.5 + wM * 0.5 + 0.08, activeMezBounds.minX - wM * 0.5 - 0.04);
          z = activeMezBounds.maxZ - dM * 0.15;
        } else if (activeMezSpec.stairGapSide === 'east') {
          x = Math.min(roomW * 0.5 - wM * 0.5 - 0.08, activeMezBounds.maxX + wM * 0.5 + 0.04);
          z = activeMezBounds.maxZ - dM * 0.15;
        } else {
          x = -roomW * 0.5 + wM * 0.5 + 0.12;
          z = activeMezBounds.maxZ + dM * 0.5;
        }
      } else {
        x = Math.max(-roomW * 0.42, Math.min(roomW * 0.42, x));
        z = Math.max(-roomD * 0.42, Math.min(roomD * 0.42, z));
      }
      occupiedGround.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
    } else if (isCeiling) {
      y = Math.max(baseFloorY + 1.65, effectiveCeilingM - hM);
      x = Math.max(-roomW * 0.25, Math.min(roomW * 0.25, x));
      z = Math.max(-roomD * 0.25, Math.min(roomD * 0.25, z));
    } else if (isRug) {
      y = baseFloorY + 0.004;
      rot = 0;
      const cl = clampToMez(x, z, wM * 0.5, dM * 0.5);
      x = cl.cx;
      z = cl.cz;
    } else if (isWallBacked) {
      const targetWall: WallId =
        item.suggestedWall && item.suggestedWall !== 'center'
          ? item.suggestedWall
          : Math.abs(x) > Math.abs(z)
          ? x < 0
            ? 'west'
            : 'east'
          : z <= 0
          ? 'north'
          : 'south';
      attachedWall = targetWall;

      // Determine vertical span [y0, y1] FIRST so items stacked vertically never push each other sideways!
      if (isHighWall) {
        const relElev =
          archetype === 'ac_unit'
            ? Math.max(1.75, headroomM - hM - 0.15)
            : archetype === 'wall_shelf'
            ? Math.max(0.65, Math.min(headroomM - hM - 0.12, (item.elevationCm || 145) / 100))
            : Math.max(0.75, Math.min(headroomM - hM - 0.08, (item.elevationCm || 115) / 100));
        y = baseFloorY + relElev;
      } else if (isFloatingBaza) {
        const maxFloat = archetype === 'bookshelf' ? Math.max(0.5, headroomM - hM - 0.06) : 0.45;
        y = baseFloorY + Math.max(0.08, Math.min(maxFloat, (item.elevationCm || 16) / 100));
      } else {
        y = baseFloorY;
      }
      const myY0 = y;
      const myY1 = y + hM;

      const isHoriz = targetWall === 'north' || targetWall === 'south';
      const spanMin =
        isUpper && activeMezBounds
          ? (isHoriz ? activeMezBounds.minX : activeMezBounds.minZ) + wM * 0.5 + 0.1
          : -(isHoriz ? roomW : roomD) * 0.5 + wM * 0.5 + 0.1;
      const spanMax =
        isUpper && activeMezBounds
          ? (isHoriz ? activeMezBounds.maxX : activeMezBounds.maxZ) - wM * 0.5 - 0.1
          : (isHoriz ? roomW : roomD) * 0.5 - wM * 0.5 - 0.1;
      let along = Math.max(spanMin, Math.min(spanMax, isHoriz ? x : z));

      // True 2D wall collision (horizontal AND vertical overlap check!)
      const used = activeWallCursors[targetWall];
      const collides2D = (pos: number) =>
        used.some((s) => {
          const horizOverlap = Math.abs(s.along - pos) < s.halfW + wM * 0.5 + 0.04;
          const vertOverlap = myY0 < s.y1 - 0.06 && myY1 > s.y0 + 0.06;
          return horizOverlap && vertOverlap;
        });

      if (collides2D(along) && spanMax > spanMin + 0.15) {
        const steps = [0.25, -0.25, 0.55, -0.55, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8];
        const freeShift = steps.find((d) => {
          const cand = along + d;
          return cand >= spanMin - 0.01 && cand <= spanMax + 0.01 && !collides2D(cand);
        });
        if (freeShift !== undefined) along = Math.max(spanMin, Math.min(spanMax, along + freeShift));
      }

      used.push({ along, halfW: wM * 0.5, y0: myY0, y1: myY1 });

      const wallInset = isWallAnchoredFloor ? 0.03 : 0.02;
      if (targetWall === 'north') {
        x = along;
        z = -roomD * 0.5 + dM * 0.5 + wallInset;
        rot = 0;
      } else if (targetWall === 'south') {
        x = along;
        z = roomD * 0.5 - dM * 0.5 - wallInset;
        rot = Math.PI;
      } else if (targetWall === 'west') {
        z = along;
        x = -roomW * 0.5 + dM * 0.5 + wallInset;
        rot = Math.PI / 2;
      } else {
        z = along;
        x = roomW * 0.5 - dM * 0.5 - wallInset;
        rot = -Math.PI / 2;
      }

      if (!isHighWall) {
        activeOccupied.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
      }
    } else if (isUpper && activeMezBounds) {
      const localW = activeMezBounds.widthM;
      const localD = activeMezBounds.depthM;
      const mezCx = (activeMezBounds.minX + activeMezBounds.maxX) * 0.5;
      const mezCz = (activeMezBounds.minZ + activeMezBounds.maxZ) * 0.5;
      const cl = clampToMez(x, z, wM * 0.5, dM * 0.5);
      const localOccupied: OBB2D[] = occupiedUpper.map((o) => ({ ...o, x: o.x - mezCx, z: o.z - mezCz }));
      const pos = findOpenSpawnPosition(
        wM * 0.5,
        dM * 0.5,
        rot,
        localOccupied,
        localW,
        localD,
        [cl.cx - mezCx, cl.cz - mezCz]
      );
      if (pos) {
        x = pos.x + mezCx;
        z = pos.z + mezCz;
      } else {
        x = cl.cx;
        z = cl.cz;
      }
      y = baseFloorY;
      occupiedUpper.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
    } else {
      const pos = findOpenSpawnPosition(wM * 0.5, dM * 0.5, rot, occupiedGround, roomW, roomD, [x, z]);
      if (pos) {
        x = pos.x;
        z = pos.z;
      }
      y = 0;
      occupiedGround.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
    }

    // Translate local target-room coordinates into world space!
    const worldX = Number((x + tRoom.cx).toFixed(3));
    const worldZ = Number((z + tRoom.cz).toFixed(3));

    const obj: ArchPlacedObject = {
      id: `pin-inst-${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      pinterestItemId: item.id,
      name: item.nameTr,
      category: item.category,
      dimensionsCm: `${Math.round(wM * 100)} × ${Math.round(dM * 100)} × ${Math.round(hM * 100)} cm`,
      parametricKind: archetype,
      parametricColorHex: primaryHex,
      parametricAccentHex: accentHex,
      floorLevel: isUpper ? 1 : 0,
      x: worldX,
      y,
      z: worldZ,
      rot,
      widthM: wM,
      depthM: dM,
      heightM: hM,
      mountMode,
      attachedWall,
      thumbUrl: rawCrop || cropPreview,
      source: 'pinterest-ai',
    };

    return { obj, cropPreview, rawCrop };
  };

  /**
   * 1-CLICK FULL PINTEREST ROOM ASSEMBLY (< 0.3 seconds!):
   * Places ALL selected detected Pinterest items into the chosen target room (Ana Salon or any attached room)
   * without wiping previously added items unless the user explicitly enables reset!
   */
  const assembleAllInstantIn3D = async (
    itemsToPlace: PinterestDetectedObject[],
    styleToApply: PinterestRoomStyle | null,
    imgUrl: string,
    replaceExisting: boolean
  ) => {
    if (itemsToPlace.length === 0) return;
    const tRoom = getTargetRoomRect();

    // Resolve target ceiling & 2nd-floor mezzanine geometry BEFORE laying out objects!
    const effectiveCeilingM =
      tRoom.isMain && styleToApply?.hasMezzanine
        ? Math.max(3.85, Math.min(4.8, (styleToApply.suggestedCeilingCm || 410) / 100))
        : tRoom.isMain && styleToApply?.suggestedCeilingCm && replaceExisting
        ? Math.max(2.5, Math.min(4.5, styleToApply.suggestedCeilingCm / 100))
        : project.ceilingM;

    const mezSpec: ArchMezzanine | null =
      tRoom.isMain && styleToApply?.hasMezzanine
        ? {
            enabled: true,
            anchorWall: styleToApply.mezzanine?.anchorWall || 'north',
            heightM: Math.max(1.85, Math.min(effectiveCeilingM - 1.5, (styleToApply.mezzanine?.heightCm || 205) / 100)),
            depthM: Math.max(1.6, Math.min(project.depthM * 0.65, (styleToApply.mezzanine?.depthRatio || 0.52) * project.depthM)),
            widthRatio: Math.max(0.55, Math.min(1.0, styleToApply.mezzanine?.widthRatio || 0.78)),
            stairGapSide: styleToApply.mezzanine?.stairGapSide || 'west',
            thicknessM: 0.16,
            deckColorHex: styleToApply.mezzanine?.deckColorHex || styleToApply.floorTintHex || '#c9b092',
            railingStyle: styleToApply.mezzanine?.railingStyle || 'none',
            underLed: true,
          }
        : tRoom.isMain && project.mezzanine?.enabled && !replaceExisting
        ? project.mezzanine
        : null;

    const mezBounds = mezSpec
      ? getMezzanineBounds({
          widthM: project.widthM,
          depthM: project.depthM,
          ceilingM: effectiveCeilingM,
          mezzanine: mezSpec,
        })
      : null;

    const priority = (it: PinterestDetectedObject) => {
      const k = resolvePinterestArchetype(it);
      if (k === 'stairs') return 0;
      if (k === 'rug_custom') return 1;
      if (WALL_BACKED_KINDS.has(k)) return 2;
      if (k === 'bed_frame' || k === 'sofa' || k === 'dining_table' || k === 'desk') return 3;
      return 4;
    };
    const ordered = [...itemsToPlace].sort((a, b) => priority(a) - priority(b));

    // Only consider existing floor objects inside THIS target room (in target-room local coordinates!)
    const occupiedGround: OBB2D[] = replaceExisting
      ? []
      : project.objects
          .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && isObjInRoomRect(o, tRoom))
          .map((o) => ({
            id: o.id,
            x: o.x - tRoom.cx,
            z: o.z - tRoom.cz,
            rot: o.rot,
            halfW: o.widthM * 0.5,
            halfD: o.depthM * 0.5,
          }));
    const occupiedUpper: OBB2D[] = [];

    const wallCursorsGround: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
    const wallCursorsUpper: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
    if (tRoom.isMain && styleToApply?.hasVisibleWindow && styleToApply.primaryWindowWall) {
      const ww = styleToApply.primaryWindowWall;
      const winSpan = ww === 'north' || ww === 'south' ? tRoom.w : tRoom.d;
      const winAlong = styleToApply.hasMezzanine ? -winSpan * 0.18 : 0;
      wallCursorsGround[ww].push({ along: winAlong, halfW: 0.9, y0: 0.2, y1: effectiveCeilingM });
      wallCursorsUpper[ww].push({ along: winAlong, halfW: 0.9, y0: 0.2, y1: effectiveCeilingM });
    }
    const builtObjects: ArchPlacedObject[] = [];
    const jobPatches: Record<string, Partial<ItemJobState>> = {};

    for (const item of ordered) {
      const itemImgUrl = getPhotoUrlForItem(item as PoolDetectedItem) || imgUrl;
      const res = await buildInstant3DObject(
        item,
        itemImgUrl,
        occupiedGround,
        wallCursorsGround,
        occupiedUpper,
        wallCursorsUpper,
        effectiveCeilingM,
        mezBounds,
        mezSpec,
        tRoom
      );
      builtObjects.push(res.obj);
      jobPatches[item.id] = {
        selected: true,
        status: 'done',
        cropPreviewUrl: res.cropPreview,
        rawCropUrl: res.rawCrop,
        progressText: res.obj.floorLevel === 1 ? '2. Kat (Asma Kat) — tıklayıp düzenle' : `${tRoom.name} içinde — tıklayıp düzenle`,
      };
    }

    const sourceMap = new Map<string, PinterestDetectedObject>();
    ordered.forEach((it) => sourceMap.set(it.id, it));

    // Stage 2: Enforce architectural parent-child physics inside target room's local coordinates
    const localBuilt = builtObjects.map((o) => ({ ...o, x: o.x - tRoom.cx, z: o.z - tRoom.cz }));
    const localSolved = applyArchitecturalRelationships(
      localBuilt,
      sourceMap,
      { ...project, widthM: tRoom.w, depthM: tRoom.d },
      effectiveCeilingM,
      tRoom.isMain ? mezBounds : null
    );
    const solvedObjects = localSolved.map((o) => ({
      ...o,
      x: Number((o.x + tRoom.cx).toFixed(3)),
      z: Number((o.z + tRoom.cz).toFixed(3)),
    }));

    // When focus prompt targets specific items only OR non-destructive append mode is active, don't overwrite room finishes blindly
    const styleForScene = userFocusPrompt.trim() && !replaceExisting ? null : styleToApply;
    onApplyPinterestScene(solvedObjects, styleForScene, replaceExisting, tRoom.id);
    setJobs((prev) => {
      const next = { ...prev };
      for (const [id, patch] of Object.entries(jobPatches)) {
        next[id] = { ...(next[id] || { selected: true, status: 'done' }), ...patch };
      }
      return next;
    });

    // Build combined room object list for Stage 3 verification (preserving kept objects from non-destructive mode!)
    const otherRoomObjs = project.objects.filter((o) => !isObjInRoomRect(o, tRoom));
    const keptTargetObjs = replaceExisting ? [] : project.objects.filter((o) => isObjInRoomRect(o, tRoom));
    const fullSceneObjs = [...otherRoomObjs, ...keptTargetObjs, ...solvedObjects];

    if (autoVerifyAfterBuild && tRoom.isMain) {
      // Reset monotonic memory for this fresh build, then auto-optimize silently until >= 75%!
      bestQaRef.current = null;
      await runVisualSelfCritique(fullSceneObjs, styleForScene, imgUrl, sourceMap, effectiveCeilingM, mezSpec, true);
    } else {
      setStatusBanner(
        `${solvedObjects.length} parça ${tRoom.name} içine yerleştirildi${mezSpec ? ' (2 katlı asma kat dahil!)' : ''}!`
      );
      onToast(`${solvedObjects.length} parça ${tRoom.name} içine eklendi!`);
    }
  };

  /**
   * STAGE 3 — Silent Self-Healing Multi-Pass Verification Loop (Items #1 & #6):
   * Automatically runs background verify+refine passes until matchScore >= 75% (up to 3 passes)
   * WITHOUT showing ugly low intermediate scores, AND strictly enforces a Monotonic Best-State
   * Rollback Guard so the visual accuracy can NEVER regress backwards (e.g., 52% -> 28%)!
   */
  const runVisualSelfCritique = async (
    currentObjs: ArchPlacedObject[],
    styleCtx: PinterestRoomStyle | null,
    origImgUrl: string,
    sourceMapInput?: Map<string, PinterestDetectedObject>,
    ceilingOverride?: number,
    mezOverride?: ArchMezzanine | null,
    isAutoPipeline = false
  ) => {
    setRefining(true);
    const TARGET_SCORE = 75;
    const MAX_PASSES = isAutoPipeline ? 3 : 2;
    const photoSig = origImgUrl.slice(0, 120);

    // Preserve previous monotonic best score if user clicked manual re-verify on the same photo!
    const priorBest =
      bestQaRef.current && bestQaRef.current.photoSig === photoSig
        ? bestQaRef.current
        : null;

    let bestScore = priorBest ? priorBest.score : -1;
    let bestObjects: ArchPlacedObject[] = priorBest ? [...priorBest.objects] : [...currentObjs];
    let bestRoomFixes: VisualRefineRoomFix | null = priorBest ? priorBest.roomFixes : null;
    let bestCritique = priorBest?.critiqueTr || '';
    let bestModel = priorBest?.model || '';

    let workingObjs = [...currentObjs];
    let workingCeil = ceilingOverride || project.ceilingM;
    let workingMez: ArchMezzanine | null = mezOverride !== undefined ? mezOverride : project.mezzanine || null;
    let totalApplied = 0;
    let totalAdded = 0;
    let passesRun = 0;

    setStatusBanner('MekanAR Mimari Motoru yerleşimi ve oranları otomatik kalibre ediyor...');

    try {
      for (let pass = 1; pass <= MAX_PASSES; pass++) {
        passesRun = pass;
        if (pass > 1) {
          setStatusBanner(`Otomatik hassas hizalama yapılıyor (Tur ${pass}/${MAX_PASSES})...`);
        }

        // Wait for Three.js WebGL camera & geometry rebuild to draw a fresh clean frame
        await new Promise((r) => setTimeout(r, 750));
        const snap3d = onCaptureViewport();
        if (!snap3d) break;

        const summary = `${styleCtx?.styleNameTr || 'Mimari Oda'} · Tavan ${workingCeil.toFixed(2)}m · ${
          workingMez?.enabled ? `2 Katlı Asma Kat (${Math.round(workingMez.heightM * 100)}cm)` : 'Tek Kat'
        }`;

        const qa = await verifyAndRefinePinterestRoom({
          originalPhotoDataUrl: origImgUrl,
          rendered3dDataUrl: snap3d,
          roomSummary: summary,
          roomWidthM: project.widthM,
          roomDepthM: project.depthM,
          roomCeilingM: workingCeil,
          placedObjects: workingObjs as unknown as Array<Record<string, unknown>>,
          userPrompt: userFocusPrompt,
          geminiKey,
        });

        // MONOTONIC NON-REGRESSION CHECK (Item #6 fix!):
        // Never allow a refinement pass to make the 3D scene WORSE than our best verified state!
        if (qa.matchScore >= bestScore) {
          bestScore = qa.matchScore;
          bestObjects = workingObjs.map((o) => ({ ...o }));
          bestRoomFixes = workingMez?.enabled
            ? { ...(bestRoomFixes || {}), enableMezzanine: true, mezzanineHeightCm: Math.round(workingMez.heightM * 100) }
            : bestRoomFixes;
          bestCritique = qa.critiqueTr;
          bestModel = qa.model;
        } else {
          // Score dropped (e.g. 52% -> 28%)! Immediately roll back to the highest-scoring layout and stop!
          if (onRefinePinterestScene) {
            onRefinePinterestScene(bestObjects, bestRoomFixes, 'main');
          } else {
            onApplyPinterestScene(bestObjects, styleCtx, true, 'main');
          }
          break;
        }

        // Reached >= 75% threshold OR no more fixes suggested -> lock in best state and stop!
        const hasActionableFixes =
          (qa.objectFixes && qa.objectFixes.length > 0) ||
          (qa.missingObjects && qa.missingObjects.length > 0) ||
          Boolean(qa.roomFixes?.removeWindows || qa.roomFixes?.enableMezzanine);

        if (qa.matchScore >= TARGET_SCORE || !hasActionableFixes) {
          break;
        }

        // Apply surgical fixes to produce next candidate scene for the next verification pass
        const updatedCeil = qa.roomFixes?.enableMezzanine && workingCeil < 3.85 ? 4.1 : workingCeil;
        const updatedMez: ArchMezzanine | undefined = qa.roomFixes?.enableMezzanine
          ? {
              enabled: true,
              anchorWall: workingMez?.anchorWall || 'north',
              heightM: (qa.roomFixes.mezzanineHeightCm || 205) / 100,
              depthM: workingMez?.depthM || Math.round(project.depthM * 52) / 100,
              widthRatio: workingMez?.widthRatio || 0.78,
              stairGapSide: workingMez?.stairGapSide || 'west',
              thicknessM: 0.16,
              deckColorHex: workingMez?.deckColorHex || styleCtx?.floorTintHex || '#c9b092',
              railingStyle: workingMez?.railingStyle || 'none',
              underLed: true,
            }
          : workingMez || undefined;

        const { objects: refinedObjs, appliedCount } = applyVisualCritiqueFixes(workingObjs, qa.objectFixes, {
          widthM: project.widthM,
          depthM: project.depthM,
          ceilingM: updatedCeil,
          mezzanine: updatedMez,
        });

        const addedObjs: ArchPlacedObject[] = [];
        const addedDetected: PinterestDetectedObject[] = [];
        if (qa.missingObjects && qa.missingObjects.length > 0 && !userFocusPrompt.trim()) {
          const mezB = getMezzanineBounds({
            widthM: project.widthM,
            depthM: project.depthM,
            ceilingM: updatedCeil,
            mezzanine: updatedMez,
          });
          const occG: OBB2D[] = refinedObjs
            .filter((o) => (o.floorLevel || 0) === 0 && o.mountMode !== 'rug' && o.mountMode !== 'ceiling')
            .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
          const occU: OBB2D[] = refinedObjs
            .filter((o) => o.floorLevel === 1 && o.mountMode !== 'rug' && o.mountMode !== 'ceiling')
            .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
          const wcG: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
          const wcU: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
          for (const miss of qa.missingObjects.slice(0, 2)) {
            const built = await buildInstant3DObject(
              miss,
              origImgUrl,
              occG,
              wcG,
              occU,
              wcU,
              updatedCeil,
              mezB,
              updatedMez || null
            );
            addedObjs.push(built.obj);
            addedDetected.push(miss);
          }
        }

        const combined = [...refinedObjs, ...addedObjs];
        const srcMap = new Map<string, PinterestDetectedObject>(sourceMapInput || []);
        detected.forEach((d) => srcMap.set(d.id, d));
        addedDetected.forEach((d) => srcMap.set(d.id, d));

        const nextCandidate = applyArchitecturalRelationships(
          combined,
          srcMap,
          project,
          updatedCeil,
          getMezzanineBounds({
            widthM: project.widthM,
            depthM: project.depthM,
            ceilingM: updatedCeil,
            mezzanine: updatedMez,
          })
        );

        totalApplied += appliedCount;
        totalAdded += addedObjs.length;
        workingObjs = nextCandidate;
        workingCeil = updatedCeil;
        workingMez = updatedMez || null;

        if (addedDetected.length > 0) {
          setDetected((prev) => [...prev, ...addedDetected]);
          setJobs((prev) => {
            const next = { ...prev };
            addedDetected.forEach((d) => {
              next[d.id] = { selected: true, status: 'done', progressText: 'Otomatik kontrol ile eklendi' };
            });
            return next;
          });
        }

        if (onRefinePinterestScene) {
          onRefinePinterestScene(workingObjs, qa.roomFixes, 'main');
        } else {
          onApplyPinterestScene(workingObjs, styleCtx, true, 'main');
        }

        // If this was the LAST pass and we applied edits, run one quick final verification score
        // so we can guarantee the final edits didn't regress below bestScore!
        if (pass === MAX_PASSES && (appliedCount > 0 || addedObjs.length > 0)) {
          await new Promise((r) => setTimeout(r, 700));
          const finalSnap = onCaptureViewport();
          if (finalSnap) {
            const finalCheck = await verifyAndRefinePinterestRoom({
              originalPhotoDataUrl: origImgUrl,
              rendered3dDataUrl: finalSnap,
              roomSummary: summary,
              roomWidthM: project.widthM,
              roomDepthM: project.depthM,
              roomCeilingM: workingCeil,
              placedObjects: workingObjs as unknown as Array<Record<string, unknown>>,
              userPrompt: userFocusPrompt,
              geminiKey,
            }).catch(() => null);

            if (finalCheck) {
              if (finalCheck.matchScore >= bestScore) {
                bestScore = finalCheck.matchScore;
                bestObjects = workingObjs.map((o) => ({ ...o }));
                bestRoomFixes = qa.roomFixes;
                bestCritique = finalCheck.critiqueTr;
                bestModel = finalCheck.model;
              } else {
                // Roll back final edits that hurt the score!
                if (onRefinePinterestScene) {
                  onRefinePinterestScene(bestObjects, bestRoomFixes, 'main');
                } else {
                  onApplyPinterestScene(bestObjects, styleCtx, true, 'main');
                }
              }
            }
          }
        }
      }

      if (bestScore >= 0) {
        bestQaRef.current = {
          score: bestScore,
          objects: bestObjects,
          roomFixes: bestRoomFixes,
          critiqueTr: bestCritique,
          model: bestModel,
          photoSig,
        };
        setQaResult({
          matchScore: bestScore,
          critiqueTr: bestCritique,
          fixedCount: totalApplied,
          addedCount: totalAdded,
          model: bestModel,
          passesRun,
        });
        setStatusBanner(
          `✓ Mimari kalibrasyon tamamlandı (${bestObjects.length} parça · Uyum %${bestScore}${
            totalApplied > 0 ? ` · ${totalApplied} iyileştirme` : ''
          }).`
        );
        onToast(`3B oda otomatik kalibre edildi (Uyum %${bestScore})!`);
      }
    } catch (err) {
      setStatusBanner(
        `${currentObjs.length} parça 3B odaya kuruldu (${
          err instanceof Error ? err.message.slice(0, 90) : 'ince ayar yapılabilir'
        }).`
      );
    } finally {
      setRefining(false);
    }
  };

  const handleUploadInspiration = async (file: File | null) => {
    if (!file) return;
    try {
      const norm = await normalizeRoomPhoto(file, 1400);
      const photoIdx = nextPhotoNumRef.current++;
      const newPhoto: PinterestSourcePhoto = {
        id: `ph-${Date.now()}-${photoIdx}`,
        index: photoIdx,
        dataUrl: norm.dataUrl,
        style: null,
        analyzed: false,
      };
      const hadExisting = photos.length > 0;
      setPhotos((prev) => [...prev, newPhoto]);
      setActivePhotoId(newPhoto.id);
      if (hadExisting) {
        // Sequential multi-photo workflow: keep Foto 1's 3D furniture & materials intact!
        setReplaceExistingOnBuild(false);
        onToast(`Foto ${photoIdx} eklendi — önceki fotoğrafların malzeme ve eşyaları korundu!`);
      }
      setQaResult(null);
      bestQaRef.current = null;
      setDrawMode('off');
      setDraftBox(null);
      setStatusBanner(null);
    } catch {
      onToast('Fotoğraf okunamadı — lütfen JPG/PNG/WebP seçin.');
    }
  };

  const removeSourcePhoto = (photoId: string) => {
    const remaining = photos.filter((p) => p.id !== photoId);
    setPhotos(remaining);
    if (activePhotoId === photoId) {
      setActivePhotoId(remaining[remaining.length - 1]?.id || null);
    }
    if (poolFilter === photoId) setPoolFilter('all');
    setDetected((prev) => prev.filter((d) => d.sourcePhotoId !== photoId));
    setMaterialPool((prev) => prev.filter((m) => m.sourcePhotoId !== photoId));
    setDrawMode('off');
    if (remaining.length === 0) {
      nextPhotoNumRef.current = 1;
      setQaResult(null);
      setStatusBanner(null);
    }
  };

  const clearAllPhotos = () => {
    setPhotos([]);
    setActivePhotoId(null);
    setDetected([]);
    setMaterialPool([]);
    setJobs({});
    setPoolFilter('all');
    setQaResult(null);
    bestQaRef.current = null;
    setDrawMode('off');
    setStatusBanner(null);
    nextPhotoNumRef.current = 1;
  };

  const handleAddCustomMaterial = () => {
    const defaultLabel =
      customMatKind === 'floor'
        ? `Özel Zemin · ${FLOOR_LABELS_TR[customMatFloor]}`
        : customMatKind === 'curtain'
        ? 'Özel Perde Kumaşı'
        : customMatKind === 'accentWall'
        ? `Özel Panel · ${WALL_PATTERN_LABELS_TR[customMatWallPat]}`
        : `Özel Duvar · ${WALL_PATTERN_LABELS_TR[customMatWallPat]}`;
    const entry: PinterestMaterialEntry = {
      id: `custom-mat-${Date.now()}`,
      sourcePhotoId: activePhoto?.id || 'custom',
      sourceLabel: activePhoto ? `Foto ${activePhoto.index} +` : 'Özel',
      kind: customMatKind,
      label: customMatName.trim() || defaultLabel,
      colorHex: customMatHex,
      wallPattern: customMatKind === 'wall' || customMatKind === 'accentWall' ? customMatWallPat : undefined,
      floorMaterial: customMatKind === 'floor' ? customMatFloor : undefined,
    };
    setMaterialPool((prev) => [entry, ...prev]);
    onApplySingleMaterial?.(entry, targetRoomId);
    setCustomMatName('');
    setShowAddMaterialForm(false);
  };

  const handleAnalyze = async () => {
    if (!photoDataUrl || !activePhoto) return;
    if (!hasGeminiAccess) {
      setShowKeyBox(true);
      onToast('Önce motor bağlantı anahtarını girin.');
      return;
    }
    const curPhoto = activePhoto;
    const tRoom = getTargetRoomRect();
    setAnalyzing(true);
    setQaResult(null);
    bestQaRef.current = null;
    setDrawMode('off');
    setStatusBanner(`Adım 1/3 · Foto ${curPhoto.index} analiz ediliyor (${tRoom.name})...`);
    try {
      const res = await analyzePinterestRoom({
        imageDataUrl: curPhoto.dataUrl,
        roomWidthM: tRoom.w,
        roomDepthM: tRoom.d,
        roomCeilingM: project.ceilingM,
        userPrompt: userFocusPrompt,
        geminiKey,
      });

      // Filter out curtains/windows emitted as fake wall_art when roomStyle already builds real 3D curtains
      const hasArchitecturalCurtains =
        Boolean(res.roomStyle?.hasVisibleWindow) ||
        (Array.isArray(res.roomStyle?.windowWalls) && res.roomStyle.windowWalls.length > 0);
      const filteredRawObjects = res.detectedObjects.filter((o) => {
        if (
          hasArchitecturalCurtains &&
          (o.parametricKind === 'wall_art' || o.parametricKind === 'wall_mirror' || o.category === 'Dekor') &&
          /(perde|curtain|drape|tül\b|pencere|window)/i.test(`${o.id} ${o.nameTr}`)
        ) {
          return false;
        }
        return true;
      });

      const taggedObjects: PoolDetectedItem[] = filteredRawObjects.map((o) => ({
        ...o,
        id: `${curPhoto.id}-${o.id}`,
        // Preserve parent-child anchor links after prefixing ids! (Previously broke ALL TV-above-baza & flower-on-baza anchors!)
        anchorToId: o.anchorToId ? `${curPhoto.id}-${o.anchorToId}` : '',
        sourcePhotoId: curPhoto.id,
        sourcePhotoIndex: curPhoto.index,
      }));
      const extractedMaterials = res.roomStyle
        ? buildMaterialEntriesFromStyle(curPhoto.id, `Foto ${curPhoto.index}`, res.roomStyle)
        : [];

      setPhotos((prev) =>
        prev.map((p) => (p.id === curPhoto.id ? { ...p, style: res.roomStyle, analyzed: true } : p))
      );
      setDetected((prev) => [...prev.filter((d) => d.sourcePhotoId !== curPhoto.id), ...taggedObjects]);
      setMaterialPool((prev) => [
        ...prev.filter((m) => m.sourcePhotoId !== curPhoto.id),
        ...extractedMaterials,
      ]);
      setJobs((prev) => {
        const next = { ...prev };
        taggedObjects.forEach((o) => {
          next[o.id] = { selected: true, status: 'idle' };
        });
        return next;
      });

      // On Photo 1 (with no narrow focus prompt), cleanly replace ONLY this target room's old furniture
      // so leftover objects from previous rooms/demos never pollute the new Pinterest reconstruction;
      // on Photo 2+ NEVER wipe prior photos' furniture!
      const effectiveReplace =
        photos.length > 1
          ? false
          : replaceExistingOnBuild || !userFocusPrompt.trim();

      if (autoPopulateOnAnalyze && taggedObjects.length > 0) {
        setStatusBanner(
          `Adım 2/3 · Foto ${curPhoto.index} içindeki ${taggedObjects.length} parça ve ${extractedMaterials.length} malzeme odaya ekleniyor...`
        );
        await assembleAllInstantIn3D(taggedObjects, res.roomStyle, curPhoto.dataUrl, effectiveReplace);
      } else {
        setStatusBanner(
          `Foto ${curPhoto.index}: ${taggedObjects.length} eşya ve ${extractedMaterials.length} malzeme havuza eklendi. İstediğini seçip odaya koyabilirsin.`
        );
        void Promise.all(
          taggedObjects.map(async (item) => {
            const url = await cropBoxFromDataUrl(curPhoto.dataUrl, item.box2d, 0.025).catch(() => undefined);
            if (!url) return;
            setJobs((prev) => (prev[item.id] ? { ...prev, [item.id]: { ...prev[item.id], cropPreviewUrl: url } } : prev));
          })
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pinterest analizi başarısız oldu.';
      setStatusBanner(`Hata: ${msg}`);
      onToast(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const updateDetectedItem = (id: string, patch: Partial<PinterestDetectedObject>) => {
    setDetected((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeDetectedItem = (id: string) => {
    const placed = findPlacedObjForItem(id);
    if (placed) onRemoveObjectInRoom(placed.id);
    setDetected((prev) => prev.filter((it) => it.id !== id));
    setJobs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (hoveredId === id) setHoveredId(null);
    if (drawMode === id) setDrawMode('off');
  };

  // Interactive Pointer Drag on the Pinterest Photo (draw new item or redraw tight box!)
  const getRelativePct = (clientX: number, clientY: number) => {
    const el = photoWrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1000, Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * 1000)));
    const y = Math.max(0, Math.min(1000, Math.round(((clientY - rect.top) / Math.max(1, rect.height)) * 1000)));
    return { x, y };
  };

  const handlePhotoPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawMode === 'off') return;
    const pt = getRelativePct(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraftBox({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
  };

  const handlePhotoPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draftBox || drawMode === 'off') return;
    const pt = getRelativePct(e.clientX, e.clientY);
    if (!pt) return;
    setDraftBox((prev) => (prev ? { ...prev, x1: pt.x, y1: pt.y } : null));
  };

  const handlePhotoPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draftBox || drawMode === 'off' || !photoDataUrl) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const xmin = Math.min(draftBox.x0, draftBox.x1);
    const xmax = Math.max(draftBox.x0, draftBox.x1);
    const ymin = Math.min(draftBox.y0, draftBox.y1);
    const ymax = Math.max(draftBox.y0, draftBox.y1);
    const activeDrawTarget = drawMode;
    setDraftBox(null);
    setDrawMode('off');

    if (xmax - xmin < 28 || ymax - ymin < 28) {
      onToast('Daha büyük bir dikdörtgen sürükleyerek eşyayı seçin.');
      return;
    }

    const box2d: [number, number, number, number] = [ymin, xmin, ymax, xmax];
    const preview = await cropBoxFromDataUrl(photoDataUrl, box2d, 0.02).catch(() => undefined);

    if (activeDrawTarget !== 'new') {
      updateDetectedItem(activeDrawTarget, { box2d });
      setJobs((prev) => ({
        ...prev,
        [activeDrawTarget]: {
          ...(prev[activeDrawTarget] || { selected: true, status: 'idle' }),
          cropPreviewUrl: preview,
          studioPreviewUrl: undefined,
          errorMsg: undefined,
        },
      }));
      onToast('Seçim kutusu güncellendi — kırpım önizlemesi yenilendi.');
      return;
    }

    const newId = `${activePhoto?.id || 'ph'}-drawn-${Date.now()}`;
    const cx = ((xmin + xmax) * 0.5) / 1000;
    const cy = ((ymin + ymax) * 0.5) / 1000;
    const sampled = preview ? await sampleDominantHexFromDataUrl(preview) : '#8b7f70';
    const placeholder: PoolDetectedItem = {
      id: newId,
      sourcePhotoId: activePhoto?.id,
      sourcePhotoIndex: activePhoto?.index,
      nameTr: 'Seçilen Parça (Tanımlanıyor...)',
      category: 'Dekor',
      primaryColorHex: sampled,
      accentColorHex: '#2a2927',
      box2d,
      widthCm: 90,
      depthCm: 60,
      heightCm: 90,
      mountMode: 'floor',
      suggestedWall: 'north',
      elevationCm: 0,
      relativeX: Number(((cx - 0.5) * 1.4).toFixed(2)),
      relativeZ: Number(((cy - 0.5) * 1.4).toFixed(2)),
      facingDeg: 0,
      visualDescriptionEn: 'Exact cropped furniture or decor piece selected from the room photo',
    };
    setDetected((prev) => [...prev, placeholder]);
    setJobs((prev) => ({
      ...prev,
      [newId]: { selected: true, status: 'idle', cropPreviewUrl: preview },
    }));
    setHoveredId(newId);

    if (preview && hasGeminiAccess) {
      const info = await identifyCroppedPinterestObject({
        croppedImageDataUrl: preview,
        fullRoomImageDataUrl: photoDataUrl,
        geminiKey,
      });
      const finalItem: PinterestDetectedObject = info
        ? {
            ...placeholder,
            nameTr: info.nameTr || 'Seçilen Parça',
            category: info.category || 'Dekor',
            parametricKind: info.parametricKind,
            primaryColorHex: isValidHexColor(info.primaryColorHex) ? info.primaryColorHex : sampled,
            accentColorHex: isValidHexColor(info.accentColorHex) ? info.accentColorHex : '#2a2927',
            widthCm: Number(info.widthCm) || 90,
            depthCm: Number(info.depthCm) || 60,
            heightCm: Number(info.heightCm) || 90,
            mountMode: info.mountMode || 'floor',
            elevationCm: Number(info.elevationCm) || 0,
            visualDescriptionEn: info.visualDescriptionEn || placeholder.visualDescriptionEn,
          }
        : { ...placeholder, nameTr: 'Özel Seçilen Parça' };

      updateDetectedItem(newId, finalItem);
      // Place immediately in active target 3D room!
      const tRoom = getTargetRoomRect();
      const occupied: OBB2D[] = project.objects
        .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && isObjInRoomRect(o, tRoom))
        .map((o) => ({
          id: o.id,
          x: o.x - tRoom.cx,
          z: o.z - tRoom.cz,
          rot: o.rot,
          halfW: o.widthM * 0.5,
          halfD: o.depthM * 0.5,
        }));
      const built = await buildInstant3DObject(finalItem, photoDataUrl, occupied, { north: [], east: [], south: [], west: [] }, [], { north: [], east: [], south: [], west: [] }, project.ceilingM, getMezzanineBounds(project), project.mezzanine?.enabled ? project.mezzanine : null, tRoom);
      onAddGeneratedObject(built.obj);
      setJobs((prev) => ({
        ...prev,
        [newId]: {
          ...(prev[newId] || { selected: true }),
          status: 'done',
          cropPreviewUrl: built.cropPreview,
          progressText: `${tRoom.name} içine eklendi`,
        },
      }));
      onToast(`"${finalItem.nameTr}" ${tRoom.name} içine eklendi!`);
    } else {
      updateDetectedItem(newId, { nameTr: 'Özel Seçilen Parça' });
    }
  };

  /**
   * Instant 0.1s placement of a single item into the chosen target 3D room!
   */
  const placeSingleInstantIn3D = async (item: PoolDetectedItem) => {
    const itemPhotoUrl = getPhotoUrlForItem(item);
    if (!itemPhotoUrl) return;
    const tRoom = getTargetRoomRect();
    const occupied: OBB2D[] = project.objects
      .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && o.pinterestItemId !== item.id && isObjInRoomRect(o, tRoom))
      .map((o) => ({
        id: o.id,
        x: o.x - tRoom.cx,
        z: o.z - tRoom.cz,
        rot: o.rot,
        halfW: o.widthM * 0.5,
        halfD: o.depthM * 0.5,
      }));
    const built = await buildInstant3DObject(item, itemPhotoUrl, occupied, { north: [], east: [], south: [], west: [] }, [], { north: [], east: [], south: [], west: [] }, project.ceilingM, getMezzanineBounds(project), project.mezzanine?.enabled ? project.mezzanine : null, tRoom);
    onAddGeneratedObject(built.obj);
    setJobs((prev) => ({
      ...prev,
      [item.id]: {
        ...(prev[item.id] || { selected: true }),
        status: 'done',
        cropPreviewUrl: built.cropPreview,
        rawCropUrl: built.rawCrop,
        progressText: `${tRoom.name} içinde — tıklayıp düzenle`,
      },
    }));
    onToast(`"${item.nameTr}" ${tRoom.name} içine yerleştirildi!`);
  };

  /**
   * Optional High-Detail Sculptural Upgrade: replaces an item in-place with a RunPod Hunyuan3D-2.1 2K PBR .GLB!
   */
  const upgradeItemWithRunPod3D = async (item: PoolDetectedItem) => {
    const itemPhotoUrl = getPhotoUrlForItem(item);
    if (!itemPhotoUrl) return;
    setJobs((prev) => ({
      ...prev,
      [item.id]: {
        ...(prev[item.id] || { selected: true }),
        status: 'isolating',
        progressText: '2K PBR için hazırlanıyor...',
        errorMsg: undefined,
      },
    }));

    try {
      const croppedUrl = await cropBoxFromDataUrl(itemPhotoUrl, item.box2d, 0.025);
      let modelInputImage = croppedUrl;
      let usedDirectCrop = false;

      if (hasGeminiAccess && !geminiImageQuotaBlockedRef.current) {
        try {
          const iso = await isolatePinterestObject({
            fullRoomImageDataUrl: itemPhotoUrl,
            croppedImageDataUrl: croppedUrl,
            item,
            geminiKey,
          });
          modelInputImage = iso.studioImageDataUrl;
        } catch (isoErr) {
          const errStr = isoErr instanceof Error ? isoErr.message : String(isoErr);
          usedDirectCrop = true;
          if (isGeminiQuotaZeroError(errStr)) {
            geminiImageQuotaBlockedRef.current = true;
            setGeminiImageQuotaNote(true);
          }
        }
      } else {
        usedDirectCrop = true;
      }

      setJobs((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] || { selected: true }),
          status: 'modeling',
          cropPreviewUrl: croppedUrl,
          studioPreviewUrl: modelInputImage,
          usedDirectCrop,
          progressText: 'RunPod 2K PBR 3B örüyor...',
        },
      }));

      const mem = getMembershipState();
      const runOnce = () =>
        generateFurniture3DServerless({
          engine: 'runpod',
          images: { front: modelInputImage },
          name: item.nameTr,
          widthCm: item.widthCm,
          depthCm: item.depthCm,
          heightCm: item.heightCm,
          runpodApiKey: mem.runpodApiKey || undefined,
          runpod3dEndpointId: mem.runpod3dEndpointId || undefined,
          runpodGpuTier: mem.runpodGpuTier || 'RTX4090',
          falApiKey: mem.falApiKey || undefined,
          onProgress: (msg: string) => {
            setStatusBanner(`${item.nameTr}: ${msg}`);
            setJobs((prev) => ({
              ...prev,
              [item.id]: { ...(prev[item.id] || { selected: true }), progressText: msg },
            }));
          },
        });

      let gen;
      try {
        gen = await runOnce();
      } catch (firstErr) {
        const em = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (/libusb|ImportError|timeout|502|503|FAILED/i.test(em)) {
          gen = await runOnce();
        } else {
          throw firstErr;
        }
      }

      const glbUrl = gen.remoteGlbUrl || gen.localBlobUrl;
      const tRoom = getTargetRoomRect();
      const occupied: OBB2D[] = project.objects
        .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && o.pinterestItemId !== item.id && isObjInRoomRect(o, tRoom))
        .map((o) => ({
          id: o.id,
          x: o.x - tRoom.cx,
          z: o.z - tRoom.cz,
          rot: o.rot,
          halfW: o.widthM * 0.5,
          halfD: o.depthM * 0.5,
        }));
      const base = await buildInstant3DObject(item, itemPhotoUrl, occupied, { north: [], east: [], south: [], west: [] }, [], { north: [], east: [], south: [], west: [] }, project.ceilingM, getMezzanineBounds(project), project.mezzanine?.enabled ? project.mezzanine : null, tRoom);
      const upgradedObj: ArchPlacedObject = {
        ...base.obj,
        glbUrl,
        parametricKind: undefined,
        thumbUrl: modelInputImage,
      };
      onAddGeneratedObject(upgradedObj);

      setJobs((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] || { selected: true }),
          status: 'done',
          cropPreviewUrl: croppedUrl,
          studioPreviewUrl: modelInputImage,
          usedDirectCrop,
          progressText: '2K PBR .GLB yükseltildi',
        },
      }));
      onToast(`${item.nameTr} RunPod 2K PBR .GLB modeline yükseltildi!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'RunPod 3B üretim hatası';
      setJobs((prev) => ({
        ...prev,
        [item.id]: { ...(prev[item.id] || { selected: true }), status: 'error', errorMsg: msg },
      }));
      onToast(`${item.nameTr}: ${msg}`);
    }
  };

  const HERO_RUNPOD_PRIORITY: Partial<Record<ParametricFurnitureKind, number>> = {
    sofa: 1,
    bed_frame: 2,
    armchair: 3,
    chandelier: 4,
    dining_table: 5,
    coffee_table_rect: 6,
    coffee_table_round: 6,
    fireplace_marble: 7,
    linear_fireplace: 7,
    dining_chair: 8,
    vanity_table: 9,
    desk: 9,
    ottoman: 10,
    sideboard: 11,
    console_table: 11,
    decorative_vase: 12,
    potted_plant: 13,
  };

  const heroRunPodCandidates = detected
    .filter((d) => {
      if (activePhoto && d.sourcePhotoId && d.sourcePhotoId !== activePhoto.id) return false;
      const arch = resolvePinterestArchetype(d);
      if (!(arch in HERO_RUNPOD_PRIORITY)) return false;
      const placed = findPlacedObjForItem(d.id);
      if (placed?.glbUrl) return false;
      return true;
    })
    .sort(
      (a, b) =>
        (HERO_RUNPOD_PRIORITY[resolvePinterestArchetype(a)] || 99) -
        (HERO_RUNPOD_PRIORITY[resolvePinterestArchetype(b)] || 99)
    )
    .slice(0, 4);

  const handleAutoUpgradeHero3D = async () => {
    if (heroUpgrading || heroRunPodCandidates.length === 0) return;
    const queue = [...heroRunPodCandidates];
    let doneCount = 0;
    setHeroUpgrading({ done: 0, total: queue.length });
    setStatusBanner(
      `RunPod RTX 4090 · ${queue.length} ana mobilya fotoğraftan birebir 3B (.GLB) olarak örülüyor...`
    );
    try {
      const worker = async () => {
        while (queue.length > 0) {
          const nextItem = queue.shift();
          if (!nextItem) break;
          await upgradeItemWithRunPod3D(nextItem);
          doneCount += 1;
          setHeroUpgrading({ done: doneCount, total: heroRunPodCandidates.length });
          setStatusBanner(
            `Birebir 3B Mesh: ${doneCount}/${heroRunPodCandidates.length} ana mobilya sahnede güncellendi...`
          );
        }
      };
      // 2 parallel RTX 4090 serverless workers cut total wall time in half (~60-90s for 4 hero pieces!)
      await Promise.all([worker(), worker()]);
      setStatusBanner(
        `✓ ${doneCount} ana mobilya fotoğraftan birebir 2K PBR 3B (.GLB) olarak sahneye yerleştirildi!`
      );
      onToast(`${doneCount} ana mobilya birebir 3B (.GLB) modele yükseltildi!`);
    } finally {
      setHeroUpgrading(null);
    }
  };

  const handleRebuildSelectedInstant = async () => {
    if (!photoDataUrl) return;
    const targets = detected.filter(
      (d) => jobs[d.id]?.selected && (poolFilter === 'all' || d.sourcePhotoId === poolFilter)
    );
    if (targets.length === 0) {
      onToast('Önce odaya kurulacak en az bir parça seçin.');
      return;
    }
    setBatchRunning(true);
    try {
      await assembleAllInstantIn3D(targets, roomStyle, photoDataUrl, photos.length > 1 ? false : replaceExistingOnBuild);
    } finally {
      setBatchRunning(false);
    }
  };

  const handlePhotorealRender = async () => {
    if (!hasGeminiAccess) {
      setShowKeyBox(true);
      onToast('Fotogerçekçi render için Google Gemini API anahtarı gerekli.');
      return;
    }
    const snap = onCaptureViewport();
    if (!snap) return;
    setRenderingPhoto(true);
    setRenderError(null);
    try {
      const summary = `${project.widthM.toFixed(1)}×${project.depthM.toFixed(1)}×${project.ceilingM.toFixed(
        2
      )} m room, ${project.windows.length} windows, ${project.doors.length} doors, ${
        project.curtainCoves.length
      } recessed LED curtain coves, sun hour ${project.sun.hour.toFixed(1)}.`;
      const res = await generatePhotorealRender({
        snapshotDataUrl: snap,
        referencePhotoDataUrl: photoDataUrl || undefined,
        styleNote: renderStyleNote,
        roomSummary: summary,
        geminiKey,
      });
      setPhotorealResult(res.renderImageDataUrl);
      onToast('Fotogerçekçi mimari sunum renderı hazır!');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Render üretilemedi';
      if (isGeminiQuotaZeroError(raw)) {
        setGeminiImageQuotaNote(true);
        setRenderError(
          'Google AI Studio Free Tier hesabında görsel üretim kotası 0 olarak sınırlıdır. Fotogerçekçi V-Ray Render için Google AI Studio Billing etkinleştirilmelidir.'
        );
      } else {
        setRenderError(raw);
      }
      onToast('Fotogerçekçi render alınamadı — ayrıntı aşağıda.');
    } finally {
      setRenderingPhoto(false);
    }
  };

  const selectedCount = detected.filter((d) => jobs[d.id]?.selected).length;
  const activeHoverItem = detected.find((d) => d.id === hoveredId) || null;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="space-y-4 text-xs relative"
    >
      {isDraggingFile && (
        <div className="pointer-events-none fixed lg:absolute inset-0 z-40 bg-stone-950/80 border-2 border-dashed border-white flex flex-col items-center justify-center text-white text-center p-4 gap-2">
          <Upload className="w-7 h-7" />
          <p className="font-bold text-sm">Fotoğrafı Buraya Bırak</p>
          <p className="text-[11px] text-stone-200">Bilgisayardan veya Pinterest sekmesinden doğrudan sürükleyebilirsin</p>
        </div>
      )}
      {/* Compact Engine Status & API Key Toggle */}
      <div className="border border-stone-200 bg-[#faf9f6] px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-stone-950 truncate">Fotoğraftan 3B Oda &amp; Eşya</p>
            <p className="text-[10px] font-mono text-stone-500 flex items-center gap-2 mt-0.5">
              <span className={hasGeminiAccess ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                ● {hasGeminiAccess ? 'Motor Hazır' : 'Anahtar Gerekli'}
              </span>
              {runpodReady && <span className="text-emerald-700 font-semibold">● 2K PBR</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowKeyBox((v) => !v)}
            className={`px-2 py-1 border text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition ${
              showKeyBox
                ? 'border-stone-950 bg-stone-950 text-white'
                : 'border-stone-300 hover:border-stone-950 bg-white text-stone-800'
            }`}
          >
            <KeyRound className="w-3 h-3" />
            <span>API</span>
          </button>
        </div>

        {showKeyBox && (
          <div className="pt-2 border-t border-stone-200 space-y-2">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
              Gemini (AIza...) · Groq Ücretsiz (gsk_...) · OpenAI (sk-...)
            </label>
            <div className="flex items-center gap-1.5 min-w-0">
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => {
                  setGeminiKey(e.target.value);
                  setKeyTestResult(null);
                  geminiImageQuotaBlockedRef.current = false;
                  setGeminiImageQuotaNote(false);
                }}
                placeholder="AIzaSy... / gsk_... / sk-..."
                className="flex-1 min-w-0 w-full px-2 py-1.5 border border-stone-300 bg-white font-mono text-[11px]"
              />
              <button
                type="button"
                disabled={testingKey}
                onClick={async () => {
                  const clean = geminiKey.trim();
                  saveGeminiKey(clean);
                  if (!clean) {
                    setKeyTestResult(null);
                    onToast('Oturum anahtarı temizlendi.');
                    return;
                  }
                  setTestingKey(true);
                  setKeyTestResult('Test ediliyor...');
                  try {
                    if (clean.startsWith('gsk_')) {
                      const r = await fetch('https://api.groq.com/openai/v1/models', {
                        headers: { Authorization: `Bearer ${clean}` },
                      });
                      if (r.ok) {
                        setKeyTestResult('✓ Groq Llama-4 Vision doğrulandı (Ücretsiz & 503 yok!)');
                        onToast('Groq API anahtarı doğrulandı ve kaydedildi!');
                      } else {
                        const d = await r.json().catch(() => null);
                        setKeyTestResult(`Hata: ${d?.error?.message || 'Groq anahtarı geçersiz'}`);
                      }
                    } else if (clean.startsWith('sk-or-')) {
                      const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
                        headers: { Authorization: `Bearer ${clean}` },
                      });
                      if (r.ok) {
                        setKeyTestResult('✓ OpenRouter Vision doğrulandı');
                        onToast('OpenRouter API anahtarı doğrulandı!');
                      } else {
                        setKeyTestResult('Hata: OpenRouter anahtarı geçersiz');
                      }
                    } else if (clean.startsWith('sk-')) {
                      const r = await fetch('https://api.openai.com/v1/models', {
                        headers: { Authorization: `Bearer ${clean}` },
                      });
                      if (r.ok) {
                        setKeyTestResult('✓ OpenAI Vision doğrulandı (GPT-4.1/4o hazır)');
                        onToast('OpenAI API anahtarı doğrulandı ve kaydedildi!');
                      } else {
                        const d = await r.json().catch(() => null);
                        setKeyTestResult(`Hata: ${d?.error?.message || 'OpenAI anahtarı geçersiz'}`);
                      }
                    } else {
                      const r = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=5&key=${encodeURIComponent(clean)}`
                      );
                      if (r.ok) {
                        setKeyTestResult('✓ Bağlantı doğrulandı (Vision AI hazır)');
                        onToast('Gemini API anahtarı doğrulandı ve kaydedildi!');
                      } else {
                        const d = await r.json().catch(() => null);
                        setKeyTestResult(`Hata: ${d?.error?.message || 'Anahtar geçersiz'}`);
                      }
                    }
                  } catch {
                    setKeyTestResult('Kaydedildi (doğrulama için Pinterest analizi deneyin).');
                  } finally {
                    setTestingKey(false);
                  }
                }}
                className="shrink-0 px-2.5 py-1.5 bg-stone-950 text-white text-[11px] font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {testingKey ? '...' : 'Kaydet & Test'}
              </button>
            </div>
            {keyTestResult && (
              <p
                className={`text-[10px] font-mono break-words ${
                  keyTestResult.startsWith('✓') ? 'text-emerald-700 font-semibold' : 'text-amber-700'
                }`}
              >
                {keyTestResult}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 1: Multi-Photo Reference Upload & Switcher */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Referans Fotoğraflar {photos.length > 0 ? `(${photos.length})` : '(Pinterest / Kamera)'}
          </span>
          {photoDataUrl && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDrawMode((m) => (m === 'new' ? 'off' : 'new'))}
                className={`px-2 py-0.5 border text-[10px] font-semibold flex items-center gap-1 transition ${
                  drawMode === 'new'
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-300 bg-white text-stone-800 hover:border-stone-950'
                }`}
                title="Fotoğrafın üstünde dikdörtgen çizerek eksik kalan eşyayı ekle"
              >
                <Crop className="w-3 h-3" />
                <span>{drawMode === 'new' ? 'İptal' : 'Alan Çiz'}</span>
              </button>
              <button
                type="button"
                onClick={clearAllPhotos}
                className="text-[10px] text-stone-500 hover:text-red-700 underline"
                title="Tüm referans fotoğrafları ve havuzu temizle"
              >
                Temizle
              </button>
            </div>
          )}
        </div>

        {/* Sequential Multi-Photo Thumbnail Strip: Add Photo 2, Photo 3... while keeping Photo 1's materials & items! */}
        {photos.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {photos.map((ph) => {
              const isCur = activePhoto?.id === ph.id;
              return (
                <div
                  key={ph.id}
                  className={`relative shrink-0 border transition ${
                    isCur ? 'border-stone-950 ring-1 ring-stone-950' : 'border-stone-300 hover:border-stone-600'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActivePhotoId(ph.id);
                      setDrawMode('off');
                    }}
                    className="block w-14 h-12 bg-stone-100 overflow-hidden"
                    title={`Foto ${ph.index} — tıklayıp görüntüle`}
                  >
                    <img src={ph.dataUrl} alt={`Foto ${ph.index}`} className="w-full h-full object-cover" />
                    <span
                      className={`absolute bottom-0 left-0 right-0 text-[9px] font-mono font-bold text-center leading-tight py-0.5 ${
                        isCur ? 'bg-stone-950/90 text-white' : 'bg-white/85 text-stone-900'
                      }`}
                    >
                      Foto {ph.index}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSourcePhoto(ph.id);
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-stone-950 text-white flex items-center justify-center hover:bg-red-700"
                    title={`Foto ${ph.index} kaldır`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            })}
            <label
              className="shrink-0 w-16 h-12 border border-dashed border-stone-400 hover:border-stone-950 bg-[#faf9f6] hover:bg-white flex flex-col items-center justify-center gap-0.5 cursor-pointer text-[9px] font-semibold text-stone-700 hover:text-stone-950 transition"
              title="Art arda 2. veya 3. Pinterest fotoğrafı ekle (önceki malzeme ve eşyalar korunur)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Foto</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleUploadInspiration(e.target.files?.[0] || null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        )}

        {!photoDataUrl ? (
          <div className="space-y-2">
            <label
              className={`block border-2 border-dashed p-5 text-center cursor-pointer transition ${
                isDraggingFile
                  ? 'border-stone-950 bg-stone-100'
                  : 'border-stone-400 hover:border-stone-950 bg-white'
              }`}
            >
              <Upload className="w-5 h-5 mx-auto text-stone-500 mb-1.5" />
              <p className="font-semibold text-stone-900">Fotoğrafı Sürükle-Bırak, Seç veya Ctrl+V</p>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Masaüstünden ya da Pinterest sekmesinden doğrudan buraya sürükleyebilirsin
              </p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleUploadInspiration(e.target.files?.[0] || null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <label className="w-full py-2 border border-stone-950 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition">
              <Camera className="w-3.5 h-3.5" />
              <span>Tablet / Telefon Kamerasıyla Fotoğraf Çek</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  handleUploadInspiration(e.target.files?.[0] || null);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void importImageFromUrl(imageUrlInput);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="url"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="Pinterest / görsel linki yapıştır (https://...)"
                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-stone-300 text-[11px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-950"
              />
              <button
                type="submit"
                disabled={importingUrl || !imageUrlInput.trim()}
                className="px-2.5 py-1.5 border border-stone-950 bg-white hover:bg-stone-100 disabled:opacity-40 text-stone-950 text-[11px] font-semibold whitespace-nowrap shrink-0 transition"
              >
                {importingUrl ? '...' : 'Getir'}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-2">
            {drawMode !== 'off' && (
              <div className="px-2.5 py-1.5 bg-stone-950 text-white text-[10px] flex items-center justify-between gap-2">
                <span>
                  {drawMode === 'new'
                    ? 'Fotoğrafta eklemek istediğin eşyanın etrafını sürükle — anında 3B odaya eklenir'
                    : 'Seçili eşyanın yeni sıkı kutusunu fotoğrafta sürükleyerek çiz'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDrawMode('off');
                    setDraftBox(null);
                  }}
                  className="underline shrink-0"
                >
                  Vazgeç
                </button>
              </div>
            )}

            <div
              ref={photoWrapRef}
              onPointerDown={handlePhotoPointerDown}
              onPointerMove={handlePhotoPointerMove}
              onPointerUp={handlePhotoPointerUp}
              className={`relative border border-stone-300 bg-stone-100 overflow-hidden select-none ${
                drawMode !== 'off' ? 'cursor-crosshair touch-none' : ''
              }`}
            >
              <img src={photoDataUrl} alt="Pinterest referans" className="w-full h-auto block pointer-events-none" />

              {drawMode === 'off' &&
                detected
                  .filter((it) => !it.sourcePhotoId || it.sourcePhotoId === activePhoto?.id)
                  .map((item, i) => {
                  const [ymin, xmin, ymax, xmax] = item.box2d;
                  const isSel = jobs[item.id]?.selected;
                  const isHov = hoveredId === item.id;
                  const col = BOX_COLORS[i % BOX_COLORS.length];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId((cur) => (cur === item.id ? null : cur))}
                      onClick={() => {
                        const placed = findPlacedObjForItem(item.id);
                        if (placed) {
                          onSelectObjectInRoom(placed.id);
                        } else {
                          setJobs((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...(prev[item.id] || { status: 'idle', selected: false }),
                              selected: !prev[item.id]?.selected,
                            },
                          }));
                        }
                      }}
                      style={{
                        top: `${ymin / 10}%`,
                        left: `${xmin / 10}%`,
                        width: `${Math.max(3, (xmax - xmin) / 10)}%`,
                        height: `${Math.max(3, (ymax - ymin) / 10)}%`,
                        borderColor: col,
                        backgroundColor: isHov ? `${col}33` : isSel ? `${col}14` : 'transparent',
                        zIndex: isHov ? 25 : isSel ? 15 : 10,
                      }}
                      className={`absolute transition text-left ${isHov ? 'border-2 shadow-sm' : 'border-[1.5px]'}`}
                      title={`${i + 1}. ${item.nameTr} (${Math.round(item.widthCm)}×${Math.round(item.depthCm)}×${Math.round(
                        item.heightCm
                      )} cm)`}
                    >
                      <span
                        style={{ backgroundColor: col }}
                        className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[9px] font-mono font-bold text-white leading-none shadow-sm"
                      >
                        {i + 1}
                      </span>
                    </button>
                  );
                })}

              {draftBox && (
                <div
                  style={{
                    left: `${Math.min(draftBox.x0, draftBox.x1) / 10}%`,
                    top: `${Math.min(draftBox.y0, draftBox.y1) / 10}%`,
                    width: `${Math.abs(draftBox.x1 - draftBox.x0) / 10}%`,
                    height: `${Math.abs(draftBox.y1 - draftBox.y0) / 10}%`,
                  }}
                  className="absolute border-2 border-stone-950 bg-white/25 z-30 pointer-events-none"
                />
              )}
            </div>

            {activeHoverItem && (
              <div className="px-2.5 py-1 bg-stone-950 text-white text-[10px] font-mono flex items-center justify-between gap-2">
                <span className="truncate">
                  #{detected.findIndex((d) => d.id === activeHoverItem.id) + 1} · {activeHoverItem.nameTr}
                </span>
                <span className="shrink-0 opacity-80">
                  {Math.round(activeHoverItem.widthCm)}×{Math.round(activeHoverItem.depthCm)}×{Math.round(activeHoverItem.heightCm)} cm
                </span>
              </div>
            )}

            {/* Item #2: Clean Focus / Exclusion Prompt Box */}
            <div className="border border-stone-200 bg-white p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-stone-800">
                  Ne Modellenmeli? <span className="font-normal text-stone-400">(Opsiyonel)</span>
                </span>
                {userFocusPrompt && (
                  <button
                    type="button"
                    onClick={() => setUserFocusPrompt('')}
                    className="text-[10px] text-stone-500 hover:text-stone-950 underline"
                  >
                    Temizle
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={userFocusPrompt}
                onChange={(e) => setUserFocusPrompt(e.target.value)}
                placeholder='Örn: "Sadece ortadaki sehpayı al; çiçek, tablo ve halıyı ekleme"'
                className="w-full px-2 py-1.5 border border-stone-300 bg-[#faf9f6] text-[11px] text-stone-950 placeholder:text-stone-400 resize-none leading-snug focus:border-stone-950 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1">
                {FOCUS_PROMPT_PRESETS.map((pr) => {
                  const active = userFocusPrompt.trim() === pr.prompt.trim();
                  return (
                    <button
                      key={pr.label}
                      type="button"
                      onClick={() => setUserFocusPrompt(pr.prompt)}
                      className={`px-1.5 py-0.5 border text-[10px] font-medium transition ${
                        active
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-950'
                      }`}
                    >
                      {pr.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Inline Multi-Room Target Picker (shown directly whenever apartment has 2+ rooms!) */}
            {(project.adjacentRooms?.length || 0) > 0 && (
              <div className="flex items-center gap-2 border border-stone-200 bg-[#faf9f6] px-2.5 py-1.5">
                <span className="text-[10px] font-semibold text-stone-600 whitespace-nowrap">Hedef Oda:</span>
                <select
                  value={targetRoomId}
                  onChange={(e) => setTargetRoomId(e.target.value)}
                  className="flex-1 min-w-0 px-1.5 py-1 border border-stone-300 bg-white text-[11px] font-semibold text-stone-950"
                >
                  <option value="main">Ana Salon ({project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m)</option>
                  {(project.adjacentRooms || []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.widthM.toFixed(1)}×{r.depthM.toFixed(1)} m)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Collapsible Placement & Calibration Options (keeps primary CTA crisp & clutter-free) */}
            <div className="border border-stone-200 bg-[#faf9f6]">
              <button
                type="button"
                onClick={() => setShowAdvancedOptions((v) => !v)}
                className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left hover:bg-stone-100/70 transition"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-stone-600 shrink-0" />
                  <span className="text-[11px] font-semibold text-stone-800 truncate">
                    {replaceExistingOnBuild ? 'Odayı Sıfırla & Kur' : 'Mevcut Odaya Ekle'} ·{' '}
                    {autoVerifyAfterBuild ? 'Oto Kalibre' : 'Manuel'}
                  </span>
                </span>
                {showAdvancedOptions ? (
                  <ChevronDown className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-stone-500 shrink-0" />
                )}
              </button>

              {showAdvancedOptions && (
                <div className="px-2.5 pb-2.5 pt-2 border-t border-stone-200 space-y-2 text-[11px] text-stone-700 bg-white">
                  {(project.adjacentRooms?.length || 0) === 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-mono uppercase text-stone-500 block">
                        Hangi Odaya Yerleştirilsin?
                      </label>
                      <select
                        value={targetRoomId}
                        onChange={(e) => setTargetRoomId(e.target.value)}
                        className="w-full px-2 py-1.5 border border-stone-300 bg-white text-[11px] font-semibold text-stone-950"
                      >
                        <option value="main">Ana Salon ({project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m)</option>
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setReplaceExistingOnBuild(false)}
                      className={`py-1.5 px-1.5 border text-[10px] font-bold transition ${
                        !replaceExistingOnBuild
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-300 bg-white text-stone-700'
                      }`}
                    >
                      Mevcut Odaya Ekle
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplaceExistingOnBuild(true)}
                      className={`py-1.5 px-1.5 border text-[10px] font-bold transition ${
                        replaceExistingOnBuild
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-300 bg-white text-stone-700'
                      }`}
                    >
                      Odayı Sıfırla &amp; Kur
                    </button>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoPopulateOnAnalyze}
                      onChange={(e) => setAutoPopulateOnAnalyze(e.target.checked)}
                      className="accent-stone-950"
                    />
                    <span className="font-medium text-stone-900">Analiz bitince seçili odaya anında kur</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoVerifyAfterBuild}
                      onChange={(e) => setAutoVerifyAfterBuild(e.target.checked)}
                      className="accent-stone-950"
                    />
                    <span className="font-medium text-stone-900">
                      Arka planda otomatik kalibre et (%75+ uyum, geri düşme korumalı)
                    </span>
                  </label>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={analyzing || refining}
              onClick={handleAnalyze}
              className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition"
            >
              {analyzing || refining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>
                {refining
                  ? 'Yerleşim Otomatik Optimize Ediliyor...'
                  : analyzing
                  ? 'Görsel Analiz Ediliyor & 3B Kuruluyor...'
                  : autoPopulateOnAnalyze
                  ? `${getTargetRoomRect().name} İçine Analiz Et & Kur`
                  : 'Odayı & Eşyaları Tespit Et'}
              </span>
            </button>
          </div>
        )}
      </div>

      {statusBanner && (
        <div className="border border-stone-300 bg-white px-3 py-2 text-[11px] text-stone-800 leading-snug">
          {statusBanner}
        </div>
      )}

      {/* Stage 3 Visual QA Readout (only shown AFTER silent auto-calibration finishes!) */}
      {photoDataUrl && project.objects.length > 0 && !refining && (qaResult || detected.length > 0) && (
        <div className="border border-stone-300 bg-[#faf9f6] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-800">
              Mimari Kalibrasyon Durumu
            </span>
            {qaResult && (
              <span className="text-[10px] font-mono font-bold text-emerald-700">
                Uyum %{qaResult.matchScore}
              </span>
            )}
          </div>
          {qaResult && (
            <p className="text-[11px] text-stone-700 leading-snug">
              {qaResult.critiqueTr}{' '}
              <span className="font-mono text-[10px] text-stone-500">
                ({qaResult.passesRun ? `${qaResult.passesRun} tur · ` : ''}
                {qaResult.fixedCount} iyileştirme{qaResult.addedCount > 0 ? `, +${qaResult.addedCount} parça` : ''})
              </span>
            </p>
          )}
          <div className="grid grid-cols-1 gap-1.5">
            {onOpenRenderStudio && activePhoto && (
              <button
                type="button"
                disabled={analyzing || refining}
                onClick={() => {
                  onOpenRenderStudio({
                    roomId: targetRoomId || 'main',
                    angle: 'eye',
                    referencePhoto: {
                      id: activePhoto.id,
                      label: `Foto ${activePhoto.index}`,
                      dataUrl: activePhoto.dataUrl,
                    },
                    autoStart: true,
                  });
                }}
                className="w-full py-2 bg-stone-950 hover:bg-stone-800 text-white text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Foto {activePhoto.index} İçin Birebir V-Ray Render Al</span>
              </button>
            )}
            {runpodReady && heroRunPodCandidates.length > 0 && (
              <button
                type="button"
                disabled={analyzing || refining || Boolean(heroUpgrading)}
                onClick={() => void handleAutoUpgradeHero3D()}
                className="w-full py-2 border border-stone-950 bg-white hover:bg-stone-100 text-stone-950 text-[11px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
                title="Fotoğraftaki ana mobilyaları (koltuk, sehpa, avize, berjer vb.) RunPod RTX 4090 ile gerçek 1:1 3B .GLB olarak sahneye yerleştirir"
              >
                {heroUpgrading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                <span>
                  {heroUpgrading
                    ? `Birebir 3B Örülüyor (${heroUpgrading.done}/${heroUpgrading.total})...`
                    : `Birebir 3B Mobilya Üret (2K PBR · ${heroRunPodCandidates.length} Parça)`}
                </span>
              </button>
            )}
            <button
              type="button"
              disabled={analyzing || refining}
              onClick={() => runVisualSelfCritique(project.objects, roomStyle, photoDataUrl, undefined, undefined, undefined, false)}
              className="w-full py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-stone-800 text-[11px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
            >
              <Check className="w-3.5 h-3.5" />
              <span>İnce Ayar Tekrarla (Geri Düşme Korumalı)</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Cumulative Materials Pool across ALL Pinterest Photos + Custom Material Adder! */}
      {(materialPool.length > 0 || photos.length > 0) && (
        <div className="border border-stone-200 bg-white p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-800 flex items-center gap-1">
              <Palette className="w-3.5 h-3.5 text-stone-600" />
              <span>Malzeme Havuzu ({materialPool.length})</span>
            </span>
            <button
              type="button"
              onClick={() => setShowAddMaterialForm((v) => !v)}
              className={`px-2 py-0.5 border text-[10px] font-semibold flex items-center gap-0.5 transition ${
                showAddMaterialForm
                  ? 'border-stone-950 bg-stone-950 text-white'
                  : 'border-stone-300 bg-[#faf9f6] text-stone-800 hover:border-stone-950'
              }`}
            >
              <Plus className="w-3 h-3" />
              <span>Malzeme Ekle</span>
            </button>
          </div>

          {showAddMaterialForm && (
            <div className="border border-stone-200 bg-[#faf9f6] p-2 space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={customMatKind}
                  onChange={(e) => setCustomMatKind(e.target.value as PinterestMaterialEntry['kind'])}
                  className="px-1.5 py-1 border border-stone-300 bg-white text-[11px] font-semibold"
                >
                  <option value="wall">Duvar Boyası (4 Duvar)</option>
                  <option value="accentWall">Vurgu Duvarı / Panel</option>
                  <option value="floor">Zemin Parke / Taş</option>
                  <option value="curtain">Perde Kumaşı</option>
                </select>
                {customMatKind === 'floor' ? (
                  <select
                    value={customMatFloor}
                    onChange={(e) => setCustomMatFloor(e.target.value as FloorMaterialKind)}
                    className="px-1.5 py-1 border border-stone-300 bg-white text-[11px]"
                  >
                    {(Object.keys(FLOOR_LABELS_TR) as FloorMaterialKind[]).map((fm) => (
                      <option key={fm} value={fm}>
                        {FLOOR_LABELS_TR[fm]}
                      </option>
                    ))}
                  </select>
                ) : customMatKind === 'wall' || customMatKind === 'accentWall' ? (
                  <select
                    value={customMatWallPat}
                    onChange={(e) => setCustomMatWallPat(e.target.value as WallPattern)}
                    className="px-1.5 py-1 border border-stone-300 bg-white text-[11px]"
                  >
                    {(Object.keys(WALL_PATTERN_LABELS_TR) as WallPattern[]).map((wp) => (
                      <option key={wp} value={wp}>
                        {WALL_PATTERN_LABELS_TR[wp]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="px-1.5 py-1 text-[10px] text-stone-500 flex items-center">Tül + Fon Perde</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={customMatHex}
                  onChange={(e) => setCustomMatHex(e.target.value)}
                  className="w-8 h-7 border border-stone-300 bg-white cursor-pointer shrink-0"
                  title="Renk seç"
                />
                <input
                  type="text"
                  value={customMatName}
                  onChange={(e) => setCustomMatName(e.target.value)}
                  placeholder="Malzeme adı (örn. Ceviz Çıta, Kaşmir...)"
                  className="flex-1 min-w-0 px-2 py-1 border border-stone-300 bg-white text-[11px]"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCustomMaterial}
                className="w-full py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[10px] font-bold transition"
              >
                Havuza Ekle &amp; {getTargetRoomRect().name} İçin Uygula
              </button>
            </div>
          )}

          {materialPool.length > 0 ? (
            <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
              {materialPool
                .filter((m) => poolFilter === 'all' || m.sourcePhotoId === poolFilter || m.sourcePhotoId === 'custom')
                .map((mat) => (
                  <div
                    key={mat.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 border border-stone-200 hover:border-stone-500 bg-[#faf9f6]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-5 h-5 border border-black/20 shrink-0"
                        style={{ backgroundColor: mat.colorHex }}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-stone-900 truncate leading-tight">{mat.label}</p>
                        <p className="text-[9px] font-mono text-stone-500">
                          {mat.sourceLabel} · {mat.colorHex.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onApplySingleMaterial?.(mat, targetRoomId)}
                      className="px-2 py-1 border border-stone-950 bg-white hover:bg-stone-950 text-stone-950 hover:text-white text-[10px] font-semibold whitespace-nowrap shrink-0 transition"
                    >
                      Uygula
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-[10px] text-stone-500 leading-snug">
              Fotoğrafı analiz ettiğinde duvar, parke, panel ve perde malzemeleri burada birikir; 2. fotoğraf eklediğinde farklı fotoğraflardan malzemeleri karıştırıp uygulayabilirsin.
            </p>
          )}

          {roomStyle && (
            <button
              type="button"
              onClick={() => {
                onApplyRoomStyle(roomStyle, targetRoomId);
                onToast(`${getTargetRoomRect().name} için Foto ${activePhoto?.index || 1} tüm stili uygulandı.`);
              }}
              className="w-full py-1.5 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-stone-900 text-[11px] font-semibold transition"
            >
              Foto {activePhoto?.index || 1} Tüm Stilini {getTargetRoomRect().name} İçin Uygula
            </button>
          )}
        </div>
      )}

      {/* Step 3: Cumulative Live Editable Pinterest Objects across ALL Photos */}
      {detected.length > 0 && (() => {
        const visibleDetected =
          poolFilter === 'all' ? detected : detected.filter((d) => d.sourcePhotoId === poolFilter);
        const visibleSelectedCount = visibleDetected.filter((d) => jobs[d.id]?.selected).length;
        return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-700">
              Çıkarılan Eşyalar ({visibleDetected.length})
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  const allSelected = visibleDetected.every((d) => jobs[d.id]?.selected);
                  setJobs((prev) => {
                    const next = { ...prev };
                    visibleDetected.forEach((d) => {
                      next[d.id] = { ...(next[d.id] || { status: 'idle', selected: false }), selected: !allSelected };
                    });
                    return next;
                  });
                }}
                className="text-stone-600 hover:text-stone-950 underline"
              >
                {visibleDetected.every((d) => jobs[d.id]?.selected) ? 'Kaldır' : 'Tümü'}
              </button>
              <button
                type="button"
                onClick={() => setDrawMode('new')}
                className="font-semibold text-stone-900 hover:text-stone-700 flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> Alan Çiz
              </button>
            </div>
          </div>

          {/* Filter Strip when 2+ Pinterest photos are loaded sequentially */}
          {photos.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setPoolFilter('all')}
                className={`px-2 py-0.5 border text-[10px] font-semibold transition ${
                  poolFilter === 'all'
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-600'
                }`}
              >
                Tümü ({detected.length})
              </button>
              {photos.map((ph) => {
                const cnt = detected.filter((d) => d.sourcePhotoId === ph.id).length;
                return (
                  <button
                    key={ph.id}
                    type="button"
                    onClick={() => {
                      setPoolFilter(ph.id);
                      setActivePhotoId(ph.id);
                    }}
                    className={`px-2 py-0.5 border text-[10px] font-semibold transition ${
                      poolFilter === ph.id
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-600'
                    }`}
                  >
                    Foto {ph.index} ({cnt})
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            disabled={batchRunning || visibleSelectedCount === 0}
            onClick={handleRebuildSelectedInstant}
            className="w-full py-2 bg-stone-950 hover:bg-stone-800 disabled:opacity-45 text-white font-semibold flex items-center justify-center gap-1.5 transition"
          >
            {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            <span>Seçili {visibleSelectedCount} Parçayı {getTargetRoomRect().name} İçine Kur</span>
          </button>

          <div className="space-y-2">
            {visibleDetected.map((item, idx) => {
              const st = jobs[item.id] || { selected: false, status: 'idle' };
              const placed = findPlacedObjForItem(item.id);
              const col = BOX_COLORS[idx % BOX_COLORS.length];
              const thumb = st.studioPreviewUrl || st.cropPreviewUrl;
              const isHov = hoveredId === item.id;
              const liveColor =
                placed?.parametricColorHex ||
                placed?.tintHex ||
                (isValidHexColor(item.primaryColorHex) ? item.primaryColorHex : '#8d8476');
              const archetype = resolvePinterestArchetype(item);
              const canUpgradePbr = archetype !== 'rug_custom' && archetype !== 'wall_art' && archetype !== 'wall_mirror';

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId((cur) => (cur === item.id ? null : cur))}
                  className={`border bg-white p-2.5 space-y-2 transition ${
                    isHov ? 'border-stone-950' : placed ? 'border-stone-300' : 'border-stone-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={st.selected}
                      onChange={(e) =>
                        setJobs((prev) => ({
                          ...prev,
                          [item.id]: { ...st, selected: e.target.checked },
                        }))
                      }
                      className="mt-1 accent-stone-950 shrink-0"
                    />
                    {thumb && (
                      <img
                        src={thumb}
                        alt={item.nameTr}
                        className="w-11 h-11 object-contain border border-stone-200 bg-white shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span
                          style={{ backgroundColor: col }}
                          className="w-4 h-4 text-[9px] font-mono font-bold text-white flex items-center justify-center shrink-0"
                        >
                          {idx + 1}
                        </span>
                        {photos.length > 1 && item.sourcePhotoIndex && (
                          <span className="px-1 py-0.5 bg-stone-100 border border-stone-300 text-[8px] font-mono font-bold text-stone-700 shrink-0">
                            F{item.sourcePhotoIndex}
                          </span>
                        )}
                        <span
                          className="w-3 h-3 border border-black/25 shrink-0"
                          style={{ backgroundColor: liveColor }}
                          title={`Aktif Renk: ${liveColor}`}
                        />
                        <input
                          type="text"
                          value={item.nameTr}
                          onChange={(e) => updateDetectedItem(item.id, { nameTr: e.target.value })}
                          className="flex-1 min-w-0 font-semibold text-stone-950 text-[11px] bg-transparent border-b border-transparent focus:border-stone-400 focus:outline-none truncate"
                        />
                        <button
                          type="button"
                          onClick={() => setDrawMode(item.id)}
                          title="Fotoğrafta bu eşyanın kutusunu yeniden çiz"
                          className="p-0.5 text-stone-400 hover:text-stone-950 shrink-0"
                        >
                          <Crop className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeDetectedItem(item.id)}
                          title="Odadan ve listeden kaldır"
                          className="p-0.5 text-stone-400 hover:text-red-700 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-1 mt-1.5">
                        <label className="text-[10px] text-stone-500">
                          En (cm)
                          <NumericInput
                            min={10}
                            max={600}
                            step={5}
                            decimals={0}
                            value={Math.round(item.widthCm)}
                            onChange={(v) => updateDetectedItem(item.id, { widthCm: v })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                        <label className="text-[10px] text-stone-500">
                          Der. (cm)
                          <NumericInput
                            min={5}
                            max={600}
                            step={5}
                            decimals={0}
                            value={Math.round(item.depthCm)}
                            onChange={(v) => updateDetectedItem(item.id, { depthCm: v })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                        <label className="text-[10px] text-stone-500">
                          Yük. (cm)
                          <NumericInput
                            min={1}
                            max={450}
                            step={5}
                            decimals={0}
                            value={Math.round(item.heightCm)}
                            onChange={(v) => updateDetectedItem(item.id, { heightCm: v })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  {st.status === 'error' && st.errorMsg && (
                    <div className="px-2 py-1.5 bg-red-50 border border-red-200 text-[10px] font-mono text-red-800 break-words leading-snug">
                      Hata: {st.errorMsg}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-stone-100">
                    <span className="text-[10px] font-mono min-w-0 truncate">
                      {st.status === 'isolating' || st.status === 'modeling' ? (
                        <span className="text-blue-700 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          <span className="truncate">{st.progressText || '2K PBR üretiliyor...'}</span>
                        </span>
                      ) : placed ? (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3 shrink-0" /> {placed.glbUrl ? '2K PBR Odada' : '3B Odada'}
                        </span>
                      ) : (
                        <span className="text-stone-400">Odada değil</span>
                      )}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      {placed ? (
                        <button
                          type="button"
                          onClick={() => onSelectObjectInRoom(placed.id)}
                          className="px-2 py-1 border border-stone-950 bg-stone-950 text-white text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap"
                          title="3B sahnede seçip rengini, ölçüsünü veya yerini değiştir"
                        >
                          <MousePointerClick className="w-3 h-3" />
                          <span>Renk / Düzenle</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => placeSingleInstantIn3D(item)}
                          className="px-2 py-1 border border-stone-950 bg-stone-950 text-white text-[10px] font-semibold whitespace-nowrap"
                        >
                          Anında Koy
                        </button>
                      )}

                      {canUpgradePbr && runpodReady && (
                        <button
                          type="button"
                          disabled={st.status === 'isolating' || st.status === 'modeling' || batchRunning}
                          onClick={() => upgradeItemWithRunPod3D(item)}
                          className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-stone-800 text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                          title="Yüksek detaylı 2K PBR .GLB modele yükselt"
                        >
                          <Wand2 className="w-3 h-3" />
                          <span>2K PBR</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Item #7B: Save Modeled / 2K PBR Product Permanently to Showroom Product Catalog! */}
                  {placed && onSaveToCatalog && (
                    <div className="pt-1 border-t border-stone-100 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-stone-500 truncate">
                        {placed.glbUrl ? '2K PBR .GLB hazır — kataloğa eklenebilir' : 'Kataloğa kaydet (önce 2K PBR önerilir)'}
                      </span>
                      <button
                        type="button"
                        disabled={savingCatalogId === placed.id}
                        onClick={async () => {
                          setSavingCatalogId(placed.id);
                          try {
                            const ok = await onSaveToCatalog(placed, thumb);
                            if (ok) setSavedCatalogIds((prev) => ({ ...prev, [placed.id]: true }));
                          } finally {
                            setSavingCatalogId(null);
                          }
                        }}
                        className={`px-2 py-1 border text-[10px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 transition ${
                          savedCatalogIds[placed.id]
                            ? 'border-emerald-700 bg-emerald-700 text-white'
                            : placed.glbUrl
                            ? 'border-stone-950 bg-stone-950 text-white hover:bg-stone-800'
                            : 'border-stone-300 bg-white text-stone-800 hover:border-stone-950'
                        }`}
                      >
                        {savingCatalogId === placed.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : savedCatalogIds[placed.id] ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <BookmarkPlus className="w-3 h-3" />
                        )}
                        <span>{savedCatalogIds[placed.id] ? 'Katalogda' : 'Kataloğa Kaydet'}</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {geminiImageQuotaNote && (
        <div className="border border-amber-300 bg-amber-50 p-2.5 text-[10px] text-amber-950 leading-relaxed">
          Not: Google AI Studio Free Tier&apos;da görsel üretme kotası 0 olduğu için 2K PBR yükseltmeleri doğrudan sıkı kırpımla
          RunPod&apos;a gider; Fotogerçekçi V-Ray Render için Google AI Studio Billing gerekir.
        </div>
      )}

      {/* Bonus: 1-Click V-Ray Style Photoreal Render Studio Launcher */}
      <div className="border border-stone-200 bg-[#faf9f6]">
        <button
          type="button"
          onClick={() => {
            if (onOpenRenderStudio) {
              onOpenRenderStudio({
                roomId: targetRoomId === 'main' ? 'current' : targetRoomId,
                angle: targetRoomId === 'main' ? 'current' : 'corner',
                referencePhoto: activePhoto
                  ? { id: activePhoto.id, label: `Foto ${activePhoto.index}`, dataUrl: activePhoto.dataUrl }
                  : undefined,
                autoStart: false,
              });
            } else {
              setShowPhotorealSection((v) => !v);
            }
          }}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-stone-100/70 transition"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Camera className="w-3.5 h-3.5 text-stone-700 shrink-0" />
            <span className="min-w-0">
              <span className="block font-semibold text-stone-900 text-[11px] truncate">
                Fotogerçekçi Render Stüdyosu (V-Ray)
              </span>
              <span className="block text-[10px] text-stone-500 truncate">
                Her oda ve fotoğraf için 4 ışık modu · Önce/Sonra karşılaştır
              </span>
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-stone-500 shrink-0" />
        </button>

        {(showPhotorealSection || renderingPhoto || renderError) && (
          <div className="px-3 pb-3 pt-2 border-t border-stone-200 bg-white space-y-2">
            <textarea
              rows={2}
              value={renderStyleNote}
              onChange={(e) => setRenderStyleNote(e.target.value)}
              placeholder="Işık veya atmosfer notu..."
              className="w-full px-2.5 py-1.5 border border-stone-300 bg-[#faf9f6] text-[11px] resize-none leading-snug"
            />
            {renderError && (
              <div className="p-2 bg-amber-50 border border-amber-300 text-[10px] text-amber-950 leading-snug">
                {renderError}
              </div>
            )}
            <button
              type="button"
              disabled={renderingPhoto}
              onClick={handlePhotorealRender}
              className="w-full py-2 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 font-semibold flex items-center justify-center gap-1.5 transition disabled:opacity-50"
            >
              {renderingPhoto ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              <span>{renderingPhoto ? 'Fotogerçekçi Render Hazırlanıyor...' : 'Bu Açıdan Fotogerçekçi Render Al'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Photoreal Render Lightbox */}
      {photorealResult && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setPhotorealResult(null)}
        >
          <div
            className="bg-white border border-stone-300 max-w-4xl w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-stone-700" />
                <span className="font-display font-bold text-sm text-stone-950">
                  Fotogerçekçi Mimari Sunum Renderı
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={photorealResult}
                  download={`mekanar-mimari-render-${Date.now()}.png`}
                  className="px-3 py-1.5 bg-stone-950 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> İndir (PNG)
                </a>
                <button
                  type="button"
                  onClick={() => setPhotorealResult(null)}
                  className="p-1 text-stone-500 hover:text-stone-950"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-auto bg-stone-100 flex items-center justify-center">
              <img src={photorealResult} alt="Mimari render" className="max-h-[75dvh] w-auto object-contain shadow-lg" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
