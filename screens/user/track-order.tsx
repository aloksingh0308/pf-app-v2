import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMyOrders } from '@/services/orderService';
import { findRestaurantByAnyId } from '@/services/restaurantService';

const getEstimatedTime = (distance: number) => 15 + Math.ceil(distance) * 5;

type Coordinates = { latitude: number; longitude: number };
const GOOGLE_MAPS_API_KEY = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
const TRACK_ORDER_BANNER_AD_UNIT_ID =String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
//  __DEV__
//   ? 'ca-app-pub-2598300953281179/5310825556'
//   : String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
const DELIVERY_PARTNER_MARKER_IMAGE = require('../../assets/images/delivery_partner_marker.png');
const CALL_BUTTON_SAFE_BOTTOM = 114;

type RouteInfo = {
  points: Coordinates[];
  durationSec: number;
  distanceMeters: number;
};

type TrackingDoc = {
  partnerLocation?: { latitude?: number; longitude?: number } | null;
  cafeLocation?: { latitude?: number; longitude?: number } | null;
  deliveryLocation?: { latitude?: number; longitude?: number } | null;
  customerPhone?: string;
};

const areCoordinatesEqual = (left: Coordinates | null, right: Coordinates | null): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.latitude === right.latitude && left.longitude === right.longitude;
};

const areCoordinateListsEqual = (left: Coordinates[], right: Coordinates[]): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!areCoordinatesEqual(left[index], right[index])) {
      return false;
    }
  }
  return true;
};

const getDistanceKm = (start: Coordinates, end: Coordinates): number => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(end.latitude - start.latitude);
  const dLng = toRad(end.longitude - start.longitude);
  const lat1 = toRad(start.latitude);
  const lat2 = toRad(end.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
};

const getRegionForEndpoints = (start: Coordinates, end: Coordinates) => {
  const distanceKm = getDistanceKm(start, end);
  const minLat = Math.min(start.latitude, end.latitude);
  const maxLat = Math.max(start.latitude, end.latitude);
  const minLng = Math.min(start.longitude, end.longitude);
  const maxLng = Math.max(start.longitude, end.longitude);
  const latDiff = Math.abs(maxLat - minLat);
  const lngDiff = Math.abs(maxLng - minLng);

  // Distance-based floor for zooming: very close routes get a much tighter view.
  const minDelta = distanceKm < 0.05
    ? 0.0012
    : distanceKm < 0.2
      ? 0.0022
      : distanceKm < 0.5
        ? 0.004
        : distanceKm < 1.5
          ? 0.008
          : distanceKm < 4
            ? 0.02
            : distanceKm < 10
              ? 0.05
              : distanceKm < 25
                ? 0.12
                : 0.25;

  // Make markers sit near opposite corners by expanding deltas from edge padding ratio.
  const cornerPaddingRatio = 0.14;
  const requiredLatDelta = latDiff > 0
    ? latDiff / (1 - cornerPaddingRatio * 2)
    : minDelta;
  const requiredLngDelta = lngDiff > 0
    ? lngDiff / (1 - cornerPaddingRatio * 2)
    : minDelta;

  const latitudeDelta = Math.max(minDelta, requiredLatDelta);
  const longitudeDelta = Math.max(minDelta, requiredLngDelta);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toCoordinates = (latitude: unknown, longitude: unknown): Coordinates | null => {
  const lat = toNumberOrNull(latitude);
  const lng = toNumberOrNull(longitude);
  if (lat === null || lng === null) {
    return null;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { latitude: lat, longitude: lng };
};

const isCoordinates = (value: unknown): value is Coordinates => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<Coordinates>;
  return Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude);
};

const normalizeStatus = (value: unknown): string => String(value || '').trim().toLowerCase();

const isPickedStatus = (status: string) => {
  return (
    status.includes('picked')
    || status.includes('dispatch')
    || status.includes('on the way')
    || status.includes('out_for_delivery')
    || status.includes('out for delivery')
  );
};

const isTerminalStatus = (status: string) => {
  return (
    status.includes('deliver')
    || status.includes('cancel')
    || status.includes('reject')
    || status.includes('fail')
  );
};

