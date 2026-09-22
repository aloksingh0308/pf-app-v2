import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_CONFIG } from '../config/api';

const AUTH_TOKEN_KEY = 'app_auth_token';

export const tokenStorage = {
  save: (token: string) => AsyncStorage.setItem(AUTH_TOKEN_KEY, token),
  get: () => AsyncStorage.getItem(AUTH_TOKEN_KEY),
  clear: () => AsyncStorage.removeItem(AUTH_TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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
}

/**
 * Thin fetch wrapper for the restaurant-saas-platform backend that replaces Firebase for
 * this app. Every path is relative to API_CONFIG.baseUrl (already includes `/api`) —
 * public/customer-facing endpoints live under `/public/...`. Attaches the customer JWT
 * (see auth/customerJwt.ts on the backend) automatically when one is stored.
 */
async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, isFormData = false): Promise<T> {
  const token = await tokenStorage.get();
  const res = await fetch(`${API_CONFIG.baseUrl}${path}`, {
    method,
    headers: {
      // A FormData body must NOT set Content-Type itself — fetch/RN sets the multipart
      // boundary automatically, which an explicit `application/json` header would break.
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;
  if (!res.ok || !json || json.success === false) {
    const failure = json as ApiFailure | null;
    throw new ApiError(res.status, failure?.message || 'Something went wrong. Please try again.', failure?.code);
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
    const response = await fetch(localUriOrUrl);
    const blob = await response.blob();
    const extension = localUriOrUrl.split('.').pop()?.split('?')[0] || 'jpg';
    const formData = new FormData();
    formData.append('file', blob, `${filenamePrefix}-${Date.now()}.${extension}`);
    const result = await request<{ url: string }>('POST', '/public/customers/uploads/image', formData, true);
    return result.url;
  },
};
