import AppImage from '@/components/AppImage';
import { AppColors } from '@/constants/appColors';
import { showAlert } from '@/services/alertService';
import { buildCartItemsForDeal, buildDealDescription, fetchActiveDeals, hydrateDealItemNames } from '@/services/dealsService';
import { DealMenuView } from '@/types/Deal';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styled from 'styled-components/native';
import { useAddToCartWithRestaurantGuard } from '@/hooks/useAddToCartWithRestaurantGuard';

const FALLBACK_DEAL_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';

const getSavingsLabel = (deal: DealMenuView) => {
  const original = Math.max(0, Number(deal.pricing?.totalPrice || 0));
  const dealPrice = Math.max(0, Number(deal.pricing?.dealPrice || 0));
  const absolute = Math.max(0, original - dealPrice);

  if (absolute > 0) {
    return `Saved ₹${absolute.toFixed(0)}`;
  }

  const discountType = String(deal.pricing?.discountType || '').toLowerCase();
  if (discountType === 'percentage') {
    const value = Math.max(0, Math.min(100, Number(deal.pricing?.discountValue || 0)));
    if (value > 0) {
      return `${value.toFixed(0)}% OFF`;
    }
  }

  return 'Today\'s Deal';
};

export default function DealsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { addItems } = useAddToCartWithRestaurantGuard();
  const [deals, setDeals] = useState<DealMenuView[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDeals = useCallback(async () => {
    try {
      setLoading(true);
      const activeDeals = await fetchActiveDeals();
      if (activeDeals.length < 1) {
        setDeals([]);
        return;
      }
      const hydrated = await hydrateDealItemNames(activeDeals);
      setDeals(hydrated);
    } catch (error) {
      console.warn('Failed to load deals.', error);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDeals();
    }, [loadDeals])
  );

  const handleAddDeal = useCallback(async (deal: DealMenuView) => {
    try {
      const cartItems = await buildCartItemsForDeal(deal);
      if (cartItems.length < 1) {
        showAlert('Deal Unavailable', 'Some items in this deal are currently unavailable.');
        return;
      }

      const added = addItems(cartItems as any[]);
      if (added) {
        showAlert('Added To Cart', `${deal.name} added to cart.`);
      }
    } catch (error) {
      console.warn('Failed to add deal to cart.', error);
      showAlert('Unable To Add Deal', 'Please try again in a moment.');
    }
  }, [addItems]);

  const contentBottomPadding = useMemo(() => Math.max(18, insets.bottom + 12), [insets.bottom]);

  return (
    <Container>
      <Header style={{ paddingTop: Math.max(insets.top, 24) }}>
        <BackButton onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <HeaderTitle>Today&apos;s Deals</HeaderTitle>
      </Header>

      {loading ? (
        <Center>
          <ActivityIndicator size="large" color={AppColors.primary} />
        </Center>
      ) : deals.length < 1 ? (
        <EmptyWrap>
          <EmptyTitle>No active deals right now</EmptyTitle>
          <EmptySubtitle>Check again shortly for fresh combos.</EmptySubtitle>
        </EmptyWrap>
      ) : (
        <FlatList
          data={deals}
          keyExtractor={(item) => item.firebaseId}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: contentBottomPadding }}
          renderItem={({ item }) => {
            const description = buildDealDescription(item);
            const dealPrice = Math.max(0, Number(item.pricing?.dealPrice || 0));
            const savingsLabel = getSavingsLabel(item);

            return (
              <DealCard>
                <DealImageWrap>
                  <AppImage
                    uri={item.image}
                    fallbackUri={FALLBACK_DEAL_IMAGE}
                    style={{ width: '100%', height: '100%' }}
                  />
                </DealImageWrap>

                <DealBody>
                  <DealName numberOfLines={1}>{item.name || 'Today\'s Deal'}</DealName>
                  <DealDescriptionText numberOfLines={2}>{description || 'Includes combo items'}</DealDescriptionText>

                  <DealPriceRow>
                    <DealPriceText>₹{dealPrice.toFixed(0)}</DealPriceText>
                  </DealPriceRow>

                  <DealFooter>
                    <SavingsBadge>
                      <SavingsText>{savingsLabel}</SavingsText>
                    </SavingsBadge>
                    <AddButton onPress={() => handleAddDeal(item)}>
                      <AddButtonText>ADD</AddButtonText>
                    </AddButton>
                  </DealFooter>
                </DealBody>
              </DealCard>
            );
          }}
        />
      )}
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: #fff;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: 10px;
  padding-bottom: 10px;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const HeaderTitle = styled.Text`
  font-size: 20px;
  font-weight: 800;
  color: #171717;
  margin-left: 8px;
`;

const Center = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding-horizontal: 24px;
`;

const EmptyTitle = styled.Text`
  color: #222;
  font-size: 18px;
  font-weight: 800;
`;

const EmptySubtitle = styled.Text`
  margin-top: 6px;
  color: #666;
  font-size: 14px;
  text-align: center;
`;

const DealCard = styled.View`
  border-width: 1px;
  border-color: #ececec;
  border-radius: 14px;
  overflow: hidden;
  background-color: #fff;
  margin-bottom: 12px;
`;

const DealImageWrap = styled.View`
  width: 100%;
  height: 156px;
  background-color: #f4f4f4;
`;

const DealBody = styled.View`
  padding: 12px;
`;

const DealName = styled.Text`
  color: #1b1b1b;
  font-size: 16px;
  font-weight: 800;
`;

const DealDescriptionText = styled.Text`
  margin-top: 5px;
  color: #616161;
  font-size: 13px;
  font-weight: 500;
  min-height: 34px;
`;

const DealPriceRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 10px;
`;

const DealPriceText = styled.Text`
  color: #0c8e3b;
  font-size: 21px;
  font-weight: 900;
`;

const DealFooter = styled.View`
  margin-top: 10px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const SavingsBadge = styled.View`
  background-color: #eaffea;
  border-width: 1px;
  border-color: #d5f6d5;
  border-radius: 8px;
  padding: 5px 8px;
`;

const SavingsText = styled.Text`
  color: #1f8f3a;
  font-size: 12px;
  font-weight: 700;
`;

const AddButton = styled.TouchableOpacity`
  border-radius: 9px;
  border-width: 1px;
  border-color: #ffd3a8;
  background-color: #fff6ec;
  padding: 8px 12px;
`;

const AddButtonText = styled.Text`
  color: #f68712;
  font-size: 12px;
  font-weight: 800;
`;
