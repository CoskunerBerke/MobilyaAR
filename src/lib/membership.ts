export type PlanId = 'starter' | 'pro' | 'enterprise';
export type RunpodGpuTierId = 'L4' | 'RTX4090' | 'L40S' | 'A100';
export type Product3DEngineId =
  | 'runpod_4090'
  | 'runpod_l4'
  | 'runpod_l40s'
  | 'runpod_a100'
  | 'cad'
  | 'fal_trellis'
  | 'fal_hunyuan';
export type ActiveAiEngine = 'runpod' | 'trellis' | 'hunyuan';

export interface DealerPlan {
  id: PlanId;
  name: string;
  monthlyPriceTry: number;
  maxCatalogSkus: string;
  monthlyAi3dQuota: number;
  arViewsLabel: string;
  desc: string;
}

export const DEALER_PLANS: DealerPlan[] = [
  {
    id: 'starter',
    name: 'Butik Mağaza',
    monthlyPriceTry: 2900,
    maxCatalogSkus: '30 Ürün (SKU)',
    monthlyAi3dQuota: 20,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Tek şubeli mağazalar için 1:1 Canlı AR, 3B Oda Planlayıcı ve baskıya hazır showroom QR etiketleri.',
  },
  {
    id: 'pro',
    name: 'Showroom Pro',
    monthlyPriceTry: 6900,
    maxCatalogSkus: '150 Ürün (SKU)',
    monthlyAi3dQuota: 80,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Orta ve büyük showroom’lar için sınırsız müşteri AR denemesi, web sitesi embed ve marka özelleştirmesi.',
  },
  {
    id: 'enterprise',
    name: 'Kurumsal Zincir',
    monthlyPriceTry: 16900,
    maxCatalogSkus: '500+ Ürün (Sınırsız)',
    monthlyAi3dQuota: 300,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Çok şubeli mobilya markaları için öncelikli RunPod 3B katalog hattı, e-ticaret eklentisi ve şube bazlı QR takibi.',
  },
];

export interface RunpodGpuTierSpec {
  id: RunpodGpuTierId;
  consoleName: string;
  cards: string;
  vram: string;
  flexRatePerSecUsd: number;
  hourlyEqUsd: number;
  avgProductSec: number;
  recommended?: boolean;
}

/**
 * Resmi RunPod Serverless Flex (Boşta $0) GPU saniye tarifeleri.
 * Active Workers = 0, Idle Timeout = 5 sn, FlashBoot = Açık ayarında boşta $0 faturalanır.
 */
export const RUNPOD_GPU_TIERS: Record<RunpodGpuTierId, RunpodGpuTierSpec> = {
  L4: {
    id: 'L4',
    consoleName: '24 GB (Ekonomik)',
    cards: 'L4 / A5000 / 3090',
    vram: '24 GB',
    flexRatePerSecUsd: 0.00019,
    hourlyEqUsd: 0.68,
    avgProductSec: 32,
  },
  RTX4090: {
    id: 'RTX4090',
    consoleName: '24 GB PRO (Önerilen)',
    cards: 'RTX 4090',
    vram: '24 GB',
    flexRatePerSecUsd: 0.00031,
    hourlyEqUsd: 1.12,
    avgProductSec: 20,
    recommended: true,
  },
  L40S: {
    id: 'L40S',
    consoleName: '48 GB PRO (Stüdyo)',
    cards: 'L40 / L40S / 6000 Ada',
    vram: '48 GB',
    flexRatePerSecUsd: 0.00053,
    hourlyEqUsd: 1.91,
    avgProductSec: 16,
  },
  A100: {
    id: 'A100',
    consoleName: '80 GB (Kurumsal)',
    cards: 'A100 PCIe / SXM',
    vram: '80 GB',
    flexRatePerSecUsd: 0.00076,
    hourlyEqUsd: 2.74,
    avgProductSec: 14,
  },
};

export interface Product3DEngineSpec {
  id: Product3DEngineId;
  name: string;
  isRunpod: boolean;
  ratePerSecUsd?: number;
  costPerProductUsd: number;
  avgSec: number;
  note: string;
}

