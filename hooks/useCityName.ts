import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/** Results per ~1 km cell, so moving around a city doesn't geocode again. */
const cache = new Map<string, string>();

/**
 * The city at a point ("Prayagraj", "Delhi", …) for copy like "Taste of <city>" — never a
 * hard-coded city. Returns '' until known (no location yet, or the lookup failed), so
 * callers fall back to neutral text ("your city", "near you").
 */
export function useCityName(latitude?: number | null, longitude?: number | null): string {
  const hasPoint = Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  const key = hasPoint ? `${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}` : '';
  const [city, setCity] = useState(() => (key ? cache.get(key) || '' : ''));

  useEffect(() => {
    if (!key) {
      setCity('');
      return;
    }
    const known = cache.get(key);
    if (known !== undefined) {
      setCity(known);
      return;
    }
    let active = true;
    Location.reverseGeocodeAsync({ latitude: Number(latitude), longitude: Number(longitude) })
      .then((places) => {
        const place = places?.[0];
        const name = String(place?.city || place?.subregion || place?.district || '')
          .replace(/\s+(District|Division|Tehsil)$/i, '')
          .trim();
        if (name) cache.set(key, name);
        if (active) setCity(name);
      })
      .catch(() => {
        if (active) setCity('');
      });
    return () => {
      active = false;
    };
    // latitude/longitude are captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return city;
}
