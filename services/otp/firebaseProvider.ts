import { getAuth, onAuthStateChanged, signInWithPhoneNumber, signOut, type FirebaseAuthTypes } from '@react-native-firebase/auth';

type ConfirmationResult = FirebaseAuthTypes.ConfirmationResult;
type User = FirebaseAuthTypes.User;
import { apiClient } from '../../utils/apiClient';
import { OTP_CONFIG } from '../../config/otp';
import { CustomerLoginResponse, OtpError, OtpProvider } from './types';

/**
 * Firebase Phone Auth (native @react-native-firebase/auth — Play Integrity instead of a
 * reCAPTCHA screen, and on many Android phones the SMS is read automatically). Google sends
 * the SMS, so no DLT registration is needed. Once Firebase has verified the number we take
 * its ID token to POST /api/auth/firebase/verify, where our backend checks the token itself
 * and returns OUR customer session — the Firebase session is signed out right after.
 */

const ERRORS: Record<string, string> = {
  'auth/invalid-phone-number': 'Please enter a valid mobile number.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/quota-exceeded': 'OTP limit reached for now. Please try again later.',
  'auth/invalid-verification-code': 'Incorrect OTP. Please check and try again.',
  'auth/session-expired': 'This OTP has expired. Tap “Resend OTP” to get a new one.',
  'auth/code-expired': 'This OTP has expired. Tap “Resend OTP” to get a new one.',
  'auth/network-request-failed': 'Network problem. Check your internet connection and try again.',
  'auth/app-not-authorized': 'This app build isn’t allowed to send OTPs yet. Please update the app.',
};

function toOtpError(error: unknown, fallback: string): OtpError {
  const code = (error as { code?: string })?.code || '';
  if (__DEV__) console.log('[otp:firebase] error', code, (error as Error)?.message);
  return new OtpError(ERRORS[code] || fallback);
}

/** Our backend verifies the Firebase ID token and logs the customer in. */
async function exchange(user: User): Promise<CustomerLoginResponse> {
  const idToken = await user.getIdToken(true);
  try {
    return await apiClient.post<CustomerLoginResponse>('/auth/firebase/verify', { idToken });
  } finally {
    // Our own JWT is the session from here on.
    await signOut(getAuth()).catch(() => undefined);
  }
}

export const firebaseOtpProvider: OtpProvider = {
  name: 'firebase',

  async start(phoneE164) {
    const auth = getAuth();
    // A leftover Firebase session for another number must never be reused.
    if (auth.currentUser && auth.currentUser.phoneNumber !== phoneE164) await signOut(auth).catch(() => undefined);

    let confirmation: ConfirmationResult;
    try {
      confirmation = await signInWithPhoneNumber(auth, phoneE164);
    } catch (error) {
      throw toOtpError(error, "Couldn't send the OTP. Please try again.");
    }

    // Android may verify the number on its own (SMS read automatically); remember it so
    // "Verify" works even if the customer never types the code.
    let autoVerifiedUser: User | null = auth.currentUser?.phoneNumber === phoneE164 ? auth.currentUser : null;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user?.phoneNumber === phoneE164) autoVerifiedUser = user;
    });

    return {
      kind: 'otp-sent',
      session: {
        otpLength: OTP_CONFIG.otpLength,

        async verify(code) {
          try {
            if (autoVerifiedUser) return await exchange(autoVerifiedUser);
            const credential = await confirmation.confirm(code);
            if (!credential?.user) throw new OtpError("Couldn't verify the OTP. Please try again.");
            return await exchange(credential.user);
          } catch (error) {
            if (error instanceof OtpError || (error as { status?: number })?.status) throw error;
            throw toOtpError(error, 'Incorrect OTP. Please try again.');
          } finally {
            unsubscribe();
          }
        },

        async resend() {
          try {
            // Asking again sends a fresh code (Firebase applies its own resend limits).
            confirmation = await signInWithPhoneNumber(auth, phoneE164);
          } catch (error) {
            throw toOtpError(error, "Couldn't resend the OTP. Please try again.");
          }
        },
      },
    };
  },
};
