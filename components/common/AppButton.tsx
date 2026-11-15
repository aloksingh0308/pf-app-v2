import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import styled from 'styled-components/native';
import { T } from '@/constants/tokens';

/** The one primary-button shape every screen uses (login, cart, table picker, checkout…),
 *  so CTAs look identical page to page. Hand-built buttons spread these in. */
export const PRIMARY_BUTTON_STYLE = {
  minHeight: 52,
  borderRadius: 14,
  paddingHorizontal: 20,
  backgroundColor: T.color.brand,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
} as const;
export const PRIMARY_BUTTON_TEXT_STYLE = { color: T.color.surface, fontSize: 16, fontWeight: '700' } as const;
/** Side gutter for a full-width CTA pinned to the bottom of a page. */
export const PRIMARY_BUTTON_GUTTER = 16;

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
      style={[PRIMARY_BUTTON_STYLE, backgroundColor ? { backgroundColor } : null, style]}
      isDisabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColor || T.color.surface} />
      ) : (
        <Text style={[PRIMARY_BUTTON_TEXT_STYLE, textColor ? { color: textColor } : null, textStyle]}>{title}</Text>
      )}
    </Button>
  );
}

const Button = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ isDisabled: boolean }>`
  opacity: ${({ isDisabled }: { isDisabled: boolean }) => (isDisabled ? 0.7 : 1)};
`;
