import { getHouseBounds, type ArchRoomProject } from './types';

export interface ClientProjectRecord {
  id: string;
  clientName: string;
  roomTitle: string;
  phone?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  roomCount: number;
  areaM2: number;
  objectCount: number;
  project: ArchRoomProject;
}

const STORAGE_KEY = 'mekanar_client_projects_v1';
const ACTIVE_CLIENT_KEY = 'mekanar_active_client_id_v1';

function computeMetrics(project: ArchRoomProject) {
  const roomCount = 1 + (project.adjacentRooms?.length || 0);
  const bounds = getHouseBounds(project);
  return {
    roomCount,
    areaM2: Math.max(1, Math.round(bounds.totalAreaM2)),
    objectCount: project.objects?.length || 0,
  };
}

/** Strips oversized inline data-URL thumbnails only when browser localStorage is tight */
function compactProjectForStorage(project: ArchRoomProject): ArchRoomProject {
  return {
    ...project,
    objects: (project.objects || []).map((o) => {
      if (o.thumbUrl && o.thumbUrl.startsWith('data:') && o.thumbUrl.length > 24000) {
        const { thumbUrl: _omit, ...rest } = o;
        return rest;
      }
      return o;
    }),
  };
}

export function loadClientProjects(): ClientProjectRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ClientProjectRecord[])
      .filter((r) => r && typeof r.id === 'string' && typeof r.clientName === 'string' && r.project)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

export function saveClientProjects(list: ClientProjectRecord[]): boolean {
  if (typeof window === 'undefined') return false;
  const sorted = [...list].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    return true;
  } catch {
    // QuotaExceededError fallback: strip heavy inline thumbnails and retry cleanly
    try {
      const compacted = sorted.map((r) => ({ ...r, project: compactProjectForStorage(r.project) }));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
      return true;
    } catch {
      return false;
    }
  }
}

export function loadActiveClientId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_CLIENT_KEY) || null;
  } catch {
    return null;
  }
}

export function saveActiveClientId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_CLIENT_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CLIENT_KEY);
  } catch {
    /* ignore */
  }
}

export function createClientProjectRecord(opts: {
  clientName: string;
  roomTitle?: string;
  phone?: string;
  note?: string;
  project: ArchRoomProject;
}): ClientProjectRecord {
  const now = new Date().toISOString();
  const cleanName = opts.clientName.trim() || 'İsimsiz Müşteri';
  const cleanRoom = opts.roomTitle?.trim() || opts.project.projectName || 'Ana Salon';
  const metrics = computeMetrics(opts.project);
  return {
    id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: cleanName,
    roomTitle: cleanRoom,
    phone: opts.phone?.trim() || undefined,
    note: opts.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    ...metrics,
    project: {
      ...opts.project,
      projectName: `${cleanName} · ${cleanRoom}`,
      wallZones: opts.project.wallZones || [],
      adjacentRooms: opts.project.adjacentRooms || [],
    },
  };
}

export function updateRecordWithProject(
  record: ClientProjectRecord,
  project: ArchRoomProject
): ClientProjectRecord {
  const metrics = computeMetrics(project);
  return {
    ...record,
    updatedAt: new Date().toISOString(),
    ...metrics,
    project: {
      ...project,
      wallZones: project.wallZones || [],
      adjacentRooms: project.adjacentRooms || [],
    },
  };
}

export function formatRelativeTimeTr(iso: string): string {
  try {
    const dt = new Date(iso);
    const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
    if (diffSec < 45) return 'Az önce';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} saat önce`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'Dün';
    if (diffDay < 7) return `${diffDay} gün önce`;
    return dt.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}
