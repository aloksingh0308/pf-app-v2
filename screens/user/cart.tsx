import PageHeader from '@/components/common/PageHeader';
import { useAppLoader } from '@/hooks/useAppLoader';
import { decrementQuantity, incrementQuantity, removeFromCart } from '@/store/slices/cartSlice';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AppImage from '@/components/AppImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { getAvailabilityByFirebaseIds } from '../../services/menuService';
import { RootState } from '../../store';
import { buildProductCartKey } from '@/utils/productVariants';
import { getDealBundleQuantity, getDealUnitQuantity } from '@/utils/dealCart';


type DealGroupRow = {
  type: 'deal';
  key: string;
  cartKey: string;
  dealId: string;
  dealName: string;
  dealPrice: number;
  quantity: number;
  originalDealPrice: number;
  items: { name: string; unitQty: number }[];
};

type RegularRow = {
  type: 'item';
  key: string;
  item: any;
};

type CartRow = DealGroupRow | RegularRow;

const CartScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation()
  const cartState = useSelector((state: RootState) => state.cart);
  const cartItems = cartState.items;
  const appLoader = useAppLoader();
  const dispatch = useDispatch();
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    appLoader.hide();
  }, [appLoader]);
  const getCartKey = (item: any) => buildProductCartKey(item);

  const cartRows = useMemo<CartRow[]>(() => {
    const groupedByDeal = new Map<string, any[]>();
    cartItems.forEach((item) => {
      const dealId = String(item?.isDeal ? (item?.dealId || '') : '').trim();
      if (!dealId) return;
      const bucket = groupedByDeal.get(dealId) || [];
      bucket.push(item);
      groupedByDeal.set(dealId, bucket);
    });

    const dealRowsById = new Map<string, DealGroupRow>();
    groupedByDeal.forEach((items, dealId) => {
      const bundleQuantity = getDealBundleQuantity(items);
      const first = items[0];
      const itemMap = new Map<string, number>();

      items.forEach((entry) => {
        const unitQty = getDealUnitQuantity(entry, bundleQuantity);
        const label = String(entry.selectedVariantName ? `${entry.name} (${entry.selectedVariantName})` : entry.name || 'Item').trim();
        itemMap.set(label, (itemMap.get(label) || 0) + unitQty);
      });

      dealRowsById.set(dealId, {
        type: 'deal',
        key: `deal-${dealId}`,
        cartKey: getCartKey(first),
        dealId,
        dealName: String(first?.dealName || 'Today\'s Deal').trim() || 'Today\'s Deal',
        dealPrice: Number(first?.dealPrice || 0),
        originalDealPrice: Number(first?.originalDealPrice || 0),
        quantity: Math.max(1, bundleQuantity),
        items: Array.from(itemMap.entries()).map(([name, unitQty]) => ({ name, unitQty })),
      });
    });

    const rows: CartRow[] = [];
    const seenDealIds = new Set<string>();

    cartItems.forEach((item) => {
      const dealId = String(item?.isDeal ? (item?.dealId || '') : '').trim();
      if (!dealId) {
        rows.push({ type: 'item', key: `item-${getCartKey(item)}`, item });
        return;
      }

      if (!seenDealIds.has(dealId)) {
        const group = dealRowsById.get(dealId);
        if (group) {
          rows.push(group);
          seenDealIds.add(dealId);
        }
      }
    });

    return rows;
  }, [cartItems]);

  const total = cartRows.reduce((acc, row) => {
    if (row.type === 'deal') {
      return acc + Number(row.dealPrice || 0) * row.quantity;
    }
    return acc + Number(row.item.price || 0) * Number(row.item.quantity || 0);
  }, 0);


  const handleRemoveItem = (itemId: string, isDealItem = false) => {
    if (isDealItem) {
      showAlert('Deal Item', 'This item belongs to a deal. Remove the entire deal instead.');
      return;
    }

    const isLastItem = cartRows.length === 1;
    dispatch(removeFromCart(itemId));
    if (isLastItem) {
      router.replace('/(tabs)' as never);
    }
  };

  const handleRemoveDeal = (row: DealGroupRow) => {
    const isLastRow = cartRows.length === 1;
    dispatch(removeFromCart(row.cartKey));
    if (isLastRow) {
      router.replace('/(tabs)' as never);
    }
  };

  const handleProceed = async () => {
    if (checking) return;
    setChecking(true);
    appLoader.show('Checking availability...');
    try {
      if (cartItems.length === 0) {
        router.replace('/(tabs)' as never);
        return;
      }

      const firebaseIds = Array.from(
        new Set(
          cartItems
            .map((item) => String(item.firebaseId || '').trim())
            .filter(Boolean)
        )
      );

      const availabilityById = await getAvailabilityByFirebaseIds(firebaseIds);

      const unavailableInCart = cartItems.filter((item) => {
        const key = String(item.firebaseId || '').trim();
        if (!key) {
          return false;
        }
        return availabilityById.get(key) === false;
      });

      if (unavailableInCart.length > 0) {
        showAlert(
          'Item Unavailable',
          `${unavailableInCart[0].name} is currently unavailable or out of stock. Please remove unavailable items to proceed.`
        );
        return;
      }

      if (String(cartState.editingOrderId || '').trim()) {
        router.push({
          pathname: '/user/checkout',
          params: {
            orderType: cartState.editingOrderType || '',
            tableNumber: cartState.editingTableNumber || '',
            deliveryAddress: cartState.editingDeliveryAddress || '',
            customerName: '',
            customerPhone: '',
            restaurantId: cartState.editingRestaurantId || '',
            deliveryLatitude: cartState.editingDeliveryLatitude || '',
            deliveryLongitude: cartState.editingDeliveryLongitude || '',
            deliveryAddressId: cartState.editingDeliveryAddressId || '',
            existingOrderId: cartState.editingOrderId || '',
          },
        });
        return;
      }

      router.push('/user/location-detials' as never);
    } catch (error) {
      showErrorAlert(error, 'Unable to validate item availability. Please try again.', 'Error');
    } finally {
      setChecking(false);
      appLoader.hide();
    }
  };

  const count = cartRows.reduce((sum, row) => sum + (row.type === 'deal' ? row.quantity : Number(row.item.quantity || 0)), 0);
  const savings = cartRows.reduce((sum, row) => sum + (row.type === 'deal' ? Math.max(0, row.originalDealPrice - row.dealPrice) * row.quantity : 0), 0);
  const money = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const quantityControl = (key: string, quantity: number, name: string) => <View style={styles.quantity}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${name}`} onPress={() => dispatch(decrementQuantity(key))} style={styles.step}><Ionicons name="remove" size={18} color="#ff7500" /></Pressable>
    <Text style={styles.quantityValue}>{quantity}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Add one ${name}`} onPress={() => dispatch(incrementQuantity(key))} style={styles.step}><Ionicons name="add" size={18} color="#ff7500" /></Pressable>
  </View>;

  return <View style={styles.page}>
    <StatusBar style="dark" />
    <PageHeader title="Your cart" />
    <FlatList
      data={cartRows}
      keyExtractor={row => row.key}
      removeClippedSubviews={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: cartRows.length ? 24 : 40, flexGrow: cartRows.length ? 0 : 1 }}
      ListHeaderComponent={cartRows.length ? <>
        <Text style={[styles.subtitle, { marginVertical: 12 }]}>{count} item{count === 1 ? '' : 's'} · A little closer to delicious</Text>
        {savings > 0 && <View style={styles.savingStrip}><View style={styles.savingIcon}><Ionicons name="pricetag-outline" size={20} color="#25854c" /></View><View style={{ flex: 1 }}><Text style={styles.savingTitle}>Good food, great savings!</Text><Text style={styles.savingCopy}>You’re saving {money(savings)} with your combos.</Text></View></View>}
        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Your items</Text><Text style={styles.sectionHint}>Made for your cravings</Text></View>
      </> : null}
      renderItem={({ item }) => {
        if (item.type === 'deal') {
          const saved = Math.max(0, item.originalDealPrice - item.dealPrice) * item.quantity;
          return <View style={[styles.card, styles.comboCard]}>
            <View style={styles.row}><View style={styles.comboLabel}><Ionicons name="flame" color="#ff7500" size={15} /><Text style={styles.comboLabelText}>COMBO DEAL</Text></View><View style={{ flex: 1 }} /><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.dealName}`} onPress={() => handleRemoveDeal(item)} style={styles.remove}><Ionicons name="trash-outline" size={18} color="#90949b" /></Pressable></View>
            <Text style={styles.itemName}>{item.dealName}</Text>
            <View style={styles.comboContents}>{item.items.map(entry => <Text key={entry.name} style={styles.itemMeta}>• {entry.name}{entry.unitQty > 1 ? ` × ${entry.unitQty}` : ''}</Text>)}</View>
            <View style={styles.itemBottom}><View><View style={styles.row}><Text style={styles.price}>{money(item.dealPrice * item.quantity)}</Text>{saved > 0 && <Text style={styles.oldPrice}>{money(item.originalDealPrice * item.quantity)}</Text>}</View>{saved > 0 && <Text style={styles.saveBadge}>Save {money(saved)}</Text>}</View>{quantityControl(item.cartKey, item.quantity, item.dealName)}</View>
          </View>;
        }
        const row = item.item;
        return <View style={styles.card}>
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <AppImage uri={row.images?.[0]} style={styles.image} />
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <View style={[styles.row, { alignItems: 'flex-start' }]}><Text style={[styles.itemName, { flex: 1 }]}>{row.name}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.name}`} onPress={() => handleRemoveItem(getCartKey(row), Boolean(row.isDeal))} style={styles.remove}><Ionicons name="trash-outline" size={18} color="#90949b" /></Pressable></View>
              {!!row.selectedVariantName && <Text style={styles.itemMeta}>{row.selectedVariantName}</Text>}
              {row.selectedModifiers?.map((modifier: { modifierId: string; optionNames: string[] }) => <Text key={modifier.modifierId} style={styles.itemMeta}>{modifier.optionNames.join(', ')}</Text>)}
              <View style={styles.itemBottom}><View><Text style={styles.price}>{money(Number(row.price) * row.quantity)}</Text>{row.quantity > 1 && <Text style={styles.unitPrice}>{money(Number(row.price))} each</Text>}</View>{quantityControl(getCartKey(row), row.quantity, row.name)}</View>
            </View>
          </View>
        </View>;
      }}
      ListFooterComponent={cartRows.length ? <>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.addMore}><Ionicons name="add-circle-outline" size={20} color="#ff7500" /><Text style={styles.addMoreText}>Add more items</Text><Ionicons name="chevron-forward" size={17} color="#ff7500" /></Pressable>
        <View style={styles.bottomNote}><Ionicons name="heart-outline" size={15} color="#bba795" /><Text style={styles.bottomNoteText}>Good food. Happy moments.</Text></View>
      </> : null}
      ListEmptyComponent={<View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name="bag-handle-outline" size={48} color="#ff7500" /></View><Text style={styles.emptyTitle}>A fresh start for your cravings</Text><Text style={styles.emptyCopy}>Add your favourite dishes and we’ll keep them right here.</Text><Pressable onPress={() => router.replace('/(tabs)' as never)} style={styles.primary}><Text style={styles.primaryText}>Explore restaurants</Text><Ionicons name="arrow-forward" size={20} color="#fff" /></Pressable></View>}
    />
    {cartRows.length > 0 && <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}><View style={{ marginRight: 16 }}><Text style={styles.footerLabel}>CART TOTAL</Text><Text style={styles.footerTotal}>{money(total)}</Text></View><Pressable accessibilityRole="button" disabled={checking} onPress={handleProceed} style={[styles.primary, { flex: 1 }, checking && { opacity: 0.7 }]}>{checking ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryText}>Continue</Text><Ionicons name="arrow-forward" size={21} color="#fff" /></>}</Pressable></View>}
  </View>;
};
export default CartScreen;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fffbf7' }, row: { flexDirection: 'row', alignItems: 'center' },
  subtitle: { fontSize: 11, color: '#8a817a', marginTop: 4 },
  savingStrip: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#eff8f0', padding: 13, borderRadius: 14, borderColor: '#dfeee0', borderWidth: 1, marginBottom: 20 }, savingIcon: { backgroundColor: '#dff0e1', padding: 9, borderRadius: 12 }, savingTitle: { fontSize: 13, color: '#267344', fontWeight: '800' }, savingCopy: { fontSize: 11, color: '#568462', marginTop: 3 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, sectionTitle: { fontSize: 16, fontWeight: '800', color: '#202735' }, sectionHint: { fontSize: 10, color: '#9b9087' },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee6df', borderRadius: 16, padding: 13, marginBottom: 12 }, comboCard: { backgroundColor: '#fff9f2', borderColor: '#ffdfbc' }, comboLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }, comboLabelText: { fontSize: 10, fontWeight: '800', color: '#d86915', letterSpacing: 1 }, itemName: { fontSize: 14, fontWeight: '800', color: '#232a35', lineHeight: 20 }, comboContents: { marginTop: 4 }, itemMeta: { fontSize: 11, color: '#85858b', lineHeight: 17, marginTop: 2 }, image: { width: 66, height: 76, borderRadius: 10 }, remove: { padding: 6, marginTop: -4, marginRight: -4 }, itemBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }, price: { fontSize: 16, fontWeight: '800', color: '#252b36' }, oldPrice: { fontSize: 11, color: '#aaa0a0', textDecorationLine: 'line-through', marginLeft: 7 }, saveBadge: { fontSize: 10, color: '#2d8a4d', fontWeight: '700', marginTop: 5 }, unitPrice: { fontSize: 10, color: '#969093', marginTop: 2 },
  quantity: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#ffd0a5', backgroundColor: '#fff8f0', borderRadius: 11 }, step: { padding: 9 }, quantityValue: { minWidth: 19, textAlign: 'center', fontWeight: '800', fontSize: 13, color: '#34313b' },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 13, marginBottom: 16 }, addMoreText: { flex: 1, fontSize: 13, color: '#ff7500', fontWeight: '700' }, bottomNote: { flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', marginTop: 22 }, bottomNoteText: { fontSize: 11, color: '#b09f90' },
  footer: { flexDirection: 'row', alignItems: 'center', paddingTop: 15, paddingHorizontal: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#efe8e2' }, footerLabel: { fontSize: 9, letterSpacing: 1, color: '#9a9090', fontWeight: '700', marginBottom: 4 }, footerTotal: { fontSize: 23, fontWeight: '900', color: '#1e2632' }, primary: { minHeight: 49, borderRadius: 13, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#ff7500' }, primaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 25, paddingBottom: 50 }, emptyIcon: { backgroundColor: '#fff0e2', padding: 27, borderRadius: 50, marginBottom: 20 }, emptyTitle: { fontSize: 21, fontWeight: '800', color: '#252b36', textAlign: 'center' }, emptyCopy: { fontSize: 13, color: '#959095', textAlign: 'center', lineHeight: 20, marginTop: 10, marginBottom: 25 },
});
