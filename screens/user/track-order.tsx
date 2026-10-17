import { fetchDrivingRoute } from '@/utils/trackingRoute';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PageHeader from '@/components/common/PageHeader';
import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { getMyOrders, getOrderTracking } from '@/services/orderService';
import { findRestaurantByAnyId } from '@/services/restaurantService';
import { getOrderStage, isOnTheWay, isOrderFinished, orderStatusMessage } from '@/utils/orderStatus';
import { usePolling } from '@/utils/polling';
import { isRateLimited } from '@/utils/apiClient';

const TRACKING_POLL_MS = 10_000;

const getEstimatedTime = (distance: number) => 15 + Math.ceil(distance) * 5;

type Coordinates = { latitude: number; longitude: number };
const TRACK_ORDER_BANNER_AD_UNIT_ID =String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
//  __DEV__
//   ? 'ca-app-pub-2598300953281179/5310825556'
//   : String(process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID || '').trim();
const DELIVERY_PARTNER_MARKER_IMAGE = require('../../assets/images/delivery_partner_marker.png');

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

// Both providers must settle before the next tracking poll; always retain a usable map.
function DeliveryPartnerMarker({ coordinate }: { coordinate: Coordinates }) {
  const marker = useRef<React.ElementRef<typeof Marker> | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [trackingView, setTrackingView] = useState(true);
  useEffect(() => {
    if (!imageReady) return;
    // Android snapshots marker children. Keep tracking until the decoded image has painted.
    setTrackingView(true);
    const timer = setTimeout(() => {
      marker.current?.redraw();
      setTrackingView(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [imageReady, coordinate.latitude, coordinate.longitude]);
  return <Marker ref={marker} coordinate={coordinate} title="Delivery partner" identifier="delivery-partner"
    anchor={{ x: 0.5, y: 1 }} style={{ width: 40, height: 40 }} zIndex={10} tracksViewChanges={trackingView} pinColor="#f87916">
    {!imageFailed && <View collapsable={false} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={DELIVERY_PARTNER_MARKER_IMAGE} style={styles.partnerMarkerImage} resizeMode="contain"
        fadeDuration={0} onLoad={() => setImageReady(true)}
        onError={() => { setImageFailed(true); setImageReady(true); }} />
    </View>}
  </Marker>;
}

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
      const [orders, liveTracking] = await Promise.all([
        getMyOrders(),
        getOrderTracking(String(orderId)).catch((trackingError) => {
          if (!isRateLimited(trackingError)) console.warn('[UserTracking] Failed to load live tracking:', trackingError);
          return null;
        }),
      ]);
      if (liveTracking) setTracking(liveTracking);
      setLoadError(false);
      const match = orders.find((o) => o.id === orderId) || null;
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

  const mapMarkers = useMemo(() => {
    const raw = [partnerCoordinates, cafeCoordinates, deliveryCoordinates];

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
  }, [partnerCoordinates, deliveryCoordinates, cafeCoordinates]);

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

  const routeStartLat = activeStartCoordinates?.latitude;
  const routeStartLng = activeStartCoordinates?.longitude;
  const routeEndLat = deliveryCoordinates?.latitude;
  const routeEndLng = deliveryCoordinates?.longitude;
  useEffect(() => {
    let cancelled = false;
    setLiveEtaMins(null);
    setHasRoadRoute(false);
    if (routeStartLat == null || routeStartLng == null || routeEndLat == null || routeEndLng == null || isTerminalStatus(status)) {
      setRoutePoints([]);
      return;
    }
    const start = { latitude: routeStartLat, longitude: routeStartLng };
    const end = { latitude: routeEndLat, longitude: routeEndLng };
    // Draw endpoints immediately. A dashed line denotes a preview, never a road route.
    setRoutePoints([start, end]);
    void fetchDrivingRoute(start, end).then(route => {
      if (cancelled) return;
      setRoutePoints(route.points);
      setHasRoadRoute(route.distanceMeters > 0 && route.points.length > 2);
      if (isPicked && route.durationSec > 0) setLiveEtaMins(Math.max(1, Math.ceil(route.durationSec / 60)));
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

    const statusText = orderStatusMessage(status);

    return { minsLeft, statusText, isLiveEta: isPicked && liveEtaMins !== null };
  }, [placedAtParam, order?.createdAt, nowMs, estimatedMins, status, isPicked, liveEtaMins]);

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
  const currentStep = stage === 'DELIVERED' ? 3 : isPicked ? 2 : ['ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED'].includes(stage) ? 1 : 0;
  const steps = [
    { title: 'Order received', detail: 'Your order is with the restaurant', icon: 'receipt-outline' },
    { title: 'Preparing your food', detail: stage === 'READY' ? 'Your food is ready for pickup' : stage === 'ASSIGNED' ? 'Delivery partner is heading to the restaurant' : 'Freshly made and packed with care', icon: 'restaurant-outline' },
    { title: 'On the way', detail: 'Your delivery partner is heading to you', icon: 'bicycle-outline' },
    { title: 'Delivered', detail: 'Enjoy your meal!', icon: 'checkmark-circle-outline' },
  ] as const;
  const contactPhone = tracking?.partner?.phone || tracking?.restaurantPhone;
  const contactName = tracking?.partner?.name || 'Restaurant team';
  const orderLabel = order?.displayOrderId || (orderId ? `#${orderId.slice(-6).toUpperCase()}` : '');
  const etaTitle = stage === 'DELIVERED' ? 'Delivered' : stage === 'CANCELLED' ? 'Order cancelled' : stage === 'SCHEDULED' ? 'Scheduled' : !order ? 'Awaiting update' : `${timeInfo.minsLeft} min`;

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
        <View style={styles.orderHeading}>
          <View style={styles.row}><View style={styles.smallIcon}><Ionicons name="receipt-outline" size={17} color="#b96420" /></View><Text style={styles.orderLabel}>ORDER {orderLabel}</Text></View>
          <Text style={styles.muted}>Tracking details</Text>
        </View>
        <View style={styles.etaCard}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>{terminal ? 'ORDER UPDATE' : stage === 'SCHEDULED' ? 'UPCOMING ORDER' : 'ESTIMATED ARRIVAL'}</Text>
              <Text style={[styles.time, terminal && { fontSize: 28 }]}>{etaTitle}</Text>
            </View>
            <View style={styles.etaIcon}><Ionicons name={stage === 'DELIVERED' ? 'checkmark-circle-outline' : stage === 'CANCELLED' ? 'close-circle-outline' : 'fast-food-outline'} size={32} color="#ec7417" /></View>
          </View>
          <View style={styles.etaDivider} />
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: stage === 'CANCELLED' ? '#bc4646' : '#2c9258' }]} />
            <Text style={styles.status}>{order ? timeInfo.statusText : loadError ? 'Unable to refresh. Pull down to try again.' : 'Waiting for the latest order details.'}</Text>
          </View>
          {!terminal && !!order && <Text style={styles.etaNote}>{timeInfo.isLiveEta ? 'Estimate updated from your delivery route' : 'Arrival time may vary with preparation and traffic'}</Text>}
        </View>
        {loadError && !!order && <Text style={styles.errorNote}>Connection interrupted. Showing your last update.</Text>}

        <View style={styles.card}>
          <View style={styles.cardHeading}><Text style={styles.cardTitle}>Delivery route</Text><View style={styles.routeBadge}><Ionicons name="location-outline" size={12} color="#9a622b" /><Text style={styles.routeBadgeText}>{hasRoadRoute ? 'Road route' : 'Route preview'}</Text></View></View>
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
              {cafeCoordinates ? (
                <Marker coordinate={cafeCoordinates} title="Cafe" pinColor="#ea580c" />
              ) : null}

              {partnerMarkerCoordinates && !isTerminalStatus(status) ? (
                <DeliveryPartnerMarker coordinate={partnerMarkerCoordinates} />
              ) : null}

              {deliveryCoordinates ? (
                <Marker coordinate={deliveryCoordinates} title="Delivery Address" pinColor="#16a34a" />
              ) : null}

              {routePoints.length >= 2 ? (
                <Polyline
                  coordinates={routePoints}
                  strokeColor={hasRoadRoute ? AppColors.primary : '#9ca3af'}
                  strokeWidth={4}
                  lineDashPattern={hasRoadRoute ? undefined : [6, 8]}
                  key={hasRoadRoute ? 'road-route' : 'route-preview'}
                />
              ) : null}
            </MapView>
          ) : (
            <View style={styles.mapFallbackWrap}>
              <Ionicons name="map-outline" size={28} color="#6b7280" />
              <Text style={styles.mapFallbackText}>Map unavailable for this order.</Text>
            </View>
          )}
          {mapMarkers.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Show full delivery route"
            style={styles.recenterButton} onPress={() => { lastFitKeyRef.current = ''; setMapViewportVersion(previous => previous + 1); }}>
            <Ionicons name="locate-outline" size={21} color="#b96420" />
          </TouchableOpacity>}
        </View>
          <View style={styles.mapLegend}>
            <View style={styles.row}><View style={[styles.dot, { backgroundColor: '#ea580c' }]} /><Text style={styles.muted}>Restaurant</Text></View>
            <View style={styles.row}><View style={[styles.dot, { backgroundColor: '#16a34a' }]} /><Text style={styles.muted}>Your address</Text></View>
          </View>
          {!terminal && !partnerMarkerCoordinates && <Text style={styles.mapNote}>Delivery partner location will appear when GPS updates are available.</Text>}
          {!hasRoadRoute && routePoints.length >= 2 && <Text style={styles.mapNote}>Dashed line shows the endpoints. Road directions are temporarily unavailable.</Text>}
        </View>

        {!terminal && stage !== 'SCHEDULED' && !!order && <View style={styles.card}>
          <View style={styles.cardHeading}><Text style={styles.cardTitle}>Your order’s journey</Text><Text style={styles.muted}>Step {currentStep + 1} of 4</Text></View>
          <View style={styles.timeline}>
            {steps.map((step, index) => <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepRail}>
                <View style={[styles.stepIcon, index <= currentStep && styles.stepIconActive]}><Ionicons name={index < currentStep ? 'checkmark' : step.icon} size={18} color={index <= currentStep ? '#ed7618' : '#a6a5a5'} /></View>
                {index < steps.length - 1 && <View style={[styles.stepLine, index < currentStep && { backgroundColor: '#f7c59e' }]} />}
              </View>
              <View style={styles.stepCopy}><Text style={[styles.stepTitle, index > currentStep && { color: '#969399' }]}>{step.title}</Text>{index === currentStep && <Text style={styles.stepDetail}>{step.detail}</Text>}</View>
              {index === currentStep && <Text style={styles.nowBadge}>NOW</Text>}
            </View>)}
          </View>
        </View>}

        {!!order?.deliveryAddress && <View style={[styles.card, styles.addressCard]}>
          <View style={styles.smallIcon}><Ionicons name="home-outline" size={21} color="#b96420" /></View>
          <View style={{ flex: 1 }}><Text style={styles.cardTitle}>Delivering to</Text><Text style={styles.address}>{String(order.deliveryAddress)}</Text></View>
        </View>}
        <TouchableOpacity accessibilityRole="button" style={styles.helpRow} onPress={handleHelp}><Ionicons name="chatbubble-ellipses-outline" size={18} color="#8b7d72" /><Text style={styles.helpLabel}>Need help with this order?</Text><Ionicons name="chevron-forward" size={17} color="#8b7d72" /></TouchableOpacity>
      </ScrollView>
      <View style={[styles.floatingFooter, { paddingBottom: Math.max(insets.bottom, 10) }]}
        onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>
        {!terminal && <View style={[styles.card, styles.contactCard]}>
          <View style={styles.avatar}><Ionicons name={tracking?.partner ? 'person-outline' : 'restaurant-outline'} size={24} color="#646673" /></View>
          <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{contactName}</Text><Text style={styles.stepDetail}>{tracking?.partner ? 'Your delivery partner' : 'Need an update on your order?'}</Text></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={contactPhone ? `Call ${contactName}` : 'Get order help'} style={styles.callButton} onPress={contactPhone ? handleCallDeliveryPartner : handleHelp}><Ionicons name={contactPhone ? 'call-outline' : 'help-circle-outline'} size={22} color="#ed7618" /></TouchableOpacity>
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
  page: { flex: 1, backgroundColor: '#fffbf7' },
  content: { padding: 18, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  orderHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderLabel: { color: '#71665d', fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  muted: { color: '#8b8490', fontSize: 11 },
  smallIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#fff0df', alignItems: 'center', justifyContent: 'center' },
  etaCard: { backgroundColor: '#fff0df', borderRadius: 22, padding: 20, borderWidth: 1, borderColor: '#f9ddbd' },
  eyebrow: { color: '#a2602f', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  time: { fontSize: 40, fontWeight: '800', color: '#282c38', marginTop: 6 },
  etaIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: '#ffe0bb', alignItems: 'center', justifyContent: 'center' },
  etaDivider: { height: 1, backgroundColor: '#f3d8bc', marginVertical: 16 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { flex: 1, fontSize: 13, fontWeight: '600', color: '#494039', lineHeight: 20 },
  etaNote: { marginTop: 8, marginLeft: 15, color: '#9a7f68', fontSize: 10, lineHeight: 15 },
  errorNote: { color: '#a74635', fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee6df', borderRadius: 18, overflow: 'hidden' },
  cardHeading: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: '#2d313c', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  routeBadge: { flexDirection: 'row', gap: 4, alignItems: 'center', padding: 6, backgroundColor: '#fff6ec', borderRadius: 7 },
  routeBadgeText: { color: '#9a622b', fontSize: 10, fontWeight: '600' },
  mapCard: { height: 230, marginHorizontal: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f5f5f5' },
  map: { ...StyleSheet.absoluteFillObject },
  mapFallbackWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  mapFallbackText: { color: '#8b8490', fontSize: 12 },
  recenterButton: { position: 'absolute', top: 10, right: 10, width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  mapNote: { color: '#8b8490', fontSize: 10, lineHeight: 15, paddingHorizontal: 14, paddingBottom: 12 },
  mapLegend: { flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  partnerMarkerImage: { width: 36, height: 36 },
  timeline: { paddingHorizontal: 16, paddingBottom: 4 },
  stepRow: { flexDirection: 'row', gap: 12, minHeight: 56 },
  stepRail: { alignItems: 'center', width: 34 },
  stepIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#f4f4f5', alignItems: 'center', justifyContent: 'center' },
  stepIconActive: { backgroundColor: '#fff0df' },
  stepLine: { width: 2, flex: 1, minHeight: 14, backgroundColor: '#efedef', marginVertical: 3 },
  stepCopy: { flex: 1, paddingTop: 7, paddingBottom: 14 },
  stepTitle: { color: '#353945', fontSize: 13, fontWeight: '600' },
  stepDetail: { fontSize: 11, lineHeight: 17, color: '#8c8790', marginTop: 4 },
  nowBadge: { alignSelf: 'flex-start', marginTop: 8, fontSize: 9, fontWeight: '700', letterSpacing: 0.7, color: '#cf681b', backgroundColor: '#fff1e4', padding: 4, borderRadius: 4 },
  addressCard: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  address: { color: '#827d85', fontSize: 12, lineHeight: 19, marginTop: 5 },
  contactCard: { marginHorizontal: 16, shadowColor: '#50301a', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: -2 }, elevation: 3, flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#f1f1f4', justifyContent: 'center', alignItems: 'center' },
  callButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff0df', alignItems: 'center', justifyContent: 'center' },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  helpLabel: { color: '#8b7d72', fontSize: 12 },
  floatingFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, gap: 12, backgroundColor: '#fffbf7', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee6df' },
  adBannerWrap: { alignItems: 'center', gap: 6 },
  sponsored: { color: '#aaa2a0', fontSize: 8, letterSpacing: 1.2 },
  loadingWrap: { flex: 1, backgroundColor: '#fffbf7', justifyContent: 'center', alignItems: 'center' },
});

export default TrackOrderScreen;
