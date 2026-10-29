import HomeHeader from '@/components/HomeHeader';
import NoRestaurantsHere from '@/components/NoRestaurantsHere';
import { useCityName } from '@/hooks/useCityName';
import AppImage from '@/components/AppImage';
import { RestaurantCard, RestaurantMiniCard } from '@/components/RestaurantCard';
import { OfferCard } from '@/components/OfferCard';
import AnnouncementBottomSheet from '@/components/AnnouncementBottomSheet';
import { appUpdateService, AndroidAppUpdateConfig } from '@/services/appUpdateService';
import { AnnouncementConfig, subscribeToAnnouncement } from '@/services/appConfigService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { getRestaurants, searchRestaurantsAndMenuItems, matchesRestaurantFoodFilter, RestaurantFoodFilter, RestaurantRecord, SearchResults, EMPTY_SEARCH_RESULTS } from '@/services/restaurantService';
import FoodTypeMark from '@/components/common/FoodTypeMark';
import type { FoodType } from '@/types/Product';
import { setActiveRestaurant } from '@/services/restaurantContext';
import { getMyOrders } from '@/services/orderService';
import { getOffersNearYou, OfferRecord } from '@/services/offersService';
import { Coordinates } from '@/utils/locationUtils';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Text, View, Animated, BackHandler, Easing, FlatList, Linking, Modal, Platform, Pressable, ScrollView, ToastAndroid, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { notificationService } from '../services/notificationService';
import { userService } from '../services/userService';
import { AppDispatch, RootState } from '../store';
import { setUser } from '../store/slices/authSlice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';
import { isOrderActive, orderProgress, orderStatusLabel, orderStatusMessage } from '@/utils/orderStatus';
import { OrderType } from '@/types/enums';
import { usePolling } from '@/utils/polling';
import { isRateLimited } from '@/utils/apiClient';


const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';
const ANDROID_UPDATE_DISMISSED_VERSION_KEY = 'android_update_dismissed_version';
const ANDROID_UPDATE_DISMISSED_CONTEXT_KEY = 'android_update_dismissed_context';
// How long to wait after Home gains focus before revealing the announcement sheet.
const ANNOUNCEMENT_REVEAL_DELAY_MS = 3000;
// Polling cadence — see utils/polling.ts (paused off-screen / in background / during a 429).
const ACTIVE_ORDER_POLL_MS = 20_000;
const IDLE_ORDER_POLL_MS = 90_000;
const PROFILE_REFRESH_MS = 120_000;
const LISTS_FRESH_MS = 60_000;

const FALLBACK_HOME_CATEGORIES = [
  { id: '0', label: 'All', icon: 'grid-outline' },
  { id: 'pizza', label: 'Pizza', icon: 'pizza-outline' },
  { id: 'biryani', label: 'Biryani', icon: 'restaurant-outline' },
  { id: 'chinese', label: 'Chinese', icon: 'restaurant-outline' },
  { id: 'burger', label: 'Burgers', icon: 'fast-food-outline' },
  { id: 'north-indian', label: 'North Indian', icon: 'restaurant-outline' },
  { id: 'snacks', label: 'Snacks', icon: 'fast-food-outline' },
  { id: 'beverages', label: 'Beverages', icon: 'cafe-outline' },
];

const RESTAURANT_FOOD_FILTERS: Array<{ id: RestaurantFoodFilter; label: string; mark?: FoodType }> = [
  { id: 'ALL', label: 'All' },
  { id: 'PURE_VEG', label: 'Pure Veg', mark: 'VEG' },
  { id: 'NON_VEG', label: 'Non-Veg', mark: 'NON_VEG' },
];

type Restaurant = {
  id: string;
  restaurantId?: string;
  cafeId?: string;
  name?: string;
  cuisine?: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  image?: string;
  coverImage?: string;
  desc?: string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
  };
  coordinates?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
  };
  tags?: string[];
  offer?: string;
  isSponsored?: boolean;
  isNew?: boolean;
  eta?: { min: number; max: number; exceedsMax: boolean };
};

type RestaurantWithRating = Restaurant & {
  rating: number;
  ratingCount: number;
};

const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

const getRestaurantKeys = (restaurant: Restaurant) => {
  const keys = [restaurant.id, restaurant.restaurantId, restaurant.cafeId]
    .map((value) => normalizeKey(value))
    .filter(Boolean);
  return new Set(keys);
};

