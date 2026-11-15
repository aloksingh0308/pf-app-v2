import { PRIMARY_BUTTON_STYLE } from '@/components/common/AppButton';
import AppearIn from '@/components/common/AppearIn';
import { AppColors } from '@/constants/appColors';
import HomeHeader from '@/components/HomeHeader';
import NoRestaurantsHere from '@/components/NoRestaurantsHere';
import { useCityName } from '@/hooks/useCityName';
import AppImage from '@/components/AppImage';
import { RestaurantCard, RestaurantCompactCard, RestaurantMiniCard } from '@/components/RestaurantCard';
import { T } from '@/constants/tokens';
import { OfferCard } from '@/components/OfferCard';
import AnnouncementBottomSheet from '@/components/AnnouncementBottomSheet';
import EngagementPrompts from '@/components/EngagementPrompts';
import { appUpdateService, AndroidAppUpdateConfig } from '@/services/appUpdateService';
import { AnnouncementConfig, subscribeToAnnouncement } from '@/services/appConfigService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { getRestaurantsByIds, getRestaurantsPage, searchRestaurantsAndMenuItems, RestaurantFoodFilter, RestaurantRecord, SearchResults, EMPTY_SEARCH_RESULTS } from '@/services/restaurantService';
import FoodTypeMark from '@/components/common/FoodTypeMark';
import type { FoodType } from '@/types/Product';
import { setActiveRestaurant } from '@/services/restaurantContext';
import { getMyOrdersPage } from '@/services/orderService';
import { getOffersNearYou, OfferRecord } from '@/services/offersService';
import { Coordinates } from '@/utils/locationUtils';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, View, Animated, BackHandler, Easing, FlatList, Linking, Modal, Platform, Pressable, ScrollView, ToastAndroid, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
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
const NO_RESTAURANTS: RestaurantWithRating[] = [];
const restaurantRowKey = (restaurant: RestaurantWithRating) => String(restaurant.id || restaurant.restaurantId || restaurant.cafeId || restaurant.name);
const ANDROID_UPDATE_DISMISSED_VERSION_KEY = 'android_update_dismissed_version';
const ANDROID_UPDATE_DISMISSED_CONTEXT_KEY = 'android_update_dismissed_context';
// How long to wait after Home gains focus before revealing the announcement sheet.
const ANNOUNCEMENT_REVEAL_DELAY_MS = 3000;
// Polling cadence — see utils/polling.ts (paused off-screen / in background / during a 429).
const ACTIVE_ORDER_POLL_MS = 20_000;
const IDLE_ORDER_POLL_MS = 90_000;
const PROFILE_REFRESH_MS = 120_000;
const RECENT_ORDERS_LIMIT = 20;
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
  // Home's restaurant list pages in from the API (getRestaurantsPage) — `mainRestaurants` is
  // the ranked, food-filtered list loaded so far; the carousels and Order Again come with it.
  const [mainRestaurants, setMainRestaurants] = useState<RestaurantWithRating[]>([]);
  const [highlights, setHighlights] = useState<{ sponsored: RestaurantWithRating[]; newRestaurants: RestaurantWithRating[] }>({ sponsored: [], newRestaurants: [] });
  const [orderAgainPool, setOrderAgainPool] = useState<RestaurantWithRating[]>([]);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [restaurantsHasMore, setRestaurantsHasMore] = useState(false);
  const [loadingMoreRestaurants, setLoadingMoreRestaurants] = useState(false);
  const restaurantsPageRef = useRef(1);
  const loadingMoreRestaurantsRef = useRef(false);
  // Every restaurant row known on this screen, for lookups (hero, offer cards, active-order
  // banners) — not a list that's shown as-is.
  const restaurants = useMemo(() => {
    const byId = new Map<string, RestaurantWithRating>();
    [...mainRestaurants, ...highlights.sponsored, ...highlights.newRestaurants, ...orderAgainPool].forEach((row) => {
      if (!byId.has(String(row.id))) byId.set(String(row.id), row);
    });
    return [...byId.values()];
  }, [mainRestaurants, highlights, orderAgainPool]);
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
  // The API applies the food filter to the main list and both carousels.
  const newRestaurants = highlights.newRestaurants;
  const sponsoredRestaurants = highlights.sponsored;
  const [homeCategories, setHomeCategories] = useState<HomeCategoryItem[]>(FALLBACK_HOME_CATEGORIES);

  // "All" (id '0') shows everything; any other chip filters the main Restaurants list
  // below by matching its label against each restaurant's own cuisine/food-type tags.
  const [showFilters, setShowFilters] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const filteredRestaurants = mainRestaurants;
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
    const byId = new Map([...restaurants, ...orderAgainPool].map((r) => [String(r.id || r.restaurantId || r.cafeId || ''), r]));
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
  }, [recentOrderBranchIds, restaurants, orderAgainPool]);

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

  // Skeleton shimmer runs only while loading — a forever loop kept the UI thread animating.
  useEffect(() => {
    if (!loading) return;
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
  }, [loading, shimmerOpacity]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants[0]?.id]);

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

  const withRatings = (rows: RestaurantRecord[]) =>
    rows.map((restaurant) => ({ ...restaurant, rating: Number(restaurant.rating || 0), ratingCount: Number(restaurant.ratingCount || 0) } as RestaurantWithRating));

  // Page 1 of the ranked list (plus the carousels). Deliberately NOT re-sorted here — the
  // backend's ranking engine (restaurantRanking.service.ts) already returns rows in final
  // ranked order (organic score + sponsored/new boosts + fairness rotation).
  const loadRestaurants = useCallback(async () => {
    const requestId = ++restaurantRequestId.current;
    if (!authUser?.uid && !authUser?.email) {
      setMainRestaurants([]);
      setHighlights({ sponsored: [], newRestaurants: [] });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const page = await getRestaurantsPage(deviceCoords, 1, foodFilter);
      if (requestId !== restaurantRequestId.current) return;
      restaurantsPageRef.current = 1;
      setMainRestaurants(withRatings(page.items));
      setHighlights({ sponsored: withRatings(page.sponsored), newRestaurants: withRatings(page.newRestaurants) });
      setUnfilteredTotal(page.unfilteredTotal);
      setRestaurantsHasMore(page.hasMore);
    } catch (error) {
      console.error('Failed to load restaurants:', error);
    } finally {
      if (requestId === restaurantRequestId.current) setLoading(false);
    }
  }, [authUser?.uid, authUser?.email, deviceCoords, foodFilter]);

  /** Next page of the main list, when the list nears its end. */
  const loadMoreRestaurants = useCallback(async () => {
    if (loading || !restaurantsHasMore || loadingMoreRestaurantsRef.current) return;
    const requestId = restaurantRequestId.current;
    loadingMoreRestaurantsRef.current = true;
    setLoadingMoreRestaurants(true);
    try {
      const nextPage = restaurantsPageRef.current + 1;
      const page = await getRestaurantsPage(deviceCoords, nextPage, foodFilter);
      if (requestId !== restaurantRequestId.current) return;
      restaurantsPageRef.current = nextPage;
      setMainRestaurants((current) => {
        const seen = new Set(current.map((row) => String(row.id)));
        return [...current, ...withRatings(page.items).filter((row) => !seen.has(String(row.id)))];
      });
      setRestaurantsHasMore(page.hasMore);
    } catch (error) {
      console.warn('Failed to load more restaurants:', error);
    } finally {
      loadingMoreRestaurantsRef.current = false;
      setLoadingMoreRestaurants(false);
    }
  }, [loading, restaurantsHasMore, deviceCoords, foodFilter]);

  // A different food chip re-queries the list from page 1 (offers don't depend on it).
  const foodFilterLoadedRef = useRef(foodFilter);
  useEffect(() => {
    if (foodFilterLoadedRef.current === foodFilter) return;
    foodFilterLoadedRef.current = foodFilter;
    void loadRestaurants();
  }, [foodFilter, loadRestaurants]);

  // Order Again's restaurants, fetched by id so they show whatever page they rank on.
  useEffect(() => {
    if (recentOrderBranchIds.length === 0) {
      setOrderAgainPool([]);
      return;
    }
    let active = true;
    getRestaurantsByIds(recentOrderBranchIds, deviceCoords)
      .then((rows) => { if (active) setOrderAgainPool(withRatings(rows)); })
      .catch((error) => console.warn('Failed to load Order Again restaurants:', error));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentOrderBranchIds.join('|'), deviceCoords]);

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

    // Unchanged polls keep the previous arrays so Home doesn't re-render every tick.
    const banners: ActiveOrderBannerItem[] = activeOrders
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
        .filter((item) => Boolean(item.orderId));
    setActiveOrderBanners((prev) => (JSON.stringify(prev) === JSON.stringify(banners) ? prev : banners));

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
    setRecentOrderBranchIds((prev) => (prev.join('|') === branchIds.join('|') ? prev : branchIds));
  };

  usePolling(
    async () => {
      if (!authUser?.uid) return;
      try {
        // Active orders and "Order Again" only need the newest orders, not the full history.
        applyMyOrders((await getMyOrdersPage(null, RECENT_ORDERS_LIMIT)).orders);
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

  const handleOpenRestaurant = useCallback((restaurant: RestaurantWithRating, categoryId?: string) => {
    router.push({
      pathname: '/user/restaurant-details',
      params: {
        restaurant: JSON.stringify(restaurant),
        categoryId: categoryId || '0',
      },
    });
  }, []);
  // Stable per-card handlers (cards are memoized and hand their restaurant back).
  const openRestaurantMenu = useCallback((restaurant: RestaurantRecord) => handleOpenRestaurant(restaurant as RestaurantWithRating), [handleOpenRestaurant]);

  // Every order opens the tracking screen (map for delivery, status details for takeaway/dine-in).
  const handleTrackActiveOrder = useCallback((item: ActiveOrderBannerItem) => {
    if (!item.orderId) return;
    router.push({ pathname: '/user/track-order', params: { orderId: item.orderId, status: item.rawStatus } });
  }, []);


  const primaryRestaurant = restaurants[0] || null;
  const showRestaurantRows = !searchQuery.trim() && !loading;
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
  const openRestaurantDetails = useCallback((restaurant: RestaurantRecord) => openCafeDetails(restaurant as RestaurantWithRating), [openCafeDetails]);
  const closeExpandedThen = useCallback(<T,>(open: (item: T) => void) => (item: T) => { setExpandedSection(null); open(item); }, []);
  const expandedOpenMenu = useMemo(() => closeExpandedThen(openRestaurantMenu), [closeExpandedThen, openRestaurantMenu]);
  const expandedOpenDetails = useMemo(() => closeExpandedThen(openRestaurantDetails), [closeExpandedThen, openRestaurantDetails]);
  const expandedOfferPress = useMemo(() => closeExpandedThen(handleOfferPress), [closeExpandedThen, handleOfferPress]);

  // Main restaurant list rows — virtualized by the screen's FlatList (only a few cards and
  // their cover photos are mounted at a time, instead of every restaurant in the city).
  const renderRestaurantRow = useCallback(({ item, index }: { item: RestaurantWithRating; index: number }) => (
    <AppearIn index={index}><RestaurantCard restaurant={item} onViewMenu={openRestaurantMenu} onViewDetails={openRestaurantDetails} /></AppearIn>
  ), [openRestaurantMenu, openRestaurantDetails]);

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
                style={{ backgroundColor: AppColors.cta }}
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
            {expandedSection === 'Offers Near You' ? offers.map((offer, index) => <AppearIn key={offer.offerId} index={index}><OfferCard offer={offer} fullWidth onPress={expandedOfferPress} /></AppearIn>) : (expandedSection === 'Order Again' ? orderAgainRestaurants : expandedSection === 'Recommended for You' ? sponsoredRestaurants : newRestaurants).map((restaurant, index) => <AppearIn key={restaurant.id} index={index}><RestaurantCard restaurant={restaurant} onViewMenu={expandedOpenMenu} onViewDetails={expandedOpenDetails} /></AppearIn>)}
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

      {/* Delivered-order rating popup / notification permission screen — one per session,
          never over another Home modal. */}
      <EngagementPrompts blocked={isUpdateModalVisible || isAnnouncementVisible || showFilters || expandedSection !== null} />

      <FlatList
        data={showRestaurantRows ? filteredRestaurants : NO_RESTAURANTS}
        onEndReached={showRestaurantRows ? () => void loadMoreRestaurants() : undefined}
        onEndReachedThreshold={0.8}
        keyExtractor={restaurantRowKey}
        renderItem={renderRestaurantRow}
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: activeOrderBanners.length > 0 ? 150 : Math.max(28, insets.bottom + 24),
        }}
        ListHeaderComponent={<>
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
            <ModalButton onPress={() => setShowFilters(false)} style={{ backgroundColor: AppColors.cta }}><ModalButtonText>Done</ModalButtonText></ModalButton>
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
                    {searchResults.restaurants.map((restaurantItem, index) => (
                      <AppearIn key={String(restaurantItem.id)} index={index}>
                        <RestaurantCard
                          restaurant={restaurantItem}
                          onViewMenu={openRestaurantMenu}
                          onViewDetails={openRestaurantDetails}
                        />
                      </AppearIn>
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
                          <DishResultCard key={`${cuisine.name}-${restaurantItem.id}`} activeOpacity={0.8} onPress={() => handleOpenRestaurant(restaurantItem as RestaurantWithRating)}>
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
                        activeOpacity={0.8}
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
                        activeOpacity={0.8}
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

            <HeroBanner accessibilityRole="button" accessibilityLabel="Order food from nearby restaurants" activeOpacity={0.8} onPress={() => primaryRestaurant && handleOpenRestaurant(primaryRestaurant)}>
              <HeroBannerIconWrap>
                <Image source={require('../assets/images/biryani_banner.jpg')} style={{ position: 'absolute', width: '240%', height: '145%', left: '-132%', top: '-5%' }} resizeMode="cover" />
              </HeroBannerIconWrap>
              <HeroBannerContent>
                <Text style={{ color: '#b66324', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 5 }}>{cityName ? `TASTE OF ${cityName.toUpperCase()}` : 'TASTE OF YOUR CITY'}</Text>
                <HeroBannerTitle>Good Food{'\n'}<Text style={{ color: '#ff6b00' }}>Happier Days!</Text></HeroBannerTitle>
                <HeroBannerSubtitle numberOfLines={1}>Your favourites, closer than ever.</HeroBannerSubtitle>
                <HeroBannerCta><HeroBannerCtaText>Order Now</HeroBannerCtaText><Ionicons name="arrow-forward" size={16} color="#fff" /></HeroBannerCta>
              </HeroBannerContent>
            </HeroBanner>
            <TrustStrip>
              {[['bicycle-outline', 'Fast delivery'], ['shield-checkmark-outline', 'Trusted kitchens'], ['pricetag-outline', 'Great offers'], ['heart-outline', 'Support local']].map(([icon, title]) => (
                <TrustItem key={title}><Ionicons name={icon} size={18} color={T.color.brand} /><TrustText numberOfLines={2}>{title}</TrustText></TrustItem>
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
                <DealsScroll horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'flex-start', gap: 10 }}>
                  {orderAgainRestaurants.map((restaurantItem, index) => (
                    <AppearIn key={`order-again-${String(restaurantItem.id || restaurantItem.name)}`} index={index} from="left">
                      <RestaurantCompactCard restaurant={restaurantItem} onPress={openRestaurantMenu} />
                    </AppearIn>
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
                  {sponsoredRestaurants.map((restaurantItem, index) => (
                    <AppearIn key={`sponsored-${String(restaurantItem.id || restaurantItem.name)}`} index={index} from="left">
                      <RestaurantMiniCard restaurant={restaurantItem} badge="Sponsored" onPress={openRestaurantMenu} />
                    </AppearIn>
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
                  {offers.map((offer, index) => (
                    <AppearIn key={offer.offerId} index={index} from="left">
                      <OfferCard offer={offer} onPress={handleOfferPress} />
                    </AppearIn>
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
                  {newRestaurants.map((restaurantItem, index) => (
                    <AppearIn key={`new-${String(restaurantItem.id || restaurantItem.name)}`} index={index} from="left">
                      <RestaurantMiniCard restaurant={restaurantItem} badge="New" onPress={openRestaurantMenu} />
                    </AppearIn>
                  ))}
                </DealsScroll>
              </>
            ) : null}

            <SectionHeader>
              <ExploreSectionHeading>Restaurants</ExploreSectionHeading>
            </SectionHeader>

            {loading ? (
              // Same shape as RestaurantCard (photo left, text right) so nothing jumps when the list arrives.
              <>
                {[0, 1, 2].map((row) => (
                  <SkeletonCard key={row}>
                    <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(104), height: moderateScale(104), borderRadius: T.radius.md }]} />
                    <SkeletonCardContent>
                      <ShimmerBlock style={[shimmerAnimatedStyle, { width: '70%', height: moderateVerticalScale(16), borderRadius: moderateScale(8), marginBottom: moderateVerticalScale(8) }]} />
                      <ShimmerBlock style={[shimmerAnimatedStyle, { width: '45%', height: moderateVerticalScale(12), borderRadius: moderateScale(6), marginBottom: moderateVerticalScale(12) }]} />
                      <ShimmerBlock style={[shimmerAnimatedStyle, { width: '60%', height: moderateVerticalScale(12), borderRadius: moderateScale(6) }]} />
                    </SkeletonCardContent>
                  </SkeletonCard>
                ))}
              </>
            ) : filteredRestaurants.length > 0 ? null : unfilteredTotal > 0 ? (
              <EmptyText>{foodFilter !== 'ALL' ? 'No restaurants match this food preference right now.' : 'No restaurants available right now.'}</EmptyText>
            ) : (
              <NoRestaurantsHere city={cityName} />
            )}
          </>
        )}
        </>}
        ListFooterComponent={searchQuery.trim().length > 0 ? null : <>
            {loadingMoreRestaurants ? <View style={{ paddingVertical: 16 }}><ActivityIndicator color={T.color.brand} /></View> : null}

            {/* "Scratch & Win" banner hidden: new scratch cards are no longer issued (2026-11-09). */}
            {!SHOW_SCRATCH_BANNER ? null : loading ? (
              <ScratchCard disabled>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(48), height: moderateScale(48), borderRadius: T.radius.md }]} />
                <ScratchContent>
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '70%', height: moderateVerticalScale(18), borderRadius: moderateScale(9), marginBottom: moderateVerticalScale(8), marginLeft: moderateScale(10) }]} />
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '90%', height: moderateVerticalScale(12), borderRadius: moderateScale(6), marginLeft: moderateScale(10) }]} />
                </ScratchContent>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(90), height: moderateVerticalScale(34), borderRadius: moderateScale(10) }]} />
              </ScratchCard>
            ) : (
              <ScratchCard activeOpacity={0.8} onPress={() => router.push('/user/rewards')} accessibilityRole="button" accessibilityLabel="Scratch and win. Open your rewards">
                <ScratchGlow />
                <ScratchIconWrap>
                  <Ionicons name="gift" size={moderateScale(24)} color="#fff" />
                </ScratchIconWrap>
                <ScratchContent>
                  <ScratchTitle>Scratch & Win</ScratchTitle>
                  <ScratchSubtitle numberOfLines={2}>Every order unlocks a scratch card</ScratchSubtitle>
                </ScratchContent>
                <ScratchCta>
                  <ScratchCtaText>Scratch</ScratchCtaText>
                  <Ionicons name="arrow-forward" size={14} color="#fff" />
                </ScratchCta>
              </ScratchCard>
            )}
        </>}
      />

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
                <ActiveOrderBar activeOpacity={0.8} onPress={() => handleTrackActiveOrder(item)} accessibilityRole="button" accessibilityLabel={`${item.statusLabel}. ${item.message}. Track order`}>
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
                      <ActiveOrderTrackText>{item.isDelivery ? 'Track' : 'Status'}</ActiveOrderTrackText>
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
              {activeOrderBanners.length > 5 ? (
                <ActiveOrderCounter>{activeOrderIndex + 1} of {activeOrderBanners.length} active orders · swipe</ActiveOrderCounter>
              ) : activeOrderBanners.map((item, index) => (
                <ActiveOrderDot key={`${item.orderId}-${index}`} $active={index === activeOrderIndex} />
              ))}
            </ActiveOrderDotsRow>
          ) : null}
        </ActiveOrdersStrip>
      ) : null}

      {totalCartCount > 0 ? (
        <HomeCartFab
          activeOpacity={0.8}
          onPress={() => router.push('/user/cart')}
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${totalCartCount} items`}
          style={{ ...T.shadow.float, bottom: activeOrderBanners.length > 0 ? moderateVerticalScale(128) : Math.max(moderateVerticalScale(24), insets.bottom + moderateVerticalScale(12)) }}
        >
          <Ionicons name="bag-handle" size={moderateScale(18)} color="#fff" />
          <HomeCartFabText>{totalCartCount} item{totalCartCount === 1 ? '' : 's'} · View cart</HomeCartFabText>
          <Ionicons name="chevron-forward" size={moderateScale(16)} color="#fff" />
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
  min-height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  padding-horizontal: ${moderateScale(16)}px;
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
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

const SearchTabChip = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $active: boolean }>`
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

const SearchClearButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  padding: ${moderateScale(4)}px;
`;

const SearchStatusText = styled.Text`
  color: #7a7a7a;
  font-size: ${scaleFont(14)}px;
  text-align: center;
  margin-top: ${moderateVerticalScale(24)}px;
  margin-bottom: ${moderateVerticalScale(24)}px;
`;

const DishResultCard = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
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
  flex-direction: row;
  border-radius: ${T.radius.lg}px;
  padding: 10px;
  background-color: ${T.color.surface};
  border-width: 1px;
  border-color: ${T.color.line};
  margin-bottom: 12px;
`;

const SkeletonCardContent = styled.View`
  flex: 1;
  padding-left: 12px;
  justify-content: center;
`;

const ShimmerCategoriesRow = styled.View`
  flex-direction: row;
`;

const CategorySkeletonWrap = styled.View`
  width: ${moderateScale(84)}px;
  margin-right: ${moderateScale(10)}px;
  align-items: center;
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

const HeroBanner = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background-color: #ffe9cf;
  border-radius: ${T.radius.lg + 4}px;
  min-height: 136px;
  padding: 14px 18px;
  overflow: hidden;
`;
const HeroBannerContent = styled.View`width: 66%; z-index: 1;`;
const HeroBannerTitle = styled.Text`color: #211a15; font-size: ${scaleFont(21)}px; font-weight: 900; line-height: ${scaleFont(24)}px;`;
const HeroBannerSubtitle = styled.Text`margin-top: 5px; color: #604932; font-size: ${scaleFont(12)}px; line-height: 18px;`;
const HeroBannerCta = styled.View`flex-direction: row; align-items: center; align-self: flex-start; margin-top: 10px; background-color: #ff6b00; border-radius: 10px; padding: 8px 14px;`;
const HeroBannerCtaText = styled.Text`color: #fff; font-size: 13px; font-weight: 800; margin-right: 8px;`;
const HeroBannerIconWrap = styled.View`position: absolute; right: -24px; bottom: -18px; width: 40%; height: 140px; border-radius: 72px; overflow: hidden; background-color: #f8c18b;`;

const ExploreSectionHeading = styled.Text`
  color: #161616;
  font-size: ${scaleFont(18)}px;
  font-weight: 900;
`;

const SectionLink = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
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

/** New scratch cards are no longer issued — the banner promising one per order stays hidden. */
const SHOW_SCRATCH_BANNER = false;

const ScratchCard = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  border-radius: ${T.radius.lg}px;
  background-color: ${T.color.brandSoft};
  border-width: 1px;
  border-color: ${T.color.brandBorder};
  flex-direction: row;
  align-items: center;
  padding: ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
  margin-top: ${moderateVerticalScale(14)}px;
  overflow: hidden;
`;
/** Soft brand-tinted circle peeking in from the top-right corner. */
const ScratchGlow = styled.View`
  position: absolute;
  top: -${moderateScale(40)}px;
  right: -${moderateScale(24)}px;
  width: ${moderateScale(120)}px;
  height: ${moderateScale(120)}px;
  border-radius: ${moderateScale(60)}px;
  background-color: #ffe2c6;
`;
const ScratchIconWrap = styled.View`
  width: ${moderateScale(48)}px;
  height: ${moderateScale(48)}px;
  border-radius: ${T.radius.md}px;
  background-color: ${T.color.brand};
  align-items: center;
  justify-content: center;
`;
const ScratchContent = styled.View`
  flex: 1;
  padding-horizontal: ${moderateScale(12)}px;
`;
const ScratchTitle = styled.Text`
  color: ${T.color.ink};
  font-size: ${scaleFont(17)}px;
  font-weight: 800;
`;
const ScratchSubtitle = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: ${T.color.muted};
  font-size: ${scaleFont(12)}px;
  line-height: ${scaleFont(16)}px;
`;
const ScratchCta = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  border-radius: ${T.radius.pill}px;
  padding: ${moderateVerticalScale(8)}px ${moderateScale(14)}px;
  background-color: ${T.color.brand};
`;
const ScratchCtaText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const HomeCartFab = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  position: absolute;
  right: ${moderateScale(16)}px;
  flex-direction: row;
  align-items: center;
  height: ${moderateVerticalScale(48)}px;
  padding: 0 ${moderateScale(16)}px;
  border-radius: ${T.radius.pill}px;
  background-color: ${T.color.brand};
  z-index: 50;
`;

const HomeCartFabText = styled.Text`
  margin: 0 ${moderateScale(6)}px 0 ${moderateScale(8)}px;
  color: #fff;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
`;

const TrustStrip = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: ${moderateVerticalScale(12)}px;
  margin-bottom: ${moderateVerticalScale(4)}px;
`;

const TrustItem = styled.View`
  width: 24%;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: ${moderateVerticalScale(8)}px ${moderateScale(4)}px;
  border-radius: ${T.radius.md}px;
  background-color: ${T.color.surface};
  border-width: 1px;
  border-color: ${T.color.line};
`;

const TrustText = styled.Text`
  flex-shrink: 1;
  margin-left: ${moderateScale(5)}px;
  color: ${T.color.inkSoft};
  font-size: ${scaleFont(10)}px;
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

const ActiveOrderBar = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  margin: 0 ${moderateScale(12)}px ${moderateVerticalScale(10)}px;
  background-color: #ffffff;
  border-radius: ${T.radius.lg}px;
  border-width: 1px;
  border-color: #d1fae5;
  padding: ${moderateScale(10)}px ${moderateScale(12)}px ${moderateScale(8)}px;
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
  width: ${moderateScale(38)}px;
  height: ${moderateScale(38)}px;
  border-radius: ${T.radius.md}px;
  overflow: hidden;
  background-color: #ecfdf5;
  align-items: center;
  justify-content: center;
  margin-right: ${moderateScale(10)}px;
`;

const ActiveOrderStatus = styled.Text`
  color: #15803d;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const ActiveOrderMeta = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: #6b7280;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const ActiveOrderProgressTrack = styled.View`
  margin-top: ${moderateVerticalScale(8)}px;
  height: ${moderateVerticalScale(3)}px;
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

const ActiveOrderCounter = styled.Text`
  padding: 2px 10px;
  border-radius: 999px;
  overflow: hidden;
  background-color: rgba(28, 25, 23, 0.72);
  color: #fff;
  font-size: ${scaleFont(11)}px;
  font-weight: 700;
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
  border-radius: ${T.radius.pill}px;
  padding: ${moderateVerticalScale(6)}px ${moderateScale(10)}px ${moderateVerticalScale(6)}px ${moderateScale(12)}px;
  flex-direction: row;
  align-items: center;
  margin-left: ${moderateScale(8)}px;
`;

const ActiveOrderTrackText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
  margin-right: ${moderateScale(2)}px;
`;
