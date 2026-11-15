import { FoodType, ModifierGroup, ProductWithFirebaseId } from "@/types/Product";
import { ApiError, apiClient } from "../utils/apiClient";
import { getActiveOrgSlug, getActiveBranchCode, getActiveRestaurantId, hasActiveRestaurant, onActiveRestaurantChanged } from "./restaurantContext";

/**
 * Replaces the original Firestore-backed `menuItems`/`productReviews` reads with the
 * restaurant-saas-platform's public branch-menu endpoint (`GET
 * /public/branch/:orgSlug/:branchCode/menu`) — that endpoint already returns only
 * available/in-stock items and already carries the branch's real menuItem `_id` (used here
 * as `firebaseId`, kept for field-name parity with every screen that still reads that
 * field). The endpoint doesn't include per-item ratings yet (no productReviews-equivalent
 * migrated), so `rating`/`ratingCount` are 0 for now rather than fetched separately.
 */

let _menuCache: ProductWithFirebaseId[] | null = null;

interface BackendMenuItem {
  _id: string;
  name: string;
  description?: string;
  price: number;
  taxPercent: number;
  categoryId?: string | null;
  couponExcluded?: boolean;
  foodType?: FoodType;
  images?: string[];
  isAvailable: boolean;
  outOfStock: boolean;
  status: string;
  modifierGroupIds?: string[];
  addonIds?: string[];
  variants?: Array<{ _id: string; name: string; description?: string; price: number; appPrice?: number | null; isDefault?: boolean }>;
}

interface BackendModifierOption {
  name: string;
  priceDelta: number;
}

interface BackendModifier {
  _id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelect: number;
  maxSelect: number;
  options: BackendModifierOption[];
  isActive: boolean;
}

interface BackendCategory {
  _id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

interface BackendAddon {
  _id: string;
  name: string;
  price: number;
  isActive: boolean;
}

interface BackendBranchMenu {
  categories: BackendCategory[];
  items: BackendMenuItem[];
  modifiers: BackendModifier[];
  addons: BackendAddon[];
}

let _branchMenuFetch: { key: string; promise: Promise<BackendBranchMenu> } | null = null;
/** The last menu received, per branch. Opening a restaurant, its customize sheet, product
 *  details and the cart's add-ons all read this same payload — without a short cache each
 *  one re-downloaded the whole menu. Live-critical reads pass `fresh`. */
let _branchMenuCache: { key: string; at: number; menu: BackendBranchMenu } | null = null;
const BRANCH_MENU_CACHE_MS = 60_000;

/** One request (shared by concurrent callers) backs getMenuItems/getCategories/getAddons/
 *  getModifiers; a recent copy of the same branch's menu is reused unless `fresh`. */
function fetchBranchMenu(options: { fresh?: boolean } = {}): Promise<BackendBranchMenu> {
  const key = `${getActiveOrgSlug()}/${getActiveBranchCode()}`;
  if (!options.fresh && _branchMenuCache?.key === key && Date.now() - _branchMenuCache.at < BRANCH_MENU_CACHE_MS) {
    return Promise.resolve(_branchMenuCache.menu);
  }
  if (_branchMenuFetch?.key !== key) {
    const request = { key, promise: apiClient.get<BackendBranchMenu>(`/public/branch/${key}/menu`) };
    _branchMenuFetch = request;
    request.promise
      .then((menu) => { _branchMenuCache = { key, at: Date.now(), menu }; })
      .catch(() => {}) // the caller awaiting `promise` handles the error
      .finally(() => { if (_branchMenuFetch === request) _branchMenuFetch = null; });
  }
  return _branchMenuFetch.promise;
}

export async function getCategories(): Promise<Array<{ id: string; name: string; icon: string; available: boolean; displayOrder?: number }>> {
  const menu = await fetchBranchMenu();
  return menu.categories
    .filter((c) => c.isActive)
    .map((c) => ({ id: c._id, name: c.name, icon: '', available: c.isActive, displayOrder: c.sortOrder }));
}

/** The branch's standalone add-ons (e.g. "extra cheese", "cold coffee") — a distinct
 *  restaurant-saas-platform collection (models/Addon.ts), not a boolean flag on menu items
 *  the way the original app's Firestore `menuItems.isAdOns` field worked. No `imageUrl`
 *  concept exists for addons on the new backend, so it's always empty. */
export async function getAddons(): Promise<Array<{ id: string; name: string; price: number; isActive: boolean }>> {
  const menu = await fetchBranchMenu();
  return menu.addons.filter((a) => a.isActive).map((a) => ({ id: a._id, name: a.name, price: a.price, isActive: a.isActive }));
}

/** The branch's modifier GROUPS (e.g. "Spice Level", "Choice of Bread") — a menu item
 *  references these by id via its own modifierGroupIds (models/Modifier.ts). */
export async function getModifiers(): Promise<ModifierGroup[]> {
  const menu = await fetchBranchMenu();
  return menu.modifiers
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m._id,
      name: m.name,
      required: m.required,
      multiSelect: m.multiSelect,
      minSelect: m.minSelect,
      maxSelect: m.maxSelect,
      options: m.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta })),
    }));
}

