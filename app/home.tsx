import HomeHeader from '@/components/HomeHeader';
import AppImage from '@/components/AppImage';
import { RestaurantCard, RestaurantMiniCard } from '@/components/RestaurantCard';
import { OfferCard } from '@/components/OfferCard';
import AnnouncementBottomSheet from '@/components/AnnouncementBottomSheet';
import { appUpdateService, AndroidAppUpdateConfig } from '@/services/appUpdateService';
import { AnnouncementConfig, subscribeToAnnouncement } from '@/services/appConfigService';
import { showAlert } from '@/services/alertService';
import { buildCartItemsForDeal, buildDealDescription, fetchActiveDeals, hydrateDealItemNames } from '@/services/dealsService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { getRestaurants, searchRestaurantsAndMenuItems, RestaurantRecord, MenuItemSearchResult } from '@/services/restaurantService';
import { setActiveRestaurant } from '@/services/restaurantContext';
import { getMyOrders } from '@/services/orderService';
import { getOffersNearYou, OfferRecord } from '@/services/offersService';
import { Coordinates } from '@/utils/locationUtils';
import { buildProductCartKey } from '@/utils/productVariants';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, FlatList, Linking, Modal, Platform, Pressable, ScrollView, ToastAndroid, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { notificationService } from '../services/notificationService';
import { userService } from '../services/userService';
import { AppDispatch, RootState } from '../store';
import { setUser } from '../store/slices/authSlice';
import { decrementQuantity, incrementQuantity, removeFromCart } from '../store/slices/cartSlice';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { DealMenuView } from '../types/Deal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';


const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';
const ANDROID_UPDATE_DISMISSED_VERSION_KEY = 'android_update_dismissed_version';
const ANDROID_UPDATE_DISMISSED_CONTEXT_KEY = 'android_update_dismissed_context';
// How long to wait after Home gains focus before revealing the announcement sheet.
const ANNOUNCEMENT_REVEAL_DELAY_MS = 3000;

