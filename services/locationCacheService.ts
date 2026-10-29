import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppDispatch } from '../store';
import { track } from './analytics';
import { setLocation, setLocationAddress } from '../store/slices/locationSlice';

const LOCATION_CACHE_KEY = 'hb_user_location_cache_v1';
export const DEFAULT_LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const LOCATION_FETCH_TIMEOUT_MS = 4500;
const REVERSE_GEOCODE_TIMEOUT_MS = 2500;
const GOOGLE_MAPS_API_KEY = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();

export type CachedUserLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp: number;
  /** A confirmed delivery destination must not be replaced by foreground GPS. */
  source?: 'device' | 'selected';
  addressLine?: string | null;
  addressResolvedAt?: number | null;
};

let locationRevision = 0;
let inMemoryCache: CachedUserLocation | null = null;
// Guards only the actual GPS+network refresh, never a plain cache read — a
// forced refresh kicked off from one screen (e.g. app foreground) must not
// make a concurrent cache-only caller (e.g. Home's "loading location" state)
// block on that network round trip. See warmupUserLocationCache below.
let refreshInFlightPromise: Promise<CachedUserLocation | null> | null = null;
let lastRefreshCompletedAt = 0;
const MIN_MS_BETWEEN_FORCED_REFRESHES = 60 * 1000;
let addressHydrationInFlight = false;

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(Number(value));

const normalizeCachePayload = (value: unknown): CachedUserLocation | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  const timestamp = Number(raw.timestamp);

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude) || !isFiniteNumber(timestamp)) {
    return null;
  }

  return {
    latitude,
    longitude,
    accuracy: isFiniteNumber(raw.accuracy) ? Number(raw.accuracy) : null,
    timestamp,
    source: raw.source === 'selected' ? 'selected' : 'device',
    addressLine: typeof raw.addressLine === 'string' ? raw.addressLine : null,
    addressResolvedAt: isFiniteNumber(raw.addressResolvedAt) ? Number(raw.addressResolvedAt) : null,
  };
};

const isFresh = (location: CachedUserLocation | null, maxAgeMs: number) => {
  if (location?.source === 'selected') return true;
  if (!location?.timestamp) {
    return false;
  }
  return Date.now() - location.timestamp <= maxAgeMs;
};

const readStorageCache = async (): Promise<CachedUserLocation | null> => {
  try {
    const raw = await AsyncStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeCachePayload(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeStorageCache = async (location: CachedUserLocation) => {
  try {
    await AsyncStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify(location));
  } catch {
    // Ignore cache persistence failure.
  }
};

const getPositionWithFallback = async () => {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), LOCATION_FETCH_TIMEOUT_MS);
  });

  const currentPosition = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
    timeoutPromise,
  ]);

  if ((currentPosition as any)?.coords) {
    return currentPosition as Location.LocationObject;
  }

  const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
  return lastKnown;
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const reverseGeocodeAddress = async (latitude: number, longitude: number): Promise<string | null> => {
  const fromNative = async (): Promise<string> => {
    const places = await withTimeout(
      Location.reverseGeocodeAsync({ latitude, longitude }),
      REVERSE_GEOCODE_TIMEOUT_MS
    );
    const place = places?.[0];
    return [
      place?.name,
      place?.street,
      place?.district,
      place?.city,
      place?.region,
      place?.postalCode,
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ');
  };

  const fromGoogle = async (): Promise<string> => {
    if (!GOOGLE_MAPS_API_KEY) return '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`,
        { signal: controller.signal }
      );
      const data = await response.json();
      return String(data?.results?.[0]?.formatted_address || '').trim();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Native device geocoder and Google's HTTP API are raced in parallel —
  // whichever resolves first with a non-empty address wins, so this never
  // pays the full timeout of a stalled native geocoder before trying Google.
  const results = await Promise.allSettled([fromNative(), fromGoogle()]);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
  }
  return null;
};

export const saveCachedUserLocation = async (
  nextLocation: CachedUserLocation,
  dispatch?: AppDispatch
) => {
  const revision = ++locationRevision;
  inMemoryCache = nextLocation;
  await writeStorageCache(nextLocation);
  if (revision !== locationRevision) return;

  if (dispatch) {
    dispatch(setLocation({
      latitude: nextLocation.latitude,
      longitude: nextLocation.longitude,
      accuracy: nextLocation.accuracy ?? null,
      timestamp: nextLocation.timestamp,
      addressLine: nextLocation.addressLine ?? null,
      addressResolvedAt: nextLocation.addressResolvedAt ?? null,
    }));
  }
};

export const updateCachedUserAddress = async (
  addressLine: string,
  dispatch?: AppDispatch
) => {
  const normalizedAddress = String(addressLine || '').trim();
  if (!normalizedAddress) {
    return;
  }

  const existing = inMemoryCache || await readStorageCache();
  if (!existing) {
    return;
  }

  const updated: CachedUserLocation = {
    ...existing,
    addressLine: normalizedAddress,
    addressResolvedAt: Date.now(),
  };

  inMemoryCache = updated;
  await writeStorageCache(updated);

  if (dispatch) {
    dispatch(setLocationAddress({
      addressLine: updated.addressLine ?? null,
      addressResolvedAt: updated.addressResolvedAt ?? null,
    }));
  }
};

