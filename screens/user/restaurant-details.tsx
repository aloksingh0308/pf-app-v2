import PageHeader from '@/components/common/PageHeader';
import AppImage from '@/components/AppImage';
import CustomizeItemModal from '@/components/CustomizeItemModal';
import ProductCard from '@/components/ProductCard';
import FoodTypeMark from '@/components/common/FoodTypeMark';
import { useAppLoader } from '@/hooks/useAppLoader';
import { decrementQuantity, incrementQuantity } from '@/store/slices/cartSlice';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { Category } from '@/types/Categories';
import { FoodType, Product, ProductWithFirebaseId } from '@/types/Product';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { FlatList, ScrollView, SectionList, TextInput, View, Text, Pressable, StyleSheet, Share, Modal, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateCartTotals, getDealBundleQuantity } from '@/utils/dealCart';
import { formatDistance, formatEta, getRestaurantOpeningStatus } from '@/services/restaurantService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { showAlert } from '../../services/alertService';
import { getCategories, getMenuItems } from '../../services/menuService';
import { setActiveRestaurant, setPendingOffer } from '../../services/restaurantContext';
import { buildCartItemsForDeal, buildDealDescription, fetchActiveDeals, hydrateDealItemNames } from '../../services/dealsService';
import { BranchOfferRecord, formatBranchOfferHeadline, getBranchOffers } from '../../services/offersService';
import { DealMenuView } from '@/types/Deal';
import { RootState } from '../../store';
import { buildProductCartKey } from '@/utils/productVariants';
import RestaurantPausedBanner from '@/components/RestaurantPausedBanner';
import { restaurantShareUrl, WEBSITE_ORIGIN } from '@/utils/deepLinks';


const getComboSavingsLabel = (deal: DealMenuView): string => {
  const original = Number(deal.pricing?.totalPrice || 0);
  const dealPrice = Number(deal.pricing?.dealPrice || 0);
  const absoluteSavings = Math.max(0, original - dealPrice);
  if (absoluteSavings > 0) {
    return `Save ₹${absoluteSavings.toFixed(0)}`;
  }
  const discountType = String(deal.pricing?.discountType || '').toLowerCase();
  if (discountType === 'percentage') {
    const percent = Math.max(0, Math.min(100, Number(deal.pricing?.discountValue || 0)));
    if (percent > 0) return `${percent.toFixed(0)}% OFF`;
  }
  return 'Combo Deal';
};

/** Menu food-type filter. "Veg" includes vegan dishes (vegan is a subset of veg). */
type FoodFilter = 'ALL' | 'VEG' | 'EGG' | 'NON_VEG';
const FOOD_FILTERS: Array<{ id: FoodFilter; label: string; mark?: FoodType }> = [
  { id: 'ALL', label: 'All' },
  { id: 'VEG', label: 'Veg', mark: 'VEG' },
  { id: 'EGG', label: 'Egg', mark: 'EGG' },
  { id: 'NON_VEG', label: 'Non-Veg', mark: 'NON_VEG' },
];
const matchesFoodFilter = (foodType: FoodType | undefined, filter: FoodFilter) => {
  if (filter === 'ALL') return true;
  const type = foodType || 'VEG';
  if (filter === 'VEG') return type === 'VEG' || type === 'VEGAN';
  return type === filter;
};

type PriceSort = 'NONE' | 'LOW_TO_HIGH' | 'HIGH_TO_LOW';
const PRICE_SORTS: Array<{ id: PriceSort; label: string }> = [
  { id: 'NONE', label: 'Relevance' },
  { id: 'LOW_TO_HIGH', label: 'Price: Low to High' },
  { id: 'HIGH_TO_LOW', label: 'Price: High to Low' },
];

/** Everything the filter sheet controls, edited as a draft so Cancel can throw it away. */
type MenuFilters = { priceSort: PriceSort; availableOnly: boolean; foodFilter: FoodFilter };
const DEFAULT_FILTERS: MenuFilters = { priceSort: 'NONE', availableOnly: false, foodFilter: 'ALL' };
const countActiveFilters = (filters: MenuFilters) =>
  Number(filters.priceSort !== 'NONE') + Number(filters.availableOnly) + Number(filters.foodFilter !== 'ALL');

type MenuSection = { id: string; title: string; data: ProductWithFirebaseId[] };

const SERVICE_UNAVAILABLE_MESSAGE = 'Our services are not available in your region. We will be available soon (Coming Soon).';

