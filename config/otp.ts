import { DATABASE_MODE } from './database';

/**
 * Which service sends/verifies the login OTP — the BUILD-TIME FALLBACK only. The app asks the
 * server which provider is active (services/otp/index.ts resolveOtpProvider; Super Admin
 * switches it), and uses this only when the server can't be reached.
 *
 *   msg91   — MSG91 OTP Widget (services/otp/msg91Provider.ts). Needs the widget ID and
 *             widget token below — both are meant to live in the app. The MSG91 AUTHKEY
 *             is NOT here and must never be: the backend verifies MSG91's access token
 *             with it (POST /api/auth/msg91/verify).
 *   backend — the backend's own OTP endpoints (services/otp/backendProvider.ts).
 *   firebase — Firebase Phone Auth (services/otp/firebaseProvider.ts).
 *
 * TEST mode uses the backend fixed OTP flow. In LIVE mode,
 * EXPO_PUBLIC_OTP_PROVIDER forces one; otherwise MSG91 is used as soon as both widget
 * values are set, and the backend flow otherwise — so a build without MSG91 credentials
 * keeps logging in exactly as before.
 */
const widgetId = String(process.env.EXPO_PUBLIC_MSG91_WIDGET_ID || '').trim();
const tokenAuth = String(process.env.EXPO_PUBLIC_MSG91_TOKEN_AUTH || '').trim();
const forced = String(process.env.EXPO_PUBLIC_OTP_PROVIDER || '').trim().toLowerCase();

export type OtpProviderName = 'msg91' | 'backend' | 'firebase';

export const OTP_CONFIG = {
  provider: (DATABASE_MODE === 'TEST' ? 'backend' : forced === 'msg91' || forced === 'backend' || forced === 'firebase' ? forced : widgetId && tokenAuth ? 'msg91' : 'backend') as OtpProviderName,
  msg91: { widgetId, tokenAuth },
  /** Digits in the OTP — must match the MSG91 widget's "OTP length" setting. */
  otpLength: Math.min(9, Math.max(4, Number(process.env.EXPO_PUBLIC_OTP_LENGTH || 6) || 6)),
};
