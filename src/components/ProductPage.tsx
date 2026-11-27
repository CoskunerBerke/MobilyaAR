import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@google/model-viewer';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Minus,
  Plus,
  QrCode,
  RotateCcw,
  RotateCw,
  Ruler,
  Smartphone,
  Sun,
  SwitchCamera,
  Unlock,
  X,
} from 'lucide-react';
import { resolveStaticUsdzUrl, type Product } from '../lib/products';
import type { DemoStudioPresetId } from '../lib/demoRooms';
import { buildShareUrl } from '../lib/server';
import { fetchAndNormalizeRemoteGlb } from '../lib/product3dClient';
import {
  buildQuickLookUrl,
  detectArEnvironment,
  exportGlbUrlToUsdzBlobUrl,
  launchAndroidSceneViewer,
  launchIosQuickLook,
} from '../lib/arLauncher';
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
  scale?: string;
  updateFraming?: () => Promise<void>;
  getDimensions?: () => { x: number; y: number; z: number };
  model?: {
    materials?: Array<{
      name?: string;
      pbrMetallicRoughness?: { setBaseColorFactor: (c: string) => void };
    }>;
  };
};

interface InternalARRenderer {
  isPresenting?: boolean;
  goalPosition?: { x: number; y: number; z: number };
  goalScale?: number;
  goalYaw?: number;
  presentedScene?: {
    scenePivot?: { position: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } };
    setShadowIntensity?: (v: number) => void;
    queueRender?: () => void;
  };
}

function parseDimsFromText(text: string): { w: number; d: number; h: number } | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*[×xX]\s*(\d+(?:[.,]\d+)?)\s*[×xX]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const w = Math.round(parseFloat(m[1].replace(',', '.')));
  const d = Math.round(parseFloat(m[2].replace(',', '.')));
  const h = Math.round(parseFloat(m[3].replace(',', '.')));
  if (!Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h)) return null;
  return { w, d, h };
}

