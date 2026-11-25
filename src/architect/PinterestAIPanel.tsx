import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Crop,
  Download,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Loader2,
  MousePointerClick,
  Plus,
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
  type MezzanineBounds,
  type ParametricFurnitureKind,
  type WallId,
} from './types';

interface Props {
  project: ArchRoomProject;
  onApplyRoomStyle: (style: PinterestRoomStyle) => void;
  onApplyPinterestScene: (
    objects: ArchPlacedObject[],
    style: PinterestRoomStyle | null,
    replaceExisting: boolean
  ) => void;
  onRefinePinterestScene?: (objects: ArchPlacedObject[], roomFixes: VisualRefineRoomFix | null) => void;
  onAddGeneratedObject: (obj: ArchPlacedObject) => void;
  onSelectObjectInRoom: (objId: string) => void;
  onRemoveObjectInRoom: (objId: string) => void;
  onCaptureViewport: () => string | null;
  onToast: (msg: string) => void;
}

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
  tv_wall_unit: { c1: '#b9936c', c2: '#222224' },
  wall_tv: { c1: '#141518', c2: '#090a0d' },
  fireplace_marble: { c1: '#eae6de', c2: '#232220' },
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
  'fireplace_marble',
  'tv_wall_unit',
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
  onApplyRoomStyle,
  onApplyPinterestScene,
  onRefinePinterestScene,
  onAddGeneratedObject,
  onSelectObjectInRoom,
  onRemoveObjectInRoom,
  onCaptureViewport,
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

  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [autoPopulateOnAnalyze, setAutoPopulateOnAnalyze] = useState(true);
  const [replaceExistingOnBuild, setReplaceExistingOnBuild] = useState(true);
  const [autoVerifyAfterBuild, setAutoVerifyAfterBuild] = useState(true);
  const [qaResult, setQaResult] = useState<{
    matchScore: number;
    critiqueTr: string;
    fixedCount: number;
    addedCount: number;
    model: string;
  } | null>(null);
  const [roomStyle, setRoomStyle] = useState<PinterestRoomStyle | null>(null);
  const [detected, setDetected] = useState<PinterestDetectedObject[]>([]);
  const [jobs, setJobs] = useState<Record<string, ItemJobState>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [geminiImageQuotaNote, setGeminiImageQuotaNote] = useState(false);
  const geminiImageQuotaBlockedRef = useRef(false);

  // Interactive photo box drawing (new item OR redrawing an existing item's crop box!)
  const [drawMode, setDrawMode] = useState<'off' | 'new' | string>('off');
  const [draftBox, setDraftBox] = useState<DraftBox | null>(null);
  const photoWrapRef = useRef<HTMLDivElement | null>(null);

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

  // Support Ctrl+V direct paste from Pinterest browser tab!
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            handleUploadInspiration(f);
            onToast('Panodan Pinterest görseli yapıştırıldı.');
            break;
          }
        }
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
   * in < 5ms, preserving exact Pinterest color, silhouette, dimensions, and 1st/2nd-floor placement!
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
    mezSpec: ArchMezzanine | null = project.mezzanine?.enabled ? project.mezzanine : null
  ): Promise<{ obj: ArchPlacedObject; cropPreview?: string; rawCrop?: string }> => {
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

    const isUpper = Boolean(mezBounds && item.floorLevel === 1 && archetype !== 'stairs');
    const baseFloorY = isUpper && mezBounds ? mezBounds.topY : 0;
    const headroomM = isUpper && mezBounds ? Math.max(1.2, effectiveCeilingM - mezBounds.topY) : effectiveCeilingM;
    const activeOccupied = isUpper ? occupiedUpper : occupiedGround;
    const activeWallCursors = isUpper ? wallCursorsUpper : wallCursorsGround;

    // Realistic clamped dimensions (protects against outlier AI estimates)
    let wM = Math.max(0.25, Math.min(project.widthM * 0.78, (Number(item.widthCm) || 90) / 100));
    let dM = Math.max(0.04, Math.min(project.depthM * 0.78, (Number(item.depthCm) || 60) / 100));
    let hM = Math.max(0.015, Math.min(headroomM - 0.1, (Number(item.heightCm) || 85) / 100));

    if (archetype === 'rug_custom') {
      hM = 0.016;
      const maxRW = isUpper && mezBounds ? mezBounds.widthM * 0.88 : project.widthM * 0.82;
      const maxRD = isUpper && mezBounds ? mezBounds.depthM * 0.88 : project.depthM * 0.82;
      wM = Math.max(0.85, Math.min(maxRW, wM));
      dM = Math.max(0.85, Math.min(maxRD, dM));
    } else if (archetype === 'wall_art' || archetype === 'wall_mirror' || archetype === 'wall_tv') {
      dM = Math.min(0.08, Math.max(0.035, dM));
    } else if (archetype === 'potted_plant') {
      wM = Math.max(0.45, Math.min(1.2, wM));
      dM = Math.max(0.45, Math.min(1.2, dM));
      hM = Math.max(0.7, Math.min(headroomM - 0.15, hM));
    } else if (archetype === 'stairs' && mezBounds) {
      // Snap stairs height flush to the 2nd floor mezzanine deck!
      hM = mezBounds.topY;
      wM = Math.max(0.75, Math.min(1.15, wM));
      dM = Math.max(1.35, Math.min(2.2, dM));
    } else if (isUpper && mezBounds) {
      // Keep upstairs furniture comfortably within the mezzanine slab depth/width
      wM = Math.min(wM, mezBounds.widthM * 0.78);
      dM = Math.min(dM, mezBounds.depthM * 0.85);
    }

    const isRug = archetype === 'rug_custom';
    const isCeiling = archetype === 'chandelier' || item.mountMode === 'ceiling';
    const isFloorMirror =
      archetype === 'wall_mirror' &&
      (hM >= 1.25 || (item.elevationCm !== undefined && item.elevationCm <= 15) || /boy|ayakta|zemin|full.?length/i.test(item.nameTr));
    const isHighWall =
      !isFloorMirror &&
      (archetype === 'wall_art' || archetype === 'wall_mirror' || archetype === 'wall_tv' || archetype === 'ac_unit');
    const isWallAnchoredFloor =
      WALL_ANCHORABLE_FLOOR_KINDS.has(archetype) && Boolean(item.suggestedWall && item.suggestedWall !== 'center');
    const isWallBacked = item.mountMode === 'wall' || WALL_BACKED_KINDS.has(archetype) || isWallAnchoredFloor;

    const mountMode: ArchPlacedObject['mountMode'] = isRug
      ? 'rug'
      : isCeiling
      ? 'ceiling'
      : isWallBacked && !isWallAnchoredFloor
      ? 'wall'
      : 'floor';

    let x = Math.max(-project.widthM * 0.44, Math.min(project.widthM * 0.44, (item.relativeX || 0) * (project.widthM * 0.45)));
    let z = Math.max(-project.depthM * 0.44, Math.min(project.depthM * 0.44, (item.relativeZ || 0) * (project.depthM * 0.45)));
    let rot = ((item.facingDeg || 0) * Math.PI) / 180;
    let y = baseFloorY;
    let attachedWall: WallId | undefined;

    // Clamp upstairs coordinates onto the mezzanine deck bounds
    const clampToMez = (cx: number, cz: number, hw: number, hd: number) => {
      if (!isUpper || !mezBounds) return { cx, cz };
      const pad = 0.06;
      const nx = Math.max(mezBounds.minX + hw + pad, Math.min(mezBounds.maxX - hw - pad, cx));
      const nz = Math.max(mezBounds.minZ + hd + pad, Math.min(mezBounds.maxZ - hd - pad, cz));
      return { cx: nx, cz: nz };
    };

    if (archetype === 'stairs' && mezBounds && mezSpec) {
      y = 0;
      if (mezSpec.anchorWall === 'north') {
        rot = 0;
        if (mezSpec.stairGapSide === 'west') {
          x = Math.max(-project.widthM * 0.5 + wM * 0.5 + 0.08, mezBounds.minX - wM * 0.5 - 0.04);
          z = mezBounds.maxZ - dM * 0.15;
        } else if (mezSpec.stairGapSide === 'east') {
          x = Math.min(project.widthM * 0.5 - wM * 0.5 - 0.08, mezBounds.maxX + wM * 0.5 + 0.04);
          z = mezBounds.maxZ - dM * 0.15;
        } else {
          x = -project.widthM * 0.5 + wM * 0.5 + 0.12;
          z = mezBounds.maxZ + dM * 0.5;
        }
      } else {
        x = Math.max(-project.widthM * 0.42, Math.min(project.widthM * 0.42, x));
        z = Math.max(-project.depthM * 0.42, Math.min(project.depthM * 0.42, z));
      }
      occupiedGround.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
    } else if (isCeiling) {
      y = Math.max(baseFloorY + 1.65, effectiveCeilingM - hM);
      x = Math.max(-project.widthM * 0.25, Math.min(project.widthM * 0.25, x));
      z = Math.max(-project.depthM * 0.25, Math.min(project.depthM * 0.25, z));
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

      // Determine vertical span [y0, y1] FIRST so items stacked vertically (e.g. memo board ABOVE floor mirror, ivy ABOVE bed!) never push each other sideways!
      if (isHighWall) {
        const relElev =
          archetype === 'ac_unit'
            ? Math.max(1.75, headroomM - hM - 0.15)
            : Math.max(0.75, Math.min(headroomM - hM - 0.08, (item.elevationCm || 125) / 100));
        y = baseFloorY + relElev;
      } else {
        y = baseFloorY;
      }
      const myY0 = y;
      const myY1 = y + hM;

      const isHoriz = targetWall === 'north' || targetWall === 'south';
      const spanMin =
        isUpper && mezBounds
          ? (isHoriz ? mezBounds.minX : mezBounds.minZ) + wM * 0.5 + 0.1
          : -(isHoriz ? project.widthM : project.depthM) * 0.5 + wM * 0.5 + 0.1;
      const spanMax =
        isUpper && mezBounds
          ? (isHoriz ? mezBounds.maxX : mezBounds.maxZ) - wM * 0.5 - 0.1
          : (isHoriz ? project.widthM : project.depthM) * 0.5 - wM * 0.5 - 0.1;
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
        // Nudge gently outward from desired position instead of teleporting across the room!
        const steps = [0.25, -0.25, 0.55, -0.55, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8];
        const freeShift = steps.find((d) => {
          const cand = along + d;
          return cand >= spanMin - 0.01 && cand <= spanMax + 0.01 && !collides2D(cand);
        });
        if (freeShift !== undefined) along = Math.max(spanMin, Math.min(spanMax, along + freeShift));
      }

      // Wall art/ivy behind bed shouldn't block floor furniture; floor items register their exact height band!
      used.push({ along, halfW: wM * 0.5, y0: myY0, y1: myY1 });

      const wallInset = isWallAnchoredFloor ? 0.03 : 0.02;
      if (targetWall === 'north') {
        x = along;
        z = -project.depthM * 0.5 + dM * 0.5 + wallInset;
        rot = 0;
      } else if (targetWall === 'south') {
        x = along;
        z = project.depthM * 0.5 - dM * 0.5 - wallInset;
        rot = Math.PI;
      } else if (targetWall === 'west') {
        z = along;
        x = -project.widthM * 0.5 + dM * 0.5 + wallInset;
        rot = Math.PI / 2;
      } else {
        z = along;
        x = project.widthM * 0.5 - dM * 0.5 - wallInset;
        rot = -Math.PI / 2;
      }

      if (!isHighWall) {
        activeOccupied.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
      }
    } else if (isUpper && mezBounds) {
      const localW = mezBounds.widthM;
      const localD = mezBounds.depthM;
      const mezCx = (mezBounds.minX + mezBounds.maxX) * 0.5;
      const mezCz = (mezBounds.minZ + mezBounds.maxZ) * 0.5;
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
      // Ground-floor free furniture: anchor cleanly near Pinterest (x,z) while PRESERVING intended facingDeg!
      const pos = findOpenSpawnPosition(
        wM * 0.5,
        dM * 0.5,
        rot,
        occupiedGround,
        project.widthM,
        project.depthM,
        [x, z]
      );
      if (pos) {
        x = pos.x;
        z = pos.z;
      }
      y = 0;
      occupiedGround.push({ id: item.id, x, z, rot, halfW: wM * 0.5, halfD: dM * 0.5 });
    }

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
      x,
      y,
      z,
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
   * Places ALL selected detected Pinterest items into the 3D room (1st & 2nd floor!) with exact colors & archetypes.
   */
  const assembleAllInstantIn3D = async (
    itemsToPlace: PinterestDetectedObject[],
    styleToApply: PinterestRoomStyle | null,
    imgUrl: string,
    replaceExisting: boolean
  ) => {
    if (itemsToPlace.length === 0) return;

    // Resolve target ceiling & 2nd-floor mezzanine geometry BEFORE laying out objects!
    const effectiveCeilingM =
      styleToApply?.hasMezzanine
        ? Math.max(3.85, Math.min(4.8, (styleToApply.suggestedCeilingCm || 410) / 100))
        : styleToApply?.suggestedCeilingCm
        ? Math.max(2.5, Math.min(4.5, styleToApply.suggestedCeilingCm / 100))
        : project.ceilingM;

    const mezSpec: ArchMezzanine | null = styleToApply?.hasMezzanine
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
      : project.mezzanine?.enabled && !replaceExisting
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

    // Sort so stairs, rugs & wall-backed furniture anchor first, then beds/sofas/desks, then accent items
    const priority = (it: PinterestDetectedObject) => {
      const k = resolvePinterestArchetype(it);
      if (k === 'stairs') return 0;
      if (k === 'rug_custom') return 1;
      if (WALL_BACKED_KINDS.has(k)) return 2;
      if (k === 'bed_frame' || k === 'sofa' || k === 'dining_table' || k === 'desk') return 3;
      return 4;
    };
    const ordered = [...itemsToPlace].sort((a, b) => priority(a) - priority(b));

    const occupiedGround: OBB2D[] = replaceExisting
      ? []
      : project.objects
          .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8)
          .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
    const occupiedUpper: OBB2D[] = [];

    const wallCursorsGround: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
    const wallCursorsUpper: Record<WallId, WallSlot[]> = { north: [], east: [], south: [], west: [] };
    // Reserve active window openings so wall art/mirrors/shelves NEVER clip through windows!
    if (styleToApply?.hasVisibleWindow && styleToApply.primaryWindowWall) {
      const ww = styleToApply.primaryWindowWall;
      const winSpan = ww === 'north' || ww === 'south' ? project.widthM : project.depthM;
      const winAlong = styleToApply.hasMezzanine ? -winSpan * 0.18 : 0;
      wallCursorsGround[ww].push({ along: winAlong, halfW: 0.9, y0: 0.2, y1: effectiveCeilingM });
      wallCursorsUpper[ww].push({ along: winAlong, halfW: 0.9, y0: 0.2, y1: effectiveCeilingM });
    }
    const builtObjects: ArchPlacedObject[] = [];
    const jobPatches: Record<string, Partial<ItemJobState>> = {};

    for (const item of ordered) {
      const res = await buildInstant3DObject(
        item,
        imgUrl,
        occupiedGround,
        wallCursorsGround,
        occupiedUpper,
        wallCursorsUpper,
        effectiveCeilingM,
        mezBounds,
        mezSpec
      );
      builtObjects.push(res.obj);
      jobPatches[item.id] = {
        selected: true,
        status: 'done',
        cropPreviewUrl: res.cropPreview,
        rawCropUrl: res.rawCrop,
        progressText: res.obj.floorLevel === 1 ? '2. Kat (Asma Kat) — tıklayıp düzenle' : '3B odada — tıklayıp rengini/yerini değiştir',
      };
    }

    const sourceMap = new Map<string, PinterestDetectedObject>();
    ordered.forEach((it) => sourceMap.set(it.id, it));

    // Stage 2: Enforce universal architectural parent-child physics (lamps on tables, nightstands beside beds, chairs facing desks/tables, etc.)
    const solvedObjects = applyArchitecturalRelationships(
      builtObjects,
      sourceMap,
      project,
      effectiveCeilingM,
      mezBounds
    );

    onApplyPinterestScene(solvedObjects, styleToApply, replaceExisting);
    setJobs((prev) => {
      const next = { ...prev };
      for (const [id, patch] of Object.entries(jobPatches)) {
        next[id] = { ...(next[id] || { selected: true, status: 'done' }), ...patch };
      }
      return next;
    });

    if (autoVerifyAfterBuild) {
      await runVisualSelfCritique(solvedObjects, styleToApply, imgUrl, sourceMap, effectiveCeilingM, mezSpec);
    } else {
      setStatusBanner(
        `${solvedObjects.length} Pinterest parçası${mezSpec ? ' (2 katlı asma kat dahil!)' : ''} gerçek renk ve konumlarıyla 3B odaya kuruldu!`
      );
      onToast(`Pinterest odası ${solvedObjects.length} parçayla 3B olarak kuruldu!`);
    }
  };

  /**
   * STAGE 3 — Visual Self-Critique & Auto-Correction Loop:
   * Captures our live 3D rendered room, sends [Original Pinterest Photo + Rendered 3D Screenshot + Placed Object JSON]
   * to Vision AI, and automatically applies every position/wall/floor/color/window correction!
   */
  const runVisualSelfCritique = async (
    currentObjs: ArchPlacedObject[],
    styleCtx: PinterestRoomStyle | null,
    origImgUrl: string,
    sourceMapInput?: Map<string, PinterestDetectedObject>,
    ceilingOverride?: number,
    mezOverride?: ArchMezzanine | null
  ) => {
    setRefining(true);
    setStatusBanner('Adım 3/3 · Görsel Kalite Kontrolü: 3B oda orijinal fotoğrafla karşılaştırılıp hatalı yerleşimler düzeltiliyor...');
    try {
      // Wait for Three.js WebGL camera reset & geometry rebuild to finish drawing a fresh clean frame
      await new Promise((r) => setTimeout(r, 700));
      const snap3d = onCaptureViewport();
      if (!snap3d) {
        setStatusBanner(`${currentObjs.length} Pinterest parçası 3B odaya kuruldu!`);
        return;
      }

      const effCeil = ceilingOverride || project.ceilingM;
      const effMez = mezOverride !== undefined ? mezOverride : project.mezzanine || null;
      const summary = `${styleCtx?.styleNameTr || 'Mimari Oda'} · Tavan ${effCeil.toFixed(2)}m · ${
        effMez?.enabled ? `2 Katlı Asma Kat (${Math.round(effMez.heightM * 100)}cm)` : 'Tek Kat'
      }`;

      const qa = await verifyAndRefinePinterestRoom({
        originalPhotoDataUrl: origImgUrl,
        rendered3dDataUrl: snap3d,
        roomSummary: summary,
        roomWidthM: project.widthM,
        roomDepthM: project.depthM,
        roomCeilingM: effCeil,
        placedObjects: currentObjs as unknown as Array<Record<string, unknown>>,
        geminiKey,
      });

      const updatedCeil =
        qa.roomFixes?.enableMezzanine && effCeil < 3.85 ? 4.1 : effCeil;
      const updatedMez: ArchMezzanine | undefined =
        qa.roomFixes?.enableMezzanine
          ? {
              enabled: true,
              anchorWall: effMez?.anchorWall || 'north',
              heightM: (qa.roomFixes.mezzanineHeightCm || 205) / 100,
              depthM: effMez?.depthM || Math.round(project.depthM * 52) / 100,
              widthRatio: effMez?.widthRatio || 0.78,
              stairGapSide: effMez?.stairGapSide || 'west',
              thicknessM: 0.16,
              deckColorHex: effMez?.deckColorHex || styleCtx?.floorTintHex || '#c9b092',
              railingStyle: effMez?.railingStyle || 'none',
              underLed: true,
            }
          : effMez || undefined;

      const { objects: refinedObjs, appliedCount } = applyVisualCritiqueFixes(currentObjs, qa.objectFixes, {
        widthM: project.widthM,
        depthM: project.depthM,
        ceilingM: updatedCeil,
        mezzanine: updatedMez,
      });

      // Spawn any obvious missed hero items reported by QA (capped to 3)
      const addedObjs: ArchPlacedObject[] = [];
      const addedDetected: PinterestDetectedObject[] = [];
      if (qa.missingObjects && qa.missingObjects.length > 0) {
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
        for (const miss of qa.missingObjects.slice(0, 3)) {
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

      const finalObjects = applyArchitecturalRelationships(
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

      if (addedDetected.length > 0) {
        setDetected((prev) => [...prev, ...addedDetected]);
        setJobs((prev) => {
          const next = { ...prev };
          addedDetected.forEach((d) => {
            next[d.id] = { selected: true, status: 'done', progressText: 'Görsel kontrol ile eklendi' };
          });
          return next;
        });
      }

      if (onRefinePinterestScene) {
        onRefinePinterestScene(finalObjects, qa.roomFixes);
      } else {
        onApplyPinterestScene(finalObjects, styleCtx, true);
      }

      setQaResult({
        matchScore: qa.matchScore,
        critiqueTr: qa.critiqueTr,
        fixedCount: appliedCount,
        addedCount: addedObjs.length,
        model: qa.model,
      });
      setStatusBanner(
        `✓ 3 Aşamalı Doğrulama Tamamlandı (${finalObjects.length} parça · ${appliedCount} düzeltme${
          addedObjs.length > 0 ? `, +${addedObjs.length} eksik parça eklendi` : ''
        }).`
      );
      onToast(`3B oda görsel olarak doğrulandı (${appliedCount} otomatik düzeltme)!`);
    } catch (err) {
      // Initial Stage-2 scene is already cleanly built; surface non-fatal QA note gracefully
      setStatusBanner(
        `${currentObjs.length} Pinterest parçası 3B odaya kuruldu (Görsel doğrulama atlandı: ${
          err instanceof Error ? err.message.slice(0, 90) : 'tekrar deneyebilirsiniz'
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
      setPhotoDataUrl(norm.dataUrl);
      setRoomStyle(null);
      setDetected([]);
      setJobs({});
      setQaResult(null);
      setDrawMode('off');
      setDraftBox(null);
      setStatusBanner(null);
    } catch {
      onToast('Fotoğraf okunamadı — lütfen JPG/PNG/WebP seçin.');
    }
  };

  const handleAnalyze = async () => {
    if (!photoDataUrl) return;
    if (!hasGeminiAccess) {
      setShowKeyBox(true);
      onToast('Önce Google Gemini API anahtarınızı girin.');
      return;
    }
    setAnalyzing(true);
    setQaResult(null);
    setDrawMode('off');
    setStatusBanner('Adım 1/3 · Mimari Analiz: Duvarlar, kat yapısı, renkler ve tüm eşyalar okunuyor...');
    try {
      const res = await analyzePinterestRoom({
        imageDataUrl: photoDataUrl,
        roomWidthM: project.widthM,
        roomDepthM: project.depthM,
        roomCeilingM: project.ceilingM,
        geminiKey,
      });
      setRoomStyle(res.roomStyle);
      setDetected(res.detectedObjects);
      const initJobs: Record<string, ItemJobState> = {};
      res.detectedObjects.forEach((o) => {
        initJobs[o.id] = { selected: true, status: 'idle' };
      });
      setJobs(initJobs);

      if (autoPopulateOnAnalyze && res.detectedObjects.length > 0) {
        setStatusBanner('Adım 2/3 · Mimari İlişki Motoru: Eşyalar doğru duvarlara, katlara ve hizalara kuruluyor...');
        await assembleAllInstantIn3D(res.detectedObjects, res.roomStyle, photoDataUrl, replaceExistingOnBuild);
      } else {
        setStatusBanner(
          `${res.detectedObjects.length} parça ve oda stili tespit edildi (${res.model}). "Tüm Odayı 3B'ye Kur" butonuyla hepsini anında yerleştirebilirsin.`
        );
        // Hydrate thumbnails in background
        void Promise.all(
          res.detectedObjects.map(async (item) => {
            const url = await cropBoxFromDataUrl(photoDataUrl, item.box2d, 0.025).catch(() => undefined);
            if (!url) return;
            setJobs((prev) => (prev[item.id] ? { ...prev, [item.id]: { ...prev[item.id], cropPreviewUrl: url } } : prev));
          })
        );
      }
    } catch (err) {
      setStatusBanner(null);
      onToast(err instanceof Error ? err.message : 'Pinterest analizi başarısız oldu.');
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

    const newId = `drawn-${Date.now()}`;
    const cx = ((xmin + xmax) * 0.5) / 1000;
    const cy = ((ymin + ymax) * 0.5) / 1000;
    const sampled = preview ? await sampleDominantHexFromDataUrl(preview) : '#8b7f70';
    const placeholder: PinterestDetectedObject = {
      id: newId,
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
      // Place immediately in 3D room!
      const occupied: OBB2D[] = project.objects
        .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8)
        .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
      const built = await buildInstant3DObject(finalItem, photoDataUrl, occupied, { north: [], east: [], south: [], west: [] });
      onAddGeneratedObject(built.obj);
      setJobs((prev) => ({
        ...prev,
        [newId]: {
          ...(prev[newId] || { selected: true }),
          status: 'done',
          cropPreviewUrl: built.cropPreview,
          progressText: '3B odaya eklendi',
        },
      }));
      onToast(`"${finalItem.nameTr}" fotoğraftan tanınıp anında 3B odaya eklendi!`);
    } else {
      updateDetectedItem(newId, { nameTr: 'Özel Seçilen Parça' });
    }
  };

  /**
   * Instant 0.1s placement of a single item into the 3D room (with its exact Pinterest color & type!)
   */
  const placeSingleInstantIn3D = async (item: PinterestDetectedObject) => {
    if (!photoDataUrl) return;
    const occupied: OBB2D[] = project.objects
      .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && o.pinterestItemId !== item.id)
      .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
    const built = await buildInstant3DObject(item, photoDataUrl, occupied, { north: [], east: [], south: [], west: [] });
    onAddGeneratedObject(built.obj);
    setJobs((prev) => ({
      ...prev,
      [item.id]: {
        ...(prev[item.id] || { selected: true }),
        status: 'done',
        cropPreviewUrl: built.cropPreview,
        rawCropUrl: built.rawCrop,
        progressText: '3B odada — tıklayıp düzenle',
      },
    }));
    onToast(`"${item.nameTr}" 3B odaya yerleştirildi! Tıklayıp rengini/yerini değiştirebilirsin.`);
  };

  /**
   * Optional High-Detail Sculptural Upgrade: replaces an item in-place with a RunPod Hunyuan3D-2.1 2K PBR .GLB!
   */
  const upgradeItemWithRunPod3D = async (item: PinterestDetectedObject) => {
    if (!photoDataUrl) return;
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
      const croppedUrl = await cropBoxFromDataUrl(photoDataUrl, item.box2d, 0.025);
      let modelInputImage = croppedUrl;
      let usedDirectCrop = false;

      if (hasGeminiAccess && !geminiImageQuotaBlockedRef.current) {
        try {
          const iso = await isolatePinterestObject({
            fullRoomImageDataUrl: photoDataUrl,
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
      const occupied: OBB2D[] = project.objects
        .filter((o) => o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 0.8 && o.pinterestItemId !== item.id)
        .map((o) => ({ id: o.id, x: o.x, z: o.z, rot: o.rot, halfW: o.widthM * 0.5, halfD: o.depthM * 0.5 }));
      const base = await buildInstant3DObject(item, photoDataUrl, occupied, { north: [], east: [], south: [], west: [] });
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

  const handleRebuildSelectedInstant = async () => {
    if (!photoDataUrl) return;
    const targets = detected.filter((d) => jobs[d.id]?.selected);
    if (targets.length === 0) {
      onToast('Önce odaya kurulacak en az bir parça seçin.');
      return;
    }
    setBatchRunning(true);
    try {
      await assembleAllInstantIn3D(targets, roomStyle, photoDataUrl, replaceExistingOnBuild);
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
    <div className="space-y-4 text-xs">
      {/* Engine status & Gemini API Key config */}
      <div className="border border-stone-200 bg-[#faf9f6] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-stone-950">Pinterest → Anında 3B Oda Motoru</p>
            <p className="text-[11px] text-stone-500">Tek tıkla tüm eşya &amp; renkleri odaya kur, canlı düzenle</p>
          </div>
          <button
            type="button"
            onClick={() => setShowKeyBox((v) => !v)}
            className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-3 h-3" />
            <span>API</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono">
          <span className={hasGeminiAccess ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
            ● Vision AI:{' '}
            {geminiKey.trim()
              ? 'Oturum Anahtarı'
              : serverCfg.groqConfigured || serverCfg.openaiConfigured || serverCfg.openrouterConfigured
              ? 'Çift Motor Bağlı'
              : serverCfg.geminiConfigured
              ? 'Sunucu Bağlı'
              : 'Anahtar Gerekli'}
          </span>
          <span className={runpodReady ? 'text-emerald-700 font-semibold' : 'text-stone-500'}>
            ● 2K PBR: {runpodReady ? 'Hazır' : 'Opsiyonel'}
          </span>
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

      {/* Step 1: Upload Pinterest Photo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            01 · Pinterest Oda Fotoğrafı
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
                <span>{drawMode === 'new' ? 'Çizimi İptal' : 'Alan Çiz'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhotoDataUrl(null);
                  setDetected([]);
                  setRoomStyle(null);
                  setDrawMode('off');
                }}
                className="text-[11px] text-stone-500 hover:text-stone-950 underline"
              >
                Değiştir
              </button>
            </div>
          )}
        </div>

        {!photoDataUrl ? (
          <label className="block border border-dashed border-stone-400 hover:border-stone-950 bg-white p-5 text-center cursor-pointer transition">
            <Upload className="w-5 h-5 mx-auto text-stone-500 mb-1.5" />
            <p className="font-semibold text-stone-900">Pinterest Oda Görseli Yükle veya Ctrl+V Yapıştır</p>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Rastgele herhangi bir Pinterest odasını saniyeler içinde düzenlenebilir 3B odaya dönüştürür
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
                detected.map((item, i) => {
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

            <div className="flex flex-col gap-1.5 text-[11px] text-stone-700 bg-[#faf9f6] border border-stone-200 px-2.5 py-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPopulateOnAnalyze}
                  onChange={(e) => setAutoPopulateOnAnalyze(e.target.checked)}
                  className="accent-stone-950"
                />
                <span className="font-medium text-stone-900">Analiz bitince tüm eşyaları 3B odaya anında kur</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExistingOnBuild}
                  onChange={(e) => setReplaceExistingOnBuild(e.target.checked)}
                  className="accent-stone-950"
                />
                <span>Mevcut demo eşyalarını temizleyip yeni odayı kur</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoVerifyAfterBuild}
                  onChange={(e) => setAutoVerifyAfterBuild(e.target.checked)}
                  className="accent-stone-950"
                />
                <span className="font-medium text-stone-900">
                  Kurulum sonrası 3B sahneyi fotoğrafla doğrula &amp; otomatik düzelt
                </span>
              </label>
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
                  ? '3/3 · Görsel Kontrol & Düzeltme Yapılıyor...'
                  : analyzing
                  ? '1/3 · Oda Analiz Ediliyor & 3B Kuruluyor...'
                  : autoPopulateOnAnalyze
                  ? "Pinterest Odasını Analiz Et & 3B'ye Kur"
                  : 'Odayı & Tüm Eşyaları Tespit Et'}
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

      {/* Stage 3 Visual QA Readout & On-Demand Re-Verify Button */}
      {photoDataUrl && project.objects.length > 0 && (qaResult || detected.length > 0) && (
        <div className="border border-stone-300 bg-[#faf9f6] p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-800">
              Görsel Kalite Kontrolü (Aşama 3)
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
                ({qaResult.fixedCount} düzeltme{qaResult.addedCount > 0 ? `, +${qaResult.addedCount} ekleme` : ''})
              </span>
            </p>
          )}
          <button
            type="button"
            disabled={analyzing || refining}
            onClick={() => runVisualSelfCritique(project.objects, roomStyle, photoDataUrl)}
            className="w-full py-1.5 border border-stone-950 hover:bg-stone-950 hover:text-white bg-white text-stone-950 text-[11px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition"
          >
            {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            <span>{refining ? 'Fotoğrafla Karşılaştırılıyor...' : '3B Sahneyi Fotoğrafla Tekrar Doğrula & Düzelt'}</span>
          </button>
        </div>
      )}

      {/* Step 2: Extracted Room Style */}
      {roomStyle && (
        <div className="border border-stone-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              02 · Mimari Renk &amp; Zemin Stili
            </span>
            <span className="font-semibold text-stone-900 truncate">{roomStyle.styleNameTr}</span>
          </div>
          <p className="text-[11px] text-stone-600 leading-relaxed">{roomStyle.summaryTr}</p>
          <div className="flex items-center gap-2 text-[10px] font-mono text-stone-600">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border border-black/20" style={{ backgroundColor: roomStyle.wallColorHex }} />
              Duvar
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border border-black/20" style={{ backgroundColor: roomStyle.floorTintHex }} />
              Zemin
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 border border-black/20" style={{ backgroundColor: roomStyle.curtainColorHex }} />
              Perde
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onApplyRoomStyle(roomStyle);
              onToast('Pinterest duvar, zemin ve perde tonları 3B odaya uygulandı.');
            }}
            className="w-full py-1.5 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-stone-900 font-semibold transition"
          >
            Duvar, Zemin &amp; Perde Stilini Yeniden Uygula
          </button>
        </div>
      )}

      {/* Step 3: Live Editable Pinterest Objects inside the 3D Room */}
      {detected.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · Odadaki Pinterest Parçaları ({detected.length})
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  const allSelected = detected.every((d) => jobs[d.id]?.selected);
                  setJobs((prev) => {
                    const next = { ...prev };
                    detected.forEach((d) => {
                      next[d.id] = { ...(next[d.id] || { status: 'idle', selected: false }), selected: !allSelected };
                    });
                    return next;
                  });
                }}
                className="text-stone-600 hover:text-stone-950 underline"
              >
                {detected.every((d) => jobs[d.id]?.selected) ? 'Kaldır' : 'Tümü'}
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

          <button
            type="button"
            disabled={batchRunning || selectedCount === 0}
            onClick={handleRebuildSelectedInstant}
            className="w-full py-2 bg-stone-950 hover:bg-stone-800 disabled:opacity-45 text-white font-semibold flex items-center justify-center gap-1.5 transition"
          >
            {batchRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
            <span>Seçili {selectedCount} Parçayı 3B Odaya Anında Kur</span>
          </button>

          <div className="space-y-2">
            {detected.map((item, idx) => {
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
                          title="Opsiyonel: RunPod Hunyuan3D-2.1 ile tam heykelsi 2K PBR .GLB modele yükselt"
                        >
                          <Wand2 className="w-3 h-3" />
                          <span>2K PBR</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {geminiImageQuotaNote && (
        <div className="border border-amber-300 bg-amber-50 p-2.5 text-[10px] text-amber-950 leading-relaxed">
          Not: Google AI Studio Free Tier&apos;da görsel üretme kotası 0 olduğu için 2K PBR yükseltmeleri doğrudan sıkı kırpımla
          RunPod&apos;a gider; Fotogerçekçi V-Ray Render için Google AI Studio Billing gerekir.
        </div>
      )}

      {/* Bonus: 1-Click V-Ray Style Photoreal Render of Current 3D Room */}
      <div className="border-t border-stone-200 pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            Müşteri Sunumu · Fotogerçekçi Render
          </span>
        </div>
        <p className="text-[11px] text-stone-600 leading-relaxed">
          3B sahnenin şu anki kamera açısını pencere, kiriş, perde havuzu ve güneş açısını bozmadan V-Ray kalitesinde gerçek fotoğrafa dönüştürür.
        </p>
        <textarea
          rows={2}
          value={renderStyleNote}
          onChange={(e) => setRenderStyleNote(e.target.value)}
          placeholder="Işık veya atmosfer notu..."
          className="w-full px-2.5 py-1.5 border border-stone-300 bg-white text-[11px] resize-none leading-snug"
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
