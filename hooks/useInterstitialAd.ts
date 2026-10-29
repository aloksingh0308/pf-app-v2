import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AdEventType, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';

const INTERSTITIAL_AD_UNIT_ID = String(process.env.EXPO_PUBLIC_INTERSTITIAL_AD_UNIT_ID || '').trim();

/**
 * Preloads an interstitial and exposes `showThen(cb)`: shows the ad and runs `cb` once it closes.
 * If no ad is ready, `cb` runs immediately so gameplay is never blocked.
 */
export function useInterstitialAd() {
  const ad = useMemo(
    () => InterstitialAd.createForAdRequest(__DEV__ ? TestIds.INTERSTITIAL : INTERSTITIAL_AD_UNIT_ID, {
      requestNonPersonalizedAdsOnly: true,
    }),
    [],
  );
  const loaded = useRef(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const offLoaded = ad.addAdEventListener(AdEventType.LOADED, () => { loaded.current = true; });
    const offClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      loaded.current = false;
      pending.current?.();
      pending.current = null;
      ad.load();
    });
    const offError = ad.addAdEventListener(AdEventType.ERROR, () => {
      loaded.current = false;
      pending.current?.();
      pending.current = null;
    });
    ad.load();
    return () => { offLoaded(); offClosed(); offError(); };
  }, [ad]);

  return useCallback((then: () => void) => {
    if (!loaded.current) {
      then();
      ad.load();
      return;
    }
    pending.current = then;
    ad.show().catch(() => {
      pending.current = null;
      then();
    });
  }, [ad]);
}
