import React, { useEffect, useState } from 'react';
import {
  Camera,
  Check,
  Download,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { normalizeRoomPhoto } from '../lib/roomRendering';
import { generateFurniture3DServerless, fetchProduct3DConfig } from '../lib/product3dClient';
import { getMembershipState } from '../lib/membership';
import {
  analyzePinterestRoom,
  cropBoxFromDataUrl,
  fetchPinterestConfig,
  generatePhotorealRender,
  getSavedGeminiKey,
  isolatePinterestObject,
  saveGeminiKey,
  type PinterestDetectedObject,
  type PinterestRoomStyle,
  type PinterestServerConfig,
} from './pinterestClient';
import { WALL_LABELS, type ArchPlacedObject, type ArchRoomProject, type WallId } from './types';

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
  studioPreviewUrl?: string;
  errorMsg?: string;
}

const BOX_COLORS = ['#0f172a', '#b45309', '#0369a1', '#15803d', '#7c2d12', '#4f46e5', '#be123c', '#334155'];

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
    visionModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
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
  const [batchRunning, setBatchRunning] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Photoreal V-Ray style render state
  const [renderStyleNote, setRenderStyleNote] = useState(
    'Doğal gün ışığı, sıcak mimari atmosfer, mat meşe ve keten dokular'
  );
  const [renderingPhoto, setRenderingPhoto] = useState(false);
  const [photorealResult, setPhotorealResult] = useState<string | null>(null);

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

  const handleUploadInspiration = async (file: File | null) => {
    if (!file) return;
    try {
      const norm = await normalizeRoomPhoto(file, 1400);
      setPhotoDataUrl(norm.dataUrl);
      setRoomStyle(null);
      setDetected([]);
      setJobs({});
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
    setStatusBanner('Gemini Vision oda stilini ve eşyaları tarıyor...');
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
        initJobs[o.id] = { selected: idx < 3, status: 'idle' };
      });
      setJobs(initJobs);
      setStatusBanner(
        `${res.detectedObjects.length} eşya ve oda renk/zemin stili tespit edildi (${res.model}).`
      );
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

  const buildPlacedFromDetected = (item: PinterestDetectedObject, glbUrl: string, thumbUrl: string): ArchPlacedObject => {
    const wM = Math.max(0.25, item.widthCm / 100);
    const dM = Math.max(0.05, item.depthCm / 100);
    const hM = Math.max(0.05, item.heightCm / 100);
    let x = Math.max(-project.widthM * 0.44, Math.min(project.widthM * 0.44, item.relativeX * (project.widthM * 0.45)));
    let z = Math.max(-project.depthM * 0.44, Math.min(project.depthM * 0.44, item.relativeZ * (project.depthM * 0.45)));
    let rot = (item.facingDeg * Math.PI) / 180;
    let y = item.mountMode === 'wall' ? Math.max(0, item.elevationCm / 100) : item.mountMode === 'ceiling' ? Math.max(1.5, project.ceilingM - hM) : 0;

    // Snap wall items (fireplace / TV wall / wall TV) flush to their assigned wall!
    if (item.mountMode === 'wall' && item.suggestedWall !== 'center') {
      const wId: WallId = item.suggestedWall;
      if (wId === 'north') {
        z = -project.depthM * 0.5 + dM * 0.5 + 0.01;
        rot = 0;
      } else if (wId === 'south') {
        z = project.depthM * 0.5 - dM * 0.5 - 0.01;
        rot = Math.PI;
      } else if (wId === 'west') {
        x = -project.widthM * 0.5 + dM * 0.5 + 0.01;
        rot = Math.PI / 2;
      } else if (wId === 'east') {
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
      x,
      y,
      z,
      rot,
      widthM: wM,
      depthM: dM,
      heightM: hM,
      mountMode: item.mountMode,
      attachedWall: item.suggestedWall !== 'center' ? item.suggestedWall : undefined,
      thumbUrl,
      source: 'pinterest-ai',
    };
  };

  const generateSingleItem3D = async (item: PinterestDetectedObject) => {
    if (!photoDataUrl) return;
    setJobs((prev) => ({
      ...prev,
      [item.id]: { ...(prev[item.id] || { selected: true }), status: 'isolating', errorMsg: undefined },
    }));

    try {
      // Step 1: Crop target bounding box and isolate onto clean white studio photo via Gemini Image
      const croppedUrl = await cropBoxFromDataUrl(photoDataUrl, item.box2d, 0.09);
      const iso = await isolatePinterestObject({
        fullRoomImageDataUrl: photoDataUrl,
        croppedImageDataUrl: croppedUrl,
        item,
        geminiKey,
      });

      setJobs((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] || { selected: true }),
          status: 'modeling',
          studioPreviewUrl: iso.studioImageDataUrl,
        },
      }));

      // Step 2: Reconstruct faithful 2K PBR 3D .GLB via RunPod Hunyuan3D-2.1 (uploads straight to Cloudflare R2!)
      const mem = getMembershipState();
      const gen = await generateFurniture3DServerless({
        engine: 'runpod',
        images: { front: iso.studioImageDataUrl },
        name: item.nameTr,
        widthCm: item.widthCm,
        depthCm: item.depthCm,
        heightCm: item.heightCm,
        runpodApiKey: mem.runpodApiKey || undefined,
        runpod3dEndpointId: mem.runpod3dEndpointId || undefined,
        runpodGpuTier: mem.runpodGpuTier || 'RTX4090',
        falApiKey: mem.falApiKey || undefined,
        onProgress: (msg: string) => setStatusBanner(`${item.nameTr}: ${msg}`),
      });

      const glbUrl = gen.remoteGlbUrl || gen.localBlobUrl;
      const placed = buildPlacedFromDetected(item, glbUrl, iso.studioImageDataUrl);
      onAddGeneratedObject(placed);

      setJobs((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] || { selected: true }),
          status: 'done',
          studioPreviewUrl: iso.studioImageDataUrl,
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
    setStatusBanner(`${targets.length} parça paralel olarak birebir 3B üretiliyor...`);
    try {
      // Run up to 3 in parallel (matches RunPod Max Workers: 3!)
      const concurrency = 3;
      let idx = 0;
      const runNext = async (): Promise<void> => {
        if (idx >= targets.length) return;
        const cur = targets[idx++];
        await generateSingleItem3D(cur);
        await runNext();
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => runNext()));
      setStatusBanner('Seçilen tüm Pinterest eşyalarının 3B üretimi tamamlandı.');
    } finally {
      setBatchRunning(false);
    }
  };

  const handleAddManualItem = () => {
    const newId = `manual-${Date.now()}`;
    const item: PinterestDetectedObject = {
      id: newId,
      nameTr: 'Özel Pinterest Parçası',
      category: 'Şömine',
      box2d: [200, 200, 800, 800],
      widthCm: 180,
      depthCm: 50,
      heightCm: 140,
      mountMode: 'wall',
      suggestedWall: 'north',
      elevationCm: 0,
      relativeX: 0,
      relativeZ: -0.7,
      facingDeg: 0,
      visualDescriptionEn: 'Exact architectural furniture or fireplace unit from center of the photo',
    };
    setDetected((prev) => [...prev, item]);
    setJobs((prev) => ({ ...prev, [newId]: { selected: true, status: 'idle' } }));
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
      onToast(err instanceof Error ? err.message : 'Render üretilemedi');
    } finally {
      setRenderingPhoto(false);
    }
  };

  const selectedCount = detected.filter((d) => jobs[d.id]?.selected && jobs[d.id]?.status !== 'done').length;

  return (
    <div className="space-y-4 text-xs">
      {/* Engine status & Gemini API Key config */}
      <div className="border border-stone-200 bg-[#faf9f6] p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-stone-950">Pinterest → Birebir 3B Motoru</p>
            <p className="text-[11px] text-stone-500">
              Gemini 2.5 Vision + Stüdyo İzolasyon + RunPod 2K PBR
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowKeyBox((v) => !v)}
            className="px-2 py-1 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap"
          >
            <KeyRound className="w-3 h-3" />
            <span>API</span>
          </button>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono">
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
                      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key=${encodeURIComponent(clean)}`
                    );
                    if (r.ok) {
                      setKeyTestResult('✓ Bağlantı doğrulandı (Gemini 2.5 Flash hazır)');
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
                className={`text-[10px] font-mono ${
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

      {/* Step 1: Upload Pinterest Photo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
            01 · Pinterest Oda Fotoğrafı
          </span>
          {photoDataUrl && (
            <button
              type="button"
              onClick={() => {
                setPhotoDataUrl(null);
                setDetected([]);
                setRoomStyle(null);
              }}
              className="text-[11px] text-stone-500 hover:text-stone-950 underline"
            >
              Değiştir
            </button>
          )}
        </div>

        {!photoDataUrl ? (
          <label className="block border border-dashed border-stone-400 hover:border-stone-950 bg-white p-5 text-center cursor-pointer transition">
            <Upload className="w-5 h-5 mx-auto text-stone-500 mb-1.5" />
            <p className="font-semibold text-stone-900">Pinterest Oda Görseli Yükle veya Ctrl+V Yapıştır</p>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Şömine, TV ünitesi, koltuk ve tüm dekorları otomatik ayırır
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
            {/* Annotated Inspiration Image with Live Bounding Boxes */}
            <div className="relative border border-stone-300 bg-stone-100 overflow-hidden">
              <img src={photoDataUrl} alt="Pinterest referans" className="w-full h-auto block" />
              {detected.map((item, i) => {
                const [ymin, xmin, ymax, xmax] = item.box2d;
                const isSel = jobs[item.id]?.selected;
                const col = BOX_COLORS[i % BOX_COLORS.length];
                return (
                  <button
                    key={item.id}
                    type="button"
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
                      width: `${Math.max(4, (xmax - xmin) / 10)}%`,
                      height: `${Math.max(4, (ymax - ymin) / 10)}%`,
                      borderColor: col,
                      backgroundColor: isSel ? `${col}22` : 'transparent',
                    }}
                    className="absolute border-2 transition text-left"
                    title={`${item.nameTr} (${item.widthCm}×${item.depthCm}×${item.heightCm} cm)`}
                  >
                    <span
                      style={{ backgroundColor: col }}
                      className="inline-block px-1 py-0.5 text-[9px] font-mono font-bold text-white leading-none"
                    >
                      {i + 1}. {item.nameTr.slice(0, 16)}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={analyzing}
              onClick={handleAnalyze}
              className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-2 transition"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>{analyzing ? 'Analiz Ediliyor...' : 'Odayı & Eşyaları Tespit Et'}</span>
            </button>
          </div>
        )}
      </div>

      {statusBanner && (
        <div className="border border-stone-300 bg-white px-3 py-2 text-[11px] text-stone-800">
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
            <span className="font-semibold text-stone-900">{roomStyle.styleNameTr}</span>
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

      {/* Step 3: Detected Objects -> Studio Isolate + RunPod 2K PBR 3D */}
      {detected.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · Birebir 3B Üretilecek Parçalar ({detected.length})
            </span>
            <button
              type="button"
              onClick={handleAddManualItem}
              className="text-[11px] font-semibold text-stone-700 hover:text-stone-950 flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Manuel Ekle
            </button>
          </div>

          <div className="space-y-2">
            {detected.map((item, idx) => {
              const st = jobs[item.id] || { selected: false, status: 'idle' };
              return (
                <div key={item.id} className="border border-stone-200 bg-white p-2.5 space-y-2">
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
                      className="mt-0.5 accent-stone-950"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-stone-950 truncate">
                          {idx + 1}. {item.nameTr}
                        </span>
                        <span className="text-[10px] font-mono text-stone-500 shrink-0">{item.category}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 mt-1.5">
                        <label className="text-[10px] text-stone-500">
                          En (cm)
                          <input
                            type="number"
                            value={Math.round(item.widthCm)}
                            onChange={(e) => updateDetectedItem(item.id, { widthCm: Number(e.target.value) || 100 })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                        <label className="text-[10px] text-stone-500">
                          Der. (cm)
                          <input
                            type="number"
                            value={Math.round(item.depthCm)}
                            onChange={(e) => updateDetectedItem(item.id, { depthCm: Number(e.target.value) || 60 })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                        <label className="text-[10px] text-stone-500">
                          Yük. (cm)
                          <input
                            type="number"
                            value={Math.round(item.heightCm)}
                            onChange={(e) => updateDetectedItem(item.id, { heightCm: Number(e.target.value) || 85 })}
                            className="w-full px-1.5 py-0.5 border border-stone-200 font-mono text-stone-900"
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5">
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
                      </div>
                    </div>
                  </div>

                  {st.studioPreviewUrl && (
                    <div className="flex items-center gap-2 pt-1 border-t border-stone-100">
                      <img
                        src={st.studioPreviewUrl}
                        alt="Stüdyo izolasyon"
                        className="w-12 h-12 object-contain border border-stone-200 bg-white shrink-0"
                      />
                      <span className="text-[10px] text-stone-600 leading-snug">
                        {st.status === 'modeling'
                          ? 'Temiz stüdyo çıkarıldı · RunPod 2K PBR 3B örüyor...'
                          : st.status === 'done'
                          ? 'Birebir 3B üretildi ve odaya yerleştirildi.'
                          : st.errorMsg || 'Stüdyo izole edildi.'}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-mono">
                      {st.status === 'isolating' && (
                        <span className="text-amber-700 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> İzole ediliyor...
                        </span>
                      )}
                      {st.status === 'modeling' && (
                        <span className="text-blue-700 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> 2K PBR 3B üretiliyor...
                        </span>
                      )}
                      {st.status === 'done' && (
                        <span className="text-emerald-700 font-semibold flex items-center gap-1">
                          <Check className="w-3 h-3" /> Odaya Eklendi
                        </span>
                      )}
                      {st.status === 'error' && (
                        <span className="text-red-700 truncate block max-w-[180px]" title={st.errorMsg}>
                          Hata: {st.errorMsg}
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      disabled={st.status === 'isolating' || st.status === 'modeling' || batchRunning}
                      onClick={() => generateSingleItem3D(item)}
                      className="px-2.5 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[10px] font-semibold disabled:opacity-50"
                    >
                      {st.status === 'done' ? 'Tekrar Üret' : 'Tekil 3B Üret'}
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
                ? 'Paralel 3B Üretim Sürüyor...'
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