type Restaurant = {
  id: string;
  restaurantId?: string;
  cafeId?: string;
  orgSlug?: string;
  branchCode?: string;
  name?: string;
  cuisine?: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  rating?: number;
  ratingCount?: number;
  distanceKm?: number;
  eta?: { min: number; max: number; exceedsMax: boolean };
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
};

const normalizeKey = (value: unknown) => String(value || '').trim().toLowerCase();

const getRestaurantKeys = (restaurant: Restaurant | null) => {
  if (!restaurant) return new Set<string>();
  const keys = [restaurant.id, restaurant.restaurantId, restaurant.cafeId]
    .map((value) => normalizeKey(value))
    .filter(Boolean);
  return new Set(keys);
};

const getProductCartKey = (product: { firebaseId?: string; id?: string }) =>
  buildProductCartKey(product as any);

export default function RestaurantDetailsScreen() {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const { addItem, addItems } = useAddToCartWithRestaurantGuard();
  const { restaurant, categoryId } = useLocalSearchParams();

  // Ensure categoryId is always a string
  const normalizedCategoryId = Array.isArray(categoryId) ? categoryId[0] : categoryId;

  const parsedRestaurant: Restaurant | null = useMemo(() => {
    try {
      if (!restaurant) return null;
      const raw = Array.isArray(restaurant) ? restaurant[0] : restaurant;
      return JSON.parse(raw) as Restaurant;
    } catch {
      return null;
    }
  }, [restaurant]);


  const [menuItems, setMenuItems] = useState<ProductWithFirebaseId[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<MenuFilters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<MenuFilters>(DEFAULT_FILTERS);
  const { priceSort, availableOnly: inStockOnly, foodFilter } = filters;
  const setFoodFilter = (foodFilter: FoodFilter) => setFilters(current => ({ ...current, foodFilter }));
  const [filtersVisible, setFiltersVisible] = useState(false);
  const openFilters = () => { setDraftFilters(filters); setFiltersVisible(true); };
  const cancelFilters = () => { setDraftFilters(filters); setFiltersVisible(false); };
  const applyDraftFilters = () => { setFilters(draftFilters); setFiltersVisible(false); };
  const activeFilterCount = countActiveFilters(filters);
  const [saved, setSaved] = useState(false);
  const listRef = useRef<SectionList<ProductWithFirebaseId, MenuSection>>(null);
  const comboOffset = useRef(0);
  const favouriteKey = `restaurant_favourite_${parsedRestaurant?.id || ''}`;
  useEffect(() => { AsyncStorage.getItem(favouriteKey).then(value => setSaved(value === '1')).catch(() => {}); }, [favouriteKey]);
  const [selectedCategory, setSelectedCategory] = useState(normalizedCategoryId || '0');
  const [menuItemCategories, setMenuItemCategories] = useState<Category[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [combos, setCombos] = useState<DealMenuView[]>([]);
  const [offers, setOffers] = useState<BranchOfferRecord[]>([]);
  const isWithinServiceArea = true;
  const [customizeProduct, setCustomizeProduct] = useState<ProductWithFirebaseId | null>(null);
  const appLoader = useAppLoader();

  const handleOpenCustomizeModal = useCallback((product: Product) => {
    setCustomizeProduct(product as ProductWithFirebaseId);
  }, []);


  const applyFilters = (
    items: ProductWithFirebaseId[],
    categoryId: string,
    queryText: string,
    categoriesOverride?: Category[]
  ) => {
    const availableCategoryIds = new Set((categoriesOverride || menuItemCategories).map((category) => category.id));
    const normalizedQuery = String(queryText || '').trim().toLowerCase();

    return items.filter((item) => {
      const matchesCategory = categoryId === '0'
        ? (!item.categoryId || availableCategoryIds.has(item.categoryId))
        : item.categoryId === categoryId;

      if (!matchesCategory) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchText = `${String(item.name || '')} ${String((item as any)?.description || '')}`.toLowerCase();
      return searchText.includes(normalizedQuery);
    });
  };

  const filteredItems = useMemo(
    () => {
      const items = applyFilters(menuItems, selectedCategory, searchQuery)
        .filter(item => !inStockOnly || item.inStock !== false)
        .filter(item => matchesFoodFilter(item.foodType, foodFilter));
      if (priceSort === 'LOW_TO_HIGH') return [...items].sort((a, b) => a.price - b.price);
      if (priceSort === 'HIGH_TO_LOW') return [...items].sort((a, b) => b.price - a.price);
      return items;
    },
    [menuItems, selectedCategory, searchQuery, menuItemCategories, inStockOnly, priceSort, foodFilter]
  );

  // Category-wise listing: one section per menu category in the restaurant's own display
  // order (price sorting applies within each section). Items whose category isn't listed
  // land in a trailing "More items" section rather than disappearing.
  const menuSections = useMemo<MenuSection[]>(() => {
    const byCategory = new Map<string, ProductWithFirebaseId[]>();
    filteredItems.forEach(item => {
      const key = String(item.categoryId || '');
      byCategory.set(key, [...(byCategory.get(key) || []), item]);
    });
    const ordered = [...menuItemCategories].sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0));
    const sections: MenuSection[] = ordered
      .filter(category => byCategory.has(category.id))
      .map(category => ({ id: category.id, title: category.name, data: byCategory.get(category.id) || [] }));
    const listed = new Set(ordered.map(category => category.id));
    const leftovers = [...byCategory.entries()].filter(([key]) => !listed.has(key)).flatMap(([, items]) => items);
    if (leftovers.length > 0) sections.push({ id: 'other', title: 'More items', data: leftovers });
    return sections;
  }, [filteredItems, menuItemCategories]);

  // All / Veg / Non-Veg are always offered; Egg only when this menu actually has egg dishes.
  const availableFoodFilters = useMemo(() => {
    const hasEgg = menuItems.some(item => item.foodType === 'EGG');
    return FOOD_FILTERS.filter(filter => filter.id !== 'EGG' || hasEgg);
  }, [menuItems]);


  useEffect(() => {
    const initializeHome = async () => {
      try {
        setLoadingHome(true);

        // Which restaurant's menu/orders/deals every service call below should hit — this
        // app is a cross-organization marketplace now, so it's resolved per-screen from
        // the restaurant that was actually tapped, not a build-wide fixed org/branch.
        setActiveRestaurant(parsedRestaurant);

        // Real per-branch combos (Admin's Combos page) — own try/catch so a combos
        // failure never blocks the rest of this screen's menu from loading.
        try {
          const activeDeals = await fetchActiveDeals({ forceRefresh: true });
          setCombos(activeDeals.length > 0 ? await hydrateDealItemNames(activeDeals) : []);
        } catch (comboError) {
          console.warn('Failed to load combos.', comboError);
          setCombos([]);
        }

        // Real per-branch offers (Admin's Offers page) — informational only, own
        // try/catch for the same reason as combos above.
        try {
          setOffers(await getBranchOffers());
        } catch (offersError) {
          console.warn('Failed to load offers.', offersError);
          setOffers([]);
        }

        const categories = await getCategories();

        const selectedRestaurantKeysForCategories = getRestaurantKeys(parsedRestaurant);
        const availableCategories = (categories as Category[]).filter((category) => {
          if (!Boolean((category as any).available)) return false;
          if (selectedRestaurantKeysForCategories.size === 0) return true;
          const categoryKey = normalizeKey((category as any)?.cafeId || (category as any)?.restaurantId);
          if (!categoryKey) return true;
          return selectedRestaurantKeysForCategories.has(categoryKey);
        });
        setMenuItemCategories(availableCategories);


        const items = await getMenuItems();
        const filteredByCafe = items.filter((item) => {
          if (!parsedRestaurant) return true;
          const selectedKeys = getRestaurantKeys(parsedRestaurant);
          const key = normalizeKey((item as any)?.cafeId || (item as any)?.restaurantId || (item as any)?.restaurantID || (item as any)?.restaurant);
          if (!key) return true;
          return selectedKeys.has(key);
        }).map((item) => {
          if (parsedRestaurant?.id) {
            const fallbackId = String(parsedRestaurant.id).trim();
            return {
              ...item,
              cafeId: (item as any)?.cafeId || (item as any)?.restaurantId || fallbackId,
              restaurantId: (item as any)?.restaurantId || (item as any)?.cafeId || fallbackId,
            } as ProductWithFirebaseId;
          }
          return item;
        });

        // Per-item ratings aren't migrated to the new backend yet (see menuService.ts) —
        // every item comes back with rating 0 rather than an enriched per-restaurant
        // review lookup the way the old Firestore `productReviews` query did.
        setMenuItems(filteredByCafe);

        void applyFilters(filteredByCafe, '0', '', availableCategories);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingHome(false);
        appLoader.hide();
      }
    };

    initializeHome();
  }, [parsedRestaurant?.id]);


  const onProductPress = (product: ProductWithFirebaseId) => {
    router.push({
      pathname: '/user/product-details',
      params: { product: JSON.stringify(product) },
    });
  };

  const handleAddComboToCart = useCallback(async (deal: DealMenuView) => {
    if (!isWithinServiceArea) {
      showAlert('Coming Soon', SERVICE_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      const dealCartItems = await buildCartItemsForDeal(deal);
      if (dealCartItems.length < 1) {
        showAlert('Combo Unavailable', 'Some items in this combo are currently unavailable.');
        return;
      }
      addItems(dealCartItems as any[], { next: parsedRestaurant?.name });
    } catch (comboAddError) {
      console.warn('Failed to add combo to cart.', comboAddError);
      showAlert('Unable To Add Combo', 'Please try again in a moment.');
    }
  }, [isWithinServiceArea, addItems, parsedRestaurant?.name]);

  const getComboCartState = useCallback((deal: DealMenuView) => {
    const dealRows = cartItems.filter((entry) => (entry as any).isDeal === true && String((entry as any).dealId || '').trim() === String(deal.firebaseId || '').trim());
    if (dealRows.length < 1) {
      return { quantity: 0, key: '' };
    }
    const bundleQty = getDealBundleQuantity(dealRows as any);
    const key = getProductCartKey(dealRows[0] as any);
    return { quantity: Math.max(1, bundleQty), key };
  }, [cartItems]);

  const handleComboIncrement = useCallback(async (deal: DealMenuView) => {
    const state = getComboCartState(deal);
    if (!state.key) {
      await handleAddComboToCart(deal);
      return;
    }
    dispatch(incrementQuantity(state.key));
  }, [dispatch, getComboCartState, handleAddComboToCart]);

  const handleComboDecrement = useCallback((deal: DealMenuView) => {
    const state = getComboCartState(deal);
    if (state.key) dispatch(decrementQuantity(state.key));
  }, [dispatch, getComboCartState]);

  const totals = calculateCartTotals(cartItems);
  const cover = parsedRestaurant?.coverImage || parsedRestaurant?.image;
  const opening = parsedRestaurant?.openingHours ? getRestaurantOpeningStatus(parsedRestaurant.openingHours) : null;
  const categories = [{ id: '0', name: 'All' }, ...menuItemCategories];
  const maxSaving = Math.max(0, ...combos.map(deal => Number(deal.pricing.totalPrice || 0) - Number(deal.pricing.dealPrice || 0)));
  const scrollToCombos = () => (listRef.current as any)?.getScrollResponder?.()?.scrollTo({ y: comboOffset.current, animated: true });
  const iconForCategory = (name: string) => {
    const value = name.toLowerCase();
    if (value === 'all') return 'grid-outline';
    if (/coffee|tea|beverage|drink/.test(value)) return 'cafe-outline';
    if (/burger|sandwich/.test(value)) return 'fast-food-outline';
    if (/pizza/.test(value)) return 'pizza-outline';
    if (/sweet|dessert/.test(value)) return 'ice-cream-outline';
    return 'restaurant-outline';
  };
  const renderCombo = ({ item: deal }: { item: DealMenuView }) => {
    const state = getComboCartState(deal);
    const price = Number(deal.pricing.dealPrice || 0);
    const original = Number(deal.pricing.totalPrice || 0);
    return <View style={styles.comboCard} collapsable={false}>
      <AppImage uri={deal.image || cover} style={styles.comboImage} />
      <View style={{ padding: 10 }}>
        <Text numberOfLines={1} style={styles.comboName}>{deal.name}</Text>
        <Text numberOfLines={1} style={styles.muted}>{buildDealDescription(deal)}</Text>
        <View style={[styles.row, { marginTop: 10, justifyContent: 'space-between' }]}>
          <View><View style={styles.row}><Text style={styles.price}>₹{price.toFixed(0)}</Text>{original > price && <Text style={styles.oldPrice}>₹{original.toFixed(0)}</Text>}</View>{original > price && <Text style={styles.savings}>{getComboSavingsLabel(deal)}</Text>}</View>
          {state.quantity ? <View style={styles.stepper}><Pressable accessibilityLabel={`Remove one ${deal.name}`} onPress={() => handleComboDecrement(deal)} style={styles.step}><Ionicons name="remove" size={18} color="#ff7500" /></Pressable><Text style={styles.stepValue}>{state.quantity}</Text><Pressable accessibilityLabel={`Add one ${deal.name}`} onPress={() => void handleComboIncrement(deal)} style={styles.step}><Ionicons name="add" size={18} color="#ff7500" /></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Add ${deal.name}`} onPress={() => void handleComboIncrement(deal)} style={styles.comboAdd}><Ionicons name="add" size={25} color="#fff" /></Pressable>}
        </View>
      </View>
    </View>;
  };

  return <View style={styles.page}>
    <PageHeader title={parsedRestaurant?.name || 'Restaurant'} actions={[
      { icon: saved ? 'heart' : 'heart-outline', label: saved ? 'Unsave restaurant' : 'Save restaurant', onPress: async () => {
        try { await AsyncStorage.setItem(favouriteKey, saved ? '0' : '1'); setSaved(!saved); }
        catch { showAlert('Unable to save', 'Please try again.'); }
      } },
      { icon: 'share-social-outline', label: 'Share restaurant', onPress: () => {
        // Universal link: opens this restaurant in the app (or the login page if signed out),
        // and the website's restaurant page when the app isn't installed.
        const link = parsedRestaurant?.orgSlug && parsedRestaurant?.branchCode
          ? restaurantShareUrl(parsedRestaurant.orgSlug, parsedRestaurant.branchCode)
          : WEBSITE_ORIGIN;
        const message = [parsedRestaurant?.name || 'Restaurant', parsedRestaurant?.address, `Order on Prayagi Foodwala: ${link}`].filter(Boolean).join('\n');
        void Share.share({ message }).catch(() => {});
      } },
    ]} />
    <RestaurantPausedBanner restaurantName={parsedRestaurant?.name} />
    <SectionList
      ref={listRef}
      sections={menuSections}
      stickySectionHeadersEnabled={false}
      keyExtractor={item => getProductCartKey(item)}
      renderSectionHeader={({ section }) => <View style={styles.menuSectionHeader}><Text style={styles.menuSectionTitle}>{section.title}</Text><Text style={styles.menuSectionCount}>{section.data.length} {section.data.length === 1 ? 'item' : 'items'}</Text></View>}
      removeClippedSubviews={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: totals.displayCount ? insets.bottom + 110 : insets.bottom + 24 }}
      ListHeaderComponent={<>
        <View style={[styles.hero, { paddingTop: 24 }]}>
          <AppImage uri={cover} style={StyleSheet.absoluteFillObject} />
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.64)' }]} />
          <Text style={styles.restaurantName}>{parsedRestaurant?.name || 'Restaurant'}</Text>
          {!!parsedRestaurant?.cuisine && <Text style={styles.cuisine}>{parsedRestaurant.cuisine.replace(/\|/g, '•')}</Text>}
          <View style={[styles.row, { flexWrap: 'wrap', gap: 8, marginTop: 12 }]}>
            {!!parsedRestaurant?.ratingCount && <View style={styles.metaPill}><Ionicons name="star" color="#ffbf00" size={15} /><Text style={styles.heroMeta}>{parsedRestaurant.rating?.toFixed(1)} ({parsedRestaurant.ratingCount})</Text></View>}
            {!!formatEta(parsedRestaurant?.eta) && <View style={styles.metaPill}><Ionicons name="time-outline" size={14} color="#fff" /><Text style={styles.heroMeta}>{formatEta(parsedRestaurant?.eta)}</Text></View>}
            {!!formatDistance(parsedRestaurant?.distanceKm) && <View style={styles.metaPill}><Ionicons name="location-outline" size={14} color="#fff" /><Text style={styles.heroMeta}>{formatDistance(parsedRestaurant?.distanceKm)}</Text></View>}
          </View>
          {opening && <View style={[styles.row, { marginTop: 10, gap: 8 }]}><Text style={[styles.open, !opening.isOpen && { backgroundColor: '#a74126' }]}>{opening.isOpen ? 'Open Now' : 'Closed'}</Text><Text style={[styles.heroMeta, { flex: 1 }]}>{parsedRestaurant?.openingHours}</Text></View>}
        </View>
        <View style={styles.sheet}>
          {combos.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="View special combos" onPress={scrollToCombos} style={styles.banner}>
            <View style={{ width: '58%', zIndex: 1 }}><Text style={styles.bannerKicker}>TODAY’S</Text><Text style={styles.bannerTitle}>SPECIAL COMBOS</Text><Text style={styles.bannerCopy}>Great taste. Better together!</Text><View style={styles.bannerCta}><Text style={styles.whiteBold}>View Combos</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></View></View>
            <View style={styles.bannerPhoto}><AppImage uri={combos[0].image || cover} style={{ width: '100%', height: '100%' }} /></View>
            {maxSaving > 0 && <View style={styles.bannerSaving}><Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>SAVE UP TO</Text><Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>₹{maxSaving.toFixed(0)}</Text></View>}
          </Pressable>}
          <View style={[styles.row, { gap: 8, marginVertical: 14 }]}>
            <View style={styles.search}><Ionicons name="search-outline" size={20} color="#677080" /><TextInput style={styles.input} placeholder="Search for dishes..." placeholderTextColor="#838894" value={searchQuery} onChangeText={setSearchQuery} autoCorrect={false} returnKeyType="search" />{searchQuery ? <Pressable accessibilityLabel="Clear search" onPress={() => setSearchQuery('')}><Ionicons name="close-circle" size={19} color="#888" /></Pressable> : null}</View>
            <Pressable accessibilityRole="button" accessibilityLabel={activeFilterCount ? `Filter menu, ${activeFilterCount} active` : 'Filter menu'} onPress={openFilters} style={[styles.filter, activeFilterCount > 0 && { borderColor: '#ff7500', backgroundColor: '#fff3e8' }]}><Ionicons name="options-outline" size={20} color={activeFilterCount ? '#ff7500' : '#293241'} /><Text style={{ fontWeight: '600', fontSize: 12, color: activeFilterCount ? '#ff7500' : '#293241' }}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</Text></Pressable>
          </View>
          {menuItems.length > 0 && <View style={[styles.row, { gap: 8, marginBottom: 14 }]}>
            {availableFoodFilters.map(filter => {
              const active = foodFilter === filter.id;
              return <Pressable key={filter.id} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Show ${filter.label} items`} onPress={() => setFoodFilter(filter.id)} style={[styles.foodChip, active && styles.foodChipActive]}>
                {filter.mark && <FoodTypeMark foodType={filter.mark} size={13} />}
                <Text style={[styles.foodChipText, active && { color: '#ff7500' }]}>{filter.label}</Text>
              </Pressable>;
            })}
          </View>}
          <ScrollView horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 18 }}>
            {categories.map(category => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedCategory === category.id }} key={category.id} onPress={() => setSelectedCategory(category.id)} style={[styles.category, selectedCategory === category.id && styles.categoryActive]}><Ionicons name={iconForCategory(category.name)} size={26} color={selectedCategory === category.id ? '#fff' : '#ff7500'} /><Text numberOfLines={2} style={[styles.categoryText, selectedCategory === category.id && { color: '#fff' }]}>{category.name}</Text></Pressable>)}
          </ScrollView>
        </View>
        {combos.length > 0 && <View onLayout={event => { comboOffset.current = event.nativeEvent.layout.y; }}>
          <View style={styles.sectionHeader}><View style={styles.row}><Ionicons name="flame" size={22} color="#ff7500" /><Text style={styles.heading}> Recommended Combos</Text></View></View>
          <FlatList horizontal data={combos} renderItem={renderCombo} keyExtractor={deal => deal.firebaseId} removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }} />
        </View>}
        {offers.length > 0 && <ScrollView horizontal removeClippedSubviews={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 14 }}>{offers.map(offer => <Pressable key={offer._id} accessibilityRole="button" accessibilityLabel={offer.name} disabled={!offer.couponCode} onPress={() => { if (offer.couponCode && parsedRestaurant) { setPendingOffer({ branchId: String(parsedRestaurant.id), couponCode: offer.couponCode }); showAlert('Offer saved', `${offer.couponCode} will be applied at checkout.`); } }} style={styles.offer}><Text style={styles.savings}>{formatBranchOfferHeadline(offer)}</Text><Text style={styles.comboName}>{offer.name}</Text>{!!offer.description && <Text style={styles.muted}>{offer.description}</Text>}{offer.details ? <Text style={styles.muted}>{offer.details}</Text> : offer.minimumOrder > 0 && <Text style={styles.muted}>Min order ₹{offer.minimumOrder}</Text>}</Pressable>)}</ScrollView>}
        <View style={styles.sectionHeader}><Text style={styles.heading}>Menu</Text>{activeFilterCount > 0 && <Pressable accessibilityRole="button" onPress={() => setFilters(DEFAULT_FILTERS)} style={[styles.chip, { borderColor: '#ff7500' }]}><Text style={{ color: '#ff7500', fontSize: 12, fontWeight: '700' }}>Clear filters</Text><Ionicons name="close" size={13} color="#ff7500" /></Pressable>}</View>
      </>}
      ListEmptyComponent={<View style={{ padding: 32, alignItems: 'center' }}>{loadingHome ? <ActivityIndicator color="#ff7500" /> : <Text style={styles.muted}>{foodFilter !== 'ALL' ? `No ${FOOD_FILTERS.find(f => f.id === foodFilter)?.label} items match your selection.` : 'No items match your selection.'}</Text>}</View>}
      renderItem={({ item }) => <ProductCard layout="list" product={item} onPress={() => onProductPress(item)} onCustomize={handleOpenCustomizeModal} canAddToCart={isWithinServiceArea && item.inStock !== false} onAddUnavailablePress={() => showAlert('Unavailable', item.inStock === false ? 'This item is currently out of stock.' : SERVICE_UNAVAILABLE_MESSAGE)} restaurantName={parsedRestaurant?.name} />}
    />
    {totals.displayCount > 0 && <Pressable accessibilityRole="button" accessibilityLabel={`View cart, ${totals.displayCount} items, ₹${totals.total.toFixed(0)}`} onPress={() => router.push('/user/cart')} style={[styles.cart, { bottom: Math.max(insets.bottom, 10) }]}><Ionicons name="cart-outline" color="#fff" size={31} /><View style={{ flex: 1, marginLeft: 12 }}><Text style={styles.cartPrice}>₹{totals.total.toFixed(0)}</Text><Text style={styles.cartCount}>{totals.displayCount} items</Text></View><View style={styles.cartLink}><Text style={styles.whiteBold}>View Cart</Text><Ionicons name="arrow-forward" size={23} color="#fff" /></View></Pressable>}
    <Modal visible={filtersVisible} transparent animationType="slide" onRequestClose={cancelFilters}>
      <View style={styles.modalShade}>
        <Pressable style={StyleSheet.absoluteFillObject} accessibilityLabel="Close filters" onPress={cancelFilters} />
        <View style={[styles.modal, { paddingBottom: insets.bottom + 20 }]}>
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
            <Text style={styles.heading}>Filter & sort</Text>
            {countActiveFilters(draftFilters) > 0 && <Pressable accessibilityRole="button" onPress={() => setDraftFilters(DEFAULT_FILTERS)} hitSlop={8}><Text style={styles.resetText}>Reset</Text></Pressable>}
          </View>

          <Text style={styles.filterGroupLabel}>Sort by price</Text>
          {PRICE_SORTS.map(option => {
            const selected = draftFilters.priceSort === option.id;
            return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected }} style={styles.filterOption} onPress={() => setDraftFilters(current => ({ ...current, priceSort: option.id }))}>
              <Text style={[styles.filterOptionText, selected && styles.filterOptionTextActive]}>{option.label}</Text>
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? '#ff7500' : '#b4b9c2'} />
            </Pressable>;
          })}

          <Text style={styles.filterGroupLabel}>Food type</Text>
          <View style={[styles.row, { gap: 8, flexWrap: 'wrap', paddingVertical: 8 }]}>
            {availableFoodFilters.map(filter => {
              const active = draftFilters.foodFilter === filter.id;
              return <Pressable key={filter.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setDraftFilters(current => ({ ...current, foodFilter: filter.id }))} style={[styles.foodChip, active && styles.foodChipActive]}>
                {filter.mark && <FoodTypeMark foodType={filter.mark} size={13} />}
                <Text style={[styles.foodChipText, active && { color: '#ff7500' }]}>{filter.label}</Text>
              </Pressable>;
            })}
          </View>

          <Text style={styles.filterGroupLabel}>Availability</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draftFilters.availableOnly }} style={styles.filterOption} onPress={() => setDraftFilters(current => ({ ...current, availableOnly: !current.availableOnly }))}>
            <Text style={[styles.filterOptionText, draftFilters.availableOnly && styles.filterOptionTextActive]}>Available items only</Text>
            <Ionicons name={draftFilters.availableOnly ? 'checkbox' : 'square-outline'} size={22} color={draftFilters.availableOnly ? '#ff7500' : '#b4b9c2'} />
          </Pressable>

          <View style={[styles.row, { gap: 12, marginTop: 18 }]}>
            <Pressable accessibilityRole="button" onPress={cancelFilters} style={[styles.modalButton, styles.modalButtonSecondary]}><Text style={styles.modalButtonSecondaryText}>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={applyDraftFilters} style={[styles.modalButton, styles.modalButtonPrimary]}><Text style={styles.whiteBold}>Apply</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <CustomizeItemModal visible={Boolean(customizeProduct)} product={customizeProduct} onClose={() => setCustomizeProduct(null)} onAdd={cartItem => addItem(cartItem, { next: parsedRestaurant?.name })} />
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' }, row: { flexDirection: 'row', alignItems: 'center' },
  hero: { paddingHorizontal: 18, paddingBottom: 34, backgroundColor: '#302115', minHeight: 260 },

  restaurantName: { color: '#fff', fontSize: 23, lineHeight: 28, fontWeight: '800' }, cuisine: { color: '#eee', fontSize: 12, lineHeight: 18, marginTop: 5 },
  metaPill: { borderColor: '#ffffff70', borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', gap: 5, alignItems: 'center' }, heroMeta: { color: '#fff', fontSize: 12 }, open: { backgroundColor: '#248912', color: '#fff', fontSize: 11, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 12 },
  sheet: { marginTop: -16, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 12, paddingHorizontal: 16, backgroundColor: '#fff' },
  banner: { backgroundColor: '#ffe9ce', borderRadius: 18, minHeight: 154, padding: 14, overflow: 'hidden', justifyContent: 'center' }, bannerKicker: { fontSize: 17, fontWeight: '900', color: '#20170f' }, bannerTitle: { color: '#ff7500', fontSize: 20, fontWeight: '900' }, bannerCopy: { fontSize: 11, color: '#4b382a', marginTop: 5 }, bannerCta: { alignSelf: 'flex-start', marginTop: 11, backgroundColor: '#ff7500', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerPhoto: { position: 'absolute', right: -20, bottom: -20, width: '48%', height: 155, borderRadius: 80, overflow: 'hidden' }, bannerSaving: { position: 'absolute', right: 12, top: 10, backgroundColor: '#ff7500', padding: 9, borderRadius: 40, alignItems: 'center' },
  whiteBold: { color: '#fff', fontSize: 14, fontWeight: '800' }, search: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }, input: { flex: 1, fontSize: 13, padding: 8, color: '#252b36' }, filter: { minHeight: 48, flexDirection: 'row', gap: 5, alignItems: 'center', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 14, paddingHorizontal: 10 },
  category: { width: 80, minHeight: 76, backgroundColor: '#fff3e8', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 5 }, categoryActive: { backgroundColor: '#ff7500' }, categoryText: { color: '#252b36', fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'center' },
  sectionHeader: { paddingHorizontal: 16, marginTop: 4, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, heading: { color: '#111827', fontWeight: '800', fontSize: 18 },
  comboCard: { width: 220, marginRight: 12, borderWidth: 1, borderColor: '#eaeaea', borderRadius: 15, overflow: 'hidden', backgroundColor: '#fff' }, comboImage: { width: '100%', height: 100 }, comboName: { fontSize: 14, fontWeight: '800', color: '#17202e', marginBottom: 3 }, muted: { fontSize: 11, lineHeight: 16, color: '#7b818b' }, price: { fontSize: 17, fontWeight: '800', color: '#ff7500' }, oldPrice: { marginLeft: 6, textDecorationLine: 'line-through', color: '#9298a1', fontSize: 11 }, savings: { color: '#ff7500', fontSize: 11, fontWeight: '700', marginTop: 3 }, comboAdd: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ff7500', alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderColor: '#ffd4ad', borderWidth: 1, borderRadius: 20 }, step: { padding: 8 }, stepValue: { color: '#ff7500', fontWeight: '800', fontSize: 12 }, offer: { width: 220, padding: 12, backgroundColor: '#fff7ed', borderRadius: 12 }, chip: { flexDirection: 'row', gap: 5, alignItems: 'center', borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 18, padding: 8 },
  foodChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' }, foodChipActive: { borderColor: '#ff7500', backgroundColor: '#fff3e8' }, foodChipText: { fontSize: 12, fontWeight: '700', color: '#293241' },
  cart: { position: 'absolute', left: 12, right: 12, borderRadius: 15, backgroundColor: '#ff7500', paddingHorizontal: 17, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', elevation: 8 }, cartPrice: { color: '#fff', fontWeight: '900', fontSize: 22 }, cartCount: { color: '#fff', fontSize: 12, marginTop: 2 }, cartLink: { flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 1, borderLeftColor: '#ffffff60', paddingLeft: 20 },
  modalShade: { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' }, modal: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 20 },
  filterGroupLabel: { marginTop: 14, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, color: '#8a909a', textTransform: 'uppercase' },
  filterOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11 }, filterOptionText: { fontSize: 14, color: '#293241' }, filterOptionTextActive: { color: '#ff7500', fontWeight: '700' },
  resetText: { color: '#ff7500', fontWeight: '700', fontSize: 13 },
  modalButton: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, modalButtonPrimary: { backgroundColor: '#ff7500' }, modalButtonSecondary: { borderWidth: 1, borderColor: '#e1e3e8', backgroundColor: '#fff' }, modalButtonSecondaryText: { color: '#293241', fontSize: 14, fontWeight: '700' },
  menuSectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, backgroundColor: '#fff' }, menuSectionTitle: { fontSize: 16, fontWeight: '800', color: '#17202e' }, menuSectionCount: { fontSize: 12, color: '#8a909a' },
});
