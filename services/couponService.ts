import { apiClient } from '../utils/apiClient';
import { getActiveOrgSlug, getActiveBranchCode } from './restaurantContext';
import type { PosOrderItemPayload } from './orderService';
import { OrderType } from '../types/enums';

/** The backend's order-type enum (models/Order.ts ORDER_TYPES). */
export type BackendOrderType = 'DINE_IN' | 'TAKEAWAY' | 'HOME_DELIVERY';

const BACKEND_ORDER_TYPE: Record<string, BackendOrderType> = {
  [OrderType.DINE_IN]: 'DINE_IN',
  [OrderType.TAKE_AWAY]: 'TAKEAWAY',
  [OrderType.HOME_DELIVERY]: 'HOME_DELIVERY',
};

const ORDER_TYPE_LABELS: Record<BackendOrderType, string> = {
  DINE_IN: 'Dine In',
  TAKEAWAY: 'Take-Away',
  HOME_DELIVERY: 'Home Delivery',
};

/** App order-type value ('1' / '2' / '3', see types/enums.ts) → backend enum. */
export function toBackendOrderType(appOrderType: unknown): BackendOrderType | undefined {
  return BACKEND_ORDER_TYPE[String(appOrderType || '')];
}

/**
 * Replaces the original Firestore `coupons` collection + `applyInfluencerCouponCallable`
 * Cloud Function with the restaurant-saas-platform's own coupon system
 * (backend/src/services/coupon.service.ts) — it already covers the same ground (standard
 * coupons, influencer coupons with cycles, per-user/customer-restricted codes,
 * usage-limit enforcement), just server-side and org/branch-scoped instead of a single
 * global Firestore collection.
 *
 * Not carried over — no backend equivalent exists (scratch-card-issued coupons and their
 * reward docs were never modeled on the new backend): a scratch-to-reveal reward mechanic.
 * Every coupon this now lists comes from a restaurant's own coupon list, not a scratch card.
 */

export interface CouponItem {
  id: string;
  code: string;
  type: 'Percentage' | 'Flat' | 'Freebie';
  value: number;
  /** A "buy X get Y" coupon's deal in words, from the server — shown instead of the value. */
  dealHeadline?: string | null;
  /** Cap on the discount amount for Percentage coupons, e.g. "50% off up to ₹150". 0/absent = uncapped. */
  maxDiscount: number;
  minOrder: number;
  expiry: Date | null;
  isActive: boolean;
  userId?: string;
  createdFrom?: string;
  title?: string;
  description?: string;
  freeItemName?: string;
  timesPerUser?: number | null;
  userUsageCount?: number;
  remainingUses?: number | null;
  /** Only for a customer's first order at this restaurant (server-enforced). */
  newCustomersOnly?: boolean;
  /** True for influencer next-coupon-unlock coupons — checkout must route these through
   *  `validateCoupon` (server-validated) for the discount amount, never client-side math. */
  isInfluencer?: boolean;
  influencerCycle?: number;
  /** Service types this coupon is restricted to — empty means valid for every type. */
  applicableOrderTypes: BackendOrderType[];
  /** Set when this is a restaurant offer applied at checkout (evaluateOffers), not a coupon. */
  offerId?: string;
}

/** Whether a coupon can be used for the service type the customer picked (Dine In /
 *  Take-Away / Home Delivery). Unknown order type = don't hide anything; the backend still
 *  re-checks at validate and order-placement time. */
export function isCouponValidForOrderType(coupon: CouponItem, orderType: BackendOrderType | undefined): boolean {
  if (!orderType || coupon.applicableOrderTypes.length === 0) return true;
  return coupon.applicableOrderTypes.includes(orderType);
}

/** e.g. "Home Delivery" or "Dine In / Take-Away". */
export function formatCouponOrderTypes(coupon: CouponItem): string {
  return coupon.applicableOrderTypes.map((type) => ORDER_TYPE_LABELS[type] || type).join(' / ');
}

interface BackendCoupon {
  _id: string;
  code: string;
  title: string;
  description: string;
  couponType: 'STANDARD' | 'INFLUENCER';
  discountType: 'PERCENTAGE' | 'FLAT' | 'FREE_ITEM' | 'BUY_X_GET_Y';
  discountValue: number;
  maxDiscount: number;
  minimumOrder: number;
  dealHeadline?: string | null;
  validUntil: string;
  perUserLimit: number;
  userUsageCount: number;
  remainingUses: number | null;
  newCustomersOnly?: boolean;
  influencerCycle?: number;
  applicableOrderTypes?: BackendOrderType[];
}

function mapBackendCoupon(coupon: BackendCoupon): CouponItem {
  const type: CouponItem['type'] =
    coupon.discountType === 'FREE_ITEM' ? 'Freebie' : coupon.discountType === 'PERCENTAGE' ? 'Percentage' : 'Flat';

  return {
    id: coupon._id,
    code: coupon.code,
    type,
    value: coupon.discountValue,
    dealHeadline: coupon.dealHeadline || null,
    maxDiscount: coupon.maxDiscount,
    minOrder: coupon.minimumOrder,
    expiry: coupon.validUntil ? new Date(coupon.validUntil) : null,
    isActive: true,
    title: coupon.title,
    description: coupon.description,
    freeItemName: coupon.title || coupon.description,
    timesPerUser: coupon.perUserLimit > 0 ? coupon.perUserLimit : null,
    userUsageCount: coupon.userUsageCount,
    remainingUses: coupon.remainingUses,
    newCustomersOnly: Boolean(coupon.newCustomersOnly),
    isInfluencer: coupon.couponType === 'INFLUENCER',
    influencerCycle: coupon.influencerCycle,
    applicableOrderTypes: coupon.applicableOrderTypes || [],
  };
}

/** `userId` is accepted for interface-compatibility with existing call sites but ignored —
 *  eligibility is now determined server-side from the logged-in customer's own session
 *  token (see backend's `getBranchCoupons`), not a userId the client asserts. */
export async function fetchActiveCoupons(userId?: string | null): Promise<CouponItem[]> {
  void userId;
  const coupons = await apiClient.get<BackendCoupon[]>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/coupons`);
  return coupons.map(mapBackendCoupon);
}

/**
 * Server-computed discount preview for a coupon before the order is placed — the SAME
 * pricing/eligibility logic (`validateAndPriceCoupon`) the order-placement endpoint itself
 * re-runs and trusts exclusively. Works for both standard and influencer coupons now (the
 * original app only server-validated influencer ones); checkout must always use the
 * returned `discountAmount` as-is, never recompute it client-side. Throws if the coupon
 * isn't eligible (wrong customer, expired, below minimum order, already used, etc.).
 */
export async function validateCoupon(params: { code: string; orderSubtotal: number; items?: PosOrderItemPayload[]; orderType?: BackendOrderType }): Promise<{
  couponId: string;
  discountAmount: number;
  freeItemMenuItemId: string | null;
}> {
  return apiClient.post(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/coupons/validate`, {
    code: params.code,
    orderSubtotal: params.orderSubtotal,
    items: params.items,
    orderType: params.orderType,
  });
}
