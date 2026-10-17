import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import styled from 'styled-components/native';

import { useAppStatus } from '@/components/AppStatusProvider';
import { isRestaurantUnavailable } from '@/services/appConfigService';

/**
 * Shown on a restaurant's own screens (details, menu, checkout) when that restaurant is
 * paused or closed by its owner/manager. Reads the status of the restaurant those screens
 * just made active (services/restaurantContext.ts); renders nothing while it's open.
 */
export default function RestaurantPausedBanner({ restaurantName }: { restaurantName?: string }) {
  const { status, description } = useAppStatus();
  if (!isRestaurantUnavailable(status)) return null;
  const name = restaurantName?.trim() || 'This restaurant';
  return (
    <Banner accessibilityRole="alert">
      <Ionicons name="time-outline" size={22} color="#b45309" />
      <TextBox>
        <Title>{status === 'temporarily_paused' ? `${name} isn't taking orders right now` : `${name} is currently unavailable`}</Title>
        <Body>{description ? `${description} · ` : ''}You can still order from other restaurants.</Body>
      </TextBox>
    </Banner>
  );
}

const Banner = styled.View`
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  margin: 12px 16px 0;
  padding: 12px 14px;
  border-radius: 12px;
  background-color: #fff7e6;
  border-width: 1px;
  border-color: #fcd34d;
`;

const TextBox = styled.View`
  flex: 1;
`;

const Title = styled.Text`
  font-size: 15px;
  font-weight: 700;
  color: #92400e;
`;

const Body = styled.Text`
  margin-top: 2px;
  font-size: 13px;
  color: #78350f;
`;
