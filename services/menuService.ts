import { FoodType, ModifierGroup, ProductWithFirebaseId } from "@/types/Product";
import { apiClient } from "../utils/apiClient";
import { getActiveOrgSlug, getActiveBranchCode, getActiveRestaurantId, onActiveRestaurantChanged } from "./restaurantContext";

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

let _branchMenuFetch: Promise<BackendBranchMenu> | null = null;

/** A single request backs both getMenuItems() and getCategories() when called together
 *  (as restaurant-details.tsx does) — same branch-menu payload, no duplicate round trip. */
function fetchBranchMenu(): Promise<BackendBranchMenu> {
  if (!_branchMenuFetch) {
    _branchMenuFetch = apiClient
      .get<BackendBranchMenu>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/menu`)
      .finally(() => {
        _branchMenuFetch = null;
      });
  }
  return _branchMenuFetch;
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

export async function getMenuItems(): Promise<ProductWithFirebaseId[]> {
  const menu = await fetchBranchMenu();
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

  const items = options?.forceRefresh || !_menuCache ? await getMenuItems() : _menuCache;
  const byId = new Map(items.map((item) => [item.firebaseId, item]));
  cleanIds.forEach((id) => {
    const item = byId.get(id);
    if (item) itemMap.set(id, item);
  });
  return itemMap;
}