function mapToMenuItem(item: BackendMenuItem): ProductWithFirebaseId {
  // The single-restaurant-per-cart guard (useAddToCartWithRestaurantGuard /
  // utils/cartRestaurantGuard.ts) compares cart items' cafeId/restaurantId — these were
  // previously hardcoded to null here, which silently disabled that guard for every
  // regular menu item (and, transitively, every deal/combo built from one, since
  // buildCartItemsForDeal resolves its lines through this same mapping). The active
  // restaurant is already known at fetch time (this menu was fetched FOR it), so stamp it
  // on every item instead of leaving the guard with nothing to compare.
  const activeRestaurantId = getActiveRestaurantId();
  const variants = (item.variants || []).map((v) => ({
    id: v._id,
    name: v.name,
    description: v.description || '',
    price: v.price,
    appPrice: v.appPrice ?? null,
  }));
  const customerPrice = variants.length > 0 ? variants[0].appPrice ?? variants[0].price : item.price;
  return {
    firebaseId: item._id,
    id: item._id,
    name: item.name,
    description: item.description || "",
    images: item.images || [],
    price: customerPrice,
    rating: 0,
    ratingCount: 0,
    qty: null,
    serves: null,
    categoryId: item.categoryId || null,
    couponExcluded: Boolean(item.couponExcluded),
    cafeId: activeRestaurantId,
    restaurantId: activeRestaurantId,
    orgSlug: hasActiveRestaurant() ? getActiveOrgSlug() : null,
    branchCode: hasActiveRestaurant() ? getActiveBranchCode() : null,
    emoji: null,
    foodType: item.foodType || "VEG",
    available: item.status === "ACTIVE" && item.isAvailable,
    inStock: !item.outOfStock,
    hasHalfPortion: false,
    halfPrice: null,
    variants,
    modifierGroupIds: item.modifierGroupIds || [],
    addonIds: item.addonIds || [],
    createdAt: undefined,
  };
}

export function clearMenuCache() {
  _menuCache = null;
}

onActiveRestaurantChanged(clearMenuCache);

export async function getMenuItems(options: { fresh?: boolean } = {}): Promise<ProductWithFirebaseId[]> {
  const menu = await fetchBranchMenu(options);
  const items = menu.items.map(mapToMenuItem).filter((item) => item.available);
  _menuCache = items;
  return items;
}

