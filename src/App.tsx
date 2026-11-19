import React, { useCallback, useEffect, useState } from 'react';
import '@google/model-viewer';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  Layers,
  Loader2,
  Plus,
  QrCode,
  Server,
  Upload,
  X,
} from 'lucide-react';
import { PRODUCTS, findProduct, type Product } from './lib/products';
import {
  buildShareUrl,
  checkHealth,
  generateProduct3D,
  getPodId,
  getPublicOrigin,
  getServerUrl,
  setServerPod,
  uploadCustomGlb,
  type ServerHealth,
} from './lib/server';
import { convertCadFileToGlb } from './lib/cadImport';
import { DEMO_STUDIO_PRESETS, type DemoStudioPresetId } from './lib/demoRooms';
import {
  DEALER_PLANS,
  GPU_TIERS,
  getActivePlan,
  getMembershipState,
  resetCustomerTrials,
  setDealerPlan,
  updateRunpodCredentials,
  type GpuTierId,
  type MembershipState,
} from './lib/membership';
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
        resolve(c.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
      'Müşteriler mağazada beğendikleri köşe takımının evlerindeki kapı açıklığına ve halı düzenine sığıp sığmayacağından emin olamıyordu. Etiketlere eklediğimiz QR ile karar süreci yarı yarıya kısaldı.',
  },
  {
    name: 'Selin Demirtaş',
    role: 'İç Mimar · Modoko Proje Stüdyosu',
    quote:
      'Özel üretim .OBJ ve .GLB modellerimizi hiçbir ek yazılım olmadan tarayıcıya sürükleyip müşterinin kendi çektiği odasında 1:1 ölçüsünde sunabilmek sunum kalitemizi çok yukarı taşıdı.',
  },
  {
    name: 'Hakan Karaca',
    role: 'E-Ticaret Müdürü · Masko Mobilya',
    quote:
      'Uygulama indirme zorunluluğu olmadığı için internet sitemizdeki ürün sayfasından doğrudan açılıyor. Yanlış ölçü kaynaklı ağır nakliye iadelerimizde belirgin düşüş gördük.',
  },
  {
    name: 'Burcu Arslan',
    role: 'Showroom Direktörü · Ankara Siteler',
    quote:
      'Müşteri kendi salonunun kısa bir videosunu yükleyip mevcut eşyalarının yanında yeni koltuğun duruşunu ve kumaş renklerini gördüğünde satış masasında çok daha rahat karar veriyor.',
  },
  {
    name: 'Mert Özkan',
    role: 'İhracat Sorumlusu · Kayseri Mobilya Grubu',
    quote:
      'Avrupa ve Orta Doğu bayilerimizle yaptığımız online katalog görüşmelerinde tüm 3B koleksiyonumuzu gerçek santimetre ölçüsüyle canlı gösterebilmek büyük güven veriyor.',
  },
  {
    name: 'Deniz Aksoy',
    role: 'Kurucu Ortak · İzmir Tasarım Atölyesi',
    quote:
      'Sadece ev salonları değil; kafe, ofis ve balkon projelerinde de mekânı birebir tarayıp oturma düzenini müşteriye anında gösterebiliyoruz.',
  },
];

type ActiveViewState = {
  product: Product;
  mode: 'preview' | 'studio';
  studioPreset?: DemoStudioPresetId;
  colorHex?: string;
};

