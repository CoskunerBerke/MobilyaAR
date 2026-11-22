import React, { useEffect, useRef, useState } from 'react';
import '@google/model-viewer';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Camera,
  Check,
  Copy,
  Layers,
  Loader2,
  QrCode,
  Ruler,
  Smartphone,
  X,
} from 'lucide-react';
import type { Product } from '../lib/products';
import type { DemoStudioPresetId } from '../lib/demoRooms';
import { buildShareUrl } from '../lib/server';
import { fetchAndNormalizeRemoteGlb } from '../lib/product3dClient';
import { RoomPlanner3D } from './RoomPlanner3D';

interface Props {
  product: Product;
  products: Product[];
  startMode?: 'preview' | 'ar' | 'planner';
  initialStudioPreset?: DemoStudioPresetId;
  initialColorHex?: string;
  onAddCustomProduct?: (product: Product) => void;
  onOpenAiBuilder?: () => void;
  onBack: () => void;
}

type ModelViewerEl = HTMLElement & {
  canActivateAR?: boolean;
  activateAR?: () => void;
  getDimensions?: () => { x: number; y: number; z: number };
  model?: {
    materials?: Array<{
      name?: string;
      pbrMetallicRoughness?: { setBaseColorFactor: (c: string) => void };
    }>;
  };
};

