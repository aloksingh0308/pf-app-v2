import React, { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';

/** Only the first screenful staggers in — later rows (and virtualized rows mounting while
 *  scrolling) render straight away, so long lists never feel slow or replay the effect. */
const MAX_ANIMATED_INDEX = 8;
const STAGGER_MS = 50;

type Props = {
  /** Position in its list — sets the stagger delay. */
  index: number;
  /** 'up' for vertical lists, 'left' for horizontal carousels. */
  from?: 'up' | 'left';
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/** The springy staggered fade-in used by the Rewards page cards, shared by every card list
 *  (restaurants, menu items, offers, favourites…) so they all enter the same way. Follows the
 *  system "reduce motion" setting (Reanimated's default). */
export default function AppearIn({ index, from = 'up', style, children }: Props) {
  if (index >= MAX_ANIMATED_INDEX) return style ? <Animated.View style={style}>{children}</Animated.View> : <>{children}</>;
  const base = from === 'left' ? FadeInRight : FadeInDown;
  // Fade as one layer: on Android the elevated card inside otherwise draws its shadow as a
  // dark box while the opacity animates.
  return (
    <Animated.View entering={base.delay(index * STAGGER_MS).springify().damping(18)} style={style} needsOffscreenAlphaCompositing>
      {children}
    </Animated.View>
  );
}
