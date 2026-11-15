import PageHeader from '@/components/common/PageHeader';
import AppearIn from '@/components/common/AppearIn';
import AppImage from '@/components/AppImage';
import FoodTypeMark from '@/components/common/FoodTypeMark';
import { T } from '@/constants/tokens';
import { showAlert } from '@/services/alertService';
import { FavoriteCounts, FavoriteKind, FavoriteMenuItem, pageFavoriteItems, pageFavoriteRestaurants, removeFavorite } from '@/services/favoritesService';
import { usePagedList } from '@/hooks/usePagedList';
import { RestaurantRecord } from '@/services/restaurantService';
import { FoodType } from '@/types/Product';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Tab = 'RESTAURANTS' | 'DISHES';

/** For the one render right after a tab switch, before the old tab's rows are cleared. */
const isDish = (item: RestaurantRecord | FavoriteMenuItem): item is FavoriteMenuItem => 'restaurant' in item && typeof item.restaurant === 'object';

/** Profile → My favourites: the restaurants and dishes saved with the heart buttons, read from
 *  the customer's account (services/favoritesService.ts). A dish opens the restaurant selling it,
 *  same as a dish in search results. */
export default function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('RESTAURANTS');
  const [counts, setCounts] = useState<FavoriteCounts>({ restaurants: 0, items: 0 });

  // Each tab pages its own list from the API; switching tabs loads that tab from page 1.
  const list = usePagedList<RestaurantRecord | FavoriteMenuItem>(
    async (page) => {
      const result = tab === 'RESTAURANTS' ? await pageFavoriteRestaurants(page) : await pageFavoriteItems(page);
      setCounts(result.counts);
      return result;
    },
    (item) => item.id,
    [tab],
    { resetOnChange: true }
  );
  const loading = list.loading && list.items.length === 0;
  const failed = Boolean(list.error) && list.items.length === 0;

  const openRestaurant = useCallback((restaurant: RestaurantRecord) => {
    router.push({ pathname: '/user/restaurant-details', params: { restaurant: JSON.stringify(restaurant), categoryId: '0' } } as never);
  }, []);

  const unsave = useCallback(async (kind: FavoriteKind, id: string) => {
    const previous = list.items;
    const countKey = kind === 'RESTAURANT' ? 'restaurants' : 'items';
    list.setItems((current) => current.filter((item) => item.id !== id));
    setCounts((current) => ({ ...current, [countKey]: Math.max(0, current[countKey] - 1) }));
    try {
      await removeFavorite(kind, id);
    } catch {
      list.setItems(previous);
      setCounts((current) => ({ ...current, [countKey]: current[countKey] + 1 }));
      showAlert('Unable to update favourites', 'Please check your connection and try again.');
    }
  }, [list]);

  const renderRestaurant = ({ item, index }: { item: RestaurantRecord; index: number }) => (
    <AppearIn index={index}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => openRestaurant(item)} style={styles.card}>
      <AppImage uri={item.image || item.coverImage} style={styles.thumb} />
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.title}>{item.name || 'Restaurant'}</Text>
        {item.cuisine ? <Text numberOfLines={1} style={styles.muted}>{item.cuisine}</Text> : null}
        {item.address ? <Text numberOfLines={1} style={styles.muted}>{item.address}</Text> : null}
        {Number(item.ratingCount || 0) > 0 ? (
          <View style={styles.rating}>
            <Ionicons name="star" size={12} color={T.color.star} />
            <Text style={styles.ratingText}>{Number(item.rating || 0).toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from favourites`} hitSlop={10} onPress={() => void unsave('RESTAURANT', item.id)} style={styles.heart}>
        <Ionicons name="heart" size={20} color={T.color.danger} />
      </Pressable>
    </Pressable>
    </AppearIn>
  );

  const renderDish = ({ item, index }: { item: FavoriteMenuItem; index: number }) => (
    <AppearIn index={index}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.restaurant.name} for ${item.name}`} onPress={() => openRestaurant(item.restaurant)} style={styles.card}>
      <AppImage uri={item.imageUrl} style={[styles.thumb, !item.available && styles.dimmed]} />
      <View style={styles.body}>
        <View style={styles.nameRow}>
          {item.foodType ? <FoodTypeMark foodType={item.foodType as FoodType} size={12} /> : null}
          <Text numberOfLines={1} style={[styles.title, { flex: 1 }]}>{item.name}</Text>
        </View>
        <Text style={styles.price}>₹{Number(item.price || 0).toFixed(0)}</Text>
        <Text numberOfLines={1} style={styles.muted}>{item.restaurant.name}</Text>
        {!item.available ? <Text style={styles.unavailable}>Currently unavailable</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from favourites`} hitSlop={10} onPress={() => void unsave('MENU_ITEM', item.id)} style={styles.heart}>
        <Ionicons name="heart" size={20} color={T.color.danger} />
      </Pressable>
    </Pressable>
    </AppearIn>
  );

  const empty = loading ? (
    <View style={styles.state}><ActivityIndicator color={T.color.brand} /></View>
  ) : failed ? (
    <View style={styles.state}>
      <Text style={styles.emptyTitle}>Couldn&apos;t load your favourites</Text>
      <Pressable accessibilityRole="button" onPress={() => void list.refresh()} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
    </View>
  ) : (
    <View style={styles.state}>
      <Ionicons name="heart-outline" size={40} color={T.color.brand} />
      <Text style={styles.emptyTitle}>{tab === 'RESTAURANTS' ? 'No saved restaurants yet' : 'No saved dishes yet'}</Text>
      <Text style={styles.emptyText}>Tap the heart on a {tab === 'RESTAURANTS' ? 'restaurant page' : 'dish'} to save it here.</Text>
    </View>
  );

  const listProps = {
    contentContainerStyle: [styles.list, { paddingBottom: Math.max(insets.bottom + 24, 32) }],
    ListEmptyComponent: empty,
    refreshControl: <RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={T.color.brand} colors={[T.color.brand]} />,
    onEndReached: () => void list.loadMore(),
    onEndReachedThreshold: 0.5,
    ListFooterComponent: list.loadingMore ? <ActivityIndicator style={{ paddingVertical: 16 }} color={T.color.brand} /> : null,
  };

  return (
    <View style={styles.page}>
      <PageHeader title="My favourites" />
      <View style={styles.tabs}>
        {([['RESTAURANTS', `Restaurants (${counts.restaurants})`], ['DISHES', `Dishes (${counts.items})`]] as const).map(([id, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'RESTAURANTS'
        ? <FlatList key="restaurants" data={list.items.filter((item): item is RestaurantRecord => !isDish(item))} keyExtractor={(item) => item.id} renderItem={renderRestaurant} {...listProps} />
        : <FlatList key="dishes" data={list.items.filter(isDish)} keyExtractor={(item) => item.id} renderItem={renderDish} {...listProps} />}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: T.color.canvas },
  tabs: { flexDirection: 'row', gap: T.space.sm, paddingHorizontal: T.space.lg, paddingTop: T.space.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: T.radius.pill, borderWidth: 1, borderColor: T.color.line, backgroundColor: T.color.surface },
  tabActive: { backgroundColor: T.color.brandSoft, borderColor: T.color.brandBorder },
  tabText: { fontSize: T.font.body, fontWeight: '600', color: T.color.muted },
  tabTextActive: { color: T.color.brand },
  list: { paddingHorizontal: T.space.lg, paddingTop: T.space.md, gap: T.space.md, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, padding: T.space.md, borderRadius: T.radius.lg, backgroundColor: T.color.surface, ...T.shadow.card },
  thumb: { width: 64, height: 64, borderRadius: T.radius.md, backgroundColor: T.color.line },
  dimmed: { opacity: 0.5 },
  body: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: T.font.title, fontWeight: '700', color: T.color.ink },
  muted: { fontSize: T.font.small, color: T.color.muted },
  price: { fontSize: T.font.body, fontWeight: '700', color: T.color.inkSoft },
  unavailable: { fontSize: T.font.small, fontWeight: '600', color: T.color.danger },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText: { fontSize: T.font.small, fontWeight: '700', color: T.color.inkSoft },
  heart: { padding: T.space.xs },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: T.space.sm },
  emptyTitle: { fontSize: T.font.title, fontWeight: '700', color: T.color.ink, textAlign: 'center' },
  emptyText: { fontSize: T.font.body, color: T.color.muted, textAlign: 'center' },
  retry: { marginTop: T.space.sm, paddingHorizontal: T.space.xl, paddingVertical: 10, borderRadius: T.radius.pill, backgroundColor: T.color.brand },
  retryText: { color: '#fff', fontWeight: '700' },
});
