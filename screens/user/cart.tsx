import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppStrings } from '@/constants/appStrings';
import { useAppLoader } from '@/hooks/useAppLoader';
import { decrementQuantity, incrementQuantity, removeFromCart } from '@/store/slices/cartSlice';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { getAvailabilityByFirebaseIds } from '../../services/menuService';
import { RootState } from '../../store';
import { buildProductCartKey } from '@/utils/productVariants';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';

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
  const dispatch = useDispatch()

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
      const quantities = items.map((entry) => Math.max(1, Number(entry.quantity || 1)));
      const bundleQuantity = quantities.reduce((acc, value) => gcd(acc, value), quantities[0] || 1);
      const first = items[0];
      const itemMap = new Map<string, number>();

      items.forEach((entry) => {
        const unitQty = Math.max(1, Math.round(Number(entry.quantity || 1) / Math.max(1, bundleQuantity)));
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

  // Helper for veg/non-veg icon
  const getFoodTypeIcon = () => {
    // If item.veg === true or item.foodType === 'veg', show green dot, else red
    const isVeg = true;
    return (
      <FoodTypeIconBox>
        <FoodTypeDot style={{ backgroundColor: isVeg ? '#43b02a' : '#b91c1c' }} />
      </FoodTypeIconBox>
    );
  };

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
      appLoader.hide();
    }
  };

  return (
    <Container>
      <HeaderContainer style={{ paddingTop: Math.max(insets.top, moderateVerticalScale(30)) }}>
        <BackButton onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={moderateScale(24)} color="#282939" />
        </BackButton>
        <Title>{AppStrings.cart.title}</Title>
      </HeaderContainer>
      <FlatList
        data={cartRows}
        contentContainerStyle={{
          paddingBottom: Math.max(moderateVerticalScale(80), insets.bottom + moderateVerticalScale(70)),
          paddingTop: moderateVerticalScale(6),
        }}
        showsVerticalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.type === 'deal') {
            return (
              <CartCard key={item.key}>
                <CardContent>
                  <CartCardInfo>
                    <DealTitleRow>
                      <DealFlame>🔥</DealFlame>
                      <DealHeading>Today&apos;s Deal</DealHeading>
                    </DealTitleRow>
                    <CartCardTitle numberOfLines={2}>{item.dealName}</CartCardTitle>
                    {item.items.map((entry) => (
                      <DealItemLine key={`${item.dealId}-${entry.name}`}>
                        {entry.unitQty > 1 ? `• ${entry.name} x${entry.unitQty}` : `• ${entry.name}`}
                      </DealItemLine>
                    ))}
                    <CartCardPrice>
                      {item.originalDealPrice > 0 ? `Original ₹${item.originalDealPrice.toFixed(0)}  ` : ''}
                      Deal ₹{item.dealPrice.toFixed(0)}
                    </CartCardPrice>
                    <QtyControl style={{ marginTop: moderateVerticalScale(12) }}>
                      <QtyBtn onPress={() => dispatch(decrementQuantity(item.cartKey))}>
                        <QtyBtnText>-</QtyBtnText>
                      </QtyBtn>
                      <QtyValue>{item.quantity}</QtyValue>
                      <QtyBtn onPress={() => dispatch(incrementQuantity(item.cartKey))}>
                        <QtyBtnText>+</QtyBtnText>
                      </QtyBtn>
                    </QtyControl>
                  </CartCardInfo>
                </CardContent>
                <RemoveBox>
                  <Remove onPress={() => handleRemoveDeal(item)}>
                    <RemoveText>Remove Deal</RemoveText>
                  </Remove>
                </RemoveBox>
              </CartCard>
            );
          }

          const row = item.item;
          return (
            <CartCard key={item.key}>
              <CardContent>
                <ImageBox>
                  <ProductImage source={{ uri: row.images?.[0] || 'https://via.placeholder.com/80' }} />
                  <VegOverlay>
                    {getFoodTypeIcon()}
                  </VegOverlay>
                </ImageBox>
                <CartCardInfo>
                  <CartCardTitle numberOfLines={2}>{row.name}</CartCardTitle>
                  {row.selectedVariantName ? <CartVariantText>{row.selectedVariantName}</CartVariantText> : null}
                  <CartCardPrice>₹{row.price.toFixed(2)}</CartCardPrice>
                  <QtyControl style={{ marginTop: moderateVerticalScale(12) }}>
                    <QtyBtn onPress={() => dispatch(decrementQuantity(getCartKey(row)))}>
                      <QtyBtnText>-</QtyBtnText>
                    </QtyBtn>
                    <QtyValue>{row.quantity}</QtyValue>
                    <QtyBtn onPress={() => dispatch(incrementQuantity(getCartKey(row)))}>
                      <QtyBtnText>+</QtyBtnText>
                    </QtyBtn>
                  </QtyControl>
                </CartCardInfo>
              </CardContent>
              {/* <Divider /> */}
              <RemoveBox>
                <Remove onPress={() => handleRemoveItem(getCartKey(row), Boolean(row.isDeal))}>
                  <RemoveText>Remove</RemoveText>
                </Remove>
              </RemoveBox>
            </CartCard>
          )
        }}
      />
      {/* <ItemsScrollView
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: Math.max(80, insets.bottom + 70),
          backgroundColor:'red'
        }}
        showsVerticalScrollIndicator={false}
      >
        {cartItems.map((item) => (
         
        ))}
        Add-ons Section
        <AddonsSection cartItems={cartProductNames} />
      </ItemsScrollView> */}
      <ModernFooterContainer>
        <FooterSummary>
          <FooterTotal>₹{total.toFixed(2)}</FooterTotal>
          <FooterItems>{cartRows.length} item{cartRows.length !== 1 ? 's' : ''}</FooterItems>
        </FooterSummary>
        <FooterProceedBtn>
          <AppButton
            title={AppStrings.common.proceed}
            onPress={handleProceed}
            style={{ paddingVertical: moderateVerticalScale(16), paddingHorizontal: moderateScale(40), borderRadius: moderateScale(12), backgroundColor: AppColors.primary, minWidth: moderateScale(140) }}
            textStyle={{ fontSize: scaleFont(18), fontWeight: 'bold' }}
          />
        </FooterProceedBtn>
      </ModernFooterContainer>

    </Container>
  );
};
export default CartScreen;

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
`;

const HeaderContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: ${moderateScale(10)}px;
`;

