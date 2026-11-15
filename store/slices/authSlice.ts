import { createSlice, PayloadAction } from '@reduxjs/toolkit';

// Recursively converts Firestore Timestamp objects to ISO strings so Redux
// doesn't complain about non-serializable values in the store.
function sanitizeTimestamps(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  // Firestore Timestamp: SDK instance has toDate(), plain object has seconds+nanoseconds
  if (typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toISOString();
  }
  if (typeof (value as any).seconds === 'number' && typeof (value as any).nanoseconds === 'number') {
    return new Date((value as any).seconds * 1000).toISOString();
  }
  if (Array.isArray(value)) return value.map(sanitizeTimestamps);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, sanitizeTimestamps(v)])
  );
}

export interface UserProfile {
  earnedCoin?: number;
  uid: string;
  email: string;
  name: string;
  phoneNumber: string;
  profileImage?: string;
  location?: string | null;
  address?: string | null;
  dateOfBirth?: string;
  isMobileVerified?: boolean;
  isProfileComplete?: boolean;
  migratedToUid?: string;
  migratedAt?: string;
  createdAt: string;
  role?: string; // "1" = customer (default), "2" = manager
  isDisabled?: boolean;
  disabledAt?: string;
  disabledReason?: string;
  pushToken?: string;
  pushTokenType?: string;
  pushTokenUpdatedAt?: string;
  walletBalance?: number;
  referralCode?: string;
  referredByUid?: string;
  referredByCode?: string;  
  referralCount?: number;
  totalReferralEarnings?: number;
  referralRewardGranted?: boolean;
  firstSuccessfulOrderId?: string;
  firstSuccessfulOrderAt?: string;
  lastReferralReward?: number;
  lastReferralRewardAt?: string;
  walletLastUpdatedAt?: string;
  specialBonusApplied?: boolean;
  source?: string; // "APP" or "POS"
  totalOrders?: number;
  lastOrderAt?: string | null;
}

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setUser: (state, action: PayloadAction<UserProfile>) => {
      // Home refreshes the profile on a timer — an unchanged profile must keep the same
      // object, or every `state.auth.user` selector re-renders its screen for nothing.
      if (JSON.stringify(state.user) !== JSON.stringify(action.payload)) state.user = action.payload;
      state.isAuthenticated = true;
      state.error = null;
      state.loading = false;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    logout: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.error = null;
      state.loading = false;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
});

export const { setLoading, setUser, setError, logout, clearError } = authSlice.actions;
export default authSlice.reducer;
