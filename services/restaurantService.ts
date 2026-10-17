import { apiClient } from '../utils/apiClient';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import type { FoodType } from '../types/Product';

export type RestaurantRecord = {
  id: string;
  restaurantId?: string;
  cafeId?: string;
  orgSlug?: string;
  branchCode?: string;
  name?: string;
  address?: string;
  desc?: string;
  image?: string;
  coverImage?: string;
  displayOrder?: number;
  /** Active/visible-to-customers flag. Missing/undefined is treated as active for back-compat. */
  available?: boolean;
  /** From the backend's ranking engine (services/restaurantRanking.service.ts) — purely
   *  display flags, never the underlying score (that's deliberately never sent to the
   *  client). Optional so a restaurant that came from anywhere other than the ranked
   *  `/public/restaurants` listing (e.g. a cached/older shape) just shows no badge. */
  isSponsored?: boolean;
  isNew?: boolean;
  /** Delivery ETA range (minutes) from the backend's eta.service.ts — never the underlying
   *  prep-time/kitchen-load inputs, only the display range (Feature 7). */
  eta?: { min: number; max: number; exceedsMax: boolean };
  /** km from the customer's current location, computed backend-side — null when either the
   *  customer's location or this branch's coordinates aren't available (never fabricated). */
  distanceKm?: number | null;
  /** Distinct food types this branch currently sells (backend-computed from its live menu) —
   *  powers Home's Pure Veg / Non-Veg filter. Empty = no sellable items right now. */
  menuFoodTypes?: FoodType[];
  [key: string]: any;
};

export type RestaurantFoodFilter = 'ALL' | 'PURE_VEG' | 'NON_VEG';

/** "Pure Veg" = everything on the menu is veg/vegan; "Non-Veg" = serves at least one non-veg
 *  dish. A restaurant whose food types are unknown (older cached record) only matches "All". */
export const matchesRestaurantFoodFilter = (restaurant: RestaurantRecord, filter: RestaurantFoodFilter): boolean => {
  if (filter === 'ALL') return true;
  const types = restaurant.menuFoodTypes || [];
  if (types.length === 0) return false;
  if (filter === 'PURE_VEG') return types.every((type) => type === 'VEG' || type === 'VEGAN');
  return types.includes('NON_VEG');
};

/** "17-17 min" reads like a typo, not a real delivery estimate — collapses to a single
 *  number when the backend's min/max range happens to be identical. Single source for this
 *  across every card so the whole app stays consistent when the range does differ. */
export const formatEta = (eta?: { min: number; max: number; exceedsMax: boolean } | null): string => {
  if (!eta) return '';
  if (eta.exceedsMax) return `${eta.max}+ min`;
  if (eta.min === eta.max) return `${eta.min} min`;
  return `${eta.min}-${eta.max} min`;
};

export const formatDistance = (distanceKm?: number | null): string => {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return '';
  return `${distanceKm.toFixed(1)} km`;
};

const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

const getRestaurantKeys = (restaurant: RestaurantRecord) => {
  const keys = [restaurant.id, restaurant.restaurantId, restaurant.cafeId]
    .map((value) => normalizeKey(value))
    .filter(Boolean);
  return new Set(keys);
};

export type RestaurantOpeningStatus = {
  isOpen: boolean;
  nextOpeningText: string | null;
  openingTimeText: string | null;
  closingTimeText: string | null;
  minutesUntilClose: number | null;
  isClosingSoon: boolean;
  closingSoonText: string | null;
};

const parseTimeToken = (value: string): { minutes: number; label: string } | null => {
  const normalized = String(value || '').replace(/\s+/g, '').toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) {
    return null;
  }

  const rawHour = Number(match[1]);
  const rawMinutes = Number(match[2] || 0);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinutes) || rawHour < 1 || rawHour > 12 || rawMinutes < 0 || rawMinutes > 59) {
    return null;
  }

  const meridiem = match[3];
  const baseHour = rawHour % 12;
  const hours24 = meridiem === 'PM' ? baseHour + 12 : baseHour;
  const minutes = (hours24 * 60) + rawMinutes;
  const label = `${rawHour}:${String(rawMinutes).padStart(2, '0')} ${meridiem}`;

  return { minutes, label };
};

