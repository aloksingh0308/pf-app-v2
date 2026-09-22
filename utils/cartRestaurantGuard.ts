// Shared logic that prevents a cart from silently mixing items from two different restaurants.
// Used by every add-to-cart entry point (restaurant-details, home recent-orders, deals) via
// useAddToCartWithRestaurantGuard, not just at the UI layer.

type RestaurantScopedItem = {
  cafeId?: unknown;
  restaurantId?: unknown;
};

export const getItemRestaurantId = (item: RestaurantScopedItem | null | undefined): string => {
  if (!item) return '';
  return String(item.restaurantId || item.cafeId || '').trim();
};

export const getCartRestaurantId = (cartItems: RestaurantScopedItem[]): string => {
  const withRestaurant = (cartItems || []).find((item) => Boolean(getItemRestaurantId(item)));
  return withRestaurant ? getItemRestaurantId(withRestaurant) : '';
};

/**
 * Returns true only when the cart already holds items from one restaurant AND the
 * candidate item is tagged with a different restaurant. Untagged items/candidates
 * never trigger a conflict (preserves existing single-restaurant back-compat behaviour).
 */
export const hasCartRestaurantConflict = (
  cartItems: RestaurantScopedItem[],
  candidateItem: RestaurantScopedItem | null | undefined
): boolean => {
  if (!cartItems || cartItems.length === 0) return false;

  const cartRestaurantId = getCartRestaurantId(cartItems);
  const candidateRestaurantId = getItemRestaurantId(candidateItem);

  if (!cartRestaurantId || !candidateRestaurantId) return false;
  return cartRestaurantId !== candidateRestaurantId;
};
