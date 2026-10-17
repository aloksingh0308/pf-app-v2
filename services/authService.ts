import { apiClient, tokenStorage } from '../utils/apiClient';
import { CustomerLoginResponse, resolveOtpProvider } from './otp';

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
 *
 * Who sends/checks the OTP is pluggable (services/otp — MSG91 OTP Widget, or the backend's
 * own endpoints); this file only turns the resulting login into a stored session.
 */

export interface AppAuthUser {
  uid: string;
  phoneNumber: string | null;
  email: string | null;
}

type OtpVerifyResponse = CustomerLoginResponse;

export interface OtpConfirmationResult {
  /** Digits the customer has to enter. */
  otpLength: number;
  confirm: (code: string) => Promise<{ user: AppAuthUser }>;
  resend: () => Promise<void>;
}

/** What sending an OTP led to: normally an OTP to enter; sometimes (MSG91 invisible
 *  verification) the number is already verified and the customer is logged in. */
export type SendOtpResult = { status: 'otp-sent'; confirmation: OtpConfirmationResult } | { status: 'logged-in'; user: AppAuthUser };

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

/** Stores our JWT and publishes the logged-in user — the end of every login path. */
async function startSession(result: OtpVerifyResponse): Promise<AppAuthUser> {
  await tokenStorage.save(result.token);
  const user: AppAuthUser = {
    uid: result.customer._id,
    phoneNumber: result.customer.phone,
    email: result.customer.email || null,
  };
  setCurrentUser(user);
  return user;
}

export const authService = {
  sendPhoneOtp: async (phoneNumber: string): Promise<SendOtpResult> => {
    const started = await (await resolveOtpProvider()).start(normalizePhoneToE164(phoneNumber));
    if (started.kind === 'verified') {
      return { status: 'logged-in', user: await startSession(started.login) };
    }
    const { session } = started;
    return {
      status: 'otp-sent',
      confirmation: {
        otpLength: session.otpLength,
        confirm: async (code: string) => ({ user: await startSession(await session.verify(code)) }),
        resend: session.resend,
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