export const getRestaurantOpeningStatus = (openingHours?: string, now = new Date()): RestaurantOpeningStatus => {
  const matches = String(openingHours || '').match(/\d{1,2}(?::\d{2})?\s*[AaPp][Mm]/g);
  if (!matches || matches.length < 2) {
    return {
      isOpen: true,
      nextOpeningText: null,
      openingTimeText: null,
      closingTimeText: null,
    };
  }

  const openingTime = parseTimeToken(matches[0]);
  const closingTime = parseTimeToken(matches[1]);
  if (!openingTime || !closingTime) {
    return {
      isOpen: true,
      nextOpeningText: null,
      openingTimeText: null,
      closingTimeText: null,
    };
  }

  const currentMinutes = (now.getHours() * 60) + now.getMinutes();
  const isOvernight = closingTime.minutes <= openingTime.minutes;
  const isOpen = isOvernight
    ? currentMinutes >= openingTime.minutes || currentMinutes < closingTime.minutes
    : currentMinutes >= openingTime.minutes && currentMinutes < closingTime.minutes;

  let nextOpeningText: string | null = null;
  if (!isOpen) {
    if (isOvernight) {
      nextOpeningText = `today at ${openingTime.label}`;
    } else if (currentMinutes < openingTime.minutes) {
      nextOpeningText = `today at ${openingTime.label}`;
    } else {
      nextOpeningText = `tomorrow at ${openingTime.label}`;
    }
  }

  let minutesUntilClose: number | null = null;
  if (isOpen) {
    minutesUntilClose = isOvernight && currentMinutes >= openingTime.minutes
      ? (24 * 60 - currentMinutes) + closingTime.minutes
      : closingTime.minutes - currentMinutes;
  }

  const isClosingSoon = Boolean(isOpen && minutesUntilClose !== null && minutesUntilClose <= 30);
  const closingSoonText = isClosingSoon ? `Closes at ${closingTime.label} soon` : null;

  return {
    isOpen,
    nextOpeningText,
    openingTimeText: openingTime.label,
    closingTimeText: closingTime.label,
    minutesUntilClose,
    isClosingSoon,
    closingSoonText,
  };
};

export const getRestaurantClosedMessage = (openingHours?: string) => {
  const status = getRestaurantOpeningStatus(openingHours);
  if (status.isOpen) {
    return '';
  }

  if (status.nextOpeningText) {
    return `Cafe is currently closed. Next opening time is ${status.nextOpeningText}. Still you can reserve your order schedule now.`;
  }

  return 'Cafe is currently closed right now. Please try again during opening hours.';
};

export interface BackendDirectoryRestaurant {
  id: string;
  orgSlug: string;
  branchCode: string;
  name: string;
  organizationName: string;
  branchName: string;
  description?: string;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  backgroundImageUrl?: string | null;
  foodType?: string;
  menuFoodTypes?: FoodType[];
  rating?: { average: number; count: number };
  phone?: string;
  address?: { line1?: string; city?: string } | null;
  latitude?: number | null;
  longitude?: number | null;
  fssai?: string;
  operatingHours?: Record<string, { isOpen: boolean; open: string; close: string }>;
  ranking?: {
    position: number;
    isSponsored: boolean;
    isNew: boolean;
    eta: { min: number; max: number; exceedsMax: boolean };
    distanceKm: number | null;
  };
}

function to12Hour(time24: string): string {
  const [hourStr, minuteStr] = String(time24 || '').split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr) || 0;
  if (!Number.isFinite(hour)) return '';
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** The original app stored one flat "10:30 AM - 10:00PM" string per restaurant; the new
 *  backend's `operatingHours` is per-day — picking today's entry (falling back to any day
 *  with hours set) reproduces the same single-line display without changing the UI. */
function formatOpeningHours(operatingHours?: BackendDirectoryRestaurant['operatingHours']): string {
  if (!operatingHours) return '';
  const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
  const today = operatingHours[todayKey];
  const fallback = Object.values(operatingHours)[0];
  const day = today?.isOpen ? today : fallback;
  if (!day || !day.isOpen) return '';
  return `${to12Hour(day.open)} - ${to12Hour(day.close)}`;
}

/** Replaces the original app's direct read of the Firestore `restaurants` collection —
 *  that collection was never scoped to one organization either (this app has always been a
 *  directory of every restaurant on the platform), so this calls the equivalent
 *  cross-organization directory endpoint. `orgSlug`/`branchCode` are carried on each record
 *  so screens/services downstream can tell the backend which restaurant they mean (see
 *  services/restaurantContext.ts) — the old Firestore doc had no such concept since a
 *  restaurant's whole menu lived under its own doc id already. */
export function mapDirectoryRestaurant(restaurant: BackendDirectoryRestaurant): RestaurantRecord {
  const address = [restaurant.address?.line1, restaurant.address?.city].filter(Boolean).join(', ');
  return {
    id: restaurant.id,
    restaurantId: restaurant.id,
    cafeId: restaurant.id,
    orgSlug: restaurant.orgSlug,
    branchCode: restaurant.branchCode,
    name: restaurant.name,
    address,
    desc: restaurant.description,
    cuisine: restaurant.foodType,
    image: resolveImageUrl(restaurant.logoUrl),
    // The branch's own background image (set in the SaaS admin's Branch profile) takes
    // priority over the organization-level coverImageUrl — every screen that already
    // renders `coverImage` (the cross-restaurant listing card and the cafe details hero,
    // see home.tsx/cafe-details.tsx) picks this up automatically, no separate field to thread through.
    coverImage: resolveImageUrl(restaurant.backgroundImageUrl || restaurant.coverImageUrl),
    phone: restaurant.phone,
    latitude: restaurant.latitude ?? undefined,
    longitude: restaurant.longitude ?? undefined,
    fssai: restaurant.fssai || undefined,
    openingHours: formatOpeningHours(restaurant.operatingHours),
    displayOrder: 0,
    available: true,
    isSponsored: restaurant.ranking?.isSponsored || false,
    isNew: restaurant.ranking?.isNew || false,
    eta: restaurant.ranking?.eta,
    distanceKm: restaurant.ranking?.distanceKm ?? null,
    menuFoodTypes: restaurant.menuFoodTypes || [],
    rating: restaurant.rating?.average || 0,
    ratingCount: restaurant.rating?.count || 0,
  };
}

