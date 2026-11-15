import PageHeader, { TabScreen } from '@/components/common/PageHeader';
import AppearIn from '@/components/common/AppearIn';
import AppImage from '@/components/AppImage';
import FoodTypeMark from '@/components/common/FoodTypeMark';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { showAlert } from '@/services/alertService';
import { buildCartItemsForDeal, buildDealDescription } from '@/services/dealsService';
import { BranchOfferRecord, formatBranchOfferHeadline } from '@/services/offersService';
import { formatDistance, formatEta, RestaurantRecord } from '@/services/restaurantService';
import { setActiveRestaurant, setPendingOffer } from '@/services/restaurantContext';
import { pageTodaysBestDeals, TodaysDeal, TodaysDealsRow } from '@/services/todaysDealsService';
import { usePagedList } from '@/hooks/usePagedList';
import { RootState } from '@/store';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { T } from '@/constants/tokens';

/**
 * "Today's Best Deals" tab (replaced the old placeholder Meal tab) — every live combo and
 * promotional offer across all restaurants, one section per restaurant in the backend's
 * restaurant-ranking order (see services/todaysDealsService.ts). Combos can be added to the
 * cart straight from here; offers are informational and open the restaurant's menu.
 */
export default function BestDealsScreen() {
  const insets = useSafeAreaInsets();
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const latitude = useSelector((state: RootState) => state.location.latitude);
  const longitude = useSelector((state: RootState) => state.location.longitude);
  const coords = useMemo(() => (
    latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude } : null
  ), [latitude, longitude]);
  const { addItems } = useAddToCartWithRestaurantGuard();

  const [addingDealId, setAddingDealId] = useState<string | null>(null);

  // Restaurant rows page in from the API as the list scrolls.
  const list = usePagedList<TodaysDealsRow>(
    (page) => pageTodaysBestDeals(coords, page),
    (row) => row.restaurant.id,
    [coords]
  );
  const rows = list.items;
  const loading = list.loading;
  const failed = Boolean(list.error) && rows.length === 0;

  // Deals change through the day — refresh from page 1 whenever the tab comes back into view
  // (the hook already loaded page 1 on mount).
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnceRef.current) {
        focusedOnceRef.current = true;
        return;
      }
      void list.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.refresh])
  );

  const dealIdsInCart = useMemo(
    () => new Set(cartItems.filter((item) => item.isDeal).map((item) => String(item.dealId || ''))),
    [cartItems]
  );

  const openRestaurant = useCallback((restaurant: RestaurantRecord) => {
    router.push({
      pathname: '/user/restaurant-details',
      params: { restaurant: JSON.stringify(restaurant), categoryId: '0' },
    });
  }, []);

  // An offer with a coupon behind it carries that code to checkout, which applies it the
  // same way as a tapped "Offers Near You" coupon (restaurantContext.setPendingOffer).
  const openOffer = useCallback((restaurant: RestaurantRecord, offer: BranchOfferRecord) => {
    if (offer.couponCode) setPendingOffer({ branchId: String(restaurant.id), couponCode: offer.couponCode });
    openRestaurant(restaurant);
  }, [openRestaurant]);

  const handleAddDeal = useCallback(async (restaurant: RestaurantRecord, deal: TodaysDeal) => {
    setAddingDealId(deal.firebaseId);
    try {
      // Combo lines are priced/stamped from the restaurant's own live menu — point the menu
      // service at this deal's restaurant first (the same thing its menu screen does on open).
      setActiveRestaurant(restaurant);
      const items = await buildCartItemsForDeal(deal);
      if (items.length === 0) {
        showAlert('Combo Unavailable', 'Some items in this combo are currently unavailable.');
        return;
      }
      addItems(items as any[], { next: restaurant.name });
    } catch (error) {
      console.warn('Failed to add combo to cart.', error);
      showAlert('Unable To Add Combo', 'Please try again in a moment.');
    } finally {
      setAddingDealId(null);
    }
  }, [addItems]);

  const renderDeal = (restaurant: RestaurantRecord, deal: TodaysDeal) => {
    const price = Number(deal.pricing.dealPrice || 0);
    const original = Number(deal.pricing.totalPrice || 0);
    const saved = Math.max(0, original - price);
    const inCart = dealIdsInCart.has(deal.firebaseId);
    const adding = addingDealId === deal.firebaseId;
    return (
      <View key={deal.firebaseId} style={styles.dealCard}>
        <View style={styles.dealImageWrap}>
          <AppImage uri={deal.image || restaurant.coverImage || restaurant.image} style={StyleSheet.absoluteFillObject} />
          {saved > 0 && <View style={styles.saveBadge}><Text style={styles.saveBadgeText}>SAVE ₹{saved.toFixed(0)}</Text></View>}
        </View>
        <View style={styles.dealBody}>
          <View style={styles.row}>
            {deal.foodTypes.map((type) => <View key={type} style={{ marginRight: 4 }}><FoodTypeMark foodType={type} size={12} /></View>)}
            <Text style={styles.comboTag}>COMBO</Text>
          </View>
          <Text numberOfLines={2} style={styles.dealName}>{deal.name}</Text>
          <Text numberOfLines={2} style={styles.muted}>{buildDealDescription(deal)}</Text>
          <View style={styles.dealFooter}>
            <View>
              <Text style={styles.price}>₹{price.toFixed(0)}</Text>
              {original > price && <Text style={styles.oldPrice}>₹{original.toFixed(0)}</Text>}
            </View>
            {inCart ? (
              <Pressable accessibilityRole="button" accessibilityLabel="View cart" onPress={() => router.push('/user/cart')} style={styles.inCart}>
                <Ionicons name="checkmark" size={14} color={T.color.brand} />
                <Text style={styles.inCartText}>In cart</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={`Add ${deal.name}`} disabled={adding} onPress={() => void handleAddDeal(restaurant, deal)} style={styles.add}>
                {adding ? <ActivityIndicator size="small" color="#fff" /> : <><Text style={styles.addText}>ADD</Text><Ionicons name="add" size={16} color="#fff" /></>}
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderOffer = (restaurant: RestaurantRecord, offer: BranchOfferRecord) => (
    <Pressable key={offer._id} accessibilityRole="button" accessibilityLabel={`${offer.name} at ${restaurant.name}`} onPress={() => openOffer(restaurant, offer)} style={styles.offerCard}>
      <View style={styles.offerIcon}><Ionicons name={offer.type === 'TODAYS_DEAL' ? 'flame' : 'pricetag'} size={22} color="#fff" /></View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.offerHeadline} numberOfLines={1}>{formatBranchOfferHeadline(offer)}</Text>
        <Text style={styles.dealName} numberOfLines={1}>{offer.name}</Text>
        {!!offer.description && <Text style={styles.muted} numberOfLines={2}>{offer.description}</Text>}
        {offer.details ? (
          <Text style={[styles.muted, { marginTop: 2 }]} numberOfLines={2}>{offer.details}</Text>
        ) : offer.minimumOrder > 0 ? (
          <Text style={[styles.muted, { marginTop: 2 }]}>Min order ₹{offer.minimumOrder}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={T.color.brand} />
    </Pressable>
  );

  const renderRow = ({ item, index }: { item: TodaysDealsRow; index: number }) => {
    const { restaurant } = item;
    const meta = [formatEta(restaurant.eta), formatDistance(restaurant.distanceKm)].filter(Boolean).join(' • ');
    const count = item.deals.length + item.offers.length;
    return (
      <AppearIn index={index} style={styles.section}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${restaurant.name} menu`} onPress={() => openRestaurant(restaurant)} style={styles.restaurantHeader}>
          <AppImage uri={restaurant.image || restaurant.coverImage} style={styles.logo} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text numberOfLines={1} style={styles.restaurantName}>{restaurant.name}</Text>
            <Text numberOfLines={1} style={styles.muted}>{[`${count} deal${count === 1 ? '' : 's'} today`, meta].filter(Boolean).join(' • ')}</Text>
          </View>
          <Text style={styles.viewMenu}>Menu</Text>
          <Ionicons name="chevron-forward" size={16} color={T.color.brand} />
        </Pressable>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {item.deals.map((deal) => renderDeal(restaurant, deal))}
          {item.offers.map((offer) => renderOffer(restaurant, offer))}
        </View>
      </AppearIn>
    );
  };

  return (
    <TabScreen style={styles.page}>
      <PageHeader title="Today's Best Deals" showBack={false} />
      {loading && rows.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={T.color.brand} size="large" /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.restaurant.id}
          renderItem={renderRow}
          removeClippedSubviews={false}
          onEndReached={() => void list.loadMore()}
          onEndReachedThreshold={0.6}
          ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ paddingVertical: 16 }} color={T.color.brand} /> : null}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} colors={[T.color.brand]} tintColor={T.color.brand} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          ListHeaderComponent={rows.length > 0 ? (
            <View style={styles.hero}>
              <Text style={styles.heroKicker}>TODAY&apos;S BEST DEALS</Text>
              <Text style={styles.heroTitle}>Top-rated restaurants, best prices</Text>
              <Text style={styles.heroCopy}>Combos and offers live right now, from the best-ranked restaurants near you.</Text>
            </View>
          ) : null}
          ListEmptyComponent={
            <View style={styles.center}>
              <View style={styles.emptyIcon}><Ionicons name={failed ? 'cloud-offline-outline' : 'pricetags-outline'} size={40} color={T.color.brand} /></View>
              <Text style={styles.emptyTitle}>{failed ? 'Couldn\'t load deals' : 'No deals right now'}</Text>
              <Text style={styles.emptyCopy}>{failed ? 'Pull down to try again.' : 'Restaurants near you haven\'t posted any deals today. Check back soon!'}</Text>
            </View>
          }
        />
      )}
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fffbf7' },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { margin: 16, marginBottom: 6, padding: 16, borderRadius: 18, backgroundColor: '#ffe9ce' },
  heroKicker: { color: T.color.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  heroTitle: { color: '#20170f', fontSize: 19, fontWeight: '900', marginTop: 4 },
  heroCopy: { color: '#4b382a', fontSize: 12, lineHeight: 17, marginTop: 4 },
  section: { marginTop: 18 },
  restaurantHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 },
  logo: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#f4f4f4' },
  restaurantName: { fontSize: 16, fontWeight: '800', color: T.color.ink },
  viewMenu: { color: T.color.brand, fontSize: 12, fontWeight: '700', marginRight: 2 },
  dealCard: { flexDirection: 'row', borderWidth: 1, borderColor: '#f0e6de', borderRadius: 16, overflow: 'hidden', backgroundColor: '#fff', minHeight: 132, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dealImageWrap: { width: 120, backgroundColor: '#f4f4f4' },
  saveBadge: { position: 'absolute', left: 6, top: 6, backgroundColor: T.color.brand, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  saveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  dealBody: { flex: 1, padding: 12 },
  comboTag: { fontSize: 10, fontWeight: '800', color: '#b66324', letterSpacing: 0.8, marginLeft: 2 },
  dealName: { fontSize: 15, fontWeight: '800', color: '#17202e', marginTop: 4, marginBottom: 2 },
  muted: { fontSize: 12, lineHeight: 17, color: '#7b818b' },
  dealFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 10 },
  price: { fontSize: 18, fontWeight: '900', color: T.color.brand },
  oldPrice: { textDecorationLine: 'line-through', color: '#9298a1', fontSize: 12 },
  add: { minWidth: 76, height: 36, borderRadius: 18, backgroundColor: T.color.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 14 },
  addText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  inCart: { minWidth: 76, height: 36, borderRadius: 18, borderWidth: 1, borderColor: T.color.brand, backgroundColor: T.color.brandSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 12 },
  inCartText: { color: T.color.brand, fontSize: 13, fontWeight: '800' },
  offerCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 16, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#ffe0bf' },
  offerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: T.color.brand, alignItems: 'center', justifyContent: 'center' },
  offerHeadline: { color: T.color.brand, fontSize: 16, fontWeight: '900' },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff75001A', marginBottom: 18 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: T.color.ink, marginBottom: 6 },
  emptyCopy: { fontSize: 14, lineHeight: 20, color: T.color.muted, textAlign: 'center' },
});
