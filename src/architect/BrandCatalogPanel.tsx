import React, { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { colorSimilarityPct, detectQueryColorHex, normalizeSearchTr } from './universalSearch';
import {
  COUNTERTOP_CATALOG,
  DOOR_PANEL_CATALOG,
  FURNITURE_PANEL_CATALOG,
  PARQUET_CATALOG,
  SKIRTING_TRIM_CATALOG,
  SUPPLIER_BRANDS,
  SUPPLIER_SHORT,
  WALL_PANEL_CATALOG,
  type CountertopCatalogItem,
  type DoorPanelCatalogItem,
  type FurniturePanelCatalogItem,
  type ParquetCatalogItem,
  type SkirtingTrimCatalogItem,
  type SupplierBrand,
  type WallPanelCatalogItem,
} from './materialCatalogs';
import { WALL_LABELS, type ArchRoomProject, type ArchSelection, type WallId } from './types';

type CatalogCategory = 'parquet' | 'wall' | 'skirting' | 'door' | 'countertop' | 'furniture';

interface Props {
  project: ArchRoomProject;
  activeWall: WallId;
  selection: ArchSelection;
  onSelectWall: (wall: WallId) => void;
  onApplyParquet: (item: ParquetCatalogItem) => void;
  onApplyWallPanel: (item: WallPanelCatalogItem, mode: 'full' | 'all' | 'zone') => void;
  onApplySkirtingTrim: (item: SkirtingTrimCatalogItem, target: 'baseboard' | 'corner' | 'both') => void;
  onUpdateSkirtingHeight: (cm: number) => void;
  onToggleCornerTrim: (enabled: boolean) => void;
  onApplyDoorPanel: (item: DoorPanelCatalogItem) => void;
  onApplyCountertop: (item: CountertopCatalogItem) => void;
  onApplyFurniturePanel: (item: FurniturePanelCatalogItem) => void;
}

const CATEGORIES: Array<{ id: CatalogCategory; label: string }> = [
  { id: 'parquet', label: 'Parke & Seramik' },
  { id: 'wall', label: 'Duvar Boya & Profil' },
  { id: 'skirting', label: 'Süpürgelik & Köşelik' },
  { id: 'door', label: 'Kapı Paneli' },
  { id: 'countertop', label: 'Laminat & Kuvars Tezgah' },
  { id: 'furniture', label: 'Mobilya & MDF-Lam' },
];

const WALL_IDS: WallId[] = ['north', 'east', 'south', 'west'];

function swatchPatternCss(kind: string, hex: string): React.CSSProperties {
  if (kind === 'slats' || kind === 'fluted') {
    return {
      backgroundColor: hex,
      backgroundImage:
        'repeating-linear-gradient(90deg, rgba(18,16,14,0.34) 0px, rgba(18,16,14,0.34) 2px, transparent 2px, transparent 7px)',
    };
  }
  if (kind === 'herringbone_oak') {
    return {
      backgroundColor: hex,
      backgroundImage:
        'repeating-linear-gradient(45deg, rgba(40,26,12,0.16) 0px, rgba(40,26,12,0.16) 2px, transparent 2px, transparent 8px), repeating-linear-gradient(-45deg, rgba(40,26,12,0.14) 0px, rgba(40,26,12,0.14) 2px, transparent 2px, transparent 8px)',
    };
  }
  if (kind === 'plank_oak' || kind === 'plank_walnut' || kind === 'wood') {
    return {
      backgroundColor: hex,
      backgroundImage:
        'repeating-linear-gradient(0deg, rgba(35,22,10,0.18) 0px, rgba(35,22,10,0.18) 1px, transparent 1px, transparent 7px)',
    };
  }
  if (kind === 'marble') {
    return {
      backgroundColor: hex,
      backgroundImage:
        'linear-gradient(125deg, transparent 28%, rgba(110,104,96,0.22) 32%, transparent 36%, transparent 66%, rgba(110,104,96,0.18) 70%, transparent 74%)',
    };
  }
  if (kind === 'boiserie' || kind === 'classic') {
    return {
      backgroundColor: hex,
      boxShadow: 'inset 0 0 0 4px rgba(0,0,0,0.14), inset 0 0 0 6px rgba(255,255,255,0.25)',
    };
  }
  return { backgroundColor: hex };
}

export const BrandCatalogPanel: React.FC<Props> = ({
  project,
  activeWall,
  selection,
  onSelectWall,
  onApplyParquet,
  onApplyWallPanel,
  onApplySkirtingTrim,
  onUpdateSkirtingHeight,
  onToggleCornerTrim,
  onApplyDoorPanel,
  onApplyCountertop,
  onApplyFurniturePanel,
}) => {
  const [brand, setBrand] = useState<'ALL' | SupplierBrand>('ALL');
  const [category, setCategory] = useState<CatalogCategory>('parquet');
  const [query, setQuery] = useState('');
  const [wallApplyMode, setWallApplyMode] = useState<'full' | 'all' | 'zone'>('zone');
  const [trimTarget, setTrimTarget] = useState<'both' | 'baseboard' | 'corner'>('both');

  const normQ = normalizeSearchTr(query);
  const queryColor = useMemo(() => detectQueryColorHex(query), [query]);

  const filterAndRank = <T extends { brand: SupplierBrand; hex: string }>(
    list: T[],
    textOf: (i: T) => string
  ): Array<{ item: T; simPct?: number }> => {
    const out: Array<{ item: T; score: number; simPct?: number }> = [];
    for (const item of list) {
      if (brand !== 'ALL' && item.brand !== brand) continue;
      if (!normQ) {
        out.push({ item, score: 1 });
        continue;
      }
      const hay = normalizeSearchTr(textOf(item));
      const textHit = hay.includes(normQ) || normQ.split(/\s+/).filter((t) => t.length >= 2).some((t) => hay.includes(t));
      const sim = queryColor ? colorSimilarityPct(queryColor.hex, item.hex) : 0;
      if (textHit || sim >= 78) {
        out.push({
          item,
          score: (hay.includes(normQ) ? 100 : textHit ? 50 : 0) + sim,
          simPct: !textHit && sim >= 78 ? sim : undefined,
        });
      }
    }
    if (normQ) out.sort((a, b) => b.score - a.score);
    return out.map(({ item, simPct }) => ({ item, simPct }));
  };

  const filteredParquet = useMemo(
    () => filterAndRank(PARQUET_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name} ${i.finish}`),
    [brand, normQ, queryColor]
  );
  const filteredWall = useMemo(
    () => filterAndRank(WALL_PANEL_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name} ${i.finish}`),
    [brand, normQ, queryColor]
  );
  const filteredSkirting = useMemo(
    () => filterAndRank(SKIRTING_TRIM_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name}`),
    [brand, normQ, queryColor]
  );
  const filteredDoors = useMemo(
    () => filterAndRank(DOOR_PANEL_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name} ${i.finish}`),
    [brand, normQ, queryColor]
  );
  const filteredCountertops = useMemo(
    () => filterAndRank(COUNTERTOP_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name} ${i.finish}`),
    [brand, normQ, queryColor]
  );
  const filteredFurniture = useMemo(
    () => filterAndRank(FURNITURE_PANEL_CATALOG, (i) => `${i.brand} ${i.series} ${i.code} ${i.name} ${i.finish}`),
    [brand, normQ, queryColor]
  );

  const selectedObj = selection?.type === 'object' ? project.objects.find((o) => o.id === selection.id) : null;
  const activeDoor =
    selection?.type === 'door' ? project.doors.find((d) => d.id === selection.id) : project.doors[0];

  return (
    <div className="p-3.5 space-y-3 text-xs">
      {/* Header & Brand Filter */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-900">
            Resmi Marka Kartelaları
          </span>
          <span className="text-[9px] font-mono text-stone-500">10 Büyük Marka · 150+ Kod</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setBrand('ALL')}
            className={`px-2 py-1 border text-[10px] font-semibold transition whitespace-nowrap ${
              brand === 'ALL'
                ? 'border-stone-950 bg-stone-950 text-white'
                : 'border-stone-200 bg-white text-stone-700 hover:border-stone-500'
            }`}
          >
            Tümü
          </button>
          {SUPPLIER_BRANDS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBrand(b)}
              className={`px-2 py-1 border text-[10px] font-semibold transition whitespace-nowrap ${
                brand === b
                  ? 'border-stone-950 bg-stone-950 text-white'
                  : 'border-stone-200 bg-white text-stone-700 hover:border-stone-500'
              }`}
              title={b}
            >
              {SUPPLIER_SHORT[b]}
            </button>
          ))}
        </div>
      </div>

      {/* Category Switcher */}
      <div className="grid grid-cols-2 gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={`px-2 py-1.5 border text-[10px] font-semibold text-left truncate transition ${
              category === c.id
                ? 'border-stone-950 bg-stone-950 text-white'
                : 'border-stone-200 bg-[#faf9f6] text-stone-800 hover:border-stone-500'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Quick Search by Code / Color / Series */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kod veya renk ara: PRK901, LB-2050, 275, meşe..."
          className="w-full pl-8 pr-2.5 py-1.5 border border-stone-300 bg-white text-[11px] focus:outline-none focus:border-stone-950"
        />
      </div>

      {/* Active Spec Summary for Current Category */}
      {category === 'parquet' && (
        <div className="border border-stone-200 bg-[#faf9f6] px-2.5 py-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-mono uppercase text-stone-500">Aktif Zemin Parkesi</p>
            <p className="text-[11px] font-semibold text-stone-900 truncate">
              {project.floorBrandLabel || 'Özel Zemin'}
            </p>
          </div>
          <span
            className="w-5 h-5 border border-black/20 shrink-0"
            style={swatchPatternCss(project.floorMaterial, project.floorTintHex)}
          />
        </div>
      )}

      {category === 'wall' && (
        <div className="border border-stone-200 bg-[#faf9f6] p-2 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {WALL_IDS.map((wId) => (
              <button
                key={wId}
                type="button"
                onClick={() => onSelectWall(wId)}
                className={`py-1 border text-[10px] font-semibold ${
                  activeWall === wId ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700'
                }`}
              >
                {wId === 'north' ? 'Üst A' : wId === 'east' ? 'Sağ B' : wId === 'south' ? 'Alt C' : 'Sol D'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: 'zone', lbl: 'Bölge Panel' },
                { id: 'full', lbl: 'Seçili Duvar' },
                { id: 'all', lbl: '4 Duvara' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setWallApplyMode(m.id)}
                className={`py-1 border text-[10px] font-semibold ${
                  wallApplyMode === m.id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700'
                }`}
              >
                {m.lbl}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-stone-500">
            Hedef: <strong className="text-stone-900">{WALL_LABELS[activeWall]}</strong> ·{' '}
            {wallApplyMode === 'zone' ? 'Duvar profili / panel şeridi ekler' : wallApplyMode === 'all' ? '4 duvarı birden kaplar' : 'Tüm duvarı kaplar'}
          </p>
        </div>
      )}

      {category === 'skirting' && (
        <div className="border border-stone-200 bg-[#faf9f6] p-2 space-y-2">
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                { id: 'both', lbl: 'Süpürgelik + Köşe' },
                { id: 'baseboard', lbl: 'Sadece Süpürgelik' },
                { id: 'corner', lbl: 'Sadece Köşelik' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrimTarget(t.id)}
                className={`py-1 px-1 border text-[9px] font-semibold truncate ${
                  trimTarget === t.id ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white text-stone-700'
                }`}
              >
                {t.lbl}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-stone-600">Yükseklik:</span>
            <div className="flex gap-1">
              {[8, 10, 12, 15].map((cm) => (
                <button
                  key={cm}
                  type="button"
                  onClick={() => onUpdateSkirtingHeight(cm)}
                  className={`px-1.5 py-0.5 border font-mono text-[10px] font-semibold ${
                    (project.baseboardHeightCm ?? 10) === cm
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-200 bg-white text-stone-700'
                  }`}
                >
                  {cm}cm
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between text-[10px] text-stone-700 cursor-pointer pt-0.5 border-t border-stone-200">
            <span>Duvar Köşelik Profilleri ({project.cornerTrimBrandLabel || 'AGT'})</span>
            <input
              type="checkbox"
              checked={project.showCornerTrim !== false}
              onChange={(e) => onToggleCornerTrim(e.target.checked)}
              className="accent-stone-950"
            />
          </label>
        </div>
      )}

      {category === 'door' && (
        <div className="border border-stone-200 bg-[#faf9f6] px-2.5 py-1.5">
          <p className="text-[9px] font-mono uppercase text-stone-500">Aktif Kapı Paneli</p>
          <p className="text-[11px] font-semibold text-stone-900 truncate">
            {activeDoor ? activeDoor.brandLabel || `Kapı (${activeDoor.colorHex})` : 'Odada henüz kapı yok (seçince otomatik eklenir)'}
          </p>
        </div>
      )}

      {category === 'countertop' && (
        <div className="border border-stone-200 bg-[#faf9f6] px-2.5 py-1.5 text-[10px] text-stone-600 leading-snug">
          Tıkladığınız <strong>Technotop / Laminat Tezgah</strong> dokusu odadaki tezgahı anında günceller; odada tezgah yoksa <strong>220×65 cm</strong> yeni tezgah modülü ekler.
        </div>
      )}

      {category === 'furniture' && (
        <div className="border border-stone-200 bg-[#faf9f6] px-2.5 py-1.5 text-[10px] text-stone-600 leading-snug">
          {selectedObj ? (
            <>
              Seçili mobilya: <strong className="text-stone-950">{selectedObj.name}</strong> — tıkladığınız MDF-Lam / panel dekoru anında uygulanır.
            </>
          ) : (
            <>
              3B sahneden bir dolap, kitaplık, masa, TV ünitesi veya konsola tıklayın; ardından buradan <strong>Kastamonu / Yıldız / Starwood / AGT</strong> dekorunu uygulayın.
            </>
          )}
        </div>
      )}

      {/* Swatch Cards Grid */}
      {queryColor && (
        <div className="flex items-center gap-2 px-2 py-1 border border-stone-300 bg-[#faf9f6] text-[10px]">
          <span className="w-3.5 h-3.5 border border-black/25 shrink-0" style={{ backgroundColor: queryColor.hex }} />
          <span className="text-stone-700 truncate">
            <strong>{queryColor.label}</strong> ve yakın renk tonları sıralandı
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        {category === 'parquet' &&
          filteredParquet.map(({ item, simPct }) => {
            const active = project.floorBrandLabel?.includes(item.code);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyParquet(item)}
                className={`w-full p-2 border text-left flex items-center gap-2.5 transition ${
                  active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-950'
                }`}
              >
                <div
                  className="w-11 h-11 border border-black/20 shrink-0"
                  style={swatchPatternCss(item.floorMaterial, item.hex)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-mono uppercase truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {SUPPLIER_SHORT[item.brand]} · {item.series}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1 border shrink-0 ${active ? 'border-white/30 text-white' : 'border-stone-300 text-stone-700 bg-[#faf9f6]'}`}>
                      {item.code}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold truncate">{item.name}</p>
                  <p className={`text-[9px] truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                    {simPct ? `%${simPct} yakın ton · ` : ''}
                    {item.finish}
                  </p>
                </div>
                {active && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}

        {category === 'wall' &&
          filteredWall.map(({ item, simPct }) => {
            const active = project.walls[activeWall]?.brandLabel?.includes(item.code);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyWallPanel(item, wallApplyMode)}
                className={`w-full p-2 border text-left flex items-center gap-2.5 transition ${
                  active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-950'
                }`}
              >
                <div
                  className="w-11 h-11 border border-black/20 shrink-0"
                  style={swatchPatternCss(item.pattern, item.hex)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-mono uppercase truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {SUPPLIER_SHORT[item.brand]} · {item.series}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1 border shrink-0 ${active ? 'border-white/30 text-white' : 'border-stone-300 text-stone-700 bg-[#faf9f6]'}`}>
                      {item.code}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold truncate">{item.name}</p>
                  <p className={`text-[9px] truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                    {simPct ? `%${simPct} yakın ton · ` : ''}
                    {item.finish}
                  </p>
                </div>
              </button>
            );
          })}

        {category === 'skirting' &&
          filteredSkirting.map(({ item, simPct }) => {
            const active = project.baseboardBrandLabel?.includes(item.code) || project.cornerTrimBrandLabel?.includes(item.code);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplySkirtingTrim(item, trimTarget)}
                className={`w-full p-2 border text-left flex items-center gap-2.5 transition ${
                  active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-950'
                }`}
              >
                <div className="w-10 h-10 border border-black/20 shrink-0" style={{ backgroundColor: item.hex }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-mono uppercase truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {SUPPLIER_SHORT[item.brand]} · {item.series}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1 border shrink-0 ${active ? 'border-white/30 text-white' : 'border-stone-300 text-stone-700 bg-[#faf9f6]'}`}>
                      {item.code}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold truncate">{item.name}</p>
                  <p className={`text-[9px] ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                    {simPct ? `%${simPct} yakın ton · ` : ''}Standart {item.defaultHeightCm} cm profil
                  </p>
                </div>
              </button>
            );
          })}

        {category === 'door' &&
          filteredDoors.map(({ item, simPct }) => {
            const active = activeDoor?.brandLabel?.includes(item.code);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyDoorPanel(item)}
                className={`w-full p-2 border text-left flex items-center gap-2.5 transition ${
                  active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-950'
                }`}
              >
                <div
                  className="w-10 h-12 border border-black/20 shrink-0"
                  style={swatchPatternCss(item.panelStyle, item.hex)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-mono uppercase truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {SUPPLIER_SHORT[item.brand]} · {item.series}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1 border shrink-0 ${active ? 'border-white/30 text-white' : 'border-stone-300 text-stone-700 bg-[#faf9f6]'}`}>
                      {item.code}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold truncate">{item.name}</p>
                  <p className={`text-[9px] truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                    {simPct ? `%${simPct} yakın ton · ` : ''}
                    {item.finish}
                  </p>
                </div>
              </button>
            );
          })}

        {category === 'countertop' &&
          filteredCountertops.map(({ item, simPct }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onApplyCountertop(item)}
              className="w-full p-2 border border-stone-200 bg-white hover:border-stone-950 text-left flex items-center gap-2.5 transition"
            >
              <div
                className="w-11 h-11 border border-black/20 shrink-0"
                style={swatchPatternCss(item.surfaceKind, item.hex)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[9px] font-mono uppercase text-stone-500 truncate">
                    {SUPPLIER_SHORT[item.brand]} · {item.series}
                  </span>
                  <span className="text-[9px] font-mono font-bold px-1 border border-stone-300 text-stone-700 bg-[#faf9f6] shrink-0">
                    {item.code}
                  </span>
                </div>
                <p className="text-[11px] font-semibold text-stone-950 truncate">{item.name}</p>
                <p className="text-[9px] text-stone-500 truncate">
                  {simPct ? `%${simPct} yakın ton · ` : ''}
                  {item.finish}
                </p>
              </div>
            </button>
          ))}

        {category === 'furniture' &&
          filteredFurniture.map(({ item, simPct }) => {
            const active = selectedObj?.materialBrandLabel?.includes(item.code);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onApplyFurniturePanel(item)}
                className={`w-full p-2 border text-left flex items-center gap-2.5 transition ${
                  active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-950'
                }`}
              >
                <div className="w-10 h-10 border border-black/20 shrink-0" style={{ backgroundColor: item.hex }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-[9px] font-mono uppercase truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                      {SUPPLIER_SHORT[item.brand]} · {item.series}
                    </span>
                    <span className={`text-[9px] font-mono font-bold px-1 border shrink-0 ${active ? 'border-white/30 text-white' : 'border-stone-300 text-stone-700 bg-[#faf9f6]'}`}>
                      {item.code}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold truncate">{item.name}</p>
                  <p className={`text-[9px] truncate ${active ? 'text-stone-300' : 'text-stone-500'}`}>
                    {simPct ? `%${simPct} yakın ton · ` : ''}
                    {item.finish}
                  </p>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
};
