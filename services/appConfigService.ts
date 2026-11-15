import { apiClient, isRateLimited } from '../utils/apiClient';
import { startPolling } from '../utils/polling';
import { getActiveOrgSlug, getActiveBranchCode, hasActiveRestaurant, onActiveRestaurantChanged } from './restaurantContext';

// Background config checks — paused while the app is backgrounded and during a 429
// cooldown (utils/polling.ts). None of these change often.
const SERVICE_AVAILABILITY_POLL_MS = 60_000;
const APP_STATUS_POLL_MS = 60_000;
const ANNOUNCEMENT_POLL_MS = 5 * 60_000;

export type AnnouncementStatus = 'active' | 'inactive';

export type AnnouncementConfig = {
  status: AnnouncementStatus;
  title: string;
  description: string;
  imageUrl: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AppStatus = 'active' | 'temporarily_paused' | 'emergency_closed' | 'maintenance';

export type AppStatusConfig = {
  status: AppStatus;
  title: string;
  description: string;
  updatedAt?: unknown;
};

const DEFAULT_APP_STATUS_CONFIG: AppStatusConfig = {
  status: 'active',
  title: '',
  description: '',
};

/**
 * Per-service order-taking availability, for day-to-day operational control (e.g.
 * "delivery riders unavailable today, but dine-in/takeaway are fine") — distinct from
 * `AppStatusConfig`, which is a rare, severe full-app lockout (maintenance, etc.).
 * Disabling a service here only prevents choosing it as an order type; the menu and the
 * rest of the app remain fully browsable even if every service is disabled. Each service
 * carries its own `message` (e.g. "unavailable due to high demand") shown wherever that
 * service is presented as an option, so customers see why, not just that it's gone.
 */
export type ServiceState = {
  available: boolean;
  message: string;
};

export type ServiceAvailability = {
  dineIn: ServiceState;
  takeaway: ServiceState;
  homeDelivery: ServiceState;
};

export type ServiceAvailabilityConfig = {
  services: ServiceAvailability;
  updatedAt?: unknown;
};

const DEFAULT_SERVICE_STATE: ServiceState = { available: true, message: '' };

const DEFAULT_SERVICE_AVAILABILITY_CONFIG: ServiceAvailabilityConfig = {
  services: {
    dineIn: { ...DEFAULT_SERVICE_STATE },
    takeaway: { ...DEFAULT_SERVICE_STATE },
    homeDelivery: { ...DEFAULT_SERVICE_STATE },
  },
};

type BranchContextResponse = {
  announcement: { status: 'active' | 'inactive'; title?: string; description?: string; imageUrl?: string | null } | null;
  serviceAvailability?: ServiceAvailability;
  pricingConfig?: PricingConfig;
};

/**
 * Replaces the Firestore `app_config/service_availability` live listener — the new backend
 * has no real-time push for this (see Branch.serviceAvailability/deliverySettings, read via
 * the branch-context endpoint), so this polls on an interval instead. Same external shape (a
 * callback + unsubscribe function) as the original: falls back to "all services available"
 * on any request failure, so a config problem never accidentally blocks ordering.
 */
export function subscribeToServiceAvailability(
  callback: (config: ServiceAvailabilityConfig) => void
): () => void {
  let cancelled = false;

  const fetchServiceAvailability = async () => {
    // No restaurant picked yet → nothing restaurant-specific to check (all services open).
    if (!hasActiveRestaurant()) {
      if (!cancelled) callback(DEFAULT_SERVICE_AVAILABILITY_CONFIG);
      return;
    }
    try {
      const context = await apiClient.get<BranchContextResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}`);
      if (cancelled) return;
      callback({ services: context.serviceAvailability || DEFAULT_SERVICE_AVAILABILITY_CONFIG.services });
    } catch (error) {
      if (!isRateLimited(error)) console.warn('Failed to fetch service availability config:', error);
      if (!cancelled) callback(DEFAULT_SERVICE_AVAILABILITY_CONFIG);
    }
  };

  const poller = startPolling(fetchServiceAvailability, SERVICE_AVAILABILITY_POLL_MS);

  return () => {
    cancelled = true;
    poller.stop();
  };
}

export type DeliveryFeeTier = { belowAmount: number; fee: number };

export type PricingConfig = {
  deliveryFeeTiers: DeliveryFeeTier[];
  packagingCharge: number;
  /** Food GST % the backend adds to app orders (on items after discounts). */
  gstPercent?: number;
  /** The restaurant's menu prices already include that GST: it's taken out of the price
   *  (shown as "included"), never added on top — the customer pays the menu price. */
  pricesIncludeGst?: boolean;
  updatedAt?: unknown;
};

/** Delivery charges come only from the branch (set by its Owner/Manager in the SaaS panel);
 *  a branch with no ranges charges ₹0, so the fallback has none either. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  deliveryFeeTiers: [],
  packagingCharge: 10,
};

/**
 * Replaces the Firestore `app_config/announcement` live listener — the new backend has no
 * real-time push for this (see backend/src/models/Organization.ts's `announcement` field,
 * read via the branch-context endpoint), so this polls on an interval instead. Same
 * external shape (a callback + unsubscribe function) as the original, so call sites don't
 * need to change: calls `callback` with the parsed config, or `null` when there's no active
 * announcement or the request fails (never throws).
 */
export function subscribeToAnnouncement(callback: (config: AnnouncementConfig | null) => void): () => void {
  let cancelled = false;

  const fetchAnnouncement = async () => {
    // Announcements belong to a restaurant — none until the customer has picked one.
    if (!hasActiveRestaurant()) {
      if (!cancelled) callback(null);
      return;
    }
    try {
      const context = await apiClient.get<BranchContextResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}`);
      if (cancelled) return;

      if (!context.announcement) {
        callback(null);
        return;
      }

      callback({
        status: context.announcement.status,
        title: context.announcement.title || '',
        description: context.announcement.description || '',
        imageUrl: context.announcement.imageUrl || null,
      });
    } catch (error) {
      if (!isRateLimited(error)) console.warn('Failed to fetch announcement config:', error);
      if (!cancelled) callback(null);
    }
  };

  const poller = startPolling(fetchAnnouncement, ANNOUNCEMENT_POLL_MS);

  return () => {
    cancelled = true;
    poller.stop();
  };
}

