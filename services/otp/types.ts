/**
 * The login screen's view of "OTP login", independent of who actually sends and checks the
 * code (MSG91 widget today, the backend's own endpoints, or a DLT/custom SMS setup later).
 * Every provider ends the same way: the backend issues OUR customer JWT + profile.
 */
export interface CustomerLoginResponse {
  token: string;
  customer: { _id: string; name: string; phone: string; email?: string | null; walletBalance: number; loyaltyPoints?: number };
}

export interface OtpSession {
  /** Digits the customer has to type. */
  otpLength: number;
  /** Checks the code and logs in. Throws an Error with a customer-readable message. */
  verify: (code: string) => Promise<CustomerLoginResponse>;
  /** Sends the code again. Throws an Error with a customer-readable message. */
  resend: () => Promise<void>;
}

/** `verified` = the number was confirmed without an OTP (e.g. MSG91 invisible verification). */
export type OtpStartResult = { kind: 'otp-sent'; session: OtpSession } | { kind: 'verified'; login: CustomerLoginResponse };

export interface OtpProvider {
  readonly name: string;
  /** `phoneE164` like +919876543210. */
  start: (phoneE164: string) => Promise<OtpStartResult>;
}

/** An error whose message is safe to show the customer as-is. */
export class OtpError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'OtpError';
  }
}