const BackButton = styled.TouchableOpacity`
  width: ${moderateScale(40)}px;
  height: ${moderateVerticalScale(40)}px;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: ${scaleFont(20)}px;
  font-weight: bold;
  padding: 0 ${moderateScale(20)}px;
  width: 70%;
  text-align: center;
`;


const CartCard = styled.View`
  flex-direction: row;
  align-items: stretch;
  background-color: #fff;
  border-radius: ${moderateScale(18)}px;
  margin: 0 ${moderateScale(20)}px ${moderateVerticalScale(18)}px ${moderateScale(20)}px;
  shadow-color: #000;
  shadow-opacity: 0.08;
  shadow-radius: ${moderateScale(12)}px;
  elevation: 2;
  border-width: 1px;
  border-color: rgba(224, 224, 224, 0.5);
`;

const CardContent = styled.View`
  flex-direction: row;
  flex: 1.8;
  padding: ${moderateVerticalScale(10)}px 0 ${moderateVerticalScale(2)}px ${moderateScale(10)}px;
`;

const ImageBox = styled.View`
  position: relative;
  margin-right: ${moderateScale(14)}px;
`;

const VegOverlay = styled.View`
  position: absolute;
  top: ${moderateVerticalScale(4)}px;
  left: ${moderateScale(4)}px;
  z-index: 2;
`;


const ProductImage = styled.Image`
  width: ${moderateScale(72)}px;
  height: ${moderateVerticalScale(72)}px;
  border-radius: ${moderateScale(8)}px;
  background-color: #eee;
`;


const RemoveBox = styled.View`
  width: ${moderateScale(80)}px;
  align-items: center;
  justify-content: flex-end;
  padding: 0 0px ${moderateVerticalScale(20)}px 0px;
`;

const FoodTypeIconBox = styled.View`
  margin-bottom: ${moderateVerticalScale(4)}px;
`;

const FoodTypeDot = styled.View`
  width: ${moderateScale(16)}px;
  height: ${moderateVerticalScale(16)}px;
  border-radius: ${moderateScale(3)}px;
  border-width: 4.2px;
  border-color: #fff;
  background-color: #43b02a;
`;

const CartCardInfo = styled.View``;

const DealTitleRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: ${moderateVerticalScale(4)}px;
`;

const DealFlame = styled.Text`
  font-size: ${scaleFont(15)}px;
  margin-right: ${moderateScale(6)}px;
`;

const DealHeading = styled.Text`
  font-size: ${scaleFont(13)}px;
  color: #f97316;
  font-weight: 800;
`;

const DealItemLine = styled.Text`
  color: #4b5563;
  font-size: ${scaleFont(13)}px;
  margin-top: ${moderateVerticalScale(2)}px;
`;

const CartCardTitle = styled.Text`
  font-size: ${scaleFont(14)}px;
  font-weight: bold;
  color: #222;
  max-width: 125%;
`;

const CartCardPrice = styled.Text`
  font-size: ${scaleFont(14)}px;
  color: #888;
  margin-top: ${moderateVerticalScale(5)}px;
`;

const CartVariantText = styled.Text`
  font-size: ${scaleFont(13)}px;
  color: #6b7280;
  margin-top: ${moderateVerticalScale(4)}px;
`;


const QtyControl = styled.View`
  flex-direction: row;
  align-items: center;
  border-width: 1px;
  border-color: #f68712;
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateVerticalScale(2)}px ${moderateScale(8)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
  max-width: ${moderateScale(100)}px;
  justify-content: space-between;
`;

const QtyBtn = styled.TouchableOpacity`
  padding: ${moderateVerticalScale(2)}px ${moderateScale(10)}px;
`;

const QtyBtnText = styled.Text`
  font-size: ${scaleFont(18)}px;
  color: #f68712;
  font-weight: bold;
`;

const QtyValue = styled.Text`
  font-size: ${scaleFont(14)}px;
  font-weight: bold;
  text-align: center;
`;

const ModernFooterContainer = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #fff;
  border-top-left-radius: ${moderateScale(24)}px;
  border-top-right-radius: ${moderateScale(24)}px;
  shadow-color: #000;
  shadow-opacity: 0.08;
  shadow-radius: ${moderateScale(12)}px;
  elevation: 10;
  padding: ${moderateVerticalScale(20)}px ${moderateScale(30)}px ${moderateVerticalScale(40)}px ${moderateScale(30)}px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const FooterSummary = styled.View``;
const FooterTotal = styled.Text`
  font-size: ${scaleFont(22)}px;
  font-weight: bold;
  color: #222;
`;
const FooterItems = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #888;
  margin-top: ${moderateVerticalScale(2)}px;
`;
const FooterProceedBtn = styled.View`
  flex: 1;
  align-items: flex-end;
`;




const Remove = styled.TouchableOpacity`
  justify-content: center;
`;

const RemoveText = styled.Text`
  color: ${AppColors.primary};
  font-size: ${scaleFont(14)}px;
`;




