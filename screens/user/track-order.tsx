import { fetchDrivingRoute } from '@/utils/trackingRoute';
import { T } from '@/constants/tokens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PageHeader from '@/components/common/PageHeader';
import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { getMyOrder, getOrderTracking } from '@/services/orderService';
import { findRestaurantByAnyId } from '@/services/restaurantService';
import { getOrderStage, isOnTheWay, isOrderFinished, orderStatusLabel, orderStatusMessage } from '@/utils/orderStatus';
import { OrderType } from '@/types/enums';
import { usePolling } from '@/utils/polling';
import { isRateLimited } from '@/utils/apiClient';
import { track } from '@/services/analytics';

const TRACKING_POLL_MS = 10_000;

const getEstimatedTime = (distance: number) => 15 + Math.ceil(distance) * 5;

type Coordinates = { latitude: number; longitude: number };
const TRACK_ORDER_BANNER_AD_UNIT_ID =String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
//  __DEV__
//   ? 'ca-app-pub-2598300953281179/5310825556'
//   : String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
// Pre-sized copy of delivery_partner_marker.png, handed to the map natively (Marker `image`):
// no JS view snapshot, so the rider shows at once instead of a blank / default pin.
const DELIVERY_PARTNER_PIN = require('../../assets/images/delivery_partner_pin.png');

type TrackingDoc = {
  partnerLocation?: { latitude?: number; longitude?: number } | null;
  cafeLocation?: { latitude?: number; longitude?: number } | null;
  deliveryLocation?: { latitude?: number; longitude?: number } | null;
  partner?: { name: string; phone: string } | null;
  restaurantPhone?: string;
};

const areCoordinatesEqual = (left: Coordinates | null, right: Coordinates | null): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.latitude === right.latitude && left.longitude === right.longitude;
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

// Exact status matching (utils/orderStatus) — "out_for_delivery" contains "deliver", so
// the old substring checks treated an order on its way as already delivered.
const isPickedStatus = (status: string) => isOnTheWay(status);
const isTerminalStatus = (status: string) => isOrderFinished(status);

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
    // Fallback for when live tracking hasn't loaded yet — the directory record carries the
    // branch's own latitude/longitude (null when the restaurant hasn't set a location).
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

const ROUTE_GRID_DEGREES = 0.003; // ≈300 m
const snapRouteCoordinate = (value?: number | null) => (value == null ? value : Math.round(value / ROUTE_GRID_DEGREES) * ROUTE_GRID_DEGREES);

// Both providers must settle before the next tracking poll; always retain a usable map.
function DeliveryPartnerMarker({ coordinate }: { coordinate: Coordinates }) {
  return <Marker coordinate={coordinate} title="Delivery partner" identifier="delivery-partner"
    image={DELIVERY_PARTNER_PIN} anchor={{ x: 0.5, y: 1 }} zIndex={10} />;
}

// 24×24 glyphs drawn inside the pin's white disc.
const PIN_GLYPHS = {
  store: 'M4 4h16l2 5.2c0 1.6-1.3 2.8-2.8 2.8-1.3 0-2.4-.8-2.7-2-.3 1.2-1.4 2-2.7 2s-2.4-.8-2.7-2c-.3 1.2-1.4 2-2.7 2C5.3 12 4 10.8 2 9.2L4 4zm1 9.6V20h5v-4h4v4h5v-6.4c-.6.2-1.2.4-1.8.4-1 0-1.9-.3-2.6-.9-.8.6-1.7.9-2.6.9s-1.9-.3-2.6-.9c-.8.6-1.7.9-2.6.9-.6 0-1.2-.1-1.8-.4z',
  home: 'M12 3 2.5 11h2.5v9.5h5.5V15h3v5.5H19V11h2.5L12 3z',
} as const;

/** Brand-style map pin drawn in SVG — nothing to download or decode, so it paints on the
 *  first frame. Android snapshots marker children, so tracking stops once it has painted. */
