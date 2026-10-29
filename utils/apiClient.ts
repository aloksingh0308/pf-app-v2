import { connectivity, isNetworkFailure } from '../services/connectivity';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../config/api';
import { analyticsService } from '../services/analytics';

const AUTH_TOKEN_KEY = 'app_auth_token';

export const tokenStorage = {
  save: (token: string) => AsyncStorage.setItem(AUTH_TOKEN_KEY, token),
  get: () => AsyncStorage.getItem(AUTH_TOKEN_KEY),
  clear: () => AsyncStorage.removeItem(AUTH_TOKEN_KEY),
};

/** ApiError.code for "the request never reached the server". */
export const NETWORK_ERROR_CODE = 'NETWORK_UNREACHABLE';
export const RATE_LIMITED_CODE = 'RATE_LIMITED';
const RATE_LIMITED_MESSAGE = 'Too many requests right now. Please wait a moment and try again.';

// After a 429 the server won't accept more for a while — every GET (all the background
// polling) waits that out here instead of hitting the server again and extending the
// lockout. Writes (placing an order, etc.) still go through: the user asked for those.
let rateLimitedUntil = 0;

/** True for a 429 — callers polling in the background can stay quiet about these. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

/** Milliseconds left in the current rate-limit cooldown (0 when there is none). */
export function rateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}

function startRateLimitCooldown(res: Response, bodySeconds?: number) {
  const header = Number(res.headers.get('retry-after') || res.headers.get('ratelimit-reset'));
  const seconds = bodySeconds || (Number.isFinite(header) && header > 0 ? header : 60);
  // Capped so a bad header can't silence the app for the whole 15-minute window.
  rateLimitedUntil = Date.now() + Math.min(seconds, 120) * 1000;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  /** Set on 429 RATE_LIMITED replies — how long before retrying makes sense. */
  retryAfterSeconds?: number;
  constructor(status: number, message: string, code?: string, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}
interface ApiFailure {
  success: false;
  message: string;
  code?: string;
  errors?: string[];
  retryAfterSeconds?: number;
}

/**
 * Thin fetch wrapper for the restaurant-saas-platform backend that replaces Firebase for
 * this app. Every path is relative to API_CONFIG.baseUrl (already includes `/api`) —
 * public/customer-facing endpoints live under `/public/...`. Attaches the customer JWT
 * (see auth/customerJwt.ts on the backend) automatically when one is stored.
 */
async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, isFormData = false): Promise<T> {
  if (method === 'GET' && rateLimitRemainingMs() > 0) {
    throw new ApiError(429, RATE_LIMITED_MESSAGE, RATE_LIMITED_CODE, Math.ceil(rateLimitRemainingMs() / 1000));
  }
  const token = await tokenStorage.get();
  let res: Response;
  try {
    res = await fetch(`${API_CONFIG.baseUrl}${path}`, {
      method,
      headers: {
        // A FormData body must NOT set Content-Type itself — fetch/RN sets the multipart
        // boundary automatically, which an explicit `application/json` header would break.
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    // Couldn't connect at all (no internet / server down) — ConnectivityGate shows the
    // fallback screen, so callers can skip their own error popups for this case.
    if (isNetworkFailure(error)) {
      connectivity.reportServer(false);
      analyticsService.networkError(method, path);
      throw new ApiError(0, 'Network request failed', NETWORK_ERROR_CODE);
    }
    throw error;
  }
  connectivity.reportServer(true);

  const text = await res.text().catch(() => '');
  let json: ApiSuccess<T> | ApiFailure | null = null;
  try {
    json = text ? (JSON.parse(text) as ApiSuccess<T> | ApiFailure) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.success === false) {
    const failure = json as ApiFailure | null;
    analyticsService.apiError(method, path, res.status, failure?.code, failure?.message || (failure ? undefined : `unreadable reply: ${text.slice(0, 60)}`));
    if (res.status === 429) {
      startRateLimitCooldown(res, failure?.retryAfterSeconds);
      if (__DEV__) console.warn(`[api] ${method} ${path} → 429; pausing background requests for ${Math.ceil(rateLimitRemainingMs() / 1000)}s`);
      throw new ApiError(429, failure?.message || RATE_LIMITED_MESSAGE, RATE_LIMITED_CODE, Math.ceil(rateLimitRemainingMs() / 1000));
    }
    if (__DEV__ && !failure?.message) {
      // A reply we couldn't read (HTML error page, proxy error, empty body) — log what it was.
      console.warn(`[api] ${method} ${path} → HTTP ${res.status}, unreadable reply:`, text.slice(0, 300));
    }
    // 502/503/504 without our JSON = the proxy answering while the backend restarts or is
    // down — say that instead of a vague error.
    const fallback = res.status >= 502 && res.status <= 504 ? 'The server is restarting or busy. Please try again in a moment.' : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, failure?.message || fallback, failure?.code, failure?.retryAfterSeconds);
  }
  return (json as ApiSuccess<T>).data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  postForm: <T>(path: string, formData: FormData) => request<T>('POST', path, formData, true),

  /** Uploads a local image (picked via expo-image-picker, so a `file://` URI) to the
   *  customer-app's own image endpoint — replaces every Firebase Storage
   *  `uploadBytes`/`getDownloadURL` call in this app (review photos, profile photos, etc.)
   *  with one shared helper. Returns the hosted URL. A URL already looking like an http(s)
   *  link (i.e. not a fresh local pick) is returned unchanged rather than re-uploaded. */
  async uploadImage(localUriOrUrl: string, filenamePrefix: string): Promise<string> {
    if (localUriOrUrl.startsWith('http://') || localUriOrUrl.startsWith('https://')) {
      return localUriOrUrl;
    }
    // React Native sends a local file as a { uri, name, type } part — reading it into a Blob
    // first (fetch(uri).blob()) isn't reliable on Android and broke profile photo uploads.
    const rawExtension = (localUriOrUrl.split('.').pop()?.split('?')[0] || '').toLowerCase();
    const extension = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(rawExtension) ? rawExtension : 'jpg';
    const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    const formData = new FormData();
    // Picks the storage folder: users/<account>/profile | reviews (backend storage/uploadPaths.ts).
    const purpose = filenamePrefix === 'profile' ? 'profile' : filenamePrefix === 'review' ? 'reviews' : 'general';
    formData.append('purpose', purpose);
    formData.append('file', { uri: localUriOrUrl, name: `${filenamePrefix}-${Date.now()}.${extension}`, type: mimeType } as unknown as Blob);
    const result = await request<{ url: string }>('POST', '/public/customers/uploads/image', formData, true);
    return result.url;
  },
};