export const PRODUCT_3D_ENGINES: Record<Product3DEngineId, Product3DEngineSpec> = {
  runpod_4090: {
    id: 'runpod_4090',
    name: 'RunPod Serverless · 24 GB PRO (RTX 4090)',
    isRunpod: true,
    ratePerSecUsd: RUNPOD_GPU_TIERS.RTX4090.flexRatePerSecUsd,
    costPerProductUsd: Number(((20 + 5) * RUNPOD_GPU_TIERS.RTX4090.flexRatePerSecUsd).toFixed(4)),
    avgSec: 20,
    note: 'Flex $0.00031/sn · Boşta $0 (Active=0, Idle=5 sn) · En iyi hız/fiyat oranı.',
  },
  runpod_l4: {
    id: 'runpod_l4',
    name: 'RunPod Serverless · 24 GB (L4 / A5000)',
    isRunpod: true,
    ratePerSecUsd: RUNPOD_GPU_TIERS.L4.flexRatePerSecUsd,
    costPerProductUsd: Number(((32 + 5) * RUNPOD_GPU_TIERS.L4.flexRatePerSecUsd).toFixed(4)),
    avgSec: 32,
    note: 'Flex $0.00019/sn · Boşta $0 · En düşük saniye başı ücret.',
  },
  runpod_l40s: {
    id: 'runpod_l40s',
    name: 'RunPod Serverless · 48 GB PRO (L40S)',
    isRunpod: true,
    ratePerSecUsd: RUNPOD_GPU_TIERS.L40S.flexRatePerSecUsd,
    costPerProductUsd: Number(((16 + 5) * RUNPOD_GPU_TIERS.L40S.flexRatePerSecUsd).toFixed(4)),
    avgSec: 16,
    note: 'Flex $0.00053/sn · 48 GB VRAM · Yüksek çözünürlüklü PBR doku üretimi.',
  },
  runpod_a100: {
    id: 'runpod_a100',
    name: 'RunPod Serverless · 80 GB (A100)',
    isRunpod: true,
    ratePerSecUsd: RUNPOD_GPU_TIERS.A100.flexRatePerSecUsd,
    costPerProductUsd: Number(((14 + 5) * RUNPOD_GPU_TIERS.A100.flexRatePerSecUsd).toFixed(4)),
    avgSec: 14,
    note: 'Flex $0.00076/sn · 80 GB VRAM · Toplu katalog üretiminde maksimum hız.',
  },
  cad: {
    id: 'cad',
    name: 'Mağaza CAD Yükleme (.GLB / .OBJ / .STL)',
    isRunpod: false,
    costPerProductUsd: 0.0,
    avgSec: 1,
    note: 'Tarayıcıda anında 1:1 metre ve y=0 taban hizalaması — sıfır GPU bedeli.',
  },
  fal_trellis: {
    id: 'fal_trellis',
    name: 'fal.ai TRELLIS (Harici API · Çok Açılı)',
    isRunpod: false,
    costPerProductUsd: 0.02,
    avgSec: 18,
    note: 'Sabit $0.02/ürün · Docker kurmadan anında fotoğraftan dokulu .GLB.',
  },
  fal_hunyuan: {
    id: 'fal_hunyuan',
    name: 'fal.ai Hunyuan3D v2 (Harici API · Stüdyo PBR)',
    isRunpod: false,
    costPerProductUsd: 0.48,
    avgSec: 35,
    note: 'Sabit $0.48/ürün · RunPod kurulumu olmadan tam PBR dokulu 3B mesh.',
  },
};

export interface ProductGenRecord {
  id: string;
  dateIso: string;
  productName: string;
  engineLabel: string;
  elapsedSec: number;
  costUsd: number;
}

export interface MembershipState {
  activePlanId: PlanId;
  usedAi3dCount: number;
  falApiKey: string;
  runpod3dEndpointId: string;
  runpodApiKey: string;
  runpodGpuTier: RunpodGpuTierId;
  preferredAiEngine: ActiveAiEngine;
  history: ProductGenRecord[];
}

const STORAGE_KEY = 'mekanar_ar_platform_v2';

const DEFAULT_STATE: MembershipState = {
  activePlanId: 'pro',
  usedAi3dCount: 0,
  falApiKey: '',
  runpod3dEndpointId: '',
  runpodApiKey: '',
  runpodGpuTier: 'RTX4090',
  preferredAiEngine: 'runpod',
  history: [],
};

export function getMembershipState(): MembershipState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<MembershipState>;
    const tierValid =
      parsed.runpodGpuTier && parsed.runpodGpuTier in RUNPOD_GPU_TIERS
        ? (parsed.runpodGpuTier as RunpodGpuTierId)
        : DEFAULT_STATE.runpodGpuTier;
    return {
      activePlanId:
        parsed.activePlanId && DEALER_PLANS.some((p) => p.id === parsed.activePlanId)
          ? parsed.activePlanId
          : DEFAULT_STATE.activePlanId,
      usedAi3dCount: Number.isFinite(parsed.usedAi3dCount) ? Math.max(0, Number(parsed.usedAi3dCount)) : 0,
      falApiKey: typeof parsed.falApiKey === 'string' ? parsed.falApiKey : '',
      runpod3dEndpointId: typeof parsed.runpod3dEndpointId === 'string' ? parsed.runpod3dEndpointId : '',
      runpodApiKey: typeof parsed.runpodApiKey === 'string' ? parsed.runpodApiKey : '',
      runpodGpuTier: tierValid,
      preferredAiEngine:
        parsed.preferredAiEngine === 'runpod' ||
        parsed.preferredAiEngine === 'trellis' ||
        parsed.preferredAiEngine === 'hunyuan'
          ? parsed.preferredAiEngine
          : 'runpod',
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

export function setDealerPlan(planId: PlanId): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({ ...cur, activePlanId: planId });
}

export function update3DEngineCredentials(opts: {
  falApiKey: string;
  runpod3dEndpointId: string;
  runpodApiKey: string;
  runpodGpuTier: RunpodGpuTierId;
  preferredAiEngine: ActiveAiEngine;
}): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({
    ...cur,
    falApiKey: opts.falApiKey.trim(),
    runpod3dEndpointId: opts.runpod3dEndpointId.trim(),
    runpodApiKey: opts.runpodApiKey.trim(),
    runpodGpuTier: opts.runpodGpuTier,
    preferredAiEngine: opts.preferredAiEngine,
  });
}

export function recordGeneratedProduct3D(
  productName: string,
  engineLabel: string,
  elapsedSec: number,
  costUsd: number
): MembershipState {
  const cur = getMembershipState();
  const next: MembershipState = {
    ...cur,
    usedAi3dCount: cur.usedAi3dCount + 1,
    history: [
      {
        id: `p3d-${Date.now()}`,
        dateIso: new Date().toISOString(),
        productName,
        engineLabel,
        elapsedSec: Number(elapsedSec.toFixed(1)),
        costUsd: Number(costUsd.toFixed(5)),
      },
      ...cur.history,
    ].slice(0, 20),
  };
  return saveMembershipState(next);
}

export function resetMonthlyAiQuota(): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({ ...cur, usedAi3dCount: 0 });
}
