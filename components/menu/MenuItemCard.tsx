import React, { useState } from 'react';
import { Animated, TouchableOpacity, View } from 'react-native';
import styled from 'styled-components/native';

const Card = styled.View`
  background: #fff;
  border-radius: 14px;
  border-width: 1px;
  border-color: #ececec;
  margin-bottom: 14px;
  padding: 12px 10px 14px 10px;
  flex-direction: row;
  align-items: flex-start;
`;

const Info = styled.View`
  flex: 1;
  margin-left: 10px;
`;

const NameRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const Name = styled.Text`
  font-size: 16px;
  font-weight: 700;
  color: #222;
`;

const Tag = styled.Text`
  background: #fff3e0;
  color: #f68712;
  font-size: 11px;
  font-weight: 700;
  border-radius: 8px;
  padding: 2px 8px;
  margin-left: 7px;
`;

const TagsRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 4px;
  margin-bottom: 2px;
`;

const PriceRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 6px;
`;

const Price = styled.Text`
  color: #f68712;
  font-weight: 800;
  font-size: 16px;
`;

const OffText = styled.Text`
  color: #b91c1c;
  font-size: 12px;
  font-weight: 700;
  margin-left: 8px;
`;

const Stepper = styled.View`
  flex-direction: row;
  align-items: center;
  border: 1.5px solid #f68712;
  border-radius: 16px;
  background: #fff;
  padding: 2px 10px;
  min-width: 80px;
  justify-content: center;
`;

const StepBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background: transparent;
  padding: 2px 8px;
  border-radius: 12px;
`;

const StepText = styled.Text`
  color: #f68712;
  font-size: 20px;
  font-weight: bold;
`;

const StepValue = styled.Text`
  font-size: 18px;
  font-weight: bold;
  color: #222;
  margin: 0 8px;
`;

const AddBtn = styled(Animated.createAnimatedComponent(TouchableOpacity)).attrs({ activeOpacity: 0.8 })`
  background: #f68712;
  border-radius: 12px;
  padding: 7px 22px;
  margin-top: 8px;
`;

const AddText = styled.Text`
  color: #fff;
  font-size: 15px;
  font-weight: 700;
`;

export default function MenuItemCard({
  item,
  onAdd,
  onRemove,
  onPress,
  isBestSeller,
  isMostOrdered,
  isBudgetPick,
  isSellingFast,
  quantity,
  tags,
}: {
  item: any,
  onAdd: () => void,
  onRemove: () => void,
  onPress: () => void,
  isBestSeller?: boolean,
  isMostOrdered?: boolean,
  isBudgetPick?: boolean,
  isSellingFast?: boolean,
  quantity: number,
  tags: string[],
}) {
  const [added, setAdded] = useState(quantity > 0);
  const scale = new Animated.Value(1);

  const handleAdd = () => {
    setAdded(true);
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.12, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
    onAdd();
  };

  return (
    <Card>
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ flex: 1 }}>
        <NameRow>
          <Name>{item.name}</Name>
          {isBestSeller && <Tag>🔥 Best Seller</Tag>}
          {isMostOrdered && <Tag>⭐ Most Ordered</Tag>}
          {isBudgetPick && <Tag>💸 Budget Pick</Tag>}
          {isSellingFast && <Tag>Selling fast 🔥</Tag>}
        </NameRow>
        <TagsRow>
          {tags.map((t, i) => (
            <Tag key={i}>{t}</Tag>
          ))}
        </TagsRow>
        <PriceRow>
          <Price>₹{item.price}</Price>
          {item.discountPercent > 0 && (
            <OffText>{item.discountPercent}% OFF</OffText>
          )}
        </PriceRow>
      </TouchableOpacity>
      <View style={{ minWidth: 70, alignItems: 'center' }}>
        {!added ? (
          <AddBtn style={{ transform: [{ scale }] }} onPress={handleAdd}>
            <AddText>ADD</AddText>
          </AddBtn>
        ) : (
          <Stepper>
            <StepBtn onPress={onRemove}><StepText>-</StepText></StepBtn>
            <StepValue>{quantity}</StepValue>
            <StepBtn onPress={onAdd}><StepText>+</StepText></StepBtn>
          </Stepper>
        )}
      </View>
    </Card>
  );
}
