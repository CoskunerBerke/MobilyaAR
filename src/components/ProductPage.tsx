import React, { useEffect, useRef, useState } from 'react';
import '@google/model-viewer';
import { ArrowLeft, Camera, Layers } from 'lucide-react';
import type { Product } from '../lib/products';
import type { DemoStudioPresetId } from '../lib/demoRooms';
import { Room3DStudio } from './Room3DStudio';

interface Props {
  product: Product;
  products: Product[];
  serverUrl: string;
  serverOnline: boolean;
  startMode?: 'preview' | 'photo' | 'studio';
  initialStudioPreset?: DemoStudioPresetId;
  initialColorHex?: string;
  onOpenServerSettings?: () => void;
  onBack: () => void;
}

export const ProductPage: React.FC<Props> = ({
  product,
  products,
  serverUrl,
  serverOnline,
  startMode = 'preview',
  initialStudioPreset,
  initialColorHex,
  onOpenServerSettings,
  onBack,
}) => {
  const [mode, setMode] = useState<'preview' | 'studio'>(startMode === 'preview' ? 'preview' : 'studio');
  const [studioPreset, setStudioPreset] = useState<DemoStudioPresetId | undefined>(initialStudioPreset);
  const [colorHex, setColorHex] = useState<string | undefined>(() => initialColorHex || product.swatches?.[0]?.hex);
  const mvRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hex = colorHex;
    const mv = mvRef.current as unknown as {
      model?: {
        materials?: Array<{
          name?: string;
          pbrMetallicRoughness?: { setBaseColorFactor: (c: string) => void };
        }>;
      };
      addEventListener: (ev: string, cb: () => void) => void;
      removeEventListener: (ev: string, cb: () => void) => void;
    } | null;
    if (!mv || !hex) return;

    const apply = () => {
      mv.model?.materials?.forEach((mat) => {
        if (mat.name?.startsWith('CAD_Fabric')) {
          mat.pbrMetallicRoughness?.setBaseColorFactor(hex);
        }
      });
    };
    apply();
    mv.addEventListener('load', apply);
    return () => mv.removeEventListener('load', apply);
  }, [colorHex, product.id]);

  if (mode === 'studio') {
    return (
      <Room3DStudio
        product={product}
        products={products}
        serverUrl={serverUrl}
        serverOnline={serverOnline}
        initialPreset={studioPreset}
        initialColorHex={colorHex}
        onOpenServerSettings={onOpenServerSettings}
        onBack={() => {
          setStudioPreset(undefined);
          if (startMode !== 'preview') onBack();
          else setMode('preview');
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] z-40 bg-[#f5f4f0] text-stone-950 flex flex-col">
      <header className="h-14 px-4 flex items-center justify-between border-b border-stone-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold text-stone-700 hover:text-stone-950 whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kataloğa Dön</span>
        </button>
        <span className="text-[11px] font-mono text-stone-500 whitespace-nowrap">
          1:1 3B İnceleme · {product.dimensionsCm}
        </span>
      </header>

      <div className="relative flex-1 min-h-0 bg-gradient-to-b from-[#f5f4f0] to-[#eae7e0]">
        {/* @ts-expect-error model-viewer web component */}
        <model-viewer
          ref={mvRef}
          src={product.glbUrl}
          alt={product.name}
          camera-controls
          shadow-intensity="1"
          environment-image="neutral"
          camera-orbit="25deg 75deg auto"
          style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
        />
      </div>

      <div className="shrink-0 bg-white border-t border-stone-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 max-w-2xl w-full mx-auto">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">
              {product.source === 'ikea-cad'
                ? `Resmi CAD · ${product.category}`
                : product.source === 'studyo-cad'
                ? `Stüdyo PBR · ${product.category}`
                : product.category}
            </p>
            <h1 className="font-display text-base sm:text-lg font-bold text-stone-950 truncate">
              {product.name}
            </h1>
          </div>
          <p className="text-xs text-stone-600 font-mono shrink-0">{product.dimensionsCm}</p>
        </div>

        {product.swatches && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {product.swatches.map((sw) => {
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
            onClick={() => {
              setStudioPreset(undefined);
              setMode('studio');
            }}
            className="w-full py-3.5 bg-stone-950 hover:bg-stone-800 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition"
          >
            <Camera className="w-4 h-4" />
            <span>Kendi Gerçek Mekânında Gör</span>
          </button>

          <button
            onClick={() => {
              setStudioPreset('living');
              setMode('studio');
            }}
            className="w-full py-3.5 border border-stone-950 bg-white hover:bg-stone-100 text-stone-950 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition"
          >
            <Layers className="w-4 h-4" />
            <span>Hazır 3B Salonda Dene</span>
          </button>
        </div>
      </div>
    </div>
  );
};
