import React, { useState } from 'react';
import { Box, Check, Download, FileCode2, Layers, Loader2, Package, X } from 'lucide-react';
import {
  exportFull3dsMaxZipBundle,
  exportSceneToGlb,
  exportSceneToObjMtl,
  generate3dsMaxScript,
  sanitizeSlug,
  triggerBinaryDownload,
  type Export3dsMaxOptions,
  type Export3dsMaxStats,
  type Scene3dsMaxContext,
} from './export3dsMax';
import type { ArchRoomProject } from './types';

interface Props {
  open: boolean;
  project: ArchRoomProject;
  latestRenderDataUrl?: string | null;
  getExportContext: () => Scene3dsMaxContext | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export const Export3dsMaxModal: React.FC<Props> = ({
  open,
  project,
  latestRenderDataUrl,
  getExportContext,
  onClose,
  onToast,
}) => {
  const [includeCeiling, setIncludeCeiling] = useState(true);
  const [includeFurniture, setIncludeFurniture] = useState(true);
  const [objZUpCm, setObjZUpCm] = useState(true);
  const [busyMode, setBusyMode] = useState<'zip' | 'glb' | 'obj' | 'ms' | null>(null);
  const [lastResult, setLastResult] = useState<{
    filename: string;
    sizeKb: number;
    stats?: Export3dsMaxStats;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const opts: Export3dsMaxOptions = {
    includeCeiling,
    includeFurniture,
    objZUpCentimeters: objZUpCm,
  };

  const runExport = async (mode: 'zip' | 'glb' | 'obj' | 'ms') => {
    if (busyMode) return;
    const ctx = getExportContext();
    if (!ctx) {
      setErrorMsg('3B sahne henüz hazır değil. Önce 3B görünümün yüklendiğinden emin olun.');
      return;
    }
    setBusyMode(mode);
    setErrorMsg(null);
    try {
      const enc = new TextEncoder();
      if (mode === 'zip') {
        const res = await exportFull3dsMaxZipBundle(ctx, project, opts, latestRenderDataUrl);
        setLastResult({
          filename: res.filename,
          sizeKb: Math.max(1, Math.round(res.byteLength / 1024)),
          stats: res.stats,
        });
        onToast(`3ds Max tam paketi indirildi: ${res.filename}`);
      } else if (mode === 'glb') {
        const res = await exportSceneToGlb(ctx, project, opts);
        triggerBinaryDownload(res.bytes, res.filename, 'model/gltf-binary');
        setLastResult({
          filename: res.filename,
          sizeKb: Math.max(1, Math.round(res.bytes.byteLength / 1024)),
          stats: res.stats,
        });
        onToast(`3ds Max .GLB sahnesi indirildi: ${res.filename}`);
      } else if (mode === 'obj') {
        const res = exportSceneToObjMtl(ctx, project, opts);
        const objBytes = enc.encode(res.objText);
        const mtlBytes = enc.encode(res.mtlText);
        triggerBinaryDownload(objBytes, res.objFilename, 'text/plain;charset=utf-8');
        setTimeout(() => {
          triggerBinaryDownload(mtlBytes, res.mtlFilename, 'text/plain;charset=utf-8');
        }, 250);
        setLastResult({
          filename: `${res.objFilename} + .mtl`,
          sizeKb: Math.max(1, Math.round((objBytes.byteLength + mtlBytes.byteLength) / 1024)),
          stats: res.stats,
        });
        onToast(`Evrensel .OBJ + .MTL indirildi (${objZUpCm ? '3ds Max cm / Z-yukarı' : 'metre'})`);
      } else {
        const slug = sanitizeSlug(project.projectName);
        const ms = generate3dsMaxScript(ctx, project, slug);
        const msBytes = enc.encode(ms.scriptText);
        triggerBinaryDownload(msBytes, ms.filename, 'text/plain;charset=utf-8');
        setLastResult({
          filename: ms.filename,
          sizeKb: Math.max(1, Math.round(msBytes.byteLength / 1024)),
        });
        onToast(`3ds Max otomatik kurulum betiği (.ms) indirildi.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '3ds Max dışa aktarımı başarısız oldu.';
      setErrorMsg(msg);
      onToast(msg);
    } finally {
      setBusyMode(null);
    }
  };

  const roomCount = 1 + (project.adjacentRooms?.length || 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5"
      onClick={() => {
        if (!busyMode) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[90dvh] bg-white border border-stone-300 shadow-2xl flex flex-col overflow-hidden text-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 bg-[#0d0d0c] text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex items-center gap-3">
            <div className="w-8 h-8 border border-white/25 bg-white/10 flex items-center justify-center shrink-0">
              <Box className="w-4 h-4 text-[#e0c09a]" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#e0c09a]">
                MekanAR · Autodesk 3ds Max / V-Ray / Corona Aktarım
              </p>
              <h2 className="font-display text-sm sm:text-base font-extrabold truncate">
                3B Sahneyi 3ds Max&apos;e Aktar (1:1 Gerçek Ölçü)
              </h2>
            </div>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMode)}
            onClick={onClose}
            className="p-2 border border-white/20 hover:border-white text-white/80 hover:text-white disabled:opacity-40 transition shrink-0"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {/* Live Scene Summary */}
          <div className="grid grid-cols-3 gap-2 border border-stone-200 bg-[#faf9f6] p-3">
            <div>
              <p className="text-[10px] font-mono uppercase text-stone-500">Proje / Oda</p>
              <p className="font-bold text-stone-950 mt-0.5 truncate">{roomCount} Oda · {project.widthM.toFixed(1)}×{project.depthM.toFixed(1)} m</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-stone-500">3B Mobilya</p>
              <p className="font-bold text-stone-950 mt-0.5">{project.objects.length} Katmanlı Parça</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-stone-500">Ölçek &amp; Yapı</p>
              <p className="font-bold text-stone-950 mt-0.5">1:1 cm · 4 Duvar Tam</p>
            </div>
          </div>

          {/* Export Options */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              01 · Dışa Aktarım Ayarları
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="flex items-start gap-2 border border-stone-200 bg-white p-2.5 cursor-pointer hover:border-stone-500 transition">
                <input
                  type="checkbox"
                  checked={includeCeiling}
                  onChange={(e) => setIncludeCeiling(e.target.checked)}
                  className="mt-0.5 accent-stone-950"
                />
                <span className="leading-snug">
                  <strong className="block text-stone-950">Tavan &amp; LED Havuz</strong>
                  <span className="text-[10px] text-stone-500">V-Ray GI ışık sızmasını önler</span>
                </span>
              </label>
              <label className="flex items-start gap-2 border border-stone-200 bg-white p-2.5 cursor-pointer hover:border-stone-500 transition">
                <input
                  type="checkbox"
                  checked={includeFurniture}
                  onChange={(e) => setIncludeFurniture(e.target.checked)}
                  className="mt-0.5 accent-stone-950"
                />
                <span className="leading-snug">
                  <strong className="block text-stone-950">Tüm 3B Mobilyalar</strong>
                  <span className="text-[10px] text-stone-500">RunPod 2K PBR &amp; sahne eşyaları</span>
                </span>
              </label>
              <label className="flex items-start gap-2 border border-stone-200 bg-white p-2.5 cursor-pointer hover:border-stone-500 transition">
                <input
                  type="checkbox"
                  checked={objZUpCm}
                  onChange={(e) => setObjZUpCm(e.target.checked)}
                  className="mt-0.5 accent-stone-950"
                />
                <span className="leading-snug">
                  <strong className="block text-stone-950">3ds Max Z-Yukarı (cm)</strong>
                  <span className="text-[10px] text-stone-500">OBJ dönmeden 1:1 cm açılır</span>
                </span>
              </label>
            </div>
          </div>

          {/* Primary 1-Click Complete Architect Bundle */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              02 · Tek Tıkla İndir (Önerilen Mimar Paketi)
            </p>
            <button
              type="button"
              disabled={Boolean(busyMode)}
              onClick={() => void runExport('zip')}
              className="w-full p-3.5 bg-stone-950 hover:bg-stone-800 disabled:opacity-50 text-white flex items-center justify-between gap-3 text-left transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                {busyMode === 'zip' ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#e0c09a] shrink-0" />
                ) : (
                  <Package className="w-5 h-5 text-[#e0c09a] shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold">
                    {busyMode === 'zip'
                      ? '3ds Max Sahne Paketi Hazırlanıyor...'
                      : 'Tam 3ds Max Mimar Paketi İndir (.ZIP)'}
                  </p>
                  <p className="text-[11px] text-stone-300 mt-0.5">
                    İçerik: .GLB (Max 2023+ PBR) + .OBJ/.MTL (Tüm Sürümler) + Otomatik Kamera/Güneş MaxScript (.ms)
                    {latestRenderDataUrl ? ' + V-Ray Render PNG' : ''}
                  </p>
                </div>
              </div>
              <Download className="w-4 h-4 shrink-0" />
            </button>
          </div>

          {/* Individual Direct Formats */}
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              03 · Tekil Format Seçenekleri
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                disabled={Boolean(busyMode)}
                onClick={() => void runExport('glb')}
                className="p-3 border border-stone-300 hover:border-stone-950 bg-white text-left space-y-1 disabled:opacity-50 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-stone-500">01 · MAX 2023+</span>
                  {busyMode === 'glb' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5 text-stone-700" />}
                </div>
                <p className="font-bold text-stone-950">.GLB (glTF 2.0 PBR)</p>
                <p className="text-[10px] text-stone-500 leading-snug">
                  Gömülü PBR dokular + tüm katmanlar. 3ds Max File → Import ile açılır.
                </p>
              </button>

              <button
                type="button"
                disabled={Boolean(busyMode)}
                onClick={() => void runExport('obj')}
                className="p-3 border border-stone-300 hover:border-stone-950 bg-white text-left space-y-1 disabled:opacity-50 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-stone-500">02 · MAX 2018–2026</span>
                  {busyMode === 'obj' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Box className="w-3.5 h-3.5 text-stone-700" />}
                </div>
                <p className="font-bold text-stone-950">.OBJ + .MTL</p>
                <p className="text-[10px] text-stone-500 leading-snug">
                  Eski 3ds Max, SketchUp, Rhino ve Blender dahil her programda 1:1 cm açılır.
                </p>
              </button>

              <button
                type="button"
                disabled={Boolean(busyMode)}
                onClick={() => void runExport('ms')}
                className="p-3 border border-stone-300 hover:border-stone-950 bg-white text-left space-y-1 disabled:opacity-50 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-stone-500">03 · OTOMASYON</span>
                  {busyMode === 'ms' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCode2 className="w-3.5 h-3.5 text-stone-700" />}
                </div>
                <p className="font-bold text-stone-950">MaxScript (.MS)</p>
                <p className="text-[10px] text-stone-500 leading-snug">
                  3ds Max&apos;e sürükleyip bırakın: 1:1 cm birim, kamera açısı ve güneş otomatik kurulur.
                </p>
              </button>
            </div>
          </div>

          {lastResult && (
            <div className="border border-emerald-300 bg-emerald-50/70 p-3 flex items-start gap-2.5 text-emerald-950">
              <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <p className="font-bold text-xs truncate">Hazırlandı &amp; İndirildi: {lastResult.filename}</p>
                <p className="text-[11px] text-emerald-900">
                  Boyut: <strong>{lastResult.sizeKb >= 1024 ? `${(lastResult.sizeKb / 1024).toFixed(2)} MB` : `${lastResult.sizeKb} KB`}</strong>
                  {lastResult.stats
                    ? ` · ${lastResult.stats.meshCount} 3B parça · ${lastResult.stats.triangleCount.toLocaleString('tr-TR')} üçgen`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="border border-red-300 bg-red-50 p-3 text-red-900 text-xs">{errorMsg}</div>
          )}

          {/* Crisp technical note for architects */}
          <div className="border-t border-stone-200 pt-3 text-[11px] text-stone-600 leading-relaxed">
            <strong className="text-stone-900">Mimar Notu:</strong> 3B sahnenizin tüm 4 duvarı (ön kesit duvarı dahil),
            pencere/kapı boşlukları, tavan/LED havuzu ve mobilyaları gerçek santimetre ölçüsünde dışa aktarılır.
            3ds Max&apos;te tek tıkla açtıktan sonra V-Ray veya Corona materyali atayabilirsiniz.
          </div>
        </div>
      </div>
    </div>
  );
};
