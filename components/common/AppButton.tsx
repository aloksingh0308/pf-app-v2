import { AppColors } from '@/constants/appColors';
import React from 'react';
import { ActivityIndicator } from 'react-native';
import styled from 'styled-components/native';

type Props = {
  title: string;
  onPress?: () => void;
  style?: any;
  textStyle?: any;
  disabled?: boolean;
  loading?: boolean;
  backgroundColor?: string;
  textColor?: string;
};

export default function AppButton({
  title,
  onPress,
  style,
  textStyle,
  disabled,
  loading,
  backgroundColor,
  textColor,
}: Props) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <Button
      onPress={onPress}
      disabled={isDisabled}
      style={style}
      backgroundColor={backgroundColor || AppColors.primary}
      isDisabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor || AppColors.white} />
      ) : (
        <ButtonText style={textStyle} textColor={textColor || AppColors.white}>{title}</ButtonText>
      )}
    </Button>
  );
}

const Button = styled.TouchableOpacity.attrs({
  activeOpacity: 0.7,
})<{ backgroundColor: string; isDisabled: boolean }>`
  background-color: ${({ backgroundColor }: { backgroundColor: string }) => backgroundColor};
  padding: 12px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  opacity: ${({ isDisabled }: { isDisabled: boolean }) => (isDisabled ? 0.7 : 1)};
`;

const ButtonText = styled.Text<{ textColor: string }>`
  color: ${({ textColor }: { textColor: string }) => textColor};
  font-size: 14px;
  font-weight: 700;
`;
