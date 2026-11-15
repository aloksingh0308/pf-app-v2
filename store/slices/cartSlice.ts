import { getDealBundleQuantity, getDealUnitQuantity } from '@/utils/dealCart';
// store/slices/cartSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Product } from '../../types/Product';
import { logout } from './authSlice';
import { buildProductCartKey } from '@/utils/productVariants';

interface CartItem extends Product {
  quantity: number;
}

interface CartState {
  items: CartItem[];
  editingOrderId: string | null;
  editingOrderType: string | null;
  editingTableNumber: string | null;
  editingDeliveryAddress: string | null;
  editingRestaurantId: string | null;
  editingDeliveryLatitude: string | null;
  editingDeliveryLongitude: string | null;
  editingDeliveryAddressId: string | null;
}

const getCartItemKey = (item: Product) => buildProductCartKey(item);

const safeQuantity = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.round(parsed));
};


const getDealUnitMap = (items: CartItem[]) => {
  if (items.length === 0) {
    return { bundleQuantity: 1, units: new Map<string, number>() };
  }

  const bundleQuantity = getDealBundleQuantity(items);
  const units = new Map<string, number>();

  items.forEach((item) => {
    units.set(getCartItemKey(item), getDealUnitQuantity(item, bundleQuantity));
  });

  return {
    bundleQuantity: Math.max(1, bundleQuantity),
    units,
  };
};

const applyDealBundleDelta = (state: CartState, dealId: string, direction: 1 | -1) => {
  const normalizedDealId = String(dealId || '').trim();
  if (!normalizedDealId) return;

  const dealItems = state.items.filter((entry) => entry.isDeal && String(entry.dealId || '').trim() === normalizedDealId);
  if (dealItems.length === 0) return;

  const { bundleQuantity, units } = getDealUnitMap(dealItems);
  if (direction < 0 && bundleQuantity <= 1) return;

  state.items.forEach((entry) => {
    if (!entry.isDeal || String(entry.dealId || '').trim() !== normalizedDealId) {
      return;
    }

    const key = getCartItemKey(entry);
    const step = units.get(key) || 1;
    const nextQuantity = safeQuantity(entry.quantity) + direction * step;
    entry.quantity = Math.max(step, nextQuantity);
  });
};

const setDealBundleQuantity = (state: CartState, dealId: string, targetBundleQuantity: number) => {
  const normalizedDealId = String(dealId || '').trim();
  if (!normalizedDealId) return;

  const dealItems = state.items.filter((entry) => entry.isDeal && String(entry.dealId || '').trim() === normalizedDealId);
  if (dealItems.length === 0) return;

  const nextBundleQuantity = Math.max(1, safeQuantity(targetBundleQuantity));
  const { units } = getDealUnitMap(dealItems);

  state.items.forEach((entry) => {
    if (!entry.isDeal || String(entry.dealId || '').trim() !== normalizedDealId) {
      return;
    }

    const key = getCartItemKey(entry);
    const unit = units.get(key) || 1;
    entry.quantity = unit * nextBundleQuantity;
  });
};

const initialState: CartState = {
  items: [],
  editingOrderId: null,
  editingOrderType: null,
  editingTableNumber: null,
  editingDeliveryAddress: null,
  editingRestaurantId: null,
  editingDeliveryLatitude: null,
  editingDeliveryLongitude: null,
  editingDeliveryAddressId: null,
};

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addToCart: (state, action: PayloadAction<CartItem>) => {
      const incomingKey = getCartItemKey(action.payload);
      const existing = state.items.find(item => getCartItemKey(item) === incomingKey);
      if (existing) {
        existing.quantity += action.payload.quantity;
      } else {
        state.items.push(action.payload);
      }
    },
    removeFromCart: (state, action: PayloadAction<string>) => {
      const target = state.items.find((item) => getCartItemKey(item) === action.payload);
      if (target?.isDeal && String(target.dealId || '').trim()) {
        const targetDealId = String(target.dealId || '').trim();
        state.items = state.items.filter((item) => !(item.isDeal && String(item.dealId || '').trim() === targetDealId));
        return;
      }

      state.items = state.items.filter(item => getCartItemKey(item) !== action.payload);
    },
    updateQuantity: (state, action: PayloadAction<{ id: string; quantity: number }>) => {
      const item = state.items.find(item => getCartItemKey(item) === action.payload.id);
      if (item) {
        if (item.isDeal && String(item.dealId || '').trim()) {
          setDealBundleQuantity(state, String(item.dealId || '').trim(), action.payload.quantity);
          return;
        }

        item.quantity = Math.max(1, action.payload.quantity);
      }
    },
    incrementQuantity: (state, action: PayloadAction<string>) => {
      const item = state.items.find(item => getCartItemKey(item) === action.payload);
      if (item) {
        if (item.isDeal && String(item.dealId || '').trim()) {
          applyDealBundleDelta(state, String(item.dealId || '').trim(), 1);
          return;
        }

        item.quantity += 1;
      }
    },
    decrementQuantity: (state, action: PayloadAction<string>) => {
      const item = state.items.find(item => getCartItemKey(item) === action.payload);
      if (!item) return;
      const dealId = item.isDeal ? String(item.dealId || '').trim() : '';
      if (dealId) {
        // The last bundle of a combo goes out whole — every row of the deal together.
        const dealItems = state.items.filter((entry) => entry.isDeal && String(entry.dealId || '').trim() === dealId);
        if (getDealUnitMap(dealItems).bundleQuantity <= 1) {
          state.items = state.items.filter((entry) => !(entry.isDeal && String(entry.dealId || '').trim() === dealId));
          return;
        }
        applyDealBundleDelta(state, dealId, -1);
        return;
      }

      // Minus at 1 takes the item out of the cart, as every menu/details stepper expects.
      if (item.quantity <= 1) {
        state.items = state.items.filter((entry) => getCartItemKey(entry) !== action.payload);
        return;
      }
      item.quantity -= 1;
    },
    clearCart: state => {
      state.items = [];
      state.editingOrderId = null;
      state.editingOrderType = null;
      state.editingTableNumber = null;
      state.editingDeliveryAddress = null;
      state.editingRestaurantId = null;
      state.editingDeliveryLatitude = null;
      state.editingDeliveryLongitude = null;
      state.editingDeliveryAddressId = null;
    },
    setCartItems: (state, action: PayloadAction<CartItem[]>) => {
      state.items = action.payload;
    },
    setEditingOrderMeta: (state, action: PayloadAction<{
      orderId: string | null;
      orderType?: string | null;
      tableNumber?: string | null;
      deliveryAddress?: string | null;
      restaurantId?: string | null;
      deliveryLatitude?: string | null;
      deliveryLongitude?: string | null;
      deliveryAddressId?: string | null;
    }>) => {
      state.editingOrderId = action.payload.orderId;
      state.editingOrderType = action.payload.orderType ?? null;
      state.editingTableNumber = action.payload.tableNumber ?? null;
      state.editingDeliveryAddress = action.payload.deliveryAddress ?? null;
      state.editingRestaurantId = action.payload.restaurantId ?? null;
      state.editingDeliveryLatitude = action.payload.deliveryLatitude ?? null;
      state.editingDeliveryLongitude = action.payload.deliveryLongitude ?? null;
      state.editingDeliveryAddressId = action.payload.deliveryAddressId ?? null;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(logout, (state) => {
      state.items = [];
    });
  },
});

export const { addToCart, removeFromCart, updateQuantity, incrementQuantity, decrementQuantity, clearCart, setCartItems, setEditingOrderMeta } = cartSlice.actions;
export default cartSlice.reducer;
