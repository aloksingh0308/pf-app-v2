import AppImage from '@/components/AppImage';
import CategoryTile from '@/components/CategoryTile';
import CustomizeItemModal from '@/components/CustomizeItemModal';
import FloatingCartButton from '@/components/FloatingCartButton';
import ProductCard from '@/components/ProductCard';
import { useAppLoader } from '@/hooks/useAppLoader';
import { decrementQuantity, incrementQuantity } from '@/store/slices/cartSlice';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { Category } from '@/types/Categories';
import { Product, ProductWithFirebaseId } from '@/types/Product';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert } from '../../services/alertService';
import { getCategories, getMenuItems } from '../../services/menuService';
import { getMyOrders, Order } from '../../services/orderService';
import { setActiveRestaurant } from '../../services/restaurantContext';
import { buildCartItemsForDeal, buildDealDescription, fetchActiveDeals, hydrateDealItemNames } from '../../services/dealsService';
import { BranchOfferRecord, formatBranchOfferHeadline, getBranchOffers } from '../../services/offersService';
import { DealMenuView } from '@/types/Deal';
import { RootState } from '../../store';
import { buildCartItemFromProduct, buildProductCartKey, getProductVariants } from '@/utils/productVariants';

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

type RatingAggregate = {
  total: number;
  count: number;
};

const normalizeId = (value: unknown) => String(value || '').trim();

const buildRatingsMap = (reviewDocs: Array<Record<string, unknown>>) => {
  const map = new Map<string, RatingAggregate>();

  reviewDocs.forEach((entry) => {
    const productId = normalizeId(entry.productId);
    const rating = Number(entry.rating || 0);
    if (!productId || !Number.isFinite(rating) || rating < 1 || rating > 5) {
      return;
    }

    const previous = map.get(productId) || { total: 0, count: 0 };
    map.set(productId, {
      total: previous.total + rating,
      count: previous.count + 1,
    });
  });

  return map;
};

const attachRatingsToItems = (items: ProductWithFirebaseId[], ratingsMap: Map<string, RatingAggregate>) => {
  return items.map((item) => {
    const candidateIds = Array.from(new Set([
      normalizeId((item as any).firebaseId),
      normalizeId((item as any).id),
    ].filter(Boolean)));

    const aggregate = candidateIds.reduce((acc, id) => {
      const next = ratingsMap.get(id);
      if (!next) {
        return acc;
      }

      return {
        total: acc.total + next.total,
        count: acc.count + next.count,
      };
    }, { total: 0, count: 0 });

    if (aggregate.count < 1) {
      return item;
    }

    return {
      ...item,
      rating: Number((aggregate.total / aggregate.count).toFixed(1)),
      ratingCount: aggregate.count,
    } as ProductWithFirebaseId;
  });
};

const getItemRatingMeta = (item: ProductWithFirebaseId) => {
  const ratingCount = Number((item as any).ratingCount || 0);
  if (ratingCount < 1) {
    return {
      value: 'NEW',
    };
  }

  return {
    value: Number((item as any).rating || 0).toFixed(1),
  };
};

