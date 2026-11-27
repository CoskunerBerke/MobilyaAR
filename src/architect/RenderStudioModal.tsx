import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Columns,
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  Loader2,
  Moon,
  Sparkles,
  Sun,
  Sunset,
  Trash2,
  X,
} from 'lucide-react';
import { generatePhotorealRender, getSavedGeminiKey, isGeminiQuotaZeroError } from './pinterestClient';
import type { ArchRoomProject } from './types';

export interface StudioRenderItem {
  id: string;
  label: string;
  roomId: string;
  angle: 'current' | 'corner' | 'eye';
  presetId: string;
  presetLabel: string;
  snapshotDataUrl: string;
  renderImageDataUrl: string;
  referencePhotoUrl?: string;
  referencePhotoLabel?: string;
  model: string;
  createdAt: string;
}

export interface RenderStudioLaunchOpts {
  roomId?: string;
  angle?: 'current' | 'corner' | 'eye';
  referencePhoto?: { id: string; label: string; dataUrl: string } | null;
  autoStart?: boolean;
}

interface Props {
  open: boolean;
  project: ArchRoomProject;
  launchOpts: RenderStudioLaunchOpts | null;
  history: StudioRenderItem[];
  onAddRender: (item: StudioRenderItem) => void;
  onDeleteRender: (id: string) => void;
  onFocusRoom: (roomId: string, angle: 'corner' | 'eye') => void;
  onCaptureViewport: () => string | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const RENDER_PRESETS = [
  {
    id: 'daylight',
    label: 'Doğal Gün Işığı',
    short: 'Gün Işığı',
    note: 'Architectural Digest bright natural daylight streaming through windows, crisp soft global illumination, authentic oak/walnut wood grain, realistic fabric weave and subtle floor reflections.',
    icon: Sun,
  },
  {
    id: 'golden',
    label: 'Altın Saat',
    short: 'Altın Saat',
    note: 'Warm late-afternoon golden hour sunlight casting long dramatic warm sunbeams across the floor, glowing warm wood tones, cozy luxury architectural photography.',
    icon: Sunset,
  },
  {
    id: 'evening',
    label: 'Gece & Gizli LED',
    short: 'Gece LED',
    note: 'Luxury evening interior photography, glowing warm 2700K recessed ceiling LED coves, illuminated table lamps and fireplace, deep moody twilight sky outside windows, rich shadows.',
    icon: Moon,
  },
  {
    id: 'studio',
    label: 'Stüdyo Nötr',
    short: 'Stüdyo',
    note: 'Clean neutral V-Ray architectural studio presentation lighting, razor-sharp material accuracy, balanced soft shadows, neutral white balance for client catalog presentation.',
    icon: Sparkles,
  },
] as const;

export const RenderStudioModal: React.FC<Props> = ({
  open,
  project,
  launchOpts,
  history,
  onAddRender,
  onDeleteRender,
  onFocusRoom,
  onCaptureViewport,
  onClose,
  onToast,
}) => {
  const rooms = useMemo(() => {
    const list = [
      {
        id: 'main',
        name: 'Ana Salon',
        dims: `${project.widthM.toFixed(1)}×${project.depthM.toFixed(1)} m`,
      },
    ];
    for (const r of project.adjacentRooms || []) {
      list.push({
        id: r.id,
        name: r.name,
        dims: `${r.widthM.toFixed(1)}×${r.depthM.toFixed(1)} m`,
      });
    }
    return list;
  }, [project.widthM, project.depthM, project.adjacentRooms]);

  const [targetRoomId, setTargetRoomId] = useState<string>('current');
  const [cameraAngle, setCameraAngle] = useState<'corner' | 'eye'>('corner');
  const [presetId, setPresetId] = useState<string>('daylight');
  const [customNote, setCustomNote] = useState<string>('');
  const [activeRenderId, setActiveRenderId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'split' | 'render' | '3d' | 'ref'>('split');
  const [splitPct, setSplitPct] = useState<number>(52);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ cur: number; total: number } | null>(null);

  const sliderRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const autoStartConsumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      autoStartConsumedRef.current = null;
      return;
    }
    setErrorMsg(null);
    if (launchOpts?.roomId) {
      setTargetRoomId(launchOpts.roomId);
    } else {
      setTargetRoomId('current');
    }
    if (launchOpts?.angle === 'eye' || launchOpts?.angle === 'corner') {
      setCameraAngle(launchOpts.angle);
    }
    if (history.length > 0 && !activeRenderId) {
      setActiveRenderId(history[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, launchOpts]);

  const activeItem = useMemo(
    () => history.find((h) => h.id === activeRenderId) || history[0] || null,
    [history, activeRenderId]
  );

  const activePreset = useMemo(
    () => RENDER_PRESETS.find((p) => p.id === presetId) || RENDER_PRESETS[0],
    [presetId]
  );

  const waitFrames = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 110)));
    });

  const buildRoomSummary = (roomId: string) => {
    const r = rooms.find((x) => x.id === roomId) || rooms[0];
    return `${r.name} (${r.dims}, ceiling ${project.ceilingM.toFixed(2)}m), ${project.windows.length} windows, ${project.doors.length} doors, ${project.curtainCoves.length} LED coves, ${project.objects.length} furniture items, sun hour ${project.sun.hour.toFixed(1)}.`;
  };

  const renderSingleTarget = async (
    roomId: string,
    angle: 'current' | 'corner' | 'eye',
    refPhoto?: { id: string; label: string; dataUrl: string } | null
  ): Promise<StudioRenderItem | null> => {
    if (roomId !== 'current' && (angle === 'corner' || angle === 'eye')) {
      onFocusRoom(roomId, angle);
      await waitFrames();
    }
    const snap = onCaptureViewport();
    if (!snap) {
      throw new Error('3B sahne görüntüsü yakalanamadı. Önce 3B görünümün yüklendiğinden emin olun.');
    }
    const roomLabel =
      roomId === 'current'
        ? refPhoto
          ? `${refPhoto.label} · 3B Sahne`
          : 'Mevcut 3B Açı'
        : rooms.find((r) => r.id === roomId)?.name || 'Oda';

    const styleNote = [activePreset.note, customNote.trim()].filter(Boolean).join(' ');
    const res = await generatePhotorealRender({
      snapshotDataUrl: snap,
      styleNote,
      roomSummary: buildRoomSummary(roomId === 'current' ? 'main' : roomId),
      geminiKey: getSavedGeminiKey(),
    });

    const item: StudioRenderItem = {
      id: `ren-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: roomLabel,
      roomId,
      angle,
      presetId: activePreset.id,
      presetLabel: activePreset.short,
      snapshotDataUrl: snap,
      renderImageDataUrl: res.renderImageDataUrl,
      referencePhotoUrl: refPhoto?.dataUrl,
      referencePhotoLabel: refPhoto?.label,
      model: res.model || 'Gemini Image',
      createdAt: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    };
    onAddRender(item);
    setActiveRenderId(item.id);
    setCompareMode('split');
    setSplitPct(50);
    return item;
  };

  const handleRunSingleRender = async () => {
    if (busyMsg) return;
    setErrorMsg(null);
    const chosenAngle: 'current' | 'corner' | 'eye' = targetRoomId === 'current' ? 'current' : cameraAngle;
    const label =
      targetRoomId === 'current'
        ? launchOpts?.referencePhoto
          ? launchOpts.referencePhoto.label
          : 'Mevcut 3B Açı'
        : rooms.find((r) => r.id === targetRoomId)?.name || 'Oda';
    setBusyMsg(`${label} için fotogerçekçi V-Ray render üretiliyor...`);
    try {
      await renderSingleTarget(targetRoomId, chosenAngle, launchOpts?.referencePhoto || null);
      onToast(`${label} fotogerçekçi renderı hazır!`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Render üretilemedi.';
      setErrorMsg(
        isGeminiQuotaZeroError(raw)
          ? 'Google AI Studio görsel kotası sınırlı (Billing gerekli).'
          : raw
      );
      onToast('Fotogerçekçi render alınamadı.');
    } finally {
      setBusyMsg(null);
    }
  };

  const handleRunAllRoomsBatch = async () => {
    if (busyMsg) return;
    setErrorMsg(null);
    setBatchProgress({ cur: 0, total: rooms.length });
    let completed = 0;
    try {
      for (let i = 0; i < rooms.length; i++) {
        const rm = rooms[i];
        setBatchProgress({ cur: i + 1, total: rooms.length });
        setBusyMsg(`${i + 1}/${rooms.length} · ${rm.name} renderlanıyor...`);
        await renderSingleTarget(rm.id, cameraAngle, i === 0 ? launchOpts?.referencePhoto || null : null);
        completed++;
      }
      onToast(`${completed} oda için fotogerçekçi renderlar tamamlandı!`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Toplu render sırasında hata oluştu.';
      setErrorMsg(raw);
      onToast(`${completed}/${rooms.length} oda tamamlandı; hata oluştu.`);
    } finally {
      setBusyMsg(null);
      setBatchProgress(null);
    }
  };

  // Optional 1-click auto-start when launched directly from "Bu Odayı / Fotoğrafı Renderla"
  useEffect(() => {
    if (!open || !launchOpts?.autoStart) return;
    const key = `${launchOpts.roomId || 'current'}-${launchOpts.referencePhoto?.id || 'none'}`;
    if (autoStartConsumedRef.current === key) return;
    autoStartConsumedRef.current = key;
    const timer = setTimeout(() => {
      void handleRunSingleRender();
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, launchOpts]);

  const updateSliderFromClientX = (clientX: number) => {
    const el = sliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(4, Math.min(96, ((clientX - rect.left) / Math.max(1, rect.width)) * 100));
    setSplitPct(pct);
  };

  const downloadImage = (dataUrl: string, name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9ğüşöçı]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `mekanar-render-${slug || 'oda'}.png`;
    a.click();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-2.5 sm:p-5"
      onClick={() => {
        if (!busyMsg) onClose();
      }}
    >
      <div
        className="w-full max-w-6xl max-h-[92dvh] bg-white border border-stone-300 shadow-2xl flex flex-col overflow-hidden text-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Bar */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-stone-200 bg-[#0d0d0c] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-8 h-8 border border-white/25 bg-white/10 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4 text-[#e0c09a]" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#e0c09a]">
                MekanAR · V-Ray Fotogerçekçi Render Stüdyosu
              </p>
              <h2 className="font-display text-sm sm:text-base font-extrabold truncate">
                Her Oda, Her Açı &amp; Her Fotoğraf İçin Sunum Kalitesinde Render
              </h2>
            </div>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMsg)}
            onClick={onClose}
            className="p-2 border border-white/20 hover:border-white text-white/80 hover:text-white disabled:opacity-40 transition shrink-0"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: Left Controls + Right Full-Bleed Preview & Before/After Slider */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
          {/* Left Panel: Room, Angle, Lighting Presets & Batch Actions */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-stone-200 bg-[#faf9f6] p-4 sm:p-5 space-y-5 lg:overflow-y-auto">
            {/* Reference photo badge if launched from Pinterest photo */}
            {launchOpts?.referencePhoto && (
              <div className="border border-stone-300 bg-white p-2.5 flex items-center gap-2.5">
                <img
                  src={launchOpts.referencePhoto.dataUrl}
                  alt={launchOpts.referencePhoto.label}
                  className="w-12 h-10 object-cover border border-stone-200 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-mono uppercase text-stone-500">Bağlı Pinterest Fotoğrafı</p>
                  <p className="text-xs font-bold text-stone-950 truncate">
                    {launchOpts.referencePhoto.label}
                  </p>
                </div>
              </div>
            )}

            {/* 01 · Room / Angle Target */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                01 · Hangi Oda / Açı Renderlansın?
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                <button
                  type="button"
                  disabled={Boolean(busyMsg)}
                  onClick={() => setTargetRoomId('current')}
                  className={`px-3 py-2 border text-left flex items-center justify-between text-xs transition ${
                    targetRoomId === 'current'
                      ? 'border-stone-950 bg-stone-950 text-white font-bold'
                      : 'border-stone-200 bg-white text-stone-800 hover:border-stone-500'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5 shrink-0" />
                    <span>Mevcut 3B Kamera Açısı</span>
                  </span>
                  <span className="text-[10px] font-mono opacity-75">Canlı</span>
                </button>

                {rooms.map((rm, idx) => (
                  <button
                    key={rm.id}
                    type="button"
                    disabled={Boolean(busyMsg)}
                    onClick={() => setTargetRoomId(rm.id)}
                    className={`px-3 py-2 border text-left flex items-center justify-between text-xs transition ${
                      targetRoomId === rm.id
                        ? 'border-stone-950 bg-stone-950 text-white font-bold'
                        : 'border-stone-200 bg-white text-stone-800 hover:border-stone-500'
                    }`}
                  >
                    <span className="truncate">
                      <span className="font-mono text-[10px] opacity-65 mr-1.5">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      {rm.name}
                    </span>
                    <span className="text-[10px] font-mono opacity-75 shrink-0">{rm.dims}</span>
                  </button>
                ))}
              </div>

              {targetRoomId !== 'current' && (
                <div className="pt-1.5 space-y-1">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                    Kamera Açısı
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={Boolean(busyMsg)}
                      onClick={() => setCameraAngle('eye')}
                      className={`py-1.5 px-2 border text-[11px] font-semibold transition ${
                        cameraAngle === 'eye'
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-300 bg-white text-stone-800 hover:border-stone-700'
                      }`}
                    >
                      İç Mekân Göz Hizası
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyMsg)}
                      onClick={() => setCameraAngle('corner')}
                      className={`py-1.5 px-2 border text-[11px] font-semibold transition ${
                        cameraAngle === 'corner'
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-300 bg-white text-stone-800 hover:border-stone-700'
                      }`}
                    >
                      3B Perspektif
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 02 · Lighting & Atmosphere Presets */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                02 · Işık &amp; Atmosfer Modu
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {RENDER_PRESETS.map((p) => {
                  const Icon = p.icon;
                  const active = presetId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={Boolean(busyMsg)}
                      onClick={() => setPresetId(p.id)}
                      className={`p-2.5 border text-left flex items-center gap-2 transition ${
                        active
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-white text-stone-800 hover:border-stone-500'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-[11px] font-semibold truncate">{p.short}</span>
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                value={customNote}
                disabled={Boolean(busyMsg)}
                onChange={(e) => setCustomNote(e.target.value)}
                placeholder="Ek stil notu (opsiyonel, örn: sıcak ceviz, keten perde)..."
                className="w-full px-2.5 py-2 bg-white border border-stone-300 text-xs text-stone-950 placeholder:text-stone-400 focus:outline-none focus:border-stone-950"
              />
            </div>

            {/* Primary Render Actions */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                disabled={Boolean(busyMsg)}
                onClick={() => void handleRunSingleRender()}
                className="w-full py-3 bg-stone-950 hover:bg-stone-800 disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition"
              >
                {busyMsg && !batchProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>
                  {busyMsg && !batchProgress ? 'Render Üretiliyor...' : 'Fotogerçekçi Render Al'}
                </span>
              </button>

              {rooms.length > 1 && (
                <button
                  type="button"
                  disabled={Boolean(busyMsg)}
                  onClick={() => void handleRunAllRoomsBatch()}
                  className="w-full py-2.5 border border-stone-950 bg-white hover:bg-stone-950 hover:text-white disabled:opacity-50 text-stone-950 text-xs font-bold flex items-center justify-center gap-2 transition"
                >
                  {batchProgress ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Layers className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {batchProgress
                      ? `Toplu Render (${batchProgress.cur}/${batchProgress.total})`
                      : `Tüm Odaları Renderla (${rooms.length} Oda)`}
                  </span>
                </button>
              )}

              {errorMsg && (
                <div className="p-2.5 border border-red-300 bg-red-50 text-[11px] text-red-900 leading-relaxed">
                  {errorMsg}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Interactive Before/After Slider + Render History Gallery */}
          <div className="lg:col-span-8 bg-[#121110] text-white flex flex-col min-h-[380px] lg:min-h-0">
            {/* Viewer Top Strip */}
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#0d0d0c] flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { id: 'split', label: 'Önce / Sonra', icon: Columns },
                    { id: 'render', label: 'Tam Render', icon: ImageIcon },
                    { id: '3d', label: 'Ham 3B', icon: Layers },
                    ...(activeItem?.referencePhotoUrl
                      ? [{ id: 'ref' as const, label: 'Pinterest', icon: Eye }]
                      : []),
                  ] as const
                ).map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setCompareMode(m.id)}
                      className={`px-2.5 py-1 text-[11px] font-semibold border inline-flex items-center gap-1.5 transition ${
                        compareMode === m.id
                          ? 'border-white bg-white text-stone-950'
                          : 'border-white/20 text-stone-300 hover:border-white/50 hover:text-white'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {activeItem && (
                <div className="flex items-center gap-2">
                  <span className="hidden sm:inline text-[10px] font-mono text-stone-400">
                    {activeItem.label} · {activeItem.presetLabel} · {activeItem.createdAt}
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadImage(activeItem.renderImageDataUrl, `${activeItem.label}-${activeItem.presetLabel}`)}
                    className="px-3 py-1 bg-white hover:bg-[#efe9df] text-stone-950 text-[11px] font-bold inline-flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>HD İndir</span>
                  </button>
                </div>
              )}
            </div>

            {/* Main Preview Stage */}
            <div className="flex-1 min-h-[280px] relative flex items-center justify-center p-3 sm:p-5 overflow-hidden">
              {busyMsg && (
                <div className="absolute inset-0 z-30 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-center px-6">
                  <Loader2 className="w-8 h-8 animate-spin text-[#e0c09a]" />
                  <p className="font-display text-sm sm:text-base font-bold text-white">{busyMsg}</p>
                  <p className="text-[11px] text-stone-400 max-w-md">
                    3B geometriniz, duvar panelleriniz, ışık açınız ve mobilya yerleşiminiz birebir korunarak V-Ray kaliteye yükseltiliyor (~5–10 sn).
                  </p>
                </div>
              )}

              {activeItem ? (
                compareMode === 'split' ? (
                  <div
                    ref={sliderRef}
                    onPointerDown={(e) => {
                      draggingRef.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      updateSliderFromClientX(e.clientX);
                    }}
                    onPointerMove={(e) => {
                      if (!draggingRef.current) return;
                      updateSliderFromClientX(e.clientX);
                    }}
                    onPointerUp={() => {
                      draggingRef.current = false;
                    }}
                    className="relative max-w-full max-h-full aspect-video w-full border border-white/15 overflow-hidden select-none cursor-ew-resize bg-black"
                  >
                    {/* Right/Full layer: Photoreal Render */}
                    <img
                      src={activeItem.renderImageDataUrl}
                      alt="Fotogerçekçi Render"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-contain bg-[#0e0d0c]"
                    />
                    {/* Left clipped layer: Original 3D Viewport */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                    >
                      <img
                        src={activeItem.snapshotDataUrl}
                        alt="3B Sahne"
                        draggable={false}
                        className="absolute inset-0 w-full h-full object-contain bg-[#0e0d0c]"
                      />
                    </div>
                    {/* Vertical Split Handle */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,0.85)] pointer-events-none"
                      style={{ left: `${splitPct}%` }}
                    >
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white text-stone-950 border border-stone-950 flex items-center justify-center text-[10px] font-mono font-bold shadow-lg">
                        ↔
                      </div>
                    </div>
                    <span className="absolute top-3 left-3 px-2.5 py-1 bg-black/75 border border-white/20 text-[10px] font-mono uppercase text-stone-200 pointer-events-none">
                      3B Sahne
                    </span>
                    <span className="absolute top-3 right-3 px-2.5 py-1 bg-white text-stone-950 text-[10px] font-mono font-bold uppercase pointer-events-none">
                      V-Ray Render · {activeItem.presetLabel}
                    </span>
                  </div>
                ) : (
                  <div className="relative max-w-full max-h-full aspect-video w-full border border-white/15 overflow-hidden bg-[#0e0d0c]">
                    <img
                      src={
                        compareMode === '3d'
                          ? activeItem.snapshotDataUrl
                          : compareMode === 'ref' && activeItem.referencePhotoUrl
                          ? activeItem.referencePhotoUrl
                          : activeItem.renderImageDataUrl
                      }
                      alt={activeItem.label}
                      className="w-full h-full object-contain"
                    />
                  </div>
                )
              ) : (
                <div className="text-center space-y-3 max-w-md px-4">
                  <div className="w-12 h-12 mx-auto border border-white/20 bg-white/5 flex items-center justify-center">
                    <Camera className="w-5 h-5 text-[#e0c09a]" />
                  </div>
                  <p className="font-display text-base font-bold text-white">
                    Odanızı Saniyeler İçinde Fotogerçekçi Sunuma Çevirin
                  </p>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    Soldan mevcut 3B açıyı veya dairedeki herhangi bir odayı seçin, ışık modunu belirleyin ve
                    <strong className="text-white"> Fotogerçekçi Render Al</strong> butonuna basın.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Render Gallery Strip */}
            <div className="px-4 py-3 border-t border-white/10 bg-[#0d0d0c] shrink-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">
                  Render Galerisi ({history.length})
                </span>
                {history.length > 0 && (
                  <span className="text-[10px] text-stone-500 flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>Önce / Sonra karşılaştırmak için görsel üstünde sürükleyin</span>
                  </span>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-[11px] text-stone-500">
                  Henüz render alınmadı. Ürettiğiniz her oda ve fotoğraf renderı burada birikir.
                </p>
              ) : (
                <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                  {history.map((item) => {
                    const selected = activeItem?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`relative shrink-0 w-36 border transition ${
                          selected ? 'border-white ring-1 ring-white' : 'border-white/20 hover:border-white/50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveRenderId(item.id)}
                          className="block w-full text-left bg-black"
                        >
                          <img
                            src={item.renderImageDataUrl}
                            alt={item.label}
                            className="w-full h-20 object-cover"
                          />
                          <div className="px-2 py-1 bg-[#161514]">
                            <p className="text-[10px] font-semibold text-white truncate">{item.label}</p>
                            <p className="text-[9px] font-mono text-stone-400 truncate">
                              {item.presetLabel} · {item.createdAt}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteRender(item.id)}
                          className="absolute top-1 right-1 p-1 bg-black/75 hover:bg-red-700 text-white/80 hover:text-white transition"
                          title="Renderı sil"
                          aria-label="Renderı sil"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
