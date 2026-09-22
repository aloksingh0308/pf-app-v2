import { AppColors } from '@/constants/appColors';
import { AppStrings } from '@/constants/appStrings';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import styled from 'styled-components/native';
import AppButton from './common/AppButton';

type Props = {
  onRetry?: () => void;
  variant?: 'offline' | 'slow';
};

export default function OfflineScreen({ onRetry, variant = 'offline' }: Props) {
  const isSlow = variant === 'slow';
  const title = isSlow ? AppStrings.fallback.slowTitle : AppStrings.fallback.offlineTitle;
  const message = isSlow ? AppStrings.fallback.slowMessage : AppStrings.fallback.offlineMessage;
  const actionText = isSlow ? AppStrings.fallback.checkAgain : AppStrings.fallback.retry;

  return (
    <Container>
      <IconWrap>
        <Ionicons name={isSlow ? 'speedometer-outline' : 'cloud-offline-outline'} size={64} color={AppColors.primary} />
      </IconWrap>
      <Title>{title}</Title>
      <Message>{message}</Message>
      <AppButton title={actionText} onPress={onRetry} style={{ marginTop: 22, minWidth: 120, minHeight: 44 }} />
    </Container>
  );
}

const Container = styled.View`
  flex: 1;
  background-color: ${AppColors.background};
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const IconWrap = styled.View`
  margin-bottom: 12px;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const Message = styled.Text`
  margin-top: 8px;
  font-size: 14px;
  color: ${AppColors.textSecondary};
  text-align: center;
`;
