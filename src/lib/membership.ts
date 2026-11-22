export type PlanId = 'starter' | 'pro' | 'enterprise';
export type Product3DEngineId = 'cad' | 'runpod_l40s' | 'fal_trellis' | 'fal_hunyuan';
export type ActiveAiEngine = 'trellis' | 'hunyuan' | 'runpod';

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
    monthlyAi3dQuota: 15,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Tek şubeli mağazalar için 1:1 Canlı AR, 3B Oda Planlayıcı ve baskıya hazır showroom QR etiketleri.',
  },
  {
    id: 'pro',
    name: 'Showroom Pro',
    monthlyPriceTry: 6900,
    maxCatalogSkus: '150 Ürün (SKU)',
    monthlyAi3dQuota: 60,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Orta ve büyük showroom’lar için sınırsız müşteri AR denemesi, web sitesi embed ve marka özelleştirmesi.',
  },
  {
    id: 'enterprise',
    name: 'Kurumsal Zincir',
    monthlyPriceTry: 16900,
    maxCatalogSkus: '500+ Ürün (Sınırsız)',
    monthlyAi3dQuota: 250,
    arViewsLabel: 'Sınırsız ($0)',
    desc: 'Çok şubeli mobilya markaları için öncelikli 3B katalog hattı, e-ticaret eklentisi ve şube bazlı QR takibi.',
  },
];

export interface Product3DEngineSpec {
  id: Product3DEngineId;
  name: string;
  costPerProductUsd: number;
  avgSec: number;
  note: string;
}

export const PRODUCT_3D_ENGINES: Record<Product3DEngineId, Product3DEngineSpec> = {
  cad: {
    id: 'cad',
    name: 'Mağaza CAD Yükleme (.GLB / .OBJ / .STL)',
    costPerProductUsd: 0.0,
    avgSec: 1,
    note: 'Tarayıcıda anında 1:1 metre ve y=0 taban hizalaması — sıfır GPU bedeli.',
  },
  runpod_l40s: {
    id: 'runpod_l40s',
    name: 'RunPod Serverless L40S (Kendi GPU Hattı)',
    costPerProductUsd: 0.012,
    avgSec: 22,
    note: '48 GB VRAM · $0.00054/sn · Boşta $0 kira — yüksek hacimde en düşük maliyet.',
  },
  fal_trellis: {
    id: 'fal_trellis',
    name: 'fal.ai TRELLIS (Tek / Çok Açılı Hızlı AI)',
    costPerProductUsd: 0.02,
    avgSec: 18,
    note: 'Sıfır sunucu bakımı · 1–4 ürün fotoğrafından dokulu 1:1 .GLB (~0.80 ₺/ürün).',
  },
  fal_hunyuan: {
    id: 'fal_hunyuan',
    name: 'fal.ai Hunyuan3D v2 (Stüdyo PBR Dokulu)',
    costPerProductUsd: 0.48,
    avgSec: 35,
    note: 'Amiral gemisi karmaşık döşeme/ahşap detayları için tam PBR dokulu 3B mesh.',
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
  preferredAiEngine: 'trellis',
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
      usedAi3dCount: Number.isFinite(parsed.usedAi3dCount) ? Math.max(0, Number(parsed.usedAi3dCount)) : 0,
      falApiKey: typeof parsed.falApiKey === 'string' ? parsed.falApiKey : '',
      runpod3dEndpointId: typeof parsed.runpod3dEndpointId === 'string' ? parsed.runpod3dEndpointId : '',
      runpodApiKey: typeof parsed.runpodApiKey === 'string' ? parsed.runpodApiKey : '',
      preferredAiEngine:
        parsed.preferredAiEngine === 'trellis' ||
        parsed.preferredAiEngine === 'hunyuan' ||
        parsed.preferredAiEngine === 'runpod'
          ? parsed.preferredAiEngine
          : 'trellis',
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
  preferredAiEngine: ActiveAiEngine;
}): MembershipState {
  const cur = getMembershipState();
  return saveMembershipState({
    ...cur,
    falApiKey: opts.falApiKey.trim(),
    runpod3dEndpointId: opts.runpod3dEndpointId.trim(),
    runpodApiKey: opts.runpodApiKey.trim(),
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
        costUsd: Number(costUsd.toFixed(4)),
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
