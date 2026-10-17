/**
 * Type-checking stand-in for @msg91comm/sendotp-react-native, which ships raw TypeScript
 * source that doesn't pass this app's strict compile. tsconfig "paths" points tsc here;
 * Metro still bundles the real package. Covers only the headless API we use
 * (services/otp/msg91Provider.ts) — mirror any new calls from the package's index.ts.
 */
type Msg91Reply = { type?: 'success' | 'error' | string; message?: unknown; code?: unknown; 'access-token'?: string; invisibleVerified?: boolean };

export declare class OTPWidget {
  static initializeWidget(widgetId: string, tokenAuth: string): Promise<void>;
  /** identifier: mobile with country code, no "+" (e.g. 919876543210) — or an email. */
  static sendOTP(body: { identifier: string; reqId?: string }): Promise<Msg91Reply | undefined>;
  static verifyOTP(body: { reqId: string; otp: string }): Promise<Msg91Reply | undefined>;
  /** retryChannel: 11 SMS, 4 voice, 3 email, 12 WhatsApp — omit for the widget's default. */
  static retryOTP(body: { reqId: string; retryChannel?: number }): Promise<Msg91Reply | undefined>;
  static getWidgetProcess(): Promise<unknown>;
}