function SvgPinMarker({ coordinate, title, color, glyph }: { coordinate: Coordinates; title: string; color: string; glyph: keyof typeof PIN_GLYPHS }) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(timer);
  }, [coordinate.latitude, coordinate.longitude]);
  return (
    <Marker coordinate={coordinate} title={title} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={tracking}>
      <View collapsable={false} style={{ width: 40, height: 50 }}>
        <Svg width={40} height={50} viewBox="0 0 40 50">
          <Path d="M20 1.5C9.8 1.5 1.5 9.6 1.5 19.6 1.5 33 20 48.5 20 48.5S38.5 33 38.5 19.6C38.5 9.6 30.2 1.5 20 1.5z" fill={color} stroke="#fff" strokeWidth={2} />
          <Circle cx={20} cy={19.5} r={12.5} fill="#fff" />
          <G transform="translate(10.4 9.9) scale(0.8)">
            <Path d={PIN_GLYPHS[glyph]} fill={color} />
          </G>
        </Svg>
      </View>
    </Marker>
  );
}

// Quick games to pass the time while the order is on its way (same games as More → Games).
const WAIT_GAMES = [
  { key: 'tic-tac-toe', title: 'Tic Tac Toe', icon: 'game-controller', route: '/user/tic-tac-toe' },
  { key: 'sudoku', title: 'Sudoku', icon: 'grid', route: '/user/sudoku' },
  { key: 'chess', title: 'Chess', icon: 'extension-puzzle', route: '/user/chess' },
  { key: 'ludo', title: 'Ludo', icon: 'dice', route: '/user/ludo' },
] as const;

type OrderKind = 'delivery' | 'takeaway' | 'dinein';
const orderKindOf = (orderType: unknown): OrderKind =>
  String(orderType) === OrderType.TAKE_AWAY ? 'takeaway' : String(orderType) === OrderType.DINE_IN ? 'dinein' : 'delivery';