export default function RestaurantDetailsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const authUser = useSelector((state: RootState) => state.auth.user);
  const { addItem, addItems } = useAddToCartWithRestaurantGuard();
  const { restaurant, categoryId } = useLocalSearchParams();

  // Ensure categoryId is always a string
  const normalizedCategoryId = Array.isArray(categoryId) ? categoryId[0] : categoryId;

  const parsedRestaurant: Restaurant | null = useMemo(() => {
    try {
      if (!restaurant) return null;
      const raw = Array.isArray(restaurant) ? restaurant[0] : restaurant;
      return JSON.parse(raw) as Restaurant;
    } catch (_) {
      return null;
    }
  }, [restaurant]);


  const [menuItems, setMenuItems] = useState<ProductWithFirebaseId[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(normalizedCategoryId || '0');
  const [menuItemCategories, setMenuItemCategories] = useState<Category[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [combos, setCombos] = useState<DealMenuView[]>([]);
  const [offers, setOffers] = useState<BranchOfferRecord[]>([]);
  const [isWithinServiceArea, setIsWithinServiceArea] = useState(true);
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
    () => applyFilters(menuItems, selectedCategory, searchQuery),
    [menuItems, selectedCategory, searchQuery, menuItemCategories]
  );


  // --- Recent Orders State ---
  const [recentOrders, setRecentOrders] = useState<ProductWithFirebaseId[]>([]);

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


        let userOrders: Order[] = [];
        if (authUser?.uid) {
          try {
            // The backend endpoint already scopes this to the logged-in customer and
            // sorts newest-first — no client-side filter/sort needed the way the raw
            // Firestore query used to require.
            userOrders = await getMyOrders();


            // Build Order Again list from order history:
            // newest orders first, include all order items, keep only latest 10 unique items.
            const uniqueRecentItems: ProductWithFirebaseId[] = [];
            const seenItemKeys = new Set<string>();

            for (const order of userOrders) {
              const orderItems = Array.isArray(order.items) ? order.items : [];
              for (const item of orderItems) {
                const itemKey = [
                  String(item?.firebaseId || '').trim(),
                  String(item?.id || '').trim(),
                  String(item?.name || '').trim().toLowerCase(),
                ].filter(Boolean).join('|');

                if (!itemKey || seenItemKeys.has(itemKey)) {
                  continue;
                }

                seenItemKeys.add(itemKey);
                uniqueRecentItems.push({
                  id: item.id,
                  firebaseId: item.firebaseId,
                  name: item.name,
                  description: String(item.description || ''),
                  images: Array.isArray(item.images) ? item.images : [],
                  price: item.price,
                  qty: String(item.quantity),
                  serves: item.serves || null,
                  categoryId: item.categoryId || null,
                  cafeId: order.cafeId || null,
                  restaurantId: order.restaurantId || null,
                  emoji: item.emoji || null,
                  available: true,
                  hasHalfPortion: Boolean(item.hasHalfPortion),
                  halfPrice: item.halfPrice || null,
                  createdAt: order.createdAt,
                });

                if (uniqueRecentItems.length >= 10) {
                  break;
                }
              }

              if (uniqueRecentItems.length >= 10) {
                break;
              }
            }

            const mappedRecentOrders: ProductWithFirebaseId[] = uniqueRecentItems;
            setRecentOrders(mappedRecentOrders);

          } catch (ordersError) {
            console.warn('Skipping ratings load: orders read failed.', ordersError);
          }
        }


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

        setRecentOrders((prev) => prev.map((recent) => {
          const recentIds = new Set([
            normalizeId((recent as any).firebaseId),
            normalizeId((recent as any).id),
          ].filter(Boolean));

          const match = filteredByCafe.find((menuItem) => {
            const menuIds = new Set([
              normalizeId((menuItem as any).firebaseId),
              normalizeId((menuItem as any).id),
            ].filter(Boolean));
            for (const id of recentIds) {
              if (menuIds.has(id)) return true;
            }
            return false;
          });

          if (!match) return recent;

          return {
            ...recent,
            rating: Number((match as any).rating || 0),
            ratingCount: Number((match as any).ratingCount || 0),
          } as ProductWithFirebaseId;
        }));

        void applyFilters(filteredByCafe, '0', '', availableCategories);
      } catch (error) {
        console.error(error);
      } finally {
        setLoadingHome(false);
        appLoader.hide();
      }
    };

    initializeHome();
  }, [authUser?.email, authUser?.uid, parsedRestaurant?.id]);


  const onProductPress = (product: ProductWithFirebaseId) => {
    router.push({
      pathname: '/user/product-details',
      params: { product: JSON.stringify(product) },
    });
  };

  const handleQuickAddToCart = useCallback((product: ProductWithFirebaseId) => {
    if (!isWithinServiceArea) {
      showAlert('Coming Soon', SERVICE_UNAVAILABLE_MESSAGE);
      return;
    }
    if (product.inStock === false) {
      showAlert('Out of Stock', 'This item is currently out of stock.');
      return;
    }
    const variants = getProductVariants(product);
    const needsCustomization = variants.length > 1 || (product.modifierGroupIds?.length || 0) > 0 || (product.addonIds?.length || 0) > 0;
    if (needsCustomization) {
      setCustomizeProduct(product);
      return;
    }
    addItem(buildCartItemFromProduct(product, variants[0]?.id || null), { next: parsedRestaurant?.name });
  }, [isWithinServiceArea, addItem, parsedRestaurant?.name]);

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
    const quantities = dealRows.map((entry) => Math.max(1, Number(entry.quantity || 1)));
    const bundleQty = quantities.reduce((acc, value) => gcd(acc, value), quantities[0] || 1);
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

  const renderCombo = useCallback(({ item: deal }: { item: DealMenuView }) => {
    const dealPrice = Math.max(0, Number(deal.pricing?.dealPrice || 0));
    const description = buildDealDescription(deal) || 'Includes combo items';
    const savingsLabel = getComboSavingsLabel(deal);
    const state = getComboCartState(deal);
    const isAdded = state.quantity > 0;

    return (
      <PopularCard>
        <PopularImageWrap>
          <PopularImage uri={deal.image || 'https://via.placeholder.com/200'} contentFit="cover" />
        </PopularImageWrap>
        <PopularName numberOfLines={1}>{deal.name || 'Combo Deal'}</PopularName>
        <PopularDescription numberOfLines={2}>{description}</PopularDescription>

        <PopularBottomRow>
          <PopularPriceRow>
            <PopularPrice>₹{dealPrice.toFixed(0)}</PopularPrice>
          </PopularPriceRow>
          {!isAdded ? (
            <AddButton onPress={() => void handleComboIncrement(deal)} activeOpacity={0.7}>
              <AddButtonText>{savingsLabel}</AddButtonText>
              <AddButtonIconBox>
                <Ionicons name="add" size={20} color="#f68712" />
              </AddButtonIconBox>
            </AddButton>
          ) : (
            <PopularQtyRow>
              <PopularQtyButton onPress={() => handleComboDecrement(deal)}>
                <PopularQtyText>-</PopularQtyText>
              </PopularQtyButton>
              <PopularQtyValue>{state.quantity}</PopularQtyValue>
              <PopularQtyButton onPress={() => void handleComboIncrement(deal)}>
                <PopularQtyText>+</PopularQtyText>
              </PopularQtyButton>
            </PopularQtyRow>
          )}
        </PopularBottomRow>
      </PopularCard>
    );
  }, [getComboCartState, handleComboIncrement, handleComboDecrement]);

  const renderOffer = useCallback(({ item: offer }: { item: BranchOfferRecord }) => {
    const conditions = [
      offer.minimumOrder > 0 ? `Min order ₹${offer.minimumOrder}` : null,
      offer.discountType === 'PERCENTAGE' && offer.maxDiscount > 0 ? `Up to ₹${offer.maxDiscount} off` : null,
    ].filter(Boolean).join(' · ');

    return (
      <OfferCard>
        <OfferBadge>
          <OfferBadgeText>{formatBranchOfferHeadline(offer)}</OfferBadgeText>
        </OfferBadge>
        <OfferTitle numberOfLines={1}>{offer.name}</OfferTitle>
        {offer.description ? <OfferMeta numberOfLines={2}>{offer.description}</OfferMeta> : null}
        {conditions ? <OfferMeta numberOfLines={1}>{conditions}</OfferMeta> : null}
      </OfferCard>
    );
  }, []);

  const handleAddUnavailable = useCallback(() => {
    showAlert('Coming Soon', SERVICE_UNAVAILABLE_MESSAGE);
  }, []);

  const handleOutOfStock = useCallback(() => {
    showAlert('Out of Stock', 'This item is currently out of stock.');
  }, []);


  const handleCategoryPress = useCallback((categoryId: string) => {
    setSelectedCategory(categoryId);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);


  const OrderAgainSection = ({ orders, onQuickAdd, onViewAll }: {
    orders: ProductWithFirebaseId[],
    onQuickAdd: (item: ProductWithFirebaseId) => void,
    onViewAll: () => void,
  }) => (
    <OrderAgainContainer>
      <OrderAgainHeaderRow>
        <OrderAgainHeaderLeft>
          <Ionicons name="refresh" size={20} color="#43b02a" style={{ marginRight: 6 }} />
          <OrderAgainTitle>Order Again</OrderAgainTitle>
        </OrderAgainHeaderLeft>
        <OrderAgainViewAllBtn disabled onPress={onViewAll}>
          {/* <OrderAgainViewAllText>View All</OrderAgainViewAllText> */}
          <Ionicons name="chevron-forward" size={18} color="#43b02a" />
        </OrderAgainViewAllBtn>
      </OrderAgainHeaderRow>
      <OrderAgainSubtitle>Your recent orders</OrderAgainSubtitle>
      <OrderAgainList horizontal showsHorizontalScrollIndicator={false}>
        {orders.map((item, index) => {
          const ratingMeta = getItemRatingMeta(item);
          return (
          <OrderAgainCard key={index}>
            {/* <OrderAgainImage source={{ uri: item.images?.[0] || 'https://via.placeholder.com/100' }} /> */}
            <OrderAgainContentContainer>
              <OrderAgainName numberOfLines={2}>{item.name}</OrderAgainName>
              <OrderAgainRatingRow>
                <Ionicons name="star" size={12} color="#fbbf24" />
                <OrderAgainRatingValue>{ratingMeta.value}</OrderAgainRatingValue>
              </OrderAgainRatingRow>
              <OrderAgainPriceButtonContainer>
                <OrderAgainPrice>₹{item.price}</OrderAgainPrice>
                <OrderAgainAddBtn onPress={() => onQuickAdd(item)}>
                  <Ionicons name="add" size={20} color="#fff" />
                </OrderAgainAddBtn>
              </OrderAgainPriceButtonContainer>
            </OrderAgainContentContainer>
          </OrderAgainCard>
        )})}
      </OrderAgainList>
    </OrderAgainContainer>
  );

  // --- End Order Again Section ---

  return (
    <Container>
      <HeaderContainer style={{ paddingTop: Math.max(insets.top, 30) }}>
        <BackButton onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>{parsedRestaurant?.name || 'Restaurant Details'}</Title>
      </HeaderContainer>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => getProductCartKey(item)}
        numColumns={2}
        columnWrapperStyle={{ justifyContent: 'space-between' }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 120 }}
        ListHeaderComponent={
          <>
            {/* Order Again Section */}
            {recentOrders.length > 0 && (
              <OrderAgainSection
                orders={recentOrders}
                onQuickAdd={handleQuickAddToCart}
                onViewAll={() => showAlert('Order History', 'Show all previous orders (implement navigation)')}
              />
            )}
            {/* Recommendations Combos Section — real per-branch combos (Admin's Combos
                page), not menu items. Hidden entirely once loaded if this branch has none. */}
            {loadingHome ? (
              <>
                <SectionTitle>🔥 Recommendations Combos</SectionTitle>
                <PopularSkeletonRow>
                  <PopularSkeletonCard />
                  <PopularSkeletonCard />
                  <PopularSkeletonCard />
                </PopularSkeletonRow>
              </>
            ) : combos.length > 0 ? (
              <>
                <SectionTitle>🔥 Recommendations Combos</SectionTitle>
                <FlatList
                  data={combos}
                  keyExtractor={(deal) => `combo-${deal.firebaseId}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 10 }}
                  renderItem={renderCombo}
                />
              </>
            ) : null}

            {/* Special Offers Section — real per-branch offers (Admin's Offers page).
                Informational only, no add-to-cart — see models/Offer.ts's doc-comment. */}
            {!loadingHome && offers.length > 0 && (
              <>
                <SectionTitle>🎉 Special Offers</SectionTitle>
                <FlatList
                  data={offers}
                  keyExtractor={(offer) => `offer-${offer._id}`}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 10 }}
                  renderItem={renderOffer}
                />
              </>
            )}

            <SearchBarContainer>
              <Ionicons name="search" size={18} color="#8a8a8a" />
              <SearchBarInput
                placeholder="Search Biryani, Burger, Cold Coffee..."
                placeholderTextColor="#999"
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery ? (
                <ClearSearchButton onPress={() => handleSearchChange('')} activeOpacity={0.7}>
                  <Ionicons name="close-circle" size={18} color="#8a8a8a" />
                </ClearSearchButton>
              ) : null}
            </SearchBarContainer>

            <SectionTitle>Categories</SectionTitle>
            {loadingHome ? (
              <CategorySkeletonRow>
                <CategorySkeletonChip />
                <CategorySkeletonChip />
                <CategorySkeletonChip />
                <CategorySkeletonChip />
              </CategorySkeletonRow>
            ) : (
              <FlatList
                data={menuItemCategories}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={
                  <CategoryTile
                    selectedCategory={selectedCategory}
                    category={{ id: '0', name: 'All', icon: 'all', available: true }}
                    onPress={() => {
                      setSelectedCategory('0');
                      handleCategoryPress('0');
                    }}
                  />
                }
                renderItem={({ item }) => (
                  <CategoryTile
                    category={item}
                    selectedCategory={selectedCategory}
                    onPress={() => {
                      setSelectedCategory(item.id);
                      handleCategoryPress(item.id);
                    }}
                  />
                )}
                contentContainerStyle={{ paddingBottom: 12 }}
                horizontal
                showsHorizontalScrollIndicator={false}
              />
            )}
          </>
        }
        ListEmptyComponent={!loadingHome ? <EmptyText>{searchQuery ? 'No matching items found.' : 'No items available.'}</EmptyText> : null}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            onPress={() => onProductPress(item)}
            onCustomize={handleOpenCustomizeModal}
            canAddToCart={isWithinServiceArea && item.inStock !== false}
            onAddUnavailablePress={item.inStock === false ? handleOutOfStock : handleAddUnavailable}
            restaurantName={parsedRestaurant?.name}
          />
        )}
      />

      <CustomizeItemModal
        visible={Boolean(customizeProduct)}
        product={customizeProduct}
        onClose={() => setCustomizeProduct(null)}
        onAdd={(cartItem) => addItem(cartItem, { next: parsedRestaurant?.name })}
      />
      <FloatingCartButton />
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: #fff;
  padding-top: 10px;
`;

const HeaderContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 10px;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: bold;
  padding: 0 20px;
  width: 75%;
  text-align: center;
`;


















const SearchBarContainer = styled.View`
  margin-top: 6px;
  margin-bottom: 10px;
  flex-direction: row;
  align-items: center;
  background-color: #f7f7f7;
  border-width: 1px;
  border-color: #ececec;
  border-radius: 12px;
  padding: 0 12px;
`;

const SearchBarInput = styled(TextInput)`
  flex: 1;
  padding: 10px 8px;
  color: #222;
  font-size: 14px;
`;

const ClearSearchButton = styled.TouchableOpacity`
  padding-left: 4px;
  padding-vertical: 8px;
`;

const SectionTitle = styled.Text`
  margin-top: 8px;
  margin-bottom: 10px;
  font-size: 16px;
  font-weight: 800;
  color: #222;
`;

const OfferCard = styled.View`
  width: 220px;
  background-color: #fff7ed;
  border-radius: 12px;
  border-width: 1px;
  border-color: #ffe0b2;
  margin-right: 10px;
  padding: 12px;
`;

const OfferBadge = styled.View`
  align-self: flex-start;
  background-color: #f68712;
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 6px;
`;

const OfferBadgeText = styled.Text`
  color: #fff;
  font-size: 12px;
  font-weight: 800;
`;

const OfferTitle = styled.Text`
  font-size: 14px;
  font-weight: 700;
  color: #3b3b3b;
`;

const OfferMeta = styled.Text`
  margin-top: 3px;
  font-size: 11px;
  color: #666;
  line-height: 15px;
`;

const PopularCard = styled.View`
  width: 175px;
  background-color: #fff;
  border-radius: 12px;
  border-width: 1px;
  border-color: #ececec;
  margin-right: 10px;
  padding: 8px;
`;

const PopularPressArea = styled.TouchableOpacity``;

const PopularImageWrap = styled.View`
  position: relative;
`;

const PopularImage = styled(AppImage)`
  width: 100%;
  height: 88px;
  border-radius: 10px;
`;

const PopularOutOfStockBadge = styled.Text`
  position: absolute;
  left: 8px;
  right: 8px;
  top: 50%;
  text-align: center;
  transform: translateY(-12px);
  background-color: rgba(31, 41, 55, 0.50);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  border-radius: 999px;
  padding: 5px 8px;
  overflow: hidden;
`;

const PopularName = styled.Text`
  margin-top: 8px;
  font-size: 14px;
  font-weight: 700;
  color: #3b3b3b;
`;

const PopularMeta = styled.Text`
  margin-top: 3px;
  font-size: 12px;
  color: #1f1f1f;
  font-weight: 500;
`;

const PopularDescription = styled.Text`
  margin-top: 2px;
  font-size: 11px;
  color: #666;
  line-height: 15px;
`;

const PopularRatingBadge = styled.View`
  position: absolute;
  right: 8px;
  bottom: 8px;
  flex-direction: row;
  align-items: center;
  background-color: rgba(17, 24, 39, 0.72);
  border-radius: 12px;
  padding: 4px 8px;
`;

const PopularRatingBadgeText = styled.Text`
  margin-left: 4px;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
`;

const PopularBottomRow = styled.View`
  margin-top: 8px;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const PopularPriceRow = styled.View`
  flex-direction: row;
  align-items: baseline;
  column-gap: 6px;
`;

const PopularPrice = styled.Text`
  color: #f68712;
  font-size: 16px;
  font-weight: 700;
`;




const PopularQtyRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const PopularQtyButton = styled.TouchableOpacity`
  background-color: #f68712;
  padding: 6px 12px;
  border-radius: 8px;
`;

const PopularQtyText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: bold;
`;

const PopularQtyValue = styled.Text`
  font-size: 14px;
  margin: 0 5px;
  font-weight: bold;
`;

const PopularSkeletonRow = styled.View`
  flex-direction: row;
  gap: 10px;
  margin-bottom: 4px;
`;

const PopularSkeletonCard = styled.View`
  width: 175px;
  height: 150px;
  border-radius: 12px;
  background-color: #efefef;
`;

const CategorySkeletonRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const CategorySkeletonChip = styled.View`
  width: 86px;
  height: 34px;
  border-radius: 17px;
  background-color: #ececec;
`;

const EmptyText = styled.Text`
  text-align: center;
  margin-top: 40px;
  color: #666;
`;

const AddButton = styled.TouchableOpacity`
  background-color: #f68712;
  border-radius: 22px;
  flex-direction: row;
  align-items: center;
  padding: 5px 5px 5px 10px;
  min-width: 20px;
  justify-content: space-around;
  opacity: ${(props: any) => (props.disabled ? 0.65 : 1)};
`;

const AddButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: bold;
  margin-right: 8px;
`;

const AddButtonIconBox = styled.View`
  background: #fff;
  border-radius: 50px;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
`;


const OrderAgainContainer = styled.View`
    background: #f4faf4;
    border-radius: 14px;
    padding: 14px 10px 12px 10px;
    margin: 0 10px 16px 10px;
`;
const OrderAgainContentContainer = styled.View`
    margin-left: 5px;
  `
const OrderAgainPriceButtonContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  `

const OrderAgainHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;
const OrderAgainHeaderLeft = styled.View`
  flex-direction: row;
  align-items: center;
`;
const OrderAgainTitle = styled.Text`
  font-size: 17px;
  font-weight: bold;
  color: #222;
`;
const OrderAgainViewAllBtn = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;
const OrderAgainSubtitle = styled.Text`
  color: #666;
  font-size: 13px;
  margin: 2px 0 10px 2px;
`;
const OrderAgainList = styled.ScrollView`
  flex-direction: row;
`;
const OrderAgainCard = styled.View`
  background: #fff;
  border-radius: 12px;
  margin-horizontal: 2px;
  padding: 5px 5px 4px 5px;
  elevation: 2;
  flex-direction: row;
  max-width: 200px;
  margin-vertical: 4px;
`;
const OrderAgainName = styled.Text`
  font-size: 12px;
  font-weight: 700;
  color: #222;
  text-align: left;
  max-width: 110px;
`;

const OrderAgainRatingRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 4px;
  margin-bottom: 4px;
`;

const OrderAgainRatingValue = styled.Text`
  margin-left: 4px;
  color: #111827;
  font-size: 11px;
  font-weight: 700;
`;
const OrderAgainPrice = styled.Text`
  color: #f68712;
  font-size: 15px;
  font-weight: bold;
  margin-bottom: 2px;
`;
const OrderAgainAddBtn = styled.TouchableOpacity`
  background: #43b02a;
  border-radius: 16px;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
`;

