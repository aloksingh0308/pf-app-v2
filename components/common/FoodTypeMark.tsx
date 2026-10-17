import React from 'react';
import { View } from 'react-native';
import type { FoodType } from '@/types/Product';

const MARK_COLORS: Record<FoodType, string> = {
  VEG: '#15803d',
  VEGAN: '#15803d',
  EGG: '#d97706',
  NON_VEG: '#b91c1c',
};

export const FOOD_TYPE_LABELS: Record<FoodType, string> = {
  VEG: 'Veg',
  VEGAN: 'Vegan',
  EGG: 'Egg',
  NON_VEG: 'Non-veg',
};

/** The Indian veg / non-veg mark — a square outline with a dot (veg green, egg amber) or a
 *  triangle (non-veg red). Same symbol the SaaS admin's FoodTypeMark renders. */
export default function FoodTypeMark({ foodType, size = 14 }: { foodType?: FoodType | null; size?: number }) {
  if (!foodType) return null;
  const color = MARK_COLORS[foodType] || MARK_COLORS.VEG;
  const inner = Math.round(size * 0.45);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={FOOD_TYPE_LABELS[foodType]}
      style={{ width: size, height: size, borderWidth: 1.5, borderColor: color, borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}
    >
      {foodType === 'NON_VEG' ? (
        <View style={{ width: 0, height: 0, borderLeftWidth: inner / 2 + 0.5, borderRightWidth: inner / 2 + 0.5, borderBottomWidth: inner, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
      ) : (
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: color }} />
      )}
    </View>
  );
}
