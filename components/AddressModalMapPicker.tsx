import Ionicons from '@react-native-vector-icons/ionicons';
import * as Location from 'expo-location';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, View } from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert } from '../services/alertService';
import { DEFAULT_LOCATION_MAX_AGE_MS, getFreshCachedUserLocation, updateCachedUserAddress, warmupUserLocationCache } from '../services/locationCacheService';
import { AppDispatch, RootState } from '../store';

export type PlacePrediction = {
  place_id: string;
  description: string;
  source: 'google-place' | 'google-geocode' | 'osm';
  latitude?: number;
  longitude?: number;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type Props = {
  visible: boolean;
  enabled: boolean;
  editingAddressId: string;
  defaultMapCenter: { latitude: number; longitude: number };
  restaurantCoords: { latitude: number; longitude: number } | null;
  googleMapsApiKey: string;
  initialAddressText: string;
  initialPin: { latitude: number; longitude: number } | null;
  onAddressChange: (address: string) => void;
  onPinChange: (pin: { latitude: number; longitude: number } | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onClearSelectedAddress?: () => void;
};

const MAP_ZOOM_DELTA = 0.01;
const REVERSE_GEOCODE_TIMEOUT_MS = 2500;
const PLACE_SEARCH_TIMEOUT_MS = 3000;

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

const AddressModalMapPicker = memo(function AddressModalMapPicker({
  visible,
  enabled,
  editingAddressId,
  defaultMapCenter,
  restaurantCoords,
  googleMapsApiKey,
  initialAddressText,
  initialPin,
  onAddressChange,
  onPinChange,
  onLoadingChange,
  onClearSelectedAddress,
}: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const cachedLocationState = useSelector((state: RootState) => state.location);

  const mapRef = useRef<MapView | null>(null);
  const latestRegionRef = useRef<Region | null>(null);
  const mapInitActiveRef = useRef(false);
  const reverseGeocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeSearchRequestIdRef = useRef(0);
  const didBootstrapFromPropsRef = useRef(false);
  const didAutoInitModalLocationRef = useRef(false);
  const didAutoSyncSearchFromMapRef = useRef(false);

  const [deliveryRegion, setDeliveryRegion] = useState<Region | null>(null);
  const [loadingDeliveryMap, setLoadingDeliveryMap] = useState(false);
  const [locationSearchText, setLocationSearchText] = useState('');
  const [placePredictions, setPlacePredictions] = useState<PlacePrediction[]>([]);

  useEffect(() => {
    onLoadingChange?.(loadingDeliveryMap);
  }, [loadingDeliveryMap, onLoadingChange]);

  // While the search predictions dropdown is open, hardware back should
  // dismiss it first instead of closing the whole address modal.
  useEffect(() => {
    if (!visible || !enabled || placePredictions.length === 0) {
      return;
    }

    const onBackPress = () => {
      setPlacePredictions([]);
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [visible, enabled, placePredictions.length]);

  useEffect(() => {
    if (!visible) {
      didBootstrapFromPropsRef.current = false;
      didAutoInitModalLocationRef.current = false;
      didAutoSyncSearchFromMapRef.current = false;
      setPlacePredictions([]);
      if (reverseGeocodeTimerRef.current) {
        clearTimeout(reverseGeocodeTimerRef.current);
        reverseGeocodeTimerRef.current = null;
      }
      if (placeSearchDebounceRef.current) {
        clearTimeout(placeSearchDebounceRef.current);
        placeSearchDebounceRef.current = null;
      }
      return;
    }

    if (didBootstrapFromPropsRef.current) {
      return;
    }

    didBootstrapFromPropsRef.current = true;
    setLocationSearchText(String(initialAddressText || ''));

    if (initialPin && Number.isFinite(initialPin.latitude) && Number.isFinite(initialPin.longitude)) {
      const nextRegion: Region = {
        latitude: initialPin.latitude,
        longitude: initialPin.longitude,
        latitudeDelta: MAP_ZOOM_DELTA,
        longitudeDelta: MAP_ZOOM_DELTA,
      };
      latestRegionRef.current = nextRegion;
      setDeliveryRegion(nextRegion);
      requestAnimationFrame(() => {
        mapRef.current?.animateToRegion(nextRegion, 250);
      });
    } else {
      setDeliveryRegion(null);
      latestRegionRef.current = null;
    }
  }, [visible, initialAddressText, initialPin]);

  const resolveAddressFromCoordinates = useCallback(async (latitude: number, longitude: number) => {
    const lat = Number(latitude);
    const lng = Number(longitude);

    const fetchJsonWithTimeout = async (url: string, headers?: Record<string, string>) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        return await response.json();
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const fromNative = async () => {
      const places = await withTimeout(
        Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
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

    const fromGoogle = async () => {
      if (!googleMapsApiKey) return '';
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleMapsApiKey}`;
      const googleData = await fetchJsonWithTimeout(googleUrl);
      return String(googleData?.results?.[0]?.formatted_address || '').trim();
    };

    // The on-device geocoder and Google's HTTP API are run in parallel rather
    // than as a sequential waterfall — whichever answers first (with a
    // non-empty address) wins, instead of always paying the full timeout of
    // one before even starting the other. OSM is a last-resort fallback only
    // if both come back empty/failing.
    const results = await Promise.allSettled([fromNative(), fromGoogle()]);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value;
      }
    }

    try {
      const osmUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
      const osmData = await fetchJsonWithTimeout(osmUrl, {
        Accept: 'application/json',
      });
      const displayName = String(osmData?.display_name || '').trim();
      if (displayName) {
        return displayName;
      }
    } catch {
      // fall through
    }

    return `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`;
  }, [googleMapsApiKey]);

  const applyResolvedAddress = useCallback(async (
    latitude: number,
    longitude: number,
    options?: { syncSearchInput?: boolean }
  ) => {
    const detectedAddress = await resolveAddressFromCoordinates(latitude, longitude);
    if (detectedAddress) {
      onAddressChange(detectedAddress);
      if (options?.syncSearchInput) {
        setLocationSearchText(detectedAddress);
      }
      void updateCachedUserAddress(detectedAddress, dispatch);
    }
  }, [resolveAddressFromCoordinates, onAddressChange, dispatch]);

  const fetchJsonWithTimeout = useCallback(async (url: string, headers?: Record<string, string>) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PLACE_SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const getLocalGeocodePredictions = useCallback(async (query: string): Promise<PlacePrediction[]> => {
    const coords = await withTimeout(Location.geocodeAsync(query), PLACE_SEARCH_TIMEOUT_MS).catch(() => []);
    const limited = coords.slice(0, 6);
    if (limited.length === 0) {
      return [];
    }

    const withAddress = await Promise.all(
      limited.map(async (row, index) => {
        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }

        const reverse = await Location.reverseGeocodeAsync({ latitude, longitude }).catch(() => []);
        const place = reverse?.[0];
        const description = [place?.name, place?.street, place?.district, place?.city, place?.region, place?.postalCode]
          .map((part) => String(part || '').trim())
          .filter(Boolean)
          .join(', ')
          || query;

        const parts = description.split(',').map((part) => part.trim()).filter(Boolean);
        return {
          place_id: `local-${index}-${latitude}-${longitude}`,
          description,
          source: 'osm' as const,
          latitude,
          longitude,
          structured_formatting: {
            main_text: parts[0] || description,
            secondary_text: parts.slice(1).join(', '),
          },
        } satisfies PlacePrediction;
      })
    );

    return withAddress.filter(Boolean) as PlacePrediction[];
  }, []);

  const fetchPlacePredictions = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const requestId = placeSearchRequestIdRef.current + 1;
    placeSearchRequestIdRef.current = requestId;
    const MAX_PREDICTIONS = 8;

    if (trimmed.length < 3) {
      setPlacePredictions([]);
      return;
    }

    const collectedPredictions: PlacePrediction[] = [];
    const seenKeys = new Set<string>();

    const pushUniquePredictions = (items: PlacePrediction[]) => {
      for (const item of items) {
        if (collectedPredictions.length >= MAX_PREDICTIONS) {
          break;
        }

        const key = String(item.place_id || item.description || '').trim().toLowerCase();
        const descriptionKey = String(item.description || '').trim().toLowerCase();
        const dedupeKey = `${key}::${descriptionKey}`;
        if (!dedupeKey || seenKeys.has(dedupeKey)) {
          continue;
        }

        seenKeys.add(dedupeKey);
        collectedPredictions.push(item);
      }
    };

    // Autocomplete and geocode are two independent lookups for the same
    // phrase, so they're fired in parallel — previously these ran one after
    // another with no timeout on either, so a slow/hanging autocomplete call
    // alone could stall the whole search for as long as the network let it.
    const [autocompleteOutcome, geocodeOutcome] = await Promise.allSettled([
      googleMapsApiKey
        ? fetchJsonWithTimeout(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(trimmed)}&components=country:in&types=geocode&key=${googleMapsApiKey}`)
        : Promise.resolve(null),
      googleMapsApiKey
        ? fetchJsonWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmed)}&key=${googleMapsApiKey}`)
        : Promise.resolve(null),
    ]);

    if (autocompleteOutcome.status === 'fulfilled') {
      const data = autocompleteOutcome.value;
      if (data?.status === 'OK' && Array.isArray(data?.predictions)) {
        const googlePlacePredictions = (data.predictions as Omit<PlacePrediction, 'source'>[])
          .slice(0, 6)
          .map((item) => ({
            ...item,
            source: 'google-place' as const,
          }));
        pushUniquePredictions(googlePlacePredictions);
      }
    }

    if (collectedPredictions.length < 4 && geocodeOutcome.status === 'fulfilled') {
      const geocodeData = geocodeOutcome.value;
      if (geocodeData?.status === 'OK' && Array.isArray(geocodeData?.results)) {
        const geocodePredictions = geocodeData.results
          .slice(0, 6)
          .map((result: any, index: number) => {
            const lat = Number(result?.geometry?.location?.lat);
            const lng = Number(result?.geometry?.location?.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              return null;
            }

            const description = String(result?.formatted_address || '').trim();
            if (!description) {
              return null;
            }

            const parts = description.split(',').map((part) => part.trim()).filter(Boolean);
            return {
              place_id: `google-geocode-${index}-${lat}-${lng}`,
              description,
              source: 'google-geocode' as const,
              latitude: lat,
              longitude: lng,
              structured_formatting: {
                main_text: parts[0] || description,
                secondary_text: parts.slice(1).join(', '),
              },
            } satisfies PlacePrediction;
          })
          .filter(Boolean) as PlacePrediction[];
        pushUniquePredictions(geocodePredictions);
      }
    }

    if (collectedPredictions.length < MAX_PREDICTIONS) {
      try {
        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(trimmed)}`;
        const fallbackData = await fetchJsonWithTimeout(fallbackUrl, { Accept: 'application/json' });

        if (Array.isArray(fallbackData)) {
          const osmPredictions = fallbackData
            .map((item: any, index: number) => {
              const latitude = Number(item?.lat);
              const longitude = Number(item?.lon);
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return null;
              }

              const description = String(item?.display_name || '').trim();
              if (!description) {
                return null;
              }

              const parts = description.split(',').map((part) => part.trim()).filter(Boolean);
              return {
                place_id: String(item?.place_id || `${index}-${description}`),
                description,
                source: 'osm' as const,
                latitude,
                longitude,
                structured_formatting: {
                  main_text: parts[0] || description,
                  secondary_text: parts.slice(1).join(', '),
                },
              } satisfies PlacePrediction;
            })
            .filter(Boolean) as PlacePrediction[];
          pushUniquePredictions(osmPredictions);
        }
      } catch {
        // fall through
      }
    }

    if (collectedPredictions.length === 0) {
      try {
        pushUniquePredictions(await getLocalGeocodePredictions(trimmed));
      } catch {
        // ignore
      }
    }

    if (requestId !== placeSearchRequestIdRef.current) {
      return;
    }

    setPlacePredictions(collectedPredictions.slice(0, MAX_PREDICTIONS));
  }, [googleMapsApiKey, getLocalGeocodePredictions, fetchJsonWithTimeout]);

  const handleLocationSearchChange = useCallback((text: string) => {
    setLocationSearchText(text);
    onAddressChange(text);

    if (placeSearchDebounceRef.current) {
      clearTimeout(placeSearchDebounceRef.current);
      placeSearchDebounceRef.current = null;
    }

    if (text.trim().length < 3) {
      setPlacePredictions([]);
      return;
    }

    placeSearchDebounceRef.current = setTimeout(() => {
      void fetchPlacePredictions(text);
    }, 250);
  }, [fetchPlacePredictions, onAddressChange]);

  const initializeDeliveryMap = useCallback(async (options?: { preferCache?: boolean }) => {
    const preferCache = options?.preferCache !== false;
    mapInitActiveRef.current = true;
    try {
      setLoadingDeliveryMap(true);

      if (preferCache) {
        // `!= null` matters here: `Number(null)` is `0`, which `Number.isFinite` treats as
        // valid, so an unresolved redux location (still holding its `null` initial state)
        // would otherwise be read as a real (0, 0) coordinate.
        const hasReduxCoords = cachedLocationState.latitude != null && cachedLocationState.longitude != null
          && Number.isFinite(Number(cachedLocationState.latitude)) && Number.isFinite(Number(cachedLocationState.longitude));
        const fromRedux = hasReduxCoords
          ? {
            latitude: Number(cachedLocationState.latitude),
            longitude: Number(cachedLocationState.longitude),
            accuracy: Number(cachedLocationState.accuracy ?? 0) || null,
            timestamp: Number(cachedLocationState.timestamp || 0),
            addressLine: String(cachedLocationState.addressLine || '').trim() || null,
            addressResolvedAt: Number(cachedLocationState.addressResolvedAt || 0) || null,
          }
          : null;

        const fromStorage = fromRedux
          ? fromRedux
          : await getFreshCachedUserLocation(DEFAULT_LOCATION_MAX_AGE_MS);

        if (fromStorage && Date.now() - Number(fromStorage.timestamp || 0) <= DEFAULT_LOCATION_MAX_AGE_MS) {
          const nextRegion: Region = {
            latitude: fromStorage.latitude,
            longitude: fromStorage.longitude,
            latitudeDelta: MAP_ZOOM_DELTA,
            longitudeDelta: MAP_ZOOM_DELTA,
          };

          latestRegionRef.current = nextRegion;
          setDeliveryRegion(nextRegion);
          onPinChange({ latitude: fromStorage.latitude, longitude: fromStorage.longitude });

          if (fromStorage.addressLine) {
            onAddressChange(fromStorage.addressLine);
            setLocationSearchText(fromStorage.addressLine);
          } else {
            void applyResolvedAddress(fromStorage.latitude, fromStorage.longitude, { syncSearchInput: true });
          }

          mapRef.current?.animateToRegion(nextRegion, 250);
          return;
        }
      }

      const resolvedLocation = await warmupUserLocationCache({
        dispatch,
        maxAgeMs: DEFAULT_LOCATION_MAX_AGE_MS,
        forceRefresh: !preferCache,
      }).catch(() => null);

      if (!mapInitActiveRef.current) return;
      if (!resolvedLocation) {
        showAlert('Location Unavailable', 'Unable to fetch current location. Please try again.');
        return;
      }

      const nextRegion: Region = {
        latitude: resolvedLocation.latitude,
        longitude: resolvedLocation.longitude,
        latitudeDelta: MAP_ZOOM_DELTA,
        longitudeDelta: MAP_ZOOM_DELTA,
      };

      latestRegionRef.current = nextRegion;
      setDeliveryRegion(nextRegion);
      onPinChange({ latitude: resolvedLocation.latitude, longitude: resolvedLocation.longitude });

      if (resolvedLocation.addressLine) {
        onAddressChange(resolvedLocation.addressLine);
        setLocationSearchText(resolvedLocation.addressLine);
      }

      mapRef.current?.animateToRegion(nextRegion, 250);
      if (!resolvedLocation.addressLine) {
        void applyResolvedAddress(resolvedLocation.latitude, resolvedLocation.longitude, { syncSearchInput: true });
      }
    } finally {
      if (mapInitActiveRef.current) {
        setLoadingDeliveryMap(false);
      }
    }
  }, [
    applyResolvedAddress,
    cachedLocationState.accuracy,
    cachedLocationState.addressLine,
    cachedLocationState.addressResolvedAt,
    cachedLocationState.latitude,
    cachedLocationState.longitude,
    cachedLocationState.timestamp,
    dispatch,
    onAddressChange,
    onPinChange,
  ]);

  const handleSelectPlacePrediction = useCallback(async (prediction: PlacePrediction) => {
    setLocationSearchText(prediction.description);
    onAddressChange(prediction.description);
    onClearSelectedAddress?.();
    setPlacePredictions([]);

    if (prediction.source !== 'google-place' && Number.isFinite(prediction.latitude) && Number.isFinite(prediction.longitude)) {
      const latitude = Number(prediction.latitude);
      const longitude = Number(prediction.longitude);
      const nextRegion: Region = {
        latitude,
        longitude,
        latitudeDelta: MAP_ZOOM_DELTA,
        longitudeDelta: MAP_ZOOM_DELTA,
      };

      latestRegionRef.current = nextRegion;
      setDeliveryRegion(nextRegion);
      onPinChange({ latitude, longitude });
      mapRef.current?.animateToRegion(nextRegion, 250);
      return;
    }

    if (!googleMapsApiKey) {
      showAlert('Missing API Key', 'Google Maps API key is not configured for place search.');
      return;
    }

    try {
      setLoadingDeliveryMap(true);
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(prediction.place_id)}&fields=geometry,formatted_address&key=${googleMapsApiKey}`;
      const response = await fetch(detailsUrl);
      const data = await response.json();
      const location = data?.result?.geometry?.location;

      if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lng))) {
        showAlert('Location Unavailable', 'Unable to resolve selected place coordinates.');
        return;
      }

      const latitude = Number(location.lat);
      const longitude = Number(location.lng);
      const nextRegion: Region = {
        latitude,
        longitude,
        latitudeDelta: MAP_ZOOM_DELTA,
        longitudeDelta: MAP_ZOOM_DELTA,
      };

      latestRegionRef.current = nextRegion;
      setDeliveryRegion(nextRegion);
      onPinChange({ latitude, longitude });
      onAddressChange(String(data?.result?.formatted_address || prediction.description || '').trim());
      mapRef.current?.animateToRegion(nextRegion, 250);
    } catch {
      showAlert('Search Failed', 'Unable to fetch place details right now. Please try again.');
    } finally {
      setLoadingDeliveryMap(false);
    }
  }, [googleMapsApiKey, onAddressChange, onClearSelectedAddress, onPinChange]);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    if (!enabled || !visible) {
      return;
    }

    latestRegionRef.current = region;
    onPinChange({ latitude: region.latitude, longitude: region.longitude });
    setDeliveryRegion((prev) => ({
      latitude: region.latitude,
      longitude: region.longitude,
      latitudeDelta: prev?.latitudeDelta || MAP_ZOOM_DELTA,
      longitudeDelta: prev?.longitudeDelta || MAP_ZOOM_DELTA,
    }));
    setPlacePredictions([]);

    if (reverseGeocodeTimerRef.current) {
      clearTimeout(reverseGeocodeTimerRef.current);
    }

    reverseGeocodeTimerRef.current = setTimeout(() => {
      void applyResolvedAddress(region.latitude, region.longitude, { syncSearchInput: true });
    }, 300);
  }, [enabled, visible, onPinChange, applyResolvedAddress]);

  const handleMapReady = useCallback(() => {
    if (!visible || !enabled) {
      return;
    }

    const targetRegion = latestRegionRef.current || deliveryRegion;
    if (!targetRegion || !mapRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      mapRef.current?.animateToRegion(targetRegion, 250);
    });

    if (!editingAddressId && !String(initialAddressText || '').trim() && !didAutoSyncSearchFromMapRef.current) {
      didAutoSyncSearchFromMapRef.current = true;
      void applyResolvedAddress(targetRegion.latitude, targetRegion.longitude, { syncSearchInput: true });
    }
  }, [visible, enabled, deliveryRegion, editingAddressId, initialAddressText, applyResolvedAddress]);

  useEffect(() => {
    if (!visible || !enabled) {
      didAutoInitModalLocationRef.current = false;
      return;
    }

    if (editingAddressId || didAutoInitModalLocationRef.current || loadingDeliveryMap) {
      return;
    }

    didAutoInitModalLocationRef.current = true;
    void initializeDeliveryMap();
  }, [visible, enabled, editingAddressId, loadingDeliveryMap, initializeDeliveryMap]);

  const initialRegion = useMemo(() => {
    return deliveryRegion || {
      latitude: defaultMapCenter.latitude,
      longitude: defaultMapCenter.longitude,
      latitudeDelta: MAP_ZOOM_DELTA,
      longitudeDelta: MAP_ZOOM_DELTA,
    };
  }, [deliveryRegion, defaultMapCenter.latitude, defaultMapCenter.longitude]);

  // Every effect above already treats `!visible` as "fully inactive" — but this component
  // itself was still rendering a real, always-mounted MapView regardless of `visible`. The
  // parent AddAddressModal wraps it in a React Native `Modal`, which on Android (especially
  // under the New Architecture) tears down its native surface while `visible={false}` —
  // the MapView living "inside" that closed modal still gets prop/update commands on every
  // parent re-render (e.g. this screen's orderType changing), targeting a surface that no
  // longer exists, which crashes Fabric with "Unable to find viewState for tag N. Surface
  // stopped: false". Not rendering the map at all while the modal is closed removes the
  // orphaned native view entirely, matching what every effect here already assumed.
  if (!visible) {
    return null;
  }

  return (
    <>
      <PlaceSearchContainer>
        <PlaceSearchInputWrap>
          <Ionicons name="search" size={18} color="#999" style={{ marginRight: 8 }} />
          <PlaceSearchInput
            placeholder="Search location (Google Places)"
            placeholderTextColor="#999"
            value={locationSearchText}
            onChangeText={handleLocationSearchChange}
          />
          {locationSearchText.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => handleLocationSearchChange('')}
              style={{ marginLeft: 8, padding: 2 }}
            >
              <Ionicons name="close-circle" size={20} color="#b0b0b0" />
            </Pressable>
          ) : null}
        </PlaceSearchInputWrap>
        {placePredictions.length > 0 ? (
          <PlacesDropdown>
            {placePredictions.map((prediction) => (
              <PlaceRow key={prediction.place_id} onPress={() => handleSelectPlacePrediction(prediction)}>
                <PlaceMainText numberOfLines={1}>{prediction.structured_formatting?.main_text || prediction.description}</PlaceMainText>
                {prediction.structured_formatting?.secondary_text ? (
                  <PlaceSecondaryText numberOfLines={1}>{prediction.structured_formatting.secondary_text}</PlaceSecondaryText>
                ) : null}
              </PlaceRow>
            ))}
          </PlacesDropdown>
        ) : null}
      </PlaceSearchContainer>

      <View style={{ marginTop: 12, marginBottom: 12 }}>
        <MapCard style={{ borderRadius: 16, overflow: 'hidden' }}>
          <MapLocateButton
            activeOpacity={0.8}
            disabled={loadingDeliveryMap}
            onPress={() => void initializeDeliveryMap({ preferCache: true })}
          >
            <Ionicons name="locate" size={18} color="#282939" />
          </MapLocateButton>
          <MapArea
            ref={(instance: MapView | null) => {
              mapRef.current = instance;
            }}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={initialRegion}
            onMapReady={handleMapReady}
            onRegionChangeComplete={handleRegionChangeComplete}
          >
            {restaurantCoords && (
              <Circle
                center={restaurantCoords}
                radius={5000}
                strokeColor="rgba(255, 145, 0, 0.5)"
                fillColor="rgba(255, 145, 0, 0.08)"
                strokeWidth={1.5}
              />
            )}
          </MapArea>
          <CenterPinContainer pointerEvents="none">
            <Ionicons name="location" size={34} color="#FF9100" />
          </CenterPinContainer>
        </MapCard>
        <View style={{ position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 }}>
          <ModalPinLabel>Move map to exact location</ModalPinLabel>
        </View>
      </View>
    </>
  );
});

export default AddressModalMapPicker;

const PlaceSearchContainer = styled.View`
  position: relative;
  margin-top: 12px;
  margin-bottom: 8px;
  z-index: 999;
  elevation: 999;
`;

const PlaceSearchInputWrap = styled.View`
  flex-direction: row;
  align-items: center;
  border-width: 1px;
  border-color: #ececec;
  border-radius: 12px;
  background-color: #fafafa;
  padding: 0 12px;
  min-height: 44px;
`;

const PlaceSearchInput = styled.TextInput`
  flex: 1;
  color: #222;
  font-size: 14px;
  padding: 10px 0;
`;

const PlacesDropdown = styled.View`
  position: absolute;
  top: 52px;
  left: 0;
  right: 0;
  border-width: 1px;
  border-color: #ececec;
  border-radius: 12px;
  background-color: #fff;
  overflow: hidden;
  z-index: 1000;
  elevation: 1000;
  max-height: 190px;
`;

const PlaceRow = styled.TouchableOpacity`
  padding: 10px 12px;
  border-bottom-width: 1px;
  border-bottom-color: #f3f3f3;
`;

const PlaceMainText = styled.Text`
  color: #222;
  font-size: 13px;
  font-weight: 700;
`;

const PlaceSecondaryText = styled.Text`
  color: #777;
  font-size: 12px;
  margin-top: 2px;
`;

const MapCard = styled.View`
  position: relative;
  height: 230px;
  border-width: 1px;
  border-color: #e2e2e2;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 10px;
  z-index: 1;
  elevation: 1;
`;

const MapArea = styled(MapView)`
  width: 100%;
  height: 230px;
`;

const CenterPinContainer = styled.View`
  position: absolute;
  left: 50%;
  top: 50%;
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
  margin-left: -20px;
  margin-top: -40px;
`;

const MapLocateButton = styled.TouchableOpacity`
  width: 34px;
  height: 34px;
  border-radius: 17px;
  align-items: center;
  justify-content: center;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #e2e2e2;
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 2;
  opacity: ${(props: any) => (props.disabled ? 0.7 : 1)};
`;

const ModalPinLabel = styled.Text`
  color: #222;
  font-size: 13px;
  font-weight: 600;
`;
