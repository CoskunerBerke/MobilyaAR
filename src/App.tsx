import React, { useCallback, useEffect, useState } from 'react';
import '@google/model-viewer';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, Camera, Copy, Download, Layers, Loader2, Plus, QrCode, Server, Upload, X } from 'lucide-react';
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
import { DEMO_STUDIO_PRESETS, type DemoPhotoRoom, type DemoStudioPresetId } from './lib/demoRooms';
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
        ctx.fillStyle = '#f4f4f5';
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

type ActiveViewState = {
  product: Product;
  mode: 'preview' | 'photo' | 'studio';
  demoRoomId?: DemoPhotoRoom['id'];
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
    const startMode: 'preview' | 'photo' | 'studio' =
      mod === 'studio' ? 'studio' : mod === 'photo' ? 'photo' : 'preview';
    const studioPreset = oda === 'living' || oda === 'bedroom' || oda === 'grand' ? oda : undefined;
    const demoRoomId = oda === 'oak' || oda === 'rug' || oda === 'travertine' ? oda : undefined;

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
        demoRoomId,
        colorHex: renk,
      };
    }
    const found = findProduct(urun);
    if (found || mod === 'photo' || mod === 'studio') {
      return {
        product: found || PRODUCTS[0],
        mode: startMode,
        studioPreset,
        demoRoomId,
        colorHex: renk,
      };
    }
    return null;
  });

  const [qrFor, setQrFor] = useState<Product | null>(null);
  const [qrMode, setQrMode] = useState<'photo' | 'preview'>('photo');
  const [showServer, setShowServer] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderTab, setBuilderTab] = useState<'cad' | 'ai'>('cad');
  const [filterTab, setFilterTab] = useState<'all' | 'ikea-cad' | 'studyo-cad' | 'seating' | 'table-chair' | 'storage-bed'>('all');
  const [podInput, setPodInput] = useState(() => getPodId(getServerUrl()));
  const [copiedEmbed, setCopiedEmbed] = useState(false);

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
      oda: activeState.studioPreset || activeState.demoRoomId,
      colorHex: activeState.colorHex,
      serverOnline: health.online,
      serverUrl,
    });
    const nextSearch = new URL(share).search;
    if (window.location.search !== nextSearch) {
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
    }
  }, [activeState, health.online, serverUrl]);

  const qrUrl = (p: Product, mode: 'photo' | 'preview' = 'photo') =>
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
    setGenMsg('RunPod GPU üzerinde 3D model ve gerçek ölçülü PBR dokular üretiliyor...');
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
        setGenMsg(`RunPod sunucusuna yükleniyor (${converted.dimensionsCm})...`);
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

  const filteredProducts = products.filter((p) => {
    if (filterTab === 'all') return true;
    if (filterTab === 'ikea-cad') return p.source === 'ikea-cad';
    if (filterTab === 'studyo-cad') return p.source === 'studyo-cad' || p.source === 'ozel-cad';
    if (filterTab === 'seating') return p.category === 'Kanepe' || p.category === 'Berjer';
    if (filterTab === 'table-chair') return p.category === 'Masa' || p.category === 'Sandalye' || p.category === 'Sehpa';
    if (filterTab === 'storage-bed') {
      return p.category === 'Kitaplık' || p.category === 'Raf' || p.category === 'TV Ünitesi' || p.category === 'Yatak';
    }
    return true;
  });

  const featuredIds = ['ikea-landskrona-sofa', 'ikea-uppland-sofa', 'ikea-strandmon-chair'];
  const featuredProducts = featuredIds
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => Boolean(p));
  const heroProduct = products.find((p) => p.id === heroProductId) || products[0];

  const embedSampleUrl = `${getPublicOrigin()}/?urun=ikea-landskrona-sofa&mod=photo`;

  if (activeState) {
    return (
      <ProductPage
        product={activeState.product}
        products={products}
        serverUrl={serverUrl}
        serverOnline={health.online}
        startMode={activeState.mode}
        initialDemoRoomId={activeState.demoRoomId}
        initialStudioPreset={activeState.studioPreset}
        initialColorHex={activeState.colorHex}
        onBack={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setActiveState(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white text-zinc-950 overflow-x-hidden">
      {/* Üst Menü — Tek Satır & Kurumsal */}
      <header className="h-16 border-b border-zinc-200 px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 bg-white/95 backdrop-blur z-20">
        <a href="#" className="text-sm font-bold tracking-tight whitespace-nowrap shrink-0 flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-zinc-950 inline-block shrink-0" />
          <span>Odanda Gör</span>
        </a>

        <nav className="hidden lg:flex items-center gap-8 text-xs font-medium text-zinc-600">
          <a href="#studyo" className="hover:text-zinc-950 transition whitespace-nowrap">
            Stüdyo
          </a>
          <a href="#katalog" className="hover:text-zinc-950 transition whitespace-nowrap">
            Katalog
          </a>
          <a href="#ozellikler" className="hover:text-zinc-950 transition whitespace-nowrap">
            Özellikler
          </a>
          <a href="#entegrasyon" className="hover:text-zinc-950 transition whitespace-nowrap">
            Entegrasyon
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setGenMsg(null);
              setShowBuilder(true);
            }}
            className="hidden md:flex items-center gap-1.5 px-3 py-2 border border-zinc-300 hover:border-zinc-950 text-xs font-semibold rounded whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>CAD Yükle</span>
          </button>

          <button
            onClick={() =>
              setActiveState({
                product: heroProduct,
                mode: 'photo',
              })
            }
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-950 bg-white hover:bg-zinc-100 text-zinc-950 text-xs font-bold rounded whitespace-nowrap shrink-0"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Odamı Çek</span>
          </button>

          <button
            onClick={() =>
              setActiveState({
                product: heroProduct,
                mode: 'studio',
                studioPreset: 'living',
              })
            }
            className="flex items-center gap-1.5 px-3 sm:px-3.5 py-2 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold rounded whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">3D Oda Stüdyosu</span>
            <span className="sm:hidden">3D Oda</span>
          </button>

          <button
            onClick={() => setShowServer(true)}
            className="relative p-2 border border-zinc-200 hover:border-zinc-400 rounded text-zinc-600 hover:text-zinc-950 shrink-0"
            aria-label="GPU Sunucu Ayarları"
            title={health.online ? `Canlı GPU Aktif (${health.gpu})` : 'GPU Sunucu Ayarları'}
          >
            <Server className="w-4 h-4" />
            {health.online && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600" />
            )}
          </button>
        </div>
      </header>

      {/* İnteraktif Kurumsal Hero */}
      <section className="border-b border-zinc-200 bg-zinc-50/70">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-zinc-950 leading-[1.12]">
              Müşteriniz koltuğu satın almadan kendi odasında 1:1 ölçüsünde görsün.
            </h1>
            <p className="text-sm sm:text-base text-zinc-600 leading-relaxed max-w-xl">
              Mobilya markaları ve showroom&apos;lar için geliştirilen tarayıcı tabanlı 3D oda deneyimi. Uygulama indirmeden ürünleri gerçek santimetre ölçüsünde inceleyin, hazır 360° odalarda veya kendi fotoğrafınızda deneyin.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  setActiveState({
                    product: heroProduct,
                    mode: 'studio',
                    studioPreset: 'living',
                  })
                }
                className="px-5 py-3.5 bg-zinc-950 hover:bg-zinc-800 text-white text-xs sm:text-sm font-bold tracking-wide flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Layers className="w-4 h-4" />
                <span>Hazır 3D Salonda Hemen Dene</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() =>
                  setActiveState({
                    product: heroProduct,
                    mode: 'photo',
                  })
                }
                className="px-5 py-3.5 bg-white border border-zinc-950 hover:bg-zinc-100 text-zinc-950 text-xs sm:text-sm font-bold tracking-wide flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Kendi Odanı Yükle</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-zinc-200">
              <div>
                <p className="text-[11px] font-mono text-zinc-400">01</p>
                <p className="text-xs font-bold text-zinc-950 mt-0.5">1:1 Gerçek Ölçü</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Birebir CAD santimetre uyumu</p>
              </div>
              <div>
                <p className="text-[11px] font-mono text-zinc-400">02</p>
                <p className="text-xs font-bold text-zinc-950 mt-0.5">360° Oda & Kesit</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Döndür, eski eşyayı kes, değiştir</p>
              </div>
              <div>
                <p className="text-[11px] font-mono text-zinc-400">03</p>
                <p className="text-xs font-bold text-zinc-950 mt-0.5">Web & Mağaza QR</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Uygulamasız Safari / Chrome</p>
              </div>
            </div>
          </div>

          {/* Sağ: Canlı 3D Vitrin Vitrini */}
          <div className="lg:col-span-6 border border-zinc-200 bg-white">
            <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between gap-2 overflow-x-auto">
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
                          ? 'border-zinc-950 bg-zinc-950 text-white'
                          : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                      }`}
                    >
                      {shortTitle}
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] font-mono text-zinc-500 whitespace-nowrap shrink-0">
                {heroProduct.dimensionsCm}
              </span>
            </div>

            <div className="h-72 sm:h-80 bg-zinc-100/80 relative">
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
            </div>

            <div className="p-4 border-t border-zinc-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                  İnteraktif 3D Önizleme • Sürükleyip Çevirin
                </p>
                <p className="text-sm font-bold truncate">{heroProduct.name}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setQrFor(heroProduct)}
                  className="p-2.5 border border-zinc-300 hover:border-zinc-950 text-zinc-700 hover:text-zinc-950"
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
                      studioPreset: 'living',
                    })
                  }
                  className="px-3.5 py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold whitespace-nowrap"
                >
                  Salonda Gör
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bölüm 1: Anında İnteraktif Oda Stüdyosu */}
      <section id="studyo" className="max-w-6xl mx-auto px-4 lg:px-8 py-12 border-b border-zinc-200">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-8">
          <div>
            <p className="text-xs font-mono text-zinc-500">01 / ANINDA İNTERAKTİF DENEYİM</p>
            <h2 className="text-2xl font-bold tracking-tight mt-1">Hazır 3D Oda Stüdyosu</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Kurulum veya fotoğraf yüklemesi beklemeden, tek tıkla boş 360° 3D odalara geçip ürünleri yerleştirin.
            </p>
          </div>
        </div>

        {/* Hazır Boş 360° 3D Odalar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {DEMO_STUDIO_PRESETS.map((preset, idx) => (
            <div key={preset.id} className="border border-zinc-200 p-5 bg-white flex flex-col justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500">
                  <span>{String(idx + 1).padStart(2, '0')} / BOŞ 3D ODA</span>
                  <span>{preset.dimensionsLabel}</span>
                </div>
                <h3 className="text-base font-bold text-zinc-950">{preset.title}</h3>
                <p className="text-xs text-zinc-600 leading-relaxed">{preset.subtitle}</p>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-zinc-100">
                <span className="text-[11px] font-mono text-zinc-500">
                  Boş başlar • Çarpışmasız yerleşim
                </span>
                <button
                  onClick={() =>
                    setActiveState({
                      product: heroProduct,
                      mode: 'studio',
                      studioPreset: preset.id,
                    })
                  }
                  className="px-4 py-2 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold whitespace-nowrap shrink-0"
                >
                  Boş Odayı Aç
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bölüm 2: 1:1 Gerçek Ölçülü Ürün Kataloğu */}
      <main id="katalog" className="max-w-6xl mx-auto px-4 lg:px-8 py-12 border-b border-zinc-200">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 mb-6 border-b border-zinc-200">
          <div>
            <p className="text-xs font-mono text-zinc-500">02 / GERÇEK 1:1 MOBİLYA KATALOĞU</p>
            <h2 className="text-2xl font-bold tracking-tight mt-1">Resmi CAD &amp; Stüdyo PBR Modelleri</h2>
            <p className="text-sm text-zinc-600 mt-1">
              Tüm modeller gerçek santimetre ölçüsündedir. İnceleyin, QR ile telefona aktarın veya doğrudan odanızda deneyin.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setGenMsg(null);
                setBuilderTab('cad');
                setShowBuilder(true);
              }}
              className="py-2.5 px-4 border border-zinc-950 hover:bg-zinc-50 text-zinc-950 text-xs font-bold whitespace-nowrap shrink-0"
            >
              + Kendi CAD Dosyanı Yükle
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-6">
          {(
            [
              { id: 'all', label: `Tümü (${products.length})` },
              { id: 'ikea-cad', label: 'IKEA Resmi CAD' },
              { id: 'studyo-cad', label: 'Stüdyo PBR CAD' },
              { id: 'seating', label: 'Koltuk & Berjer' },
              { id: 'table-chair', label: 'Masa & Sandalye' },
              { id: 'storage-bed', label: 'Depolama & Yatak' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={`px-3.5 py-2 text-xs font-semibold border transition whitespace-nowrap shrink-0 ${
                filterTab === tab.id
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProducts.map((p, idx) => (
            <article key={p.id} className="border border-zinc-200 flex flex-col bg-white">
              <div className="h-56 bg-zinc-50 border-b border-zinc-100 flex items-center justify-center overflow-hidden">
                {p.thumbUrl ? (
                  <img
                    src={p.thumbUrl}
                    alt={p.name}
                    loading="lazy"
                    className="w-full h-full object-contain p-4"
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
              </div>
              <div className="p-4 flex items-center justify-between gap-3 flex-1">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                    {String(idx + 1).padStart(2, '0')} /{' '}
                    {p.source === 'ikea-cad'
                      ? 'IKEA Resmi CAD'
                      : p.source === 'studyo-cad'
                      ? 'Stüdyo PBR CAD'
                      : 'Özel CAD'}{' '}
                    • {p.category}
                  </p>
                  <h3 className="text-sm font-bold mt-0.5">{p.name}</h3>
                  <p className="text-xs font-mono text-zinc-600 mt-0.5">{p.dimensionsCm}</p>
                </div>
                <button
                  onClick={() => setQrFor(p)}
                  className="p-1.5 border border-zinc-200 hover:border-zinc-950 shrink-0 transition"
                  aria-label="QR kod"
                  title="Telefonda açmak için QR kodu göster"
                >
                  <QRCodeSVG value={qrUrl(p)} size={56} />
                </button>
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => setActiveState({ product: p, mode: 'preview' })}
                  className="w-full py-3 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold uppercase tracking-wide transition"
                >
                  3D İncele &amp; Odanda Gör
                </button>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* Bölüm 3: Mimari Özellikler */}
      <section id="ozellikler" className="max-w-6xl mx-auto px-4 lg:px-8 py-12 border-b border-zinc-200">
        <div className="mb-8">
          <p className="text-xs font-mono text-zinc-500">03 / TEKNİK KABİLİYETLER</p>
          <h2 className="text-2xl font-bold tracking-tight mt-1">Gerçekçi Ölçüm &amp; Oda Modelleme</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-t border-l border-zinc-200">
          {[
            {
              no: '01',
              title: '1:1 Metrik Ölçekleme',
              desc: 'Fabrika CAD verisinden birebir santimetre ölçeği, y=0 zemin oturtma ve oda ışık yönüne duyarlı temas gölgesi.',
            },
            {
              no: '02',
              title: '360° Oda & Duvar Kesiti',
              desc: 'Çoklu fotoğraftan duvar, parke ve mevcut eşyaları 3 boyutlu sahneye dönüştürün; X/Y/Z kesit alarak yerleşimi kontrol edin.',
            },
            {
              no: '03',
              title: 'Eşya Kesme & Değiştirme',
              desc: 'Mevcut eski koltuk, masa veya yatağı tek dokunuşla sahneden çıkarın ve seçili ürünü doğrudan eski yerine oturtun.',
            },
            {
              no: '04',
              title: 'Uygulamasız Web & QR',
              desc: 'App Store veya Play Store yüklemesi gerektirmez; doğrudan Safari ve Chrome tarayıcılarında yüksek kare hızıyla çalışır.',
            },
          ].map((feat) => (
            <div key={feat.no} className="p-6 border-r border-b border-zinc-200 bg-white space-y-2">
              <p className="text-xs font-mono text-zinc-400">{feat.no}</p>
              <h3 className="text-sm font-bold text-zinc-950">{feat.title}</h3>
              <p className="text-xs text-zinc-600 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bölüm 4: B2B Entegrasyon & Kurumsal Footer */}
      <section id="entegrasyon" className="bg-zinc-50 border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-3">
            <p className="text-xs font-mono text-zinc-500">04 / E-TİCARET VE MAĞAZA ENTEGRASYONU</p>
            <h2 className="text-2xl font-bold tracking-tight">Kendi ürün sayfanıza tek bağlantıyla ekleyin</h2>
            <p className="text-sm text-zinc-600 leading-relaxed">
              Her mobilya firmasının ürün detay sayfasındaki &ldquo;Odamda Nasıl Durur?&rdquo; butonu veya mağaza fiyat etiketindeki QR kodu doğrudan o ürünün 1:1 3D sahnesini açar. Mevcut <code className="px-1.5 py-0.5 bg-zinc-200/70 rounded text-xs font-mono">.GLB</code>, <code className="px-1.5 py-0.5 bg-zinc-200/70 rounded text-xs font-mono">.OBJ</code> veya <code className="px-1.5 py-0.5 bg-zinc-200/70 rounded text-xs font-mono">.STL</code> dosyalarınızı yükleyip saniyeler içinde canlı test edebilirsiniz.
            </p>
          </div>

          <div className="lg:col-span-5 border border-zinc-200 bg-white p-5 space-y-3">
            <p className="text-[11px] font-mono text-zinc-500 uppercase">Örnek Ürün Bağlantısı</p>
            <div className="flex items-center gap-2 bg-zinc-100 border border-zinc-200 px-3 py-2 text-xs font-mono text-zinc-700 overflow-hidden">
              <span className="truncate flex-1">{embedSampleUrl}</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(embedSampleUrl);
                  setCopiedEmbed(true);
                  setTimeout(() => setCopiedEmbed(false), 2000);
                }}
                className="shrink-0 text-zinc-700 hover:text-zinc-950 flex items-center gap-1 font-sans font-semibold"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copiedEmbed ? 'Kopyalandı' : 'Kopyala'}</span>
              </button>
            </div>
            <button
              onClick={() => {
                setGenMsg(null);
                setBuilderTab('cad');
                setShowBuilder(true);
              }}
              className="w-full py-3 bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold uppercase tracking-wide"
            >
              Kendi CAD Dosyanızı Test Edin
            </button>
          </div>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-4 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
        <span>Odanda Gör — Mobilya Markaları İçin 1:1 3D Oda Deneyimi</span>
        <span className="font-mono">
          {health.online ? `Canlı GPU Aktif · ${health.gpu} (v${health.version})` : 'Hazır Demo & Anında 3D Mod Aktif'}
        </span>
      </footer>

      {qrFor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setQrFor(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-left truncate">{qrFor.name}</h3>
              <button onClick={() => setQrFor(null)} aria-label="Kapat" className="shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 border border-zinc-200 rounded-lg p-1 gap-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setQrMode('photo')}
                className={`py-2 rounded transition ${
                  qrMode === 'photo' ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                Odamda Çek / Yükle
              </button>
              <button
                type="button"
                onClick={() => setQrMode('preview')}
                className={`py-2 rounded transition ${
                  qrMode === 'preview' ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                3D Ürün İncele
              </button>
            </div>
            <div className="inline-block p-3 border-2 border-zinc-950 rounded-lg">
              <QRCodeSVG value={qrUrl(qrFor, qrMode)} size={220} />
            </div>
            <p className="text-xs text-zinc-600">
              {qrMode === 'photo'
                ? 'Telefon kamerasıyla okutun; doğrudan kendi odanızın fotoğrafını çekme / yükleme ekranı açılsın.'
                : 'Telefon kamerasıyla okutun ve ürünü 360° 3D olarak inceleyin.'}
            </p>
            <button
              onClick={() => {
                setActiveState({ product: qrFor, mode: qrMode });
                setQrFor(null);
              }}
              className="w-full py-3 border border-zinc-300 hover:border-zinc-950 text-xs font-semibold rounded"
            >
              Bu cihazda aç
            </button>
          </div>
        </div>
      )}

      {showBuilder && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-zinc-950 text-white border border-zinc-800 rounded-xl max-w-md w-full p-5 space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold">Yeni Ürün Ekle (CAD veya AI 3D)</h3>
                <p className="text-[11px] text-zinc-400">Tabanı y=0 hizalı, gerçek ölçülü .GLB paketler.</p>
              </div>
              <button onClick={() => setShowBuilder(false)} aria-label="Kapat" className="text-zinc-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 border-b border-zinc-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('cad');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'cad' ? 'border-white text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                CAD Dosyası Yükle (.OBJ/.STL/.GLB)
              </button>
              <button
                type="button"
                onClick={() => {
                  setGenMsg(null);
                  setBuilderTab('ai');
                }}
                className={`py-2.5 border-b-2 transition ${
                  builderTab === 'ai' ? 'border-white text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Fotoğraftan AI 3D Üret
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">Ürün Adı</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Örn: Milano 3’lü Koltuk"
                  className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded text-white"
                />
              </div>

              {builderTab === 'cad' ? (
                <>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Hedef Genişlik (cm) — boş bırakılırsa otomatik</label>
                    <input
                      type="number"
                      value={cadWidthCm}
                      onChange={(e) => setCadWidthCm(e.target.value)}
                      placeholder="Örn: 210"
                      className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded text-white"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cadZUp}
                      onChange={(e) => setCadZUp(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900"
                    />
                    <span>Z-yukarı CAD eksenini dikleştir (3ds Max / SolidWorks)</span>
                  </label>

                  <label className="h-28 border border-dashed border-zinc-700 hover:border-zinc-400 rounded-lg bg-zinc-900 flex flex-col items-center justify-center cursor-pointer px-4 text-center">
                    <Upload className="w-5 h-5 text-zinc-400 mb-1.5" />
                    <span className="text-xs font-semibold text-zinc-200">
                      {cadFile ? cadFile.name : 'CAD Dosyası Seç (.glb, .gltf, .obj, .stl)'}
                    </span>
                    <span className="text-[10px] text-zinc-400 mt-0.5">
                      Anında tarayıcıda metre dönüşümü &amp; taban y=0 sıfırlama
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
                    className="w-full py-3 bg-white text-zinc-950 font-bold text-xs uppercase rounded flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? 'Dönüştürülüyor...' : 'CAD Dönüştür ve Sahnede Aç'}</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">En (cm)</label>
                      <input type="number" value={newW} onChange={(e) => setNewW(e.target.value)} className="w-full px-2.5 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded text-white" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Derinlik (cm)</label>
                      <input type="number" value={newD} onChange={(e) => setNewD(e.target.value)} className="w-full px-2.5 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded text-white" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Yükseklik (cm)</label>
                      <input type="number" value={newH} onChange={(e) => setNewH(e.target.value)} className="w-full px-2.5 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded text-white" />
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
                      <label key={s.key} className="h-24 border border-dashed border-zinc-700 hover:border-zinc-400 rounded-lg bg-zinc-900 flex flex-col items-center justify-center cursor-pointer overflow-hidden">
                        {slots[s.key] ? (
                          <img src={slots[s.key]!} alt={s.label} className="w-full h-full object-contain p-1" />
                        ) : (
                          <div className="text-center px-2">
                            <Upload className="w-4 h-4 text-zinc-400 mx-auto mb-1" />
                            <span className="text-[10px] text-zinc-400 block">{s.label}</span>
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
                    <p className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-800/70 p-2.5 rounded">
                      Fotoğraftan sıfırdan 3D üretimi için sağ üstteki Sunucu ikonundan RunPod GPU pod&apos;unu bağlamanız gerekir; CAD sekmesi ise sunucusuz anında çalışır.
                    </p>
                  )}

                  <button
                    onClick={handleGenerate3D}
                    disabled={generating || !slots.front || !health.online}
                    className="w-full py-3 bg-white text-zinc-950 font-bold text-xs uppercase rounded flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    <span>{generating ? 'Üretiliyor...' : 'RunPod ile 3D Üret'}</span>
                  </button>
                </>
              )}

              {genMsg && <p className="text-xs text-zinc-300 bg-zinc-900 p-2.5 rounded border border-zinc-800">{genMsg}</p>}
              {generatedGlb && (
                <a
                  href={generatedGlb.url}
                  download={generatedGlb.filename}
                  className="w-full py-2.5 bg-emerald-700 text-white text-xs font-bold rounded flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>.GLB Dosyasını İndir</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {showServer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 max-w-sm w-full space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Server className="w-4 h-4" /> Canlı GPU Sunucusu (Opsiyonel)
              </h3>
              <button onClick={() => setShowServer(false)} aria-label="Kapat">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Durum:{' '}
              {health.online
                ? `Bağlı (${health.gpu}, v${health.version})`
                : 'Beklemede — Hazır demo odaları ve CAD yükleme GPU olmadan 7/24 açıktır.'}
            </p>
            <label className="block text-xs font-semibold">RunPod Pod ID</label>
            <input
              value={podInput}
              onChange={(e) => setPodInput(e.target.value)}
              className="w-full px-3 py-2 border border-zinc-300 rounded text-xs font-mono"
            />
            <button
              onClick={() => {
                setServerUrl(setServerPod(podInput));
                setShowServer(false);
              }}
              className="w-full py-2.5 bg-zinc-950 text-white text-xs font-bold rounded"
            >
              Kaydet ve Bağlan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