/** Live customer rating for one restaurant (average of every dish rating it has received —
 *  see the backend's getRatingsByBranch) — for screens opened with a possibly-stale record. */
export const getRestaurantRating = async (orgSlug: string, branchCode: string): Promise<{ average: number; count: number }> => {
  const context = await apiClient.get<{ rating?: { average: number; count: number } }>(
    `/public/branch/${encodeURIComponent(orgSlug)}/${encodeURIComponent(branchCode)}`
  );
  return context.rating || { average: 0, count: 0 };
};

/** Replaces the original app's direct read of the Firestore `restaurants` collection —
 *  that collection was never scoped to one organization either (this app has always been a
 *  directory of every restaurant on the platform), so this calls the equivalent
 *  cross-organization directory endpoint. `orgSlug`/`branchCode` are carried on each record
 *  so screens/services downstream can tell the backend which restaurant they mean (see
 *  services/restaurantContext.ts) — the old Firestore doc had no such concept since a
 *  restaurant's whole menu lived under its own doc id already. */
/** `coords` feeds the backend's ranking engine (location filtering + distance scoring —
 *  see restaurantRanking.service.ts); omitting it still works exactly as before (no
 *  location-based filtering/scoring, same as when this endpoint had no ranking engine at all). */
export const getRestaurants = async (coords?: { latitude: number; longitude: number } | null): Promise<RestaurantRecord[]> => {
  const query = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : '';
  const restaurants = await apiClient.get<BackendDirectoryRestaurant[]>(`/public/restaurants${query}`);
  return restaurants.map(mapDirectoryRestaurant);
};

export const findRestaurantByAnyId = async (rawId: unknown): Promise<RestaurantRecord | null> => {
  const normalizedId = normalizeKey(rawId);
  if (!normalizedId) return null;

  const restaurants = await getRestaurants();
  return restaurants.find((restaurant) => getRestaurantKeys(restaurant).has(normalizedId)) || null;
};

export type MenuItemSearchResult = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  foodType?: string;
  restaurant: RestaurantRecord;
};

export type CuisineSearchResult = { name: string; restaurants: RestaurantRecord[] };
export type CategorySearchResult = { id: string; name: string; imageUrl?: string; restaurant: RestaurantRecord };
export type SearchResults = {
  restaurants: RestaurantRecord[];
  cuisines: CuisineSearchResult[];
  categories: CategorySearchResult[];
  menuItems: MenuItemSearchResult[];
};
export const EMPTY_SEARCH_RESULTS: SearchResults = { restaurants: [], cuisines: [], categories: [], menuItems: [] };

interface BackendSearchResponse {
  restaurants: BackendDirectoryRestaurant[];
  cuisines?: Array<{ name: string; restaurants: BackendDirectoryRestaurant[] }>;
  categories?: Array<{ id: string; name: string; imageUrl?: string | null; restaurant: BackendDirectoryRestaurant }>;
  menuItems: Array<{ id: string; name: string; price: number; imageUrl?: string | null; foodType?: string; restaurant: BackendDirectoryRestaurant }>;
}

/** Platform-wide search (home.tsx's search bar) across restaurant names, cuisines, menu
 *  category names and dish names — returned as separate groups because each means
 *  something different to tap: a restaurant opens it, a cuisine lists the restaurants
 *  serving it, a category opens that restaurant's menu at the category, a dish opens the
 *  restaurant selling it. */
export const searchRestaurantsAndMenuItems = async (
  query: string,
  coords?: { latitude: number; longitude: number } | null
): Promise<SearchResults> => {
  const trimmed = query.trim();
  if (!trimmed) return EMPTY_SEARCH_RESULTS;

  const result = await apiClient.get<BackendSearchResponse>(`/public/search?q=${encodeURIComponent(trimmed)}${coords ? `&lat=${coords.latitude}&lng=${coords.longitude}` : ''}`);
  return {
    restaurants: result.restaurants.map(mapDirectoryRestaurant),
    cuisines: (result.cuisines || []).map((cuisine) => ({ name: cuisine.name, restaurants: cuisine.restaurants.map(mapDirectoryRestaurant) })),
    categories: (result.categories || []).map((category) => ({
      id: category.id,
      name: category.name,
      imageUrl: resolveImageUrl(category.imageUrl),
      restaurant: mapDirectoryRestaurant(category.restaurant),
    })),
    menuItems: result.menuItems.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: resolveImageUrl(item.imageUrl),
      foodType: item.foodType,
      restaurant: mapDirectoryRestaurant(item.restaurant),
    })),
  };
};
