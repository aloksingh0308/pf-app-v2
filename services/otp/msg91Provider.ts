import { OTPWidget } from '@msg91comm/sendotp-react-native';
import { apiClient } from '../../utils/apiClient';
import { OTP_CONFIG } from '../../config/otp';
import { CustomerLoginResponse, OtpError, OtpProvider } from './types';

/**
 * MSG91 OTP Widget (headless SDK — our own login screen is the UI). The app talks to MSG91
 * with the widget ID + widget token only; once MSG91 accepts the OTP it hands back an
 * access token, which we exchange at POST /api/auth/msg91/verify. The backend verifies that
 * token with MSG91 using the AUTHKEY (server-only), works out the verified number from
 * MSG91's answer, and returns our own JWT. No OTP is generated or checked by us.
 *
 * SDK responses: { type: 'success' | 'error', message, ... } — `message` is the reqId after
 * send/resend, the access token after verify, and the reason on error.
 */
type Msg91Response = { type?: string; message?: unknown; code?: unknown; 'access-token'?: string; invisibleVerified?: boolean } | undefined;

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  const { widgetId, tokenAuth } = OTP_CONFIG.msg91;
  if (!widgetId || !tokenAuth) throw new OtpError('Phone login is not configured in this build.');
  OTPWidget.initializeWidget(widgetId, tokenAuth);
  initialized = true;
}

const isSuccess = (res: Msg91Response) => res?.type === 'success';

/** Dev builds only: the raw MSG91 reply, with any access token shortened. */
function debugLog(step: string, payload: unknown) {
  if (!__DEV__) return;
  const safe = JSON.parse(JSON.stringify(payload ?? null), (key, value) =>
    key === 'access-token' && typeof value === 'string' ? `${value.slice(0, 12)}…(${value.length} chars)` : value
  );
  console.log(`[otp:msg91] ${step}`, JSON.stringify(safe));
}

/** MSG91's own wording is usually fine to show; a few common cases get friendlier text. */
function failure(res: Msg91Response, fallback: string): OtpError {
  const raw = typeof res?.message === 'string' ? res.message.trim() : '';
  if (/invalid otp|otp.*(not match|incorrect|wrong)/i.test(raw)) return new OtpError('Incorrect OTP. Please check and try again.');
  if (/expire/i.test(raw)) return new OtpError('This OTP has expired. Tap “Resend OTP” to get a new one.');
  if (/limit|too many|max/i.test(raw)) return new OtpError('Too many attempts. Please wait a few minutes and try again.');
  if (/mobile|number|identifier/i.test(raw) && /invalid/i.test(raw)) return new OtpError('Please enter a valid mobile number.');
  return new OtpError(raw || fallback);
}

/** Network/SDK exceptions (not MSG91 "error" replies). */
async function call<T extends Msg91Response>(fn: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new OtpError(`${fallback} Check your internet connection and try again.`);
  }
}

/** The SDK wants the number with country code and no "+", e.g. 919876543210. */
const identifierFor = (phoneE164: string) => phoneE164.replace(/\D/g, '');

async function exchange(accessToken: string) {
  try {
    const login = await apiClient.post<CustomerLoginResponse>('/auth/msg91/verify', { accessToken });
    debugLog('backend /auth/msg91/verify response', { customerId: login.customer._id, phone: login.customer.phone, hasToken: Boolean(login.token) });
    return login;
  } catch (error) {
    debugLog('backend /auth/msg91/verify error', { status: (error as { status?: number }).status, message: (error as Error).message });
    throw error;
  }
}

export const msg91OtpProvider: OtpProvider = {
  name: 'msg91',

  async start(phoneE164) {
    ensureInitialized();
    debugLog('sendOTP request', { identifier: identifierFor(phoneE164), widgetId: OTP_CONFIG.msg91.widgetId });
    const sent = await call(() => OTPWidget.sendOTP({ identifier: identifierFor(phoneE164) }) as Promise<Msg91Response>, "Couldn't send the OTP.");
    debugLog('sendOTP response', sent);
    if (!isSuccess(sent)) throw failure(sent, "Couldn't send the OTP. Please try again.");

    // Invisible verification (mobile data, if enabled on the widget): already verified.
    const directToken = sent?.['access-token'];
    if (sent?.invisibleVerified === true && directToken) {
      return { kind: 'verified', login: await exchange(directToken) };
    }

    let reqId = typeof sent?.message === 'string' ? sent.message : '';
    if (!reqId) throw new OtpError("Couldn't start verification. Please try again.");

    return {
      kind: 'otp-sent',
      session: {
        otpLength: OTP_CONFIG.otpLength,

        async verify(code) {
          debugLog('verifyOTP request', { reqId, otpLength: code.length });
          const res = await call(() => OTPWidget.verifyOTP({ reqId, otp: code }) as Promise<Msg91Response>, "Couldn't verify the OTP.");
          // On success MSG91 puts the access token in `message` — shortened by debugLog.
          debugLog('verifyOTP response', isSuccess(res) && typeof res?.message === 'string' ? { ...res, message: `${res.message.slice(0, 12)}…(${res.message.length} chars)` } : res);
          if (!isSuccess(res)) throw failure(res, 'Incorrect OTP. Please try again.');
          const accessToken = res?.['access-token'] || (typeof res?.message === 'string' ? res.message : '');
          if (!accessToken) throw new OtpError("Couldn't verify the OTP. Please try again.");
          return exchange(accessToken);
        },

        async resend() {
          // No channel → the widget's own configured retry channel (SMS by default).
          debugLog('retryOTP request', { reqId });
          const res = await call(() => OTPWidget.retryOTP({ reqId }) as Promise<Msg91Response>, "Couldn't resend the OTP.");
          debugLog('retryOTP response', res);
          if (!isSuccess(res)) throw failure(res, "Couldn't resend the OTP. Please try again.");
          // MSG91 may issue a new reqId for the retried OTP.
          if (typeof res?.message === 'string' && /^[A-Za-z0-9-]{8,}$/.test(res.message)) reqId = res.message;
        },
      },
    };
  },
};