const extractCafeCoordinatesFromOrder = (order: any): Coordinates | null => {
  const restaurantLocation = order?.restaurantLocation || order?.cafeLocation || order?.location || {};
  return toCoordinates(
    order?.restaurantLatitude ?? order?.cafeLatitude ?? restaurantLocation?.latitude ?? restaurantLocation?.lat,
    order?.restaurantLongitude ?? order?.cafeLongitude ?? restaurantLocation?.longitude ?? restaurantLocation?.lng,
  );
};

const extractCafeCoordinates = async (order: any, tracking: TrackingDoc | null): Promise<Coordinates | null> => {
  const fromTracking = toCoordinates(tracking?.cafeLocation?.latitude, tracking?.cafeLocation?.longitude);
  if (fromTracking) {
    return fromTracking;
  }

  const fromOrder = extractCafeCoordinatesFromOrder(order);
  if (fromOrder) {
    return fromOrder;
  }

  const cafeId = String(order?.cafeId || order?.restaurantId || '').trim();
  if (!cafeId) {
    return null;
  }

  try {
    // The new backend's Branch model has no lat/lng field yet (address is
    // line1/city/etc. only — see restaurantService.ts) — this returns null either way,
    // same as the Firestore version already did for any restaurant with no location set.
    const restaurant = await findRestaurantByAnyId(cafeId) as Record<string, unknown> | null;
    const location = (restaurant?.location || {}) as Record<string, unknown>;
    return toCoordinates(
      (restaurant?.latitude as unknown) ?? location.latitude ?? location.lat,
      (restaurant?.longitude as unknown) ?? location.longitude ?? location.lng,
    );
  } catch {
    return null;
  }
};

const extractDeliveryCoordinates = (order: any, tracking: TrackingDoc | null): Coordinates | null => {
  const fromTracking = toCoordinates(tracking?.deliveryLocation?.latitude, tracking?.deliveryLocation?.longitude);
  if (fromTracking) {
    return fromTracking;
  }

  const deliveryLocation = order?.deliveryLocation || order?.location || {};
  return toCoordinates(
    order?.deliveryLatitude ?? order?.latitude ?? order?.lat ?? deliveryLocation?.latitude ?? deliveryLocation?.lat,
    order?.deliveryLongitude ?? order?.longitude ?? order?.lng ?? deliveryLocation?.longitude ?? deliveryLocation?.lng,
  );
};



const extractPartnerCoordinates = (order: any, tracking: TrackingDoc | null): Coordinates | null => {
  const fromTracking = toCoordinates(tracking?.partnerLocation?.latitude, tracking?.partnerLocation?.longitude);
  if (fromTracking) {
    return fromTracking;
  }

  const liveLocation = order?.partnerLiveLocation || order?.deliveryPartnerLocation || {};
  return toCoordinates(liveLocation?.latitude, liveLocation?.longitude);
};