export function App() {
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [serverUrl, setServerUrl] = useState(getServerUrl);
  const [health, setHealth] = useState<ServerHealth>({ online: false });
  const [heroProductId, setHeroProductId] = useState<string>('ikea-landskrona-sofa');

  const [activeState, setActiveState] = useState<ActiveViewState | null>(() => {
    const q = new URLSearchParams(window.location.search);
    const glb = q.get('glb');
    const urun = q.get('urun');
    const mod = q.get('mod');
    const oda = q.get('oda');
    const renk = q.get('renk') || undefined;
    const startMode: 'preview' | 'studio' =
      mod === 'studio' || mod === 'photo' ? 'studio' : 'preview';
    const studioPreset = oda === 'living' || oda === 'bedroom' || oda === 'grand' ? oda : undefined;

    if (glb) {
      return {
        product: {
          id: urun || 'custom',
          name: q.get('name') || 'Mağaza Ürünü',
          category: 'Özel Üretim',
          dimensionsCm: q.get('dim') || 'Gerçek Ölçü',
          glbUrl: glb,
          source: 'ozel-cad',
        },
        mode: startMode,
        studioPreset,
        colorHex: renk,
      };
    }
    const found = findProduct(urun);
    if (found || mod === 'photo' || mod === 'studio') {
      return {
        product: found || PRODUCTS[0],
        mode: startMode,
        studioPreset,
        colorHex: renk,
      };
    }
    return null;
  });

  const [qrFor, setQrFor] = useState<Product | null>(null);
  const [qrMode, setQrMode] = useState<'studio' | 'preview'>('studio');
  const [showServer, setShowServer] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderTab, setBuilderTab] = useState<'cad' | 'ai'>('cad');
  const [filterTab, setFilterTab] = useState<
    'all' | 'seating' | 'table-chair' | 'storage-bed' | 'ikea-cad' | 'studyo-cad'
  >('all');
  const [podInput, setPodInput] = useState(() => getPodId(getServerUrl()));
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [showEconomics, setShowEconomics] = useState(false);

  // Kurumsal Demo Talep Formu
  const [demoCompany, setDemoCompany] = useState('');
  const [demoContact, setDemoContact] = useState('');
  const [demoNote, setDemoNote] = useState('');
  const [demoSubmitted, setDemoSubmitted] = useState(false);

  // B2B Üyelik, Deneme Limiti & RunPod Serverless Ayarları
  const [memberState, setMemberState] = useState<MembershipState>(() => getMembershipState());
  const [serverScanReady, setServerScanReady] = useState(false);
  const [rpEndpoint, setRpEndpoint] = useState(() => getMembershipState().runpodEndpointId);
  const [rpApiKey, setRpApiKey] = useState(() => getMembershipState().runpodApiKey);
  const [rpTier, setRpTier] = useState<GpuTierId>(() => getMembershipState().gpuTier);
  const [calcTier, setCalcTier] = useState<GpuTierId>('L40S');
  const [calcSec, setCalcSec] = useState(25);
  const [calcMonthlyScans, setCalcMonthlyScans] = useState(600);

  // CAD Upload Modal State
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [cadWidthCm, setCadWidthCm] = useState('');
  const [cadZUp, setCadZUp] = useState(false);

  // 3D Builder Modal State
  const [slots, setSlots] = useState<{
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
  }>({ front: null, back: null, left: null, right: null });
  const [newName, setNewName] = useState('');
  const [newW, setNewW] = useState('210');
  const [newD, setNewD] = useState('90');
  const [newH, setNewH] = useState('82');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [generatedGlb, setGeneratedGlb] = useState<{ url: string; filename: string } | null>(null);

  const refresh = useCallback(async () => setHealth(await checkHealth(serverUrl)), [serverUrl]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const st = getMembershipState();
    setMemberState(st);
    setRpEndpoint(st.runpodEndpointId);
    setRpApiKey(st.runpodApiKey);
    setRpTier(st.gpuTier);
    fetch('/api/scan?action=config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { serverConfigured?: boolean } | null) => {
        if (d?.serverConfigured) setServerScanReady(true);
      })
      .catch(() => {});
  }, [activeState, showServer]);

  useEffect(() => {
    if (!activeState) {
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }
    const share = buildShareUrl({
      productId: activeState.product.id,
      glbUrl: activeState.product.glbUrl,
      productName: activeState.product.name,
      dimensionsCm: activeState.product.dimensionsCm,
      mode: activeState.mode,
      oda: activeState.studioPreset,
      colorHex: activeState.colorHex,
      serverOnline: health.online,
      serverUrl,
    });
    const nextSearch = new URL(share).search;
    if (window.location.search !== nextSearch) {
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
    }
  }, [activeState, health.online, serverUrl]);

  const qrUrl = (p: Product, mode: 'studio' | 'preview' = 'studio') =>
    buildShareUrl({
      productId: p.id,
      glbUrl: p.glbUrl,
      productName: p.name,
      dimensionsCm: p.dimensionsCm,
      mode,
      serverOnline: health.online,
      serverUrl,
    });

  const handleGenerate3D = async () => {
    if (!slots.front) return;
    setGenerating(true);
    setGenMsg('GPU üzerinde 3B model ve gerçek ölçülü PBR dokular üretiliyor...');
    try {
      const w = parseFloat(newW) || 200;
      const d = parseFloat(newD) || 90;
      const h = parseFloat(newH) || 82;
      const cleanName = newName.trim() || 'Özel Mağaza Ürünü';
      const res = await generateProduct3D(serverUrl, {
        images: {
          front: slots.front,
          back: slots.back,
          left: slots.left,
          right: slots.right,
        },
        name: cleanName,
        width_cm: w,
        depth_cm: d,
        height_cm: h,
      });

      const created: Product = {
        id: `rp-${Date.now()}`,
        name: cleanName,
        category: 'Özel Üretim',
        dimensionsCm: `${w} × ${d} × ${h} cm`,
        glbUrl: res.glbUrl,
        source: 'ozel-cad',
      };
      setProducts((prev) => [created, ...prev]);
      setGeneratedGlb({ url: res.glbUrl, filename: res.filename });
      setGenMsg(`Tamamlandı (${res.elapsedSec} sn). Vitrine eklendi.`);
      setShowBuilder(false);
      setQrFor(created);
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : 'Üretim hatası');
    } finally {
      setGenerating(false);
    }
  };

  const handleCadUpload = async () => {
    if (!cadFile) return;
    setGenerating(true);
    setGenMsg('CAD dosyası metreye çevriliyor, taban y=0 hizalanıp .GLB paketleniyor...');
    try {
      const wVal = parseFloat(cadWidthCm);
      const converted = await convertCadFileToGlb(cadFile, {
        targetWidthCm: Number.isFinite(wVal) && wVal > 1 ? wVal : undefined,
        zUp: cadZUp,
      });
      const fallbackName = cadFile.name.replace(/\.[^.]+$/, '');
      const cleanName = newName.trim() || fallbackName || 'Özel CAD Ürün';

      if (health.online) {
        setGenMsg(`Sunucuya yükleniyor (${converted.dimensionsCm})...`);
        const uploaded = await uploadCustomGlb(serverUrl, cleanName, converted.glbBuffer);
        const created: Product = {
          id: `cad-${Date.now()}`,
          name: cleanName,
          category: 'Özel CAD',
          dimensionsCm: converted.dimensionsCm,
          glbUrl: uploaded.glbUrl,
          source: 'ozel-cad',
        };
        setProducts((prev) => [created, ...prev]);
        setGeneratedGlb({ url: uploaded.glbUrl, filename: uploaded.filename });
        setGenMsg(`Hazır (${uploaded.sizeKB} KB). QR kodu oluşturuldu.`);
        setShowBuilder(false);
        setQrFor(created);
      } else {
        const blobUrl = URL.createObjectURL(new Blob([converted.glbBuffer], { type: 'model/gltf-binary' }));
        const created: Product = {
          id: `cad-local-${Date.now()}`,
          name: cleanName,
          category: 'Özel CAD',
          dimensionsCm: converted.dimensionsCm,
          glbUrl: blobUrl,
          source: 'ozel-cad',
        };
        setProducts((prev) => [created, ...prev]);
        setGeneratedGlb({ url: blobUrl, filename: `${cleanName}.glb` });
        setShowBuilder(false);
        setActiveState({ product: created, mode: 'preview' });
      }
    } catch (e) {
      setGenMsg(e instanceof Error ? e.message : 'CAD dönüştürme hatası');
    } finally {
      setGenerating(false);
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
    'ikea-uppland-sofa',
    'ikea-strandmon-chair',
    'ikea-stockholm-coffee',
  ];
  const featuredProducts = featuredIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
  const heroProduct = products.find((p) => p.id === heroProductId) || products[0];

  const embedSampleUrl = `${getPublicOrigin()}/?urun=ikea-landskrona-sofa&mod=studio`;
  const activePlan = getActivePlan(memberState);
  const runpodConnected =
    serverScanReady || Boolean(memberState.runpodEndpointId && memberState.runpodApiKey);
  const remainingTrials = Math.max(0, activePlan.perCustomerLimit - memberState.customerUsedScans);
  const calcScanUsd = GPU_TIERS[calcTier].ratePerSecUsd * calcSec;
  const calcMonthlyUsd = calcScanUsd * calcMonthlyScans;

  if (activeState) {
    return (
      <ProductPage
        product={activeState.product}
        products={products}
        serverUrl={serverUrl}
        serverOnline={health.online}
        startMode={activeState.mode}
        initialStudioPreset={activeState.studioPreset}
        initialColorHex={activeState.colorHex}
        onOpenServerSettings={() => {
          setActiveState(null);
          setShowServer(true);
        }}
        onBack={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setActiveState(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] text-stone-950 overflow-x-hidden pb-16 md:pb-0">
      {/* Üst Menü — Kusursuz Tek Satır & Mimari Kurumsal */}
      <header className="h-16 border-b border-stone-200/90 px-4 lg:px-10 flex items-center justify-between gap-4 sticky top-0 bg-[#faf9f6]/95 backdrop-blur-md z-30">
        <a href="#" className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-stone-950"
            aria-hidden="true"
          >
            <path d="M12 2L21 7V17L12 22L3 17V7L12 2Z" stroke="currentColor" strokeWidth="1.75" />
            <path d="M12 22V12M12 12L21 7M12 12L3 7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 7.5L16 9.8V14.2L12 16.5L8 14.2V9.8L12 7.5Z" fill="currentColor" />
          </svg>
          <span className="font-display text-sm sm:text-[15px] font-extrabold tracking-tight text-stone-950">
            MekanAR
          </span>
          <span className="hidden sm:inline-block h-3.5 w-px bg-stone-300" />
          <span className="hidden sm:inline text-[11px] font-medium text-stone-500 tracking-wide">
            Odanda Gör
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-8 text-xs font-medium text-stone-600">
          <a href="#mekanlar" className="hover:text-stone-950 transition whitespace-nowrap">
            Mekânlar
          </a>
          <a href="#katalog" className="hover:text-stone-950 transition whitespace-nowrap">
            Katalog
          </a>
          <a href="#ozellikler" className="hover:text-stone-950 transition whitespace-nowrap">
            Özellikler
          </a>
          <a href="#yorumlar" className="hover:text-stone-950 transition whitespace-nowrap">
            Yorumlar
          </a>
          <a href="#paketler" className="hover:text-stone-950 transition whitespace-nowrap">
            Paketler
          </a>
          <a href="#iletisim" className="hover:text-stone-950 transition whitespace-nowrap">
            İletişim
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setGenMsg(null);
              setBuilderTab('cad');
              setShowBuilder(true);
            }}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 border border-stone-300 hover:border-stone-950 bg-white text-stone-900 text-xs font-semibold transition whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>CAD Yükle</span>
          </button>

          <button
            onClick={() =>
              setActiveState({
                product: heroProduct,
                mode: 'studio',
              })
            }
            className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-950 hover:bg-stone-800 text-white text-xs font-semibold transition whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Mekânını Tara</span>
          </button>

          <button
            onClick={() => setShowServer(true)}
            className="relative p-2 border border-stone-200 hover:border-stone-400 bg-white text-stone-500 hover:text-stone-950 transition shrink-0"
            aria-label="Sistem Ayarları"
            title={runpodConnected ? 'Bulut 3B Motoru Aktif' : 'Bulut 3B Motoru Ayarları'}
          >
            <Server className="w-3.5 h-3.5" />
            {(health.online || runpodConnected) && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600" />
            )}
          </button>
        </div>
      </header>

      {/* Mimari Hero — Koyu Showroom Zemini + Gerçek Galeri Fotoğrafı + Canlı 3B Vitrin */}
      <section className="relative bg-[#111110] text-white border-b border-stone-800 overflow-hidden">
        <img
          src="/rooms/room-oak.jpg"
          alt="Mimari galeri salonu"
          className="absolute inset-0 w-full h-full object-cover opacity-20 scale-[1.01] pointer-events-none select-none"
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(105deg, rgba(14,14,13,0.96) 0%, rgba(17,17,16,0.88) 54%, rgba(17,17,16,0.72) 100%)',
          }}
        />

        <div className="relative max-w-6xl mx-auto px-4 lg:px-10 py-14 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-stone-400">
              Mobilya Markaları ve Showroom&apos;lar İçin 3B Mekân Platformu
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[46px] font-bold tracking-tight text-white leading-[1.1]">
              Müşteriniz mobilyayı satın almadan kendi gerçek mekânında 1:1 görsün.
            </h1>
            <p className="text-sm sm:text-[15px] text-stone-300 leading-relaxed max-w-xl">
              Uygulama indirmeden yalnızca akıllı telefon tarayıcısı ve QR kod ile çalışır. Kısa bir
              mekân videosundan birebir 3B alan çıkarır; ürünlerinizi mevcut eşyalarla çarpışma
              kontrollü ve gerçek santimetre ölçüsüyle yerleştirir.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() =>
                  setActiveState({
                    product: heroProduct,
                    mode: 'studio',
                  })
                }
                className="px-6 py-3.5 bg-white hover:bg-stone-200 text-stone-950 text-xs sm:text-sm font-bold tracking-wide flex items-center gap-2 transition whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Kendi Mekânını Tara</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() =>
                  setActiveState({
                    product: heroProduct,
                    mode: 'studio',
                    studioPreset: 'living',
                  })
                }
                className="px-5 py-3.5 border border-stone-500 hover:border-white text-white hover:bg-white/5 text-xs sm:text-sm font-semibold tracking-wide flex items-center gap-2 transition whitespace-nowrap shrink-0"
              >
                <Layers className="w-4 h-4" />
                <span>Hazır 3B Salonda Dene</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-5 pt-7 border-t border-stone-800">
              <div>
                <p className="text-[11px] font-mono text-stone-500">01</p>
                <p className="text-xs font-semibold text-white mt-1">1:1 Metrik Ölçek</p>
                <p className="text-[11px] text-stone-400 mt-0.5">Birebir santimetre CAD uyumu</p>
              </div>
              <div>
                <p className="text-[11px] font-mono text-stone-500">02</p>
                <p className="text-xs font-semibold text-white mt-1">Her Mekânda Çalışır</p>
                <p className="text-[11px] text-stone-400 mt-0.5">Ev, ofis, kafe veya balkon</p>
              </div>
              <div>
                <p className="text-[11px] font-mono text-stone-500">03</p>
                <p className="text-xs font-semibold text-white mt-1">Sıfır Kurulum · QR</p>
                <p className="text-[11px] text-stone-400 mt-0.5">Safari ve Chrome&apos;da anında</p>
              </div>
            </div>
          </div>

          {/* Sağ: Canlı İnteraktif 3B Ürün Sahnesi */}
          <div className="lg:col-span-6 border border-stone-700/80 bg-[#faf9f6] text-stone-950 shadow-2xl">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-2 overflow-x-auto bg-white">
              <div className="flex items-center gap-1.5">
                {featuredProducts.map((fp) => {
                  const active = fp.id === heroProduct.id;
                  const shortTitle = fp.name.split(' ')[0];
                  return (
                    <button
                      key={fp.id}
                      onClick={() => setHeroProductId(fp.id)}
                      className={`px-2.5 py-1 text-[11px] font-semibold border whitespace-nowrap transition ${
                        active
                          ? 'border-stone-950 bg-stone-950 text-white'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-950'
                      }`}
                    >
                      {shortTitle}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] font-mono text-stone-500 whitespace-nowrap shrink-0">
                {heroProduct.dimensionsCm}
              </span>
            </div>

            <div className="h-72 sm:h-80 lg:h-[340px] bg-gradient-to-b from-[#f3f1ec] to-[#e9e6df] relative">
              {/* @ts-expect-error model-viewer web component */}
              <model-viewer
                src={heroProduct.glbUrl}
                alt={heroProduct.name}
                camera-controls
                auto-rotate
                interaction-prompt="none"
                shadow-intensity="1"
                environment-image="neutral"
                camera-orbit="25deg 75deg auto"
                style={{ width: '100%', height: '100%' }}
              />
              <span className="absolute bottom-3 left-4 text-[10px] font-mono uppercase tracking-wider text-stone-500 pointer-events-none">
                360° Sürükle ve İncele
              </span>
            </div>

            <div className="p-4 border-t border-stone-200 bg-white flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                  {heroProduct.category} · 1:1 CAD Modeli
                </p>
                <p className="text-sm font-bold text-stone-950 truncate mt-0.5">{heroProduct.name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setQrFor(heroProduct)}
                  className="p-2.5 border border-stone-300 hover:border-stone-950 text-stone-700 hover:text-stone-950 transition"
                  title="Telefonda QR ile aç"
                  aria-label="QR Kod"
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <button
                  onClick={() =>
                    setActiveState({
                      product: heroProduct,
                      mode: 'studio',
                    })
                  }
                  className="px-4 py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold whitespace-nowrap transition"
                >
                  Mekânda Dene
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bölüm 01: Hazır Mimari 3B Stüdyolar & Gerçek Mekân Tarayıcı */}
      <section id="mekanlar" className="max-w-6xl mx-auto px-4 lg:px-10 py-16 border-b border-stone-200">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
              01 / Canlı 3B Mekân Deneyimi
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              İster kendi gerçek mekânınızı tarayın, ister hazır salonlarda deneyin
            </h2>
          </div>
          <button
            onClick={() =>
              setActiveState({
                product: heroProduct,
                mode: 'studio',
              })
            }
            className="px-4 py-2.5 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition whitespace-nowrap shrink-0 self-start md:self-auto"
          >
            Gerçek Video / Fotoğraf Yükle →
          </button>
        </div>

        {/* Gerçek Fotoğraflı 3 Hazır Mimari Stüdyo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {DEMO_STUDIO_PRESETS.map((preset, idx) => (
            <article
              key={preset.id}
              className="group border border-stone-200 bg-white flex flex-col overflow-hidden transition hover:border-stone-400"
            >
              <div className="aspect-[16/10] bg-stone-100 overflow-hidden relative border-b border-stone-200">
                <img
                  src={PRESET_ROOM_IMAGES[preset.id]}
                  alt={preset.title}
                  loading="lazy"
                  className="w-full h-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
                <span className="absolute bottom-2.5 right-2.5 bg-stone-950/85 text-white text-[10px] font-mono px-2 py-1">
                  {preset.dimensionsLabel}
                </span>
              </div>
              <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-mono text-stone-400">
                    {String(idx + 1).padStart(2, '0')} / HAZIR 3B STÜDYO
                  </p>
                  <h3 className="font-display text-base font-bold text-stone-950">{preset.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{preset.subtitle}</p>
                </div>
                <button
                  onClick={() =>
                    setActiveState({
                      product: heroProduct,
                      mode: 'studio',
                      studioPreset: preset.id,
                    })
                  }
                  className="w-full py-2.5 border border-stone-950 bg-white hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition"
                >
                  3B Stüdyoda Aç
                </button>
              </div>
            </article>
          ))}
        </div>

        {/* Gerçek Mekân 3B Tarama Süreci — Kurumsal Tanıtım Bandı */}
        <div className="mt-10 bg-stone-950 text-white border border-stone-800 p-6 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5 space-y-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-stone-400">
              Gerçek Mekân 3B Tarayıcı
            </p>
            <h3 className="font-display text-xl sm:text-2xl font-bold leading-snug">
              Nereyi çekerseniz çekin, eşyaları ve ölçüleriyle birebir 3B sahne çıkarır.
            </h3>
            <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
              Müşteriniz oturma odasını, ofisini, kafesini veya balkonunu telefonuyla 15–25 saniye
              kaydeder. Sistem gerçek zemin düzlemini ve mevcut eşyaları 1:1 metre cinsinden çıkarır;
              yeni mobilya yalnızca gerçek boş alana yerleştirilir.
            </p>
            <div className="pt-2">
              <button
                onClick={() =>
                  setActiveState({
                    product: heroProduct,
                    mode: 'studio',
                  })
                }
                className="px-5 py-3 bg-white hover:bg-stone-200 text-stone-950 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition"
              >
                <Camera className="w-4 h-4" />
                <span>Gerçek Mekân Tarayıcıyı Başlat</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 border-t sm:border-t-0 sm:border-l border-stone-800 pt-6 sm:pt-0 sm:pl-8 gap-6">
            <div className="space-y-2">
              <p className="text-xs font-mono text-stone-500">ADIM 01</p>
              <h4 className="text-sm font-bold text-white">Kısa Video veya Fotoğraf</h4>
              <p className="text-xs text-stone-400 leading-relaxed">
                iPhone veya Android tarayıcıdan 15–25 sn mekân videosu ya da 4–16 fotoğraf seçilir.
                LiDAR donanımı gerekmez.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-mono text-stone-500">ADIM 02</p>
              <h4 className="text-sm font-bold text-white">1:1 Metrik 3B Yeniden Kurulum</h4>
              <p className="text-xs text-stone-400 leading-relaxed">
                Bulut yapay zekâ hattı mekânın birebir 3B ikizini, 10 cm engel haritasını ve derinlik
                maskelerini otomatik oluşturur.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-mono text-stone-500">ADIM 03</p>
              <h4 className="text-sm font-bold text-white">Yerleştir, Rengi Değiştir, Kaydet</h4>
              <p className="text-xs text-stone-400 leading-relaxed">
                Kataloğunuzdaki ürünler gerçek ölçüsüyle sürüklenir, döndürülür, kumaş rengi
                değiştirilir ve yüksek çözünürlüklü görsel indirilir.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bölüm 02: 1:1 Gerçek Ölçülü 3B Ürün Kataloğu */}
      <main id="katalog" className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 mb-6 border-b border-stone-200">
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
                02 / 1:1 Gerçek Ölçülü 3B Katalog
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
                Canlı CAD &amp; Stüdyo Mobilya Koleksiyonu
              </h2>
              <p className="text-sm text-stone-600">
                Her model gerçek santimetre ölçüsündedir. 360° inceleyin, QR ile telefona aktarın
                veya doğrudan kendi mekânınızda deneyin.
              </p>
            </div>
            <button
              onClick={() => {
                setGenMsg(null);
                setBuilderTab('cad');
                setShowBuilder(true);
              }}
              className="py-2.5 px-4 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              + Kendi CAD Dosyanı Yükle
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
                { id: 'studyo-cad', label: 'Stüdyo PBR' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                  filterTab === tab.id
                    ? 'border-stone-950 bg-stone-950 text-white'
                    : 'border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((p, idx) => (
              <article
                key={p.id}
                className="group border border-stone-200 hover:border-stone-400 flex flex-col bg-white transition"
              >
                <div className="h-60 bg-[#f5f4f0] border-b border-stone-200/80 flex items-center justify-center overflow-hidden relative">
                  {p.thumbUrl ? (
                    <img
                      src={p.thumbUrl}
                      alt={p.name}
                      loading="lazy"
                      className="w-full h-full object-contain p-5 transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    /* @ts-expect-error model-viewer web component */
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
                  <span className="absolute top-3 left-3 text-[10px] font-mono text-stone-400">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                </div>

                <div className="p-5 flex items-start justify-between gap-3 flex-1">
                  <div className="min-w-0">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                      {p.category} ·{' '}
                      {p.source === 'ikea-cad'
                        ? 'Resmi CAD'
                        : p.source === 'studyo-cad'
                        ? 'Stüdyo PBR'
                        : 'Özel CAD'}
                    </p>
                    <h3 className="font-display text-sm font-bold text-stone-950 mt-1">{p.name}</h3>
                    <p className="text-xs font-mono text-stone-600 mt-1">{p.dimensionsCm}</p>
                  </div>
                  <button
                    onClick={() => setQrFor(p)}
                    className="p-1.5 border border-stone-200 hover:border-stone-950 bg-white shrink-0 transition"
                    aria-label="QR kod"
                    title="Telefonda açmak için QR kodu göster"
                  >
                    <QRCodeSVG value={qrUrl(p)} size={50} />
                  </button>
                </div>

                <div className="px-5 pb-5">
                  <button
                    onClick={() => setActiveState({ product: p, mode: 'preview' })}
                    className="w-full py-3 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold tracking-wide transition"
                  >
                    3B İncele &amp; Mekânda Gör
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>

      {/* Bölüm 03: Kurumsal Yetenekler (01–06 Mimari Izgara) */}
      <section id="ozellikler" className="bg-[#f5f4f0] border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16">
          <div className="max-w-2xl mb-10 space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
              03 / Kurumsal Yetenekler
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              Mobilya perakendesi için baştan sona mühendislik
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-l border-stone-300/80 bg-white">
            {[
              {
                no: '01',
                title: 'Donanım Bağımsız 3B Mekân Tarama',
                desc: 'LiDAR veya özel kamera sensörü gerekmez. Herhangi bir iOS veya Android telefonla çekilen kısa videodan birebir metrik 3B mekân çıkarır.',
              },
              {
                no: '02',
                title: 'Fiziksel Çarpışma Koruması',
                desc: '10 cm çözünürlüklü doluluk haritası ve yönlendirilmiş kutu (OBB) fiziğiyle yeni mobilya mevcut eşyaların veya duvarların içinden geçmez.',
              },
              {
                no: '03',
                title: 'Tarayıcı İçi CAD & Kumaş Değişimi',
                desc: 'Üretim çizimleriniz (.GLB, .OBJ, .STL) saniyeler içinde metre ölçeğine çevrilip tabana oturtulur; müşteri döşeme rengini canlı değiştirir.',
              },
              {
                no: '04',
                title: 'HD Fotoğraf & Derinlik Maskesi',
                desc: 'Gerçek kamera açıları üzerinde ön/arka derinlik gizleme (occlusion) ve tek dokunuşla eski eşya temizleme fırçası ile tam görsel netlik sunar.',
              },
              {
                no: '05',
                title: 'Mağaza Etiketi & E-Ticaret QR',
                desc: 'App Store veya Play Store yüklemesi yoktur. Showroom etiketindeki QR kod veya web sitenizdeki buton doğrudan o ürünü müşterinin telefonunda açar.',
              },
              {
                no: '06',
                title: 'İade Azaltımı ve Hızlı Karar',
                desc: 'Ölçü ve oran tereddüdünü satış öncesinde giderir; ağır hacimli mobilya iadelerinden doğan nakliye ve operasyon maliyetlerini düşürür.',
              },
            ].map((feat) => (
              <div
                key={feat.no}
                className="p-7 border-r border-b border-stone-300/80 bg-white flex flex-col justify-between gap-3"
              >
                <p className="text-xs font-mono text-stone-400">{feat.no}</p>
                <div className="space-y-2">
                  <h3 className="font-display text-[15px] font-bold text-stone-950">{feat.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bölüm 04: Sektör Geri Bildirimleri (Kesintisiz Akan Yorum Nehri) */}
      <section id="yorumlar" className="bg-[#faf9f6] border-b border-stone-200 py-16 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 mb-10 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
              04 / Sektör Geri Bildirimleri
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

      {/* Bölüm 05: Kurumsal Mağaza Paketleri */}
      <section id="paketler" className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 space-y-10">
          <div className="max-w-2xl space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
              05 / B2B Mağaza ve Zincir Paketleri
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
              Müşterinize tamamen ücretsiz, mağazanıza şeffaf aylık paket
            </h2>
            <p className="text-sm text-stone-600 leading-relaxed">
              Sunucu kurulumu veya ek yazılım maliyeti yoktur. Ürün kataloğunuzu aktarın, tüm
              şubelerinizde ve e-ticaret sitenizde aynı gün yayına alın.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DEALER_PLANS.map((plan, idx) => {
              const featured = idx === 1;
              const active = memberState.activePlanId === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`border p-7 flex flex-col justify-between gap-6 transition ${
                    featured
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-[#faf9f6] text-stone-950'
                  }`}
                >
                  <div className="space-y-4">
                    <div
                      className={`flex items-center justify-between text-[11px] font-mono ${
                        featured ? 'text-stone-400' : 'text-stone-500'
                      }`}
                    >
                      <span>{String(idx + 1).padStart(2, '0')}</span>
                      <span>{featured ? 'EN ÇOK TERCİH EDİLEN' : 'AYLIK ABONELİK'}</span>
                    </div>

                    <div>
                      <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                      <p className="mt-2 font-display text-3xl font-bold tracking-tight">
                        {plan.monthlyPriceTry.toLocaleString('tr-TR')} ₺
                        <span
                          className={`text-xs font-sans font-normal ${
                            featured ? 'text-stone-400' : 'text-stone-500'
                          }`}
                        >
                          {' '}
                          / ay
                        </span>
                      </p>
                    </div>

                    <p
                      className={`text-xs leading-relaxed ${
                        featured ? 'text-stone-300' : 'text-stone-600'
                      }`}
                    >
                      {plan.desc}
                    </p>

                    <div
                      className={`pt-4 border-t space-y-2 text-xs ${
                        featured ? 'border-stone-800' : 'border-stone-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={featured ? 'text-stone-400' : 'text-stone-500'}>
                          Aylık 3B Mekân Kotası
                        </span>
                        <span className="font-mono font-bold">{plan.monthlyQuota} tarama</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={featured ? 'text-stone-400' : 'text-stone-500'}>
                          Müşteri Başı Deneme
                        </span>
                        <span className="font-mono font-bold">{plan.perCustomerLimit} mekân</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={featured ? 'text-stone-400' : 'text-stone-500'}>
                          CAD Katalog &amp; QR Etiket
                        </span>
                        <span className="font-semibold">Sınırsız</span>
                      </div>
                    </div>
                  </div>

                  <a
                    href="#iletisim"
                    onClick={() => {
                      const next = setDealerPlan(plan.id);
                      setMemberState(next);
                      setCalcMonthlyScans(plan.monthlyQuota);
                    }}
                    className={`w-full py-3 text-center text-xs font-bold uppercase tracking-wider border transition ${
                      featured
                        ? 'bg-white hover:bg-stone-200 text-stone-950 border-white'
                        : active
                        ? 'bg-stone-950 text-white border-stone-950'
                        : 'bg-white hover:bg-stone-950 hover:text-white text-stone-950 border-stone-300'
                    }`}
                  >
                    Demo &amp; Kurulum Talep Et
                  </a>
                </div>
              );
            })}
          </div>

          {/* Toplantı / Sunum İçin Açılır Bayi Kota & Altyapı Maliyet Paneli */}
          <div className="border border-stone-200 bg-[#faf9f6]">
            <button
              type="button"
              onClick={() => setShowEconomics((v) => !v)}
              className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-stone-100/70 transition"
            >
              <div>
                <p className="text-[11px] font-mono uppercase tracking-wider text-stone-500">
                  Kurumsal Bayi &amp; Sunum Aracı
                </p>
                <p className="text-sm font-bold text-stone-950 mt-0.5">
                  Canlı Kota Takibi ve Bulut 3B İşlem Maliyeti Hesaplayıcı
                </p>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-stone-600 transition-transform shrink-0 ${
                  showEconomics ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showEconomics && (
              <div className="px-6 pb-6 pt-2 border-t border-stone-200 grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 border border-stone-200 p-5 space-y-4 bg-white">
                  <div className="flex items-center justify-between gap-2 border-b border-stone-200 pb-3">
                    <div>
                      <p className="text-[10px] font-mono text-stone-500 uppercase">Canlı Kota Defteri</p>
                      <h3 className="text-sm font-bold text-stone-950">Aktif Oturum &amp; Son Taramalar</h3>
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-emerald-700">
                      {runpodConnected ? 'Bulut GPU Aktif' : 'Demo Modu'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 text-xs">
                    <div className="border border-stone-200 p-3 space-y-1">
                      <span className="text-[10px] text-stone-500 block">Seçili Paket</span>
                      <span className="font-bold text-stone-950">{activePlan.name}</span>
                    </div>
                    <div className="border border-stone-200 p-3 space-y-1">
                      <span className="text-[10px] text-stone-500 block">Aylık Kullanım</span>
                      <span className="font-mono font-bold text-stone-950">
                        {memberState.dealerUsedScans} / {activePlan.monthlyQuota}
                      </span>
                    </div>
                    <div className="border border-stone-200 p-3 space-y-1">
                      <span className="text-[10px] text-stone-500 block">Cihaz Hakkı</span>
                      <span className="font-mono font-bold text-stone-950">
                        {remainingTrials} / {activePlan.perCustomerLimit}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMemberState(resetCustomerTrials())}
                      className="px-3.5 py-2 border border-stone-300 hover:border-stone-950 text-xs font-semibold text-stone-950"
                    >
                      Deneme Hakkını Sıfırla
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowServer(true)}
                      className="px-3.5 py-2 bg-stone-950 hover:bg-stone-800 text-white text-xs font-semibold"
                    >
                      Bulut GPU Ayarları
                    </button>
                  </div>

                  {memberState.history.length > 0 && (
                    <div className="pt-2 border-t border-stone-200 space-y-2">
                      <p className="text-[10px] font-mono text-stone-500 uppercase">Son Tarama Kayıtları</p>
                      <div className="divide-y divide-stone-200 border border-stone-200 text-xs font-mono">
                        {memberState.history.slice(0, 4).map((rec) => (
                          <div key={rec.id} className="px-3 py-2 flex items-center justify-between gap-2">
                            <span className="text-stone-600">
                              {new Date(rec.dateIso).toLocaleTimeString('tr-TR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · {rec.frameCount} kare · {rec.billedSec.toFixed(1)} sn
                            </span>
                            <span className="font-bold text-stone-950">${rec.costUsd.toFixed(4)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-6 border border-stone-200 bg-white p-5 space-y-4">
                  <div className="border-b border-stone-200 pb-3">
                    <p className="text-[10px] font-mono text-stone-500 uppercase">
                      Sunucusuz GPU Birim Ekonomisi
                    </p>
                    <h3 className="text-sm font-bold text-stone-950">
                      Boşta Bekleyen Sunucuya Sıfır Kira (İstek Başı Maliyet)
                    </h3>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <label className="block font-semibold text-stone-700">GPU Sınıfı</label>
                      <select
                        value={calcTier}
                        onChange={(e) => {
                          const tier = e.target.value as GpuTierId;
                          setCalcTier(tier);
                          setCalcSec(GPU_TIERS[tier].avgScanSec);
                        }}
                        className="w-full px-3 py-2 bg-[#faf9f6] border border-stone-300 text-xs font-medium text-stone-950"
                      >
                        {Object.values(GPU_TIERS).map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name} ({g.vram}) — ${g.ratePerSecUsd.toFixed(5)}/sn
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-stone-700">Ortalama İşlem Süresi</span>
                        <span className="font-mono font-bold text-stone-950">{calcSec} sn</span>
                      </div>
                      <input
                        type="range"
                        min={8}
                        max={60}
                        value={calcSec}
                        onChange={(e) => setCalcSec(Number(e.target.value))}
                        className="w-full accent-stone-950"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-stone-700">Aylık Mekân Taraması</span>
                        <span className="font-mono font-bold text-stone-950">{calcMonthlyScans} tarama</span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={3000}
                        step={50}
                        value={calcMonthlyScans}
                        onChange={(e) => setCalcMonthlyScans(Number(e.target.value))}
                        className="w-full accent-stone-950"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-stone-200">
                    <div className="bg-[#faf9f6] border border-stone-200 p-3">
                      <span className="text-[10px] text-stone-500 block">1 Mekân Taraması</span>
                      <span className="text-base font-mono font-bold text-stone-950">
                        ${calcScanUsd.toFixed(4)}
                      </span>
                    </div>
                    <div className="bg-[#faf9f6] border border-stone-200 p-3">
                      <span className="text-[10px] text-stone-500 block">Aylık Toplam Altyapı</span>
                      <span className="text-base font-mono font-bold text-stone-950">
                        ${calcMonthlyUsd.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bölüm 06: Kurumsal Entegrasyon & Demo Talebi */}
      <section id="iletisim" className="bg-[#faf9f6] border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-stone-500">
                06 / Entegrasyon ve Kurumsal İletişim
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-stone-950">
                Kendi ürün sayfanıza tek bağlantıyla bağlayın
              </h2>
              <p className="text-sm text-stone-600 leading-relaxed">
                Web sitenizdeki ürün sayfasına eklenen &ldquo;Odamda Gör&rdquo; butonu veya mağaza
                etiketindeki QR kod doğrudan o ürünün 1:1 3B sahnesini açar. Mevcut{' '}
                <code className="px-1.5 py-0.5 bg-stone-200/80 text-xs font-mono">.GLB</code>,{' '}
                <code className="px-1.5 py-0.5 bg-stone-200/80 text-xs font-mono">.OBJ</code> veya{' '}
                <code className="px-1.5 py-0.5 bg-stone-200/80 text-xs font-mono">.STL</code>{' '}
                dosyalarınızı hemen test edebilirsiniz.
              </p>
            </div>

            <div className="border border-stone-200 bg-white p-5 space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
                Örnek Ürün Entegrasyon Bağlantısı
              </p>
              <div className="flex items-center gap-2 bg-[#f5f4f0] border border-stone-200 px-3 py-2.5 text-xs font-mono text-stone-700 overflow-hidden">
                <span className="truncate flex-1">{embedSampleUrl}</span>
                <button
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
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('cad');
                  setShowBuilder(true);
                }}
                className="w-full py-3 border border-stone-950 bg-white hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold uppercase tracking-wider transition"
              >
                Kendi CAD Dosyanızı Şimdi Test Edin
              </button>
            </div>
          </div>

          {/* Sağ: 3 Alanlı Sade Kurumsal Demo Formu */}
          <div className="lg:col-span-6 border border-stone-200 bg-white p-6 sm:p-8">
            <div className="border-b border-stone-200 pb-4 mb-5 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-bold text-stone-950">
                  Mağazanız İçin Canlı Demo İsteyin
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Kataloğunuzdan 3 ürünü ücretsiz 1:1 3B sahneye alıp birlikte test edelim.
                </p>
              </div>
              <span className="text-[10px] font-mono text-stone-500 shrink-0">{activePlan.name}</span>
            </div>

            {demoSubmitted ? (
              <div className="py-8 text-center space-y-3">
                <div className="w-10 h-10 mx-auto bg-stone-950 text-white flex items-center justify-center">
                  <Check className="w-5 h-5" />
                </div>
                <p className="font-display text-base font-bold text-stone-950">
                  Demo talebiniz alındı
                </p>
                <p className="text-xs text-stone-600 max-w-sm mx-auto leading-relaxed">
                  <strong>{demoCompany}</strong> için kurumsal entegrasyon ve 3B katalog demo
                  planlamasını en kısa sürede <strong>{demoContact}</strong> üzerinden paylaşacağız.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDemoSubmitted(false);
                    setDemoCompany('');
                    setDemoContact('');
                    setDemoNote('');
                  }}
                  className="px-4 py-2 border border-stone-300 hover:border-stone-950 text-xs font-semibold text-stone-900"
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
                    className="w-full px-3.5 py-2.5 bg-[#faf9f6] border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950"
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
                    className="w-full px-3.5 py-2.5 bg-[#faf9f6] border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-800 mb-1.5">
                    Şube Sayısı / Ürün Grubu Notu
                  </label>
                  <textarea
                    rows={3}
                    value={demoNote}
                    onChange={(e) => setDemoNote(e.target.value)}
                    placeholder="Örn: 2 showroom, 40 koltuk ve yemek odası modeli; mevcut .OBJ çizimlerimiz var."
                    className="w-full px-3.5 py-2.5 bg-[#faf9f6] border border-stone-300 focus:border-stone-950 focus:outline-none text-xs text-stone-950 resize-none"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold uppercase tracking-wider transition"
                >
                  Ücretsiz Demo &amp; Teklif Al
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Kurumsal Footer */}
      <footer className="bg-[#111110] text-stone-400">
        <div className="max-w-6xl mx-auto px-4 lg:px-10 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2.5 text-white">
            <span className="font-display font-bold tracking-tight">MekanAR</span>
            <span className="text-stone-600">·</span>
            <span className="text-stone-400">Mobilya Markaları İçin Gerçek Mekân 3B Platformu</span>
          </div>
          <div className="flex items-center gap-5 text-[11px]">
            <a href="#mekanlar" className="hover:text-white transition">
              Mekânlar
            </a>
            <a href="#katalog" className="hover:text-white transition">
              Katalog
            </a>
            <a href="#paketler" className="hover:text-white transition">
              Paketler
            </a>
            <a href="#iletisim" className="hover:text-white transition">
              İletişim
            </a>
          </div>
        </div>
      </footer>

      {/* Mobil Hızlı Erişim Çubuğu (MobileQuickBar) */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-stone-200 px-3 py-2 flex items-center gap-2">
        <a
          href="#katalog"
          className="flex-1 py-2.5 text-center border border-stone-300 text-stone-950 text-xs font-bold whitespace-nowrap"
        >
          1:1 Katalog ({products.length})
        </a>
        <button
          type="button"
          onClick={() =>
            setActiveState({
              product: heroProduct,
              mode: 'studio',
            })
          }
          className="flex-1 py-2.5 bg-stone-950 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Mekânını Tara</span>
        </button>
      </div>

      {/* QR Kod Modalı */}
      {qrFor && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setQrFor(null)}
        >
          <div
            className="bg-white border border-stone-200 p-6 max-w-sm w-full text-center space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-left truncate text-stone-950">
                {qrFor.name}
              </h3>
              <button onClick={() => setQrFor(null)} aria-label="Kapat" className="shrink-0 text-stone-500 hover:text-stone-950">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 border border-stone-200 p-1 gap-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setQrMode('studio')}
                className={`py-2 transition ${
                  qrMode === 'studio' ? 'bg-stone-950 text-white' : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                Gerçek Mekânda Gör
              </button>
              <button
                type="button"
                onClick={() => setQrMode('preview')}
                className={`py-2 transition ${
                  qrMode === 'preview' ? 'bg-stone-950 text-white' : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                3B Ürün İncele
              </button>
            </div>
            <div className="inline-block p-3 border-2 border-stone-950 bg-white">
              <QRCodeSVG value={qrUrl(qrFor, qrMode)} size={216} />
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              {qrMode === 'studio'
                ? 'Telefon kamerasıyla okutun; kısa video veya fotoğrafla gerçek mekân tarama ekranı doğrudan açılsın.'
                : 'Telefon kamerasıyla okutun ve ürünü 360° 1:1 ölçüsünde inceleyin.'}
            </p>
            <button
              onClick={() => {
                setActiveState({ product: qrFor, mode: qrMode });
                setQrFor(null);
              }}
              className="w-full py-3 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-xs font-bold transition"
            >
              Bu Cihazda Aç
            </button>
          </div>
        </div>
      )}

      {/* CAD & AI 3B Ürün Yükleyici Modalı */}
      {showBuilder && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#111110] text-white border border-stone-800 max-w-md w-full p-5 space-y-4 max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold">Yeni Ürün Ekle (CAD veya AI 3B)</h3>
                <p className="text-[11px] text-stone-400">
                  Tabanı y=0 hizalı, gerçek santimetre ölçülü .GLB paketler.
                </p>
              </div>
              <button
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
                  setBuilderTab('cad');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'cad'
                    ? 'border-white text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200'
                }`}
              >
                CAD Yükle (.GLB/.OBJ/.STL)
              </button>
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('ai');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'ai'
                    ? 'border-white text-white'
                    : 'border-transparent text-stone-400 hover:text-stone-200'
                }`}
              >
                Fotoğraftan AI 3B Üret
              </button>
            </div>

            <div className="space-y-3">
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
                      Hedef Genişlik (cm) — boş bırakılırsa otomatik
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
                      {cadFile ? cadFile.name : 'CAD Dosyası Seç (.glb, .gltf, .obj, .stl)'}
                    </span>
                    <span className="text-[10px] text-stone-400 mt-0.5">
                      Anında tarayıcıda metre dönüşümü ve taban sıfırlama
                    </span>
                    <input
                      type="file"
                      accept=".glb,.gltf,.obj,.stl"
                      className="hidden"
                      onChange={(e) => setCadFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <button
                    onClick={handleCadUpload}
                    disabled={generating || !cadFile}
                    className="w-full py-3 bg-white hover:bg-stone-200 text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 transition"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? 'Dönüştürülüyor...' : 'CAD Dönüştür ve Sahnede Aç'}</span>
                  </button>
                </>
              ) : (
                <>
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
                        { key: 'back', label: '2. Arkadan' },
                        { key: 'left', label: '3. Sol Yan' },
                        { key: 'right', label: '4. Sağ Yan' },
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

                  {!health.online && (
                    <p className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-800/70 p-2.5">
                      Fotoğraftan tekil 3B ürün üretimi için sağ üstteki ayarlar menüsünden GPU pod
                      bağlantısı gerekir; CAD sekmesi ise tarayıcıda anında çalışır.
                    </p>
                  )}

                  <button
                    onClick={handleGenerate3D}
                    disabled={generating || !slots.front || !health.online}
                    className="w-full py-3 bg-white text-stone-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? 'Üretiliyor...' : 'GPU ile 3B Üret'}</span>
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
                  <span>.GLB Dosyasını İndir</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sistem & Bulut GPU Ayarları Modalı (Yönetici / Kurulum Paneli) */}
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
                <Server className="w-4 h-4" /> Bulut 3B Tarama &amp; GPU Ayarları
              </h3>
              <button onClick={() => setShowServer(false)} aria-label="Kapat">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 border border-stone-200 p-3.5 bg-[#faf9f6]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-stone-950">
                  RunPod Serverless — Gerçek 3B Mekân Motoru
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 border ${
                    runpodConnected
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-white text-stone-600'
                  }`}
                >
                  {serverScanReady
                    ? 'Sunucu Aktif'
                    : memberState.runpodEndpointId
                    ? 'Tarayıcı Bağlı'
                    : 'Yapılandırılmadı'}
                </span>
              </div>
              <p className="text-[11px] text-stone-600 leading-relaxed">
                Üretim ortamında{' '}
                <code className="px-1 py-0.5 bg-stone-200/80 font-mono text-[10px]">
                  RUNPOD_ENDPOINT_ID
                </code>{' '}
                ve{' '}
                <code className="px-1 py-0.5 bg-stone-200/80 font-mono text-[10px]">
                  RUNPOD_API_KEY
                </code>{' '}
                sunucu ortam değişkenlerinden okunur; yerel testte aşağıdan geçici olarak girebilirsiniz.
              </p>

              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Endpoint ID
                  </label>
                  <input
                    value={rpEndpoint}
                    onChange={(e) => setRpEndpoint(e.target.value)}
                    placeholder="örn: 13cy5nyqy2w39j"
                    className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">API Key</label>
                  <input
                    type="password"
                    value={rpApiKey}
                    onChange={(e) => setRpApiKey(e.target.value)}
                    placeholder="rpa_..."
                    className="w-full px-3 py-2 bg-white border border-stone-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    GPU Sınıfı (Maliyet Tahmini)
                  </label>
                  <select
                    value={rpTier}
                    onChange={(e) => setRpTier(e.target.value as GpuTierId)}
                    className="w-full px-3 py-2 bg-white border border-stone-300 text-xs"
                  >
                    {Object.values(GPU_TIERS).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.vram}) — ~${(g.ratePerSecUsd * g.avgScanSec).toFixed(3)} / tarama
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const next = updateRunpodCredentials(rpEndpoint, rpApiKey, rpTier);
                  setMemberState(next);
                  setShowServer(false);
                }}
                className="w-full py-2.5 bg-stone-950 hover:bg-stone-800 text-white text-xs font-bold"
              >
                Bağlantıyı Kaydet
              </button>
            </div>

            <div className="space-y-2 border-t border-stone-200 pt-3">
              <p className="text-[11px] font-semibold text-stone-700">
                Opsiyonel Saatlik Pod ID (Fotoğraftan Tekil 3B Mobilya Üretimi)
              </p>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Durum:{' '}
                {health.online
                  ? `Bağlı (${health.gpu}, v${health.version})`
                  : 'Hazır katalog ve CAD dönüştürücü 7/24 açıktır.'}
              </p>
              <div className="flex gap-2">
                <input
                  value={podInput}
                  onChange={(e) => setPodInput(e.target.value)}
                  placeholder="Pod ID"
                  className="flex-1 px-3 py-2 border border-stone-300 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    setServerUrl(setServerPod(podInput));
                    setShowServer(false);
                  }}
                  className="px-3.5 py-2 border border-stone-950 text-stone-950 hover:bg-stone-100 text-xs font-bold whitespace-nowrap"
                >
                  Kaydet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
