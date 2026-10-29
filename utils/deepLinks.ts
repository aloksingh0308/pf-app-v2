import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Universal links (Android App Links / iOS Universal Links) on the customer website's domain:
 *   https://prayagifoodwala.com/r/<orgSlug>/<branchCode>  → restaurant page
 *   https://prayagifoodwala.com/invite/<CODE>             → sign-up with a referral code
 * The same paths on the app scheme (PrayagiFoodwala://r/...) work too — the website's
 * /invite page uses that scheme as an Android intent fallback when App Links aren't verified.
 *
 * app/+native-intent.tsx parses incoming URLs here and parks them as a "pending" link instead
 * of routing to them directly: the root layout owns where a cold start lands (splash → login
 * or tabs), and it consumes the pending link once auth has settled (see app/_layout.tsx).
 */

export const WEBSITE_ORIGIN = 'https://prayagifoodwala.com';
const LINK_HOSTS = ['prayagifoodwala.com', 'www.prayagifoodwala.com'];

export type DeepLink =
  | { type: 'restaurant'; orgSlug: string; branchCode: string }
  | { type: 'invite'; code: string };

const PENDING_RESTAURANT_KEY = 'deep_link_pending_restaurant';
const PENDING_REFERRAL_KEY = 'deep_link_pending_referral_code';

export const normalizeReferralCode = (raw: unknown): string =>
  String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20);

/** Returns null for anything that isn't one of our links (Firebase auth redirects, Expo dev URLs…). */
export const parseDeepLink = (url: string): DeepLink | null => {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let path = raw;
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i);
  if (scheme) {
    const [, protocol, host, rest] = scheme;
    if (/^https?$/i.test(protocol)) {
      if (!LINK_HOSTS.includes(host.toLowerCase())) return null;
      path = rest;
    } else {
      // Custom scheme: PrayagiFoodwala://invite/CODE puts "invite" in the host slot.
      path = `/${host}${rest}`;
    }
  }
  const segments = path.split(/[?#]/)[0].split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  if (segments[0] === 'r' && segments[1] && segments[2]) {
    return { type: 'restaurant', orgSlug: segments[1], branchCode: segments[2] };
  }
  if (segments[0] === 'invite' && segments[1]) {
    const code = normalizeReferralCode(segments[1]);
    return code ? { type: 'invite', code } : null;
  }
  return null;
};

export const restaurantShareUrl = (orgSlug: string, branchCode: string) =>
  `${WEBSITE_ORIGIN}/r/${encodeURIComponent(orgSlug)}/${encodeURIComponent(branchCode)}`;

export const inviteShareUrl = (code: string) => `${WEBSITE_ORIGIN}/invite/${encodeURIComponent(code)}`;

/* ---------------- pending link store ---------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Fires when a link arrives while the app is already running, so the layout can act on it. */
export const onPendingLinkChange = (listener: Listener) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const savePendingLink = async (link: DeepLink) => {
  try {
    if (link.type === 'restaurant') {
      await AsyncStorage.setItem(PENDING_RESTAURANT_KEY, JSON.stringify({ orgSlug: link.orgSlug, branchCode: link.branchCode }));
    } else {
      await AsyncStorage.setItem(PENDING_REFERRAL_KEY, link.code);
    }
  } catch {
    // Best effort — losing a pending link only means landing on Home/login as usual.
  }
  listeners.forEach((l) => l());
};

/** Reads and clears the pending restaurant (one-shot). */
export const takePendingRestaurant = async (): Promise<{ orgSlug: string; branchCode: string } | null> => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_RESTAURANT_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(PENDING_RESTAURANT_KEY);
    const parsed = JSON.parse(raw);
    return parsed?.orgSlug && parsed?.branchCode ? parsed : null;
  } catch {
    return null;
  }
};

/** Kept until sign-up completes (the user may back out of OTP and retry). */
export const getPendingReferralCode = async (): Promise<string> => {
  try {
    return normalizeReferralCode(await AsyncStorage.getItem(PENDING_REFERRAL_KEY));
  } catch {
    return '';
  }
};

export const clearPendingReferralCode = async () => {
  try { await AsyncStorage.removeItem(PENDING_REFERRAL_KEY); } catch { /* ignore */ }
};
