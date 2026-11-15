import React from 'react';
import { TouchableOpacity } from 'react-native';
import styled from 'styled-components/native';

const Banner = styled(TouchableOpacity).attrs({ activeOpacity: 0.8 })`
  background: #fff3e0;
  border-radius: 12px;
  margin: 10px 12px 0 12px;
  padding: 14px 18px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const BannerText = styled.Text`
  color: #f68712;
  font-weight: 700;
  font-size: 16px;
`;

export default function OfferBanner({ onPress }: { onPress: () => void }) {
  return (
    <Banner activeOpacity={0.8} onPress={onPress}>
      <BannerText>🎉 Get ₹50 OFF on first order</BannerText>
      <BannerText style={{ fontSize: 18 }}>→</BannerText>
    </Banner>
  );
}
