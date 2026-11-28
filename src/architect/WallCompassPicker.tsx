import React from 'react';
import { WALL_LABELS, type ArchRoomProject, type WallId } from './types';

interface Props {
  value: WallId;
  onChange: (wall: WallId) => void;
  project?: Pick<ArchRoomProject, 'widthM' | 'depthM' | 'walls' | 'windows' | 'doors' | 'adjacentRooms'>;
  /** Optional subtitle inside the center floor box */
  centerLabel?: string;
  /** Optional room id to detect attached neighboring rooms on each side */
  parentRoomId?: string;
  /** Slightly shorter vertical footprint for right-inspector panels */
  compact?: boolean;
}

export const WallCompassPicker: React.FC<Props> = ({
  value,
  onChange,
  project,
  centerLabel,
  parentRoomId = 'main',
  compact = false,
}) => {
  const getWallMeta = (w: WallId) => {
    const lenM = project ? (w === 'north' || w === 'south' ? project.widthM : project.depthM) : null;
    const wins = project ? project.windows.filter((x) => x.wall === w).length : 0;
    const doors = project ? project.doors.filter((x) => x.wall === w).length : 0;
    const adj = project?.adjacentRooms?.find((r) => r.parentRoomId === parentRoomId && r.attachedSide === w);
    const colorHex = project?.walls?.[w]?.colorHex;

    const tags: string[] = [];
    if (wins > 0) tags.push(`${wins}P`);
    if (doors > 0) tags.push(`${doors}K`);
    if (adj) tags.push(adj.name.split(' ')[0]);

    const detailParts: string[] = [];
    if (lenM !== null) detailParts.push(`${lenM.toFixed(1)} m`);
    if (wins > 0) detailParts.push(`${wins} pencere`);
    if (doors > 0) detailParts.push(`${doors} kapı`);
    if (adj) detailParts.push(`→ ${adj.name}`);

    return {
      lenText: lenM !== null ? `${lenM.toFixed(1)}m` : '',
      tagText: tags.join(' · '),
      detailText: detailParts.join(' · '),
      colorHex,
    };
  };

  const northMeta = getWallMeta('north');
  const eastMeta = getWallMeta('east');
  const southMeta = getWallMeta('south');
  const westMeta = getWallMeta('west');
  const activeMeta = getWallMeta(value);

  const edgeBtn = (active: boolean) =>
    `border transition flex items-center justify-center gap-1.5 select-none ${
      active
        ? 'border-stone-950 bg-stone-950 text-white font-bold shadow-xs'
        : 'border-stone-300 bg-white hover:border-stone-950 hover:bg-stone-50 text-stone-800 font-semibold'
    }`;

  return (
    <div className="border border-stone-200 bg-[#faf9f6] p-2 space-y-1.5">
      {/* Top Edge: Karşı Duvar (north) */}
      <button
        type="button"
        onClick={() => onChange('north')}
        title={`Karşı Duvar${northMeta.detailText ? ` (${northMeta.detailText})` : ''}`}
        className={`w-full ${compact ? 'py-1 px-2' : 'py-1.5 px-2.5'} text-[11px] ${edgeBtn(value === 'north')}`}
      >
        {northMeta.colorHex && (
          <span
            className="w-2.5 h-2.5 border border-black/25 shrink-0"
            style={{ backgroundColor: northMeta.colorHex }}
          />
        )}
        <span className="whitespace-nowrap">Karşı Duvar</span>
        {northMeta.lenText && (
          <span className={`font-mono text-[9px] whitespace-nowrap ${value === 'north' ? 'text-stone-300' : 'text-stone-500'}`}>
            {northMeta.lenText}
          </span>
        )}
        {northMeta.tagText && (
          <span
            className={`font-mono text-[9px] px-1 whitespace-nowrap ${
              value === 'north' ? 'bg-white/15 text-white' : 'bg-stone-200/80 text-stone-700'
            }`}
          >
            {northMeta.tagText}
          </span>
        )}
      </button>

      {/* Middle Row: Sol Duvar | Room Floor Schematic | Sağ Duvar */}
      <div className={`grid grid-cols-[64px_1fr_64px] gap-1.5 items-stretch ${compact ? 'min-h-[54px]' : 'min-h-[68px]'}`}>
        {/* Left Edge: Sol Duvar (west) */}
        <button
          type="button"
          onClick={() => onChange('west')}
          title={`Sol Duvar${westMeta.detailText ? ` (${westMeta.detailText})` : ''}`}
          className={`flex-col py-1 px-1 text-[10px] leading-tight ${edgeBtn(value === 'west')}`}
        >
          <span className="flex items-center gap-1">
            {westMeta.colorHex && (
              <span
                className="w-2 h-2 border border-black/25 shrink-0"
                style={{ backgroundColor: westMeta.colorHex }}
              />
            )}
            <span>Sol</span>
          </span>
          {westMeta.lenText && (
            <span className={`font-mono text-[9px] ${value === 'west' ? 'text-stone-300' : 'text-stone-500'}`}>
              {westMeta.lenText}
            </span>
          )}
          {westMeta.tagText && (
            <span className={`font-mono text-[8px] truncate max-w-full ${value === 'west' ? 'text-stone-200' : 'text-stone-600'}`}>
              {westMeta.tagText}
            </span>
          )}
        </button>

        {/* Center Floor Plan Schematic */}
        <div className="border border-dashed border-stone-300 bg-white/80 px-2 py-1.5 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <span className="text-[9px] font-mono uppercase tracking-wider text-stone-400 leading-none">
            {centerLabel || 'Oda Kuşbakışı'}
          </span>
          <span className="text-[11px] font-bold text-stone-950 leading-tight mt-0.5 truncate max-w-full">
            {WALL_LABELS[value]}
          </span>
          {activeMeta.detailText ? (
            <span className="text-[9px] text-stone-500 leading-tight mt-0.5 truncate max-w-full">
              {activeMeta.detailText}
            </span>
          ) : (
            <span className="text-[9px] text-stone-400 leading-tight mt-0.5">
              Üstten oda planı
            </span>
          )}
          <span className="text-[8px] font-mono text-stone-400 mt-0.5 leading-none">
            ▲ Bakış yönü
          </span>
        </div>

        {/* Right Edge: Sağ Duvar (east) */}
        <button
          type="button"
          onClick={() => onChange('east')}
          title={`Sağ Duvar${eastMeta.detailText ? ` (${eastMeta.detailText})` : ''}`}
          className={`flex-col py-1 px-1 text-[10px] leading-tight ${edgeBtn(value === 'east')}`}
        >
          <span className="flex items-center gap-1">
            {eastMeta.colorHex && (
              <span
                className="w-2 h-2 border border-black/25 shrink-0"
                style={{ backgroundColor: eastMeta.colorHex }}
              />
            )}
            <span>Sağ</span>
          </span>
          {eastMeta.lenText && (
            <span className={`font-mono text-[9px] ${value === 'east' ? 'text-stone-300' : 'text-stone-500'}`}>
              {eastMeta.lenText}
            </span>
          )}
          {eastMeta.tagText && (
            <span className={`font-mono text-[8px] truncate max-w-full ${value === 'east' ? 'text-stone-200' : 'text-stone-600'}`}>
              {eastMeta.tagText}
            </span>
          )}
        </button>
      </div>

      {/* Bottom Edge: Ön Duvar (south) */}
      <button
        type="button"
        onClick={() => onChange('south')}
        title={`Ön Duvar${southMeta.detailText ? ` (${southMeta.detailText})` : ''}`}
        className={`w-full ${compact ? 'py-1 px-2' : 'py-1.5 px-2.5'} text-[11px] ${edgeBtn(value === 'south')}`}
      >
        {southMeta.colorHex && (
          <span
            className="w-2.5 h-2.5 border border-black/25 shrink-0"
            style={{ backgroundColor: southMeta.colorHex }}
          />
        )}
        <span className="whitespace-nowrap">Ön Duvar</span>
        {southMeta.lenText && (
          <span className={`font-mono text-[9px] whitespace-nowrap ${value === 'south' ? 'text-stone-300' : 'text-stone-500'}`}>
            {southMeta.lenText}
          </span>
        )}
        {southMeta.tagText && (
          <span
            className={`font-mono text-[9px] px-1 whitespace-nowrap ${
              value === 'south' ? 'bg-white/15 text-white' : 'bg-stone-200/80 text-stone-700'
            }`}
          >
            {southMeta.tagText}
          </span>
        )}
      </button>
    </div>
  );
};