export async function getAvailabilityByFirebaseIds(firebaseIds: string[]): Promise<Map<string, boolean>> {
  const cleanIds = Array.from(new Set((firebaseIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const availability = new Map<string, boolean>();
  if (cleanIds.length === 0) return availability;

  // No dedicated by-ids availability endpoint yet — the branch menu is small enough
  // (single branch) that fetching it whole and filtering client-side is fine for now.
  const items = _menuCache || (await getMenuItems());
  const byId = new Map(items.map((item) => [item.firebaseId, item]));
  cleanIds.forEach((id) => {
    const item = byId.get(id);
    availability.set(id, item ? item.available !== false && item.inStock !== false : false);
  });
  return availability;
}

export async function getMenuItemsByFirebaseIds(
  firebaseIds: string[],
  options?: { forceRefresh?: boolean }
): Promise<Map<string, ProductWithFirebaseId>> {
  const cleanIds = Array.from(new Set((firebaseIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
  const itemMap = new Map<string, ProductWithFirebaseId>();
  if (cleanIds.length === 0) return itemMap;

  const items = options?.forceRefresh || !_menuCache ? await getMenuItems({ fresh: options?.forceRefresh }) : _menuCache;
  const byId = new Map(items.map((item) => [item.firebaseId, item]));
  cleanIds.forEach((id) => {
    const item = byId.get(id);
    if (item) itemMap.set(id, item);
  });
  return itemMap;
}

export type MenuPageQuery = {
  categoryId?: string;
  q?: string;
  foodType?: 'VEG' | 'EGG' | 'NON_VEG';
  sort?: 'PRICE_ASC' | 'PRICE_DESC';
};

export type MenuPage = {
  items: ProductWithFirebaseId[];
  nextCursor: string | null;
  total: number;
  /** Matching dishes per category id ("other" = uncategorised) across every page. */
  categoryCounts: Record<string, number>;
  /** Every food type on the restaurant's whole menu, whatever the filters. */
  foodTypes: FoodType[];
};

export const MENU_PAGE_SIZE = 20;

/** One page of the active restaurant's menu for the menu screen's infinite scroll — filters
 *  and price sort run on the server (GET /public/branch/:org/:branch/menu/items), so every
 *  page is a page of matches. The cart, combos and customise sheet still read the whole menu
 *  through getMenuItems/getModifiers/getAddons. */
export async function getMenuItemsPage(query: MenuPageQuery, cursor: string | null = null, limit = MENU_PAGE_SIZE): Promise<MenuPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.q?.trim()) params.set('q', query.q.trim());
  if (query.foodType) params.set('foodType', query.foodType);
  if (query.sort) params.set('sort', query.sort);
  try {
    const page = await apiClient.get<{ items: BackendMenuItem[]; nextCursor: string | null; total: number; categoryCounts: Record<string, number>; foodTypes: FoodType[] }>(
      `/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/menu/items?${params.toString()}`
    );
    return { ...page, items: page.items.map(mapToMenuItem).filter((item) => item.available) };
  } catch (error) {
    // A backend deployed before this endpoint existed answers "Route not found" — page the
    // whole-menu payload on the device instead, so the menu never comes up empty.
    if (error instanceof ApiError && error.status === 404 && /^Route not found/i.test(error.message)) {
      return pageMenuLocally(query, cursor, limit);
    }
    throw error;
  }
}

/** Same filters, order and paging as the server's getBranchMenuItemsPage, over the whole menu. */
async function pageMenuLocally(query: MenuPageQuery, cursor: string | null, limit: number): Promise<MenuPage> {
  const [items, categories] = await Promise.all([getMenuItems(), getCategories()]);
  const rank = new Map(categories.map((category, index) => [category.id, index]));
  const rankOf = (item: ProductWithFirebaseId) => rank.get(String(item.categoryId || '')) ?? Number.MAX_SAFE_INTEGER;
  const typeOf = (item: ProductWithFirebaseId) => String(item.foodType || 'VEG');
  const q = query.q?.trim().toLowerCase();
  const matches = items.filter((item) => {
    if (query.categoryId && String(item.categoryId || '') !== query.categoryId) return false;
    if (query.foodType) {
      const type = typeOf(item);
      if (query.foodType === 'VEG' ? type !== 'VEG' && type !== 'VEGAN' : type !== query.foodType) return false;
    }
    if (q && !`${item.name || ''} ${item.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  matches.sort((a, b) => {
    const byCategory = rankOf(a) - rankOf(b);
    if (byCategory !== 0 || !query.sort) return byCategory;
    return query.sort === 'PRICE_ASC' ? a.price - b.price : b.price - a.price;
  });
  const categoryCounts: Record<string, number> = {};
  matches.forEach((item) => {
    const key = rank.has(String(item.categoryId || '')) ? String(item.categoryId) : 'other';
    categoryCounts[key] = (categoryCounts[key] || 0) + 1;
  });
  const start = Number(cursor) || 0;
  const pageItems = matches.slice(start, start + limit);
  const next = start + pageItems.length;
  return {
    items: pageItems,
    nextCursor: next < matches.length ? String(next) : null,
    total: matches.length,
    categoryCounts,
    foodTypes: [...new Set(items.map(typeOf))] as FoodType[],
  };
}
