import { API_CONFIG } from '../config/api';

/**
 * The backend builds absolute image URLs (logos, branch background photos, menu item
 * photos) against its own `PUBLIC_URL` env var, which on a dev machine is whatever
 * `localhost` resolves to on the SERVER — meaningless on a phone/emulator, which needs to
 * reach the dev machine some other way (10.0.2.2 on the Android emulator, a LAN IP on a
 * physical device). The app already solves exactly this for API calls via
 * `API_CONFIG.baseUrl`; this rewrites any `localhost`/`127.0.0.1` image URL onto that same
 * host so uploaded images actually load instead of silently failing. Third-party URLs
 * (a pasted external image link) are left untouched.
 */
const apiOrigin = (() => {
  try {
    return new URL(API_CONFIG.baseUrl).origin;
  } catch {
    return '';
  }
})();

export function resolveImageUrl(url?: string | null): string | undefined {
  const trimmed = String(url || '').trim();
  if (!trimmed || !apiOrigin) return trimmed || undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return `${apiOrigin}${parsed.pathname}${parsed.search}`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}
