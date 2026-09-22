export type DealScheduleRepeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface DealItemRef {
  itemId: string;
  qty: number;
}

export interface DealPricing {
  totalPrice?: number;
  discountType?: 'flat' | 'percentage' | string;
  discountValue?: number;
  dealPrice: number;
}

export interface DealSchedule {
  repeat?: DealScheduleRepeat | string;
  weeklyDays?: string[];
  expiresOn?: unknown;
  startTime?: string;
  endTime?: string;
}

export interface DealRules {
  minCartValue?: number;
  maxUsePerCustomer?: number | null;
  overallLimit?: number | null;
}

export interface DealVisibility {
  showOnHome?: boolean;
  showBanner?: boolean;
  featured?: boolean;
}

export interface DealMenu {
  firebaseId: string;
  id?: string;
  name: string;
  image?: string;
  status: boolean;
  items: DealItemRef[];
  pricing: DealPricing;
  schedule?: DealSchedule;
  rules?: DealRules;
  visibility?: DealVisibility;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DealResolvedItem {
  itemId: string;
  qty: number;
  name: string;
}

export interface DealMenuView extends DealMenu {
  resolvedItems: DealResolvedItem[];
}
