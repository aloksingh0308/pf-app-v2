import { useCallback, useEffect, useMemo, useRef } from 'react';
import mobileAds, { AdEventType, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';

// "PF-Interstitial" (Prayagi Foodwala, Android). The env value wins; the literal keeps release
// builds working when the build machine has no .env.
const INTERSTITIAL_AD_UNIT_ID = String(
  process.env.EXPO_PUBLIC_INTERSTITIAL_AD_UNIT_ID || 'ca-app-pub-2598300953281179/9760690500',
).trim();

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000];

let sdkReady: Promise<unknown> | null = null;
function initAds() {
  if (!sdkReady) {
    sdkReady = mobileAds().initialize().catch((error) => {
      console.warn('[ads] SDK initialize failed', error);
    });
  }
  return sdkReady;
}

/**
 * Preloads an interstitial and exposes `showThen(cb)`: shows the ad and runs `cb` once it closes.
 * If no ad is ready, `cb` runs immediately so gameplay is never blocked.
 */
export function useInterstitialAd() {
  const ad = useMemo(
    () => InterstitialAd.createForAdRequest(__DEV__ ? TestIds.INTERSTITIAL : INTERSTITIAL_AD_UNIT_ID),
    [],
  );
  const loaded = useRef(false);
  const loading = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    if (loaded.current || loading.current) return;
    loading.current = true;
    initAds().then(() => ad.load());
  }, [ad]);

  useEffect(() => {
    const offLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      loaded.current = true;
      loading.current = false;
      failures.current = 0;
    });
    const offClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      loaded.current = false;
      pending.current?.();
      pending.current = null;
      load();
    });
    const offError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
      console.warn('[ads] interstitial failed', error);
      loaded.current = false;
      loading.current = false;
      pending.current?.();
      pending.current = null;
      // Real units often no-fill at first; keep retrying in the background with backoff.
      const delay = RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)];
      failures.current += 1;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(load, delay);
    });
    load();
    return () => {
      offLoaded(); offClosed(); offError();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [ad, load]);

  return useCallback((then: () => void) => {
    if (!loaded.current) {
      then();
      load();
      return;
    }
    pending.current = then;
    ad.show().catch(() => {
      loaded.current = false;
      pending.current = null;
      then();
      load();
    });
  }, [ad, load]);
}
