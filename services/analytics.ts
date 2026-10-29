import {
  getAnalytics,
  logEvent,
  logScreenView,
  setDefaultEventParameters,
  setUserId,
  setUserProperties,
} from '@react-native-firebase/analytics';

/**
 * Google Analytics (GA4, via Firebase Analytics — project hungry-s-bucket) for the customer
 * app. Besides screen views and the standard funnel events (login, begin_checkout, purchase…)
 * the point is to see WHERE customers run into problems, so every failed API call, every
 * popup the app shows, connectivity drops and JS crashes are logged automatically
 * (apiClient, alertService, connectivity, _layout) with the screen they happened on.
 *
 * Rules: never log phone numbers / emails / names (scrub() strips them from free text);
 * analytics must never break the app, so every call here swallows its own errors.
 *
 * Event names/params follow GA4 limits: names ≤ 40 chars, string param values ≤ 100 chars.
 *
 * Every event carries `app_surface: app` (the website sends `web`, the SaaS panel `saas`)
 * so one GA4 dimension tells the three apart — it is set per event, as a default event
 * parameter (covers Firebase's automatic events: first_open, session_start…) and as a
 * user property.
 */

type Params = Record<string, string | number | boolean | null | undefined>;

const SURFACE = 'app';

let currentScreen = 'unknown';
const lastSent = new Map<string, number>();

function analytics() {
  return getAnalytics();
}

try {
  void setDefaultEventParameters(analytics(), { app_surface: SURFACE }).catch(() => {});
  void setUserProperties(analytics(), { app_surface: SURFACE }).catch(() => {});
} catch {
  // A build without the native module — analytics must never break the app.
}

/** Strips anything that could identify a customer from free text before it's logged. */
export function scrub(value: unknown, max = 100): string {
  return String(value ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Collapses ids in an API path so `/orders/6712ab…` and `/orders/6713cd…` group together. */
export function normalizeEndpoint(path: string): string {
  return path
    .split('?')[0]
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .replace(/\/[A-Z0-9]{6,}(?=\/|$)/g, '/:code')
    .slice(0, 100);
}

function clean(params: Params): Record<string, string | number> {
  const out: Record<string, string | number> = { screen: currentScreen, app_surface: SURFACE };
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = typeof value === 'number' ? value : typeof value === 'boolean' ? String(value) : scrub(value);
  }
  return out;
}

/** Logs a GA4 event. `throttleKey` drops repeats of the same thing within `throttleMs`
 *  (background polling would otherwise log the same failure every few seconds). */
export function track(name: string, params: Params = {}, opts: { throttleKey?: string; throttleMs?: number } = {}): void {
  try {
    if (opts.throttleKey) {
      const key = `${name}|${opts.throttleKey}`;
      const now = Date.now();
      if (now - (lastSent.get(key) ?? 0) < (opts.throttleMs ?? 60_000)) return;
      lastSent.set(key, now);
    }
    const payload = clean(params);
    if (__DEV__) console.log(`[analytics] ${name}`, payload);
    void logEvent(analytics(), name as never, payload as never).catch(() => {});
  } catch {
    // Analytics must never break the app (e.g. a build without the native module).
  }
}

export const analyticsService = {
  /** Called on every route change (app/_layout.tsx). */
  screen(pathname: string): void {
    const name = normalizeEndpoint(pathname || '/') || '/';
    if (name === currentScreen) return;
    currentScreen = name;
    try {
      void logScreenView(analytics(), { screen_name: name, screen_class: name, app_surface: SURFACE }).catch(() => {});
    } catch {
      /* ignore */
    }
  },

  currentScreen: () => currentScreen,

  /** Customer uid (an opaque id, not PII) — lets GA count affected users. null on logout. */
  setUser(uid: string | null): void {
    try {
      void setUserId(analytics(), uid).catch(() => {});
    } catch {
      /* ignore */
    }
  },

  // ---- Automatic problem signals -------------------------------------------------------

  /** Any API call that came back with an error (utils/apiClient.ts). */
  apiError(method: string, path: string, status: number, code?: string, message?: string): void {
    const endpoint = normalizeEndpoint(path);
    track(
      'api_error',
      { method, endpoint, status, error_code: code, error_message: message },
      { throttleKey: `${method} ${endpoint} ${status}` }
    );
  },

  /** A request that never reached the server (no internet / server down). */
  networkError(method: string, path: string): void {
    track('network_error', { method, endpoint: normalizeEndpoint(path) }, { throttleKey: normalizeEndpoint(path) });
  },

  /** The full-screen "no internet / can't reach server" fallback appeared. */
  connectivityLost(status: string): void {
    track('connectivity_lost', { status }, { throttleKey: status, throttleMs: 30_000 });
  },

  /** Every popup shown to the customer (services/alertService.ts). */
  alertShown(title: string, message?: string, extra: Params = {}): void {
    track('app_alert', { alert_title: title, alert_message: message, ...extra }, { throttleKey: `${title}|${message}`, throttleMs: 5_000 });
  },

  /** Uncaught JS error. */
  exception(error: unknown, fatal: boolean): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    track('app_exception', { error_message: message, fatal }, { throttleKey: message, throttleMs: 10_000 });
  },
};

/** Short, stable reason string for an error (status / code / message) for event params. */
export function errorReason(error: unknown): string {
  const e = error as { status?: number; code?: string; message?: string } | null;
  if (!e) return 'unknown';
  const parts = [e.status ? `HTTP_${e.status}` : '', e.code || '', e.message || ''].filter(Boolean);
  return scrub(parts.join(' | ') || String(error));
}