const getOrderCreatedAtMs = (order: any) => {
  const value = order?.createdAt;
  if (value && typeof value.toMillis === 'function') return Number(value.toMillis());
  if (value && typeof value.toDate === 'function') return Number(value.toDate().getTime());
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

type ActiveOrderBannerItem = {
  orderId: string;
  cafeName: string;
  logoUrl: string | null;
  orderNumber: string;
  rawStatus: string;
  statusLabel: string;
  message: string;
  progress: number;
  itemCount: number;
  total: number;
  /** Still to pay (e.g. cash on delivery after a part-wallet payment); 0 once paid. */
  amountDue: number;
  isDelivery: boolean;
};

const orderKindOf = (orderType: unknown): 'delivery' | 'takeaway' | 'dinein' =>
  String(orderType) === OrderType.TAKE_AWAY ? 'takeaway' : String(orderType) === OrderType.DINE_IN ? 'dinein' : 'delivery';

type HomeCategoryItem = {
  id: string;
  label: string;
  icon: string;
};

const resolveCategoryIcon = (rawIcon: unknown, rawLabel: unknown): string => {
  const iconText = String(rawIcon || '').trim().toLowerCase();
  const labelText = String(rawLabel || '').trim().toLowerCase();
  const text = `${iconText} ${labelText}`;

  if (text.includes('pizza')) return 'pizza-outline';
  if (text.includes('burger') || text.includes('sandwich')) return 'fast-food-outline';
  if (text.includes('coffee') || text.includes('tea') || text.includes('cafe') || text.includes('beverage') || text.includes('drink')) return 'cafe-outline';
  if (text.includes('ice') || text.includes('dessert') || text.includes('sweet')) return 'ice-cream-outline';
  if (text.includes('all')) return 'grid-outline';
  return 'restaurant-outline';
};

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeOrderCardWidth = Math.max(320, width);
  const authUser = useSelector((state: RootState) => state.auth.user);
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const dispatch = useDispatch<AppDispatch>();
  const [restaurants, setRestaurants] = useState<RestaurantWithRating[]>([]);
  const restaurantsRef = useRef<RestaurantWithRating[]>([]);
  useEffect(() => {
    restaurantsRef.current = restaurants;
  }, [restaurants]);
  // "New" and "Recommended" home carousels (Features 10/11) — purely derived from the
  // ranking engine's already-computed isNew/isSponsored flags on the same ranked list, so a
  // restaurant leaves either section automatically the moment the backend stops flagging it,
  // never a separately-tracked classification on the client.
  // Veg / non-veg preference — applies to every restaurant discovery list on Home (not
  // Order Again, which is the customer's own history). Defaults to All.
  const [foodFilter, setFoodFilter] = useState<RestaurantFoodFilter>('ALL');
  const foodFilteredRestaurants = useMemo(
    () => restaurants.filter((r) => matchesRestaurantFoodFilter(r, foodFilter)),
    [restaurants, foodFilter]
  );
  const newRestaurants = useMemo(() => foodFilteredRestaurants.filter((r) => r.isNew), [foodFilteredRestaurants]);
  const sponsoredRestaurants = useMemo(() => foodFilteredRestaurants.filter((r) => r.isSponsored), [foodFilteredRestaurants]);
  const [homeCategories, setHomeCategories] = useState<HomeCategoryItem[]>(FALLBACK_HOME_CATEGORIES);

  // "All" (id '0') shows everything; any other chip filters the main Restaurants list
  // below by matching its label against each restaurant's own cuisine/food-type tags.
  const [showFilters, setShowFilters] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const filteredRestaurants = foodFilteredRestaurants;
  const selectedLatitude = useSelector((state: RootState) => state.location.latitude);
  const selectedLongitude = useSelector((state: RootState) => state.location.longitude);
  const cityName = useCityName(selectedLatitude, selectedLongitude);
  const deviceCoords = useMemo<Coordinates | null>(() => (
    selectedLatitude != null && selectedLongitude != null
      && Number.isFinite(selectedLatitude) && Number.isFinite(selectedLongitude)
      ? { latitude: selectedLatitude, longitude: selectedLongitude } : null
  ), [selectedLatitude, selectedLongitude]);
  const restaurantRequestId = useRef(0);
  const offerRequestId = useRef(0);

  // "Order Again" (returning-user only) — every branch this account has actually ordered
  // from before, most-recent first, matched back to the SAME `restaurants` list already
  // loaded above (never a second restaurant shape/API) so a branch that's gone
  // inactive/deleted since the order was placed is simply skipped rather than shown stale.
  const [recentOrderBranchIds, setRecentOrderBranchIds] = useState<string[]>([]);
  const orderAgainRestaurants = useMemo(() => {
    if (recentOrderBranchIds.length === 0) return [];
    const byId = new Map(restaurants.map((r) => [String(r.id || r.restaurantId || r.cafeId || ''), r]));
    const seen = new Set<string>();
    const result: RestaurantWithRating[] = [];
    for (const branchId of recentOrderBranchIds) {
      if (seen.has(branchId)) continue;
      const match = byId.get(branchId);
      if (!match) continue;
      seen.add(branchId);
      result.push(match);
      if (result.length >= 8) break;
    }
    return result;
  }, [recentOrderBranchIds, restaurants]);

  // "Offers Near You" — real coupons attached to real nearby branches (see
  // services/offersService.ts / backend's publicOrderingService.getOffersNearYou).
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);

  // Platform-wide search (restaurants, cuisines, menu categories, dishes) — debounced so
  // every keystroke doesn't fire a request; the search itself lives on the backend
  // (publicOrderingService.search). Results are grouped by type, with a tab row to narrow
  // to one group.
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults>(EMPTY_SEARCH_RESULTS);
  const [searchTab, setSearchTab] = useState<SearchTab>('all');
  const searchRequestIdRef = useRef(0);

  const handleSearchChange = useCallback((text: string) => setSearchQuery(text), []);

  useEffect(() => {
    const requestId = ++searchRequestIdRef.current;
    const trimmed = searchQuery.trim();
    setSearchResults(EMPTY_SEARCH_RESULTS);
    setSearchTab('all');
    setSearching(Boolean(trimmed));
    if (!trimmed) return;
    const timer = setTimeout(async () => {
      try {
        const results = await searchRestaurantsAndMenuItems(trimmed, deviceCoords);
        if (requestId === searchRequestIdRef.current) setSearchResults(results);
      } catch (error) {
        console.warn('[home] search failed:', error);
      } finally {
        if (requestId === searchRequestIdRef.current) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      searchRequestIdRef.current += 1;
    };
  }, [searchQuery, deviceCoords]);

  // Fetch and store user location on app open
  useEffect(() => {
    (async () => {
      const cachedOrFreshLocation = await warmupUserLocationCache({ dispatch });
      if (cachedOrFreshLocation) {
        // Resolve human-readable address once on home bootstrap and reuse across app.
        void hydrateCachedLocationAddress({ dispatch });
      }
    })();
  }, [dispatch]);
  const [activeOrderBanners, setActiveOrderBanners] = useState<ActiveOrderBannerItem[]>([]);
  const [activeOrderIndex, setActiveOrderIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const shimmerOpacity = useRef(new Animated.Value(0.45)).current;
  const [androidUpdateConfig, setAndroidUpdateConfig] = useState<AndroidAppUpdateConfig | null>(null);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [announcementConfig, setAnnouncementConfig] = useState<AnnouncementConfig | null>(null);
  const [isAnnouncementVisible, setIsAnnouncementVisible] = useState(false);
  const activeOrdersListRef = useRef<FlatList<ActiveOrderBannerItem> | null>(null);

  useEffect(() => {
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerOpacity, {
          toValue: 0.95,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerOpacity, {
          toValue: 0.45,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    shimmerLoop.start();
    return () => shimmerLoop.stop();
  }, [shimmerOpacity]);

  const totalCartCount = cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const isAndroid = Platform.OS === 'android';
  const nativeAppVersion = String((Constants as any).nativeAppVersion || '').trim();
  const expoConfigVersion = String(Constants.expoConfig?.version || '').trim();
  const appVersion = nativeAppVersion || expoConfigVersion;

  const compareVersions = (a: string, b: string): number => {
    const normalize = (version: string) => version.split('.').map((part) => Number(part) || 0);
    const aParts = normalize(a);
    const bParts = normalize(b);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i += 1) {
      const aNum = aParts[i] ?? 0;
      const bNum = bParts[i] ?? 0;
      if (aNum > bNum) return 1;
      if (aNum < bNum) return -1;
    }
    return 0;
  };

  const toBoolean = (value: unknown) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    if (typeof value === 'number') return value === 1;
    return false;
  };

  // Profile sync (earnedCoin/wallet, etc): no real-time listener exists on the new backend
  // yet (see userService.ts) — polled on mount/focus/interval instead of a live Firestore
  // `onSnapshot`, which is a close-enough approximation for a balance that only ever
  // changes from the customer's own actions (an order they just placed, a profile edit).
  // Only while Home is on screen and the app is in the foreground — the balance only ever
  // changes from the customer's own actions, so every 2 minutes is plenty.
  usePolling(
    async () => {
      if (!authUser?.uid) return;
      try {
        const latest = await userService.getUserProfile(authUser.uid, authUser.email);
        if (latest) dispatch(setUser({ ...authUser, ...latest }));
      } catch (error) {
        if (!isRateLimited(error)) console.warn('Failed to refresh profile:', error);
      }
    },
    PROFILE_REFRESH_MS,
    Boolean(authUser?.uid)
  );

  useEffect(() => {
    if (!authUser?.uid) return;
    // Update FCM token on app start/login
    (async () => {
      const push = await notificationService.registerForPushNotificationsAsync();
      if (push?.token && push?.tokenType && authUser?.uid) {
        await userService.updateUserProfile(authUser.uid, {
          pushToken: push.token,
          pushTokenType: push.tokenType,
          pushTokenUpdatedAt: new Date().toISOString(),
        });
      }
    })();
  }, [authUser?.uid]);

  // Real-time announcement config — data is kept in state independently of
  // when the bottom sheet is actually revealed (see the focus-effect timer
  // below, which just gates *when* to show whatever is currently known).
  useEffect(() => {
    // Home shows the featured/first restaurant's own announcement banner — this app is a
    // cross-organization marketplace now, so there's no single fixed restaurant to poll
    // without first saying which one (see services/restaurantContext.ts). Reads
    // `restaurants` directly rather than the later-declared `primaryRestaurant` const.
    const featured = restaurants[0] || null;
    if (!featured) return;
    setActiveRestaurant(featured);

    const unsubscribe = subscribeToAnnouncement((config) => {
      setAnnouncementConfig(config);
    });

    return () => unsubscribe();
  }, [restaurants]);

  useEffect(() => {
    if (!isAndroid) return;

    const loadUpdateConfig = async () => {
      const config = await appUpdateService.getAndroidUpdateConfig();
      if (!config) return;

      setAndroidUpdateConfig(config);
      const currentVersion = appVersion || '';
      const latestVersion = String(config.latestVersion || '').trim();
      const minRequiredVersion = String(config.minRequiredVersion || '').trim();
      const forceUpdateFlag = toBoolean(config.forceUpdate);
      const offeredVersion = latestVersion || minRequiredVersion;

      const latestVsCurrent = latestVersion && currentVersion ? compareVersions(latestVersion, currentVersion) : 0;
      const minRequiredVsCurrent = minRequiredVersion && currentVersion ? compareVersions(minRequiredVersion, currentVersion) : 0;

      const hasNewVersion = latestVsCurrent === 1;
      const hasForceVersion = minRequiredVsCurrent === 1;
      const requiresForceUpdate = hasForceVersion || (forceUpdateFlag && hasNewVersion);

      if (!hasNewVersion && !requiresForceUpdate) {
        setIsUpdateModalVisible(false);
        return;
      }

      if (offeredVersion) {
        const dismissedContextRaw = await AsyncStorage.getItem(ANDROID_UPDATE_DISMISSED_CONTEXT_KEY);
        if (dismissedContextRaw) {
          try {
            const dismissedContext = JSON.parse(dismissedContextRaw) as {
              offeredVersion?: string;
              baseVersion?: string;
            };
            const dismissedOfferedVersion = String(dismissedContext?.offeredVersion || '').trim();
            const dismissedBaseVersion = String(dismissedContext?.baseVersion || '').trim();

            // Only suppress if user dismissed this exact update from this exact app version.
            if (
              dismissedOfferedVersion === offeredVersion
              && dismissedBaseVersion === currentVersion
            ) {
              setIsUpdateModalVisible(false);
              return;
            }
          } catch {
            // Ignore malformed persisted context and continue update flow.
          }
        }
      }

      setIsUpdateModalVisible(true);
    };

    loadUpdateConfig();
  }, [appVersion, expoConfigVersion, isAndroid, nativeAppVersion]);

  const loadRestaurants = useCallback(async () => {
    const requestId = ++restaurantRequestId.current;
    setRestaurants([]);
    if (!authUser?.uid && !authUser?.email) {
      setRestaurants([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Ratings come from the directory itself: the average of every dish rating each
      // restaurant has received (see restaurantService.mapDirectoryRestaurant).
      //
      // Deliberately NOT re-sorted here — the backend's ranking engine
      // (restaurantRanking.service.ts) already returns these in final ranked order
      // (organic score + sponsored/new-restaurant boosts + fairness rotation); an
      // alphabetical/displayOrder re-sort on top would silently discard all of that.
      const list = (await getRestaurants(deviceCoords)).filter((restaurantDoc: any) => restaurantDoc.available !== false);

      const withRatings = list.map((restaurant) => ({ ...restaurant, rating: Number(restaurant.rating || 0), ratingCount: Number(restaurant.ratingCount || 0) } as RestaurantWithRating));

      if (requestId === restaurantRequestId.current) setRestaurants(withRatings);
    } catch (error) {
      console.error('Failed to load restaurants:', error);
    } finally {
      if (requestId === restaurantRequestId.current) setLoading(false);
    }
  }, [authUser?.uid, authUser?.email, deviceCoords]);

  const loadOffers = useCallback(async () => {
    const requestId = ++offerRequestId.current;
    setOffers([]);
    try {
      setOffersLoading(true);
      const nearby = await getOffersNearYou(deviceCoords);
      if (requestId === offerRequestId.current) setOffers(nearby);
    } catch (error) {
      console.warn('Failed to load Offers Near You.', error);
      if (requestId === offerRequestId.current) setOffers([]);
    } finally {
      if (requestId === offerRequestId.current) setOffersLoading(false);
    }
  }, [deviceCoords]);

  // Switching tabs back to Home re-runs these; skip it when the same lists (same account,
  // same location) were loaded under a minute ago instead of re-fetching on every tab tap.
  const listsLoadedRef = useRef<{ key: string; at: number } | null>(null);
  const listsKey = `${authUser?.uid || authUser?.email || ''}|${deviceCoords?.latitude ?? ''},${deviceCoords?.longitude ?? ''}`;
  const listsAreFresh = () => {
    const last = listsLoadedRef.current;
    return Boolean(last && last.key === listsKey && Date.now() - last.at < LISTS_FRESH_MS);
  };

  useFocusEffect(
    useCallback(() => {
      if (listsAreFresh()) return;
      listsLoadedRef.current = { key: listsKey, at: Date.now() };
      void loadRestaurants();
      void loadOffers();
      return () => {
        restaurantRequestId.current += 1;
        offerRequestId.current += 1;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadRestaurants, loadOffers, listsKey])
  );

  // Home is the root of the tab stack — hardware back here has nowhere to
  // pop to, so require a second press within 2s before exiting the app.
  const lastBackPressAtRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        const now = Date.now();
        if (now - lastBackPressAtRef.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastBackPressAtRef.current = now;
        if (Platform.OS === 'android') {
          ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
        }
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [])
  );

  // Announcement bottom sheet: shown at most once per Home-focus-entry, 2s
  // after focus, and only when the announcement is currently active with
  // both a title and description. AppStatusProvider already fully replaces
  // the tree (Home unmounts/unfocuses) whenever app status isn't 'active',
  // so this focus effect is naturally unreachable during a block — no extra
  // status check is needed here.
  const announcementConfigRef = useRef<AnnouncementConfig | null>(null);
  useEffect(() => {
    announcementConfigRef.current = announcementConfig;
  }, [announcementConfig]);

  const shownAnnouncementForThisFocusRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      shownAnnouncementForThisFocusRef.current = false;

      const timer = setTimeout(() => {
        if (shownAnnouncementForThisFocusRef.current) return;

        const config = announcementConfigRef.current;
        const hasValidCopy = Boolean(config?.title?.trim()) && Boolean(config?.description?.trim());
        if (config && config.status === 'active' && hasValidCopy) {
          shownAnnouncementForThisFocusRef.current = true;
          setIsAnnouncementVisible(true);
        }
      }, ANNOUNCEMENT_REVEAL_DELAY_MS);

      return () => clearTimeout(timer);
    }, [])
  );

  const resolveCafeName = (order: any) => {
    const direct = String(order?.restaurant?.name || order?.cafeName || order?.restaurantName || '').trim();
    if (direct) return direct;

    const orderKey = normalizeKey(order?.cafeId || order?.restaurantId);
    if (!orderKey) return 'Cafe';

    const matchedRestaurant = restaurantsRef.current.find((restaurant) => getRestaurantKeys(restaurant).has(orderKey));
    return matchedRestaurant?.name || 'Cafe';
  };

  // One "my orders" poll feeds BOTH the active-order banner and "Order Again" (it used to
  // be two separate fetches of the same list). No real-time order-status push exists on the
  // backend yet, so this polls — quickly only while an order is actually in progress.
  const hasActiveOrdersRef = useRef(false);
  const applyMyOrders = (orders: any[]) => {
    const activeOrders = orders
      // Reservations for a later slot aren't "running" yet.
      .filter((order) => !order?.isScheduledOrder && isOrderActive(order?.status))
      .sort((a, b) => getOrderCreatedAtMs(b) - getOrderCreatedAtMs(a));
    hasActiveOrdersRef.current = activeOrders.length > 0;

    setActiveOrderBanners(
      activeOrders
        .map((order): ActiveOrderBannerItem => {
          const kind = orderKindOf(order?.orderType);
          return {
            orderId: String(order.id || ''),
            cafeName: resolveCafeName(order),
            logoUrl: order?.restaurant?.logoUrl || null,
            orderNumber: String(order?.displayOrderId || ''),
            rawStatus: String(order?.status || ''),
            statusLabel: orderStatusLabel(order?.status, kind),
            message: orderStatusMessage(order?.status, kind),
            progress: orderProgress(order?.status),
            itemCount: (order?.items || []).reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0),
            total: Number(order?.total || 0),
            amountDue: Number(order?.amountDue || 0),
            isDelivery: kind === 'delivery',
          };
        })
        .filter((item) => Boolean(item.orderId))
    );

    // "Order Again": every branch this account has ordered from (cancelled/rejected-only
    // history doesn't count), most recent first.
    const branchIds: string[] = [];
    const seen = new Set<string>();
    orders
      .filter((order) => !['cancelled', 'rejected'].includes(String(order.status || '').toLowerCase()))
      .sort((a, b) => getOrderCreatedAtMs(b) - getOrderCreatedAtMs(a))
      .forEach((order) => {
        const branchId = String(order.restaurantId || order.cafeId || '').trim();
        if (!branchId || seen.has(branchId)) return;
        seen.add(branchId);
        branchIds.push(branchId);
      });
    setRecentOrderBranchIds(branchIds);
  };

  usePolling(
    async () => {
      if (!authUser?.uid) return;
      try {
        applyMyOrders(await getMyOrders());
      } catch (error) {
        if (!isRateLimited(error)) console.error('Order status poll failed:', error);
      }
    },
    () => (hasActiveOrdersRef.current ? ACTIVE_ORDER_POLL_MS : IDLE_ORDER_POLL_MS),
    Boolean(authUser?.uid)
  );

  useEffect(() => {
    if (!authUser?.uid) {
      hasActiveOrdersRef.current = false;
      setActiveOrderBanners([]);
      setRecentOrderBranchIds([]);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    if (activeOrderBanners.length <= 1) {
      setActiveOrderIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setActiveOrderIndex((prev) => {
        const next = (prev + 1) % activeOrderBanners.length;
        activeOrdersListRef.current?.scrollToOffset({
          offset: next * activeOrderCardWidth,
          animated: true,
        });
        return next;
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [activeOrderBanners.length, activeOrderCardWidth]);

  const handleOpenRestaurant = (restaurant: RestaurantWithRating, categoryId?: string) => {
    router.push({
      pathname: '/user/restaurant-details',
      params: {
        restaurant: JSON.stringify(restaurant),
        categoryId: categoryId || '0',
      },
    });
  };

  // Delivery orders open live tracking; takeaway/dine-in open the order's details.
  const handleTrackActiveOrder = useCallback((item: ActiveOrderBannerItem) => {
    if (!item.orderId) return;
    if (!item.isDelivery) {
      router.push(`/order/${item.orderId}` as never);
      return;
    }
    router.push({ pathname: '/user/track-order', params: { orderId: item.orderId, status: item.rawStatus } });
  }, []);


  const primaryRestaurant = restaurants[0] || null;
  const shimmerAnimatedStyle = { opacity: shimmerOpacity };

  const openCafeDetails = useCallback((restaurantItem: RestaurantWithRating) => {
    router.push({
      pathname: '/user/cafe-details',
      params: {
        restaurant: JSON.stringify(restaurantItem),
      },
    });
  }, []);

  // Offer → Restaurant Details (with the offer shown prominently), never straight to a
  // generic coupon screen and never just a copy-the-code action — matches the restaurant
  // this offer's own branch already loaded in `restaurants` when one exists (so the details
  // screen gets the exact same shape/data as every other entry point), falling back to a
  // minimal record built from the offer row itself when this branch isn't in the currently
  // loaded directory page.
  const handleOfferPress = useCallback((offer: OfferRecord) => {
    const matched = restaurants.find((r) => String(r.id || r.restaurantId || r.cafeId || '') === offer.branchId);
    const restaurantForDetails = matched || {
      id: offer.branchId,
      restaurantId: offer.branchId,
      cafeId: offer.branchId,
      orgSlug: offer.orgSlug,
      branchCode: offer.branchCode,
      name: offer.restaurantName,
      image: offer.restaurantImage || undefined,
      coverImage: offer.restaurantImage || undefined,
      eta: offer.deliveryTime,
      distanceKm: offer.distanceKm,
    };
    router.push({
      pathname: '/user/cafe-details',
      params: {
        restaurant: JSON.stringify(restaurantForDetails),
        offer: JSON.stringify(offer),
      },
    });
  }, [restaurants]);

  // A craving chip runs the same platform-wide search as typing it into the search box
  // (restaurants, cuisines, menu categories and dishes); "All" clears the search.
  const isCravingSelected = (category: HomeCategoryItem) => {
    const query = searchQuery.trim().toLowerCase();
    return category.id === '0' ? !query : query === String(category.label || '').trim().toLowerCase();
  };
  const handleCravingPress = (category: HomeCategoryItem) => {
    setSearchQuery(category.id === '0' ? '' : String(category.label || '').trim());
    setShowFilters(false);
  };

  return (
    <Container style={{ paddingTop: insets.top }}>
      <HomeHeader />

      <Modal
        visible={isUpdateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setIsUpdateModalVisible(false);
        }}
      >
        <ModalOverlay>
          <ModalCard>
            <ModalTitle>{androidUpdateConfig?.title || 'App Update Available'}</ModalTitle>
            <ModalMessage>
              {androidUpdateConfig?.message || 'A new version of the app is available. Please update to continue using the app smoothly.'}
            </ModalMessage>
            <ModalActions>
              <ModalButton
                onPress={async () => {
                  const offeredVersion = String(androidUpdateConfig?.latestVersion || androidUpdateConfig?.minRequiredVersion || '').trim();
                  if (offeredVersion) {
                    await AsyncStorage.setItem(ANDROID_UPDATE_DISMISSED_VERSION_KEY, offeredVersion);
                    await AsyncStorage.setItem(
                      ANDROID_UPDATE_DISMISSED_CONTEXT_KEY,
                      JSON.stringify({
                        offeredVersion,
                        baseVersion: appVersion || '',
                        dismissedAt: Date.now(),
                      })
                    );
                  }
                  setIsUpdateModalVisible(false);
                }}
                style={{ backgroundColor: '#f0f0f0' }}
              >
                <ModalButtonText style={{ color: '#333' }}>Later</ModalButtonText>
              </ModalButton>
              <ModalButton
                onPress={() => {
                  const url = androidUpdateConfig?.storeUrl || 'https://play.google.com/store/apps/details?id=com.alok0308.praygagifoodwala';
                  Linking.openURL(url).catch((error) => {
                    console.warn('Failed to open update URL', error);
                  });
                  setIsUpdateModalVisible(false);
                }}
                style={{ backgroundColor: '#FF9800' }}
              >
                <ModalButtonText>Update Now</ModalButtonText>
              </ModalButton>
            </ModalActions>
          </ModalCard>
        </ModalOverlay>
      </Modal>

      <Modal visible={expandedSection !== null} animationType="slide" onRequestClose={() => setExpandedSection(null)}>
        <View style={{ flex: 1, paddingTop: insets.top + 16, backgroundColor: '#fffbf7', paddingHorizontal: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <SectionHeading>{expandedSection}</SectionHeading>
            <Pressable accessibilityRole="button" accessibilityLabel="Close section" onPress={() => setExpandedSection(null)} style={{ padding: 10 }}><Ionicons name="close" size={24} color="#333" /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}>
            {expandedSection === 'Offers Near You' ? offers.map(offer => <OfferCard key={offer.offerId} offer={offer} fullWidth onPress={() => { setExpandedSection(null); handleOfferPress(offer); }} />) : (expandedSection === 'Order Again' ? orderAgainRestaurants : expandedSection === 'Recommended for You' ? sponsoredRestaurants : newRestaurants).map(restaurant => <RestaurantCard key={restaurant.id} restaurant={restaurant} onViewMenu={() => { setExpandedSection(null); handleOpenRestaurant(restaurant); }} onViewDetails={() => { setExpandedSection(null); openCafeDetails(restaurant); }} />)}
          </ScrollView>
        </View>
      </Modal>

      <AnnouncementBottomSheet
        visible={isAnnouncementVisible}
        title={announcementConfig?.title || ''}
        description={announcementConfig?.description || ''}
        imageUrl={announcementConfig?.imageUrl ?? null}
        onClose={() => setIsAnnouncementVisible(false)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: activeOrderBanners.length > 0 ? 150 : Math.max(28, insets.bottom + 24),
        }}
      >
        <View style={{ flexDirection: 'row', gap: 10 }}><SearchBar style={{ flex: 1 }}>
          <Ionicons name="search-outline" size={moderateScale(20)} color="#8b8b8b" />
          <SearchInput
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder={width < 450 ? "Search restaurants or dishes..." : "Search restaurants, dishes or cuisines..."}
            placeholderTextColor="#9a9a9a"
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <SearchClearButton onPress={() => handleSearchChange('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#b0b0b0" />
            </SearchClearButton>
          ) : null}
        </SearchBar>
          <Pressable accessibilityRole="button" accessibilityLabel="Filter restaurants" onPress={() => setShowFilters(true)} style={{ width: 48, height: moderateVerticalScale(54), borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: foodFilter !== 'ALL' ? '#ff6b00' : '#ffead9', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="options-outline" size={25} color="#ff6b00" />
          </Pressable></View>
        <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
          <ModalOverlay><ModalCard>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <ModalTitle>Food preference</ModalTitle>
              <Pressable accessibilityRole="button" accessibilityLabel="Close filters" hitSlop={10} onPress={() => setShowFilters(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff0e3', alignItems: 'center', justifyContent: 'center', marginTop: -4, marginRight: -8 }}>
                <Ionicons name="close" size={20} color="#653919" />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14, marginBottom: 20 }}>
              {RESTAURANT_FOOD_FILTERS.map(filter => <Pressable key={filter.id} accessibilityRole="button" accessibilityState={{ selected: foodFilter === filter.id }} onPress={() => setFoodFilter(filter.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderRadius: 20, backgroundColor: foodFilter === filter.id ? '#ff6b00' : '#fff0e3' }}>{filter.mark ? <FoodTypeMark foodType={filter.mark} size={13} /> : null}<Text style={{ color: foodFilter === filter.id ? '#fff' : '#653919', fontWeight: '600' }}>{filter.label}</Text></Pressable>)}
            </View>
            <ModalTitle>What are you craving?</ModalTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 20 }}>
              {homeCategories.map(category => <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected: isCravingSelected(category) }} onPress={() => handleCravingPress(category)} style={{ padding: 12, borderRadius: 20, backgroundColor: isCravingSelected(category) ? '#ff6b00' : '#fff0e3' }}><Text style={{ color: isCravingSelected(category) ? '#fff' : '#653919', fontWeight: '600' }}>{category.label}</Text></Pressable>)}
            </View>
            <ModalButton onPress={() => setShowFilters(false)} style={{ backgroundColor: '#ff6b00' }}><ModalButtonText>Done</ModalButtonText></ModalButton>
          </ModalCard></ModalOverlay>
        </Modal>

        {searchQuery.trim().length > 0 ? (
          <>
            {searching ? (
              <SearchStatusText>Searching…</SearchStatusText>
            ) : searchResultCount(searchResults) === 0 ? (
              <SearchStatusText>No restaurants, cuisines, categories or dishes found for &quot;{searchQuery.trim()}&quot;.</SearchStatusText>
            ) : (
              <>
                <SearchTabsScroll horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
                  {SEARCH_TABS.filter((tab) => tab.id === 'all' || searchResults[tab.id].length > 0).map((tab) => {
                    const active = searchTab === tab.id;
                    const count = tab.id === 'all' ? searchResultCount(searchResults) : searchResults[tab.id].length;
                    return (
                      <SearchTabChip key={tab.id} $active={active} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setSearchTab(tab.id)}>
                        <SearchTabText $active={active}>{tab.label} ({count})</SearchTabText>
                      </SearchTabChip>
                    );
                  })}
                </SearchTabsScroll>

                {(searchTab === 'all' || searchTab === 'restaurants') && searchResults.restaurants.length > 0 ? (
                  <>
                    <SectionHeader>
                      <ExploreSectionHeading>Restaurants</ExploreSectionHeading>
                    </SectionHeader>
                    {searchResults.restaurants.map((restaurantItem) => (
                      <RestaurantCard
                        key={String(restaurantItem.id)}
                        restaurant={restaurantItem}
                        onViewMenu={() => handleOpenRestaurant(restaurantItem as RestaurantWithRating)}
                        onViewDetails={() => openCafeDetails(restaurantItem as RestaurantWithRating)}
                      />
                    ))}
                  </>
                ) : null}

                {(searchTab === 'all' || searchTab === 'cuisines') && searchResults.cuisines.length > 0 ? (
                  <>
                    <SectionHeader>
                      <ExploreSectionHeading>Cuisines</ExploreSectionHeading>
                    </SectionHeader>
                    {searchResults.cuisines.map((cuisine) => (
                      <View key={cuisine.name} style={{ marginBottom: 12 }}>
                        <SearchGroupLabel>
                          {cuisine.name} · {cuisine.restaurants.length} {cuisine.restaurants.length === 1 ? 'restaurant' : 'restaurants'}
                        </SearchGroupLabel>
                        {cuisine.restaurants.map((restaurantItem) => (
                          <DishResultCard key={`${cuisine.name}-${restaurantItem.id}`} activeOpacity={0.88} onPress={() => handleOpenRestaurant(restaurantItem as RestaurantWithRating)}>
                            <DishResultImage>
                              <AppImage uri={restaurantItem.image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
                            </DishResultImage>
                            <DishResultContent>
                              <DishResultName numberOfLines={1}>{restaurantItem.name}</DishResultName>
                              <DishResultRestaurant numberOfLines={1}>{String(restaurantItem.cuisine || '').replace(/\s*\|\s*/g, ' • ')}</DishResultRestaurant>
                            </DishResultContent>
                            <Ionicons name="chevron-forward" size={18} color="#b0b0b0" />
                          </DishResultCard>
                        ))}
                      </View>
                    ))}
                  </>
                ) : null}

                {(searchTab === 'all' || searchTab === 'categories') && searchResults.categories.length > 0 ? (
                  <>
                    <SectionHeader>
                      <ExploreSectionHeading>Categories</ExploreSectionHeading>
                    </SectionHeader>
                    {searchResults.categories.map((category) => (
                      <DishResultCard
                        key={`${category.id}-${category.restaurant.id}`}
                        activeOpacity={0.88}
                        onPress={() => handleOpenRestaurant(category.restaurant as RestaurantWithRating, category.id)}
                      >
                        <DishResultImage>
                          <AppImage uri={category.imageUrl || category.restaurant.image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
                        </DishResultImage>
                        <DishResultContent>
                          <DishResultName numberOfLines={1}>{category.name}</DishResultName>
                          <DishResultRestaurant numberOfLines={1}>at {category.restaurant.name}</DishResultRestaurant>
                        </DishResultContent>
                        <Ionicons name="chevron-forward" size={18} color="#b0b0b0" />
                      </DishResultCard>
                    ))}
                  </>
                ) : null}

                {(searchTab === 'all' || searchTab === 'menuItems') && searchResults.menuItems.length > 0 ? (
                  <>
                    <SectionHeader>
                      <ExploreSectionHeading>Dishes</ExploreSectionHeading>
                    </SectionHeader>
                    {searchResults.menuItems.map((item) => (
                      <DishResultCard
                        key={item.id}
                        activeOpacity={0.88}
                        onPress={() => handleOpenRestaurant(item.restaurant as RestaurantWithRating)}
                      >
                        <DishResultImage>
                          <AppImage uri={item.imageUrl} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
                        </DishResultImage>
                        <DishResultContent>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {item.foodType ? <FoodTypeMark foodType={item.foodType as FoodType} size={12} /> : null}
                            <DishResultName numberOfLines={1} style={{ flex: 1 }}>{item.name}</DishResultName>
                          </View>
                          <DishResultRestaurant numberOfLines={1}>{item.restaurant.name}</DishResultRestaurant>
                          <DishResultPrice>₹{Number(item.price || 0).toFixed(0)}</DishResultPrice>
                        </DishResultContent>
                        <Ionicons name="chevron-forward" size={18} color="#b0b0b0" />
                      </DishResultCard>
                    ))}
                  </>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {RESTAURANT_FOOD_FILTERS.map((filter) => {
                const active = foodFilter === filter.id;
                return (
                  <Pressable
                    key={filter.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show ${filter.label} restaurants`}
                    onPress={() => setFoodFilter(filter.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: active ? '#ff6b00' : '#ffead9', backgroundColor: active ? '#fff0e3' : '#fff' }}
                  >
                    {filter.mark ? <FoodTypeMark foodType={filter.mark} size={13} /> : null}
                    <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#ff6b00' : '#653919' }}>{filter.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <HeroBanner accessibilityRole="button" accessibilityLabel="Order food from nearby restaurants" activeOpacity={0.92} onPress={() => primaryRestaurant && handleOpenRestaurant(primaryRestaurant)}>
              <HeroBannerIconWrap>
                <Image source={require('../assets/images/biryani_banner.png')} style={{ position: 'absolute', width: '240%', height: '145%', left: '-132%', top: '-5%' }} resizeMode="cover" />
              </HeroBannerIconWrap>
              <HeroBannerContent>
                <Text style={{ color: '#b66324', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 9 }}>{cityName ? `TASTE OF ${cityName.toUpperCase()}` : 'TASTE OF YOUR CITY'}</Text>
                <HeroBannerTitle>Good Food{'\n'}<Text style={{ color: '#ff6b00' }}>Happier Days!</Text></HeroBannerTitle>
                <HeroBannerSubtitle>Your favourite restaurants,{'\n'}now closer than ever.</HeroBannerSubtitle>
                <HeroBannerCta><HeroBannerCtaText>Order Now</HeroBannerCtaText><Ionicons name="arrow-forward" size={18} color="#fff" /></HeroBannerCta>
              </HeroBannerContent>
            </HeroBanner>
            <TrustStrip>
              {[['bicycle-outline', 'Fast Delivery', 'At your doorstep'], ['shield-checkmark-outline', 'Trusted Restaurants', 'Quality & hygiene'], ['pricetag-outline', 'Great Offers', 'Save more'], ['heart-outline', 'Supporting Local', 'Grow together']].map(([icon, title, caption]) => (
                <TrustItem key={title}><Ionicons name={icon} size={24} color="#ff6b00" /><TrustText>{title}</TrustText><Text style={{ fontSize: 9, color: '#8a7769', textAlign: 'center', marginTop: 3 }}>{caption}</Text></TrustItem>
              ))}
            </TrustStrip>

            {/* Order Again — returning-user only; a brand-new account with no order history
            simply never sees this section (never an empty carousel or placeholder text). */}
            {orderAgainRestaurants.length > 0 ? (
              <>
                <SectionHeader>
                  <SectionHeadingGroup><SectionHeading>Order Again</SectionHeading><SectionSubheading>Your recent favourites</SectionSubheading></SectionHeadingGroup>
                  <SectionLink accessibilityRole="button" accessibilityLabel="View all Order Again" onPress={() => setExpandedSection('Order Again')}><SectionLinkText>View All</SectionLinkText><Ionicons name="arrow-forward" size={15} color="#ff6b00" /></SectionLink>
                </SectionHeader>
                <DealsScroll horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'flex-start' }}>
                  {orderAgainRestaurants.map((restaurantItem) => (
                    <RestaurantMiniCard
                      actionLabel="Order Again"
                      key={`order-again-${String(restaurantItem.id || restaurantItem.name)}`}
                      restaurant={restaurantItem}
                      onPress={() => handleOpenRestaurant(restaurantItem)}
                    />
                  ))}
                </DealsScroll>
              </>
            ) : null}

            {/* Sponsored restaurants (Feature 11) — ranked among themselves, hidden entirely
            when nothing is currently sponsored (isSponsored defaults false). */}
            {!loading && sponsoredRestaurants.length > 0 ? (
              <>
                <SectionHeader>
                  <SectionHeadingGroup><SectionHeading>Recommended for You</SectionHeading><SectionSubheading>Discover your next favourite</SectionSubheading></SectionHeadingGroup>
                  <SectionLink accessibilityRole="button" accessibilityLabel="View all Recommended for You" onPress={() => setExpandedSection('Recommended for You')}><SectionLinkText>View All</SectionLinkText><Ionicons name="arrow-forward" size={15} color="#ff6b00" /></SectionLink>
                </SectionHeader>
                <DealsScroll horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'flex-start' }}>
                  {sponsoredRestaurants.map((restaurantItem) => (
                    <RestaurantMiniCard
                      key={`sponsored-${String(restaurantItem.id || restaurantItem.name)}`}
                      restaurant={restaurantItem}
                      badge="Sponsored"
                      onPress={() => handleOpenRestaurant(restaurantItem)}
                    />
                  ))}
                </DealsScroll>
              </>
            ) : null}

            {/* Offers Near You — every card is a real coupon tied to a real nearby branch (see
            services/offersService.ts); hidden entirely when nothing currently qualifies,
            same as every other discovery section. */}
            {!offersLoading && offers.length > 0 ? (
              <>
                <SectionHeader>
                  <SectionHeadingGroup><SectionHeading>Offers Near You</SectionHeading><SectionSubheading>Best deals from nearby restaurants</SectionSubheading></SectionHeadingGroup>
                  <SectionLink accessibilityRole="button" accessibilityLabel="View all Offers Near You" onPress={() => setExpandedSection('Offers Near You')}><SectionLinkText>View All</SectionLinkText><Ionicons name="arrow-forward" size={15} color="#ff6b00" /></SectionLink>
                </SectionHeader>
                <DealsScroll horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'flex-start', paddingBottom: 6, paddingHorizontal: 2 }}>
                  {offers.map((offer) => (
                    <OfferCard key={offer.offerId} offer={offer} onPress={() => handleOfferPress(offer)} />
                  ))}
                </DealsScroll>
              </>
            ) : null}

            {/* New restaurants (Feature 10) — age + successful-order-count gated, hidden
            entirely once nothing currently qualifies. */}
            {!loading && newRestaurants.length > 0 ? (
              <>
                <SectionHeader>
                  <SectionHeadingGroup>
                    <SectionHeading>New on Prayagi</SectionHeading>
                    <SectionSubheading>Freshly listed restaurants near you</SectionSubheading>
                  </SectionHeadingGroup>
                  <SectionLink accessibilityRole="button" accessibilityLabel="View all New on Prayagi" onPress={() => setExpandedSection('New on Prayagi')}><SectionLinkText>View All</SectionLinkText><Ionicons name="arrow-forward" size={15} color="#ff6b00" /></SectionLink>
                </SectionHeader>
                <DealsScroll horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'flex-start' }}>
                  {newRestaurants.map((restaurantItem) => (
                    <RestaurantMiniCard
                      key={`new-${String(restaurantItem.id || restaurantItem.name)}`}
                      restaurant={restaurantItem}
                      badge="New"
                      onPress={() => handleOpenRestaurant(restaurantItem)}
                    />
                  ))}
                </DealsScroll>
              </>
            ) : null}

            <SectionHeader>
              <ExploreSectionHeading>Restaurants</ExploreSectionHeading>
            </SectionHeader>

            {loading ? (
              <SkeletonCard>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: '100%', height: moderateVerticalScale(150) }]} />
                <SkeletonCardContent>
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '60%', height: moderateVerticalScale(18), borderRadius: moderateScale(8), marginBottom: moderateVerticalScale(8) }]} />
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '40%', height: moderateVerticalScale(12), borderRadius: moderateScale(6), marginBottom: moderateVerticalScale(10) }]} />
                  <ShimmerButtonRow>
                    <ShimmerBlock style={[shimmerAnimatedStyle, { flex: 1, height: moderateVerticalScale(34), borderRadius: moderateScale(8), marginRight: moderateScale(8) }]} />
                    <ShimmerBlock style={[shimmerAnimatedStyle, { flex: 1, height: moderateVerticalScale(34), borderRadius: moderateScale(8) }]} />
                  </ShimmerButtonRow>
                </SkeletonCardContent>
              </SkeletonCard>
            ) : filteredRestaurants.length > 0 ? (
              filteredRestaurants.map((restaurantItem) => (
                <RestaurantCard
                  key={String(restaurantItem.id || restaurantItem.restaurantId || restaurantItem.cafeId || restaurantItem.name)}
                  restaurant={restaurantItem}
                  onViewMenu={() => handleOpenRestaurant(restaurantItem)}
                  onViewDetails={() => openCafeDetails(restaurantItem)}
                />
              ))
            ) : restaurants.length > 0 ? (
              <EmptyText>{foodFilter !== 'ALL' && foodFilteredRestaurants.length === 0 ? 'No restaurants match this food preference right now.' : 'No restaurants available right now.'}</EmptyText>
            ) : (
              <NoRestaurantsHere city={cityName} />
            )}


            {loading ? (
              <ScratchCard disabled>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(56), height: moderateVerticalScale(56), borderRadius: moderateScale(14) }]} />
                <ScratchContent>
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '70%', height: moderateVerticalScale(18), borderRadius: moderateScale(9), marginBottom: moderateVerticalScale(8), marginLeft: moderateScale(10) }]} />
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '90%', height: moderateVerticalScale(12), borderRadius: moderateScale(6), marginLeft: moderateScale(10) }]} />
                </ScratchContent>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(90), height: moderateVerticalScale(34), borderRadius: moderateScale(10) }]} />
              </ScratchCard>
            ) : (
              <ScratchCard activeOpacity={0.9} onPress={() => router.push('/user/rewards')}>
                <ScratchIconWrap>
                  <Ionicons name="gift-outline" size={moderateScale(34)} color="#fff" />
                </ScratchIconWrap>
                <ScratchContent>
                  <ScratchTitle>Scratch & Win</ScratchTitle>
                  <ScratchSubtitle>Exciting rewards await you!</ScratchSubtitle>
                </ScratchContent>
                <ScratchCta>
                  <ScratchCtaText>Scratch Now</ScratchCtaText>
                </ScratchCta>
              </ScratchCard>
            )}



          </>
        )}
      </ScrollView>

      {activeOrderBanners.length > 0 ? (
        <ActiveOrdersStrip style={{ bottom: 0 }}>
          <FlatList
            ref={activeOrdersListRef}
            data={activeOrderBanners}
            horizontal
            showsHorizontalScrollIndicator={false}
            pagingEnabled
            keyExtractor={(item) => item.orderId}
            getItemLayout={(_, index) => ({
              length: activeOrderCardWidth,
              offset: activeOrderCardWidth * index,
              index,
            })}
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / activeOrderCardWidth);
              const safeIndex = Math.max(0, Math.min(nextIndex, activeOrderBanners.length - 1));
              setActiveOrderIndex(safeIndex);
            }}
            renderItem={({ item }) => (
              <ActiveOrderSlide style={{ width: activeOrderCardWidth }}>
                <ActiveOrderBar activeOpacity={0.9} onPress={() => handleTrackActiveOrder(item)} accessibilityRole="button" accessibilityLabel={`${item.statusLabel}. ${item.message}. Track order`}>
                  <ActiveOrderRow>
                    <ActiveOrderLogo>
                      {item.logoUrl ? (
                        <AppImage uri={item.logoUrl} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
                      ) : (
                        <Ionicons name={item.isDelivery ? 'bicycle' : 'restaurant'} size={moderateScale(20)} color="#16a34a" />
                      )}
                    </ActiveOrderLogo>
                    <ActiveOrderContent>
                      <ActiveOrderStatus numberOfLines={1}>{item.statusLabel}</ActiveOrderStatus>
                      <ActiveOrderTitle numberOfLines={1}>{item.message}</ActiveOrderTitle>
                      <ActiveOrderMeta numberOfLines={1}>
                        {[item.cafeName, item.orderNumber ? `#${item.orderNumber}` : '', `${item.itemCount} item${item.itemCount === 1 ? '' : 's'}`, item.amountDue > 0 ? `₹${item.amountDue.toFixed(0)} to pay` : `₹${item.total.toFixed(0)} paid`].filter(Boolean).join(' · ')}
                      </ActiveOrderMeta>
                    </ActiveOrderContent>
                    <ActiveOrderTrackButton pointerEvents="none">
                      <ActiveOrderTrackText>{item.isDelivery ? 'Track' : 'View'}</ActiveOrderTrackText>
                      <Ionicons name="chevron-forward" size={moderateScale(16)} color="#fff" />
                    </ActiveOrderTrackButton>
                  </ActiveOrderRow>
                  <ActiveOrderProgressTrack>
                    <ActiveOrderProgressFill style={{ width: `${Math.max(8, Math.round(item.progress * 100))}%` }} />
                  </ActiveOrderProgressTrack>
                </ActiveOrderBar>
              </ActiveOrderSlide>
            )}
          />
          {activeOrderBanners.length > 1 ? (
            <ActiveOrderDotsRow>
              {activeOrderBanners.map((item, index) => (
                <ActiveOrderDot key={`${item.orderId}-${index}`} $active={index === activeOrderIndex} />
              ))}
            </ActiveOrderDotsRow>
          ) : null}
        </ActiveOrdersStrip>
      ) : null}

      {totalCartCount > 0 ? (
        <HomeCartFab
          activeOpacity={0.88}
          onPress={() => router.push('/user/cart')}
          style={{ bottom: activeOrderBanners.length > 0 ? moderateVerticalScale(128) : Math.max(moderateVerticalScale(24), insets.bottom + moderateVerticalScale(12)) }}
        >
          <Ionicons name="cart-outline" size={moderateScale(30)} color="#fff" />
          <HomeCartBadge>
            <HomeCartBadgeText>{totalCartCount}</HomeCartBadgeText>
          </HomeCartBadge>
        </HomeCartFab>
      ) : null}


    </Container>
  );
}

/** One restaurant row on the home list and on search results — a single shared component
 *  so both places always look and behave identically. Uses AppImage (expo-image, with a
 *  built-in fallback + loading state) instead of a bare RN &lt;Image&gt;, so a bad/unreachable
 *  image URL degrades to the fallback photo instead of rendering a blank box. Hours/phone
 *  rows only render when the data actually exists, rather than showing an obviously-fake
 *  placeholder like "+911234567890". */
const Container = styled.View`
  flex: 1;
  background-color: #fffbf7;
`;

const ModalOverlay = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
  padding: ${moderateScale(20)}px;
`;

const ModalCard = styled.View`
  width: 100%;
  max-width: ${moderateScale(420)}px;
  background-color: #fff;
  border-radius: ${moderateScale(18)}px;
  padding: ${moderateScale(24)}px;
  shadow-color: #000;
  shadow-opacity: 0.2;
  shadow-radius: ${moderateScale(22)}px;
  shadow-offset: 0px ${moderateVerticalScale(8)}px;
  elevation: 8;
`;

const ModalTitle = styled.Text`
  font-size: ${scaleFont(20)}px;
  font-weight: 700;
  color: #222;
  margin-bottom: ${moderateVerticalScale(12)}px;
`;

const ModalMessage = styled.Text`
  font-size: ${scaleFont(15)}px;
  line-height: ${scaleFont(22)}px;
  color: #444;
  margin-bottom: ${moderateVerticalScale(22)}px;
`;

const ModalActions = styled.View`
  flex-direction: row;
  justify-content: flex-end;
  align-items: center;
`;

const ModalButton = styled(Pressable)`
  min-width: ${moderateScale(110)}px;
  padding-vertical: ${moderateVerticalScale(12)}px;
  padding-horizontal: ${moderateScale(16)}px;
  border-radius: ${moderateScale(12)}px;
  justify-content: center;
  align-items: center;
  margin-left: ${moderateScale(10)}px;
`;

const ModalButtonText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(15)}px;
  font-weight: 700;
`;

type SearchTab = 'all' | 'restaurants' | 'cuisines' | 'categories' | 'menuItems';
const SEARCH_TABS: Array<{ id: SearchTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'restaurants', label: 'Restaurants' },
  { id: 'menuItems', label: 'Dishes' },
  { id: 'cuisines', label: 'Cuisines' },
  { id: 'categories', label: 'Categories' },
];
const searchResultCount = (results: SearchResults) =>
  results.restaurants.length + results.cuisines.length + results.categories.length + results.menuItems.length;

const SearchTabsScroll = styled.ScrollView`
  flex-grow: 0;
  margin-top: 4px;
  margin-bottom: 4px;
`;

const SearchTabChip = styled.TouchableOpacity<{ $active: boolean }>`
  padding: 8px 14px;
  border-radius: 18px;
  border-width: 1px;
  border-color: ${({ $active }: { $active: boolean }) => ($active ? '#ff6b00' : '#ececec')};
  background-color: ${({ $active }: { $active: boolean }) => ($active ? '#fff0e3' : '#ffffff')};
`;

const SearchTabText = styled.Text<{ $active: boolean }>`
  font-size: 13px;
  font-weight: ${({ $active }: { $active: boolean }) => ($active ? '700' : '500')};
  color: ${({ $active }: { $active: boolean }) => ($active ? '#ff6b00' : '#4a4a4a')};
`;

const SearchGroupLabel = styled.Text`
  font-size: 13px;
  font-weight: 700;
  color: #653919;
  margin-bottom: 6px;
`;

const SearchBar = styled.View`
  height: ${moderateVerticalScale(54)}px;
  border-width: 1px;
  border-color: #ececec;
  border-radius: ${moderateScale(18)}px;
  background-color: #fff;
  padding: 0 ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
  flex-direction: row;
  align-items: center;
`;

const SearchInput = styled.TextInput`
  flex: 1;
  margin-left: ${moderateScale(10)}px;
  color: #1f1f1f;
  font-size: ${scaleFont(15)}px;
  font-weight: 500;
`;

const SearchClearButton = styled.TouchableOpacity`
  padding: ${moderateScale(4)}px;
`;

const SearchStatusText = styled.Text`
  color: #7a7a7a;
  font-size: ${scaleFont(14)}px;
  text-align: center;
  margin-top: ${moderateVerticalScale(24)}px;
  margin-bottom: ${moderateVerticalScale(24)}px;
`;

const DishResultCard = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  background-color: #fff;
  border-width: 1px;
  border-color: #ececec;
  border-radius: ${moderateScale(14)}px;
  padding: ${moderateScale(10)}px;
  margin-bottom: ${moderateVerticalScale(10)}px;
`;

const DishResultImage = styled.View`
  width: ${moderateScale(56)}px;
  height: ${moderateScale(56)}px;
  border-radius: ${moderateScale(10)}px;
  overflow: hidden;
  background-color: #f2f2f2;
`;

const DishResultContent = styled.View`
  flex: 1;
  margin-left: ${moderateScale(12)}px;
`;

const DishResultName = styled.Text`
  color: #1f1f1f;
  font-size: ${scaleFont(15)}px;
  font-weight: 700;
`;

const DishResultRestaurant = styled.Text`
  color: #7a7a7a;
  font-size: ${scaleFont(12)}px;
  margin-top: ${moderateVerticalScale(2)}px;
`;

const DishResultPrice = styled.Text`
  color: #ff6b00;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  margin-top: ${moderateVerticalScale(4)}px;
`;

const ShimmerBlock = styled(Animated.View)`
  background-color: #ececec;
`;

const SkeletonCard = styled.View`
  border-radius: ${moderateScale(18)}px;
  overflow: hidden;
  background-color: #fff;
  margin-bottom: ${moderateVerticalScale(16)}px;
`;

const SkeletonCardContent = styled.View`
  padding: ${moderateVerticalScale(12)}px ${moderateScale(14)}px ${moderateVerticalScale(14)}px;
`;

const ShimmerCategoriesRow = styled.View`
  flex-direction: row;
`;

const CategorySkeletonWrap = styled.View`
  width: ${moderateScale(84)}px;
  margin-right: ${moderateScale(10)}px;
  align-items: center;
`;

const ShimmerButtonRow = styled.View`
  flex-direction: row;
`;

const SectionHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: ${moderateVerticalScale(20)}px;
  margin-bottom: ${moderateVerticalScale(10)}px;
`;

const SectionHeading = styled.Text`
  color: #161616;
  font-size: ${scaleFont(18)}px;
  font-weight: 900;
`;

const SectionHeadingGroup = styled.View`flex: 1; padding-right: 8px;`;

const SectionSubheading = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: #8b8b8b;
  font-size: ${scaleFont(12)}px;
  font-weight: 500;
`;

const HeroBanner = styled.TouchableOpacity`
  background-color: #ffe9cf;
  border-radius: 20px;
  min-height: 210px;
  padding: 20px;
  overflow: hidden;
`;
const HeroBannerContent = styled.View`width: 66%; z-index: 1;`;
const HeroBannerTitle = styled.Text`color: #211a15; font-size: ${scaleFont(26)}px; font-weight: 900; line-height: ${scaleFont(28)}px;`;
const HeroBannerSubtitle = styled.Text`margin-top: 9px; color: #604932; font-size: ${scaleFont(12)}px; line-height: 18px;`;
const HeroBannerCta = styled.View`flex-direction: row; align-items: center; align-self: flex-start; margin-top: 16px; background-color: #ff6b00; border-radius: 11px; padding: 11px 16px;`;
const HeroBannerCtaText = styled.Text`color: #fff; font-size: 14px; font-weight: 800; margin-right: 12px;`;
const HeroBannerIconWrap = styled.View`position: absolute; right: -28px; bottom: -22px; width: 45%; height: 175px; border-radius: 90px; overflow: hidden; background-color: #f8c18b;`;

const ExploreSectionHeading = styled.Text`
  color: #161616;
  font-size: ${scaleFont(18)}px;
  font-weight: 900;
`;

const SectionLink = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;

const SectionLinkText = styled.Text`
  color: #ff6b00;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  margin-right: ${moderateScale(4)}px;
`;

const DealsScroll = styled.ScrollView`
  flex-grow: 0;
  flex-shrink: 0;
  margin-top: ${moderateVerticalScale(2)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
`;

const ScratchCard = styled.TouchableOpacity`
  border-radius: ${moderateScale(16)}px;
  background-color: #c85c20;
  flex-direction: row;
  align-items: center;
  padding: ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
  margin-top: ${moderateVerticalScale(14)}px;
`;

const ScratchIconWrap = styled.View`
  width: ${moderateScale(56)}px;
  height: ${moderateVerticalScale(56)}px;
  border-radius: ${moderateScale(14)}px;
  background-color: rgba(255, 255, 255, 0.2);
  align-items: center;
  justify-content: center;
`;

const ScratchContent = styled.View`
  flex: 1;
  padding-left: ${moderateScale(10)}px;
`;

const ScratchTitle = styled.Text`
  color: #fff;
  font-size: ${scaleFont(25)}px;
  font-weight: 900;
`;

const ScratchSubtitle = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: rgba(255, 255, 255, 0.88);
  font-size: ${scaleFont(14)}px;
  font-weight: 600;
`;

const ScratchCta = styled.View`
  border-radius: ${moderateScale(10)}px;
  padding: ${moderateVerticalScale(10)}px ${moderateScale(12)}px;
  background-color: rgba(255, 255, 255, 0.2);
`;

const ScratchCtaText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const HomeCartFab = styled.TouchableOpacity`
  position: absolute;
  right: ${moderateScale(16)}px;
  width: ${moderateScale(62)}px;
  height: ${moderateVerticalScale(62)}px;
  border-radius: ${moderateScale(31)}px;
  background-color: #ff6b00;
  align-items: center;
  justify-content: center;
  shadow-color: #000;
  shadow-opacity: 0.2;
  shadow-radius: ${moderateScale(8)}px;
  shadow-offset: 0px ${moderateVerticalScale(4)}px;
  elevation: 8;
  z-index: 50;
`;

const HomeCartBadge = styled.View`
  position: absolute;
  top: ${moderateVerticalScale(-4)}px;
  right: ${moderateScale(-2)}px;
  min-width: ${moderateScale(22)}px;
  height: ${moderateVerticalScale(22)}px;
  border-radius: ${moderateScale(11)}px;
  background-color: #ef4444;
  border-width: 2px;
  border-color: #fff;
  align-items: center;
  justify-content: center;
  padding-horizontal: ${moderateScale(4)}px;
`;

const HomeCartBadgeText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(11)}px;
  font-weight: 800;
`;

const TrustStrip = styled.View`
  flex-direction: row;
  border-width: 1px;
  border-color: #f0eadf;
  background-color: #fffcf5;
  border-radius: ${moderateScale(14)}px;
  padding: ${moderateScale(10)}px;
  justify-content: space-between;
  margin-bottom: ${moderateVerticalScale(10)}px;
  margin-top: ${moderateVerticalScale(10)}px;
`;

const TrustItem = styled.View`
  width: 23%;
  align-items: center;
`;

const TrustText = styled.Text`
  color: #353535;
  margin-top: ${moderateVerticalScale(3)}px;
  font-size: ${scaleFont(11)}px;
  text-align: center;
  font-weight: 700;
`;

const EmptyText = styled.Text`
  text-align: center;
  color: #888;
  font-size: ${scaleFont(16)}px;
  margin-top: ${moderateVerticalScale(20)}px;
  margin-bottom: ${moderateVerticalScale(10)}px;
`;

const ActiveOrdersStrip = styled.View`
  position: absolute;
  left: 0;
  right: 0;
`;

const ActiveOrderSlide = styled.View`
  padding: 0 0px;
`;

const ActiveOrderBar = styled.TouchableOpacity`
  margin: 0 ${moderateScale(12)}px ${moderateVerticalScale(10)}px;
  background-color: #ffffff;
  border-radius: ${moderateScale(18)}px;
  border-width: 1px;
  border-color: #d1fae5;
  padding: ${moderateScale(12)}px ${moderateScale(12)}px ${moderateScale(10)}px;
  shadow-color: #064e3b;
  shadow-opacity: 0.18;
  shadow-radius: ${moderateScale(12)}px;
  shadow-offset: 0px ${moderateVerticalScale(6)}px;
  elevation: 8;
`;

const ActiveOrderRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const ActiveOrderLogo = styled.View`
  width: ${moderateScale(44)}px;
  height: ${moderateScale(44)}px;
  border-radius: ${moderateScale(12)}px;
  overflow: hidden;
  background-color: #ecfdf5;
  align-items: center;
  justify-content: center;
  margin-right: ${moderateScale(10)}px;
`;

const ActiveOrderStatus = styled.Text`
  color: #15803d;
  font-size: ${scaleFont(14)}px;
  font-weight: 900;
`;

const ActiveOrderMeta = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: #6b7280;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const ActiveOrderProgressTrack = styled.View`
  margin-top: ${moderateVerticalScale(10)}px;
  height: ${moderateVerticalScale(4)}px;
  border-radius: 999px;
  background-color: #dcfce7;
  overflow: hidden;
`;

const ActiveOrderProgressFill = styled.View`
  height: 100%;
  border-radius: 999px;
  background-color: #16a34a;
`;

const ActiveOrderDotsRow = styled.View`
  margin-top: ${moderateVerticalScale(-4)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  pointer-events: none;
`;

const ActiveOrderDot = styled.View<{ $active: boolean }>`
  width: ${({ $active }: { $active: boolean }) => ($active ? `${moderateScale(16)}px` : `${moderateScale(8)}px`)};
  height: ${moderateVerticalScale(8)}px;
  border-radius: ${moderateScale(999)}px;
  margin: 0 ${moderateScale(4)}px;
  background-color: ${({ $active }: { $active: boolean }) => ($active ? '#16a34a' : '#d1d5db')};
`;

const ActiveOrderContent = styled.View`
  flex: 1;
  padding-right: ${moderateScale(12)}px;
`;

const ActiveOrderTitle = styled.Text`
  margin-top: ${moderateVerticalScale(1)}px;
  color: #1f2937;
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;

const ActiveOrderTrackButton = styled.View`
  background-color: #16a34a;
  border-radius: ${moderateScale(14)}px;
  padding: ${moderateVerticalScale(9)}px ${moderateScale(12)}px;
  flex-direction: row;
  align-items: center;
  margin-left: ${moderateScale(8)}px;
`;

const ActiveOrderTrackText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  margin-right: ${moderateScale(2)}px;
`;
