import { buildCartItemFromProduct } from '@/utils/productVariants';
import { getMenuItemsByFirebaseIds } from './menuService';
import { DealItemRef, DealMenu, DealMenuView } from '@/types/Deal';
import type { FoodType } from '@/types/Product';
import { apiClient } from '../utils/apiClient';
import { getActiveOrgSlug, getActiveBranchCode, onActiveRestaurantChanged } from './restaurantContext';

const DEALS_CACHE_TTL_MS = 45 * 1000;

let dealsCache: { loadedAt: number; rows: DealMenu[] } | null = null;
onActiveRestaurantChanged(() => {
  dealsCache = null;
});

const toBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') return value === 1;
  return fallback;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTimestampMs = (value: unknown): number | null => {
  if (!value) return null;

  const candidate = value as { toMillis?: () => number; toDate?: () => Date };
  if (typeof candidate.toMillis === 'function') {
    const millis = Number(candidate.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof candidate.toDate === 'function') {
    const millis = candidate.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const millis = new Date(String(value)).getTime();
  return Number.isFinite(millis) ? millis : null;
};

export interface BackendDeal {
  _id: string;
  name: string;
  description?: string;
  imageUrl?: string | null;
  price: number;
  originalPrice: number;
  savedAmount: number;
  items: Array<{ menuItemId: string; quantity: number; name?: string; foodType?: FoodType }>;
}

/** Maps the restaurant-saas-platform's Combo-backed `/deals` endpoint into the same
 *  `DealMenu` shape the app's Firestore `deals_menu` collection used to produce — a Combo
 *  has no scheduling/visibility/usage-limit concept (that was Firestore-deals-specific), so
 *  those fields get permissive defaults (always active, always shown on Home) rather than
 *  being dropped, so every existing screen reading `deal.schedule`/`deal.visibility`
 *  keeps working unmodified. */
export const mapBackendDeal = (deal: BackendDeal): DealMenu => ({
  firebaseId: deal._id,
  name: deal.name,
  image: deal.imageUrl || undefined,
  status: true,
  items: deal.items.map((item) => ({ itemId: item.menuItemId, qty: item.quantity })),
  pricing: {
    totalPrice: deal.originalPrice,
    discountType: 'flat',
    discountValue: deal.savedAmount,
    dealPrice: deal.price,
  },
  schedule: { repeat: 'none', weeklyDays: [], expiresOn: null, startTime: '', endTime: '' },
  rules: { minCartValue: 0, maxUsePerCustomer: null, overallLimit: null },
  visibility: { showOnHome: true, showBanner: false, featured: false },
});

const parseTimeToMinutes = (value: string) => {
  const [hourText, minuteText] = String(value || '').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
};

const getWeekdayKeys = (date: Date): string[] => {
  const shortByIndex = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const short = shortByIndex[date.getDay()];
  const full = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date).toLowerCase();
  return [short, full, full.slice(0, 3)];
};

export const isDealActiveNow = (deal: DealMenu, now: Date = new Date()): boolean => {
  if (!deal.status) {
    return false;
  }

  const expiresMs = toTimestampMs(deal.schedule?.expiresOn);
  if (expiresMs != null) {
    const endDate = new Date(expiresMs);
    endDate.setHours(23, 59, 59, 999);
    if (now.getTime() > endDate.getTime()) {
      return false;
    }
  }

  const repeat = String(deal.schedule?.repeat || 'none').toLowerCase();
  if (repeat === 'weekly') {
    const dayTokens = getWeekdayKeys(now);
    const weeklyDays = (deal.schedule?.weeklyDays || []).map((day) => String(day || '').trim().toLowerCase());
    const matched = weeklyDays.some((day) => dayTokens.some((token) => day === token || day.startsWith(token) || token.startsWith(day)));
    if (!matched) {
      return false;
    }
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(String(deal.schedule?.startTime || ''));
  const endMinutes = parseTimeToMinutes(String(deal.schedule?.endTime || ''));

  if (startMinutes != null && endMinutes != null) {
    if (startMinutes <= endMinutes) {
      if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
        return false;
      }
    } else {
      const inOvernightRange = nowMinutes >= startMinutes || nowMinutes <= endMinutes;
      if (!inOvernightRange) {
        return false;
      }
    }
  } else if (startMinutes != null && nowMinutes < startMinutes) {
    return false;
  } else if (endMinutes != null && nowMinutes > endMinutes) {
    return false;
  }

  return true;
};

const sortDeals = (rows: DealMenu[]): DealMenu[] => {
  return [...rows].sort((a, b) => {
    const aFeatured = a.visibility?.featured ? 1 : 0;
    const bFeatured = b.visibility?.featured ? 1 : 0;
    if (aFeatured !== bFeatured) {
      return bFeatured - aFeatured;
    }

    const aUpdated = toTimestampMs(a.updatedAt) || 0;
    const bUpdated = toTimestampMs(b.updatedAt) || 0;
    return bUpdated - aUpdated;
  });
};

const getRawDeals = async (forceRefresh = false): Promise<DealMenu[]> => {
  const now = Date.now();
  if (!forceRefresh && dealsCache && now - dealsCache.loadedAt <= DEALS_CACHE_TTL_MS) {
    return dealsCache.rows;
  }

  const deals = await apiClient.get<BackendDeal[]>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/deals`);
  const rows = deals.map(mapBackendDeal);
  const sortedRows = sortDeals(rows);
  dealsCache = { loadedAt: now, rows: sortedRows };
  return sortedRows;
};

export const fetchActiveDeals = async (options?: {
  onlyShowOnHome?: boolean;
  forceRefresh?: boolean;
}): Promise<DealMenu[]> => {
  const rows = await getRawDeals(Boolean(options?.forceRefresh));
  const now = new Date();

  return rows.filter((deal) => {
    if (options?.onlyShowOnHome && !deal.visibility?.showOnHome) {
      return false;
    }
    return isDealActiveNow(deal, now);
  });
};

export const hydrateDealItemNames = async (deals: DealMenu[]): Promise<DealMenuView[]> => {
  const ids = Array.from(
    new Set(
      deals
        .flatMap((deal) => deal.items)
        .map((item) => String(item.itemId || '').trim())
        .filter(Boolean)
    )
  );

  const menuById = await getMenuItemsByFirebaseIds(ids);

  return deals.map((deal) => ({
    ...deal,
    resolvedItems: deal.items.map((item) => {
      const product = menuById.get(item.itemId);
      return {
        itemId: item.itemId,
        qty: item.qty,
        name: String(product?.name || 'Item').trim() || 'Item',
      };
    }),
  }));
};

const normalizeItemTotals = (lineTotals: number[], targetTotal: number): number[] => {
  if (lineTotals.length === 0) return [];

  const safeTarget = Math.max(0, Math.round(targetTotal * 100));
  const rawWeights = lineTotals.map((value) => Math.max(0, Math.round(value * 100)));
  const weightSum = rawWeights.reduce((sum, value) => sum + value, 0);

  if (weightSum <= 0) {
    const equalShare = Math.floor(safeTarget / lineTotals.length);
    const result = lineTotals.map(() => equalShare);
    let remainder = safeTarget - equalShare * lineTotals.length;
    for (let index = 0; index < result.length && remainder > 0; index += 1) {
      result[index] += 1;
      remainder -= 1;
    }
    return result.map((value) => value / 100);
  }

  const allocatedPaise = rawWeights.map((weight) => Math.floor((safeTarget * weight) / weightSum));
  let remainder = safeTarget - allocatedPaise.reduce((sum, value) => sum + value, 0);
  let cursor = 0;

  while (remainder > 0) {
    allocatedPaise[cursor % allocatedPaise.length] += 1;
    remainder -= 1;
    cursor += 1;
  }

  return allocatedPaise.map((value) => value / 100);
};

export const buildDealDescription = (deal: DealMenuView): string => {
  const parts = deal.resolvedItems.map((item) => (
    item.qty > 1 ? `${item.name} x${item.qty}` : item.name
  ));
  return parts.join(' + ');
};

export const buildCartItemsForDeal = async (deal: DealMenuView): Promise<Record<string, unknown>[]> => {
  const ids = Array.from(new Set(deal.items.map((item) => String(item.itemId || '').trim()).filter(Boolean)));
  const latestMenuById = await getMenuItemsByFirebaseIds(ids, { forceRefresh: true });

  const lineRows = deal.items
    .map((dealItem) => {
      const menuItem = latestMenuById.get(dealItem.itemId);
      if (!menuItem || menuItem.available === false || menuItem.inStock === false) {
        return null;
      }

      const cartItem = buildCartItemFromProduct(menuItem, null) as Record<string, unknown>;
      const quantity = Math.max(1, toNumber(dealItem.qty, 1));
      const basePrice = Math.max(0, toNumber(cartItem.price, 0));

      return {
        cartItem,
        quantity,
        baseLineTotal: basePrice * quantity,
      };
    })
    .filter((row): row is { cartItem: Record<string, unknown>; quantity: number; baseLineTotal: number } => Boolean(row));

  if (lineRows.length === 0) {
    return [];
  }

  const allocatedLineTotals = normalizeItemTotals(
    lineRows.map((row) => row.baseLineTotal),
    Math.max(0, toNumber(deal.pricing.dealPrice, 0))
  );

  return lineRows.map((row, index) => {
    const lineTotal = allocatedLineTotals[index] || 0;
    const unitPrice = row.quantity > 0 ? lineTotal / row.quantity : 0;

    return {
      ...row.cartItem,
      price: Number(unitPrice.toFixed(4)),
      quantity: row.quantity,
      dealUnitQty: row.quantity,
      isDeal: true,
      dealId: deal.firebaseId,
      dealName: deal.name,
      dealPrice: Math.max(0, toNumber(deal.pricing.dealPrice, 0)),
      originalDealPrice: Math.max(0, toNumber(deal.pricing.totalPrice, 0)),
    };
  });
};
