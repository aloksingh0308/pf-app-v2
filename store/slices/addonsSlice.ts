import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface AddonCartItem {
  id: string;
  name: string;
  imageUrl: string;
  price: number;
  quantity: number;
}

interface AddonsState {
  items: Record<string, AddonCartItem>;
}

const initialState: AddonsState = {
  items: {},
};

const addonsSlice = createSlice({
  name: 'addons',
  initialState,
  reducers: {
    addAddon(state, action: PayloadAction<AddonCartItem>) {
      const { id } = action.payload;
      if (state.items[id]) {
        state.items[id].quantity += 1;
      } else {
        state.items[id] = { ...action.payload, quantity: 1 };
      }
    },
    incrementAddon(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.items[id]) {
        state.items[id].quantity += 1;
      }
    },
    decrementAddon(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.items[id]) {
        state.items[id].quantity -= 1;
        if (state.items[id].quantity <= 0) {
          delete state.items[id];
        }
      }
    },
    removeAddon(state, action: PayloadAction<string>) {
      delete state.items[action.payload];
    },
    clearAddons(state) {
      state.items = {};
    },
  },
});

export const { addAddon, incrementAddon, decrementAddon, removeAddon, clearAddons } = addonsSlice.actions;
export default addonsSlice.reducer;