const TrackOrderScreen = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mapRef = useRef<MapView | null>(null);
  const isMapReadyRef = useRef(false);
  const isMapLaidOutRef = useRef(false);
  const lastOrderFingerprintRef = useRef('');
  const lastFitKeyRef = useRef('');

  const attachMap = useCallback((map: MapView | null) => {
    mapRef.current = map;
    if (!map) {
      isMapReadyRef.current = false;
      isMapLaidOutRef.current = false;
      lastFitKeyRef.current = '';
    }
  }, []);

  const orderId = String(params.orderId || params.id || '').trim();
  const distance = Number(params.distance ?? 0);
  const placedAtParam = Number(params.placedAt || 0);
  const estimatedMins = getEstimatedTime(distance);
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const refreshOrderRef = useRef<(() => Promise<void>) | null>(null);
  const [order, setOrder] = useState<any | null>(null);
  const [tracking, setTracking] = useState<TrackingDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [cafeCoordinates, setCafeCoordinates] = useState<Coordinates | null>(null);
  const [routePoints, setRoutePoints] = useState<Coordinates[]>([]);
  const [hasRoadRoute, setHasRoadRoute] = useState(false);
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
    return () => clearTimeout(loadingTimeout);
  }, [orderId]);

  // Polls the order (status/items via "my orders") and its live tracking (restaurant
  // location, drop pin, rider + their live position — see orderService.getOrderTracking).
  // A tracking failure never blocks the order itself from showing. Only while this screen
  // is visible (utils/polling.ts), and not at all once the order is finished.
  const fetchOrder = async () => {
    try {
      const [match, liveTracking] = await Promise.all([
        getMyOrder(orderId),
        getOrderTracking(String(orderId)).catch((trackingError) => {
          if (!isRateLimited(trackingError)) console.warn('[UserTracking] Failed to load live tracking:', trackingError);
          return null;
        }),
      ]);
      if (liveTracking) setTracking(liveTracking);
      setLoadError(false);
      const nextFingerprint = JSON.stringify(match);
      if (lastOrderFingerprintRef.current !== nextFingerprint) {
        lastOrderFingerprintRef.current = nextFingerprint;
        setOrder(match);
      }
    } catch (err) {
      setLoadError(true);
      if (!isRateLimited(err)) console.error('[UserTracking] Failed to load order:', err);
    } finally {
      setLoading(false);
    }
  };
  refreshOrderRef.current = fetchOrder;
  const orderFinished = isOrderFinished(order?.status);
  // Rider positions arrive every few seconds from the partner app — 10s keeps the map
  // reasonably live without hammering the API.
  usePolling(fetchOrder, TRACKING_POLL_MS, Boolean(orderId) && !orderFinished);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const status = normalizeStatus(isOrderFinished(order?.status) ? order.status : order?.deliveryStatus || order?.status || params.status || '');
  const isPicked = isPickedStatus(status);

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
  // A route may be snapped to a road or belong to an older request: never use it as GPS.
  const partnerMarkerCoordinates = partnerCoordinates;

  const activeStartCoordinates = useMemo(() => {
    if (isPicked) {
      return partnerCoordinates || cafeCoordinates;
    }
    return cafeCoordinates;
  }, [isPicked, partnerCoordinates, cafeCoordinates]);

  // Once the order is picked up the rider pin replaces the restaurant pin. Until the first
  // GPS fix arrives it sits at the restaurant (where the pickup happened), then follows GPS.
  const showRiderInsteadOfCafe = isPicked && !isTerminalStatus(status) && !!(partnerMarkerCoordinates || cafeCoordinates);
  const riderPinCoordinates = isPicked ? partnerMarkerCoordinates || cafeCoordinates : partnerMarkerCoordinates;

  const mapMarkers = useMemo(() => {
    // After pickup with live GPS, frame the rider + home only (the restaurant pin is hidden).
    const raw = [partnerCoordinates, isPicked && partnerCoordinates ? null : cafeCoordinates, deliveryCoordinates];

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
  }, [partnerCoordinates, deliveryCoordinates, cafeCoordinates, isPicked]);

  const cameraMarkers = useMemo(() => {
    return mapMarkers;
  }, [mapMarkers]);

  useEffect(() => {
    if (!isMapReadyRef.current || !isMapLaidOutRef.current) {
      return;
    }

    const pointsForCamera = [...routePoints, ...cameraMarkers];

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
      if (!mapRef.current) return;
      mapRef.current.fitToCoordinates(pointsForCamera, { edgePadding, animated: true });
      lastFitKeyRef.current = fitKey;
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

  // The rider's position changes on every 10s poll; re-route (a billed Directions call) only
  // once they've moved to another ~300 m grid cell, from their actual latest position.
  const routeStartRef = useRef(activeStartCoordinates);
  routeStartRef.current = activeStartCoordinates;
  const routeStartLat = snapRouteCoordinate(activeStartCoordinates?.latitude);
  const routeStartLng = snapRouteCoordinate(activeStartCoordinates?.longitude);
  const routeEndLat = deliveryCoordinates?.latitude;
  const routeEndLng = deliveryCoordinates?.longitude;
  useEffect(() => {
    let cancelled = false;
    const startNow = routeStartRef.current;
    if (!startNow || routeStartLat == null || routeStartLng == null || routeEndLat == null || routeEndLng == null || isTerminalStatus(status)) {
      setRoutePoints([]);
      setHasRoadRoute(false);
      setLiveEtaMins(null);
      return;
    }
    const start = { latitude: startNow.latitude, longitude: startNow.longitude };
    const end = { latitude: routeEndLat, longitude: routeEndLng };
    // Until pickup the food is still at the restaurant — show the straight-line (air) route and
    // skip the billed Directions call; the road route starts once the rider has the order.
    if (!isPicked) {
      setRoutePoints([start, end]);
      setHasRoadRoute(false);
      setLiveEtaMins(null);
      return;
    }
    // Draw endpoints immediately (a dashed line denotes a preview, never a road route) —
    // unless a road route is already on screen, which stays until its replacement arrives.
    setRoutePoints(previous => (previous.length > 2 ? previous : [start, end]));
    void fetchDrivingRoute(start, end).then(route => {
      if (cancelled) return;
      setRoutePoints(route.points);
      setHasRoadRoute(route.distanceMeters > 0 && route.points.length > 2);
      setLiveEtaMins(isPicked && route.durationSec > 0 ? Math.max(1, Math.ceil(route.durationSec / 60)) : null);
    });
    return () => { cancelled = true; };
  }, [routeStartLat, routeStartLng, routeEndLat, routeEndLng, isPicked, status]);

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

    const statusText = orderStatusMessage(status, orderKindOf(order?.orderType));

    return { minsLeft, statusText, isLiveEta: isPicked && liveEtaMins !== null };
  }, [placedAtParam, order?.createdAt, nowMs, estimatedMins, status, isPicked, liveEtaMins, order?.orderType]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrderRef.current?.();
      setNowMs(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCallDeliveryPartner = async () => {
    const phoneNumber = String(
      tracking?.partner?.phone
      || tracking?.restaurantPhone
      || ''
    ).replace(/[^\d+]/g, '');
    if (!phoneNumber) return;
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

  const stage = getOrderStage(status);
  const terminal = stage === 'DELIVERED' || stage === 'CANCELLED';
  const onPeach = !terminal;
  // Home delivery gets the map + rider; takeaway / dine-in get status details only.
  const kind = orderKindOf(order?.orderType);
  const isDeliveryOrder = kind === 'delivery';
  const currentStep = isDeliveryOrder
    ? (stage === 'DELIVERED' ? 3 : isPicked ? 2 : ['ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED'].includes(stage) ? 1 : 0)
    : (stage === 'DELIVERED' ? 3 : ['READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'].includes(stage) ? 2 : ['ACCEPTED', 'PREPARING'].includes(stage) ? 1 : 0);
  const steps = isDeliveryOrder ? [
    { title: 'Order received', short: 'Received', detail: 'Your order is with the restaurant', icon: 'receipt-outline' },
    { title: 'Preparing your food', short: 'Preparing', detail: stage === 'READY' ? 'Your food is ready for pickup' : stage === 'ASSIGNED' ? 'Delivery partner is heading to the restaurant' : 'Freshly made and packed with care', icon: 'restaurant-outline' },
    { title: 'On the way', short: 'On the way', detail: 'Your delivery partner is heading to you', icon: 'bicycle-outline' },
    { title: 'Delivered', short: 'Delivered', detail: 'Enjoy your meal!', icon: 'checkmark-circle-outline' },
  ] as const : [
    { title: 'Order received', short: 'Received', detail: 'The restaurant has your order', icon: 'receipt-outline' },
    { title: 'Preparing your food', short: 'Preparing', detail: 'Freshly made by the kitchen', icon: 'restaurant-outline' },
    kind === 'takeaway'
      ? { title: 'Ready for pickup', short: 'Ready', detail: 'Collect your order at the counter', icon: 'bag-check-outline' }
      : { title: 'Ready to serve', short: 'Ready', detail: 'Your food is on its way to your table', icon: 'restaurant-outline' },
    kind === 'takeaway'
      ? { title: 'Picked up', short: 'Picked up', detail: 'Enjoy your meal!', icon: 'checkmark-circle-outline' }
      : { title: 'Served', short: 'Served', detail: 'Enjoy your meal!', icon: 'checkmark-circle-outline' },
  ] as const;
  const contactPhone = tracking?.partner?.phone || tracking?.restaurantPhone;
  const contactName = tracking?.partner?.name || 'Restaurant team';
  const orderLabel = order?.displayOrderId || (orderId ? `#${orderId.slice(-6).toUpperCase()}` : '');
  const etaTitle = stage === 'DELIVERED' ? orderStatusLabel(status, kind) : stage === 'CANCELLED' ? 'Order cancelled' : stage === 'SCHEDULED' ? 'Scheduled' : !order ? 'Awaiting update'
    : isDeliveryOrder ? `${timeInfo.minsLeft} min` : orderStatusLabel(status, kind);
  const heroEyebrow = terminal ? 'ORDER UPDATE' : stage === 'SCHEDULED' ? 'UPCOMING ORDER'
    : isDeliveryOrder ? 'ARRIVING IN' : kind === 'takeaway' ? 'TAKEAWAY ORDER' : 'DINE-IN ORDER';
  const heroIconName = stage === 'DELIVERED' ? 'checkmark-circle' : stage === 'CANCELLED' ? 'close-circle'
    : !isDeliveryOrder ? (kind === 'takeaway' ? 'bag-handle' : 'restaurant') : isPicked ? 'bicycle' : 'restaurant';

  if (loading) {
    return (
      <View style={{ flex: 1 }}><PageHeader title="Order Status" /><View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={AppColors.primary} />
      </View></View>
    );
  }
  return (
    <View style={styles.page}>
      <PageHeader title="Order Status" actions={[
        { icon: 'refresh', label: 'Refresh order', onPress: handleRefresh, disabled: refreshing },
        { icon: 'help-circle-outline', label: 'Order help', onPress: handleHelp },
      ]} />
      <ScrollView showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        contentContainerStyle={[styles.content, { paddingBottom: footerHeight + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#f87916" colors={['#f87916']} />}>
        <View style={[styles.hero, onPeach && peach.hero, stage === 'CANCELLED' && styles.heroCancelled, stage === 'DELIVERED' && styles.heroDelivered]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.heroOrder, onPeach && peach.label]}>ORDER {orderLabel}</Text>
            <View style={[styles.heroIcon, onPeach && peach.icon]}><Ionicons name={heroIconName} size={20} color="#fff" /></View>
          </View>
          <Text style={[styles.eyebrow, onPeach && peach.label]}>{heroEyebrow}</Text>
          <Text style={[styles.time, onPeach && peach.time, onPeach && !isDeliveryOrder && peach.statusTitle, terminal && { fontSize: 28 }]}>{etaTitle}</Text>
          <Text style={[styles.status, onPeach && peach.status]}>{order ? timeInfo.statusText : loadError ? 'Unable to refresh. Pull down to try again.' : 'Waiting for the latest order details.'}</Text>
          {!terminal && stage !== 'SCHEDULED' && !!order && <View style={styles.progress}>
            <View style={styles.progressBars}>
              {steps.map((step, index) => <View key={step.title} style={[styles.progressBar, onPeach && peach.bar, index <= currentStep && (onPeach ? peach.barDone : styles.progressBarDone)]} />)}
            </View>
            <View style={styles.progressLabels}>
              {steps.map((step, index) => <Text key={step.title} numberOfLines={1} style={[styles.progressLabel, onPeach && peach.barLabel, index === currentStep && (onPeach ? peach.barLabelNow : styles.progressLabelNow)]}>{step.short}</Text>)}
            </View>
          </View>}
          {!terminal && !!order && <Text style={[styles.etaNote, onPeach && peach.note]}>{!isDeliveryOrder ? (kind === 'takeaway' ? "We'll let you know the moment it's ready to collect" : 'Your food will be brought to your table') : timeInfo.isLiveEta ? 'Estimate updated from your delivery route' : 'Arrival time may vary with preparation and traffic'}</Text>}
        </View>
        {loadError && !!order && <Text style={styles.errorNote}>Connection interrupted. Showing your last update.</Text>}

        {!isDeliveryOrder && <View style={[styles.card, styles.statusCard]}>
          <Text style={styles.cardTitle}>Order status</Text>
          {steps.map((step, index) => {
            const done = index < currentStep || stage === 'DELIVERED';
            const now = index === currentStep && !terminal;
            return (
              <View key={step.title} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, done && styles.timelineDotDone, now && styles.timelineDotNow]}>
                    <Ionicons name={done ? 'checkmark' : step.icon} size={14} color={done || now ? '#fff' : T.color.faint} />
                  </View>
                  {index < steps.length - 1 && <View style={[styles.timelineLine, done && styles.timelineLineDone]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: index < steps.length - 1 ? 14 : 0 }}>
                  <Text style={[styles.timelineTitle, !done && !now && { color: T.color.faint }]}>{step.title}</Text>
                  {(done || now) && <Text style={styles.stepDetail}>{step.detail}</Text>}
                </View>
              </View>
            );
          })}
        </View>}

        {isDeliveryOrder && <>
        <View style={styles.card}>
          <View style={styles.cardHeading}><Text style={styles.cardTitle}>Delivery route</Text>{isPicked && <View style={styles.routeBadge}><Ionicons name="location-outline" size={12} color="#9a622b" /><Text style={styles.routeBadgeText}>{hasRoadRoute ? 'Road route' : 'Route preview'}</Text></View>}</View>
        <View style={styles.mapCard}>
          {mapMarkers.length > 0 ? (
            <MapView
              ref={attachMap}
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
              onMapLoaded={() => {
                lastFitKeyRef.current = '';
                setMapViewportVersion(previous => previous + 1);
              }}
              initialRegion={{
                latitude: mapMarkers[0].latitude,
                longitude: mapMarkers[0].longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {cafeCoordinates && !showRiderInsteadOfCafe ? (
                <SvgPinMarker coordinate={cafeCoordinates} title="Restaurant" color={T.color.brand} glyph="store" />
              ) : null}

              {riderPinCoordinates && !isTerminalStatus(status) ? (
                <DeliveryPartnerMarker coordinate={riderPinCoordinates} />
              ) : null}

              {deliveryCoordinates ? (
                <SvgPinMarker coordinate={deliveryCoordinates} title="Delivery Address" color={T.color.success} glyph="home" />
              ) : null}

              {routePoints.length >= 2 ? (
                <Polyline
                  coordinates={routePoints}
                  strokeColor={hasRoadRoute || !isPicked ? AppColors.primary : '#9ca3af'}
                  strokeWidth={hasRoadRoute ? 4 : 3}
                  geodesic={!isPicked}
                  lineDashPattern={hasRoadRoute ? undefined : [8, 8]}
                  key={!isPicked ? 'air-route' : hasRoadRoute ? 'road-route' : 'route-preview'}
                />
              ) : null}
            </MapView>
          ) : (
            <View style={styles.mapFallbackWrap}>
              <Ionicons name="map-outline" size={28} color="#6b7280" />
              <Text style={styles.mapFallbackText}>Map unavailable for this order.</Text>
            </View>
          )}
          {mapMarkers.length > 0 && <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Show full delivery route"
            style={styles.recenterButton} onPress={() => { lastFitKeyRef.current = ''; setMapViewportVersion(previous => previous + 1); }}>
            <Ionicons name="locate-outline" size={21} color="#b96420" />
          </TouchableOpacity>}
        </View>
          <View style={styles.mapLegend}>
            <View style={styles.row}><View style={[styles.dot, { backgroundColor: '#ea580c' }]} /><Text style={styles.muted}>{showRiderInsteadOfCafe ? 'Delivery partner' : 'Restaurant'}</Text></View>
            <View style={styles.row}><View style={[styles.dot, { backgroundColor: '#16a34a' }]} /><Text style={styles.muted}>Your address</Text></View>
          </View>
          {!terminal && isPicked && !partnerMarkerCoordinates && <Text style={styles.mapNote}>Showing pickup point — the rider&apos;s pin will move once live GPS updates arrive.</Text>}
          {!isPicked && routePoints.length >= 2 && <Text style={styles.mapNote}>Straight-line distance from the restaurant. The road route appears once your order is picked up.</Text>}
          {isPicked && !hasRoadRoute && routePoints.length >= 2 && <Text style={styles.mapNote}>Dashed line shows the endpoints. Road directions are temporarily unavailable.</Text>}
        </View>

        {!!order?.deliveryAddress && <View style={[styles.card, styles.addressCard]}>
          <View style={styles.smallIcon}><Ionicons name="home-outline" size={21} color="#b96420" /></View>
          <View style={{ flex: 1 }}><Text style={styles.cardTitle}>Delivering to</Text><Text style={styles.address}>{String(order.deliveryAddress)}</Text></View>
        </View>}
        </>}
        {!terminal && <View style={[styles.card, styles.gamesCard]}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Play while you wait</Text>
              <Text style={styles.stepDetail}>Your order keeps updating in the background.</Text>
            </View>
            <View style={styles.smallIcon}><Ionicons name="game-controller-outline" size={18} color={T.color.brand} /></View>
          </View>
          <View style={styles.gamesRow}>
            {WAIT_GAMES.map((game) => (
              <TouchableOpacity key={game.key} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={`Play ${game.title}`} style={styles.gameTile}
                onPress={() => { track('track_order_game_open', { game: game.key }); router.push(game.route as never); }}>
                <View style={styles.gameIcon}><Ionicons name={game.icon} size={22} color={T.color.brand} /></View>
                <Text style={styles.gameTitle} numberOfLines={1}>{game.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>}
        <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" style={styles.helpRow} onPress={handleHelp}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#8b7d72" /><Text style={styles.helpLabel}>Need help with this order?</Text><Ionicons name="chevron-forward" size={17} color="#8b7d72" /></TouchableOpacity>
      </ScrollView>
      <View style={[styles.floatingFooter, { paddingBottom: insets.bottom + 10 }]}
        onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>
        {/* Delivery only: takeaway / dine-in customers are at the restaurant already. */}
        {!terminal && isDeliveryOrder && <View style={[styles.card, styles.contactCard]}>
          <View style={styles.avatar}><Ionicons name={tracking?.partner ? 'person-outline' : 'restaurant-outline'} size={24} color="#646673" /></View>
          <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{contactName}</Text><Text style={styles.stepDetail}>{tracking?.partner ? 'Your delivery partner' : 'Need an update on your order?'}</Text></View>
          <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={contactPhone ? `Call ${contactName}` : 'Get order help'} style={styles.callButton} onPress={contactPhone ? handleCallDeliveryPartner : handleHelp}><Ionicons name={contactPhone ? 'call-outline' : 'help-circle-outline'} size={22} color="#ed7618" /></TouchableOpacity>
        </View>}
        {!bannerLoadFailed && !!TRACK_ORDER_BANNER_AD_UNIT_ID && <View style={styles.adBannerWrap}>
          <Text style={styles.sponsored}>SPONSORED</Text>
          <BannerAd unitId={TRACK_ORDER_BANNER_AD_UNIT_ID} size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }} onAdFailedToLoad={() => setBannerLoadFailed(true)} />
        </View>}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: T.color.canvas },
  content: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  muted: { color: '#8b8490', fontSize: 11 },
  gamesCard: { padding: 16, gap: 14 },
  statusCard: { padding: 16, gap: 14 },
  timelineRow: { flexDirection: 'row', gap: 12 },
  timelineRail: { alignItems: 'center' },
  timelineDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: T.color.inputBg, alignItems: 'center', justifyContent: 'center' },
  timelineDotDone: { backgroundColor: T.color.success },
  timelineDotNow: { backgroundColor: T.color.brand },
  timelineLine: { flex: 1, width: 2, minHeight: 14, backgroundColor: T.color.line, marginVertical: 2 },
  timelineLineDone: { backgroundColor: T.color.success },
  timelineTitle: { fontSize: 13, fontWeight: '700', color: T.color.ink, marginTop: 4 },
  gamesRow: { flexDirection: 'row', gap: 8 },
  gameTile: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: T.radius.md, backgroundColor: '#ffeedf' },
  gameIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.color.surface, alignItems: 'center', justifyContent: 'center' },
  gameTitle: { fontSize: 11, fontWeight: '700', color: T.color.ink },
  smallIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff0df', alignItems: 'center', justifyContent: 'center' },
  // Border + shadow are identical in every state (only colours change): Android leaves a
  // square ghost outline behind when a card's border / elevation are added or removed live,
  // e.g. when an open tracking screen flips to Delivered.
  hero: { backgroundColor: T.color.brand, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: T.color.brand, shadowColor: '#9ca3af', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  heroDelivered: { backgroundColor: T.color.success, borderColor: T.color.success },
  heroCancelled: { backgroundColor: '#57534e', borderColor: '#57534e' },
  heroOrder: { color: '#ffffffcc', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  heroIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ffffff2e', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#ffffffcc', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 4 },
  time: { fontSize: 34, fontWeight: '900', color: '#fff', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { fontSize: 14, fontWeight: '700', color: '#fff', lineHeight: 20, marginTop: 6 },
  progress: { marginTop: 16 },
  progressBars: { flexDirection: 'row', gap: 4 },
  progressBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#ffffff47' },
  progressBarDone: { backgroundColor: '#fff' },
  progressLabels: { flexDirection: 'row', gap: 4, marginTop: 6 },
  progressLabel: { flex: 1, color: '#ffffffa6', fontSize: 10, fontWeight: '600' },
  progressLabelNow: { color: '#fff', fontWeight: '800' },
  etaNote: { marginTop: 12, color: '#ffffffb3', fontSize: 10, lineHeight: 15 },
  errorNote: { color: '#a74635', fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: T.color.surface, borderWidth: 1, borderColor: T.color.line, borderRadius: T.radius.lg, overflow: 'hidden' },
  cardHeading: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: T.color.ink, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  routeBadge: { flexDirection: 'row', gap: 4, alignItems: 'center', padding: 6, backgroundColor: '#fff6ec', borderRadius: 7 },
  routeBadgeText: { color: '#9a622b', fontSize: 10, fontWeight: '600' },
  mapCard: { height: 230, marginHorizontal: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f5f5f5' },
  map: { ...StyleSheet.absoluteFillObject },
  mapFallbackWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  mapFallbackText: { color: '#8b8490', fontSize: 12 },
  recenterButton: { position: 'absolute', top: 10, right: 10, width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  mapNote: { color: '#8b8490', fontSize: 10, lineHeight: 15, paddingHorizontal: 14, paddingBottom: 12 },
  mapLegend: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  stepDetail: { fontSize: 11, lineHeight: 17, color: '#8c8790', marginTop: 4 },
  addressCard: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  address: { color: '#827d85', fontSize: 12, lineHeight: 19, marginTop: 5 },
  contactCard: { marginHorizontal: 16, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#f1f1f4', justifyContent: 'center', alignItems: 'center' },
  callButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: T.color.brandSoft, alignItems: 'center', justifyContent: 'center' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  helpLabel: { color: '#8b7d72', fontSize: 12 },
  floatingFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, gap: 10, backgroundColor: T.color.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.color.line },
  adBannerWrap: { alignItems: 'center', gap: 6 },
  sponsored: { color: '#aaa2a0', fontSize: 8, letterSpacing: 1.2 },
  loadingWrap: { flex: 1, backgroundColor: '#fffbf7', justifyContent: 'center', alignItems: 'center' },
});

export default TrackOrderScreen;

// In-progress hero card: white with a grey border + soft grey shadow, dark text + orange accents.
// Cancelled (grey) and delivered (green) keep the white-on-colour styles above.
const peach = StyleSheet.create({
  hero: { backgroundColor: T.color.surface, borderColor: T.color.line },
  // Takeaway / dine-in show a status word ("Confirmed", "Ready for pickup") instead of minutes.
  statusTitle: { fontSize: 24, color: T.color.success },
  label: { color: '#a8611f' },
  icon: { backgroundColor: T.color.brand },
  time: { color: T.color.brand },
  status: { color: T.color.ink },
  bar: { backgroundColor: T.color.brandBorder },
  barDone: { backgroundColor: T.color.brand },
  barLabel: { color: T.color.muted },
  barLabelNow: { color: T.color.brand, fontWeight: '800' },
  note: { color: T.color.muted },
});
