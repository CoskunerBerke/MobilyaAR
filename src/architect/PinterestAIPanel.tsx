import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Crop,
  Download,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
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
  isolatePinterestObject,
  saveGeminiKey,
  type PinterestDetectedObject,
  type PinterestRoomStyle,
  type PinterestServerConfig,
} from './pinterestClient';
import {
  WALL_LABELS,
  type ArchPlacedObject,
  type ArchRoomProject,
  type ParametricFurnitureKind,
  type WallId,
} from './types';

interface Props {
  project: ArchRoomProject;
  onApplyRoomStyle: (style: PinterestRoomStyle) => void;
  onAddGeneratedObject: (obj: ArchPlacedObject) => void;
  onCaptureViewport: () => string | null;
  onToast: (msg: string) => void;
}

interface ItemJobState {
  selected: boolean;
  status: 'idle' | 'isolating' | 'modeling' | 'done' | 'error';
  cropPreviewUrl?: string;
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

export const PinterestAIPanel: React.FC<Props> = ({
  project,
  onApplyRoomStyle,
  onAddGeneratedObject,
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

  const hasGeminiAccess = serverCfg.geminiConfigured || Boolean(geminiKey.trim());

  const hydrateCropPreviews = async (imgUrl: string, list: PinterestDetectedObject[]) => {
    const previews: Record<string, string> = {};
    await Promise.all(
      list.map(async (item) => {
        try {
          previews[item.id] = await cropBoxFromDataUrl(imgUrl, item.box2d, 0.025);
        } catch {
          /* ignore */
        }
      })
    );
    setJobs((prev) => {
      const next = { ...prev };
      for (const [id, url] of Object.entries(previews)) {
        if (next[id]) next[id] = { ...next[id], cropPreviewUrl: url };
      }
      return next;
    });
  };

  const handleUploadInspiration = async (file: File | null) => {
    if (!file) return;
    try {
      const norm = await normalizeRoomPhoto(file, 1400);
      setPhotoDataUrl(norm.dataUrl);
      setRoomStyle(null);
      setDetected([]);
      setJobs({});
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
    setDrawMode('off');
    setStatusBanner('Gemini 3.8 Vision odadaki tüm eşya, dekor, aydınlatma ve stili tarıyor...');
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
      res.detectedObjects.forEach((o, idx) => {
        initJobs[o.id] = { selected: idx < 4, status: 'idle' };
      });
      setJobs(initJobs);
      setStatusBanner(
        `${res.detectedObjects.length} parça ve oda stili tespit edildi (${res.model}). Eksik parça varsa "Alan Çiz" ile fotoğraftan işaretleyebilirsin.`
      );
      void hydrateCropPreviews(photoDataUrl, res.detectedObjects);
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
          status: 'idle',
          errorMsg: undefined,
        },
      }));
      onToast('Seçim kutusu güncellendi — kırpım önizlemesi yenilendi.');
      return;
    }

    // New user-drawn item! Add immediately and auto-identify via Gemini 3.8 Vision (free tier!)
    const newId = `drawn-${Date.now()}`;
    const cx = ((xmin + xmax) * 0.5) / 1000;
    const cy = ((ymin + ymax) * 0.5) / 1000;
    const placeholder: PinterestDetectedObject = {
      id: newId,
      nameTr: 'Seçilen Parça (Tanımlanıyor...)',
      category: 'Dekor',
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
      if (info) {
        updateDetectedItem(newId, {
          nameTr: info.nameTr || 'Seçilen Parça',
          category: info.category || 'Dekor',
          widthCm: Number(info.widthCm) || 90,
          depthCm: Number(info.depthCm) || 60,
          heightCm: Number(info.heightCm) || 90,
          mountMode: info.mountMode || 'floor',
          elevationCm: Number(info.elevationCm) || 0,
          visualDescriptionEn: info.visualDescriptionEn || placeholder.visualDescriptionEn,
        });
        onToast(`"${info.nameTr}" fotoğraftan eklendi!`);
      } else {
        updateDetectedItem(newId, { nameTr: 'Özel Seçilen Parça' });
        onToast('Seçtiğiniz alan listeye eklendi — adını düzenleyip 3B üretebilirsiniz.');
      }
    } else {
      updateDetectedItem(newId, { nameTr: 'Özel Seçilen Parça' });
    }
  };

  const detectInstantFlatKind = (item: PinterestDetectedObject): ParametricFurnitureKind | null => {
    const label = `${item.nameTr} ${item.category}`.toLowerCase();
    if (item.mountMode === 'rug' || /halı|hali|kilim|rug|carpet/.test(label)) return 'rug_custom';
    if (/ayna|mirror/.test(label)) return 'wall_mirror';
    if (/tablo|poster|resim|çerçeve|cerceve|painting|artwork|frame/.test(label)) return 'wall_art';
    return null;
  };

  const buildPlacedFromDetected = (
    item: PinterestDetectedObject,
    glbUrl: string | undefined,
    thumbUrl: string,
    parametricKind?: ParametricFurnitureKind
  ): ArchPlacedObject => {
    const wM = Math.max(0.2, item.widthCm / 100);
    const dM = Math.max(0.04, item.depthCm / 100);
    const hM = Math.max(0.015, item.heightCm / 100);
    let x = Math.max(-project.widthM * 0.44, Math.min(project.widthM * 0.44, item.relativeX * (project.widthM * 0.45)));
    let z = Math.max(-project.depthM * 0.44, Math.min(project.depthM * 0.44, item.relativeZ * (project.depthM * 0.45)));
    let rot = (item.facingDeg * Math.PI) / 180;
    const isWallItem = item.mountMode === 'wall' || parametricKind === 'wall_mirror' || parametricKind === 'wall_art';
    const y = isWallItem
      ? Math.max(0.9, item.elevationCm > 0 ? item.elevationCm / 100 : 1.25)
      : item.mountMode === 'ceiling'
      ? Math.max(1.5, project.ceilingM - hM)
      : 0;

    const wallTarget: WallId =
      item.suggestedWall && item.suggestedWall !== 'center' ? item.suggestedWall : 'north';

    if (isWallItem) {
      if (wallTarget === 'north') {
        z = -project.depthM * 0.5 + dM * 0.5 + 0.01;
        rot = 0;
      } else if (wallTarget === 'south') {
        z = project.depthM * 0.5 - dM * 0.5 - 0.01;
        rot = Math.PI;
      } else if (wallTarget === 'west') {
        x = -project.widthM * 0.5 + dM * 0.5 + 0.01;
        rot = Math.PI / 2;
      } else if (wallTarget === 'east') {
        x = project.widthM * 0.5 - dM * 0.5 - 0.01;
        rot = -Math.PI / 2;
      }
    }

    return {
      id: `pin3d-${item.id}-${Date.now()}`,
      name: item.nameTr,
      category: item.category,
      dimensionsCm: `${Math.round(item.widthCm)} × ${Math.round(item.depthCm)} × ${Math.round(item.heightCm)} cm`,
      glbUrl,
      parametricKind,
      parametricColorHex: parametricKind ? '#1c1b1a' : undefined,
      parametricAccentHex: parametricKind === 'wall_mirror' ? '#d8e2ec' : parametricKind ? '#ece8df' : undefined,
      x,
      y,
      z,
      rot,
      widthM: wM,
      depthM: dM,
      heightM: hM,
      mountMode: parametricKind === 'rug_custom' ? 'rug' : isWallItem ? 'wall' : item.mountMode,
      attachedWall: isWallItem ? wallTarget : item.suggestedWall !== 'center' ? item.suggestedWall : undefined,
      thumbUrl,
      source: 'pinterest-ai',
    };
  };

  const generateSingleItem3D = async (item: PinterestDetectedObject) => {
    if (!photoDataUrl) return;
    setJobs((prev) => ({
      ...prev,
      [item.id]: {
        ...(prev[item.id] || { selected: true }),
        status: 'isolating',
        progressText: 'Hazırlanıyor...',
        errorMsg: undefined,
      },
    }));

    try {
      // Fast 0.1s 1:1 Textured 3D path for flat rugs, framed wall art & mirrors (sharper than sculpted mesh & $0 GPU!)
      const flatKind = detectInstantFlatKind(item);
      if (flatKind) {
        const rawCrop = await cropRawTightDataUrl(photoDataUrl, item.box2d);
        const placed = buildPlacedFromDetected(item, undefined, rawCrop, flatKind);
        onAddGeneratedObject(placed);
        setJobs((prev) => ({
          ...prev,
          [item.id]: {
            ...(prev[item.id] || { selected: true }),
            status: 'done',
            cropPreviewUrl: rawCrop,
            studioPreviewUrl: rawCrop,
            progressText: 'Anında 1:1 dokuyla odaya yerleştirildi',
          },
        }));
        onToast(`${item.nameTr} birebir dokusuyla anında 3B odaya yerleştirildi!`);
        return;
      }

      // Step 1: High-res tight crop onto clean 1024×1024 pure white canvas
      const croppedUrl = await cropBoxFromDataUrl(photoDataUrl, item.box2d, 0.025);
      let modelInputImage = croppedUrl;
      let usedDirectCrop = false;

      // Step 2: Try Gemini 3.1 Flash Image (Nano Banana 2) Studio Isolation if available.
      // If Google AI Studio Free Tier returns quota limit:0 (429), NEVER fail — fall back seamlessly to tight crop -> RunPod!
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
          progressText: usedDirectCrop
            ? 'Sıkı kırpım RunPod 2K PBR GPU motoruna gönderiliyor...'
            : 'Stüdyo izole edildi · RunPod 2K PBR 3B örüyor...',
        },
      }));

      // Step 3: Reconstruct faithful 2K PBR 3D .GLB via RunPod Hunyuan3D-2.1 (with 1x automatic worker retry!)
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
        // Auto-retry once if a stale RunPod worker threw ImportError/transient error
        if (/libusb|ImportError|timeout|502|503|FAILED/i.test(em)) {
          setJobs((prev) => ({
            ...prev,
            [item.id]: {
              ...(prev[item.id] || { selected: true }),
              progressText: 'Sağlıklı GPU worker ile tekrar deneniyor...',
            },
          }));
          gen = await runOnce();
        } else {
          throw firstErr;
        }
      }

      const glbUrl = gen.remoteGlbUrl || gen.localBlobUrl;
      const placed = buildPlacedFromDetected(item, glbUrl, modelInputImage);
      onAddGeneratedObject(placed);

      setJobs((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] || { selected: true }),
          status: 'done',
          cropPreviewUrl: croppedUrl,
          studioPreviewUrl: modelInputImage,
          usedDirectCrop,
          progressText: 'Odaya yerleştirildi',
        },
      }));
      onToast(`${item.nameTr} birebir 3B üretildi ve odaya yerleştirildi!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '3B üretim hatası';
      setJobs((prev) => ({
        ...prev,
        [item.id]: { ...(prev[item.id] || { selected: true }), status: 'error', errorMsg: msg },
      }));
      onToast(`${item.nameTr}: ${msg}`);
    }
  };

  const handleGenerateSelectedBatch = async () => {
    const targets = detected.filter((d) => jobs[d.id]?.selected && jobs[d.id]?.status !== 'done');
    if (targets.length === 0) {
      onToast('Önce 3B üretilecek en az bir eşya seçin.');
      return;
    }
    setBatchRunning(true);
    setStatusBanner(`${targets.length} parça paralel olarak 3B üretilip odaya yerleştiriliyor...`);
    try {
      const concurrency = 2;
      let idx = 0;
      const runNext = async (): Promise<void> => {
        if (idx >= targets.length) return;
        const cur = targets[idx++];
        await generateSingleItem3D(cur);
        await runNext();
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => runNext()));
      setStatusBanner('Seçilen Pinterest parçalarının 3B üretim işlemi tamamlandı.');
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
          'Google AI Studio Free Tier hesabında görsel üretim kotası (gemini-3.1-flash-image) 0 olarak sınırlıdır. Fotogerçekçi V-Ray Render için Google AI Studio Billing (ödeme hesabı) etkinleştirilmelidir.'
        );
      } else {
        setRenderError(raw);
      }
      onToast('Fotogerçekçi render alınamadı — ayrıntı aşağıda.');
    } finally {
      setRenderingPhoto(false);
    }
  };

  const selectedCount = detected.filter((d) => jobs[d.id]?.selected && jobs[d.id]?.status !== 'done').length;
  const activeHoverItem = detected.find((d) => d.id === hoveredId) || null;

  return (
    <div className="space-y-4 text-xs">
      {/* Engine status & Gemini API Key config */}
      <div className="border border-stone-200 bg-[#faf9f6] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-stone-950">Pinterest → Birebir 3B Motoru</p>
            <p className="text-[11px] text-stone-500">Gemini 3.8 Vision + Kırpım/İzolasyon + RunPod 2K PBR</p>
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
            ● Gemini: {serverCfg.geminiConfigured ? 'Sunucu Bağlı' : geminiKey ? 'Oturum Anahtarı' : 'Anahtar Gerekli'}
          </span>
          <span className={runpodReady ? 'text-emerald-700 font-semibold' : 'text-stone-500'}>
            ● RunPod 3B: {runpodReady ? 'Hazır' : 'Kontrol'}
          </span>
        </div>

        {showKeyBox && (
          <div className="pt-2 border-t border-stone-200 space-y-2">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">
              Google AI Studio (Gemini API Key)
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
                placeholder="AIzaSy..."
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
                    const r = await fetch(
                      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=5&key=${encodeURIComponent(clean)}`
                    );
                    if (r.ok) {
                      setKeyTestResult('✓ Bağlantı doğrulandı (Gemini 3.8 Flash hazır)');
                      onToast('Gemini API anahtarı doğrulandı ve kaydedildi!');
                    } else {
                      const d = await r.json().catch(() => null);
                      setKeyTestResult(`Hata: ${d?.error?.message || 'Anahtar geçersiz'}`);
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
            <p className="text-[10px] text-stone-500 leading-relaxed">
              Tüm cihazlarda (TV, iPad, telefon, müşteri) şifresiz çalışması için Vercel → Settings → Environment Variables kısmına{' '}
              <code className="font-mono font-semibold text-stone-800">GEMINI_API_KEY</code> ekleyin.
            </p>
          </div>
        )}
      </div>

      {/* Informative note if Gemini Free Tier image-gen quota is 0 (3D STILL WORKS via RunPod!) */}
      {geminiImageQuotaNote && (
        <div className="border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-950 space-y-1 leading-relaxed">
          <p className="font-semibold">Bilgi: Direkt Sıkı Kırpım + RunPod 3B Modu Aktif</p>
          <p className="text-[10px] text-amber-900">
            Google AI Studio Free Tier hesabında <strong>Nano Banana 2</strong> (görsel izolasyon / V-Ray render) kotası{' '}
            <code className="font-mono">0</code> olduğu için sistem <strong>hata vermeden</strong> otomatik olarak yüksek
            çözünürlüklü sıkı kırpımla doğrudan RunPod 2K PBR 3B üretimine geçti. Tam stüdyo izolasyon ve V-Ray render için
            Google AI Studio&apos;da Billing açabilirsiniz (~0,01 $/görsel).
          </p>
        </div>
      )}

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
              Odadaki 20&apos;ye kadar tüm mobilya, lamba, halı, bitki ve dekorları otomatik ayırır
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
                    ? 'Fotoğrafta eklemek istediğin eşyanın etrafını sürükleyip kutu çiz'
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

            {/* Clean Annotated Inspiration Image (tiny corner number badges — zero text clutter!) */}
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
                      onClick={() =>
                        setJobs((prev) => ({
                          ...prev,
                          [item.id]: {
                            ...(prev[item.id] || { status: 'idle', selected: false }),
                            selected: !prev[item.id]?.selected,
                          },
                        }))
                      }
                      style={{
                        top: `${ymin / 10}%`,
                        left: `${xmin / 10}%`,
                        width: `${Math.max(3, (xmax - xmin) / 10)}%`,
                        height: `${Math.max(3, (ymax - ymin) / 10)}%`,
                        borderColor: col,
                        backgroundColor: isHov ? `${col}33` : isSel ? `${col}18` : 'transparent',
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

              {/* Live rubber-band selection rectangle while dragging */}
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

            {/* Active hovered item legend strip right below photo */}
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

            <button
              type="button"
              disabled={analyzing}
              onClick={handleAnalyze}
              className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{analyzing ? 'Tüm Oda Taranıyor...' : 'Odayı & Tüm Eşyaları Tespit Et'}</span>
            </button>
          </div>
        )}
      </div>

      {statusBanner && (
        <div className="border border-stone-300 bg-white px-3 py-2 text-[11px] text-stone-800 leading-snug">
          {statusBanner}
        </div>
      )}

      {/* Step 2: Extracted Room Style */}
      {roomStyle && (
        <div className="border border-stone-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              02 · Tespit Edilen Mimari Stil
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
            className="w-full py-1.5 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 font-semibold transition"
          >
            Duvar, Zemin &amp; Perde Stilini Odaya Uygula
          </button>
        </div>
      )}

      {/* Step 3: Detected Objects -> Tight Crop / Studio Isolate + RunPod 2K PBR 3D */}
      {detected.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · Birebir 3B Parçalar ({detected.length})
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
                {detected.every((d) => jobs[d.id]?.selected) ? 'Seçimi Kaldır' : 'Tümünü Seç'}
              </button>
              <button
                type="button"
                onClick={() => setDrawMode('new')}
                className="font-semibold text-stone-900 hover:text-stone-700 flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> Fotoğraftan Ekle
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {detected.map((item, idx) => {
              const st = jobs[item.id] || { selected: false, status: 'idle' };
              const col = BOX_COLORS[idx % BOX_COLORS.length];
              const thumb = st.studioPreviewUrl || st.cropPreviewUrl;
              const isHov = hoveredId === item.id;
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId((cur) => (cur === item.id ? null : cur))}
                  className={`border bg-white p-2.5 space-y-2 transition ${
                    isHov ? 'border-stone-950' : 'border-stone-200'
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
                          title="Listeden kaldır"
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

                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <select
                          value={item.mountMode}
                          onChange={(e) =>
                            updateDetectedItem(item.id, { mountMode: e.target.value as PinterestDetectedObject['mountMode'] })
                          }
                          className="px-1.5 py-0.5 border border-stone-200 text-[10px] bg-[#faf9f6]"
                        >
                          <option value="floor">Zemine Oturt</option>
                          <option value="wall">Duvara Yasla / As</option>
                          <option value="ceiling">Tavana As</option>
                          <option value="rug">Halı (Zemin)</option>
                        </select>
                        {item.mountMode === 'wall' && (
                          <select
                            value={item.suggestedWall}
                            onChange={(e) =>
                              updateDetectedItem(item.id, { suggestedWall: e.target.value as WallId | 'center' })
                            }
                            className="px-1.5 py-0.5 border border-stone-200 text-[10px] bg-[#faf9f6]"
                          >
                            {(['north', 'east', 'south', 'west'] as WallId[]).map((w) => (
                              <option key={w} value={w}>
                                {WALL_LABELS[w]}
                              </option>
                            ))}
                          </select>
                        )}
                        <span className="text-[9px] font-mono text-stone-400 ml-auto">{item.category}</span>
                      </div>
                    </div>
                  </div>

                  {st.status === 'error' && st.errorMsg && (
                    <div className="px-2 py-1.5 bg-red-50 border border-red-200 text-[10px] font-mono text-red-800 break-words leading-snug">
                      Hata: {st.errorMsg}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-stone-100">
                    <span className="text-[10px] font-mono min-w-0 truncate">
                      {st.status === 'isolating' && (
                        <span className="text-amber-700 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" /> Hazırlanıyor...
                        </span>
                      )}
                      {st.status === 'modeling' && (
                        <span className="text-blue-700 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          <span className="truncate">{st.progressText || 'RunPod 2K PBR üretiyor...'}</span>
                        </span>
                      )}
                      {st.status === 'done' && (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3 shrink-0" /> Odaya Eklendi
                        </span>
                      )}
                      {st.status === 'idle' && (
                        <span className="text-stone-400">Hazır</span>
                      )}
                    </span>

                    <button
                      type="button"
                      disabled={st.status === 'isolating' || st.status === 'modeling' || batchRunning}
                      onClick={() => generateSingleItem3D(item)}
                      className="px-2.5 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[10px] font-semibold whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {st.status === 'done'
                        ? 'Tekrar Yerleştir'
                        : detectInstantFlatKind(item)
                        ? 'Anında Odaya Koy'
                        : '3B Üret & Koy'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={batchRunning || selectedCount === 0}
            onClick={handleGenerateSelectedBatch}
            className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-45 text-white font-semibold flex items-center justify-center gap-2 transition"
          >
            {batchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            <span>
              {batchRunning
                ? 'RunPod 3B Üretim Sürüyor...'
                : `Seçili ${selectedCount} Parçayı Birebir 3B Üret & Odaya Diz`}
            </span>
          </button>
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
