import { apiClient } from '../../utils/apiClient';
import { solveProofOfWork } from '../../utils/proofOfWork';
import { OTP_CONFIG } from '../../config/otp';
import { CustomerLoginResponse, OtpProvider } from './types';

/** The backend's own OTP endpoints (bot-check puzzle → send → verify). Used until MSG91 is
 *  configured, and by store-review test numbers. */
async function send(phoneE164: string) {
  // Bot check: the backend only sends an OTP for a solved, single-use puzzle
  // (otpGuard.service.ts) — solving takes a fraction of a second on a phone.
  const { challenge, salt, difficulty } = await apiClient.post<{ challenge: string; salt: string; difficulty: number }>(
    '/public/customers/otp/challenge',
    { phone: phoneE164 }
  );
  const nonce = await solveProofOfWork(salt, difficulty);
  const res = await apiClient.postIdempotent<{ devOtp?: string }>('/public/customers/otp/send', { phone: phoneE164, challenge, nonce });
  if (__DEV__) console.log('[otp:backend] send response', JSON.stringify(res ?? null), '— no SMS is sent by this provider');
}

export const backendOtpProvider: OtpProvider = {
  name: 'backend',
  async start(phoneE164) {
    await send(phoneE164);
    return {
      kind: 'otp-sent',
      session: {
        otpLength: OTP_CONFIG.otpLength,
        verify: async (code) => {
          const login = await apiClient.postIdempotent<CustomerLoginResponse>('/public/customers/otp/verify', { phone: phoneE164, code });
          if (__DEV__) console.log('[otp:backend] verify response', JSON.stringify({ customerId: login.customer._id, phone: login.customer.phone, hasToken: Boolean(login.token) }));
          return login;
        },
        resend: () => send(phoneE164),
      },
    };
  },
};
