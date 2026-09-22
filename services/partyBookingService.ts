import { apiClient } from '../utils/apiClient';
import { getActiveOrgSlug } from './restaurantContext';
import {
  DecorationPackage,
  NewPartyBooking,
  PartyCoupon,
  PartyMenu,
  PartyMenuItem,
  PartyMenuStep,
  PlatterType,
} from '@/types/PartyBooking';

/**
 * Replaces the original app's Firestore `party_menus`/`party_menu_items`/
 * `party_decoration_packages`/`party_coupons`/`party_bookings` collections with the
 * restaurant-saas-platform's own party/catering booking system
 * (backend/src/services/partyBooking.service.ts) — org-scoped by slug (party catering was
 * never branch-specific, even in the original app). Every exported function keeps its
 * original signature so party-booking.tsx needed no changes.
 *
 * `fetchPartyBookings`/`updatePartyBookingStatus` (staff-side booking management) are gone
 * — they had no caller left in this app once the in-app manager mode was removed; staff
 * manage bookings via the backend's own `/api/party-bookings/*` routes directly for now
 * (no admin UI yet).
 */

const MENUS_CACHE_TTL_MS = 60 * 1000;
const ITEMS_CACHE_TTL_MS = 60 * 1000;
const DECORATION_PACKAGES_CACHE_TTL_MS = 60 * 1000;
const COUPONS_CACHE_TTL_MS = 30 * 1000;

let menusCache: { loadedAt: number; rows: PartyMenu[] } | null = null;
const itemsCacheByMenu = new Map<string, { loadedAt: number; rows: PartyMenuItem[] }>();
let decorationPackagesCache: { loadedAt: number; rows: DecorationPackage[] } | null = null;
let couponsCache: { loadedAt: number; rows: PartyCoupon[] } | null = null;

interface BackendPlatterType {
  _id: string;
  name: string;
  price: number;
  freePremiumUpgrades: number;
  unlimitedPremiumItems: boolean;
  description?: string;
  image?: string;
}

interface BackendPartyMenu {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  active: boolean;
  platterTypes: BackendPlatterType[];
  createdAt: string;
  updatedAt: string;
}

function mapPlatterType(row: BackendPlatterType): PlatterType {
  return {
    id: row._id,
    name: row.name,
    price: row.price,
    freePremiumUpgrades: row.freePremiumUpgrades,
    unlimitedPremiumItems: row.unlimitedPremiumItems,
    description: row.description,
    image: row.image,
  };
}