const FALLBACK_HOME_CATEGORIES = [
  { id: '0', label: 'All', icon: 'grid-outline' },
  { id: 'pizza', label: 'Pizza', icon: 'pizza-outline' },
  { id: 'chinese', label: 'Chinese', icon: 'restaurant-outline' },
  { id: 'burger', label: 'Burgers', icon: 'fast-food-outline' },
  { id: 'biryani', label: 'Biryani', icon: 'restaurant-outline' },
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

const isOrderInProgress = (status: unknown) => {
  const normalized = normalizeKey(status);
  if (!normalized) return true;
  if (normalized.includes('deliver') || normalized.includes('complete') || normalized.includes('cancel') || normalized.includes('reject')) {
    return false;
  }
  return true;
};

const getOrderCreatedAtMs = (order: any) => {
  const value = order?.createdAt;
  if (value && typeof value.toMillis === 'function') return Number(value.toMillis());
  if (value && typeof value.toDate === 'function') return Number(value.toDate().getTime());
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatOrderStatus = (status: unknown) => {
  const raw = String(status || '').trim();
  if (!raw) return 'Pending';
  return raw
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const getHomeOrderBannerMessage = (status: unknown) => {
  const normalized = normalizeKey(status);

  if (!normalized || normalized.includes('pending')) {
    return 'Your order is Pending, waiting for confirmation';
  }

  if (!normalized || normalized.includes('confirm') || normalized.includes('prepar')) {
    return 'Your order is being prepared and packed';
  }

  if (normalized.includes('ready')) {
    return 'Order is ready. Delivery partner will pick it up soon.';
  }

  if (
    normalized.includes('picked')
    || normalized.includes('dispatch')
    || normalized.includes('on the way')
    || normalized.includes('out_for_delivery')
    || normalized.includes('out for delivery')
  ) {
    return 'Your order is on the way';
  }

  return null;
};

type ActiveOrderBannerItem = {
  orderId: string;
  cafeName: string;
  status: string;
  message: string;
};

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

const getDealSavingsLabel = (deal: DealMenuView): string => {
  const original = Number(deal.pricing?.totalPrice || 0);
  const dealPrice = Number(deal.pricing?.dealPrice || 0);
  const absoluteSavings = Math.max(0, original - dealPrice);

  if (absoluteSavings > 0) {
    return `Saved ₹${absoluteSavings.toFixed(0)}`;
  }

  const discountType = String(deal.pricing?.discountType || '').toLowerCase();
  if (discountType === 'percentage') {
    const percent = Math.max(0, Math.min(100, Number(deal.pricing?.discountValue || 0)));
    if (percent > 0) {
      return `${percent.toFixed(0)}% OFF`;
    }
  }

  return 'Today\'s Deal';
};

const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
};

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeOrderCardWidth = Math.max(320, width);
  const authUser = useSelector((state: RootState) => state.auth.user);
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const dispatch = useDispatch<AppDispatch>();
  const { addItems } = useAddToCartWithRestaurantGuard();
  const [restaurants, setRestaurants] = useState<RestaurantWithRating[]>([]);
  const restaurantsRef = useRef<RestaurantWithRating[]>([]);
  useEffect(() => {
    restaurantsRef.current = restaurants;
  }, [restaurants]);
  // "New" and "Recommended" home carousels (Features 10/11) — purely derived from the
  // ranking engine's already-computed isNew/isSponsored flags on the same ranked list, so a
  // restaurant leaves either section automatically the moment the backend stops flagging it,
  // never a separately-tracked classification on the client.
  const newRestaurants = useMemo(() => restaurants.filter((r) => r.isNew), [restaurants]);
  const sponsoredRestaurants = useMemo(() => restaurants.filter((r) => r.isSponsored), [restaurants]);
  const [homeCategories, setHomeCategories] = useState<HomeCategoryItem[]>(FALLBACK_HOME_CATEGORIES);

  // "All" (id '0') shows everything; any other chip filters the main Restaurants list
  // below by matching its label against each restaurant's own cuisine/food-type tags.
  const [selectedCategoryId, setSelectedCategoryId] = useState('0');
  const filteredRestaurants = useMemo(() => {
    if (selectedCategoryId === '0') return restaurants;
    const category = homeCategories.find((c) => c.id === selectedCategoryId);
    const keyword = String(category?.label || '').trim().toLowerCase().replace(/s$/, '');
    if (!keyword) return restaurants;
    return restaurants.filter((r) => String(r.cuisine || r.desc || '').toLowerCase().includes(keyword));
  }, [restaurants, selectedCategoryId, homeCategories]);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

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

  // Platform-wide search (restaurant names + dish names) — debounced so every keystroke
  // doesn't fire a request; the search itself lives on the backend (publicOrderingService.search).
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{ restaurants: RestaurantRecord[]; menuItems: MenuItemSearchResult[] }>({
    restaurants: [],
    menuItems: [],
  });
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    const trimmed = text.trim();
    if (!trimmed) {
      searchRequestIdRef.current += 1;
      setSearching(false);
      setSearchResults({ restaurants: [], menuItems: [] });
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      const requestId = ++searchRequestIdRef.current;
      try {
        const results = await searchRestaurantsAndMenuItems(trimmed);
        if (requestId === searchRequestIdRef.current) {
          setSearchResults(results);
        }
      } catch (error) {
        console.log('[home] search failed:', error);
        if (requestId === searchRequestIdRef.current) {
          setSearchResults({ restaurants: [], menuItems: [] });
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setSearching(false);
        }
      }
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // Fetch and store user location on app open
  useEffect(() => {
    (async () => {
      const cachedOrFreshLocation = await warmupUserLocationCache({ dispatch });
      if (cachedOrFreshLocation) {
        const nextCoords = {
          latitude: cachedOrFreshLocation.latitude,
          longitude: cachedOrFreshLocation.longitude,
        };
        setDeviceCoords(nextCoords);

        console.log("nextCoords", nextCoords)

        // Resolve human-readable address once on home bootstrap and reuse across app.
        void hydrateCachedLocationAddress({ dispatch });
      }
    })();
  }, [dispatch]);
  const [activeOrderBanners, setActiveOrderBanners] = useState<ActiveOrderBannerItem[]>([]);
  const [homeDeals, setHomeDeals] = useState<DealMenuView[]>([]);
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
  useEffect(() => {
    if (!authUser?.uid) return;
    let cancelled = false;

    const refreshProfile = async () => {
      try {
        const latest = await userService.getUserProfile(authUser.uid, authUser.email);
        if (!cancelled && latest) {
          dispatch(setUser({ ...authUser, ...latest }));
        }
      } catch (error) {
        console.warn('Failed to refresh profile:', error);
      }
    };

    refreshProfile();
    const interval = setInterval(refreshProfile, 30000);

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

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
    if (!authUser?.uid && !authUser?.email) {
      setRestaurants([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Per-restaurant ratings (from reviewed orders) aren't migrated yet — no review/rating
      // system exists on the new backend (see menuService.ts's item-level rating note, same
      // gap here) — every restaurant comes back with rating 0 rather than an aggregate
      // computed from a Firestore `orders` scan the way this used to work.
      //
      // Deliberately NOT re-sorted here — the backend's ranking engine
      // (restaurantRanking.service.ts) already returns these in final ranked order
      // (organic score + sponsored/new-restaurant boosts + fairness rotation); an
      // alphabetical/displayOrder re-sort on top would silently discard all of that.
      const list = (await getRestaurants(deviceCoords)).filter((restaurantDoc: any) => restaurantDoc.available !== false);

      const withRatings = list.map((restaurant) => ({ ...restaurant, rating: 0, ratingCount: 0 } as RestaurantWithRating));

      setRestaurants(withRatings);
    } catch (error) {
      console.error('Failed to load restaurants:', error);
    } finally {
      setLoading(false);
    }
  }, [authUser?.uid, authUser?.email, deviceCoords]);

  const loadHomeDeals = useCallback(async () => {
    try {
      const activeDeals = await fetchActiveDeals({ onlyShowOnHome: true });
      if (activeDeals.length < 1) {
        setHomeDeals([]);
        return;
      }

      const hydratedDeals = await hydrateDealItemNames(activeDeals);
      setHomeDeals(hydratedDeals);
    } catch (error) {
      console.warn('Failed to load home deals.', error);
      setHomeDeals([]);
    }
  }, []);

  // "Order Again" data source — reuses the SAME getMyOrders() call the active-order-banner
  // poll above already makes; a completely separate effect here (rather than sharing state
  // with that poller) so a failure/slow response in one never blocks the other, per the
  // "one section's failure shouldn't break the whole home screen" requirement. Only
  // DELIVERED/COMPLETED orders count as "successfully ordered from this restaurant before" —
  // a cancelled-only history for a branch shouldn't resurface it here.
  const loadOrderAgain = useCallback(async () => {
    if (!authUser?.uid && !authUser?.email) {
      setRecentOrderBranchIds([]);
      return;
    }
    try {
      const orders = await getMyOrders();
      const eligible = orders
        .filter((order) => !['cancelled', 'rejected'].includes(String(order.status || '').toLowerCase()))
        .sort((a, b) => new Date(b.createdAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime());
      const branchIds: string[] = [];
      const seen = new Set<string>();
      for (const order of eligible) {
        const branchId = String(order.restaurantId || order.cafeId || '').trim();
        if (!branchId || seen.has(branchId)) continue;
        seen.add(branchId);
        branchIds.push(branchId);
      }
      setRecentOrderBranchIds(branchIds);
    } catch (error) {
      console.warn('Failed to load order history for Order Again.', error);
      setRecentOrderBranchIds([]);
    }
  }, [authUser?.uid, authUser?.email]);

  const loadOffers = useCallback(async () => {
    try {
      setOffersLoading(true);
      const nearby = await getOffersNearYou(deviceCoords);
      setOffers(nearby);
    } catch (error) {
      console.warn('Failed to load Offers Near You.', error);
      setOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [deviceCoords]);

  useFocusEffect(
    useCallback(() => {
      loadRestaurants();
    }, [loadRestaurants])
  );

  useFocusEffect(
    useCallback(() => {
      void loadHomeDeals();
    }, [loadHomeDeals])
  );

  useFocusEffect(
    useCallback(() => {
      void loadOrderAgain();
    }, [loadOrderAgain])
  );

  useFocusEffect(
    useCallback(() => {
      void loadOffers();
    }, [loadOffers])
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

  // useEffect(() => {
  //   const loadHomeCategories = async () => {
  //     try {
  //       const categoriesSnap = await getDocs(collection(db, getCollectionName(COLLECTION_NAMES.CATEGORIES)));
  //       const categories = categoriesSnap.docs
  //         .map((docSnap) => {
  //           const data = docSnap.data() as Record<string, unknown>;
  //           return {
  //             id: String(data.id || docSnap.id).trim(),
  //             label: String(data.name || '').trim(),
  //             icon: resolveCategoryIcon(data.icon, data.name),
  //             available: data.available !== false,
  //           };
  //         })
  //         .filter((item) => item.available && Boolean(item.id) && Boolean(item.label))
  //         .map((item) => ({
  //           id: item.id,
  //           label: item.label,
  //           icon: item.icon,
  //         } as HomeCategoryItem));

  //       if (categories.length > 0) {
  //         setHomeCategories([{ id: '0', label: 'All', icon: 'grid-outline' }, ...categories]);
  //         return;
  //       }

  //       setHomeCategories(FALLBACK_HOME_CATEGORIES);
  //     } catch (error) {
  //       console.warn('Failed to load categories for home.', error);
  //       setHomeCategories(FALLBACK_HOME_CATEGORIES);
  //     }
  //   };

  //   void loadHomeCategories();
  // }, []);

  useEffect(() => {
    if (!authUser?.uid && !authUser?.email) {
      setActiveOrderBanners([]);
      return;
    }

    let uidOrders: any[] = [];
    const emailOrders: any[] = [];
    let cancelled = false;

    const resolveCafeName = (order: any) => {
      const direct = String(order?.cafeName || order?.restaurantName || '').trim();
      if (direct) return direct;

      const orderKey = normalizeKey(order?.cafeId || order?.restaurantId);
      if (!orderKey) return 'Cafe';

      const matchedRestaurant = restaurantsRef.current.find((restaurant) => getRestaurantKeys(restaurant).has(orderKey));
      return matchedRestaurant?.name || 'Cafe';
    };

    const syncState = () => {
      const allOrdersById = new Map<string, any>();
      [...uidOrders, ...emailOrders].forEach((order) => {
        allOrdersById.set(String(order.id), order);
      });

      const activeOrders = Array.from(allOrdersById.values())
        .filter((order) => isOrderInProgress(order?.status))
        .sort((a, b) => getOrderCreatedAtMs(b) - getOrderCreatedAtMs(a));

      if (!activeOrders.length) {
        setActiveOrderBanners([]);
        return;
      }

      const bannerRows = activeOrders
        .map((order) => {
          const message = getHomeOrderBannerMessage(order?.status);
          if (!message) return null;
          return {
            orderId: String(order.id || ''),
            cafeName: resolveCafeName(order),
            status: formatOrderStatus(order?.status),
            message,
          } as ActiveOrderBannerItem;
        })
        .filter((item): item is ActiveOrderBannerItem => Boolean(item?.orderId));

      setActiveOrderBanners(bannerRows);
    };

    // No real-time order-status push exists on the new backend yet — polled instead of a
    // live Firestore `onSnapshot`. Email-based order lookup (a secondary/legacy path for
    // guest orders placed under an email rather than a logged-in account) has no backend
    // equivalent, since the new customer model is phone-based; only the logged-in-customer
    // path (by uid) is covered.
    const pollOrders = async () => {
      if (!authUser?.uid) return;
      try {
        const orders = await getMyOrders();
        if (cancelled) return;
        uidOrders = orders;
        syncState();
      } catch (error) {
        console.error('Order status poll failed:', error);
      }
    };

    if (authUser?.uid) {
      pollOrders();
    }
    const interval = setInterval(pollOrders, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authUser?.uid, authUser?.email]);

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

  const handleTrackActiveOrder = useCallback((orderId: string, status: string) => {
    if (!orderId) {
      return;
    }

    router.push({
      pathname: '/user/track-order',
      params: {
        orderId,
        status,
      },
    });
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

  // Tapping a category filters the "Restaurants" list in place (below) — it never
  // navigates anywhere. Matches against each restaurant's own cuisine/food-type tags
  // (the same "Cafe | Fast Food | Chinese" string already shown on its card), since
  // that's already loaded with the restaurant list — no extra per-restaurant menu-category
  // fetch needed just to power this chip row.
  const handleCategoryPress = useCallback((categoryId: string) => {
    setSelectedCategoryId(String(categoryId || '0').trim() || '0');
  }, []);

  const handleAddDealToCart = useCallback(async (deal: DealMenuView) => {
    try {
      const cartItems = await buildCartItemsForDeal(deal);
      if (cartItems.length < 1) {
        showAlert('Deal Unavailable', 'Some items in this deal are currently unavailable.');
        return;
      }

      addItems(cartItems as any[]);
    } catch (error) {
      console.warn('Failed to add deal to cart.', error);
      showAlert('Unable To Add Deal', 'Please try again in a moment.');
    }
  }, [addItems]);

  const getDealCartState = useCallback((deal: DealMenuView) => {
    const dealRows = cartItems.filter((entry) => entry.isDeal === true && String(entry.dealId || '').trim() === String(deal.firebaseId || '').trim());
    if (dealRows.length < 1) {
      return { quantity: 0, key: '' };
    }

    const quantities = dealRows.map((entry) => Math.max(1, Number(entry.quantity || 1)));
    const bundleQty = quantities.reduce((acc, value) => gcd(acc, value), quantities[0] || 1);
    const key = buildProductCartKey(dealRows[0] as any);

    return {
      quantity: Math.max(1, bundleQty),
      key,
    };
  }, [cartItems]);

  const handleDealIncrement = useCallback(async (deal: DealMenuView) => {
    const state = getDealCartState(deal);
    if (!state.key) {
      await handleAddDealToCart(deal);
      return;
    }
    dispatch(incrementQuantity(state.key));
  }, [dispatch, getDealCartState, handleAddDealToCart]);

  const handleDealDecrement = useCallback((deal: DealMenuView) => {
    const state = getDealCartState(deal);
    if (!state.key) return;

    if (state.quantity <= 1) {
      dispatch(removeFromCart(state.key));
      return;
    }
    dispatch(decrementQuantity(state.key));
  }, [dispatch, getDealCartState]);

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

      <AnnouncementBottomSheet
        visible={isAnnouncementVisible}
        title={announcementConfig?.title || ''}
        description={announcementConfig?.description || ''}
        imageUrl={announcementConfig?.imageUrl ?? null}
        onClose={() => setIsAnnouncementVisible(false)}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: activeOrderBanners.length > 0 ? 120 : Math.max(28, insets.bottom + 24),
        }}
      >
        <SearchBar>
          <Ionicons name="search-outline" size={moderateScale(20)} color="#8b8b8b" />
          <SearchInput
            value={searchQuery}
            onChangeText={handleSearchChange}
            placeholder="Search restaurants or dishes..."
            placeholderTextColor="#9a9a9a"
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <SearchClearButton onPress={() => handleSearchChange('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#b0b0b0" />
            </SearchClearButton>
          ) : null}
        </SearchBar>

        {searchQuery.trim().length > 0 ? (
          <>
            {searching ? (
              <SearchStatusText>Searching…</SearchStatusText>
            ) : searchResults.restaurants.length === 0 && searchResults.menuItems.length === 0 ? (
              <SearchStatusText>No restaurants or dishes found for &quot;{searchQuery.trim()}&quot;.</SearchStatusText>
            ) : (
              <>
                {searchResults.restaurants.length > 0 ? (
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

                {searchResults.menuItems.length > 0 ? (
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
                          <DishResultName numberOfLines={1}>{item.name}</DishResultName>
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
        <CategoriesScroll horizontal showsHorizontalScrollIndicator={false}>
          {homeCategories.map((category) => {
            const isActive = category.id === selectedCategoryId;
            return (
              <CategoryPill key={category.id} activeOpacity={0.85} onPress={() => handleCategoryPress(category.id)}>
                <CategoryIconWrap $active={isActive}>
                  <Ionicons name={category.icon as any} size={moderateScale(24)} color={isActive ? '#fff' : '#f68712'} />
                </CategoryIconWrap>
                <CategoryLabel $active={isActive} numberOfLines={1}>{category.label}</CategoryLabel>
              </CategoryPill>
            );
          })}
        </CategoriesScroll>

        <HeroBanner activeOpacity={0.92} onPress={() => primaryRestaurant && handleOpenRestaurant(primaryRestaurant)}>
          <HeroBannerContent>
            <HeroBannerTitle>Delicious Food,{'\n'}Faster at Your Doorstep!</HeroBannerTitle>
            <HeroBannerSubtitle>Good Food · Great Restaurants · Happy You</HeroBannerSubtitle>
            <HeroBannerCta>
              <HeroBannerCtaText>Order Now</HeroBannerCtaText>
              <Ionicons name="arrow-forward" size={moderateScale(15)} color="#f68712" />
            </HeroBannerCta>
          </HeroBannerContent>
          <HeroBannerIconWrap>
            <Ionicons name="fast-food" size={moderateScale(64)} color="rgba(255,255,255,0.35)" />
          </HeroBannerIconWrap>
        </HeroBanner>

        {/* Order Again — returning-user only; a brand-new account with no order history
            simply never sees this section (never an empty carousel or placeholder text). */}
        {orderAgainRestaurants.length > 0 ? (
          <>
            <SectionHeader>
              <SectionHeading>Order Again</SectionHeading>
            </SectionHeader>
            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
              {orderAgainRestaurants.map((restaurantItem) => (
                <RestaurantMiniCard
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
              <SectionHeading>Recommended for You</SectionHeading>
            </SectionHeader>
            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
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

        {/* New restaurants (Feature 10) — age + successful-order-count gated, hidden
            entirely once nothing currently qualifies. */}
        {!loading && newRestaurants.length > 0 ? (
          <>
            <SectionHeader>
              <SectionHeadingGroup>
                <SectionHeading>New on Prayagi</SectionHeading>
                <SectionSubheading>Freshly listed restaurants near you</SectionSubheading>
              </SectionHeadingGroup>
            </SectionHeader>
            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
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

        {/* Offers Near You — every card is a real coupon tied to a real nearby branch (see
            services/offersService.ts); hidden entirely when nothing currently qualifies,
            same as every other discovery section. */}
        {!offersLoading && offers.length > 0 ? (
          <>
            <SectionHeader>
              <SectionHeading>Offers Near You</SectionHeading>
            </SectionHeader>
            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
              {offers.map((offer) => (
                <OfferCard key={offer.offerId} offer={offer} onPress={() => handleOfferPress(offer)} />
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
          <EmptyText>No restaurants match this category right now.</EmptyText>
        ) : (
          <EmptyText>No restaurants found.</EmptyText>
        )}


        {loading ? (
          <>
            <SectionHeader>
              <SectionHeading>Offers Near You</SectionHeading>
            </SectionHeader>
            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
              {Array.from({ length: 2 }).map((_, index) => (
                <DealCard key={`deal-skeleton-${index}`}>
                  <ShimmerBlock style={[shimmerAnimatedStyle, { width: '100%', height: moderateVerticalScale(124) }]} />
                  <DealContent>
                    <ShimmerBlock style={[shimmerAnimatedStyle, { width: '78%', height: moderateVerticalScale(14), borderRadius: moderateScale(7), marginBottom: moderateVerticalScale(8) }]} />
                    <ShimmerBlock style={[shimmerAnimatedStyle, { width: '92%', height: moderateVerticalScale(11), borderRadius: moderateScale(6), marginBottom: moderateVerticalScale(6) }]} />
                    <ShimmerBlock style={[shimmerAnimatedStyle, { width: '66%', height: moderateVerticalScale(11), borderRadius: moderateScale(6), marginBottom: moderateVerticalScale(12) }]} />
                    <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(84), height: moderateVerticalScale(20), borderRadius: moderateScale(8) }]} />
                  </DealContent>
                </DealCard>
              ))}
            </DealsScroll>
          </>
        ) : homeDeals.length > 0 ? (
          <>
            <SectionHeader>
              <SectionHeading>Offers Near You</SectionHeading>
              <SectionLink activeOpacity={0.85} onPress={() => router.push('/user/deals')}>
                <SectionLinkText>View All</SectionLinkText>
                <Ionicons name="arrow-forward" size={moderateScale(16)} color="#f68712" />
              </SectionLink>
            </SectionHeader>

            <DealsScroll horizontal showsHorizontalScrollIndicator={false}>
              {homeDeals.map((deal) => {
                const dealPrice = Math.max(0, Number(deal.pricing?.dealPrice || 0));
                const description = buildDealDescription(deal);
                const savingsLabel = getDealSavingsLabel(deal);

                return (
                  <DealCard key={deal.firebaseId}>
                    <DealImageWrap>
                      <AppImage
                        uri={deal.image}
                        fallbackUri={FALLBACK_CAFE_IMAGE}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </DealImageWrap>
                    <DealContent>
                      <DealTitle numberOfLines={1}>{deal.name || 'Today\'s Deal'}</DealTitle>
                      <DealDescription numberOfLines={2}>{description || 'Includes combo items'}</DealDescription>
                      <DealPriceRow>
                        <DealPrimaryPrice>₹{dealPrice.toFixed(0)}</DealPrimaryPrice>
                      </DealPriceRow>
                      <DealBottomRow>
                        <DealSavingsBadge>
                          <DealSavingsText>{savingsLabel}</DealSavingsText>
                        </DealSavingsBadge>
                        {(() => {
                          const dealState = getDealCartState(deal);
                          if (dealState.quantity > 0) {
                            return (
                              <DealQtyControl>
                                <DealQtyButton activeOpacity={0.86} onPress={() => handleDealDecrement(deal)}>
                                  <DealQtyButtonText>-</DealQtyButtonText>
                                </DealQtyButton>
                                <DealQtyValue>{dealState.quantity}</DealQtyValue>
                                <DealQtyButton activeOpacity={0.86} onPress={() => void handleDealIncrement(deal)}>
                                  <DealQtyButtonText>+</DealQtyButtonText>
                                </DealQtyButton>
                              </DealQtyControl>
                            );
                          }

                          return (
                            <DealAddButton activeOpacity={0.86} onPress={() => void handleDealIncrement(deal)}>
                              <DealAddText>ADD</DealAddText>
                            </DealAddButton>
                          );
                        })()}
                      </DealBottomRow>
                    </DealContent>
                  </DealCard>
                );
              })}
            </DealsScroll>
          </>
        ) : null}


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



        {loading ? (
          <TrustStrip>
            {Array.from({ length: 4 }).map((_, index) => (
              <TrustItem key={`trust-skeleton-${index}`}>
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: moderateScale(18), height: moderateVerticalScale(18), borderRadius: moderateScale(9), marginBottom: moderateVerticalScale(5) }]} />
                <ShimmerBlock style={[shimmerAnimatedStyle, { width: '90%', height: moderateVerticalScale(10), borderRadius: moderateScale(5) }]} />
              </TrustItem>
            ))}
          </TrustStrip>
        ) : (
          <TrustStrip>
            <TrustItem>
              <Ionicons name="ribbon-outline" size={moderateScale(18)} color="#f68712" />
              <TrustText>Extra 10% OFF</TrustText>
            </TrustItem>
            <TrustItem>
              <Ionicons name="medal-outline" size={moderateScale(18)} color="#f68712" />
              <TrustText>Earn Rewards</TrustText>
            </TrustItem>
            <TrustItem>
              <Ionicons name="shield-checkmark-outline" size={moderateScale(18)} color="#16a34a" />
              <TrustText>Secure Payment</TrustText>
            </TrustItem>
            <TrustItem>
              <Ionicons name="leaf-outline" size={moderateScale(18)} color="#16a34a" />
              <TrustText>100% Pure Veg</TrustText>
            </TrustItem>
          </TrustStrip>
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
                <ActiveOrderBar>
                  <ActiveOrderContent>
                    <ActiveOrderTitle numberOfLines={1}>{item.message}</ActiveOrderTitle>
                  </ActiveOrderContent>
                  <ActiveOrderTrackButton onPress={() => handleTrackActiveOrder(item.orderId, item.status)}>
                    <ActiveOrderTrackText>Track</ActiveOrderTrackText>
                    <Ionicons name="arrow-forward" size={moderateScale(16)} color="#fff" />
                  </ActiveOrderTrackButton>
                </ActiveOrderBar>
              </ActiveOrderSlide>
            )}
          />
          <ActiveOrderDotsRow>
            {activeOrderBanners.map((item, index) => (
              <ActiveOrderDot
                key={`${item.orderId}-${index}`}
                $active={index === activeOrderIndex}
              />
            ))}
          </ActiveOrderDotsRow>
        </ActiveOrdersStrip>
      ) : null}

      {totalCartCount > 0 ? (
        <HomeCartFab
          activeOpacity={0.88}
          onPress={() => router.push('/user/cart')}
          style={{ bottom: activeOrderBanners.length > 0 ? moderateVerticalScale(92) : Math.max(moderateVerticalScale(24), insets.bottom + moderateVerticalScale(12)) }}
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
const Container = styled.SafeAreaView`
  flex: 1;
  background-color: #fff;
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
  color: #f68712;
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

const CategoriesScroll = styled.ScrollView`
  margin-top: 0px;
`;

const CategoryPill = styled.TouchableOpacity`
  width: ${moderateScale(68)}px;
  margin-right: ${moderateScale(10)}px;
  align-items: center;
`;

const CategoryIconWrap = styled.View<{ $active?: boolean }>`
  width: ${moderateScale(50)}px;
  height: ${moderateVerticalScale(50)}px;
  border-radius: ${moderateScale(10)}px;
  border-width: 1px;
  border-color: ${({ $active }: { $active?: boolean }) => ($active ? '#f68712' : '#f2e7d9')};
  background-color: ${({ $active }: { $active?: boolean }) => ($active ? '#f68712' : '#fff8ef')};
  align-items: center;
  justify-content: center;
  margin-bottom: ${moderateVerticalScale(7)}px;
`;

const CategoryLabel = styled.Text<{ $active?: boolean }>`
  color: ${({ $active }: { $active?: boolean }) => ($active ? '#f68712' : '#202020')};
  font-size: ${scaleFont(13)}px;
  text-align: center;
  font-weight: 700;
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

const SectionHeadingGroup = styled.View``;

const SectionSubheading = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: #8b8b8b;
  font-size: ${scaleFont(12)}px;
  font-weight: 500;
`;

const HeroBanner = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #f68712;
  border-radius: ${moderateScale(18)}px;
  padding: ${moderateScale(16)}px;
  margin-top: ${moderateVerticalScale(4)}px;
  margin-bottom: ${moderateVerticalScale(6)}px;
  overflow: hidden;
`;

const HeroBannerContent = styled.View`
  flex-shrink: 1;
  padding-right: ${moderateScale(10)}px;
`;

const HeroBannerTitle = styled.Text`
  color: #fff;
  font-size: ${scaleFont(19)}px;
  font-weight: 900;
  line-height: ${scaleFont(24)}px;
`;

const HeroBannerSubtitle = styled.Text`
  margin-top: ${moderateVerticalScale(6)}px;
  color: rgba(255, 255, 255, 0.9);
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;

const HeroBannerCta = styled.View`
  flex-direction: row;
  align-items: center;
  align-self: flex-start;
  margin-top: ${moderateVerticalScale(12)}px;
  background-color: #fff;
  border-radius: ${moderateScale(10)}px;
  padding: ${moderateVerticalScale(9)}px ${moderateScale(14)}px;
`;

const HeroBannerCtaText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
  margin-right: ${moderateScale(6)}px;
`;

const HeroBannerIconWrap = styled.View`
  width: ${moderateScale(84)}px;
  height: ${moderateVerticalScale(84)}px;
  border-radius: ${moderateScale(42)}px;
  background-color: rgba(255, 255, 255, 0.15);
  align-items: center;
  justify-content: center;
`;

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
  color: #f68712;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  margin-right: ${moderateScale(4)}px;
`;

const DealsScroll = styled.ScrollView`
  margin-top: ${moderateVerticalScale(2)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
`;

const DealCard = styled.View`
  width: ${moderateScale(252)}px;
  margin-right: ${moderateScale(12)}px;
  border-width: 1px;
  border-color: #ececec;
  border-radius: ${moderateScale(14)}px;
  overflow: hidden;
  background-color: #fff;
`;

const DealImageWrap = styled.View`
  width: 100%;
  height: ${moderateVerticalScale(124)}px;
  background-color: #f4f4f4;
`;

const DealContent = styled.View`
  padding: ${moderateScale(10)}px;
`;

const DealTitle = styled.Text`
  color: #1b1b1b;
  font-size: ${scaleFont(15)}px;
  font-weight: 800;
`;

const DealDescription = styled.Text`
  margin-top: ${moderateVerticalScale(5)}px;
  color: #616161;
  font-size: ${scaleFont(12)}px;
  font-weight: 500;
  min-height: ${moderateVerticalScale(32)}px;
`;

const DealPriceRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: ${moderateVerticalScale(10)}px;
`;

const DealPrimaryPrice = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(20)}px;
  font-weight: 900;
`;

const DealBottomRow = styled.View`
  margin-top: ${moderateVerticalScale(10)}px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const DealSavingsBadge = styled.View`
  background-color: #eaffea;
  border-width: 1px;
  border-color: #d5f6d5;
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateVerticalScale(5)}px ${moderateScale(8)}px;
`;

const DealSavingsText = styled.Text`
  color: #1f8f3a;
  font-size: ${scaleFont(11)}px;
  font-weight: 700;
`;

const DealAddButton = styled.TouchableOpacity`
  border-radius: ${moderateScale(9)}px;
  border-width: 1px;
  border-color: #ffd3a8;
  background-color: #fff6ec;
  padding: ${moderateVerticalScale(7)}px ${moderateScale(10)}px;
`;

const DealAddText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(12)}px;
  font-weight: 800;
`;

const DealQtyControl = styled.View`
  flex-direction: row;
  align-items: center;
  border-width: 1px;
  border-color: #ffd3a8;
  background-color: #fff6ec;
  border-radius: ${moderateScale(10)}px;
  padding: ${moderateVerticalScale(4)}px ${moderateScale(6)}px;
`;

const DealQtyButton = styled.TouchableOpacity`
  width: ${moderateScale(24)}px;
  height: ${moderateVerticalScale(24)}px;
  border-radius: ${moderateScale(8)}px;
  align-items: center;
  justify-content: center;
`;

const DealQtyButtonText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(16)}px;
  font-weight: 800;
`;

const DealQtyValue = styled.Text`
  min-width: ${moderateScale(20)}px;
  text-align: center;
  color: #1b1b1b;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const ScratchCard = styled.TouchableOpacity`
  border-radius: ${moderateScale(16)}px;
  background-color: #7e3af2;
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
  background-color: #f68712;
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

const ActiveOrderBar = styled.View`
  min-height: ${moderateVerticalScale(72)}px;
  background-color: #16a34a;
  padding: ${moderateScale(14)}px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  shadow-color: #14532d;
  shadow-opacity: 0.2;
  shadow-radius: ${moderateScale(10)}px;
  shadow-offset: 0px ${moderateVerticalScale(6)}px;
  elevation: 2;
`;

const ActiveOrderDotsRow = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: ${moderateVerticalScale(8)}px;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  pointer-events: none;
`;

const ActiveOrderDot = styled.View<{ $active: boolean }>`
  width: ${({ $active }) => ($active ? `${moderateScale(16)}px` : `${moderateScale(8)}px`)};
  height: ${moderateVerticalScale(8)}px;
  border-radius: ${moderateScale(999)}px;
  margin: 0 ${moderateScale(4)}px;
  background-color: ${({ $active }) => ($active ? '#ffffff' : '#9ca3af')};
`;

const ActiveOrderContent = styled.View`
  flex: 1;
  padding-right: ${moderateScale(12)}px;
`;

const ActiveOrderTitle = styled.Text`
  color: #fff;
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;

const ActiveOrderTrackButton = styled.TouchableOpacity`
  background-color: rgba(255, 255, 255, 0.18);
  border-radius: ${moderateScale(14)}px;
  padding: ${moderateVerticalScale(12)}px ${moderateScale(14)}px;
  flex-direction: row;
  align-items: center;
`;

const ActiveOrderTrackText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  margin-right: ${moderateScale(6)}px;
`;