export const ProductPage: React.FC<Props> = ({
  product,
  products,
  startMode = 'preview',
  initialStudioPreset,
  initialColorHex,
  onAddCustomProduct,
  onOpenAiBuilder,
  onBack,
}) => {
  const [viewMode, setViewMode] = useState<'ar-viewer' | 'planner'>(
    startMode === 'planner' ? 'planner' : 'ar-viewer'
  );
  const [activeProduct, setActiveProduct] = useState<Product>(product);
  const [plannerPreset, setPlannerPreset] = useState<DemoStudioPresetId>(initialStudioPreset || 'living');
  const [colorHex, setColorHex] = useState<string | undefined>(
    () => initialColorHex || product.swatches?.[0]?.hex
  );

  const [resolvedGlbUrl, setResolvedGlbUrl] = useState<string>(product.glbUrl);
  const [resolvedDims, setResolvedDims] = useState<string>(product.dimensionsCm);
  const [normalizingRemote, setNormalizingRemote] = useState(false);

  const [canAr, setCanAr] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [arStatus, setArStatus] = useState<string>('not-presenting');
  const [measuredDims, setMeasuredDims] = useState<{ w: number; d: number; h: number } | null>(null);
  const [showDimsBadge, setShowDimsBadge] = useState(true);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const mvRef = useRef<ModelViewerEl | null>(null);

  useEffect(() => {
    setActiveProduct(product);
    setColorHex(initialColorHex || product.swatches?.[0]?.hex);
  }, [product, initialColorHex]);

  // Uzaktan QR ile açılan AI .GLB dosyası varsa tarayıcıda gerçek 1:1 cm ölçüsüne ölçekle
  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    const needsRemoteNormalize =
      activeProduct.glbUrl.startsWith('http') && Boolean(activeProduct.dimsTargetCm);

    if (!needsRemoteNormalize) {
      setResolvedGlbUrl(activeProduct.glbUrl);
      setResolvedDims(activeProduct.dimensionsCm);
      setNormalizingRemote(false);
      return;
    }

    setNormalizingRemote(true);
    fetchAndNormalizeRemoteGlb(activeProduct.glbUrl, {
      widthCm: activeProduct.dimsTargetCm?.w,
      depthCm: activeProduct.dimsTargetCm?.d,
      heightCm: activeProduct.dimsTargetCm?.h,
    })
      .then((res) => {
        if (cancelled) {
          URL.revokeObjectURL(res.blobUrl);
          return;
        }
        revokedUrl = res.blobUrl;
        setResolvedGlbUrl(res.blobUrl);
        setResolvedDims(res.dimensionsCm);
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedGlbUrl(activeProduct.glbUrl);
          setResolvedDims(activeProduct.dimensionsCm);
        }
      })
      .finally(() => {
        if (!cancelled) setNormalizingRemote(false);
      });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [activeProduct]);

  // model-viewer yükleme, 1:1 boyut okuma, AR destek tespiti ve kumaş rengi senkronu
  useEffect(() => {
    const mv = mvRef.current;
    if (!mv) return;

    setModelLoaded(false);

    const syncModel = () => {
      setModelLoaded(true);
      setCanAr(Boolean(mv.canActivateAR));
      try {
        const d = mv.getDimensions?.();
        if (d && d.x > 0 && d.y > 0 && d.z > 0) {
          setMeasuredDims({
            w: Math.round(d.x * 100),
            d: Math.round(d.z * 100),
            h: Math.round(d.y * 100),
          });
        }
      } catch {
        /* ignore */
      }
      if (colorHex) {
        mv.model?.materials?.forEach((mat) => {
          if (mat.name?.startsWith('CAD_Fabric')) {
            mat.pbrMetallicRoughness?.setBaseColorFactor(colorHex);
          }
        });
      }
    };

    const onArStatus = (ev: Event) => {
      const detail = (ev as CustomEvent<{ status?: string }>).detail;
      if (detail?.status) setArStatus(detail.status);
    };

    mv.addEventListener('load', syncModel);
    mv.addEventListener('ar-status', onArStatus);
    if (mv.canActivateAR) setCanAr(true);

    return () => {
      mv.removeEventListener('load', syncModel);
      mv.removeEventListener('ar-status', onArStatus);
    };
  }, [resolvedGlbUrl, colorHex]);

  const arShareUrl = buildShareUrl({
    productId: activeProduct.id,
    glbUrl: activeProduct.glbUrl,
    remoteGlbUrl: activeProduct.remoteGlbUrl,
    productName: activeProduct.name,
    dimensionsCm: resolvedDims,
    dimsTargetCm: activeProduct.dimsTargetCm,
    mode: 'ar',
    colorHex,
  });

  const isMobileDevice =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const handleLaunchAR = () => {
    const mv = mvRef.current;
    if (mv && mv.canActivateAR && typeof mv.activateAR === 'function') {
      mv.activateAR();
      return;
    }
    setShowQrModal(true);
  };

  const copyArLink = () => {
    navigator.clipboard?.writeText(arShareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (viewMode === 'planner') {
    return (
      <RoomPlanner3D
        initialProduct={activeProduct}
        products={products}
        initialPreset={plannerPreset}
        onAddCustomProduct={onAddCustomProduct}
        onOpenAiBuilder={onOpenAiBuilder}
        onOpenProductAR={(prod) => {
          setActiveProduct(prod);
          setViewMode('ar-viewer');
        }}
        onBack={() => {
          if (startMode === 'planner') onBack();
          else setViewMode('ar-viewer');
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] z-40 bg-[#f5f4f0] text-stone-950 flex flex-col">
      {/* Üst Çubuk */}
      <header className="h-14 px-4 flex items-center justify-between gap-2 border-b border-stone-200 bg-white shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-stone-700 hover:text-stone-950 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kataloğa Dön</span>
        </button>

        <span className="text-[11px] font-mono text-stone-600 truncate">
          1:1 Canlı AR · {resolvedDims}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowDimsBadge((v) => !v)}
            className={`p-2 border transition ${
              showDimsBadge
                ? 'border-stone-950 bg-stone-950 text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:border-stone-500'
            }`}
            title="1:1 Ölçüleri Göster/Gizle"
            aria-label="Ölçüler"
          >
            <Ruler className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="p-2 border border-stone-200 hover:border-stone-950 bg-white text-stone-700 hover:text-stone-950 transition"
            title="Telefonda AR QR Kodu"
            aria-label="QR Kod"
          >
            <QrCode className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Canlı 3B & AR Sahnesi */}
      <div className="relative flex-1 min-h-0 bg-gradient-to-b from-[#f5f4f0] to-[#eae7e0]">
        {normalizingRemote && (
          <div className="absolute inset-0 z-20 bg-[#f5f4f0]/90 flex flex-col items-center justify-center gap-2.5 text-center p-4">
            <Loader2 className="w-7 h-7 animate-spin text-stone-950" />
            <p className="text-xs font-bold text-stone-950">
              1:1 gerçek santimetre ölçüsü ({activeProduct.dimensionsCm}) hazırlanıyor...
            </p>
          </div>
        )}

        <model-viewer
          ref={mvRef}
          src={resolvedGlbUrl}
          alt={activeProduct.name}
          ar
          ar-modes="webxr scene-viewer quick-look"
          ar-scale="fixed"
          ar-placement="floor"
          camera-controls
          touch-action="pan-y"
          shadow-intensity="1.2"
          shadow-softness="0.85"
          exposure="1.05"
          environment-image="neutral"
          camera-orbit="25deg 75deg auto"
          style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
        >
          {/* Varsayılan küçük model-viewer AR butonunu gizleyip kendi net kurumsal kontrolümüzü kullanıyoruz */}
          <button slot="ar-button" style={{ display: 'none' }} aria-hidden="true" />

          {/* Android WebXR canlı kamera içi yönlendirme şeridi */}
          {arStatus !== 'not-presenting' && (
            <div className="absolute top-4 inset-x-4 flex justify-center pointer-events-none">
              <div className="bg-stone-950/90 text-white px-4 py-2.5 text-xs font-medium shadow-xl max-w-sm text-center space-y-0.5">
                <p className="font-bold">
                  {activeProduct.name} · 1:1 ({resolvedDims})
                </p>
                <p className="text-[11px] text-stone-300">
                  {arStatus === 'object-placed'
                    ? 'Yerleştirildi — tek parmakla kaydırın, iki parmakla döndürün.'
                    : 'Telefonu zemine doğru yavaşça gezdirin; zemin algılandığında 1:1 yerleşir.'}
                </p>
              </div>
            </div>
          )}
        </model-viewer>

        {/* Gerçek 1:1 Santimetre Ölçü Kartı */}
        {showDimsBadge && (
          <div className="absolute top-3 left-3 bg-white/95 backdrop-blur border border-stone-200 px-3 py-2 text-[11px] space-y-0.5 shadow-sm pointer-events-none">
            <p className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
              1:1 Sabit AR Ölçeği
            </p>
            <p className="font-mono font-bold text-stone-950">
              {measuredDims
                ? `En ${measuredDims.w} · Der ${measuredDims.d} · Yük ${measuredDims.h} cm`
                : resolvedDims}
            </p>
          </div>
        )}

        {/* QR ile direkt AR bağlantısından açılan telefonlarda 1 dokunuş kamera daveti */}
        {startMode === 'ar' && isMobileDevice && modelLoaded && arStatus === 'not-presenting' && (
          <div className="absolute bottom-3 inset-x-4 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={handleLaunchAR}
              className="pointer-events-auto px-5 py-3 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold flex items-center gap-2 shadow-xl transition"
            >
              <Camera className="w-4 h-4" />
              <span>Kamerayı Aç ve Odanda 1:1 Yerleştir</span>
            </button>
          </div>
        )}
      </div>

      {/* Alt Ürün & Canlı AR Paneli */}
      <div className="shrink-0 bg-white border-t border-stone-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
        <div className="max-w-2xl w-full mx-auto space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                {activeProduct.source === 'ikea-cad'
                  ? `Resmi CAD · ${activeProduct.category}`
                  : activeProduct.source === 'studyo-cad'
                  ? `Stüdyo PBR · ${activeProduct.category}`
                  : `Özel 3B · ${activeProduct.category}`}
              </p>
              <h1 className="font-display text-base sm:text-lg font-bold text-stone-950 truncate">
                {activeProduct.name}
              </h1>
            </div>
            <p className="text-xs text-stone-600 font-mono shrink-0">{resolvedDims}</p>
          </div>

          {activeProduct.swatches && activeProduct.swatches.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {activeProduct.swatches.map((sw) => {
                const active = colorHex === sw.hex;
                return (
                  <button
                    key={sw.name}
                    type="button"
                    onClick={() => setColorHex(sw.hex)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border whitespace-nowrap shrink-0 transition ${
                      active
                        ? 'border-stone-950 bg-stone-950 text-white'
                        : 'border-stone-300 bg-[#faf9f6] text-stone-700 hover:border-stone-500'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: sw.hex }}
                    />
                    <span>{sw.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleLaunchAR}
              disabled={normalizingRemote}
              className="w-full py-3.5 bg-stone-950 hover:bg-stone-800 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {canAr ? <Camera className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
              <span>
                {canAr
                  ? 'Odanda Canlı Gör (1:1 AR)'
                  : isMobileDevice
                  ? 'Odanda Canlı Gör (AR)'
                  : 'Telefonda Canlı AR Aç (QR)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPlannerPreset('living');
                setViewMode('planner');
              }}
              className="w-full py-3.5 border border-stone-950 bg-white hover:bg-stone-100 text-stone-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition"
            >
              <Layers className="w-4 h-4" />
              <span>3B Oda Planlayıcıda Düzenle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Telefondan Canlı AR Aç (QR) Modalı */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-white border border-stone-200 p-6 max-w-sm w-full text-center space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-left min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  1:1 Canlı Kamera AR
                </p>
                <h3 className="font-display text-sm font-bold text-stone-950 truncate">
                  {activeProduct.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                aria-label="Kapat"
                className="text-stone-500 hover:text-stone-950 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeProduct.glbUrl.startsWith('blob:') && !activeProduct.remoteGlbUrl ? (
              <div className="p-4 bg-[#faf9f6] border border-stone-200 text-xs text-stone-700 leading-relaxed space-y-2 text-left">
                <p className="font-bold text-stone-950">Bu CAD dosyası şu an yerel tarayıcınızda</p>
                <p>
                  Telefonunuzda canlı AR açmak için bu dosyayı telefon tarayıcınızdan doğrudan
                  yükleyebilir veya Fotoğraftan AI 3B üretimini kullanabilirsiniz.
                </p>
              </div>
            ) : (
              <>
                <div className="inline-block p-3 border-2 border-stone-950 bg-white">
                  <QRCodeSVG value={arShareUrl} size={210} />
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {isMobileDevice
                    ? 'Canlı AR kamerası iPhone’da Safari (AR Quick Look), Android’de Chrome (WebXR / Scene Viewer) üzerinden açılır. Uygulama içi tarayıcıdaysanız bağlantıyı kopyalayıp Safari/Chrome’da açın.'
                    : 'iPhone veya Android kameranızla QR kodu okutun; bu ürün gerçek santimetre ölçüsüyle odanızın zemininde canlı açılsın.'}
                </p>
                <button
                  type="button"
                  onClick={copyArLink}
                  className="w-full py-2.5 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'AR Bağlantısı Kopyalandı' : 'AR Bağlantısını Kopyala'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
