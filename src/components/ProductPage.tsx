import React, { useEffect, useRef, useState } from 'react';
import '@google/model-viewer';
import { ArrowLeft, Camera, Layers } from 'lucide-react';
import type { Product } from '../lib/products';
import type { DemoPhotoRoom, DemoStudioPresetId } from '../lib/demoRooms';
import { RoomDesigner } from './RoomDesigner';
import { Room3DStudio } from './Room3DStudio';

interface Props {
  product: Product;
  products: Product[];
  serverUrl: string;
  serverOnline: boolean;
  startMode?: 'preview' | 'photo' | 'studio';
  initialDemoRoomId?: DemoPhotoRoom['id'];
  initialStudioPreset?: DemoStudioPresetId;
  initialColorHex?: string;
  onBack: () => void;
}

export const ProductPage: React.FC<Props> = ({
  product,
  products,
  serverUrl,
  serverOnline,
  startMode = 'preview',
  initialDemoRoomId,
  initialStudioPreset,
  initialColorHex,
  onBack,
}) => {
  const [mode, setMode] = useState<'preview' | 'photo' | 'studio'>(startMode);
  const [photoDemoId, setPhotoDemoId] = useState<DemoPhotoRoom['id'] | undefined>(initialDemoRoomId);
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

  if (mode === 'photo') {
    return (
      <RoomDesigner
        product={product}
        products={products}
        serverUrl={serverUrl}
        serverOnline={serverOnline}
        initialDemoRoomId={photoDemoId}
        initialColorHex={colorHex}
        onBack={() => {
          setPhotoDemoId(undefined);
          if (startMode !== 'preview') onBack();
          else setMode('preview');
        }}
      />
    );
  }

  if (mode === 'studio') {
    return (
      <Room3DStudio
        product={product}
        products={products}
        serverUrl={serverUrl}
        serverOnline={serverOnline}
        initialPreset={studioPreset}
        onBack={() => {
          setStudioPreset(undefined);
          if (startMode !== 'preview') onBack();
          else setMode('preview');
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 h-[100dvh] z-40 bg-[#f5f5f4] text-zinc-950 flex flex-col">
      <header className="h-14 px-3 flex items-center border-b border-zinc-200 bg-white shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 px-2 py-2 text-xs font-semibold whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" />
          <span>Ürünler</span>
        </button>
      </header>

      <div className="relative flex-1 min-h-0">
        {/* @ts-expect-error model-viewer web component */}
        <model-viewer
          ref={mvRef}
          src={product.glbUrl}
          alt={product.name}
          camera-controls
          shadow-intensity="1"
          environment-image="neutral"
          camera-orbit="25deg 75deg auto"
          style={{ width: '100%', height: '100%', backgroundColor: '#f5f5f4' }}
        />
      </div>

      <div className="shrink-0 bg-white border-t border-zinc-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2.5">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">
            {product.source === 'ikea-cad' ? `IKEA CAD • ${product.category}` : product.source === 'studyo-cad' ? `Stüdyo CAD • ${product.category}` : product.category}
          </p>
          <h1 className="text-base font-bold">{product.name}</h1>
          <p className="text-xs text-zinc-500 font-mono">{product.dimensionsCm}</p>
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border whitespace-nowrap shrink-0 ${
                    active ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-300 bg-white text-zinc-700'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" style={{ backgroundColor: sw.hex }} />
                  <span>{sw.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => {
            setPhotoDemoId(undefined);
            setMode('photo');
          }}
          className="w-full py-3.5 bg-zinc-950 hover:bg-zinc-800 text-white text-sm font-bold rounded-lg flex items-center justify-center gap-2"
        >
          <Camera className="w-4 h-4" />
          <span>Kendi Odamın Fotoğrafında Gör (Çek / Yükle)</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setStudioPreset('living');
              setMode('studio');
            }}
            className="py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Hazır 3D Salonda Gör</span>
          </button>

          <button
            onClick={() => {
              setStudioPreset(undefined);
              setMode('studio');
            }}
            className="py-2.5 px-3 border border-zinc-950 hover:bg-zinc-50 text-zinc-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3D Odamı Modelle (Çoklu Açı)</span>
          </button>
        </div>

        <button
          onClick={() => {
            setPhotoDemoId('oak');
            setMode('photo');
          }}
          className="w-full py-2.5 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 text-zinc-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Örnek Fotoğrafta Gör</span>
        </button>
      </div>
    </div>
  );
};
