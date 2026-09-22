import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface LoaderState {
  visible: boolean;
  message?: string;
}

const initialState: LoaderState = {
  visible: false,
  message: undefined,
};

const loaderSlice = createSlice({
  name: 'loader',
  initialState,
  reducers: {
    showLoader(state, action: PayloadAction<string | undefined>) {
      state.visible = true;
      state.message = action.payload;
    },
    hideLoader(state) {
      state.visible = false;
      state.message = undefined;
    },
  },
});

export const { showLoader, hideLoader } = loaderSlice.actions;
export default loaderSlice.reducer;
