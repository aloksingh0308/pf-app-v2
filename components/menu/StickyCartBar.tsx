import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity } from 'react-native';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { RootState } from '../../store';
import { calculateCartTotals } from '@/utils/dealCart';

const Bar = styled(Animated.View)`
  position: absolute;
  left: 0; right: 0; bottom: 0;
  background: #fff;
  border-top-width: 1px;
  border-top-color: #f3e7d4;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px 18px 20px;
  elevation: 12;
  shadow-color: #000;
  shadow-opacity: 0.08;
  shadow-radius: 8px;
  z-index: 100;
`;

const CartButton = styled(TouchableOpacity)`
  background: #f68712;
  padding: 12px 28px;
  border-radius: 24px;
`;

const CartText = styled.Text`
  color: #fff;
  font-weight: 700;
  font-size: 17px;
`;

export default function StickyCartBar({ onPress }: { onPress: () => void }) {
  const cart = useSelector((state: RootState) => state.cart);
  const summary = calculateCartTotals(cart.items as any);
  const total = summary.total;
  const count = summary.displayCount;

  // Animation: bounce on add
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (count > 0) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 120, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 3, useNativeDriver: true }),
      ]).start();
    }
  }, [count]);

  if (count === 0) return null;

  return (
    <Bar style={{ transform: [{ scale }] }}>
      <Text style={{ fontWeight: '700', fontSize: 16 }}>
        {count} item{count > 1 ? 's' : ''} | ₹{total.toFixed(0)}
      </Text>
      <CartButton onPress={onPress}>
        <CartText>View Cart</CartText>
      </CartButton>
    </Bar>
  );
}