type BranchStatusResponse = {
  organizationStatus: 'PENDING' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  branchStatus: 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'PAUSED' | 'CLOSED';
  statusReason: string | null;
};

function mapBranchStatusToAppStatus(res: BranchStatusResponse): AppStatusConfig {
  if (res.organizationStatus !== 'ACTIVE') {
    return { status: 'emergency_closed', title: 'Temporarily unavailable', description: res.statusReason || '' };
  }
  if (res.branchStatus === 'PAUSED') {
    return { status: 'temporarily_paused', title: 'Temporarily paused', description: res.statusReason || '' };
  }
  if (res.branchStatus === 'CLOSED' || res.branchStatus === 'REJECTED') {
    return { status: 'emergency_closed', title: 'Temporarily unavailable', description: res.statusReason || '' };
  }
  return { ...DEFAULT_APP_STATUS_CONFIG };
}

/**
 * Replaces the Firestore `app_config/app_status` live listener — polls the branch's
 * operational-status endpoint (see backend/src/services/publicOrdering.service.ts's
 * `getBranchOperationalStatus`, which deliberately works even when the org/branch isn't
 * ACTIVE, precisely so this can explain why). Falls back to the safe default (`active`, no
 * copy) on any request failure, so the app never blocks users due to a transient network
 * error. Returns the unsubscribe function.
 */
export function subscribeToAppStatus(callback: (config: AppStatusConfig) => void): () => void {
  let cancelled = false;

  const fetchAppStatus = async () => {
    // The status belongs to the restaurant being ordered from. Before one is picked, the
    // build-time default restaurant must not decide whether the whole app is open (it may
    // not even exist on this server — "Restaurant not found").
    if (!hasActiveRestaurant()) {
      if (!cancelled) callback(DEFAULT_APP_STATUS_CONFIG);
      return;
    }
    try {
      const res = await apiClient.get<BranchStatusResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/status`);
      if (cancelled) return;
      callback(mapBranchStatusToAppStatus(res));
    } catch (error) {
      if (!isRateLimited(error)) console.warn('Failed to fetch app status config:', error);
      if (!cancelled) callback(DEFAULT_APP_STATUS_CONFIG);
    }
  };

  const poller = startPolling(fetchAppStatus, APP_STATUS_POLL_MS);
  // Switching restaurants re-checks right away, so a restaurant's page never shows the
  // previous restaurant's paused/closed state until the next poll.
  const stopListening = onActiveRestaurantChanged(() => void fetchAppStatus());

  return () => {
    cancelled = true;
    poller.stop();
    stopListening();
  };
}

/** One-off status check of the restaurant being ordered from — checkout calls this right
 *  before placing an order (never throws; a failed check doesn't block the order, the
 *  backend still refuses a paused branch). */
export async function getActiveRestaurantStatus(): Promise<AppStatusConfig> {
  if (!hasActiveRestaurant()) return DEFAULT_APP_STATUS_CONFIG;
  try {
    const res = await apiClient.get<BranchStatusResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/status`);
    return mapBranchStatusToAppStatus(res);
  } catch {
    return DEFAULT_APP_STATUS_CONFIG;
  }
}

/** Paused or closed restaurant: it can't take orders, but the rest of the app keeps working. */
export const isRestaurantUnavailable = (status: AppStatus) => status === 'temporarily_paused' || status === 'emergency_closed';

/**
 * Fetches the checkout pricing config once (no live listener — checkout only needs the
 * value at the time the screen is opened). Replaces the Firestore `app_config/pricing`
 * doc — read via the branch-context endpoint: `deliveryFeeTiers` are the selected branch's
 * own delivery charge ranges (empty = ₹0 delivery), packaging is organization-wide. Falls back to
 * `DEFAULT_PRICING_CONFIG` on any request failure (never throws).
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const context = await apiClient.get<BranchContextResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}`);
    return {
      ...DEFAULT_PRICING_CONFIG,
      ...context.pricingConfig,
      deliveryFeeTiers: context.pricingConfig?.deliveryFeeTiers ?? [],
    };
  } catch (error) {
    console.warn('Failed to fetch pricing config:', error);
    return DEFAULT_PRICING_CONFIG;
  }
}

/**
 * Computes the delivery fee for a given subtotal using the first tier (by
 * ascending `belowAmount`) whose threshold the subtotal falls under. If the
 * subtotal meets or exceeds every tier's `belowAmount`, delivery is free.
 */
export function computeDeliveryFee(subtotal: number, tiers: DeliveryFeeTier[]): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.belowAmount - b.belowAmount);
  for (const tier of sorted) {
    if (subtotal < tier.belowAmount) return tier.fee;
  }
  return 0;
}