export const getFreshCachedUserLocation = async (
  maxAgeMs: number = DEFAULT_LOCATION_MAX_AGE_MS
): Promise<CachedUserLocation | null> => {
  if (isFresh(inMemoryCache, maxAgeMs)) {
    return inMemoryCache;
  }

  const revision = locationRevision;
  const fromStorage = await readStorageCache();
  if (revision !== locationRevision) return inMemoryCache;
  if (!fromStorage) {
    return null;
  }

  inMemoryCache = fromStorage;
  if (!isFresh(fromStorage, maxAgeMs)) {
    return null;
  }

  return fromStorage;
};

const dispatchLocation = (location: CachedUserLocation, dispatch?: AppDispatch) => {
  if (!dispatch) return;
  dispatch(setLocation({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy ?? null,
    timestamp: location.timestamp,
    addressLine: location.addressLine ?? null,
    addressResolvedAt: location.addressResolvedAt ?? null,
  }));
};

const refreshUserLocationNow = async (options?: {
  dispatch?: AppDispatch;
}): Promise<CachedUserLocation | null> => {
  if (refreshInFlightPromise) {
    return refreshInFlightPromise;
  }

  const revision = locationRevision;
  refreshInFlightPromise = (async () => {
    const permission = await Location.getForegroundPermissionsAsync();
    let status = permission.status;
    if (status !== 'granted') {
      const nextPermission = await Location.requestForegroundPermissionsAsync();
      status = nextPermission.status;
    }

    if (status !== 'granted') {
      // Runs on every app open/foreground — once a day per status is enough.
      track('location_problem', { reason: `permission_${status}` }, { throttleKey: String(status), throttleMs: 24 * 60 * 60 * 1000 });
      return null;
    }

    const position = await getPositionWithFallback();
    if (revision !== locationRevision) return inMemoryCache;
    if (!position?.coords) {
      track('location_problem', { reason: 'no_position_fix' }, { throttleKey: 'no_fix', throttleMs: 60 * 60 * 1000 });
      return null;
    }

    // Only reuse the previously resolved address text if it was resolved for
    // this same coordinate — otherwise a freshly fetched (possibly very
    // different) position would keep showing an address for where the user
    // used to be.
    const sameCoordsAsCache = Boolean(
      inMemoryCache
      && inMemoryCache.latitude === position.coords.latitude
      && inMemoryCache.longitude === position.coords.longitude
    );

    const nextLocation: CachedUserLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp || Date.now(),
      addressLine: sameCoordsAsCache ? inMemoryCache?.addressLine ?? null : null,
      addressResolvedAt: sameCoordsAsCache ? inMemoryCache?.addressResolvedAt ?? null : null,
    };

    await saveCachedUserLocation(nextLocation, options?.dispatch);
    lastRefreshCompletedAt = Date.now();
    return nextLocation;
  })();

  try {
    return await refreshInFlightPromise;
  } finally {
    refreshInFlightPromise = null;
  }
};

/**
 * Cache-first, non-blocking-on-refresh location lookup. A plain call (no
 * `forceRefresh`) always resolves from memory/AsyncStorage instantly when a
 * fresh-enough value exists — it never waits on a GPS fix, even if another
 * caller elsewhere (e.g. the app-foreground listener) is concurrently doing
 * a forced refresh. `forceRefresh` kicks off (or joins) that live GPS+network
 * fetch and is throttled to once a minute so rapid foreground/background
 * cycling doesn't repeatedly hit the location stack for no benefit.
 */
export const warmupUserLocationCache = async (options?: {
  dispatch?: AppDispatch;
  forceRefresh?: boolean;
  maxAgeMs?: number;
}): Promise<CachedUserLocation | null> => {
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_LOCATION_MAX_AGE_MS;

  const selected = await getFreshCachedUserLocation(maxAgeMs);
  if (selected?.source === 'selected') {
    dispatchLocation(selected, options?.dispatch);
    return selected;
  }

  if (!options?.forceRefresh) {
    if (selected) {
      dispatchLocation(selected, options?.dispatch);
      return selected;
    }
    return refreshUserLocationNow(options);
  }

  const throttled = Date.now() - lastRefreshCompletedAt < MIN_MS_BETWEEN_FORCED_REFRESHES;
  if (throttled) {
    const cached = await getFreshCachedUserLocation(maxAgeMs);
    if (cached) {
      dispatchLocation(cached, options?.dispatch);
      return cached;
    }
  }

  return refreshUserLocationNow(options);
};

export const hydrateCachedLocationAddress = async (options?: {
  dispatch?: AppDispatch;
  maxAgeMs?: number;
}) => {
  if (addressHydrationInFlight) {
    return;
  }

  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_LOCATION_MAX_AGE_MS;
  const cached = await getFreshCachedUserLocation(maxAgeMs);
  if (!cached || cached.addressLine) {
    return;
  }

  addressHydrationInFlight = true;
  try {
    const revision = locationRevision;
    const address = await reverseGeocodeAddress(cached.latitude, cached.longitude);
    if (address && revision === locationRevision) {
      await updateCachedUserAddress(address, options?.dispatch);
    }
  } finally {
    addressHydrationInFlight = false;
  }
};
