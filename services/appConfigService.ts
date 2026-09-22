import { apiClient } from '../utils/apiClient';
import { getActiveOrgSlug, getActiveBranchCode } from './restaurantContext';

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
    try {
      const context = await apiClient.get<BranchContextResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}`);
      if (cancelled) return;
      callback({ services: context.serviceAvailability || DEFAULT_SERVICE_AVAILABILITY_CONFIG.services });
    } catch (error) {
      console.warn('Failed to fetch service availability config:', error);
      if (!cancelled) callback(DEFAULT_SERVICE_AVAILABILITY_CONFIG);
    }
  };

  fetchServiceAvailability();
  const interval = setInterval(fetchServiceAvailability, 30000);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

export type DeliveryFeeTier = { belowAmount: number; fee: number };

export type PricingConfig = {
  deliveryFeeTiers: DeliveryFeeTier[];
  packagingCharge: number;
  updatedAt?: unknown;
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  deliveryFeeTiers: [
    { belowAmount: 99, fee: 20 },
    { belowAmount: 149, fee: 10 },
  ],
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
      console.warn('Failed to fetch announcement config:', error);
      if (!cancelled) callback(null);
    }
  };

  fetchAnnouncement();
  const interval = setInterval(fetchAnnouncement, 60000);

  return () => {
    cancelled = true;
    clearInterval(interval);
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
    try {
      const res = await apiClient.get<BranchStatusResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/status`);
      if (cancelled) return;
      callback(mapBranchStatusToAppStatus(res));
    } catch (error) {
      console.warn('Failed to fetch app status config:', error);
      if (!cancelled) callback(DEFAULT_APP_STATUS_CONFIG);
    }
  };

  fetchAppStatus();
  const interval = setInterval(fetchAppStatus, 30000);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

/**
 * Fetches the checkout pricing config once (no live listener — checkout only needs the
 * value at the time the screen is opened). Replaces the Firestore `app_config/pricing`
 * doc — see Organization.pricingConfig, read via the branch-context endpoint. Falls back to
 * `DEFAULT_PRICING_CONFIG` on any request failure (never throws).
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  try {
    const context = await apiClient.get<BranchContextResponse>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}`);
    return context.pricingConfig || DEFAULT_PRICING_CONFIG;
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