const fetchGoogleDrivingRoute = async (start: Coordinates, end: Coordinates): Promise<RouteInfo | null> => {
  if (!GOOGLE_MAPS_API_KEY) {
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&mode=driving&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const route = data?.routes?.[0];
    const encoded = route?.overview_polyline?.points;
    const leg = route?.legs?.[0];

    if (!encoded || !leg) {
      return null;
    }

    const decodePolyline = (encodedPolyline: string): Coordinates[] => {
      let index = 0;
      let lat = 0;
      let lng = 0;
      const coordinates: Coordinates[] = [];

      while (index < encodedPolyline.length) {
        let b;
        let shift = 0;
        let result = 0;
        do {
          b = encodedPolyline.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
        lat += deltaLat;

        shift = 0;
        result = 0;
        do {
          b = encodedPolyline.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
        lng += deltaLng;

        coordinates.push({
          latitude: lat / 1e5,
          longitude: lng / 1e5,
        });
      }

      return coordinates;
    };

    const points = decodePolyline(String(encoded));
    if (points.length < 2) {
      return null;
    }

    return {
      points,
      durationSec: Number(leg?.duration?.value || 0),
      distanceMeters: Number(leg?.distance?.value || 0),
    };
  } catch {
    return null;
  }
};

const fetchDrivingRoute = async (start: Coordinates, end: Coordinates): Promise<RouteInfo> => {
  const googleRoute = await fetchGoogleDrivingRoute(start, end);
  if (googleRoute) {
    return googleRoute;
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    const bestRoute = data?.routes?.[0];
    const route = bestRoute?.geometry?.coordinates;

    if (!Array.isArray(route) || route.length < 2) {
      return {
        points: [start, end],
        durationSec: 0,
        distanceMeters: 0,
      };
    }

    const points = route
      .map((pair: unknown) => {
        if (!Array.isArray(pair) || pair.length < 2) {
          return null;
        }
        return toCoordinates(pair[1], pair[0]);
      })
      .filter((point: Coordinates | null): point is Coordinates => point !== null);

    return {
      points: points.length >= 2 ? points : [start, end],
      durationSec: Number(bestRoute?.duration || 0),
      distanceMeters: Number(bestRoute?.distance || 0),
    };
  } catch {
    return {
      points: [start, end],
      durationSec: 0,
      distanceMeters: 0,
    };
  }
};

const TrackOrderScreen = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const isMapReadyRef = useRef(false);
  const isMapLaidOutRef = useRef(false);
  const lastOrderFingerprintRef = useRef('');
  const lastFitKeyRef = useRef('');

  const orderId = String(params.orderId || params.id || '').trim();
  const distance = Number(params.distance ?? 0);
  const placedAtParam = Number(params.placedAt || 0);
  const estimatedMins = getEstimatedTime(distance);
  const [order, setOrder] = useState<any | null>(null);
  const [tracking, setTracking] = useState<TrackingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [cafeCoordinates, setCafeCoordinates] = useState<Coordinates | null>(null);
  const [routePoints, setRoutePoints] = useState<Coordinates[]>([]);
  const [liveEtaMins, setLiveEtaMins] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [bannerLoadFailed, setBannerLoadFailed] = useState(false);
  const [mapViewportVersion, setMapViewportVersion] = useState(0);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 1500);

    // Replaces the Firestore onSnapshot live listener on the order doc with polling
    // against the customer account's own "my orders" endpoint (see orderService.getMyOrders).
    // There's no backend equivalent yet for the separate `order_tracking` doc (live
    // delivery-partner GPS pings) — no delivery-rider-app/GPS-ping system exists on the
    // new backend at all, so `tracking` just stays null; every place that reads it already
    // falls back gracefully when it's null (see extractCafeCoordinates/
    // extractDeliveryCoordinates above), same as it would for an order with no rider
    // assigned yet in the original app.
    let cancelled = false;
    const fetchOrder = async () => {
      try {
        const orders = await getMyOrders();
        if (cancelled) return;
        const match = orders.find((o) => o.id === orderId) || null;
        const nextFingerprint = JSON.stringify(match);
        if (lastOrderFingerprintRef.current !== nextFingerprint) {
          lastOrderFingerprintRef.current = nextFingerprint;
          setOrder(match);
        }
      } catch (err) {
        console.error('[UserTracking] Failed to load order:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrder();
    const interval = setInterval(fetchOrder, 15000);

    return () => {
      cancelled = true;
      clearTimeout(loadingTimeout);
      clearInterval(interval);
    };
  }, [orderId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const status = normalizeStatus(order?.deliveryStatus || order?.status || params.status || '');
  const isPicked = isPickedStatus(status);
  const isBeforePickup = !isPicked && !isTerminalStatus(status);

  useEffect(() => {
    if (isPicked) {
      setBannerLoadFailed(false);
    }
  }, [isPicked]);


  useEffect(() => {
    let isMounted = true;

    const immediateFromTracking = toCoordinates(tracking?.cafeLocation?.latitude, tracking?.cafeLocation?.longitude);
    const immediateFromOrder = extractCafeCoordinatesFromOrder(order);
    const immediateCoordinates = immediateFromTracking || immediateFromOrder;
    if (immediateCoordinates) {
      setCafeCoordinates((previous) => (areCoordinatesEqual(previous, immediateCoordinates) ? previous : immediateCoordinates));
      return () => {
        isMounted = false;
      };
    }

    const loadCafeCoordinates = async () => {
      const coordinates = await extractCafeCoordinates(order, tracking);
      if (isMounted) {
        setCafeCoordinates((previous) => (areCoordinatesEqual(previous, coordinates) ? previous : coordinates));
      }
    };

    loadCafeCoordinates().catch(() => {
      if (isMounted) {
        setCafeCoordinates(null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [
    order?.cafeId,
    order?.restaurantId,
    order?.restaurantLatitude,
    order?.restaurantLongitude,
    order?.cafeLatitude,
    order?.cafeLongitude,
    tracking?.cafeLocation?.latitude,
    tracking?.cafeLocation?.longitude,
  ]);

  const deliveryCoordinates = useMemo(() => extractDeliveryCoordinates(order, tracking), [order, tracking]);
  const partnerCoordinates = useMemo(() => extractPartnerCoordinates(order, tracking), [order, tracking]);
  const partnerMarkerCoordinates = useMemo(() => {
    if (!isPicked) {
      return partnerCoordinates;
    }

    return routePoints.length > 0 ? routePoints[0] : partnerCoordinates;
  }, [isPicked, routePoints, partnerCoordinates]);

  const activeStartCoordinates = useMemo(() => {
    if (isPicked) {
      return partnerCoordinates || cafeCoordinates;
    }
    return cafeCoordinates;
  }, [isPicked, partnerCoordinates, cafeCoordinates]);

  const mapMarkers = useMemo(() => {
    const raw = isPicked
      ? [activeStartCoordinates, deliveryCoordinates, cafeCoordinates]
      : [cafeCoordinates, deliveryCoordinates];

    const seen = new Set<string>();
    return raw
      .filter(isCoordinates)
      .filter((item) => {
        const key = `${item.latitude}-${item.longitude}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }, [isPicked, activeStartCoordinates, deliveryCoordinates, cafeCoordinates]);

  const cameraMarkers = useMemo(() => {
    if (activeStartCoordinates && deliveryCoordinates) {
      return [activeStartCoordinates, deliveryCoordinates];
    }

    return mapMarkers;
  }, [activeStartCoordinates, deliveryCoordinates, mapMarkers]);

  useEffect(() => {
    if (!isMapReadyRef.current || !isMapLaidOutRef.current) {
      return;
    }

    const pointsForCamera = routePoints.length >= 2 ? routePoints : cameraMarkers;

    if (pointsForCamera.length < 2) {
      return;
    }

    const minLat = Math.min(...pointsForCamera.map((point) => point.latitude));
    const maxLat = Math.max(...pointsForCamera.map((point) => point.latitude));
    const minLng = Math.min(...pointsForCamera.map((point) => point.longitude));
    const maxLng = Math.max(...pointsForCamera.map((point) => point.longitude));

    const fitKey = [
      pointsForCamera.length,
      minLat.toFixed(6),
      maxLat.toFixed(6),
      minLng.toFixed(6),
      maxLng.toFixed(6),
    ].join('|');

    if (fitKey === lastFitKeyRef.current) {
      return;
    }

    lastFitKeyRef.current = fitKey;

    const diagonalDistanceKm = getDistanceKm(
      { latitude: minLat, longitude: minLng },
      { latitude: maxLat, longitude: maxLng },
    );

    const edgePadding = diagonalDistanceKm < 0.3
      ? { top: 40, right: 26, bottom: 48, left: 26 }
      : diagonalDistanceKm < 2
        ? { top: 48, right: 30, bottom: 56, left: 30 }
        : { top: 56, right: 34, bottom: 64, left: 34 };

    const frame = requestAnimationFrame(() => {
      mapRef.current?.fitToCoordinates(pointsForCamera, {
        edgePadding,
        animated: true,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [cameraMarkers, routePoints, mapViewportVersion]);

  useEffect(() => {
    if (!isMapReadyRef.current || !isMapLaidOutRef.current || mapMarkers.length !== 1) {
      return;
    }

    const onlyPoint = mapMarkers[0];
    mapRef.current?.animateToRegion(
      {
        latitude: onlyPoint.latitude,
        longitude: onlyPoint.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      },
      350,
    );
  }, [mapMarkers, mapViewportVersion]);

  useEffect(() => {
    const setPickupPath = async () => {
      if (!deliveryCoordinates) {
        setRoutePoints((previous) => (previous.length === 0 ? previous : []));
        setLiveEtaMins((previous) => (previous === null ? previous : null));
        return;
      }

      if (isPicked && activeStartCoordinates) {
        const route = await fetchDrivingRoute(activeStartCoordinates, deliveryCoordinates);
        setRoutePoints((previous) => (areCoordinateListsEqual(previous, route.points) ? previous : route.points));
        if (route.durationSec > 0) {
          const nextEta = Math.max(1, Math.ceil(route.durationSec / 60));
          setLiveEtaMins((previous) => (previous === nextEta ? previous : nextEta));
        } else {
          setLiveEtaMins((previous) => (previous === null ? previous : null));
        }
        return;
      }

      if (isBeforePickup && cafeCoordinates) {
        const fallbackRoute = [cafeCoordinates, deliveryCoordinates];
        setRoutePoints((previous) => (areCoordinateListsEqual(previous, fallbackRoute) ? previous : fallbackRoute));
        setLiveEtaMins((previous) => (previous === null ? previous : null));
        return;
      }

      setRoutePoints((previous) => (previous.length === 0 ? previous : []));
      setLiveEtaMins((previous) => (previous === null ? previous : null));
    };

    setPickupPath();
  }, [isPicked, isBeforePickup, activeStartCoordinates, cafeCoordinates, deliveryCoordinates]);

  const timeInfo = useMemo(() => {
    const orderPlacedAtMs = (() => {
      if (placedAtParam > 0) {
        return placedAtParam;
      }
      const rawCreatedAt = order?.createdAt;
      if (rawCreatedAt?.seconds) {
        return Number(rawCreatedAt.seconds) * 1000;
      }
      const asDate = new Date(rawCreatedAt || 0).getTime();
      return Number.isFinite(asDate) ? asDate : Date.now();
    })();

    const minsPassed = Math.floor((nowMs - orderPlacedAtMs) / 60000);
    const fallbackMinsLeft = Math.max(estimatedMins - minsPassed, 1);
    const minsLeft = isPicked && liveEtaMins !== null ? liveEtaMins + 7 : fallbackMinsLeft;

    let statusText = 'Order is being prepared and packed';
    if (status.includes('confirm')) {
      statusText = 'Your order is confirmed and being prepared';
    } else if (status.includes('ready')) {
      statusText = 'Order is ready. Delivery partner will pick it up soon.';
    } else if (isPicked) {
      statusText = 'Delivery partner is on the way to your location.';
    } else if (status.includes('deliver')) {
      statusText = 'Order delivered successfully.';
    }

    return { minsLeft, statusText, isLiveEta: isPicked && liveEtaMins !== null };
  }, [placedAtParam, order?.createdAt, nowMs, estimatedMins, status, isPicked, liveEtaMins]);

  const handleRefresh = useCallback(() => {
    setNowMs(Date.now());
  }, []);

  const handleCallDeliveryPartner = async () => {
    const phoneNumber = String(
      order?.deliveryPartnerPhone
      || order?.partnerPhone
      || tracking?.customerPhone
      || '9235949464'
    ).trim();
    const url = `tel:${phoneNumber}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch { }
  };


  const handleHelp = () => {
    router.push('/user/support');
  };

  if (loading) {
    return (
      <View style={[styles.loadingWrap, { paddingTop: insets.top + 20 }]}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: AppColors.background }}>
      <View style={[styles.headerWrapper, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color="#282939" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Status</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity style={styles.headerBtn} onPress={handleRefresh}>
              <Ionicons name="refresh" size={24} color={AppColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={handleHelp}>
              <Ionicons name="help-circle-outline" size={26} color={AppColors.primary} />
              <Text style={styles.helpText}>Help</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View style={styles.container}>
        <Text style={styles.arrivingIn}>Arriving in</Text>
        <Text style={styles.time}>{timeInfo.minsLeft} mins</Text>
        {timeInfo.isLiveEta ? <Text style={styles.liveEtaTag}>Live ETA</Text> : null}
        <Text style={styles.status}>{timeInfo.statusText}</Text>

        <View style={styles.mapCard}>
          {mapMarkers.length > 0 ? (
            <MapView
              ref={mapRef}
              style={styles.map}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                if (width > 0 && height > 0 && !isMapLaidOutRef.current) {
                  isMapLaidOutRef.current = true;
                  setMapViewportVersion((previous) => previous + 1);
                }
              }}
              onMapReady={() => {
                isMapReadyRef.current = true;
                lastFitKeyRef.current = '';
                setMapViewportVersion((previous) => previous + 1);
              }}
              initialRegion={{
                latitude: mapMarkers[0].latitude,
                longitude: mapMarkers[0].longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {!isPicked && cafeCoordinates ? (
                <Marker coordinate={cafeCoordinates} title="Cafe" pinColor="#ea580c" />
              ) : null}

              {isPicked && partnerMarkerCoordinates ? (
                <Marker
                  coordinate={partnerMarkerCoordinates}
                  title="Delivery Partner"
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={false}
                >
                  <Image
                    source={DELIVERY_PARTNER_MARKER_IMAGE}
                    style={styles.partnerMarkerImage}
                    resizeMode="contain"
                  />
                </Marker>
              ) : null}

              {deliveryCoordinates ? (
                <Marker coordinate={deliveryCoordinates} title="Delivery Address" pinColor="#16a34a" />
              ) : null}

              {routePoints.length >= 2 ? (
                <Polyline
                  coordinates={routePoints}
                  strokeColor={isBeforePickup ? '#9ca3af' : AppColors.primary}
                  strokeWidth={4}
                  lineDashPattern={isBeforePickup ? [6, 8] : undefined}
                />
              ) : null}
            </MapView>
          ) : (
            <View style={styles.mapFallbackWrap}>
              <Ionicons name="map-outline" size={28} color="#6b7280" />
              <Text style={styles.mapFallbackText}>Map unavailable for this order.</Text>
            </View>
          )}
        </View>
      </View>
        <View style={[styles.adBannerWrap, { bottom: CALL_BUTTON_SAFE_BOTTOM }]}> 
          {!bannerLoadFailed && TRACK_ORDER_BANNER_AD_UNIT_ID ? (
            <BannerAd
              unitId={TRACK_ORDER_BANNER_AD_UNIT_ID}
              size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
              requestOptions={{
                requestNonPersonalizedAdsOnly: true,
              }}
              onAdFailedToLoad={() => setBannerLoadFailed(true)}
            />
          ) : (
            <View style={styles.adFallbackWrap}>
              <Text style={styles.adFallbackText}>Ad unavailable</Text>
            </View>
          )}
        </View>
      {isPicked && (
        <TouchableOpacity activeOpacity={0.8} style={styles.callBtn} onPress={handleCallDeliveryPartner}>
          <Ionicons name="call-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.callBtnText}>Call Delivery Partner</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  headerWrapper: {
    backgroundColor: AppColors.background,
    paddingTop: 60,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    minWidth: 44,
    minHeight: 44,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: AppColors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  helpText: {
    color: AppColors.primary,
    fontSize: 15,
    marginLeft: 4,
    fontWeight: '500',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    marginTop: 22,
    paddingHorizontal: 14,
  },
  arrivingIn: {
    fontSize: 20,
    color: AppColors.textMuted,
    marginBottom: 8,
  },
  time: {
    fontSize: 40,
    fontWeight: 'bold',
    color: AppColors.primary,
    marginBottom: 8,
  },
  status: {
    fontSize: 18,
    color: AppColors.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  liveEtaTag: {
    fontSize: 12,
    color: '#0f766e',
    fontWeight: '700',
    marginBottom: 6,
  },
  mapCard: {
    width: '100%',
    height: 340,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f8fafc',
    marginTop: 8,
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapFallbackWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  mapFallbackText: {
    color: '#6b7280',
    fontSize: 14,
    fontWeight: '600',
  },
  partnerMarkerImage: {
    width: 64,
    height: 64,
  },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppColors.primary,
    paddingVertical: 16,
    marginHorizontal: 24,
    marginBottom: 32,
    borderRadius: 12,
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 30,
  },
  adBannerWrap: {
    position: 'absolute',
  },
  adFallbackWrap: {
    width: '100%',
    minHeight: 60,
    backgroundColor: '#fee2e2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignSelf:'center'
  },
  adFallbackText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '700',
  },
  callBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: AppColors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default TrackOrderScreen;