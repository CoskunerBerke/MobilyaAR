import React from 'react';
import {
  Camera,
  CopyPlus,
  DoorOpen,
  Layers,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react';
import { getWorldAABBSpan } from '../lib/collision2d';
import {
  ARCHITECTURAL_PAINT_SWATCHES,
  DOOR_KIND_LABELS,
  FLOOR_MATERIAL_LABELS,
  FRAME_COLOR_SWATCHES,
  WALL_LABELS,
  WALL_PATTERN_LABELS,
  WINDOW_KIND_LABELS,
  getWallLengthM,
  type ArchBeam,
  type ArchColumn,
  type ArchDoor,
  type ArchPlacedObject,
  type ArchRoomProject,
  type ArchSelection,
  type ArchWallZone,
  type ArchWindow,
  type CurtainStyle,
  type DoorKind,
  type FloorMaterialKind,
  type WallId,
  type WallPattern,
  type WindowKind,
} from './types';

interface Props {
  project: ArchRoomProject;
  selection: NonNullable<ArchSelection>;
  onClose: () => void;
  onSelect: (sel: ArchSelection) => void;
  onUpdateProject: (updater: (prev: ArchRoomProject) => ArchRoomProject) => void;
  onAddWindow: (wall: WallId, kind: WindowKind) => void;
  onAddDoor: (wall: WallId, kind: DoorKind) => void;
  onToggleCove: (wall: WallId) => void;
  onAddWallZone: (wall: WallId, pattern?: WallPattern, colorHex?: string) => void;
  onAddTvOnWall: (wall: WallId) => void;
  onSnapObjectToWall: (objId: string, wall: WallId) => void;
  onDuplicateObject: (objId: string) => void;
  onToast: (msg: string) => void;
}

const WALL_IDS: WallId[] = ['north', 'east', 'south', 'west'];

export const SelectionInspector: React.FC<Props> = ({
  project,
  selection,
  onClose,
  onSelect,
  onUpdateProject,
  onAddWindow,
  onAddDoor,
  onToggleCove,
  onAddWallZone,
  onAddTvOnWall,
  onSnapObjectToWall,
  onDuplicateObject,
  onToast,
}) => {
  const headerBar = (title: string, subtitle: string, onDelete?: () => void) => (
    <div className="px-3.5 py-2.5 border-b border-stone-200 bg-[#faf9f6] flex items-center justify-between gap-2 shrink-0">
      <div className="min-w-0">
        <p className="font-display text-xs font-bold text-stone-950 truncate">{title}</p>
        <p className="text-[10px] font-mono text-stone-500 truncate">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 border border-red-200 hover:border-red-600 bg-red-50 text-red-700"
            title="Sil"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-stone-500 hover:text-stone-950"
          aria-label="Kapat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // 1) SELECTED WALL -> Paint, pattern, partial wall zones, quick add openings/TV!
  if (selection.type === 'wall') {
    const wall = selection.wall;
    const finish = project.walls[wall];
    const wallLenCm = Math.round(getWallLengthM(wall, project.widthM, project.depthM) * 100);
    const zones = (project.wallZones || []).filter((z) => z.wall === wall);
    const hasCove = project.curtainCoves.some((c) => c.wall === wall);

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(WALL_LABELS[wall], `${wallLenCm} × ${Math.round(project.ceilingM * 100)} cm · Dokunarak seçildi`)}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {/* Partial Wall Zone (Duvarın Sadece Bir Kısmını Boya / Kapla!) */}
          <div className="border border-stone-900/20 bg-[#faf9f6] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-stone-900">
                Duvarın Bir Kısmını Kapla / Boya
              </span>
            </div>
            <p className="text-[11px] text-stone-600 leading-snug">
              Bu duvarın sadece seçtiğin cm aralığına ahşap çıta, mermer, ayna veya farklı boya bölgesi ekle.
            </p>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => onAddWallZone(wall, 'slats', '#b9936c')}
                className="px-2 py-1.5 bg-stone-950 hover:bg-stone-800 text-white text-[10px] font-semibold flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Ahşap Çıta Bölge
              </button>
              <button
                type="button"
                onClick={() => onAddWallZone(wall, 'smooth', '#6f7c6b')}
                className="px-2 py-1.5 border border-stone-950 hover:bg-stone-950 hover:text-white text-stone-950 text-[10px] font-semibold flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Kısmi Boya / Panel
              </button>
            </div>
            {zones.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-stone-200">
                {zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => onSelect({ type: 'wallZone', id: z.id })}
                    className="w-full px-2 py-1 border border-stone-200 hover:border-stone-950 bg-white flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate font-medium">
                      {WALL_PATTERN_LABELS[z.pattern]} ({z.widthCm} cm)
                    </span>
                    <span className="w-3 h-3 border border-black/20 shrink-0" style={{ backgroundColor: z.colorHex }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Full Wall Color & Pattern */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Tüm Duvar Rengi</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={finish.colorHex}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      walls: { ...p.walls, [wall]: { ...p.walls[wall], colorHex: e.target.value } },
                    }))
                  }
                  className="w-6 h-5 border border-stone-300 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => {
                    onUpdateProject((p) => ({
                      ...p,
                      walls: { north: { ...finish }, east: { ...finish }, south: { ...finish }, west: { ...finish } },
                    }));
                    onToast('Bu renk ve kaplama 4 duvara birden uygulandı.');
                  }}
                  className="text-[10px] font-semibold underline text-stone-600 hover:text-stone-950"
                >
                  Tüm Duvarlara
                </button>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {ARCHITECTURAL_PAINT_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  title={sw.name}
                  onClick={() =>
                    onUpdateProject((p) => ({
                      ...p,
                      walls: { ...p.walls, [wall]: { ...p.walls[wall], colorHex: sw.hex } },
                    }))
                  }
                  className={`h-6 border ${
                    finish.colorHex.toLowerCase() === sw.hex.toLowerCase()
                      ? 'border-stone-950 ring-1 ring-stone-950'
                      : 'border-stone-300'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Duvar Kaplaması</span>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(WALL_PATTERN_LABELS) as WallPattern[]).map((pat) => (
                <button
                  key={pat}
                  type="button"
                  onClick={() =>
                    onUpdateProject((p) => ({
                      ...p,
                      walls: { ...p.walls, [wall]: { ...p.walls[wall], pattern: pat } },
                    }))
                  }
                  className={`px-2 py-1.5 border text-[11px] font-medium text-left truncate ${
                    finish.pattern === pat ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-500'
                  }`}
                >
                  {WALL_PATTERN_LABELS[pat]}
                </button>
              ))}
            </div>
          </div>

          {/* Quick Actions Right On This Wall */}
          <div className="border-t border-stone-200 pt-3 space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Bu Duvara Hızlı Ekle</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onAddWindow(wall, 'double')}
                className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-semibold"
              >
                + Pencere
              </button>
              <button
                type="button"
                onClick={() => onAddDoor(wall, 'single')}
                className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-semibold"
              >
                + Kapı
              </button>
              <button
                type="button"
                onClick={() => onToggleCove(wall)}
                className={`px-2 py-1.5 border text-[11px] font-semibold ${
                  hasCove ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-300 bg-white hover:border-stone-950'
                }`}
              >
                {hasCove ? '✓ Perde Havuzu' : '+ Perde Havuzu'}
              </button>
              <button
                type="button"
                onClick={() => onAddTvOnWall(wall)}
                className="px-2 py-1.5 border border-stone-300 hover:border-stone-950 bg-white text-[11px] font-semibold"
              >
                + Duvar TV
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2) SELECTED PARTIAL WALL ZONE -> Resize, slide, recolor, swap material (wood slats, marble, mirror, paint...)
  if (selection.type === 'wallZone') {
    const zone = (project.wallZones || []).find((z) => z.id === selection.id);
    if (!zone) return null;
    const wallLenCm = Math.round(getWallLengthM(zone.wall, project.widthM, project.depthM) * 100);
    const ceilCm = Math.round(project.ceilingM * 100);
    const patchZone = (patch: Partial<ArchWallZone>) =>
      onUpdateProject((p) => ({
        ...p,
        wallZones: (p.wallZones || []).map((z) => (z.id === zone.id ? { ...z, ...patch } : z)),
      }));

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(
          `Duvar Bölgesi · ${WALL_PATTERN_LABELS[zone.pattern]}`,
          `${WALL_LABELS[zone.wall]} · ${zone.widthCm} × ${zone.heightCm} cm`,
          () => {
            onUpdateProject((p) => ({ ...p, wallZones: (p.wallZones || []).filter((z) => z.id !== zone.id) }));
            onSelect({ type: 'wall', wall: zone.wall });
          }
        )}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          <div className="space-y-2">
            <label className="block text-[10px] text-stone-600">
              Soldan Konum: <strong className="font-mono">{Math.round(zone.offsetCm)} cm</strong>
              <input
                type="range"
                min={Math.round(zone.widthCm / 2)}
                max={Math.max(Math.round(zone.widthCm / 2) + 5, wallLenCm - Math.round(zone.widthCm / 2))}
                value={zone.offsetCm}
                onChange={(e) => patchZone({ offsetCm: Number(e.target.value) })}
                className="w-full accent-stone-950"
              />
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="text-[10px] text-stone-600">
                Genişlik
                <input
                  type="number"
                  min={20}
                  max={wallLenCm}
                  step={5}
                  value={zone.widthCm}
                  onChange={(e) => patchZone({ widthCm: Math.max(20, Math.min(wallLenCm, Number(e.target.value) || 120)) })}
                  className="w-full px-1.5 py-1 border border-stone-300 font-mono text-[11px]"
                />
              </label>
              <label className="text-[10px] text-stone-600">
                Yükseklik
                <input
                  type="number"
                  min={20}
                  max={ceilCm}
                  step={5}
                  value={zone.heightCm}
                  onChange={(e) => patchZone({ heightCm: Math.max(20, Math.min(ceilCm, Number(e.target.value) || ceilCm)) })}
                  className="w-full px-1.5 py-1 border border-stone-300 font-mono text-[11px]"
                />
              </label>
              <label className="text-[10px] text-stone-600">
                Yerden Y
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, ceilCm - 20)}
                  step={5}
                  value={zone.bottomCm}
                  onChange={(e) => patchZone({ bottomCm: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-full px-1.5 py-1 border border-stone-300 font-mono text-[11px]"
                />
              </label>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => patchZone({ bottomCm: 0, heightCm: ceilCm })}
                className="flex-1 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[10px] font-semibold"
              >
                Tam Tavan Boyu
              </button>
              <button
                type="button"
                onClick={() => patchZone({ bottomCm: 0, heightCm: 115, widthCm: wallLenCm, offsetCm: Math.round(wallLenCm / 2) })}
                className="flex-1 py-1 border border-stone-300 hover:border-stone-950 bg-[#faf9f6] text-[10px] font-semibold"
              >
                Yarım Lambri (115 cm)
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Bölge Kaplaması</span>
            <div className="grid grid-cols-2 gap-1">
              {(Object.keys(WALL_PATTERN_LABELS) as WallPattern[]).map((pat) => (
                <button
                  key={pat}
                  type="button"
                  onClick={() => patchZone({ pattern: pat })}
                  className={`px-2 py-1.5 border text-[11px] font-medium text-left truncate ${
                    zone.pattern === pat ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-500'
                  }`}
                >
                  {WALL_PATTERN_LABELS[pat]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Bölge Rengi</span>
              <input
                type="color"
                value={zone.colorHex}
                onChange={(e) => patchZone({ colorHex: e.target.value })}
                className="w-6 h-5 border border-stone-300 cursor-pointer"
              />
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {ARCHITECTURAL_PAINT_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  title={sw.name}
                  onClick={() => patchZone({ colorHex: sw.hex })}
                  className={`h-6 border ${
                    zone.colorHex.toLowerCase() === sw.hex.toLowerCase()
                      ? 'border-stone-950 ring-1 ring-stone-950'
                      : 'border-stone-300'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3) SELECTED FLOOR -> Instant floor material & tint
  if (selection.type === 'floor') {
    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar('Oda Zemini', `${(project.widthM * project.depthM).toFixed(1)} m² · Dokunarak seçildi`)}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Zemin Malzemesi</span>
              <input
                type="color"
                value={project.floorTintHex}
                onChange={(e) => onUpdateProject((p) => ({ ...p, floorTintHex: e.target.value }))}
                title="Özel Zemin Rengi"
                className="w-6 h-5 border border-stone-300 cursor-pointer"
              />
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {(Object.keys(FLOOR_MATERIAL_LABELS) as FloorMaterialKind[]).map((fm) => {
                const info = FLOOR_MATERIAL_LABELS[fm];
                const active = project.floorMaterial === fm;
                return (
                  <button
                    key={fm}
                    type="button"
                    onClick={() => onUpdateProject((p) => ({ ...p, floorMaterial: fm, floorTintHex: info.defaultTint }))}
                    className={`px-2.5 py-2 border flex items-center gap-2 text-[11px] font-semibold ${
                      active ? 'border-stone-950 bg-stone-950 text-white' : 'border-stone-200 bg-white hover:border-stone-500'
                    }`}
                  >
                    <span className="w-3.5 h-3.5 border border-black/20 shrink-0" style={{ backgroundColor: info.defaultTint }} />
                    <span>{info.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-stone-200 pt-3 grid grid-cols-2 gap-2">
            <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
              <span className="text-[10px] text-stone-600">Tavan</span>
              <input
                type="color"
                value={project.ceilingColorHex}
                onChange={(e) => onUpdateProject((p) => ({ ...p, ceilingColorHex: e.target.value }))}
                className="w-6 h-5 border border-stone-300 cursor-pointer"
              />
            </label>
            <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
              <span className="text-[10px] text-stone-600">Süpürgelik</span>
              <input
                type="color"
                value={project.baseboardColorHex}
                onChange={(e) => onUpdateProject((p) => ({ ...p, baseboardColorHex: e.target.value }))}
                className="w-6 h-5 border border-stone-300 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  // 4) SELECTED WINDOW (clicked directly in 3D!)
  if (selection.type === 'window') {
    const win = project.windows.find((w) => w.id === selection.id);
    if (!win) return null;
    const wallLenCm = Math.round(getWallLengthM(win.wall, project.widthM, project.depthM) * 100);
    const patchWin = (patch: Partial<ArchWindow>) =>
      onUpdateProject((p) => ({ ...p, windows: p.windows.map((w) => (w.id === win.id ? { ...w, ...patch } : w)) }));

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(
          WINDOW_KIND_LABELS[win.kind],
          `${WALL_LABELS[win.wall]} · ${win.widthCm} × ${win.heightCm} cm`,
          () => {
            onUpdateProject((p) => ({ ...p, windows: p.windows.filter((w) => w.id !== win.id) }));
            onClose();
          }
        )}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          <label className="block space-y-1">
            <span className="text-[10px] font-mono uppercase text-stone-500">Pencere Tipi</span>
            <select
              value={win.kind}
              onChange={(e) => patchWin({ kind: e.target.value as WindowKind })}
              className="w-full px-2 py-1.5 border border-stone-300 bg-white font-semibold text-xs"
            >
              {(Object.keys(WINDOW_KIND_LABELS) as WindowKind[]).map((k) => (
                <option key={k} value={k}>
                  {WINDOW_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[10px] text-stone-600">
            Soldan Konum: <strong className="font-mono">{Math.round(win.offsetCm)} cm</strong>
            <input
              type="range"
              min={Math.round(win.widthCm * 0.5) + 10}
              max={Math.max(Math.round(win.widthCm * 0.5) + 12, wallLenCm - Math.round(win.widthCm * 0.5) - 10)}
              value={win.offsetCm}
              onChange={(e) => patchWin({ offsetCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>

          <label className="block text-[10px] text-stone-600">
            Parapet (Yerden): <strong className="font-mono">{Math.round(win.sillHeightCm)} cm</strong>
            <input
              type="range"
              min={0}
              max={Math.max(10, Math.round(project.ceilingM * 100 - win.heightCm - 10))}
              value={win.sillHeightCm}
              onChange={(e) => patchWin({ sillHeightCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-stone-600">
              Genişlik (cm)
              <input
                type="number"
                min={40}
                max={wallLenCm - 20}
                step={5}
                value={win.widthCm}
                onChange={(e) => patchWin({ widthCm: Math.max(40, Number(e.target.value) || 120) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Yükseklik (cm)
              <input
                type="number"
                min={40}
                max={Math.round(project.ceilingM * 100) - 12}
                step={5}
                value={win.heightCm}
                onChange={(e) => patchWin({ heightCm: Math.max(40, Number(e.target.value) || 140) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5">
              {FRAME_COLOR_SWATCHES.map((fc) => (
                <button
                  key={fc.hex}
                  type="button"
                  title={fc.name}
                  onClick={() => patchWin({ frameColorHex: fc.hex })}
                  className={`w-5 h-5 border ${win.frameColorHex === fc.hex ? 'border-stone-950 ring-1 ring-stone-950' : 'border-stone-300'}`}
                  style={{ backgroundColor: fc.hex }}
                />
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={win.hasSill}
                onChange={(e) => patchWin({ hasSill: e.target.checked })}
                className="accent-stone-950"
              />
              <span>Denizlik</span>
            </label>
          </div>

          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase text-stone-500">Perde</span>
            <div className="flex gap-1.5">
              <select
                value={win.curtainStyle}
                onChange={(e) => patchWin({ curtainStyle: e.target.value as CurtainStyle })}
                className="flex-1 px-2 py-1.5 border border-stone-300 bg-white text-[11px] font-semibold"
              >
                <option value="none">Perde Yok</option>
                <option value="sheer_and_drape">Tül + Fon Perde</option>
                <option value="sheer_only">Sadece Tül</option>
                <option value="roman_blind">Stor Perde</option>
              </select>
              {win.curtainStyle !== 'none' && (
                <input
                  type="color"
                  value={win.curtainColorHex}
                  onChange={(e) => patchWin({ curtainColorHex: e.target.value })}
                  className="w-7 h-7 border border-stone-300 cursor-pointer"
                />
              )}
            </div>
            {win.curtainStyle !== 'none' && (
              <label className="block text-[10px] text-stone-600">
                Perde Açıklığı: <strong className="font-mono">{Math.round(win.curtainOpenRatio * 100)}%</strong>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={win.curtainOpenRatio}
                  onChange={(e) => patchWin({ curtainOpenRatio: Number(e.target.value) })}
                  className="w-full accent-stone-950"
                />
              </label>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 5) SELECTED DOOR (clicked directly in 3D!)
  if (selection.type === 'door') {
    const door = project.doors.find((d) => d.id === selection.id);
    if (!door) return null;
    const wallLenCm = Math.round(getWallLengthM(door.wall, project.widthM, project.depthM) * 100);
    const patchDoor = (patch: Partial<ArchDoor>) =>
      onUpdateProject((p) => ({ ...p, doors: p.doors.map((d) => (d.id === door.id ? { ...d, ...patch } : d)) }));

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(
          DOOR_KIND_LABELS[door.kind],
          `${WALL_LABELS[door.wall]} · ${door.widthCm} × ${door.heightCm} cm`,
          () => {
            onUpdateProject((p) => ({ ...p, doors: p.doors.filter((d) => d.id !== door.id) }));
            onClose();
          }
        )}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
          <select
            value={door.kind}
            onChange={(e) => patchDoor({ kind: e.target.value as DoorKind })}
            className="w-full px-2 py-1.5 border border-stone-300 bg-white font-semibold text-xs"
          >
            {(Object.keys(DOOR_KIND_LABELS) as DoorKind[]).map((k) => (
              <option key={k} value={k}>
                {DOOR_KIND_LABELS[k]}
              </option>
            ))}
          </select>

          {door.kind !== 'archway' && (
            <div className="space-y-1.5">
              {door.kind !== 'sliding' && (
                <div className="grid grid-cols-2 border border-stone-300 bg-white">
                  <button
                    type="button"
                    onClick={() => patchDoor({ swing: 'inward' })}
                    className={`py-1.5 text-[11px] font-semibold ${door.swing === 'inward' ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
                  >
                    İçeri Açılır
                  </button>
                  <button
                    type="button"
                    onClick={() => patchDoor({ swing: 'outward' })}
                    className={`py-1.5 text-[11px] font-semibold ${door.swing === 'outward' ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
                  >
                    Dışarı Açılır
                  </button>
                </div>
              )}
              {door.kind !== 'double' && (
                <div className="grid grid-cols-2 border border-stone-300 bg-white">
                  <button
                    type="button"
                    onClick={() => patchDoor({ hinge: 'left' })}
                    className={`py-1.5 text-[11px] font-semibold ${door.hinge === 'left' ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
                  >
                    Sol Menteşe
                  </button>
                  <button
                    type="button"
                    onClick={() => patchDoor({ hinge: 'right' })}
                    className={`py-1.5 text-[11px] font-semibold ${door.hinge === 'right' ? 'bg-stone-950 text-white' : 'text-stone-700'}`}
                  >
                    Sağ Menteşe
                  </button>
                </div>
              )}
              <label className="block text-[10px] text-stone-600 pt-1">
                Açılış Açısı: <strong className="font-mono">{Math.round(door.openAngleDeg)}°</strong>
                <input
                  type="range"
                  min={0}
                  max={110}
                  value={door.openAngleDeg}
                  onChange={(e) => patchDoor({ openAngleDeg: Number(e.target.value) })}
                  className="w-full accent-stone-950"
                />
              </label>
            </div>
          )}

          <label className="block text-[10px] text-stone-600">
            Soldan Konum: <strong className="font-mono">{Math.round(door.offsetCm)} cm</strong>
            <input
              type="range"
              min={Math.round(door.widthCm * 0.5) + 10}
              max={Math.max(Math.round(door.widthCm * 0.5) + 12, wallLenCm - Math.round(door.widthCm * 0.5) - 10)}
              value={door.offsetCm}
              onChange={(e) => patchDoor({ offsetCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-stone-600">
              Genişlik (cm)
              <input
                type="number"
                min={70}
                max={260}
                step={5}
                value={door.widthCm}
                onChange={(e) => patchDoor({ widthCm: Math.max(70, Number(e.target.value) || 95) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Kanat Rengi
              <div className="flex items-center gap-1.5 mt-1">
                <input
                  type="color"
                  value={door.colorHex}
                  onChange={(e) => patchDoor({ colorHex: e.target.value })}
                  className="w-7 h-6 border border-stone-300 cursor-pointer"
                />
                <span className="font-mono text-[10px]">{door.colorHex}</span>
              </div>
            </label>
          </div>
        </div>
      </div>
    );
  }

  // 6) SELECTED COLUMN
  if (selection.type === 'column') {
    const col = project.columns.find((c) => c.id === selection.id);
    if (!col) return null;
    const halfW = Math.round(project.widthM * 50);
    const halfD = Math.round(project.depthM * 50);
    const patchCol = (patch: Partial<ArchColumn>) =>
      onUpdateProject((p) => ({ ...p, columns: p.columns.map((c) => (c.id === col.id ? { ...c, ...patch } : c)) }));

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(
          col.shape === 'round' ? 'Yuvarlak / Oval Kolon' : 'Kare / Dikdörtgen Kolon',
          `${col.widthCm} × ${col.depthCm} cm`,
          () => {
            onUpdateProject((p) => ({ ...p, columns: p.columns.filter((c) => c.id !== col.id) }));
            onClose();
          }
        )}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          <div className="grid grid-cols-2 border border-stone-300">
            <button
              type="button"
              onClick={() => patchCol({ shape: 'rect' })}
              className={`py-1.5 text-[11px] font-semibold ${col.shape === 'rect' ? 'bg-stone-950 text-white' : 'bg-white'}`}
            >
              Dikdörtgen
            </button>
            <button
              type="button"
              onClick={() => patchCol({ shape: 'round' })}
              className={`py-1.5 text-[11px] font-semibold ${col.shape === 'round' ? 'bg-stone-950 text-white' : 'bg-white'}`}
            >
              Yuvarlak / Oval
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-stone-600">
              En (cm)
              <input
                type="number"
                min={15}
                max={140}
                step={5}
                value={col.widthCm}
                onChange={(e) => patchCol({ widthCm: Number(e.target.value) || 40 })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Derinlik (cm)
              <input
                type="number"
                min={15}
                max={140}
                step={5}
                value={col.depthCm}
                onChange={(e) => patchCol({ depthCm: Number(e.target.value) || 40 })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
          </div>
          <label className="block text-[10px] text-stone-600">
            X Konum: <strong className="font-mono">{col.xCm} cm</strong>
            <input
              type="range"
              min={-halfW + 15}
              max={halfW - 15}
              value={col.xCm}
              onChange={(e) => patchCol({ xCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>
          <label className="block text-[10px] text-stone-600">
            Z Konum: <strong className="font-mono">{col.zCm} cm</strong>
            <input
              type="range"
              min={-halfD + 15}
              max={halfD - 15}
              value={col.zCm}
              onChange={(e) => patchCol({ zCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-stone-600">Kolon Rengi</span>
            <input
              type="color"
              value={col.colorHex}
              onChange={(e) => patchCol({ colorHex: e.target.value })}
              className="w-7 h-6 border border-stone-300 cursor-pointer"
            />
          </div>
        </div>
      </div>
    );
  }

  // 7) SELECTED BEAM
  if (selection.type === 'beam') {
    const beam = project.beams.find((b) => b.id === selection.id);
    if (!beam) return null;
    const spanHalf = Math.round((beam.axis === 'x' ? project.depthM : project.widthM) * 50);
    const patchBeam = (patch: Partial<ArchBeam>) =>
      onUpdateProject((p) => ({ ...p, beams: p.beams.map((b) => (b.id === beam.id ? { ...b, ...patch } : b)) }));

    return (
      <div className="flex flex-col h-full text-xs">
        {headerBar(
          beam.axis === 'x' ? 'Yatay Tavan Kirişi' : 'Dikey Tavan Kirişi',
          `${beam.widthCm} × ${beam.dropCm} cm sarkma`,
          () => {
            onUpdateProject((p) => ({ ...p, beams: p.beams.filter((b) => b.id !== beam.id) }));
            onClose();
          }
        )}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          <label className="block text-[10px] text-stone-600">
            Konum: <strong className="font-mono">{beam.positionCm} cm</strong>
            <input
              type="range"
              min={-spanHalf + 15}
              max={spanHalf - 15}
              value={beam.positionCm}
              onChange={(e) => patchBeam({ positionCm: Number(e.target.value) })}
              className="w-full accent-stone-950"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-stone-600">
              Genişlik (cm)
              <input
                type="number"
                min={15}
                max={80}
                step={5}
                value={beam.widthCm}
                onChange={(e) => patchBeam({ widthCm: Number(e.target.value) || 30 })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Sarkma (cm)
              <input
                type="number"
                min={10}
                max={75}
                step={5}
                value={beam.dropCm}
                onChange={(e) => patchBeam({ dropCm: Number(e.target.value) || 32 })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-stone-600">Kiriş Rengi</span>
            <input
              type="color"
              value={beam.colorHex}
              onChange={(e) => patchBeam({ colorHex: e.target.value })}
              className="w-7 h-6 border border-stone-300 cursor-pointer"
            />
          </div>
        </div>
      </div>
    );
  }

  // 8) SELECTED 3D OBJECT (TV, Fireplace, Sofa, Wardrobe, Chandelier, etc.)
  const obj = project.objects.find((o) => o.id === selection.id);
  if (!obj) return null;

  const { extX, extZ } = getWorldAABBSpan(obj.rot, obj.widthM * 0.5, obj.depthM * 0.5);
  const clrLeft = Math.max(0, Math.round((obj.x - extX + project.widthM * 0.5) * 100));
  const clrRight = Math.max(0, Math.round((project.widthM * 0.5 - (obj.x + extX)) * 100));
  const clrNorth = Math.max(0, Math.round((obj.z - extZ + project.depthM * 0.5) * 100));

  const patchObj = (patch: Partial<ArchPlacedObject>) =>
    onUpdateProject((p) => ({
      ...p,
      objects: p.objects.map((o) => {
        if (o.id !== obj.id) return o;
        const next = { ...o, ...patch };
        next.dimensionsCm = `${Math.round(next.widthM * 100)} × ${Math.round(next.depthM * 100)} × ${Math.round(
          next.heightM * 100
        )} cm`;
        return next;
      }),
    }));

  return (
    <div className="flex flex-col h-full text-xs">
      {headerBar(obj.name, `${obj.dimensionsCm} · Sol ${clrLeft} · Üst ${clrNorth} cm`, () => {
        onUpdateProject((p) => ({ ...p, objects: p.objects.filter((o) => o.id !== obj.id) }));
        onClose();
      })}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Exact cm dimensions + elevation Y */}
        <div className="space-y-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Ölçü &amp; Yükseklik (cm)</span>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-stone-600">
              En (cm)
              <input
                type="number"
                min={20}
                max={600}
                step={5}
                value={Math.round(obj.widthM * 100)}
                onChange={(e) => patchObj({ widthM: Math.max(0.2, (Number(e.target.value) || 100) / 100) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Derinlik (cm)
              <input
                type="number"
                min={3}
                max={500}
                step={5}
                value={Math.round(obj.depthM * 100)}
                onChange={(e) => patchObj({ depthM: Math.max(0.03, (Number(e.target.value) || 60) / 100) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Yükseklik (cm)
              <input
                type="number"
                min={2}
                max={450}
                step={5}
                value={Math.round(obj.heightM * 100)}
                onChange={(e) => patchObj({ heightM: Math.max(0.02, (Number(e.target.value) || 80) / 100) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-stone-600">
              Yerden Y (cm)
              <input
                type="number"
                min={0}
                max={Math.round(project.ceilingM * 100)}
                step={5}
                value={Math.round(obj.y * 100)}
                onChange={(e) => patchObj({ y: Math.max(0, (Number(e.target.value) || 0) / 100) })}
                className="w-full px-2 py-1 border border-stone-300 font-mono text-xs"
              />
            </label>
          </div>
          <p className="text-[10px] font-mono text-stone-500">
            Duvar boşlukları: Sol {clrLeft} cm · Sağ {clrRight} cm · Üst {clrNorth} cm
          </p>
        </div>

        {/* Rotate & Duplicate */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Yön &amp; İşlem</span>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={() => patchObj({ rot: obj.rot - Math.PI / 12 })}
              className="py-1.5 border border-stone-300 hover:border-stone-950 bg-white flex items-center justify-center"
              title="-15°"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => patchObj({ rot: obj.rot + Math.PI / 12 })}
              className="py-1.5 border border-stone-300 hover:border-stone-950 bg-white flex items-center justify-center"
              title="+15°"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => patchObj({ rot: obj.rot + Math.PI / 2 })}
              className="py-1.5 border border-stone-300 hover:border-stone-950 bg-white font-mono text-[11px] font-bold"
            >
              90°
            </button>
            <button
              type="button"
              onClick={() => onDuplicateObject(obj.id)}
              className="py-1.5 border border-stone-300 hover:border-stone-950 bg-white flex items-center justify-center"
              title="Çoğalt"
            >
              <CopyPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Snap to Wall */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Duvara Sıfır Yasla</span>
          <div className="grid grid-cols-4 gap-1">
            {WALL_IDS.map((wId) => (
              <button
                key={wId}
                type="button"
                onClick={() => onSnapObjectToWall(obj.id, wId)}
                className="py-1.5 border border-stone-300 hover:border-stone-950 hover:bg-stone-950 hover:text-white bg-[#faf9f6] text-[10px] font-semibold transition"
              >
                {wId === 'north' ? 'Üst A' : wId === 'east' ? 'Sağ B' : wId === 'south' ? 'Alt C' : 'Sol D'}
              </button>
            ))}
          </div>
        </div>

        {/* Colors for parametric modules */}
        {obj.parametricKind && (
          <div className="border-t border-stone-200 pt-3 space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">Malzeme Rengi</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
                <span className="text-[10px] text-stone-600">Ana Renk</span>
                <input
                  type="color"
                  value={obj.parametricColorHex || '#ece9e2'}
                  onChange={(e) => patchObj({ parametricColorHex: e.target.value })}
                  className="w-6 h-5 border border-stone-300 cursor-pointer"
                />
              </label>
              <label className="flex items-center justify-between border border-stone-200 px-2 py-1.5 bg-[#faf9f6]">
                <span className="text-[10px] text-stone-600">Detay</span>
                <input
                  type="color"
                  value={obj.parametricAccentHex || '#272624'}
                  onChange={(e) => patchObj({ parametricAccentHex: e.target.value })}
                  className="w-6 h-5 border border-stone-300 cursor-pointer"
                />
              </label>
            </div>
          </div>
        )}

        {obj.glbUrl && (
          <a
            href={
              obj.productRef?.id
                ? `/?urun=${encodeURIComponent(obj.productRef.id)}&mod=ar`
                : `/?glb=${encodeURIComponent(obj.glbUrl)}&name=${encodeURIComponent(obj.name)}&mod=ar`
            }
            target="_blank"
            rel="noreferrer"
            className="w-full py-2 bg-stone-950 hover:bg-stone-800 text-white font-semibold flex items-center justify-center gap-1.5"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Bu Ürünü Canlı AR&apos;da Aç</span>
          </a>
        )}
      </div>
    </div>
  );
};

// Keep lucide icon imports clean
export const _unusedIcons = { DoorOpen, Layers };
