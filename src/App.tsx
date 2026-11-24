import React, { useEffect, useState } from 'react';
import '@google/model-viewer';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  Copy,
  Download,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  QrCode,
  Server,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PRODUCTS, findProduct, type Product } from './lib/products';
import { buildShareUrl, getPublicOrigin } from './lib/server';
import { convertCadFileToGlb } from './lib/cadImport';
import { DEMO_STUDIO_PRESETS, type DemoStudioPresetId } from './lib/demoRooms';
import {
  RUNPOD_GPU_TIERS,
  getMembershipState,
  recordGeneratedProduct3D,
  update3DEngineCredentials,
  type ActiveAiEngine,
  type MembershipState,
  type RunpodGpuTierId,
} from './lib/membership';
import {
  fetchProduct3DConfig,
  generateFurniture3DServerless,
  type Product3DServerConfig,
} from './lib/product3dClient';
import {
  deleteCloudProduct,
  fetchCloudCatalog,
  fetchCloudProductById,
  fetchStorageConfig,
  getSavedStoragePin,
  registerPreUploadedR2Product,
  saveProductToCloudStorage,
  saveStoragePin,
  type CloudStorageConfig,
} from './lib/storageClient';
import { ProductPage } from './components/ProductPage';

function preprocessPhotoFor3D(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 1024;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.fillStyle = '#f5f4f0';
        ctx.fillRect(0, 0, size, size);
        const pad = Math.round(size * 0.04);
        const avail = size - pad * 2;
        const sc = Math.min(avail / img.width, avail / img.height);
        const dw = Math.round(img.width * sc);
        const dh = Math.round(img.height * sc);
        ctx.drawImage(img, Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getOrientationGuide(dimensionsCm: string): 'landscape' | 'portrait' {
  const m = dimensionsCm.match(/(\d+(?:[.,]\d+)?)/);
  const w = m ? parseFloat(m[1].replace(',', '.')) : 120;
  return Number.isFinite(w) && w >= 135 ? 'landscape' : 'portrait';
}

const PRESET_ROOM_IMAGES: Record<DemoStudioPresetId, string> = {
  living: '/rooms/room-oak.jpg',
  bedroom: '/rooms/room-rug.jpg',
  grand: '/rooms/room-travertine.jpg',
};

const SECTOR_REVIEWS = [
  {
    name: 'Kerem Yalçın',
    role: 'Yönetim Kurulu Üyesi · İnegöl Koltuk Üreticisi',
    quote:
      'Müşteri mağazada beğendiği köşe takımının QR kodunu okutup akşam kendi salonunda canlı AR ile birebir ölçüsünde zemine koyduğunda karar süresi yarı yarıya kısaldı.',
  },
  {
    name: 'Selin Demirtaş',
    role: 'İç Mimar · Modoko Proje Stüdyosu',
    quote:
      'Özel üretim .OBJ ve .GLB modellerimizi hiçbir ek yazılım olmadan tarayıcıda 1:1 metreye çevirip hem 3B Oda Planlayıcıda hem iPhone AR Quick Look üzerinde sunabiliyoruz.',
  },
  {
    name: 'Hakan Karaca',
    role: 'E-Ticaret Müdürü · Masko Mobilya',
    quote:
      'Uygulama indirme zorunluluğu olmadığı için internet sitemizdeki ürün sayfasından anında kameraya geçiyor. Yanlış ölçü kaynaklı ağır nakliye iadelerimizde belirgin düşüş yaşadık.',
  },
  {
    name: 'Burcu Arslan',
    role: 'Showroom Direktörü · Ankara Siteler',
    quote:
      'Yeni koleksiyonumuzun yalnızca ürün fotoğraflarından saniyeler içinde 1:1 3B model üretip tüm mağaza etiketlerine canlı AR QR kodu basabildik.',
  },
  {
    name: 'Mert Özkan',
    role: 'İhracat Sorumlusu · Kayseri Mobilya Grubu',
    quote:
      'Avrupa ve Orta Doğu bayilerimizle yaptığımız katalog sunumlarında müşteriler ürünümüzü ofislerinde canlı AR ile yere koyup gerçek oranını anında test ediyor.',
  },
  {
    name: 'Deniz Aksoy',
    role: 'Kurucu Ortak · İzmir Tasarım Atölyesi',
    quote:
      '3B Oda Planlayıcıda müşterinin gerçek salon ölçülerini girip koltuk, sehpa ve TV ünitesini çarpışma kontrollü dizmek satış masasında çok net sonuç veriyor.',
  },
];

type ActiveViewState = {
  product: Product;
  mode: 'preview' | 'ar' | 'planner';
  studioPreset?: DemoStudioPresetId;
  colorHex?: string;
};

export function App() {
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [stageProductId, setStageProductId] = useState<string>('ikea-landskrona-sofa');

  const [activeState, setActiveState] = useState<ActiveViewState | null>(() => {
    const q = new URLSearchParams(window.location.search);
    const glb = q.get('glb');
    const urun = q.get('urun');
    const mod = q.get('mod');
    const oda = q.get('oda');
    const renk = q.get('renk') || undefined;
    const w = Number(q.get('w') || 0);
    const d = Number(q.get('d') || 0);
    const h = Number(q.get('h') || 0);

    const startMode: 'preview' | 'ar' | 'planner' =
      mod === 'planner' || mod === 'studio'
        ? 'planner'
        : mod === 'ar'
        ? 'ar'
        : 'preview';
    const studioPreset = oda === 'living' || oda === 'bedroom' || oda === 'grand' ? oda : undefined;

    if (glb) {
      return {
        product: {
          id: urun || 'custom-ar',
          name: q.get('name') || 'Mağaza Ürünü',
          category: 'Özel Üretim',
          dimensionsCm: q.get('dim') || (w && d && h ? `${w} × ${d} × ${h} cm` : '1:1 Ölçü'),
          glbUrl: glb,
          remoteGlbUrl: glb,
          dimsTargetCm: w > 1 && d > 1 && h > 1 ? { w, d, h } : undefined,
          source: 'ozel-cad',
        },
        mode: startMode === 'preview' ? 'ar' : startMode,
        studioPreset,
        colorHex: renk,
      };
    }
    const found = findProduct(urun);
    if (found) {
      return {
        product: found,
        mode: startMode,
        studioPreset,
        colorHex: renk,
      };
    }
    // Eğer ?urun=<bulut-id> geldiyse yerleşik katalogda olmayabilir; alttaki bulut sorgusu onu açacak!
    if (!urun && (mod === 'ar' || mod === 'planner' || mod === 'studio')) {
      return {
        product: PRODUCTS[0],
        mode: startMode,
        studioPreset,
        colorHex: renk,
      };
    }
    return null;
  });
  const [resolvingCloudLink, setResolvingCloudLink] = useState<boolean>(() => {
    const q = new URLSearchParams(window.location.search);
    const urun = q.get('urun');
    const glb = q.get('glb');
    return Boolean(urun && !glb && !findProduct(urun));
  });

  const [qrFor, setQrFor] = useState<Product | null>(null);
  const [qrMode, setQrMode] = useState<'ar' | 'planner'>('ar');
  const [showServer, setShowServer] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderTab, setBuilderTab] = useState<'ai' | 'cad'>('ai');
  const [filterTab, setFilterTab] = useState<
    'all' | 'seating' | 'table-chair' | 'storage-bed' | 'ikea-cad' | 'studyo-cad'
  >('all');
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Kurumsal Demo Talep Formu
  const [demoCompany, setDemoCompany] = useState('');
  const [demoContact, setDemoContact] = useState('');
  const [demoNote, setDemoNote] = useState('');
  const [demoSubmitted, setDemoSubmitted] = useState(false);

  // Dahili 3B Motor & Kalıcı Dosya Deposu Ayarları
  const [memberState, setMemberState] = useState<MembershipState>(() => getMembershipState());
  const [server3dCfg, setServer3dCfg] = useState<Product3DServerConfig>({
    falConfigured: false,
    runpod3dConfigured: false,
    defaultRunpodTier: 'RTX4090',
  });
  const [storageCfg, setStorageCfg] = useState<CloudStorageConfig>({
    configured: false,
    provider: 'none',
    providerLabel: 'Bağlı Değil (Geçici Oturum)',
    publicBaseUrl: '',
    requiresPin: false,
    maxDirectUploadMb: 3.5,
  });
  const [cfgAdminPin, setCfgAdminPin] = useState<string>(() => getSavedStoragePin());
  const [cfgFalKey, setCfgFalKey] = useState(() => getMembershipState().falApiKey);
  const [cfgRpEp, setCfgRpEp] = useState(() => getMembershipState().runpod3dEndpointId);
  const [cfgRpKey, setCfgRpKey] = useState(() => getMembershipState().runpodApiKey);
  const [cfgRpTier, setCfgRpTier] = useState<RunpodGpuTierId>(
    () => getMembershipState().runpodGpuTier
  );
  const [cfgEngine, setCfgEngine] = useState<ActiveAiEngine>(
    () => getMembershipState().preferredAiEngine
  );

  // CAD & AI 3B Ürün Oluşturucu
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [cadWidthCm, setCadWidthCm] = useState('');
  const [cadZUp, setCadZUp] = useState(false);

  const [aiEngineChoice, setAiEngineChoice] = useState<ActiveAiEngine>(
    () => getMembershipState().preferredAiEngine
  );
  const [slots, setSlots] = useState<{
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
  }>({ front: null, back: null, left: null, right: null });
  const [newName, setNewName] = useState('');
  const [newW, setNewW] = useState('210');
  const [newD, setNewD] = useState('92');
  const [newH, setNewH] = useState('82');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [generatedGlb, setGeneratedGlb] = useState<{ url: string; filename: string } | null>(null);

  // Açılışta kalıcı bulut ürünlerini (R2 / Blob) yükle ve varsa ?urun=<bulut-id> QR linkini aç
  useEffect(() => {
    let cancelled = false;
    fetchStorageConfig().then((cfg) => {
      if (!cancelled) setStorageCfg(cfg);
    });
    fetchCloudCatalog().then((cloudList) => {
      if (cancelled || cloudList.length === 0) return;
      setProducts((prev) => {
        const seen = new Set(cloudList.map((p) => p.id));
        return [...cloudList, ...prev.filter((p) => !seen.has(p.id))];
      });
    });

    const q = new URLSearchParams(window.location.search);
    const urun = q.get('urun');
    const glb = q.get('glb');
    if (urun && !glb && !findProduct(urun)) {
      const mod = q.get('mod');
      const oda = q.get('oda');
      const renk = q.get('renk') || undefined;
      const startMode: 'preview' | 'ar' | 'planner' =
        mod === 'planner' || mod === 'studio'
          ? 'planner'
          : mod === 'ar'
          ? 'ar'
          : 'preview';
      const studioPreset =
        oda === 'living' || oda === 'bedroom' || oda === 'grand' ? oda : undefined;

      fetchCloudProductById(urun)
        .then((foundCloud) => {
          if (cancelled) return;
          if (foundCloud) {
            setProducts((prev) => [
              foundCloud,
              ...prev.filter((p) => p.id !== foundCloud.id),
            ]);
            setActiveState({
              product: foundCloud,
              mode: startMode,
              studioPreset,
              colorHex: renk,
            });
          } else if (mod === 'ar' || mod === 'planner' || mod === 'studio') {
            setActiveState({
              product: PRODUCTS[0],
              mode: startMode,
              studioPreset,
              colorHex: renk,
            });
          }
        })
        .finally(() => {
          if (!cancelled) setResolvingCloudLink(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const st = getMembershipState();
    setMemberState(st);
    setCfgFalKey(st.falApiKey);
    setCfgRpEp(st.runpod3dEndpointId);
    setCfgRpKey(st.runpodApiKey);
    setCfgRpTier(st.runpodGpuTier);
    setCfgEngine(st.preferredAiEngine);
    fetchProduct3DConfig().then(setServer3dCfg);
    fetchStorageConfig().then(setStorageCfg);
  }, [showServer, showBuilder]);

  useEffect(() => {
    if (resolvingCloudLink) return;
    if (!activeState) {
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }
    const share = buildShareUrl({
      productId: activeState.product.id,
      glbUrl: activeState.product.glbUrl,
      remoteGlbUrl: activeState.product.remoteGlbUrl,
      cloudStored: activeState.product.cloudStored,
      productName: activeState.product.name,
      dimensionsCm: activeState.product.dimensionsCm,
      dimsTargetCm: activeState.product.dimsTargetCm,
      mode: activeState.mode,
      oda: activeState.studioPreset,
      colorHex: activeState.colorHex,
    });
    const nextSearch = new URL(share).search;
    if (window.location.search !== nextSearch) {
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
    }
  }, [activeState, resolvingCloudLink]);

  const qrUrl = (p: Product, mode: 'ar' | 'planner' = 'ar') =>
    buildShareUrl({
      productId: p.id,
      glbUrl: p.glbUrl,
      remoteGlbUrl: p.remoteGlbUrl,
      cloudStored: p.cloudStored,
      productName: p.name,
      dimensionsCm: p.dimensionsCm,
      dimsTargetCm: p.dimsTargetCm,
      mode,
    });

  const falReady = server3dCfg.falConfigured || Boolean(memberState.falApiKey);
  const runpod3dReady =
    server3dCfg.runpod3dConfigured ||
    Boolean(memberState.runpod3dEndpointId && memberState.runpodApiKey);
  const selectedAiReady = aiEngineChoice === 'runpod' ? runpod3dReady : falReady;

  const handleGenerate3D = async () => {
    if (!slots.front) return;
    setGenerating(true);
    setGeneratedGlb(null);
    setGenMsg('Ürün fotoğrafları 3B üretim motoruna gönderiliyor...');
    try {
      const w = parseFloat(newW) || 210;
      const d = parseFloat(newD) || 92;
      const h = parseFloat(newH) || 82;
      const cleanName = newName.trim() || 'Özel Mağaza Ürünü';

      const out = await generateFurniture3DServerless({
        engine: aiEngineChoice,
        images: {
          front: slots.front,
          back: slots.back,
          left: slots.left,
          right: slots.right,
        },
        name: cleanName,
        widthCm: w,
        depthCm: d,
        heightCm: h,
        falApiKey: memberState.falApiKey || undefined,
        runpodApiKey: memberState.runpodApiKey || undefined,
        runpod3dEndpointId: memberState.runpod3dEndpointId || undefined,
        runpodGpuTier: memberState.runpodGpuTier,
        adminPin: cfgAdminPin || undefined,
        onProgress: (m) => setGenMsg(m),
      });

      let finalProduct: Product = {
        id: out.productId || `ai-${Date.now()}`,
        name: cleanName,
        category: 'Özel 3B',
        dimensionsCm: out.dimensionsCm,
        glbUrl: out.localBlobUrl,
        remoteGlbUrl: out.remoteGlbUrl,
        dimsTargetCm: { w: out.widthCm, d: out.depthCm, h: out.heightCm },
        source: 'ozel-cad',
      };

      // 2. Aşama: RunPod 2K PBR .GLB'yi doğrudan R2'ye yüklediyse sadece kataloğa kaydet; değilse tarayıcıdan yükle!
      if (out.r2DirectSaved && out.productId && out.remoteGlbUrl) {
        try {
          finalProduct = await registerPreUploadedR2Product({
            productId: out.productId,
            name: cleanName,
            category: 'Özel 3B',
            dimensionsCm: out.dimensionsCm,
            dimsTargetCm: { w: out.widthCm, d: out.depthCm, h: out.heightCm },
            glbPublicUrl: out.remoteGlbUrl,
            thumbnailDataUrl: slots.front,
            adminPin: cfgAdminPin,
            onProgress: (m) => setGenMsg(m),
          });
        } catch (regErr) {
          finalProduct.cloudStored = true;
          setGenMsg(
            `2K PBR model R2'ye kaydedildi ancak katalog kaydı uyarısı: ${
              regErr instanceof Error ? regErr.message : 'Bilinmeyen hata'
            }`
          );
        }
      } else if (storageCfg.configured && out.glbBuffer) {
        try {
          finalProduct = await saveProductToCloudStorage({
            name: cleanName,
            category: 'Özel 3B',
            dimensionsCm: out.dimensionsCm,
            dimsTargetCm: { w: out.widthCm, d: out.depthCm, h: out.heightCm },
            glbBuffer: out.glbBuffer,
            thumbnailDataUrl: slots.front,
            storageConfig: storageCfg,
            adminPin: cfgAdminPin,
            onProgress: (m) => setGenMsg(m),
          });
        } catch (saveErr) {
          setGenMsg(
            `Model üretildi ancak bulut kaydı atlandı: ${
              saveErr instanceof Error ? saveErr.message : 'Bilinmeyen hata'
            }`
          );
        }
      }

      setProducts((prev) => [
        finalProduct,
        ...prev.filter((p) => p.id !== finalProduct.id),
      ]);
      setMemberState(
        recordGeneratedProduct3D(cleanName, out.modelLabel, out.elapsedSec, out.costUsd)
      );
      setGeneratedGlb({ url: out.localBlobUrl, filename: out.filename });
      setGenMsg(
        finalProduct.cloudStored
          ? `Kalıcı buluta kaydedildi (${out.dimensionsCm}) · Artık QR ile her telefonda doğrudan AR'da açılır.`
          : `1:1 AR-hazır model tamamlandı (${out.dimensionsCm} · ${out.elapsedSec} sn)`
      );
      setShowBuilder(false);
      setActiveState({ product: finalProduct, mode: 'ar' });
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : '3B ürün üretimi başarısız oldu');
    } finally {
      setGenerating(false);
    }
  };

  const handleCadUpload = async () => {
    if (!cadFile) return;
    setGenerating(true);
    setGeneratedGlb(null);
    setGenMsg('CAD dosyası 1:1 metreye çevrilip y=0 tabanına hizalanıyor...');
    try {
      const wVal = parseFloat(cadWidthCm);
      const converted = await convertCadFileToGlb(cadFile, {
        targetWidthCm: Number.isFinite(wVal) && wVal > 1 ? wVal : undefined,
        zUp: cadZUp,
      });
      const fallbackName = cadFile.name.replace(/\.[^.]+$/, '');
      const cleanName = newName.trim() || fallbackName || 'Özel CAD Ürün';
      const blobUrl = URL.createObjectURL(
        new Blob([converted.glbBuffer], { type: 'model/gltf-binary' })
      );

      let finalProduct: Product = {
        id: `cad-local-${Date.now()}`,
        name: cleanName,
        category: 'Özel CAD',
        dimensionsCm: converted.dimensionsCm,
        glbUrl: blobUrl,
        dimsTargetCm: { w: converted.widthCm, d: converted.depthCm, h: converted.heightCm },
        source: 'ozel-cad',
      };

      // Kalıcı dosya deposu aktifse CAD modelini de 1 kere kalıcı depoya kaydet -> kalıcı QR hazır!
      if (storageCfg.configured) {
        try {
          finalProduct = await saveProductToCloudStorage({
            name: cleanName,
            category: 'Özel CAD',
            dimensionsCm: converted.dimensionsCm,
            dimsTargetCm: { w: converted.widthCm, d: converted.depthCm, h: converted.heightCm },
            glbBuffer: converted.glbBuffer,
            storageConfig: storageCfg,
            adminPin: cfgAdminPin,
            onProgress: (m) => setGenMsg(m),
          });
        } catch (saveErr) {
          setGenMsg(
            `CAD dönüştürüldü ancak bulut kaydı atlandı: ${
              saveErr instanceof Error ? saveErr.message : 'Bilinmeyen hata'
            }`
          );
        }
      }

      setProducts((prev) => [
        finalProduct,
        ...prev.filter((p) => p.id !== finalProduct.id),
      ]);
      setGeneratedGlb({ url: blobUrl, filename: `${cleanName}-1to1.glb` });
      setShowBuilder(false);
      setActiveState({ product: finalProduct, mode: 'ar' });
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : 'CAD dönüştürme hatası');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteCloudItem = async (p: Product) => {
    if (!p.cloudStored) return;
    if (!window.confirm(`"${p.name}" ürününü kalıcı bulut deposundan silmek istiyor musunuz?`)) {
      return;
    }
    try {
      await deleteCloudProduct(p.id, cfgAdminPin);
      setProducts((prev) => prev.filter((item) => item.id !== p.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Silme işlemi başarısız oldu.');
    }
  };

  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoCompany.trim() || !demoContact.trim()) return;
    setDemoSubmitted(true);
  };

  const filteredProducts = products.filter((p) => {
    if (filterTab === 'all') return true;
    if (filterTab === 'ikea-cad') return p.source === 'ikea-cad';
    if (filterTab === 'studyo-cad') return p.source === 'studyo-cad' || p.source === 'ozel-cad';
    if (filterTab === 'seating') return p.category === 'Kanepe' || p.category === 'Berjer';
    if (filterTab === 'table-chair')
      return p.category === 'Masa' || p.category === 'Sandalye' || p.category === 'Sehpa';
    if (filterTab === 'storage-bed') {
      return (
        p.category === 'Kitaplık' ||
        p.category === 'Raf' ||
        p.category === 'TV Ünitesi' ||
        p.category === 'Yatak'
      );
    }
    return true;
  });

  const featuredIds = [
    'ikea-landskrona-sofa',
    'ikea-strandmon-chair',
    'ikea-uppland-sofa',
    'ikea-stockholm-coffee',
  ];
  const featuredProducts = featuredIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
  const stageProduct = products.find((p) => p.id === stageProductId) || products[0];
  const stageOrient = getOrientationGuide(stageProduct.dimensionsCm);
  const embedSampleUrl = `${getPublicOrigin()}/?urun=ikea-landskrona-sofa&mod=ar`;

  if (resolvingCloudLink) {
    return (
      <div className="min-h-screen bg-[#0d0d0c] text-white flex flex-col items-center justify-center gap-3 p-6 text-center">
        <Loader2 className="w-7 h-7 animate-spin text-[#c9a277]" />
        <p className="text-sm font-semibold">3B ürün kalıcı dosya deposundan hazırlanıyor...</p>
        <p className="text-xs text-stone-400">
          Canlı AR modeli doğrudan telefonunuza indiriliyor (GPU kullanılmaz).
        </p>
      </div>
    );
  }

  if (activeState) {
    return (
      <ProductPage
        product={activeState.product}
        products={products}
        startMode={activeState.mode}
        initialStudioPreset={activeState.studioPreset}
        initialColorHex={activeState.colorHex}
        onAddCustomProduct={(prod) => setProducts((prev) => [prod, ...prev])}
        onOpenAiBuilder={() => {
          setActiveState(null);
          setGenMsg(null);
          setBuilderTab('ai');
          setShowBuilder(true);
        }}
        onBack={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setActiveState(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] text-stone-950 overflow-x-hidden pb-16 md:pb-0">
      {/* Üst Menü — Koyu Mimari Cam & Kusursuz Tek Satır */}
      <header className="h-16 border-b border-white/10 px-4 lg:px-10 flex items-center justify-between gap-4 sticky top-0 bg-[#0d0d0c]/92 backdrop-blur-xl text-white z-30">
        <a href="#" className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-white"
            aria-hidden="true"
          >
            <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" stroke="currentColor" strokeWidth="1.65" />
            <path d="M12 22V12M12 12L21 7M12 12L3 7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M12 7.5L16 9.8V14.2L12 16.5L8 14.2V9.8L12 7.5Z" fill="#c9a277" />
          </svg>
          <span className="font-display text-sm sm:text-[15px] font-extrabold tracking-tight text-white">
            MekanAR
          </span>
          <span className="hidden sm:inline-block h-3.5 w-px bg-white/20" />
          <span className="hidden sm:inline text-[11px] font-medium text-stone-400 tracking-wide">
            Canlı AR &amp; 3B Stüdyo
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-8 text-xs font-medium text-stone-300">
          <a href="#deneyim" className="hover:text-white transition whitespace-nowrap">
            Deneyim
          </a>
          <a href="#vitrin" className="hover:text-white transition whitespace-nowrap">
            3B Vitrin
          </a>
          <a href="#planlayici" className="hover:text-white transition whitespace-nowrap">
            Planlayıcı
          </a>
          <a href="#katalog" className="hover:text-white transition whitespace-nowrap">
            Katalog
          </a>
          <a href="#uretim" className="hover:text-white transition whitespace-nowrap">
            3B Üretim
          </a>
          <a href="#iletisim" className="hover:text-white transition whitespace-nowrap">
            İletişim
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setGenMsg(null);
              setBuilderTab('ai');
              setShowBuilder(true);
            }}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 border border-white/20 hover:border-[#c9a277] bg-white/5 text-white text-xs font-semibold transition whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ürün Ekle</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveState({
                product: stageProduct,
                mode: 'planner',
                studioPreset: 'living',
              })
            }
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#efe9df] text-stone-950 text-xs font-bold transition whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3B Planlayıcı</span>
          </button>

          <button
            type="button"
            onClick={() => setShowServer(true)}
            className="relative p-2 border border-white/15 hover:border-white/40 bg-white/5 text-stone-300 hover:text-white transition shrink-0"
            aria-label="3B Motor Ayarları"
            title={falReady || runpod3dReady ? '3B GPU Motoru Aktif' : '3B GPU Motoru Ayarları'}
          >
            <Server className="w-3.5 h-3.5" />
            {(falReady || runpod3dReady) && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        </div>
      </header>

      {/* TAM EKRAN MİMARİ SHOWROOM HERO — Sade Kutu Yok, Tam Atmosferik Lüks */}
      <section className="relative bg-[#0b0b0a] text-white min-h-[86vh] flex flex-col justify-between overflow-hidden border-b border-stone-800">
        <img
          src="/rooms/hero-luxury-showroom.jpg"
          alt="Lüks mimari mobilya galerisi"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-70 scale-[1.01] pointer-events-none select-none"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(100deg, rgba(10,10,9,0.92) 0%, rgba(12,12,11,0.72) 44%, rgba(12,12,11,0.28) 78%, rgba(10,10,9,0.52) 100%)',
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-44 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(11,11,10,0) 0%, rgba(11,11,10,0.94) 100%)',
          }}
        />

        {/* Ana Editorial Hero İçeriği */}
        <div className="relative max-w-6xl w-full mx-auto px-4 lg:px-10 pt-20 lg:pt-28 pb-12 flex-1 flex flex-col justify-center">
          <div className="max-w-2xl space-y-7">
            <div className="flex items-center gap-3">
              <span className="w-10 h-px bg-[#c9a277]" />
              <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-[#e0c09a]">
                Mobilya Markaları İçin Canlı AR &amp; 3B Mekân Platformu
              </p>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-[62px] font-bold tracking-[-0.03em] text-white leading-[1.03]">
              Mobilyayı satın almadan kendi odanızda 1:1 yaşayın.
            </h1>

            <p className="text-sm sm:text-base lg:text-[17px] text-stone-200/90 leading-relaxed max-w-xl font-normal">
              Uygulama indirmeden telefon kamerasıyla mobilyaları gerçek santimetre ölçüsünde
              zemine yerleştirin; ayak yüksekliğini ve orantılı boyutu canlı ayarlayın ya da IKEA
              tarzı 3B Oda Planlayıcıda tüm odayı baştan tasarlayın.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <button
                type="button"
                onClick={() =>
                  setActiveState({
                    product: stageProduct,
                    mode: 'ar',
                  })
                }
                className="px-8 py-4 bg-white hover:bg-[#efe9df] text-stone-950 text-xs sm:text-sm font-bold tracking-wide flex items-center gap-2.5 transition whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Canlı AR ile Odanda Gör</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveState({
                    product: stageProduct,
                    mode: 'planner',
                    studioPreset: 'living',
                  })
                }
                className="px-7 py-4 border border-white/40 hover:border-white bg-black/25 backdrop-blur-md text-white hover:bg-white/10 text-xs sm:text-sm font-semibold tracking-wide flex items-center gap-2 transition whitespace-nowrap shrink-0"
              >
                <Layers className="w-4 h-4" />
                <span>3B Oda Planlayıcıyı Aç</span>
              </button>
            </div>
          </div>
        </div>

        {/* Alt Mimari Bilgi & Hızlı Ürün AR Çubuğu */}
        <div className="relative border-t border-white/15 bg-black/45 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 lg:px-10 py-5 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-7 grid grid-cols-3 gap-4 sm:gap-6">
              <div>
                <p className="text-[10px] font-mono text-[#c9a277] uppercase tracking-wider">01 · CANLI AR</p>
                <p className="text-xs sm:text-[13px] font-semibold text-white mt-1">
                  Ayak &amp; Zemin Kilidi
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-[#c9a277] uppercase tracking-wider">02 · PLANLAYICI</p>
                <p className="text-xs sm:text-[13px] font-semibold text-white mt-1">
                  Özel Ölçü 3B Oda
                </p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-[#c9a277] uppercase tracking-wider">03 · 3B ÜRETİM</p>
                <p className="text-xs sm:text-[13px] font-semibold text-white mt-1">
                  Fotoğraftan 1:1 Model
                </p>
              </div>
            </div>

            <div className="md:col-span-5 flex items-center md:justify-end gap-2 overflow-x-auto">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 whitespace-nowrap shrink-0 mr-1">
                Hızlı AR:
              </span>
              {featuredProducts.slice(0, 3).map((fp) => (
                <button
                  key={fp.id}
                  type="button"
                  onClick={() => setActiveState({ product: fp, mode: 'ar' })}
                  className="px-3 py-1.5 border border-white/20 hover:border-[#c9a277] hover:bg-white/10 text-[11px] font-medium text-white whitespace-nowrap shrink-0 transition"
                >
                  {fp.name.split(' ')[0]} →
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bölüm 01: Çift Katmanlı Deneyim — Tam Fotoğraflı Mimari Karşılaştırma */}
      <section id="deneyim" className="max-w-6xl mx-auto px-4 lg:px-10 py-18 lg:py-24 border-b border-stone-200">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
          <div className="max-w-2xl space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#9c7349]">
              01 / İki Güçlü Deneyim, Tek Platform
            </p>
            <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-stone-950 leading-tight">
              İster gerçek odanızda canlı kamera AR, ister 3B odada sıfırdan yerleşim
            </h2>
          </div>
          <p className="text-xs text-stone-500 max-w-xs leading-relaxed">
            iPhone Safari (AR Quick Look) ve Android Chrome (WebXR) üzerinde uygulama yüklemeden anında çalışır.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sol: Canlı Kamera AR */}
          <article className="group relative border border-stone-300/80 bg-[#0f0f0e] text-white overflow-hidden min-h-[420px] flex flex-col justify-end">
            <img
              src="/rooms/ar-studio-editorial.jpg"
              alt="Gerçek odada canlı AR mobilya deneyimi"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover opacity-70 transition duration-700 group-hover:scale-[1.04]"
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(12,12,11,0.08) 0%, rgba(12,12,11,0.68) 54%, rgba(10,10,9,0.96) 100%)',
              }}
            />
            <div className="relative p-7 sm:p-10 space-y-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#e0c09a]">
                01 · CANLI KAMERA AR · AKILLI MESAFE &amp; ZEMİN REHBERİ
              </p>
              <h3 className="font-display text-2xl sm:text-[28px] font-bold leading-snug">
                Ayakları yere oturan, gerçek ölçülü canlı AR yerleşimi.
              </h3>
              <p className="text-xs sm:text-sm text-stone-200/90 leading-relaxed max-w-lg">
                Sistem ürün genişliğine göre ideal çekim mesafesini (2.5–3 m veya 1.5–2 m) önerir;
                canlı AR içindeki yükseklik (cm) ve orantılı ölçek kontrolleriyle mobilya ayakları
                zemine kusursuz oturur.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveState({ product: stageProduct, mode: 'ar' })}
                  className="px-6 py-3 bg-white hover:bg-[#efe9df] text-stone-950 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition"
                >
                  <Camera className="w-4 h-4" />
                  <span>Canlı AR&apos;ı Dene</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQrMode('ar');
                    setQrFor(stageProduct);
                  }}
                  className="px-4 py-3 border border-white/40 hover:border-white text-white text-xs font-semibold inline-flex items-center gap-1.5 transition"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Telefondan QR Aç</span>
                </button>
              </div>
            </div>
          </article>

          {/* Sağ: IKEA Tarzı 3B Oda Planlayıcı */}
          <article className="group relative border border-stone-300/80 bg-[#0f0f0e] text-white overflow-hidden min-h-[420px] flex flex-col justify-end">
            <img
              src="/rooms/room-travertine.jpg"
              alt="3B oda planlayıcı stüdyosu"
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover opacity-70 transition duration-700 group-hover:scale-[1.04]"
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(12,12,11,0.08) 0%, rgba(12,12,11,0.68) 54%, rgba(10,10,9,0.96) 100%)',
              }}
            />
            <div className="relative p-7 sm:p-10 space-y-4">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#e0c09a]">
                02 · İNTERAKTİF 3B ODA PLANLAYICI
              </p>
              <h3 className="font-display text-2xl sm:text-[28px] font-bold leading-snug">
                Odanızın ölçülerini girin, kendi eşyalarınızı 3B mekânda dizin.
              </h3>
              <p className="text-xs sm:text-sm text-stone-200/90 leading-relaxed max-w-lg">
                En, derinlik, tavan yüksekliği, meşe/ceviz parke ve duvar boyasını anında seçin;
                mobilyaları çarpışma korumasıyla yerleştirip kuşbakışı veya göz hizasından inceleyin.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() =>
                    setActiveState({
                      product: stageProduct,
                      mode: 'planner',
                      studioPreset: 'living',
                    })
                  }
                  className="px-6 py-3 bg-white hover:bg-[#efe9df] text-stone-950 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition"
                >
                  <Layers className="w-4 h-4" />
                  <span>3B Oda Planlayıcıyı Aç</span>
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* Bölüm 02: Etkileşimli 360° Müze Vitrini (Özel Galeri Sahnesi) */}
      <section id="vitrin" className="bg-[#121211] text-white border-b border-stone-800">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 lg:py-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#c9a277]">
                02 / Etkileşimli 360° Galeri Vitrini
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Her açıyı yakından inceleyin, tek dokunuşla odanıza alın
              </h2>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {featuredProducts.map((fp) => {
                const active = fp.id === stageProduct.id;
                return (
                  <button
                    key={fp.id}
                    type="button"
                    onClick={() => setStageProductId(fp.id)}
                    className={`px-3.5 py-2 text-xs font-semibold border whitespace-nowrap transition ${
                      active
                        ? 'border-white bg-white text-stone-950'
                        : 'border-white/20 bg-white/5 text-stone-300 hover:border-white/50 hover:text-white'
                    }`}
                  >
                    {fp.name.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 border border-white/15 bg-[#181715] overflow-hidden">
            {/* Sol: Geniş 360° 3B Sahne */}
            <div className="lg:col-span-8 h-80 sm:h-[420px] bg-gradient-to-b from-[#23211e] via-[#1c1b18] to-[#141311] relative">
              <model-viewer
                src={stageProduct.glbUrl}
                alt={stageProduct.name}
                ar
                ar-modes="webxr scene-viewer quick-look"
                ar-scale="auto"
                ar-placement="floor"
                xr-environment
                camera-controls
                auto-rotate
                interaction-prompt="none"
                shadow-intensity="1.4"
                shadow-softness="0.7"
                exposure="1.05"
                environment-image="neutral"
                camera-orbit="28deg 75deg auto"
                style={{ width: '100%', height: '100%' }}
              >
                <button slot="ar-button" style={{ display: 'none' }} aria-hidden="true" />
              </model-viewer>
              <span className="absolute bottom-4 left-5 text-[10px] font-mono uppercase tracking-[0.16em] text-stone-400 pointer-events-none">
                360° Sürükleyin · Yakınlaştırın
              </span>
            </div>

            {/* Sağ: Mimari Ürün Künyesi + Canlı AR & QR */}
            <div className="lg:col-span-4 p-6 sm:p-8 border-t lg:border-t-0 lg:border-l border-white/15 flex flex-col justify-between gap-6 bg-[#141312]">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#c9a277]">
                    {stageProduct.category} · 1:1 CAD MODELİ
                  </p>
                  <h3 className="font-display text-xl font-bold text-white mt-1.5 leading-snug">
                    {stageProduct.name}
                  </h3>
                </div>

                <div className="divide-y divide-white/10 border-y border-white/10 text-xs">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-stone-400">Gerçek Ölçü</span>
                    <span className="font-mono font-semibold text-white">{stageProduct.dimensionsCm}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-stone-400">Önerilen AR Tutuşu</span>
                    <span className="font-semibold text-[#e0c09a] flex items-center gap-1.5">
                      <Smartphone
                        className={`w-3.5 h-3.5 ${stageOrient === 'landscape' ? 'rotate-90' : ''}`}
                      />
                      <span>{stageOrient === 'landscape' ? 'Dikey · 2.5–3 m' : 'Dikey · 1.5–2 m'}</span>
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-stone-400">Zemin &amp; Ölçek</span>
                    <span className="text-stone-200">Ayak Y-Ayarı · Orantılı %</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => setActiveState({ product: stageProduct, mode: 'ar' })}
                  className="w-full py-3.5 bg-white hover:bg-[#efe9df] text-stone-950 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition"
                >
                  <Camera className="w-4 h-4" />
                  <span>Odanda Canlı AR Gör</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveState({
                        product: stageProduct,
                        mode: 'planner',
                        studioPreset: 'living',
                      })
                    }
                    className="py-2.5 border border-white/25 hover:border-white text-white text-xs font-semibold transition"
                  >
                    3B Odada Dene
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQrMode('ar');
                      setQrFor(stageProduct);
                    }}
                    className="py-2.5 border border-white/25 hover:border-[#c9a277] text-stone-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>QR Kod</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bölüm 03: Hazır Mimari 3B Oda Şablonları */}
      <section id="planlayici" className="max-w-6xl mx-auto px-4 lg:px-10 py-16 lg:py-20 border-b border-stone-200">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#9c7349]">
              03 / IKEA Tarzı 3B Oda Planlayıcı
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              Hazır salon şablonu seçin veya kendi oda ölçülerinizi girin
            </h2>
          </div>
          <button
            type="button"
            onClick={() =>
              setActiveState({
                product: stageProduct,
                mode: 'planner',
                studioPreset: 'living',
              })
            }
            className="px-5 py-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition whitespace-nowrap shrink-0 self-start md:self-auto"
          >
            Özel Ölçüde Oda Kur →
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {DEMO_STUDIO_PRESETS.map((preset, idx) => (
            <article
              key={preset.id}
              className="group border border-stone-200 bg-white flex flex-col overflow-hidden transition hover:border-stone-500"
            >
              <div className="aspect-[16/10] bg-stone-100 overflow-hidden relative border-b border-stone-200">
                <img
                  src={PRESET_ROOM_IMAGES[preset.id]}
                  alt={preset.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition duration-500 group-hover:scale-[1.04]"
                />
                <span className="absolute bottom-2.5 right-2.5 bg-stone-950/90 text-white text-[10px] font-mono px-2.5 py-1">
                  {preset.dimensionsLabel}
                </span>
              </div>
              <div className="p-6 flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-mono text-[#9c7349]">
                    {String(idx + 1).padStart(2, '0')} / MİMARİ ŞABLON
                  </p>
                  <h3 className="font-display text-base font-bold text-stone-950">{preset.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{preset.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveState({
                      product: stageProduct,
                      mode: 'planner',
                      studioPreset: preset.id,
                    })
                  }
                  className="w-full py-3 border border-stone-950 bg-white hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition"
                >
                  3B Planlayıcıda Düzenle
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Bölüm 04: 1:1 Gerçek Ölçülü Canlı AR & 3B Mobilya Kataloğu */}
      <main id="katalog" className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 lg:py-20">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 mb-6 border-b border-stone-200">
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#9c7349]">
                04 / 1:1 Canlı AR Ürün Kataloğu
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
                Gerçek Santimetre Ölçülü Mobilya Koleksiyonu
              </h2>
              <p className="text-sm text-stone-600 max-w-2xl">
                Her parça gerçek santimetre ölçüsünde ve zemin hizalıdır. Ürün boyutuna göre ideal
                AR çekim mesafesi otomatik gösterilir.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setGenMsg(null);
                setBuilderTab('ai');
                setShowBuilder(true);
              }}
              className="py-3 px-4 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              + Kendi Ürününüzü 3B &amp; AR&apos;a Ekleyin
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-8">
            {(
              [
                { id: 'all', label: `Tümü (${products.length})` },
                { id: 'seating', label: 'Koltuk & Berjer' },
                { id: 'table-chair', label: 'Masa & Sandalye' },
                { id: 'storage-bed', label: 'Depolama & Yatak' },
                { id: 'ikea-cad', label: 'Resmi CAD' },
                { id: 'studyo-cad', label: 'Stüdyo & Özel 3B' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                  filterTab === tab.id
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-200 bg-[#faf8f4] text-stone-700 hover:border-stone-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((p, idx) => {
              const orient = getOrientationGuide(p.dimensionsCm);
              return (
                <article
                  key={p.id}
                  className="group border border-stone-200 hover:border-stone-500 flex flex-col bg-white transition"
                >
                  <div className="h-64 bg-[#f3efe8] border-b border-stone-200/80 flex items-center justify-center overflow-hidden relative">
                    {p.thumbUrl ? (
                      <img
                        src={p.thumbUrl}
                        alt={p.name}
                        loading="lazy"
                        className="w-full h-full object-contain p-5 transition duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <model-viewer
                        src={p.glbUrl}
                        loading="lazy"
                        camera-controls
                        auto-rotate
                        interaction-prompt="none"
                        shadow-intensity="1"
                        environment-image="neutral"
                        style={{ width: '100%', height: '100%' }}
                      />
                    )}
                    <span className="absolute top-3 left-3.5 text-[10px] font-mono text-stone-400">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    {p.cloudStored && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCloudItem(p)}
                        className="absolute top-2.5 right-2.5 p-1.5 bg-white/90 hover:bg-stone-950 text-stone-600 hover:text-white border border-stone-200 transition"
                        title="Kalıcı buluttan sil"
                        aria-label="Ürünü sil"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <span className="absolute bottom-2.5 right-3 text-[10px] font-mono text-stone-500 bg-white/85 px-2 py-0.5 border border-stone-200/80">
                      {orient === 'landscape' ? 'AR: 2.5–3 m' : 'AR: 1.5–2 m'}
                    </span>
                  </div>

                  <div className="p-5 flex items-start justify-between gap-3 flex-1">
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[#9c7349]">
                        {p.category} ·{' '}
                        {p.cloudStored
                          ? 'Kalıcı Bulut'
                          : p.source === 'ikea-cad'
                          ? 'Resmi CAD'
                          : p.source === 'studyo-cad'
                          ? 'Stüdyo PBR'
                          : 'Özel 3B'}
                      </p>
                      <h3 className="font-display text-sm font-bold text-stone-950 mt-1">{p.name}</h3>
                      <p className="text-xs font-mono text-stone-500 mt-1">{p.dimensionsCm}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQrMode('ar');
                        setQrFor(p);
                      }}
                      className="p-1.5 border border-stone-200 hover:border-stone-950 bg-white shrink-0 transition"
                      aria-label="Canlı AR QR Kodu"
                      title="Telefonda Canlı AR açmak için QR kod"
                    >
                      <QRCodeSVG value={qrUrl(p, 'ar')} size={50} />
                    </button>
                  </div>

                  <div className="px-5 pb-5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveState({ product: p, mode: 'ar' })}
                      className="py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold tracking-wide transition whitespace-nowrap"
                    >
                      Canlı AR&apos;da Gör
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveState({ product: p, mode: 'planner', studioPreset: 'living' })
                      }
                      className="py-2.5 border border-stone-300 hover:border-stone-950 bg-white text-stone-900 text-xs font-semibold transition whitespace-nowrap"
                    >
                      3B Odada Dene
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </main>

      {/* Bölüm 05: Tek Eşyadan 1:1 AR-Hazır 3B Üretim Stüdyosu */}
      <section id="uretim" className="bg-[#0e0e0d] text-white border-b border-stone-800">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#e0c09a]">
              05 / Fotoğraftan 1:1 3B Stüdyosu
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold leading-snug">
              Herhangi bir mobilyayı saniyeler içinde 1:1 AR-hazır 3B modele dönüştürün.
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
              Kendi üretim CAD çiziminizi yükleyin ya da yalnızca ürün fotoğraflarını seçin. Yapay
              zekâ motoru gerçek dokulu 3B modeli çıkarır, santimetrik ölçüsüne ölçekleyip tabanını
              zemine hizalar ve anında Canlı AR ile odanın her köşesinde göstermeye hazır hale
              getirir.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('ai');
                  setShowBuilder(true);
                }}
                className="px-6 py-3.5 bg-white hover:bg-[#efe9df] text-stone-950 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition"
              >
                <Camera className="w-4 h-4" />
                <span>Fotoğraftan 3B Üret</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('cad');
                  setShowBuilder(true);
                }}
                className="px-5 py-3.5 border border-stone-600 hover:border-[#c9a277] text-white text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-2 transition"
              >
                <Upload className="w-4 h-4" />
                <span>CAD Dosyası Yükle</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 border-t sm:border-t-0 sm:border-l border-stone-800 pt-8 sm:pt-0 sm:pl-9 gap-7">
            <div className="space-y-2.5">
              <p className="text-xs font-mono text-[#c9a277]">ADIM 01</p>
              <h3 className="text-sm font-bold text-white">Fotoğraf veya CAD</h3>
              <p className="text-xs text-stone-400 leading-relaxed">
                Mobilyanın önden ve yanlardan 1–4 fotoğrafı ile gerçek En × Derinlik × Yükseklik
                (cm) ölçüsü girilir ya da mevcut .GLB/.OBJ/.STL dosyası seçilir.
              </p>
            </div>
            <div className="space-y-2.5">
              <p className="text-xs font-mono text-[#c9a277]">ADIM 02</p>
              <h3 className="text-sm font-bold text-white">1:1 PBR 3B Modelleme</h3>
              <p className="text-xs text-stone-400 leading-relaxed">
                Bulut yapay zekâ hattı dokulu 3B modeli ve gerçek kumaş/ahşap PBR yüzey haritalarını
                üretir; tabanı tam y=0 zeminine ve santimetre ölçüsüne kilitler.
              </p>
            </div>
            <div className="space-y-2.5">
              <p className="text-xs font-mono text-[#c9a277]">ADIM 03</p>
              <h3 className="text-sm font-bold text-white">Canlı AR &amp; 3B Planlayıcı</h3>
              <p className="text-xs text-stone-400 leading-relaxed">
                Ürün anında QR kodla iPhone AR Quick Look, Android WebXR ve 3B Oda Planlayıcıda
                müşterilerin kullanımına açılır.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Kurumsal Yetenekler (01–06 Mimari Izgara) */}
      <section className="bg-[#f3efe8] border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16">
          <div className="max-w-2xl mb-10 space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#9c7349]">
              Kurumsal Mühendislik
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              Showroom ve e-ticaret dönüşümünü artıran altyapı
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-l border-stone-300/80 bg-white">
            {[
              {
                no: '01',
                title: 'Akıllı AR Mesafe & Zemin Rehberi',
                desc: 'Geniş koltuklar için 2.5–3 m, berjer ve sehpalar için 1.5–2 m dikey kadraj rehberi vererek odanın her köşesinde hatasız 1:1 yerleşim sağlar.',
              },
              {
                no: '02',
                title: 'Canlı Zemin Yüksekliği & Orantılı Ölçek',
                desc: 'Kamera içindeki santimetrik aşağı/yukarı ayarıyla mobilya ayakları zemine tam basar; boyut yalnızca orantılı olarak değiştirilebilir.',
              },
              {
                no: '03',
                title: 'IKEA Tarzı 3B Oda Planlayıcı',
                desc: 'Müşteri kendi odasının en, derinlik, tavan yüksekliği, zemin parkesi ve duvar rengini girip birden fazla mobilyayı çarpışma kontrollü dizebilir.',
              },
              {
                no: '04',
                title: 'Fotoğraftan Saniyeler İçinde 3B',
                desc: 'CAD çizimi bulunmayan koleksiyonlar yalnızca birkaç ürün fotoğrafından dokulu 3B modele çevrilir ve aynı gün AR kataloğuna eklenir.',
              },
              {
                no: '05',
                title: 'Mağaza Etiketi & E-Ticaret QR',
                desc: 'Her ürün için oluşan QR kod mağaza fiyat etiketine basılır veya ürün sayfasına “Odanda Canlı Gör” butonu olarak tek bağlantıyla eklenir.',
              },
              {
                no: '06',
                title: 'Ölçü Kaynaklı İadeleri Azaltır',
                desc: 'Müşteri koltuğun veya masanın kapı açıklığına, halı düzenine ve duvar uzunluğuna uyduğunu canlı gördüğü için ağır nakliye iadeleri düşer.',
              },
            ].map((feat) => (
              <div
                key={feat.no}
                className="p-7 border-r border-b border-stone-300/80 bg-white flex flex-col justify-between gap-3"
              >
                <p className="text-xs font-mono text-[#9c7349]">{feat.no}</p>
                <div className="space-y-2">
                  <h3 className="font-display text-[15px] font-bold text-stone-950">{feat.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sektör Geri Bildirimleri (Kesintisiz Akan Yorum Nehri) */}
      <section id="yorumlar" className="bg-[#faf8f4] border-b border-stone-200 py-16 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#9c7349]">
              Sektör Geri Bildirimleri
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              Showroom ve proje stüdyolarından değerlendirmeler
            </h2>
          </div>
          <p className="text-xs text-stone-500">İnegöl · Masko · Modoko · Kayseri · Ankara Siteler</p>
        </div>

        <div className="relative overflow-hidden">
          <div className="animate-river-continuous gap-5 px-4">
            {[...SECTOR_REVIEWS, ...SECTOR_REVIEWS].map((rev, idx) => (
              <blockquote
                key={`${rev.name}-${idx}`}
                className="w-[320px] sm:w-[370px] shrink-0 border border-stone-200 bg-white p-6 flex flex-col justify-between gap-5"
              >
                <p className="text-xs sm:text-[13px] text-stone-700 leading-relaxed">
                  &ldquo;{rev.quote}&rdquo;
                </p>
                <footer className="pt-4 border-t border-stone-100">
                  <p className="text-xs font-bold text-stone-950">{rev.name}</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">{rev.role}</p>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* Bölüm 06: Entegrasyon & Kurumsal Pilot Talebi */}
      <section id="iletisim" className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-[#9c7349]">
                06 / Entegrasyon ve Kurumsal İletişim
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
                Ürün sayfanıza ve mağaza etiketlerinize tek bağlantıyla Canlı AR ekleyin
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Web sitenizdeki &ldquo;Odanda Canlı Gör&rdquo; butonu veya showroom etiketindeki QR
                kod doğrudan o ürünün 1:1 AR kamerasını açar. Mevcut{' '}
                <code className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 text-xs font-mono">
                  .GLB
                </code>
                ,{' '}
                <code className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 text-xs font-mono">
                  .OBJ
                </code>{' '}
                veya{' '}
                <code className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 text-xs font-mono">
                  .STL
                </code>{' '}
                dosyalarınızı hemen test edebilirsiniz.
              </p>
            </div>

            <div className="border border-stone-200 bg-[#faf8f4] p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                Örnek Canlı AR Entegrasyon Bağlantısı
              </p>
              <div className="flex items-center gap-2 bg-white border border-stone-200 px-3 py-2.5 text-xs font-mono text-stone-700 overflow-hidden">
                <span className="truncate flex-1">{embedSampleUrl}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(embedSampleUrl);
                    setCopiedEmbed(true);
                    setTimeout(() => setCopiedEmbed(false), 2000);
                  }}
                  className="shrink-0 text-stone-800 hover:text-stone-950 flex items-center gap-1 font-sans font-semibold"
                >
                  {copiedEmbed ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEmbed ? 'Kopyalandı' : 'Kopyala'}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('ai');
                  setShowBuilder(true);
                }}
                className="w-full py-3 border border-stone-950 bg-white hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold uppercase tracking-wider transition"
              >
                Kendi Ürününüzü 3B &amp; Canlı AR&apos;da Deneyin
              </button>
            </div>
          </div>

          {/* Sağ: 3 Alanlı Sade Kurumsal Pilot Formu */}
          <div className="lg:col-span-6 border border-stone-200 bg-[#faf8f4] p-6 sm:p-8">
            <div className="border-b border-stone-200 pb-4 mb-5">
              <h3 className="font-display text-lg font-bold text-stone-950">
                Mağazanız İçin Canlı AR Pilotu ve Özel Teklif İsteyin
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Koleksiyonunuzdan seçeceğiniz ürünleri 1:1 Canlı AR&apos;a alıp kendi showroom&apos;unuzda
                birlikte test edelim.
              </p>
            </div>

            {demoSubmitted ? (
              <div className="py-8 text-center space-y-3">
                <div className="w-10 h-10 mx-auto bg-stone-950 text-white flex items-center justify-center">
                  <Check className="w-5 h-5" />
                </div>
                <p className="font-display text-base font-bold text-stone-950">
                  Pilot talebiniz alındı
                </p>
                <p className="text-xs text-stone-600 max-w-sm mx-auto leading-relaxed">
                  <strong>{demoCompany}</strong> için Canlı AR ve 3B katalog pilot planlamasını en
                  kısa sürede <strong>{demoContact}</strong> üzerinden paylaşacağız.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDemoSubmitted(false);
                    setDemoCompany('');
                    setDemoContact('');
                    setDemoNote('');
                  }}
                  className="px-4 py-2 border border-stone-300 hover:border-stone-950 bg-white text-xs font-semibold text-stone-900"
                >
                  Yeni Talep Oluştur
                </button>
              </div>
            ) : (
              <form onSubmit={handleDemoSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1.5">
                    Firma / Mağaza Adı
                  </label>
                  <input
                    required
                    value={demoCompany}
                    onChange={(e) => setDemoCompany(e.target.value)}
                    placeholder="Örn: Yıldız Mobilya · İnegöl"
                    className="w-full px-3.5 py-2.5 bg-white border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1.5">
                    Telefon veya Kurumsal E-posta
                  </label>
                  <input
                    required
                    value={demoContact}
                    onChange={(e) => setDemoContact(e.target.value)}
                    placeholder="05XX XXX XX XX veya satis@firmaniz.com"
                    className="w-full px-3.5 py-2.5 bg-white border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1.5">
                    Koleksiyon / Şube Notu
                  </label>
                  <textarea
                    rows={3}
                    value={demoNote}
                    onChange={(e) => setDemoNote(e.target.value)}
                    placeholder="Örn: 2 showroom, koltuk ve yemek odası koleksiyonu; ürün fotoğraflarımız hazır."
                    className="w-full px-3.5 py-2.5 bg-white border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold uppercase tracking-wider transition"
                >
                  Ücretsiz Showroom Pilotu &amp; Teklif İste
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Kurumsal Footer */}
      <footer className="bg-[#0b0b0a] text-stone-400">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-9 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2.5 text-white">
            <span className="font-display font-bold tracking-tight">MekanAR</span>
            <span className="text-stone-600">·</span>
            <span className="text-stone-400">Mobilya Markaları İçin Canlı AR &amp; 3B Oda Planlama</span>
          </div>
          <div className="flex items-center gap-6 text-[11px]">
            <a href="#deneyim" className="hover:text-white transition">
              Deneyim
            </a>
            <a href="#vitrin" className="hover:text-white transition">
              3B Vitrin
            </a>
            <a href="#planlayici" className="hover:text-white transition">
              Planlayıcı
            </a>
            <a href="#katalog" className="hover:text-white transition">
              Katalog
            </a>
            <a href="#iletisim" className="hover:text-white transition">
              İletişim
            </a>
          </div>
        </div>
      </footer>

      {/* Mobil Hızlı Erişim Çubuğu (MobileQuickBar) */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-stone-200 px-3 py-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setActiveState({
              product: stageProduct,
              mode: 'planner',
              studioPreset: 'living',
            })
          }
          className="flex-1 py-2.5 text-center border border-stone-300 text-stone-950 text-xs font-bold whitespace-nowrap"
        >
          3B Planlayıcı
        </button>
        <button
          type="button"
          onClick={() =>
            setActiveState({
              product: stageProduct,
              mode: 'ar',
            })
          }
          className="flex-1 py-2.5 bg-stone-950 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Canlı AR&apos;da Gör</span>
        </button>
      </div>

      {/* QR Kod Modalı */}
      {qrFor && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setQrFor(null)}
        >
          <div
            className="bg-white border border-stone-200 p-6 max-w-sm w-full text-center space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-left min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#9c7349]">
                  {getOrientationGuide(qrFor.dimensionsCm) === 'landscape'
                    ? 'AR Kadrajı: DİKEY · 2.5–3 m Geriden'
                    : 'AR Kadrajı: DİKEY · 1.5–2 m Mesafe'}
                </p>
                <h3 className="font-display text-sm font-bold truncate text-stone-950">
                  {qrFor.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQrFor(null)}
                aria-label="Kapat"
                className="shrink-0 text-stone-500 hover:text-stone-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 border border-stone-200 p-1 gap-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setQrMode('ar')}
                className={`py-2 transition ${
                  qrMode === 'ar' ? 'bg-stone-950 text-white' : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                Canlı AR (Kamera)
              </button>
              <button
                type="button"
                onClick={() => setQrMode('planner')}
                className={`py-2 transition ${
                  qrMode === 'planner'
                    ? 'bg-stone-950 text-white'
                    : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                3B Oda Planlayıcı
              </button>
            </div>
            <div className="inline-block p-3 border-2 border-stone-950 bg-white">
              <QRCodeSVG value={qrUrl(qrFor, qrMode)} size={216} />
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              {qrMode === 'ar'
                ? getOrientationGuide(qrFor.dimensionsCm) === 'landscape'
                  ? 'Telefon kamerasıyla okutun; telefonu DİKEY tutup 2.5–3 m geriden aydınlık zemine yerleştirin (Android’de canlı ayak/ölçek tuşları için Chrome kullanın).'
                  : 'Telefon kamerasıyla okutun; telefonu DİKEY tutup 1.5–2 m mesafeden aydınlık zemine yerleştirin.'
                : 'Telefon kamerasıyla okutun ve ürünü 3B Oda Planlayıcıda diğer eşyalarla düzenleyin.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setActiveState({ product: qrFor, mode: qrMode, studioPreset: 'living' });
                setQrFor(null);
              }}
              className="w-full py-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition"
            >
              Bu Cihazda Aç
            </button>
          </div>
        </div>
      )}

      {/* Fotoğraftan AI 3B & CAD Ürün Oluşturucu Modalı */}
      {showBuilder && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111110] text-white border border-stone-800 max-w-md w-full p-5 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold">
                  Yeni 1:1 AR Ürünü Oluştur (AI veya CAD)
                </h3>
                <p className="text-[11px] text-stone-400">
                  Gerçek santimetre ölçülü ve y=0 zemin hizalı .GLB üretip anında Canlı AR&apos;da açar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBuilder(false)}
                aria-label="Kapat"
                className="text-stone-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 border-b border-stone-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('ai');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'ai'
                    ? 'border-[#c9a277] text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200'
                }`}
              >
                Fotoğraftan 3B Üret (AI)
              </button>
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('cad');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'cad'
                    ? 'border-[#c9a277] text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200'
                }`}
              >
                CAD Yükle (.GLB/.OBJ)
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-stone-900 border border-stone-800 text-[11px]">
                <span className="flex items-center gap-1.5 text-stone-300">
                  <HardDrive className="w-3.5 h-3.5 text-[#c9a277] shrink-0" />
                  <span>
                    {storageCfg.configured
                      ? `Kalıcı Kayıt Aktif · ${storageCfg.providerLabel}`
                      : 'Kalıcı Depo Bağlı Değil (Oturum İçi Önizleme)'}
                  </span>
                </span>
                {!storageCfg.configured && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowBuilder(false);
                      setShowServer(true);
                    }}
                    className="underline text-[#e0c09a] font-semibold shrink-0"
                  >
                    Bağla
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-300 mb-1">Ürün Adı</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Örn: Milano 3’lü Koltuk"
                  className="w-full px-3 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                />
              </div>

              {builderTab === 'cad' ? (
                <>
                  <div>
                    <label className="block text-[11px] text-stone-400 mb-1">
                      Hedef Genişlik (cm) — boş bırakılırsa dosyadaki ölçü korunur
                    </label>
                    <input
                      type="number"
                      value={cadWidthCm}
                      onChange={(e) => setCadWidthCm(e.target.value)}
                      placeholder="Örn: 210"
                      className="w-full px-3 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cadZUp}
                      onChange={(e) => setCadZUp(e.target.checked)}
                      className="border-stone-700 bg-stone-900"
                    />
                    <span>Z-yukarı CAD eksenini dikleştir (3ds Max / SolidWorks)</span>
                  </label>

                  <label className="h-28 border border-dashed border-stone-700 hover:border-stone-400 bg-stone-900 flex flex-col items-center justify-center cursor-pointer px-4 text-center transition">
                    <Upload className="w-5 h-5 text-stone-400 mb-1.5" />
                    <span className="text-xs font-semibold text-stone-200">
                      {cadFile ? cadFile.name : 'CAD Dosyası Seç (.glb, .gltf, .obj, .stl, .fbx)'}
                    </span>
                    <span className="text-[10px] text-stone-400 mt-0.5">
                      AutoCAD / 3ds Max (.fbx, .obj) ve .glb dosyaları anında 1:1 AR-hazır olur
                    </span>
                    <input
                      type="file"
                      accept=".glb,.gltf,.obj,.stl,.fbx"
                      className="hidden"
                      onChange={(e) => setCadFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleCadUpload}
                    disabled={generating || !cadFile}
                    className="w-full py-3 bg-white hover:bg-stone-200 text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 transition"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? 'Dönüştürülüyor...' : '1:1 Dönüştür ve Canlı AR Aç'}</span>
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[11px] text-stone-400 mb-1">
                      3B Yapay Zekâ Motoru
                    </label>
                    <select
                      value={aiEngineChoice}
                      onChange={(e) => setAiEngineChoice(e.target.value as ActiveAiEngine)}
                      className="w-full px-3 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                    >
                      <option value="runpod">RunPod Serverless · Hunyuan3D 2.1 Full PBR (2K · Önerilen)</option>
                      <option value="trellis">fal.ai · TRELLIS Çok-Açılı</option>
                      <option value="hunyuan">fal.ai · Hunyuan3D v2 PBR</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-stone-400 mb-1">En (cm)</label>
                      <input
                        type="number"
                        value={newW}
                        onChange={(e) => setNewW(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-400 mb-1">Derinlik (cm)</label>
                      <input
                        type="number"
                        value={newD}
                        onChange={(e) => setNewD(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-stone-400 mb-1">Yükseklik (cm)</label>
                      <input
                        type="number"
                        value={newH}
                        onChange={(e) => setNewH(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-stone-900 border border-stone-800 text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: 'front', label: '1. Önden Fotoğraf *' },
                        { key: 'back', label: '2. Arkadan (Ops.)' },
                        { key: 'left', label: '3. Sol Yan (Ops.)' },
                        { key: 'right', label: '4. Sağ Yan (Ops.)' },
                      ] as const
                    ).map((s) => (
                      <label
                        key={s.key}
                        className="h-24 border border-dashed border-stone-700 hover:border-stone-400 bg-stone-900 flex flex-col items-center justify-center cursor-pointer overflow-hidden"
                      >
                        {slots[s.key] ? (
                          <img src={slots[s.key]!} alt={s.label} className="w-full h-full object-contain p-1" />
                        ) : (
                          <div className="text-center px-2">
                            <Upload className="w-4 h-4 text-stone-400 mx-auto mb-1" />
                            <span className="text-[10px] text-stone-400 block">{s.label}</span>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const processed = await preprocessPhotoFor3D(f);
                            setSlots((prev) => ({ ...prev, [s.key]: processed }));
                          }}
                        />
                      </label>
                    ))}
                  </div>

                  {!selectedAiReady && (
                    <div className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-800/70 p-2.5 space-y-1.5">
                      <p>
                        {aiEngineChoice === 'runpod'
                          ? 'RunPod Serverless bağlantısı yapılandırılmamış.'
                          : 'fal.ai API anahtarı henüz girilmemiş.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowBuilder(false);
                          setShowServer(true);
                        }}
                        className="underline font-bold text-white"
                      >
                        Motor Ayarlarını Aç →
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleGenerate3D}
                    disabled={generating || !slots.front || !selectedAiReady}
                    className="w-full py-3 bg-white text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? '3B Model Üretiliyor...' : '1:1 3B Üret ve Canlı AR Aç'}</span>
                  </button>
                </>
              )}

              {genMsg && (
                <p className="text-xs text-stone-300 bg-stone-900 p-2.5 border border-stone-800">
                  {genMsg}
                </p>
              )}
              {generatedGlb && (
                <a
                  href={generatedGlb.url}
                  download={generatedGlb.filename}
                  className="w-full py-2.5 bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>1:1 .GLB Dosyasını İndir</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Yönetici 3B GPU Motoru Ayarları Modalı */}
      {showServer && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setShowServer(false)}
        >
          <div
            className="bg-white border border-stone-200 p-5 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 pb-3">
              <h3 className="font-display text-sm font-bold flex items-center gap-2 text-stone-950">
                <Server className="w-4 h-4" /> 3B Üretim &amp; Kalıcı Depo Ayarları
              </h3>
              <button type="button" onClick={() => setShowServer(false)} aria-label="Kapat">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 border border-stone-950 p-3.5 bg-[#faf8f4]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-950 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>0) Kalıcı Dosya Deposu (GPU Kullanmaz)</span>
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 border ${
                    storageCfg.configured
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-white text-stone-600'
                  }`}
                >
                  {storageCfg.configured
                    ? storageCfg.provider === 'r2'
                      ? 'R2 Aktif'
                      : 'Blob Aktif'
                    : 'Bağlı Değil'}
                </span>
              </div>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                Üretilen 3B model buraya <strong>yalnızca 1 kez</strong> kaydedilir. Tüm müşteriler
                QR kodla doğrudan buradan indirip telefonun kendi AR özelliğiyle görüntüler; RunPod
                hiç çalışmaz.
              </p>
              <div className="p-2.5 bg-white border border-stone-200 text-[10.5px] text-stone-700 space-y-1 font-mono leading-relaxed">
                <p className="font-sans font-bold text-stone-950 text-[11px]">
                  Vercel Ortam Değişkenleri (İkisinden Biri Yeterli):
                </p>
                <p className="text-stone-800">
                  Cloudflare R2 (Önerilen): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
                  R2_BUCKET_NAME, R2_PUBLIC_URL
                </p>
                <p className="text-stone-500">
                  veya Vercel Blob (2 Tık): BLOB_READ_WRITE_TOKEN
                </p>
              </div>
              {storageCfg.requiresPin && (
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Yönetici Depolama PIN Kodu (STORAGE_ADMIN_PIN)
                  </label>
                  <input
                    type="password"
                    value={cfgAdminPin}
                    onChange={(e) => setCfgAdminPin(e.target.value)}
                    placeholder="Yükleme ve silme için yönetici PIN"
                    className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3 border border-stone-950 p-3.5 bg-[#faf8f4]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-950">
                  1) RunPod Serverless Flex (Hunyuan3D 2.1 Full PBR · 2K)
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 border ${
                    runpod3dReady
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-white text-stone-600'
                  }`}
                >
                  {server3dCfg.runpod3dConfigured
                    ? 'Vercel Env Aktif'
                    : memberState.runpod3dEndpointId
                    ? 'Bağlı'
                    : 'Kapalı'}
                </span>
              </div>

              <div className="p-2.5 bg-white border border-stone-200 text-[11px] text-stone-700 space-y-1 leading-relaxed">
                <p className="font-bold text-stone-950">RunPod Endpoint İmajı &amp; Ölçek Ayarı:</p>
                <p className="font-mono text-[10px] text-stone-700 break-all">
                  ghcr.io/coskunerberke/mobilya-ar-worker:ar3d
                </p>
                <p className="font-mono text-[10px] text-stone-500">
                  Active Workers: 0 · Max Workers: 2 · Idle Timeout: 5 sn · FlashBoot: Açık
                </p>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    RunPod GPU Sınıfı
                  </label>
                  <select
                    value={cfgRpTier}
                    onChange={(e) => setCfgRpTier(e.target.value as RunpodGpuTierId)}
                    className="w-full px-3 py-2 bg-white border border-stone-300 text-xs"
                  >
                    {Object.values(RUNPOD_GPU_TIERS).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.consoleName} ({t.cards})
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  value={cfgRpEp}
                  onChange={(e) => setCfgRpEp(e.target.value)}
                  placeholder="Endpoint ID (boşsa Vercel RUNPOD_ENDPOINT_ID kullanılır)"
                  className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
                />
                <input
                  type="password"
                  value={cfgRpKey}
                  onChange={(e) => setCfgRpKey(e.target.value)}
                  placeholder="RUNPOD_API_KEY (rpa_...)"
                  className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-2.5 border border-stone-200 p-3.5 bg-[#faf8f4]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-950">2) Opsiyonel Harici API · fal.ai</span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 border ${
                    falReady
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-white text-stone-600'
                  }`}
                >
                  {server3dCfg.falConfigured ? 'Vercel Env Aktif' : memberState.falApiKey ? 'Bağlı' : 'Opsiyonel'}
                </span>
              </div>
              <input
                type="password"
                value={cfgFalKey}
                onChange={(e) => setCfgFalKey(e.target.value)}
                placeholder="FAL_KEY (fal_...)"
                className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                Varsayılan Fotoğraftan 3B Motoru
              </label>
              <select
                value={cfgEngine}
                onChange={(e) => setCfgEngine(e.target.value as ActiveAiEngine)}
                className="w-full px-3 py-2 bg-white border border-stone-300 text-xs"
              >
                <option value="runpod">RunPod Serverless · Hunyuan3D 2.1 Full PBR (2K)</option>
                <option value="trellis">fal.ai · TRELLIS</option>
                <option value="hunyuan">fal.ai · Hunyuan3D v2</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                saveStoragePin(cfgAdminPin);
                const next = update3DEngineCredentials({
                  falApiKey: cfgFalKey,
                  runpod3dEndpointId: cfgRpEp,
                  runpodApiKey: cfgRpKey,
                  runpodGpuTier: cfgRpTier,
                  preferredAiEngine: cfgEngine,
                });
                setMemberState(next);
                setAiEngineChoice(next.preferredAiEngine);
                setShowServer(false);
              }}
              className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold"
            >
              Ayarları Kaydet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
