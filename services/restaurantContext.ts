import { API_CONFIG } from '../config/api';

export type RestaurantContext = { id: string; orgSlug: string; branchCode: string };

/**
 * Which restaurant (organization + branch) the app's menu/order/deals/app-config service
 * calls should hit right now — this app moved from a single fixed restaurant to a
 * cross-organization marketplace (see backend's `/public/restaurants`), so those services
 * can no longer read a build-time-fixed org/branch off API_CONFIG.
 *
 * Every restaurant-scoped screen (restaurant-details, cafe-details, checkout,
 * location-detials) already resolves "which restaurant is this" for its own purposes —
 * from its `restaurant` route param, or via `findRestaurantByAnyId(cartCafeId)` for
 * checkout/table screens, since the cart already enforces single-restaurant-per-cart (see
 * useAddToCartWithRestaurantGuard). This module is just where those screens hand that
 * answer to the services, instead of each service call needing an explicit org/branch
 * argument threaded through dozens of call sites.
 *
 * In-memory only, not persisted: every entry point above re-derives it from its own params
 * or from cart state on mount, so it's always freshly set before it's needed. Falls back to
 * API_CONFIG's default org/branch when nothing has set it yet (e.g. Home's initial
 * restaurant-directory fetch, which doesn't need one).
 */
let current: RestaurantContext | null = null;

// Menu/deals services keep their own short-lived caches keyed on nothing but "the active
// restaurant" (there used to only ever be one) — they register here to clear themselves
// out whenever that restaurant actually changes, so switching restaurants can never serve
// one restaurant's cached menu/deals under another's name.
const changeListeners = new Set<() => void>();

export function onActiveRestaurantChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function setActiveRestaurant(restaurant: { id?: string; orgSlug?: string; branchCode?: string } | null | undefined): void {
  if (!restaurant?.orgSlug || !restaurant?.branchCode) return;
  const next: RestaurantContext = { id: String(restaurant.id || ''), orgSlug: restaurant.orgSlug, branchCode: restaurant.branchCode };
  const changed = !current || current.orgSlug !== next.orgSlug || current.branchCode !== next.branchCode;
  current = next;
  if (changed) changeListeners.forEach((listener) => listener());
}

export function getActiveOrgSlug(): string {
  return current?.orgSlug || API_CONFIG.orgSlug;
}

export function getActiveBranchCode(): string {
  return current?.branchCode || API_CONFIG.branchCode;
}

/** True once a screen has picked a real restaurant (not just the build-time default). */
export function hasActiveRestaurant(): boolean {
  return current !== null;
}

export function getActiveRestaurantId(): string | null {
  return current?.id || null;
}

/** The offer a customer tapped on Home's "Offers Near You" carousel, carried from
 *  cafe-details (where it's shown prominently, see screens/user/cafe-details.tsx) through
 *  to checkout (which prefills/auto-applies it via the SAME "Apply Coupon" flow every
 *  other coupon already goes through — see screens/user/checkout.tsx's
 *  handleApplyCouponByCode). In-memory only, same lifetime/reasoning as the restaurant
 *  context above; scoped to one branch so switching restaurants never carries a stale
 *  offer into the wrong cart, and consumed (cleared) after checkout's first apply attempt
 *  so it's never silently retried on a later visit. */
export type PendingOffer = { branchId: string; couponCode: string };
let pendingOffer: PendingOffer | null = null;

export function setPendingOffer(offer: PendingOffer | null): void {
  pendingOffer = offer;
}

/** Reads AND clears — checkout calls this at most once per screen visit, so a
 *  successful-or-failed apply attempt never repeats itself on a re-render. */
export function consumePendingOffer(branchId: string): PendingOffer | null {
  if (!pendingOffer || pendingOffer.branchId !== branchId) return null;
  const offer = pendingOffer;
  pendingOffer = null;
  return offer;
}
