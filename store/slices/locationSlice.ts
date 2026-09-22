import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createSelector } from 'reselect';
import { RootState } from '../index';

export interface LocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
  timestamp?: number | null;
  addressLine?: string | null;
  addressResolvedAt?: number | null;
}

const initialState: LocationState = {
  latitude: null,
  longitude: null,
  accuracy: null,
  timestamp: null,
  addressLine: null,
  addressResolvedAt: null,
};

const locationSlice = createSlice({
  name: 'location',
  initialState,
  reducers: {
    setLocation: (state, action: PayloadAction<LocationState>) => {
      state.latitude = action.payload.latitude;
      state.longitude = action.payload.longitude;
      state.accuracy = action.payload.accuracy ?? null;
      state.timestamp = action.payload.timestamp ?? null;
      if ('addressLine' in action.payload) {
        state.addressLine = action.payload.addressLine ?? null;
      }
      if ('addressResolvedAt' in action.payload) {
        state.addressResolvedAt = action.payload.addressResolvedAt ?? null;
      }
    },
    setLocationAddress: (state, action: PayloadAction<{ addressLine: string | null; addressResolvedAt?: number | null }>) => {
      state.addressLine = action.payload.addressLine ?? null;
      state.addressResolvedAt = action.payload.addressResolvedAt ?? Date.now();
    },
    clearLocation: (state) => {
      state.latitude = null;
      state.longitude = null;
      state.accuracy = null;
      state.timestamp = null;
      state.addressLine = null;
      state.addressResolvedAt = null;
    },
  },
});

export const { setLocation, setLocationAddress, clearLocation } = locationSlice.actions;

export default locationSlice.reducer;

// Selector for userCoords
export const selectUserCoords = createSelector(
  (state: RootState) => state.location.latitude,
  (state: RootState) => state.location.longitude,
  (state: RootState) => state.location.accuracy,
  (state: RootState) => state.location.timestamp,
  (latitude, longitude, accuracy, timestamp) => {
    if (latitude != null && longitude != null) {
      return { latitude, longitude, accuracy, timestamp };
    }
    return null;
  }
);