export type PlanId = 'starter' | 'pro' | 'enterprise';
export type GpuTierId = 'L4' | 'L40S' | 'A100' | 'H100';

export interface DealerPlan {
  id: PlanId;
  name: string;
  monthlyPriceTry: number;
  monthlyQuota: number;
  perCustomerLimit: number;
  desc: string;
}

export const DEALER_PLANS: DealerPlan[] = [
  {
    id: 'starter',
    name: 'Başlangıç',
    monthlyPriceTry: 2490,
    monthlyQuota: 150,
    perCustomerLimit: 2,
    desc: 'Tek şubeli butik mağazalar için aylık sabit kota ve QR erişimi.',
  },
  {
    id: 'pro',
    name: 'Showroom Pro',
    monthlyPriceTry: 6900,
    monthlyQuota: 600,
    perCustomerLimit: 3,
    desc: 'Orta ve büyük showroom’lar için sınırsız ürün kataloğu ve çok açılı gerçek oda taraması.',
  },
  {
    id: 'enterprise',
    name: 'Kurumsal Zincir',
    monthlyPriceTry: 19900,
    monthlyQuota: 2500,
    perCustomerLimit: 5,
    desc: 'Çok şubeli mobilya markaları için öncelikli GPU havuzu ve API entegrasyonu.',
  },
];

export interface GpuTierSpec {
  id: GpuTierId;
  name: string;
  vram: string;
  ratePerSecUsd: number;
  avgScanSec: number;
}

export const GPU_TIERS: Record<GpuTierId, GpuTierSpec> = {
  L4: { id: 'L4', name: 'NVIDIA L4', vram: '24 GB', ratePerSecUsd: 0.00019, avgScanSec: 28 },
  L40S: { id: 'L40S', name: 'NVIDIA L40S', vram: '48 GB', ratePerSecUsd: 0.00054, avgScanSec: 18 },
  A100: { id: 'A100', name: 'NVIDIA A100', vram: '80 GB', ratePerSecUsd: 0.00078, avgScanSec: 14 },
  H100: { id: 'H100', name: 'NVIDIA H100', vram: '80 GB', ratePerSecUsd: 0.00135, avgScanSec: 10 },
};

export interface ScanCostRecord {
  id: string;
  dateIso: string;
  frameCount: number;
  billedSec: number;
  costUsd: number;
}

export interface MembershipState {
  activePlanId: PlanId;
  dealerUsedScans: number;
  customerUsedScans: number;
  runpodEndpointId: string;
  runpodApiKey: string;
  gpuTier: GpuTierId;
  history: ScanCostRecord[];
}

const STORAGE_KEY = 'mekanar_membership_v1';

const DEFAULT_STATE: MembershipState = {
  activePlanId: 'pro',
  dealerUsedScans: 0,
  customerUsedScans: 0,
  runpodEndpointId: '',
  runpodApiKey: '',
  gpuTier: 'L40S',
  history: [],
};

export function getMembershipState(): MembershipState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<MembershipState>;
    return {
      activePlanId:
        parsed.activePlanId && DEALER_PLANS.some((p) => p.id === parsed.activePlanId)
          ? parsed.activePlanId
          : DEFAULT_STATE.activePlanId,
      dealerUsedScans: Number.isFinite(parsed.dealerUsedScans) ? Math.max(0, Number(parsed.dealerUsedScans)) : 0,
      customerUsedScans: Number.isFinite(parsed.customerUsedScans) ? Math.max(0, Number(parsed.customerUsedScans)) : 0,
      runpodEndpointId: typeof parsed.runpodEndpointId === 'string' ? parsed.runpodEndpointId : '',
      runpodApiKey: typeof parsed.runpodApiKey === 'string' ? parsed.runpodApiKey : '',
      gpuTier:
        parsed.gpuTier && parsed.gpuTier in GPU_TIERS ? (parsed.gpuTier as GpuTierId) : DEFAULT_STATE.gpuTier,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 20) : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveMembershipState(next: MembershipState): MembershipState {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage quota */
  }
  return next;
}

export function getActivePlan(state: MembershipState): DealerPlan {
  return DEALER_PLANS.find((p) => p.id === state.activePlanId) || DEALER_PLANS[1];
}

export function canRunScan(state: MembershipState): { ok: boolean; reason?: string } {
  const plan = getActivePlan(state);
  if (state.dealerUsedScans >= plan.monthlyQuota) {
    return {
      ok: false,
      reason: `${plan.name} aylık mağaza tarama kotası (${plan.monthlyQuota}/${plan.monthlyQuota}) doldu.`,
    };
  }
  if (state.customerUsedScans >= plan.perCustomerLimit) {
    return {
      ok: false,
      reason: `Müşteri başına deneme hakkı (${plan.perCustomerLimit}/${plan.perCustomerLimit}) doldu. Demo için sayacı sıfırlayabilirsiniz.`,
    };
  }
  return { ok: true };
}

export function recordCompletedScan(frameCount: number, billedSec: number, costUsd: number): MembershipState {
  const cur = getMembershipState();
  const next: MembershipState = {
    ...cur,
    dealerUsedScans: cur.dealerUsedScans + 1,
    customerUsedScans: cur.customerUsedScans + 1,
    history: [
      {
        id: `scan-${Date.now()}`,
        dateIso: new Date().toISOString(),
        frameCount,
        billedSec: Number(billedSec.toFixed(1)),
        costUsd: Number(costUsd.toFixed(4)),
      },
      ...cur.history,
    ].slice(0, 20),
  };
  return saveMembershipState(next);
}

export function resetCustomerTrials(): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({ ...cur, customerUsedScans: 0 });
}

export function setDealerPlan(planId: PlanId): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({ ...cur, activePlanId: planId, customerUsedScans: 0 });
}

export function updateRunpodCredentials(
  endpointId: string,
  apiKey: string,
  gpuTier: GpuTierId
): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({
    ...cur,
    runpodEndpointId: endpointId.trim(),
    runpodApiKey: apiKey.trim(),
    gpuTier,
  });
}
