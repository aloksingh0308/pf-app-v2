import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import { apiClient } from '../utils/apiClient';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { BackendDirectoryRestaurant, mapDirectoryRestaurant, RestaurantRecord } from './restaurantService';
import { showAlert } from './alertService';
import type { RootState } from '../store';

/**
 * Saved restaurants and dishes — stored on the customer's account
 * (backend/src/services/customerFavorite.service.ts), not on the device, so they follow the
 * customer to a new phone or a reinstall. The saved ids live in one in-memory store shared by
 * every heart button, loaded once per signed-in account and updated optimistically on tap.
 */

export type FavoriteKind = 'RESTAURANT' | 'MENU_ITEM';

export type FavoriteMenuItem = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string;
  foodType?: string;
  /** False when the dish is switched off, out of stock or its category is hidden. */
  available: boolean;
  restaurant: RestaurantRecord;
};

export type FavoritesList = { restaurants: RestaurantRecord[]; items: FavoriteMenuItem[] };

interface BackendFavoritesList {
  restaurants: BackendDirectoryRestaurant[];
  items: { id: string; name: string; price: number; imageUrl?: string | null; foodType?: string; available: boolean; restaurant: BackendDirectoryRestaurant }[];
}

type Store = { accountId: string | null; restaurantIds: Set<string>; menuItemIds: Set<string> };
let store: Store = { accountId: null, restaurantIds: new Set(), menuItemIds: new Set() };
let loadingFor: string | null = null;
const listeners = new Set<() => void>();

const emit = (next: Store) => {
  store = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const idsOf = (current: Store, kind: FavoriteKind) => (kind === 'RESTAURANT' ? current.restaurantIds : current.menuItemIds);

/** Loads the saved ids for this account (once), or clears them on sign-out. */
async function ensureLoaded(accountId: string | null) {
  if (!accountId) {
    if (store.accountId) emit({ accountId: null, restaurantIds: new Set(), menuItemIds: new Set() });
    loadingFor = null;
    return;
  }
  if (store.accountId === accountId || loadingFor === accountId) return;
  loadingFor = accountId;
  try {
    const ids = await apiClient.get<{ restaurantIds: string[]; menuItemIds: string[] }>('/public/customers/me/favorites/ids');
    if (loadingFor !== accountId) return;
    emit({ accountId, restaurantIds: new Set(ids.restaurantIds), menuItemIds: new Set(ids.menuItemIds) });
  } catch {
    // Hearts stay empty; the next screen that mounts a heart retries.
  } finally {
    if (loadingFor === accountId) loadingFor = null;
  }
}

function setSaved(kind: FavoriteKind, id: string, saved: boolean) {
  const next = new Set(idsOf(store, kind));
  if (saved) next.add(id);
  else next.delete(id);
  emit(kind === 'RESTAURANT' ? { ...store, restaurantIds: next } : { ...store, menuItemIds: next });
}

/** Whether a restaurant (branch id) or dish (menu item id) is saved, and a toggle for its heart. */
export function useFavorite(kind: FavoriteKind, id: string | null | undefined) {
  const accountId = useSelector((state: RootState) => state.auth.user?.uid || null);
  useEffect(() => { void ensureLoaded(accountId); }, [accountId]);
  const isFavorite = useSyncExternalStore(subscribe, () => Boolean(id) && idsOf(store, kind).has(String(id)));

  const toggle = useCallback(async () => {
    if (!id) return;
    if (!accountId) {
      showAlert('Sign in to save', 'Sign in to keep your favourite restaurants and dishes.');
      return;
    }
    const targetId = String(id);
    const wasSaved = idsOf(store, kind).has(targetId);
    setSaved(kind, targetId, !wasSaved);
    try {
      if (wasSaved) await apiClient.delete(`/public/customers/me/favorites/${kind}/${targetId}`);
      else await apiClient.post('/public/customers/me/favorites', { kind, targetId });
    } catch {
      setSaved(kind, targetId, wasSaved);
      showAlert('Unable to update favourites', 'Please check your connection and try again.');
    }
  }, [accountId, id, kind]);

  return { isFavorite, toggle };
}

/** Removes a saved restaurant/dish (the favourites screen's own heart). */
export async function removeFavorite(kind: FavoriteKind, id: string) {
  await apiClient.delete(`/public/customers/me/favorites/${kind}/${id}`);
  setSaved(kind, id, false);
}

/** Everything the customer saved, newest first, ready to open like a search result. */
export async function getFavorites(): Promise<FavoritesList> {
  const result = await apiClient.get<BackendFavoritesList>('/public/customers/me/favorites');
  return {
    restaurants: result.restaurants.map(mapDirectoryRestaurant),
    items: result.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: resolveImageUrl(item.imageUrl),
      foodType: item.foodType,
      available: item.available,
      restaurant: mapDirectoryRestaurant(item.restaurant),
    })),
  };
}

export type FavoriteCounts = { restaurants: number; items: number };
type FavoritesPage<T> = { items: T[]; hasMore: boolean; counts: FavoriteCounts };

/** One page of saved restaurants or dishes for the favourites screen's infinite scroll. A
 *  backend that doesn't page favourites yet answers with both lists in one object — then the
 *  whole tab comes back as a single page. */
export async function pageFavoriteRestaurants(page: number): Promise<FavoritesPage<RestaurantRecord>> {
  const result = await apiClient.getPage<BackendDirectoryRestaurant>('/public/customers/me/favorites?kind=RESTAURANT', page, 20);
  if (!result.meta) {
    const all = await getFavorites();
    return { items: all.restaurants, hasMore: false, counts: { restaurants: all.restaurants.length, items: all.items.length } };
  }
  return { items: result.items.map(mapDirectoryRestaurant), hasMore: result.hasMore, counts: countsOf(result.meta) };
}

export async function pageFavoriteItems(page: number): Promise<FavoritesPage<FavoriteMenuItem>> {
  const result = await apiClient.getPage<BackendFavoritesList['items'][number]>('/public/customers/me/favorites?kind=MENU_ITEM', page, 20);
  if (!result.meta) {
    const all = await getFavorites();
    return { items: all.items, hasMore: false, counts: { restaurants: all.restaurants.length, items: all.items.length } };
  }
  return {
    items: result.items.map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      imageUrl: resolveImageUrl(item.imageUrl),
      foodType: item.foodType,
      available: item.available,
      restaurant: mapDirectoryRestaurant(item.restaurant),
    })),
    hasMore: result.hasMore,
    counts: countsOf(result.meta),
  };
}

const countsOf = (meta: object): FavoriteCounts => {
  const counts = (meta as { counts?: Partial<FavoriteCounts> }).counts;
  return { restaurants: Number(counts?.restaurants || 0), items: Number(counts?.items || 0) };
};
