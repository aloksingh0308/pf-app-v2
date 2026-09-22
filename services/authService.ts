import { apiClient, tokenStorage } from '../utils/apiClient';

/**
 * Replaces Firebase Auth with the restaurant-saas-platform's customer-app auth
 * (backend/src/services/customerAuth.service.ts) — same phone+OTP flow the original app
 * used, now backed by a real Node API + JWT instead of Firebase. The account itself is
 * platform-wide (backend/src/models/CustomerAccount.ts), not scoped to any one
 * organization, matching the original app's single-Firebase-project identity — the same
 * login works across every restaurant in the app's directory. The exported function
 * *signatures* are kept identical to the original Firebase-backed version (including
 * `sendPhoneOtp`/`verifyPhoneOtp`'s confirmation-object shape) so call sites like
 * app/login.tsx and app/_layout.tsx didn't need to change.
 *
 * Phone+OTP is the ONLY login path — email+password login/signup/reset has been removed
 * entirely (app/signup.tsx is gone, app/login.tsx has no email tab), not just stubbed.
 */

export interface AppAuthUser {
  uid: string;
  phoneNumber: string | null;
  email: string | null;
}

interface OtpVerifyResponse {
  token: string;
  customer: { _id: string; name: string; phone: string; email?: string | null; walletBalance: number; loyaltyPoints: number };
}

interface OtpConfirmationResult {
  confirm: (code: string) => Promise<{ user: AppAuthUser }>;
}

function normalizePhoneToE164(phone: string): string {
  const trimmed = String(phone || '').trim();
  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return `+${digits}`;
}

let currentUser: AppAuthUser | null = null;
const listeners = new Set<(user: AppAuthUser | null) => void>();

function setCurrentUser(user: AppAuthUser | null) {
  currentUser = user;
  listeners.forEach((cb) => cb(currentUser));
}

export const authService = {
  sendPhoneOtp: async (phoneNumber: string): Promise<OtpConfirmationResult> => {
    const e164Phone = normalizePhoneToE164(phoneNumber);
    await apiClient.post('/public/customers/otp/send', { phone: e164Phone });

    return {
      confirm: async (code: string) => {
        const result = await apiClient.post<OtpVerifyResponse>('/public/customers/otp/verify', { phone: e164Phone, code });
        await tokenStorage.save(result.token);
        const user: AppAuthUser = {
          uid: result.customer._id,
          phoneNumber: result.customer.phone,
          email: result.customer.email || null,
        };
        setCurrentUser(user);
        return { user };
      },
    };
  },

  verifyPhoneOtp: (confirmation: OtpConfirmationResult, code: string) => confirmation.confirm(code),

  logoutUser: async (): Promise<void> => {
    await tokenStorage.clear();
    setCurrentUser(null);
  },

  /** Fires once with the current session (restored from the stored token, if any) and on
   *  every login/logout thereafter — same external shape as the original Firebase
   *  `onAuthStateChanged` wrapper, just backed by our own token instead. */
  onAuthStateChange: (callback: (user: AppAuthUser | null) => void): (() => void) => {
    listeners.add(callback);

    (async () => {
      if (!currentUser) {
        const token = await tokenStorage.get();
        if (token) {
          try {
            const me = await apiClient.get<OtpVerifyResponse['customer']>('/public/customers/me');
            currentUser = { uid: me._id, phoneNumber: me.phone, email: me.email || null };
          } catch {
            await tokenStorage.clear();
          }
        }
      }
      callback(currentUser);
    })();

    return () => listeners.delete(callback);
  },

  getCurrentUser: (): AppAuthUser | null => currentUser,

  normalizePhoneToE164,
};
