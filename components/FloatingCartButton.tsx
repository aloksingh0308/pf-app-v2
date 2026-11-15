import { useAppLoader } from '@/hooks/useAppLoader';
import { RootState } from '@/store';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { calculateCartTotals } from '@/utils/dealCart';
import { T } from '@/constants/tokens';

type FloatingCartButtonProps = {
  bottomOffset?: number;
};

export default function FloatingCartButton({ bottomOffset = 0 }: FloatingCartButtonProps) {
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const appLoader = useAppLoader();
  const { count, total, savings } = useMemo(() => {
    const summary = calculateCartTotals(cartItems as any);
    return {
      count: summary.displayCount,
      total: summary.total,
      savings: summary.savings,
    };
  }, [cartItems]);

  if (!count) return null;

  return (
    <CartBarContainer style={{ bottom: bottomOffset + 25 }}>
      <CartLeft>
        <CartIconContainer>
          <Ionicons name="cart-outline" size={20} color="#fff" />
          <CartBadge>
            <CartBadgeText>{count}</CartBadgeText>
          </CartBadge>
        </CartIconContainer>
        <CartInfo>
          <CartLine>
            <CartItemsText>{count} items</CartItemsText>
            <CartDivider>|</CartDivider>
            <CartPrice>₹{total.toFixed(0)}</CartPrice>
          </CartLine>
          {savings > 0 && (
            <CartSavings>
              You save <CartSavingsValue>₹{savings.toFixed(0)}</CartSavingsValue> on this order
            </CartSavings>
          )}
        </CartInfo>
      </CartLeft>
      <ViewCartButton activeOpacity={0.8} onPress={() => { appLoader.show(); router.push({ pathname: '/user/cart' }); }}>
        <ViewCartText>View Cart</ViewCartText>
        <Ionicons name="arrow-forward" size={20} color={T.color.brand} style={{ marginLeft: 4 }} />
      </ViewCartButton>
    </CartBarContainer>
  );
}

// --- Styled Components ---
const CartBarContainer = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  background: #f68712;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 14px 18px;
  margin: 0 10px 20px 10px;
  elevation: 10;
  shadow-color: #000;
  shadow-opacity: 0.08;
  shadow-radius: 8px;
  min-height: 64px;
  z-index: 100;
  border-radius: 48px;

`;
const CartLeft = styled.View`
  flex-direction: row;
  align-items: center;
  flex: 1;
`;
const CartIconContainer = styled.View`
  position: relative;
  width: 32px;
  height: 32px;
  background: #ffa940;
  border-radius: 16px;
  justify-content: center;
  align-items: center;
  margin-right: 12px;
`;
const CartBadge = styled.View`
  position: absolute;
  top: -5px;
  left: 18px;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  background: #fff;
  justify-content: center;
  align-items: center;
  border-width: 2px;
  border-color: #f68712;
`;
const CartBadgeText = styled.Text`
  color: #f68712;
  font-size: 12px;
  font-weight: bold;
`;
const CartInfo = styled.View`
  flex: 1;
`;
const CartLine = styled.View`
  flex-direction: row;
  align-items: center;
`;
const CartItemsText = styled.Text`
  color: #fff;
  font-size: 14px;
  font-weight: bold;
`;
const CartDivider = styled.Text`
  color: #fff;
  font-size: 14px;
  margin: 0 8px;
  font-weight: bold;
`;
const CartPrice = styled.Text`
  color: #fff;
  font-size: 18px;
  font-weight: bold;
`;
const CartSavings = styled.Text`
  color: #fff3e0;
  font-size: 12px;
  margin-top: 2px;
`;
const CartSavingsValue = styled.Text`
  color: #b6ffb6;
  font-weight: bold;
`;
const ViewCartButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background: #fff;
  border-radius: 16px;
  padding: 7px 10px;
  flex-direction: row;
  align-items: center;
  margin-left: 16px;
`;
const ViewCartText = styled.Text`
  color: #f68712;
  font-size: 14px;
  font-weight: bold;
`;
