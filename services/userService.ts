import { UserProfile } from '../store/slices/authSlice';
import { apiClient, ApiError } from '../utils/apiClient';

/**
 * Replaces Firestore's `customers` collection with the restaurant-saas-platform's
 * platform-wide customer-app account (backend/src/models/CustomerAccount.ts,
 * services/customerAuth.service.ts, services/wallet.service.ts) — one account, one wallet,
 * across every restaurant, not one per organization. `getUserProfile`/`updateUserProfile`,
 * the wallet ledger (`addWalletTransaction`/`listWalletTransactions`), referral linking, and
 * account self-disable are all backed by real endpoints now. Still not implemented:
 * redeeming wallet/coins as an order-time DISCOUNT (checkout.tsx currently deducts the
 * balance client-side, after order placement, rather than the backend pricing the discount
 * itself the way coupons do) — that needs its own order-pricing endpoint, not just an
 * account field, so it's a deliberate follow-up rather than wired up here.
 */

// Kept for the handful of call sites (e.g. app/home.tsx) that still read a raw Firestore
// doc directly and need its Timestamp fields converted to ISO strings — unrelated to the
// customer-app REST migration above, just a plain data-shape utility.
const isPlainObject = (value: unknown): value is Record<string, unknown> => Object.prototype.toString.call(value) === '[object Object]';
const hasTimestampFields = (value: unknown): value is { seconds: number; nanoseconds: number } =>
  isPlainObject(value) && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number';

export const toSerializableData = (value: unknown): any => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as any).toDate === 'function') return (value as any).toDate().toISOString();
  if (hasTimestampFields(value)) return new Date(value.seconds * 1000).toISOString();
  if (Array.isArray(value)) return value.map((item) => toSerializableData(item));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toSerializableData(nested)]));
  return value;
};

interface BackendCustomer {
  _id: string;
  name: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: string | null;
  profileImage?: string | null;
  isDisabled?: boolean;
  disabledAt?: string | null;
  disabledReason?: string | null;
  isMobileVerified?: boolean;
  isProfileComplete?: boolean;
  location?: { latitude: number; longitude: number } | null;
  walletBalance?: number;
  earnedCoin?: number;
  walletLastUpdatedAt?: string | null;
  referralCode?: string;
  referredByCode?: string | null;
  referralCount?: number;
  referralRewardGranted?: boolean;
  totalReferralEarnings?: number;
  totalOrders?: number;
  lastOrderAt?: string | null;
  createdAt?: string;
}

function toUserProfile(customer: BackendCustomer): UserProfile {
  return {
    uid: customer._id,
    name: customer.name,
    email: customer.email || '',
    phoneNumber: customer.phone,
    dateOfBirth: customer.dateOfBirth || undefined,
    profileImage: customer.profileImage || undefined,
    walletBalance: Number(customer.walletBalance || 0),
    earnedCoin: Number(customer.earnedCoin || 0),
    isMobileVerified: customer.isMobileVerified ?? true,
    isProfileComplete: customer.isProfileComplete ?? Boolean(customer.name),
    isDisabled: Boolean(customer.isDisabled),
    referralCode: customer.referralCode,
    referredByCode: customer.referredByCode || undefined,
    referralCount: Number(customer.referralCount || 0),
    referralRewardGranted: Boolean(customer.referralRewardGranted),
    totalReferralEarnings: Number(customer.totalReferralEarnings || 0),
    createdAt: customer.createdAt || new Date().toISOString(),
    role: '1',
    source: 'APP',
  } as UserProfile;
}

export const userService = {
  // The wallet ledger is real now (WalletTransaction, credited by the backend itself on
  // signup bonus / referral reward), but there is deliberately no endpoint that lets the
  // app credit or debit an arbitrary amount — a client-trusted wallet mutation is exactly
  // the kind of thing the rest of this codebase always keeps server-computed (same rule as
  // coupon discounts). Throwing here (rather than silently "succeeding" with no effect) is
  // deliberate: every call site already treats a thrown error as "this optional step didn't
  // happen," which is the truth until checkout gets a real server-priced redemption endpoint.
  addWalletTransaction: async (): Promise<{ transactionId: string; balanceAfter: number }> => {
    throw new Error('Client-initiated wallet transactions are not supported — the wallet is only ever changed server-side.');
  },

  listWalletTransactions: async (): Promise<Array<{
    _id: string;
    type: 'credit' | 'debit';
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>> => apiClient.get('/public/customers/me/wallet-transactions'),

  getUserProfile: async (_uid: string, _email?: string | null): Promise<UserProfile | null> => {
    try {
      const customer = await apiClient.get<BackendCustomer>('/public/customers/me');
      return toUserProfile(customer);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
      throw error;
    }
  },

  updateUserProfile: async (_uid: string, updates: Partial<UserProfile> & { location?: { latitude: number; longitude: number } }): Promise<UserProfile | null> => {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.dateOfBirth !== undefined) payload.dateOfBirth = updates.dateOfBirth;
    if (updates.profileImage !== undefined) payload.profileImage = updates.profileImage;
    if (updates.pushToken !== undefined) payload.pushToken = updates.pushToken;
    if (updates.pushTokenType !== undefined) payload.pushTokenType = updates.pushTokenType;
    if (updates.location !== undefined) payload.location = updates.location;
    if (updates.referredByCode !== undefined) payload.referredByCode = updates.referredByCode;

    // Fields that are read-only / derived on the backend (earnedCoin, walletBalance,
    // totalOrders, referralCode itself, etc. — see CustomerAccount.ts) are silently dropped
    // here rather than sent, since they can only ever be changed by server-side events
    // (signup bonus, referral reward, order placement), never a direct profile edit.
    if (Object.keys(payload).length === 0) return null;

    const customer = await apiClient.patch<BackendCustomer>('/public/customers/me', payload);
    return toUserProfile(customer);
  },

  // The referral reward now fires synchronously, server-side, the moment a referredByCode
  // is submitted (see updateUserProfile above / customerAuthService.applyReferralCode on the
  // backend) — there is nothing left "pending" to reconcile after the fact, so these stay
  // no-ops rather than becoming real polling endpoints.
  processReferralRewardOnSignup: async (_uid?: string): Promise<boolean> => false,
  processReferralRewardForSuccessfulOrder: async (_uid?: string, _orderId?: string): Promise<boolean> => false,
  processPendingReferralRewardsForUser: async (_uid?: string): Promise<number> => 0,

  disableUserAccount: async (_uid: string, reason?: string): Promise<void> => {
    await apiClient.post('/public/customers/me/disable', { reason });
  },
};
