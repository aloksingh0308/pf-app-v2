import React from 'react';
import styled from 'styled-components/native';

const Card = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 220px;
  background: #fff7ed;
  border-radius: 18px;
  margin-right: 16px;
  padding: 16px 14px 18px 14px;
  elevation: 2;
  border-width: 1px;
  border-color: #ffe0b2;
`;

const ComboTitle = styled.Text`
  font-size: 18px;
  font-weight: 800;
  color: #f68712;
`;

const SaveBadge = styled.View`
  background: #ffe0b2;
  padding: 4px 10px;
  border-radius: 10px;
  align-self: flex-start;
  margin-top: 6px;
  margin-bottom: 8px;
`;

const SaveText = styled.Text`
  color: #b85c00;
  font-weight: 700;
  font-size: 13px;
`;

const ComboDesc = styled.Text`
  color: #444;
  font-size: 13px;
  margin-bottom: 10px;
`;

const PriceRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 6px;
`;

const Price = styled.Text`
  color: #f68712;
  font-weight: 800;
  font-size: 18px;
`;

const OffText = styled.Text`
  color: #b91c1c;
  font-size: 13px;
  font-weight: 700;
  margin-left: 8px;
`;

export default function ComboCard({ combo, onPress }: { combo: any, onPress: () => void }) {
  return (
    <Card activeOpacity={0.8} onPress={onPress}>
      <ComboTitle>🔥 {combo.name}</ComboTitle>
      <SaveBadge>
        <SaveText>Save ₹{combo.saveAmount}</SaveText>
      </SaveBadge>
      <ComboDesc>{combo.tags.map((t: string) => ` ${t} `).join(' ')}</ComboDesc>
      <PriceRow>
        <Price>₹{combo.price}</Price>
        <OffText>{combo.discountPercent}% OFF</OffText>
      </PriceRow>
    </Card>
  );
}