function mapPartyMenu(row: BackendPartyMenu): PartyMenu {
  return {
    firebaseId: row._id,
    id: row._id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    image: row.image,
    active: row.active,
    platterTypes: row.platterTypes.map(mapPlatterType),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface BackendPartyMenuItem {
  _id: string;
  menuId: string;
  step: number;
  stepLabel: string;
  category: string;
  name: string;
  description?: string;
  image?: string;
  portion?: string;
  selectionLimit: number;
  premium: boolean;
  upgradePrice: number;
  displayOrder: number;
  active: boolean;
}

function mapPartyMenuItem(row: BackendPartyMenuItem): PartyMenuItem {
  return {
    firebaseId: row._id,
    menuId: row.menuId,
    step: row.step,
    stepLabel: row.stepLabel,
    category: row.category,
    name: row.name,
    description: row.description,
    image: row.image,
    portion: row.portion,
    selectionLimit: row.selectionLimit,
    premium: row.premium,
    upgradePrice: row.upgradePrice,
    displayOrder: row.displayOrder,
    active: row.active,
  };
}

interface BackendDecorationPackage {
  _id: string;
  name: string;
  description?: string;
  price: number;
  recommended: boolean;
  displayOrder: number;
  active: boolean;
  coverImage?: string;
  gallery: string[];
  includes: string[];
  createdAt: string;
  updatedAt: string;
}

function mapDecorationPackage(row: BackendDecorationPackage): DecorationPackage {
  return {
    firebaseId: row._id,
    id: row._id,
    name: row.name,
    description: row.description,
    price: row.price,
    recommended: row.recommended,
    displayOrder: row.displayOrder,
    active: row.active,
    coverImage: row.coverImage,
    gallery: row.gallery,
    includes: row.includes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface BackendPartyCoupon {
  _id: string;
  code: string;
  description?: string;
  discountType: 'flat' | 'percentage';
  discountValue: number;
  minBookingAmount: number;
  maxDiscountAmount?: number | null;
  usageLimitPerUser?: number | null;
  active: boolean;
  displayOrder: number;
  expiryDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapPartyCoupon(row: BackendPartyCoupon): PartyCoupon {
  return {
    firebaseId: row._id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    discountValue: row.discountValue,
    minBookingAmount: row.minBookingAmount,
    maxDiscountAmount: row.maxDiscountAmount ?? null,
    usageLimitPerUser: row.usageLimitPerUser ?? null,
    active: row.active,
    displayOrder: row.displayOrder,
    expiryDate: row.expiryDate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const fetchActivePartyMenus = async (forceRefresh = false): Promise<PartyMenu[]> => {
  const now = Date.now();
  if (!forceRefresh && menusCache && now - menusCache.loadedAt <= MENUS_CACHE_TTL_MS) {
    return menusCache.rows;
  }

  const rows = (await apiClient.get<BackendPartyMenu[]>(`/public/org/${getActiveOrgSlug()}/party-menus`)).map(mapPartyMenu);
  menusCache = { loadedAt: now, rows };
  return rows;
};

export const fetchPartyMenuItems = async (menuId: string, forceRefresh = false): Promise<PartyMenuItem[]> => {
  if (!menuId) return [];

  const now = Date.now();
  const cached = itemsCacheByMenu.get(menuId);
  if (!forceRefresh && cached && now - cached.loadedAt <= ITEMS_CACHE_TTL_MS) {
    return cached.rows;
  }

  const rows = (
    await apiClient.get<BackendPartyMenuItem[]>(`/public/org/${getActiveOrgSlug()}/party-menus/${menuId}/items`)
  ).map(mapPartyMenuItem);
  itemsCacheByMenu.set(menuId, { loadedAt: now, rows });
  return rows;
};

/**
 * Groups a flat item list into ordered wizard steps purely from the data itself
 * (step number, stepLabel, category, displayOrder). Adding a new step, category,
 * or menu on the backend automatically reflects here with no code change.
 */
export const groupPartyMenuItemsIntoSteps = (items: PartyMenuItem[]): PartyMenuStep[] => {
  const byStep = new Map<number, PartyMenuItem[]>();
  items.forEach((item) => {
    const bucket = byStep.get(item.step) || [];
    bucket.push(item);
    byStep.set(item.step, bucket);
  });

  const steps: PartyMenuStep[] = Array.from(byStep.entries())
    .sort(([stepA], [stepB]) => stepA - stepB)
    .map(([step, stepItems]) => {
      const byCategory = new Map<string, PartyMenuItem[]>();
      stepItems.forEach((item) => {
        const bucket = byCategory.get(item.category) || [];
        bucket.push(item);
        byCategory.set(item.category, bucket);
      });

      const categories = Array.from(byCategory.entries()).map(([category, categoryItems]) => ({
        category,
        items: [...categoryItems].sort((a, b) => a.displayOrder - b.displayOrder),
      }));

      const selectionLimit = Math.max(1, ...stepItems.map((item) => item.selectionLimit));
      const label = stepItems[0]?.stepLabel || `Step ${step}`;

      return { step, label, selectionLimit, categories };
    });

  return steps;
};

export const fetchActiveDecorationPackages = async (forceRefresh = false): Promise<DecorationPackage[]> => {
  const now = Date.now();
  if (!forceRefresh && decorationPackagesCache && now - decorationPackagesCache.loadedAt <= DECORATION_PACKAGES_CACHE_TTL_MS) {
    return decorationPackagesCache.rows;
  }

  const rows = (
    await apiClient.get<BackendDecorationPackage[]>(`/public/org/${getActiveOrgSlug()}/party-decoration-packages`)
  ).map(mapDecorationPackage);
  decorationPackagesCache = { loadedAt: now, rows };
  return rows;
};

export const fetchActivePartyCoupons = async (forceRefresh = false): Promise<PartyCoupon[]> => {
  const now = Date.now();
  if (!forceRefresh && couponsCache && now - couponsCache.loadedAt <= COUPONS_CACHE_TTL_MS) {
    return couponsCache.rows;
  }

  const rows = (await apiClient.get<BackendPartyCoupon[]>(`/public/org/${getActiveOrgSlug()}/party-coupons`)).map(mapPartyCoupon);
  couponsCache = { loadedAt: now, rows };
  return rows;
};

/** `customerId` is accepted for interface-compatibility but ignored — usage is now counted
 *  server-side against the logged-in account's own session token, not a client-asserted id. */
export const getPartyCouponUsageCountForCustomer = async (customerId: string, code: string): Promise<number> => {
  void customerId;
  if (!code) return 0;
  try {
    const result = await apiClient.get<{ usageCount: number }>(
      `/public/org/${getActiveOrgSlug()}/party-coupons/usage?code=${encodeURIComponent(code)}`
    );
    return result.usageCount;
  } catch {
    return 0;
  }
};

export type PartyCouponValidationResult =
  | { ok: true; coupon: PartyCoupon; discountAmount: number }
  | { ok: false; reason: string };

const isCouponExpired = (coupon: PartyCoupon, now: Date = new Date()): boolean => {
  if (!coupon.expiryDate) return false;
  const expiry = new Date(coupon.expiryDate);
  if (Number.isNaN(expiry.getTime())) return false;
  expiry.setHours(23, 59, 59, 999);
  return now.getTime() > expiry.getTime();
};

/**
 * Pure client-side preview of a coupon's eligibility/discount — same math the backend
 * re-runs authoritatively at booking-creation time (see partyBooking.service.ts's
 * priceCoupon), kept here purely so checkout can show the discount instantly without a
 * round trip. The server never trusts this — createBooking re-validates the coupon itself.
 */
export const validatePartyCoupon = (
  coupon: PartyCoupon,
  bookingAmount: number,
  usageCountForCustomer: number
): PartyCouponValidationResult => {
  if (!coupon.active) {
    return { ok: false, reason: 'This coupon is no longer active.' };
  }
  if (isCouponExpired(coupon)) {
    return { ok: false, reason: 'This coupon has expired.' };
  }
  if (bookingAmount < coupon.minBookingAmount) {
    return { ok: false, reason: `This coupon requires a minimum booking amount of ₹${coupon.minBookingAmount.toFixed(0)}.` };
  }
  if (coupon.usageLimitPerUser != null && usageCountForCustomer >= coupon.usageLimitPerUser) {
    return { ok: false, reason: 'You have already used this coupon the maximum number of times.' };
  }

  const rawDiscount = coupon.discountType === 'percentage'
    ? (bookingAmount * coupon.discountValue) / 100
    : coupon.discountValue;
  const cappedDiscount = coupon.discountType === 'percentage' && coupon.maxDiscountAmount != null
    ? Math.min(rawDiscount, coupon.maxDiscountAmount)
    : rawDiscount;
  const discountAmount = Math.max(0, Math.min(cappedDiscount, bookingAmount));

  return { ok: true, coupon, discountAmount: Number(discountAmount.toFixed(2)) };
};

export const createPartyBooking = async (payload: NewPartyBooking): Promise<string> => {
  const { customerId: _customerId, couponApplied, ...rest } = payload;
  void _customerId; // the backend resolves the customer from the auth token, not this field.
  const booking = await apiClient.post<{ _id: string }>(`/public/org/${getActiveOrgSlug()}/party-bookings`, {
    ...rest,
    couponCode: couponApplied?.code,
  });
  return booking._id;
};
