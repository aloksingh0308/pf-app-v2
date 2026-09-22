import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';
import styled from 'styled-components/native';
import { AppColors } from '@/constants/appColors';

export default function MealScreen() {
  const insets = useSafeAreaInsets();

  return (
    <Container style={{ paddingTop: insets.top }}>
      <IconCircle>
        <Ionicons name="restaurant-outline" size={40} color={AppColors.primary} />
      </IconCircle>
      <Title>Meal</Title>
      <Subtitle>Coming soon</Subtitle>
      <Description>
        We&apos;re cooking up something special for you here. Check back soon!
      </Description>
    </Container>
  );
}

const Container = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: ${AppColors.background};
`;

const IconCircle = styled.View`
  width: 88px;
  height: 88px;
  border-radius: 44px;
  align-items: center;
  justify-content: center;
  background-color: ${AppColors.primary}1A;
  margin-bottom: 20px;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
  margin-bottom: 6px;
`;

const Subtitle = styled.Text`
  font-size: 15px;
  font-weight: 600;
  color: ${AppColors.primary};
  margin-bottom: 12px;
`;

const Description = styled.Text`
  font-size: 14px;
  color: ${AppColors.textMuted};
  text-align: center;
  line-height: 20px;
`;
