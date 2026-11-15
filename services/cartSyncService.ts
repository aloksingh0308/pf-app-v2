import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Store } from '@reduxjs/toolkit';
import type { RootState } from '@/store';
import { setCartItems } from '@/store/slices/cartSlice';
import { getActiveBranchCode, getActiveOrgSlug, getActiveRestaurantId, hasActiveRestaurant } from './restaurantContext';
import { apiClient } from '../utils/apiClient';
import { getCartRestaurantId } from '../utils/cartRestaurantGuard';

/**
 * Keeps the cart alive for abandoned-cart reminders:
 *  1. Saves it on the phone, so it survives the app being closed (restored on launch for
 *     up to 24 h) — a reminder that opens an empty cart would be useless.
 *  2. Mirrors it to the server a few seconds after each change (PUT /customers/me/cart), and
 *     deletes the mirror when the cart is emptied (DELETE). The server only uses it to send
 *     "your cart is waiting" pushes — prices are always recalculated at checkout.
 * Never while editing an existing order (that cart isn't a new purchase).
 */
const STORAGE_KEY = 'cart:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SAVE_DELAY_MS = 800;
const SYNC_DELAY_MS = 4000;

type CartItem = RootState['cart']['items'][number];
type Saved = { savedAt: number; items: CartItem[] };

let started = false;

async function restore(store: Store<RootState>) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Saved;
    const fresh = Date.now() - Number(saved.savedAt) < MAX_AGE_MS;
    if (!fresh || !Array.isArray(saved.items) || !saved.items.length) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    // Something was added before the restore finished — keep that, not the old cart.
    if (store.getState().cart.items.length) return;
    store.dispatch(setCartItems(saved.items));
  } catch (error) {
    console.log('cart restore failed:', error);
  }
}

/** The restaurant the cart is from: stamped on the items, else the open restaurant if it is that one. */
function cartRestaurant(items: CartItem[]): { orgSlug: string; branchCode: string } | null {
  const stamped = items.find((i) => i.orgSlug && i.branchCode);
  if (stamped?.orgSlug && stamped.branchCode) return { orgSlug: stamped.orgSlug, branchCode: stamped.branchCode };
  const id = getCartRestaurantId(items);
  if (id && hasActiveRestaurant() && getActiveRestaurantId() === id) return { orgSlug: getActiveOrgSlug(), branchCode: getActiveBranchCode() };
  return null;
}

export function startCartSync(store: Store<RootState>) {
  if (started) return;
  started = true;
  void restore(store);

  let lastItems = store.getState().cart.items;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let mirrored = false; // the server holds a non-empty cart for this session

  const save = () => {
    const { items, editingOrderId } = store.getState().cart;
    if (editingOrderId) return;
    const write = items.length ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), items } satisfies Saved)) : AsyncStorage.removeItem(STORAGE_KEY);
    void write.catch((error) => console.log('cart save failed:', error));
  };

  const sync = () => {
    const state = store.getState();
    if (!state.auth.isAuthenticated || state.cart.editingOrderId) return;
    const items = state.cart.items;
    if (!items.length) {
      if (mirrored) void apiClient.delete('/public/customers/me/cart').then(() => (mirrored = false)).catch((error) => console.log('cart clear sync failed:', error));
      return;
    }
    const restaurant = cartRestaurant(items);
    if (!restaurant) return;
    void apiClient
      .put('/public/customers/me/cart', {
        ...restaurant,
        items: items.slice(0, 100).map((i) => ({
          menuItemId: String(i.id),
          name: String(i.name || 'Item').slice(0, 120),
          quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
          price: Math.max(0, Number(i.price) || 0),
        })),
      })
      .then(() => (mirrored = true))
      .catch((error) => console.log('cart sync failed:', error));
  };

  store.subscribe(() => {
    const items = store.getState().cart.items;
    if (items === lastItems) return;
    lastItems = items;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, SYNC_DELAY_MS);
  });
}

/** After sign-in, mirror a cart that was filled while signed out. */
export function syncCartNow(store: Store<RootState>) {
  const items = store.getState().cart.items;
  if (!items.length || !store.getState().auth.isAuthenticated) return;
  // Re-dispatching the same items triggers the normal debounced save + sync.
  store.dispatch(setCartItems([...items]));
}
