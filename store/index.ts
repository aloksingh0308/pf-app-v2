// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import addonsReducer from './slices/addonsSlice';
import authReducer from './slices/authSlice';
import cartReducer from './slices/cartSlice';
import loaderReducer from './slices/loaderSlice';
import locationReducer from './slices/locationSlice';

export const store = configureStore({
  reducer: {
    cart: cartReducer,
    auth: authReducer,
    addons: addonsReducer,
    location: locationReducer,
    loader: loaderReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Firestore Timestamps in auth.user fields — converted at source but guard here too
        ignoredPaths: ['auth.user.updatedAt', 'auth.user.createdAt'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
