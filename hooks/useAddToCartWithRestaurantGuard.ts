import { useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { RootState } from '@/store';
import { addToCart, clearCart } from '@/store/slices/cartSlice';
import { hasCartRestaurantConflict } from '@/utils/cartRestaurantGuard';
import { showAlert } from '@/services/alertService';
import { track } from '@/services/analytics';

/**
 * Central gate for every "add to cart" call in the app. If the item being added
 * belongs to a different restaurant than what's already in the cart, the add is
 * held back and a confirmation prompt is shown instead of silently mixing carts.
 * This enforces the single-restaurant-per-cart rule in the cart logic itself,
 * not only in a screen's UI.
 */
export function useAddToCartWithRestaurantGuard() {
  const dispatch = useDispatch();
  // Read the cart when adding, not via a subscription — every ProductCard uses this hook,
  // and subscribing re-rendered the whole visible menu on each cart change.
  const store = useStore<RootState>();

  const addItem = useCallback(
    (item: any, restaurantNames?: { current?: string; next?: string }) => {
      if (!hasCartRestaurantConflict(store.getState().cart.items, item)) {
        dispatch(addToCart(item));
        track('add_to_cart', { item_name: item?.name, value: Number(item?.price) || 0, currency: 'INR' });
        return true;
      }

      const currentName = restaurantNames?.current || 'another restaurant';
      const nextName = restaurantNames?.next || 'this restaurant';

      showAlert(
        'Start a new order?',
        `You can only order from one restaurant at a time. Your cart has items from ${currentName} — clear it and add items from ${nextName} instead?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear Cart & Add',
            style: 'destructive',
            onPress: () => {
              dispatch(clearCart());
              dispatch(addToCart(item));
            },
          },
        ]
      );
      return false;
    },
    [store, dispatch]
  );

  const addItems = useCallback(
    (items: any[], restaurantNames?: { current?: string; next?: string }) => {
      if (!items || items.length === 0) return true;

      const cartItems = store.getState().cart.items;
      const conflicting = items.find((item) => hasCartRestaurantConflict(cartItems, item));
      if (!conflicting) {
        items.forEach((item) => dispatch(addToCart(item)));
        track('add_to_cart', { items: items.length });
        return true;
      }

      const currentName = restaurantNames?.current || 'another restaurant';
      const nextName = restaurantNames?.next || 'this restaurant';

      showAlert(
        'Start a new order?',
        `You can only order from one restaurant at a time. Your cart has items from ${currentName} — clear it and add items from ${nextName} instead?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clear Cart & Add',
            style: 'destructive',
            onPress: () => {
              dispatch(clearCart());
              items.forEach((item) => dispatch(addToCart(item)));
            },
          },
        ]
      );
      return false;
    },
    [store, dispatch]
  );

  return { addItem, addItems };
}
