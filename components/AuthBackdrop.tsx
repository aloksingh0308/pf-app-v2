import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { T } from '@/constants/tokens';

const ORANGE = T.color.brand;

// Food scattered around the screen edges — the look of the old photo backgrounds,
// drawn in code so it stays crisp and carries no city-specific text.
// Positions are % of the screen; the middle stays clear for the form card.
const FOODS: { emoji: string; top: `${number}%`; left?: `${number}%`; right?: `${number}%`; size: number; rotate: string }[] = [
  { emoji: '🍔', top: '3%', left: '-4%', size: 64, rotate: '-14deg' },
  { emoji: '🍕', top: '1%', right: '-3%', size: 66, rotate: '18deg' },
  { emoji: '🥗', top: '20%', right: '-5%', size: 44, rotate: '-8deg' },
  { emoji: '🍟', top: '26%', left: '-6%', size: 50, rotate: '12deg' },
  { emoji: '🌮', top: '60%', right: '-6%', size: 52, rotate: '-16deg' },
  { emoji: '🍜', top: '72%', left: '-6%', size: 52, rotate: '10deg' },
  { emoji: '🍩', top: '88%', right: '4%', size: 46, rotate: '20deg' },
  { emoji: '🥤', top: '89%', left: '10%', size: 42, rotate: '-10deg' },
];

const SPRINKLES: { top: `${number}%`; left: `${number}%`; color: string; size: number }[] = [
  { top: '13%', left: '24%', color: '#ffc58f', size: 6 },
  { top: '9%', left: '70%', color: '#ffb066', size: 5 },
  { top: '17%', left: '86%', color: '#ff9b3d', size: 7 },
  { top: '36%', left: '8%', color: '#ffb066', size: 5 },
  { top: '48%', left: '93%', color: '#ffc58f', size: 6 },
  { top: '56%', left: '4%', color: '#ff9b3d', size: 6 },
  { top: '68%', left: '94%', color: '#ffb066', size: 5 },
  { top: '80%', left: '3%', color: '#ffc58f', size: 5 },
  { top: '84%', left: '95%', color: '#ff9b3d', size: 7 },
];

/** Cream background with soft blobs and scattered food, behind the login / sign-up screens. */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.blob, styles.blobTop]} />
        <View style={[styles.blob, styles.blobBottom]} />
        {SPRINKLES.map((s, i) => (
          <View key={i} style={[styles.sprinkle, { top: s.top, left: s.left, width: s.size, height: s.size, backgroundColor: s.color }]} />
        ))}
        {FOODS.map((f) => (
          <Animated.View key={f.emoji} entering={FadeIn.duration(600)} style={[styles.food, { top: f.top, left: f.left, right: f.right }]}>
            <Text style={{ fontSize: f.size, transform: [{ rotate: f.rotate }] }}>{f.emoji}</Text>
          </Animated.View>
        ))}
      </View>
      {children}
    </View>
  );
}

/** Logo, app name and tagline shown above the auth form card. */
export function AuthBrandHeader({ logoSize = 112 }: { logoSize?: number }) {
  return (
    <Animated.View entering={FadeInDown.duration(500)} style={styles.brand}>
      <Image source={require('../assets/images/splash-logo.png')} style={{ width: logoSize, height: logoSize }} contentFit="contain" />
      <Text style={styles.brandName}>
        Prayagi <Text style={{ color: ORANGE }}>Foodwala</Text>
      </Text>
      <View style={styles.taglineRow}>
        <View style={styles.taglineRule} />
        <Text style={styles.tagline}>Explore nearby restaurants</Text>
        <View style={styles.taglineRule} />
      </View>
    </Animated.View>
  );
}

/** White rounded card holding the form. */
export function AuthCard({ children, delay = 120 }: { children: ReactNode; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(500)} style={styles.card}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobTop: { width: 340, height: 340, top: -150, alignSelf: 'center', backgroundColor: '#ffeedf' },
  blobBottom: { width: 280, height: 280, bottom: -130, right: -90, backgroundColor: T.color.brandSoft },
  sprinkle: { position: 'absolute', borderRadius: 4, opacity: 0.75 },
  food: { position: 'absolute' },
  brand: { alignItems: 'center', marginBottom: 20 },
  brandName: { marginTop: 2, fontSize: 28, fontWeight: '800', color: T.color.ink, letterSpacing: 0.2 },
  taglineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  taglineRule: { width: 22, height: 2, borderRadius: 1, backgroundColor: ORANGE },
  tagline: { fontSize: 14, fontWeight: '600', color: '#653919' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: '#ffe2c8',
    shadowColor: '#a8551b',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
});