function getInternalArRenderer(mv: ModelViewerEl | null): InternalARRenderer | null {
  if (!mv) return null;
  try {
    const syms = Object.getOwnPropertySymbols(mv);
    const rSym = syms.find((s) => s.description === 'renderer');
    if (!rSym) return null;
    const renderer = (mv as unknown as Record<symbol, { arRenderer?: InternalARRenderer }>)[rSym];
    return renderer?.arRenderer || null;
  } catch {
    return null;
  }
}

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
  const [measuredDims, setMeasuredDims] = useState<{ w: number; d: number; h: number } | null>(() =>
    parseDimsFromText(product.dimensionsCm)
  );
  const [showDimsBadge, setShowDimsBadge] = useState(true);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Orantılı ölçek (%70–%140, her eksen eşit!) + 1:1 Gerçek Ölçü Kilidi (iPad/iPhone Quick Look & Android Scene Viewer!)
  const [scalePct, setScalePct] = useState<number>(100);
  const [arScaleLocked, setArScaleLocked] = useState<boolean>(true);
  const [yOffsetCm, setYOffsetCm] = useState<number>(0);
  const [hideArControls, setHideArControls] = useState(false);
  const [isLandscape, setIsLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : false
  );

  // Native Apple ARKit Quick Look (.usdz) pre-baked or dynamic Blob URL (ready synchronously on tap!)
  const arEnv = detectArEnvironment();
  const staticUsdzUrl = resolveStaticUsdzUrl(activeProduct);
  const [dynamicUsdzUrl, setDynamicUsdzUrl] = useState<string | null>(null);
  const [preparingUsdz, setPreparingUsdz] = useState<boolean>(false);
  const [showInAppBanner, setShowInAppBanner] = useState<boolean>(() => detectArEnvironment().isInAppBrowser);

  // Fallback Live Camera AR Overlay (ONLY used when a device genuinely lacks ARKit & ARCore!)
  const [liveCameraAr, setLiveCameraAr] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveCamYOffsetPx, setLiveCamYOffsetPx] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const mvRef = useRef<ModelViewerEl | null>(null);
  const arBaseYRef = useRef<number | null>(null);
  const lastAppliedYCmRef = useRef<number>(0);

  const stopLiveCamera = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setLiveCameraAr(false);
    setCameraError(null);
    setLiveCamYOffsetPx(0);
  }, []);

  const startLiveCamera = useCallback(
    async (facing: 'environment' | 'user' = cameraFacing) => {
      setCameraError(null);
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Tarayıcı kamera API’sine erişemedi. Lütfen siteyi HTTPS üzerinden Safari (iPad) veya Chrome (Android Tablet) ile açın.'
        );
        setShowQrModal(true);
        return;
      }
      try {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
          mediaStreamRef.current = null;
        }
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          });
        } catch {
          // Fallback to any available tablet camera if exact facingMode constraint fails
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        mediaStreamRef.current = stream;
        setCameraFacing(facing);
        setLiveCameraAr(true);
        setShowQrModal(false);
        setTimeout(() => {
          const vid = videoRef.current;
          if (vid && mediaStreamRef.current) {
            vid.srcObject = mediaStreamRef.current;
            vid.play().catch(() => {});
          }
        }, 60);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/NotAllowed|Permission/i.test(msg)) {
          setCameraError(
            'Kamera izni reddedildi. Tablet tarayıcısında adres çubuğundaki kilit/kamera simgesinden bu siteye Kamera İzni verip tekrar deneyin.'
          );
        } else if (/NotFound|DevicesNotFound/i.test(msg)) {
          setCameraError('Bu cihazda kullanılabilir kamera bulunamadı — QR kod ile telefondan açabilirsiniz.');
          setShowQrModal(true);
        } else {
          setCameraError('Kamera başlatılamadı — başka bir uygulama kamerayı kullanıyorsa kapatıp tekrar deneyin.');
        }
      }
    },
    [cameraFacing]
  );

  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setActiveProduct(product);
    setColorHex(initialColorHex || product.swatches?.[0]?.hex);
    setMeasuredDims(parseDimsFromText(product.dimensionsCm));
    setScalePct(100);
    setYOffsetCm(0);
    arBaseYRef.current = null;
    lastAppliedYCmRef.current = 0;
  }, [product, initialColorHex]);

  // Telefonun anlık dikey/yatay konumunu izle
  useEffect(() => {
    const updateOrient = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    updateOrient();
    window.addEventListener('resize', updateOrient);
    window.addEventListener('orientationchange', updateOrient);
    return () => {
      window.removeEventListener('resize', updateOrient);
      window.removeEventListener('orientationchange', updateOrient);
    };
  }, []);

  // Uzaktan ham (normalize edilmemiş) AI .GLB dosyası varsa 1:1 cm ölçüsüne ölçekle;
  // Kalıcı bulutta (R2 / Blob) kayıtlı ürün zaten 1:1 üretildiği için doğrudan CDN'den 0 TL GPU ile açılır!
  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    const needsRemoteNormalize =
      !activeProduct.cloudStored &&
      activeProduct.glbUrl.startsWith('http') &&
      Boolean(activeProduct.dimsTargetCm);

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
        setMeasuredDims(parseDimsFromText(res.dimensionsCm));
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
          const factor = scalePct / 100 || 1;
          setMeasuredDims({
            w: Math.round((d.x / factor) * 100),
            d: Math.round((d.z / factor) * 100),
            h: Math.round((d.y / factor) * 100),
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
      if (detail?.status) {
        setArStatus(detail.status);
        if (detail.status === 'not-presenting') {
          setYOffsetCm(0);
          arBaseYRef.current = null;
          lastAppliedYCmRef.current = 0;
          setHideArControls(false);
        } else if (detail.status === 'object-placed') {
          // İlk yerleştirmede gölgeyi keskinleştir ve referans Y yüksekliğini kaydet
          const arR = getInternalArRenderer(mv);
          if (arR?.goalPosition) {
            arBaseYRef.current = arR.goalPosition.y;
            lastAppliedYCmRef.current = 0;
            setYOffsetCm(0);
          }
          arR?.presentedScene?.setShadowIntensity?.(1.15);
        }
      }
    };

    const syncPinchScale = () => {
      const arR = getInternalArRenderer(mv);
      if (arR?.isPresenting && typeof arR.goalScale === 'number' && Number.isFinite(arR.goalScale)) {
        const clamped = Math.max(50, Math.min(200, Math.round(arR.goalScale * 100)));
        setScalePct(clamped);
      }
    };

    const onModelError = () => {
      // Eğer R2 public URL'de CORS henüz açılmadıysa aynı dosyanın güvenli API yedeğinden yükle
      if (
        activeProduct.cloudStored &&
        resolvedGlbUrl.startsWith('http') &&
        !resolvedGlbUrl.includes('/api/storage?')
      ) {
        setResolvedGlbUrl(
          `/api/storage?action=file&key=${encodeURIComponent(`models/${activeProduct.id}.glb`)}`
        );
      }
    };

    mv.addEventListener('load', syncModel);
    mv.addEventListener('ar-status', onArStatus);
    mv.addEventListener('error', onModelError);
    mv.addEventListener('touchend', syncPinchScale, { passive: true });
    if (mv.canActivateAR) setCanAr(true);

    return () => {
      mv.removeEventListener('load', syncModel);
      mv.removeEventListener('ar-status', onArStatus);
      mv.removeEventListener('error', onModelError);
      mv.removeEventListener('touchend', syncPinchScale);
    };
  }, [resolvedGlbUrl, colorHex, activeProduct.cloudStored, activeProduct.id]);

  // Orantılı ölçek uygula (x = y = z her zaman eşit -> asla uzama/bozulma yok!)
  const applyProportionalScale = useCallback((nextPct: number) => {
    const clamped = Math.max(55, Math.min(160, Math.round(nextPct)));
    setScalePct(clamped);
    const s = clamped / 100;
    const mv = mvRef.current;
    if (!mv) return;
    const arR = getInternalArRenderer(mv);
    if (arR?.isPresenting) {
      arR.goalScale = s;
      arR.presentedScene?.queueRender?.();
    } else {
      mv.scale = `${s.toFixed(3)} ${s.toFixed(3)} ${s.toFixed(3)}`;
      mv.updateFraming?.();
    }
  }, []);

  // Canlı AR içinde ayakları aşağı/yukarı oynat (zemine milimetrik bastırma!)
  const adjustArFloorHeight = useCallback((deltaCm: number | 'reset') => {
    const mv = mvRef.current;
    const arR = getInternalArRenderer(mv);
    if (!arR || !arR.goalPosition) return;

    if (arBaseYRef.current === null) {
      arBaseYRef.current = arR.goalPosition.y;
    }

    const nextCm =
      deltaCm === 'reset'
        ? 0
        : Math.max(-35, Math.min(35, lastAppliedYCmRef.current + deltaCm));

    const diffM = (nextCm - lastAppliedYCmRef.current) / 100;
    arR.goalPosition.y += diffM;
    lastAppliedYCmRef.current = nextCm;
    setYOffsetCm(nextCm);
    arR.presentedScene?.setShadowIntensity?.(1.15);
    arR.presentedScene?.queueRender?.();
  }, []);

  const rotateInAr = useCallback((deg: number) => {
    const arR = getInternalArRenderer(mvRef.current);
    if (!arR || typeof arR.goalYaw !== 'number') return;
    arR.goalYaw += (deg * Math.PI) / 180;
    arR.presentedScene?.queueRender?.();
  }, []);

  const arShareUrl = buildShareUrl({
    productId: activeProduct.id,
    glbUrl: activeProduct.glbUrl,
    remoteGlbUrl: activeProduct.remoteGlbUrl,
    cloudStored: activeProduct.cloudStored,
    productName: activeProduct.name,
    dimensionsCm: resolvedDims,
    dimsTargetCm: activeProduct.dimsTargetCm,
    mode: 'ar',
    colorHex,
  });

  // iPhone / iPad için dinamik USDZ ön-hazırlığı:
  // Katalogdaki 18 ürün zaten hazır .usdz dosyasını 0ms'de kullanır; özel AI/CAD .GLB veya özel % ölçekte ise
  // tap anında senkron Quick Look açılabilmesi için arka planda gerçek 1:1 Y=0 .usdz hazırlanır!
  useEffect(() => {
    const needsDynamicUsdz =
      arEnv.isIOS &&
      Boolean(resolvedGlbUrl) &&
      (!staticUsdzUrl || scalePct !== 100);

    if (!needsDynamicUsdz) {
      setDynamicUsdzUrl((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
      setPreparingUsdz(false);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setPreparingUsdz(true);
    exportGlbUrlToUsdzBlobUrl(resolvedGlbUrl, {
      scaleFactor: scalePct / 100,
      tintHex: colorHex,
      maxTextureSize: 1024,
    })
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        createdUrl = blobUrl;
        setDynamicUsdzUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return blobUrl;
        });
      })
      .catch(() => {
        if (!cancelled) setDynamicUsdzUrl(null);
      })
      .finally(() => {
        if (!cancelled) setPreparingUsdz(false);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [arEnv.isIOS, resolvedGlbUrl, staticUsdzUrl, scalePct, colorHex]);

  const effectiveUsdzUrl = dynamicUsdzUrl || staticUsdzUrl || undefined;
  const resolvedIosSrc = effectiveUsdzUrl
    ? buildQuickLookUrl(effectiveUsdzUrl, !arScaleLocked)
    : undefined;

  const isTabletDevice = arEnv.isTablet;
  const isMobileDevice = arEnv.isMobile;
  const nativeArAvailable = Boolean(
    canAr || (arEnv.isIOS && arEnv.supportsQuickLook && Boolean(effectiveUsdzUrl)) || (arEnv.isAndroid && !arEnv.isInAppBrowser)
  );

  // Ürünün gerçek boyutuna göre akıllı AR kadraj & mesafe rehberi
  // Not: Tabletlerde yatay (showroom) kullanım serbesttir; dikey uyarısı sadece telefonlar içindir!
  const baseDims = measuredDims || parseDimsFromText(resolvedDims) || { w: 120, d: 85, h: 80 };
  const isWideProduct = baseDims.w >= 150;
  const recommendedDistanceLabel = isWideProduct ? '2.5–3 m Geriden' : '1.5–2 m Mesafe';
  const orientationMatches = isTabletDevice || !isLandscape;

  const liveScaledDims = {
    w: Math.round((baseDims.w * scalePct) / 100),
    d: Math.round((baseDims.d * scalePct) / 100),
    h: Math.round((baseDims.h * scalePct) / 100),
  };

  const handleLaunchAR = () => {
    if (liveCameraAr) {
      stopLiveCamera();
      return;
    }

    // 0) WhatsApp / Instagram / TikTok uygulama içi tarayıcılarda ARKit & ARCore engellenir -> Safari/Chrome uyarısı göster!
    if (arEnv.isInAppBrowser) {
      setShowInAppBanner(true);
      setCameraError(
        `${arEnv.inAppBrowserName || 'Uygulama içi tarayıcı'} gerçek zemin algılamalı AR'ı engelliyor. Sağ üstteki menüden "${
          arEnv.isIOS ? "Safari'de Aç" : "Chrome'da Aç"
        }" seçin veya linki kopyalayıp ${arEnv.isIOS ? 'Safari' : 'Chrome'}'a yapıştırın.`
      );
      return;
    }

    // 1) iPhone & iPad (LiDAR / ARKit Quick Look) — Doğrudan yerel Apple ARKit zemin kilidi!
    // (iPadOS Safari kendini masaüstü gibi tanıttığı için <model-viewer> canActivateAR'a takılmadan direkt açılır!)
    if (arEnv.isIOS) {
      if (effectiveUsdzUrl) {
        launchIosQuickLook(effectiveUsdzUrl, {
          allowScaling: !arScaleLocked,
          posterUrl: activeProduct.thumbUrl,
        });
        return;
      }
      // Dinamik USDZ henüz hazırlanıyorsa bekle veya model-viewer'a düş
      if (preparingUsdz) {
        setCameraError('iPad / iPhone ARKit (USDZ) dosyası hazırlanıyor, birkaç saniye sonra tekrar dokunun.');
        return;
      }
    }

    // 2) Android (Google ARCore Scene Viewer öncelikli!) — Gerçek zemin gridi & gölge kilidi!
    const mv = mvRef.current;
    if (mv && mv.canActivateAR && typeof mv.activateAR === 'function') {
      mv.activateAR();
      return;
    }
    if (arEnv.isAndroid && resolvedGlbUrl && !resolvedGlbUrl.startsWith('blob:')) {
      launchAndroidSceneViewer(resolvedGlbUrl, activeProduct.name, { allowScaling: !arScaleLocked });
      return;
    }

    // 3) Son çare: ARKit/ARCore desteklemeyen eski cihazlarda basit kamera katmanı, masaüstünde QR
    if (isMobileDevice || isTabletDevice) {
      void startLiveCamera('environment');
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
    <div className="fixed inset-0 h-[100dvh] z-40 bg-[#f5f2ec] text-stone-950 flex flex-col">
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
          {scalePct === 100 ? '1:1 Gerçek Ölçü' : `Orantılı %${scalePct}`} · {liveScaledDims.w}×{liveScaledDims.d}×{liveScaledDims.h} cm
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
            title="Ölçü ve Çekim Rehberini Göster/Gizle"
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

      {/* Canlı 3B & AR Sahnesi (Tablet & Tüm Cihazlar İçin Canlı Arka Kamera AR Katmanı Destekli!) */}
      <div
        className={`relative flex-1 min-h-0 overflow-hidden ${
          liveCameraAr ? 'bg-black' : 'bg-gradient-to-b from-[#f5f2ec] to-[#e9e3d8]'
        }`}
      >
        {liveCameraAr && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
          />
        )}

        {cameraError && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-[92%] bg-amber-50 border border-amber-400 text-amber-950 px-3.5 py-2.5 text-xs shadow-lg flex items-start justify-between gap-2">
            <span>{cameraError}</span>
            <button type="button" onClick={() => setCameraError(null)} className="shrink-0 text-amber-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {normalizingRemote && (
          <div className="absolute inset-0 z-20 bg-[#f5f2ec]/90 flex flex-col items-center justify-center gap-2.5 text-center p-4">
            <Loader2 className="w-7 h-7 animate-spin text-stone-950" />
            <p className="text-xs font-bold text-stone-950">
              1:1 gerçek santimetre ölçüsü ({activeProduct.dimensionsCm}) hazırlanıyor...
            </p>
          </div>
        )}

        {showInAppBanner && arEnv.isInAppBrowser && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 max-w-md w-[94%] bg-stone-950 text-white border border-stone-700 px-3.5 py-2.5 text-[11px] shadow-xl space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="leading-snug">
                <strong>{arEnv.inAppBrowserName} içi tarayıcı</strong> gerçek zemin algılamayı engelliyor. Gerçek 1:1
                AR için bağlantıyı <strong>{arEnv.isIOS ? 'Safari' : 'Chrome'}</strong> ile açın.
              </p>
              <button type="button" onClick={() => setShowInAppBanner(false)} className="shrink-0 text-stone-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyArLink}
                className="flex-1 py-1.5 bg-white text-stone-950 font-bold text-[11px] flex items-center justify-center gap-1"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Link Kopyalandı' : `${arEnv.isIOS ? 'Safari' : 'Chrome'} için Linki Kopyala`}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInAppBanner(false);
                  void startLiveCamera('environment');
                }}
                className="px-2.5 py-1.5 border border-stone-600 text-stone-200 text-[10px] font-semibold"
              >
                Basit Kamera
              </button>
            </div>
          </div>
        )}

        <model-viewer
          ref={mvRef}
          src={resolvedGlbUrl}
          ios-src={resolvedIosSrc}
          alt={activeProduct.name}
          ar
          ar-modes="scene-viewer quick-look webxr"
          quick-look-browsers="safari chrome"
          ar-scale={arScaleLocked ? 'fixed' : 'auto'}
          ar-placement="floor"
          xr-environment
          camera-controls
          touch-action="pan-y"
          shadow-intensity="1.45"
          shadow-softness="0.65"
          exposure="1.05"
          environment-image="neutral"
          camera-orbit="25deg 75deg auto"
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'transparent',
            position: 'relative',
            zIndex: 10,
            transform: liveCameraAr ? `translateY(${liveCamYOffsetPx}px)` : undefined,
          }}
        >
          {/* Varsayılan küçük model-viewer AR butonunu gizleyip kendi kurumsal kontrolümüzü kullanıyoruz */}
          <button slot="ar-button" style={{ display: 'none' }} aria-hidden="true" />

          {/* CANLI WEBXR AR KAMERA İÇİ KONTROL PANELİ (Zemin Y-Ayarı + Orantılı Ölçek + Yön Uyarı) */}
          {arStatus !== 'not-presenting' && (
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 sm:p-4">
              {/* Üst: Yön & Zemin Algılama Rehberi */}
              <div className="flex flex-col items-center gap-2 pt-8">
                <div className="bg-stone-950/88 backdrop-blur-md text-white px-4 py-2.5 border border-white/15 max-w-md w-full text-center space-y-1 shadow-xl">
                  <div className="flex items-center justify-center gap-2 text-xs font-bold">
                    <span>{activeProduct.name}</span>
                    <span className="font-mono text-[#d6b896]">
                      %{scalePct} ({liveScaledDims.w}×{liveScaledDims.d}×{liveScaledDims.h} cm)
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-200 leading-snug">
                    {arStatus !== 'object-placed'
                      ? 'Işığı açın ve telefonu zemine doğru 3 sn yavaşça gezdirin — yüzey bulununca eşya yere oturur.'
                      : 'Ayakları tam yere bastırmak için alttaki Aşağı/Yukarı (cm) tuşlarını, boyut için orantılı % ölçeği kullanın.'}
                  </p>
                </div>

                {/* Telefon Yan Çevrildiyse Dikey Tutuş Uyarısı */}
                {!orientationMatches && (
                  <div className="bg-amber-950/92 border border-amber-400/70 text-amber-100 px-3.5 py-2 text-[11px] font-semibold flex items-center gap-2 shadow-lg">
                    <Smartphone className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>
                      AR kamerası dikey çalışır — Telefonu DİKEY tutun ve {recommendedDistanceLabel.toLowerCase()} bakın
                    </span>
                  </div>
                )}
              </div>

              {/* Alt: Canlı Ayak/Zemin Yüksekliği (Y), Orantılı Ölçek (%) ve Döndürme Çubuğu */}
              <div className="flex flex-col items-center gap-2 pb-2">
                {hideArControls ? (
                  <button
                    type="button"
                    onClick={() => setHideArControls(false)}
                    className="pointer-events-auto px-4 py-2 bg-stone-950/85 text-white border border-white/25 text-xs font-semibold flex items-center gap-1.5 shadow-lg"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Ayak &amp; Ölçek Kontrollerini Göster</span>
                  </button>
                ) : (
                  <div
                    onTouchStart={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="pointer-events-auto bg-stone-950/90 backdrop-blur-md text-white border border-white/15 p-3 w-full max-w-md space-y-2.5 shadow-2xl"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-stone-300">
                      <span>Ayak / Zemin Yüksekliği (Y: {yOffsetCm > 0 ? `+${yOffsetCm}` : yOffsetCm} cm)</span>
                      <button
                        type="button"
                        onClick={() => setHideArControls(true)}
                        className="flex items-center gap-1 text-stone-400 hover:text-white"
                      >
                        <EyeOff className="w-3 h-3" />
                        <span>Gizle</span>
                      </button>
                    </div>

                    {/* Ayakları Yere Bastır: Aşağı / Yukarı cm Kontrolleri */}
                    <div className="grid grid-cols-5 gap-1.5 text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => adjustArFloorHeight(-4)}
                        className="py-2 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center gap-0.5"
                      >
                        <ArrowDown className="w-3 h-3" />
                        <span>4 cm</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustArFloorHeight(-1)}
                        className="py-2 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center gap-0.5"
                      >
                        <ArrowDown className="w-3 h-3" />
                        <span>1 cm</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustArFloorHeight('reset')}
                        className="py-2 bg-[#b08960] text-stone-950 font-mono"
                      >
                        Yere Oturt
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustArFloorHeight(1)}
                        className="py-2 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center gap-0.5"
                      >
                        <ArrowUp className="w-3 h-3" />
                        <span>1 cm</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustArFloorHeight(4)}
                        className="py-2 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center gap-0.5"
                      >
                        <ArrowUp className="w-3 h-3" />
                        <span>4 cm</span>
                      </button>
                    </div>

                    {/* Orantılı Büyüt / Küçült (%) & 15° Döndür */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-stone-400">ÖLÇEK</span>
                        <button
                          type="button"
                          onClick={() => applyProportionalScale(scalePct - 5)}
                          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center"
                          aria-label="Orantılı küçült"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => applyProportionalScale(100)}
                          className="px-2.5 h-8 bg-white text-stone-950 font-mono text-xs font-bold"
                        >
                          {scalePct === 100 ? '1:1' : `%${scalePct}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyProportionalScale(scalePct + 5)}
                          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center"
                          aria-label="Orantılı büyüt"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-stone-400">DÖNDÜR</span>
                        <button
                          type="button"
                          onClick={() => rotateInAr(-15)}
                          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center"
                          aria-label="Sola döndür"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => rotateInAr(15)}
                          className="w-8 h-8 bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center"
                          aria-label="Sağa döndür"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </model-viewer>

        {/* CANLI TABLET / UNIVERSAL KAMERA AR HUD KONTROLLERİ */}
        {liveCameraAr && (
          <div className="absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
            <div className="bg-stone-950/88 backdrop-blur text-white px-3 py-2 border border-white/20 text-[11px] pointer-events-auto">
              <p className="font-bold">Canlı Kamera AR · {activeProduct.name}</p>
              <p className="text-[10px] text-stone-300">
                Parmağınla döndür/yakınlaştır · {liveScaledDims.w}×{liveScaledDims.d}×{liveScaledDims.h} cm
              </p>
            </div>
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={() => setLiveCamYOffsetPx((v) => Math.max(-180, v - 18))}
                className="p-2 bg-stone-950/88 text-white border border-white/20"
                title="Yukarı Kaydır"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLiveCamYOffsetPx((v) => Math.min(180, v + 18))}
                className="p-2 bg-stone-950/88 text-white border border-white/20"
                title="Aşağı Kaydır"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void startLiveCamera(cameraFacing === 'environment' ? 'user' : 'environment')}
                className="p-2 bg-stone-950/88 text-white border border-white/20"
                title="Arka / Ön Kamera Değiştir"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={stopLiveCamera}
                className="px-3 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-bold flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Kamerayı Kapat</span>
              </button>
            </div>
          </div>
        )}

        {/* Sol Üst: 1:1 Ölçü + Akıllı Kadraj & Mesafe Rehberi */}
        {showDimsBadge && arStatus === 'not-presenting' && !liveCameraAr && (
          <div className="absolute top-3 left-3 right-3 sm:right-auto max-w-sm bg-white/95 backdrop-blur border border-stone-200 p-3 text-[11px] space-y-2 shadow-sm pointer-events-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-[#9c7349]">
                  {scalePct === 100 ? '1:1 Gerçek Ölçü' : `Orantılı Ölçek (%${scalePct})`}
                </p>
                <p className="font-mono font-bold text-stone-950">
                  En {liveScaledDims.w} · Der {liveScaledDims.d} · Yük {liveScaledDims.h} cm
                </p>
              </div>
              <div className="px-2 py-1 border border-stone-950 bg-stone-950 text-white text-[10px] font-bold flex items-center gap-1 shrink-0">
                <Smartphone className="w-3 h-3" />
                <span>DİKEY · {recommendedDistanceLabel.toUpperCase()}</span>
              </div>
            </div>
            <div className="pt-1.5 border-t border-stone-200/80 text-[10.5px] text-stone-600 leading-snug flex items-start gap-1.5">
              <Sun className="w-3.5 h-3.5 text-[#9c7349] shrink-0 mt-0.5" />
              <span>
                {isWideProduct
                  ? `Bu ürün ${baseDims.w} cm genişliğindedir. ${
                      arEnv.isIOS
                        ? 'Apple ARKit (LiDAR) ile 1:1 gerçek ölçüde zemine kilitlenir — 2.5–3 m geriden zemini 2 sn tarayın.'
                        : 'Google ARCore ile 1:1 gerçek ölçüde zemine kilitlenir — 2.5–3 m geriden aydınlık zemini 2 sn tarayın.'
                    }`
                  : `Bu ürün ${baseDims.w} cm enindedir. ${
                      arEnv.isIOS
                        ? 'Apple ARKit (LiDAR) ile 1:1 gerçek ölçüde zemine kilitlenir — 1.5–2 m mesafeden zemini 2 sn tarayın.'
                        : 'Google ARCore ile 1:1 gerçek ölçüde zemine kilitlenir — 1.5–2 m mesafeden zemini 2 sn tarayın.'
                    }`}
              </span>
            </div>
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
              <span>
                Kamerayı Aç (Dikey · {recommendedDistanceLabel})
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Alt Ürün, Orantılı Ölçek & Canlı AR Paneli */}
      <div className="shrink-0 bg-white border-t border-stone-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
        <div className="max-w-2xl w-full mx-auto space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-[#9c7349]">
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

            {/* 1:1 Gerçek Ölçü Kilidi + Ön-Ölçek Kontrolü (iPad/iPhone Quick Look + Android Scene Viewer uyumlu!) */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setArScaleLocked((v) => !v)}
                className={`px-2 h-7 border text-[10px] font-bold flex items-center gap-1 transition whitespace-nowrap ${
                  arScaleLocked
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-300 bg-[#faf8f4] text-stone-700 hover:border-stone-950'
                }`}
                title={
                  arScaleLocked
                    ? 'AR açıldığında ürün 1:1 gerçek cm ölçüsünde kilitlenir (küçülüp büyümez)'
                    : 'AR içinde iki parmakla serbest boyutlandırma açık'
                }
              >
                {arScaleLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                <span>{arScaleLocked ? '1:1 Kilitli' : 'Serbest Ölçek'}</span>
              </button>
              <button
                type="button"
                onClick={() => applyProportionalScale(scalePct - 5)}
                className="w-7 h-7 border border-stone-300 hover:border-stone-950 bg-[#faf8f4] flex items-center justify-center text-stone-800"
                title="Orantılı %5 küçült"
                aria-label="Küçült"
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => applyProportionalScale(100)}
                className="px-2 h-7 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-mono font-bold text-stone-950"
                title="1:1 gerçek ölçüye sıfırla"
              >
                {scalePct === 100 ? '1:1' : `%${scalePct}`}
              </button>
              <button
                type="button"
                onClick={() => applyProportionalScale(scalePct + 5)}
                className="w-7 h-7 border border-stone-300 hover:border-stone-950 bg-[#faf8f4] flex items-center justify-center text-stone-800"
                title="Orantılı %5 büyüt"
                aria-label="Büyüt"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
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
                        : 'border-stone-300 bg-[#faf8f4] text-stone-700 hover:border-stone-500'
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
              disabled={normalizingRemote || (arEnv.isIOS && preparingUsdz && !effectiveUsdzUrl)}
              className="w-full py-3.5 bg-stone-950 hover:bg-stone-800 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              {preparingUsdz && !effectiveUsdzUrl ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
              <span>
                {liveCameraAr
                  ? 'Canlı Kamerayı Kapat'
                  : preparingUsdz && !effectiveUsdzUrl
                  ? 'iPad / iPhone AR Hazırlanıyor...'
                  : nativeArAvailable
                  ? arEnv.isIOS
                    ? `Odanda Canlı Gör (Apple ARKit · 1:1)`
                    : `Odanda Canlı Gör (ARCore · 1:1)`
                  : isMobileDevice || isTabletDevice
                  ? 'Canlı Kamera Önizleme Aç'
                  : 'Telefonda / iPad’de Canlı AR Aç (QR)'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (liveCameraAr) stopLiveCamera();
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
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#9c7349]">
                  Canlı Kamera AR · Dikey · {recommendedDistanceLabel}
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
              <div className="p-4 bg-[#faf8f4] border border-stone-200 text-xs text-stone-700 leading-relaxed space-y-2 text-left">
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
                  {isWideProduct
                    ? `Bu ürün ${baseDims.w} cm genişliğindedir. QR kodu okutup telefonu DİKEY tutun ve 2.5–3 m geriden aydınlık zemine yerleştirin.`
                    : `Bu ürün ${baseDims.w} cm enindedir. QR kodu okutup telefonu DİKEY tutun ve 1.5–2 m mesafeden aydınlık zemine yerleştirin.`}
                </p>
                <button
                  type="button"
                  onClick={() => void startLiveCamera('environment')}
                  className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Bu Cihazın Kamerasıyla Canlı AR Aç</span>
                </button>
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
