import { OTP_CONFIG, type OtpProviderName } from '../../config/otp';
import { API_CONFIG } from '../../config/api';
import { backendOtpProvider } from './backendProvider';
import { firebaseOtpProvider } from './firebaseProvider';
import { msg91OtpProvider } from './msg91Provider';
import { OtpProvider } from './types';

/**
 * Which OTP provider to use is decided by the SERVER (Super Admin → App Settings → Customer
 * login, read from GET /public/customers/otp/config), so the platform can move from
 * Firebase to MSG91 once DLT is approved without a new app release. If the server can't be
 * reached, the build-time default from config/otp.ts is used.
 */
const PROVIDERS: Record<OtpProviderName, OtpProvider> = {
  backend: backendOtpProvider,
  msg91: msg91OtpProvider,
  firebase: firebaseOtpProvider,
};

type ServerOtpConfig = { provider: 'legacy' | 'msg91' | 'firebase'; otpLength?: number; msg91?: { widgetId: string; tokenAuth: string } };

const CACHE_MS = 60_000;
let cached: { provider: OtpProviderName; at: number } | null = null;

async function fetchServerConfig(): Promise<ServerOtpConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_CONFIG.baseUrl}/public/customers/otp/config`, { signal: controller.signal });
    const json = await res.json();
    return res.ok && json?.success ? (json.data as ServerOtpConfig) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The provider to use right now. */
export async function resolveOtpProvider(): Promise<OtpProvider> {
  if (cached && Date.now() - cached.at < CACHE_MS) return PROVIDERS[cached.provider];
  const server = await fetchServerConfig();
  let provider: OtpProviderName = OTP_CONFIG.provider;
  if (server) {
    provider = server.provider === 'legacy' ? 'backend' : server.provider;
    if (server.provider === 'msg91' && server.msg91?.widgetId && server.msg91?.tokenAuth) {
      // The server's widget credentials win over the ones baked into this build.
      OTP_CONFIG.msg91.widgetId = server.msg91.widgetId;
      OTP_CONFIG.msg91.tokenAuth = server.msg91.tokenAuth;
    }
  }
  cached = { provider, at: Date.now() };
  if (__DEV__) console.log(`[otp] provider=${provider} (${server ? 'from server' : 'build default — server config unavailable'})`);
  return PROVIDERS[provider];
}

/** Build-time default only — kept for callers that can't wait for the server. */
export function getOtpProvider(): OtpProvider {
  return PROVIDERS[OTP_CONFIG.provider];
}

export * from './types';
