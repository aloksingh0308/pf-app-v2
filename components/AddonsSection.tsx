import { AddonItem, fetchAddons } from '@/services/addonsService';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { decrementQuantity, incrementQuantity } from '../store/slices/cartSlice';
import { AddonCard } from './AddonCard';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';
import { T } from '@/constants/tokens';

type Props = {
  cartItems: string[];
};


export const AddonsSection: React.FC<Props> = React.memo(({ cartItems }) => {
  const dispatch = useDispatch();
  const { addItem } = useAddToCartWithRestaurantGuard();
  const [addons, setAddons] = useState<AddonItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Get cart items from Redux for quantity lookup
  const cartState = useSelector((state: RootState) => state.cart.items);

  const loadAddons = useCallback(async () => {
    setLoading(true);
    const data = await fetchAddons(cartItems);
    setAddons(data);
    setLoading(false);
  }, [cartItems]);

  useEffect(() => {
    loadAddons();
  }, [loadAddons]);

  if (!loading && addons.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>Complete Your Treat 😍</Text>
        <Text style={styles.emptySubtitle}>No add-ons available right now.</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Complete Your Treat 😍</Text>
      <Text style={styles.subtitle}>Customers also added 👀</Text>
      <FlatList
        data={addons}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          // Find if this addon is already in cart
          const cartQty = cartState.find(
            ci => ci.id === item.id || ci.firebaseId === item.id
          )?.quantity || 0;

          // Map AddonItem to Product/CartItem
          const mapAddonToProduct = (addon: AddonItem) => ({
            id: addon.id,
            name: addon.name,
            description: '',
            images: addon.imageUrl ? [addon.imageUrl] : [],
            price: addon.price,
            qty: null,
            serves: null,
            categoryId: null,
            cafeId: null,
            restaurantId: null,
            emoji: null,
            available: addon.isAvailable ?? true,
            hasHalfPortion: false,
            halfPrice: null,
            firebaseId: addon.id,
            createdAt: null,
          });

          return (
            <AddonCard
              addon={item}
              quantity={cartQty}
              onAdd={() => addItem({ ...mapAddonToProduct(item), quantity: 1 })}
              onIncrement={() => dispatch(incrementQuantity(item.id))}
              onDecrement={() => dispatch(decrementQuantity(item.id))}
            />
          );
        }}
        style={{ marginTop: 10 }}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 8 }}
        initialNumToRender={5}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
});

AddonsSection.displayName = 'AddonsSection';

const styles = StyleSheet.create({
  section: {
    marginTop: 18,
    backgroundColor: '#fff',
    marginBottom: 18,
    paddingVertical: 12,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  title: {
    fontWeight: '800',
    fontSize: 18,
    color: T.color.ink,
    marginLeft: 16,
    marginBottom: 2,
  },
  subtitle: {
    fontWeight: '600',
    fontSize: 14,
    color: T.color.faint,
    marginLeft: 16,
    marginBottom: 8,
  },
  emptyWrap: {
    alignItems: 'center',
    padding: 18,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 18,
    color: T.color.ink,
  },
  emptySubtitle: {
    fontWeight: '600',
    fontSize: 14,
    color: T.color.faint,
    marginTop: 4,
  },
});
