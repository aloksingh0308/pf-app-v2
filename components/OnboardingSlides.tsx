import { PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_TEXT_STYLE } from '@/components/common/AppButton';
import Ionicons from '@react-native-vector-icons/ionicons';
import { StatusBar } from 'expo-status-bar';
import { ComponentProps, memo, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { track } from '@/services/analytics';
import { T } from '@/constants/tokens';

const ORANGE = T.color.brand;
// White + brand-orange theme: one soft orange behind every slide's icon.
const HERO_TINT = '#ffeedf';

type Slide = {
  key: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  badges: ComponentProps<typeof Ionicons>['name'][];
  title: string;
  text: string;
  tint: string;
};

const SLIDES: Slide[] = [
  {
    key: 'discover',
    icon: 'restaurant',
    badges: ['leaf', 'star', 'search'],
    title: 'Explore nearby restaurants',
    text: 'Discover the best kitchens around you, browse menus, filter Pure Veg or Non-Veg, and find what you are craving in seconds.',
    tint: HERO_TINT,
  },
  {
    key: 'order',
    icon: 'bag-handle',
    badges: ['bicycle', 'storefront', 'cafe'],
    title: 'Order your way',
    text: 'Home delivery to your door, takeaway from the counter, or dine in and order right from your table.',
    tint: HERO_TINT,
  },
  {
    key: 'track',
    icon: 'navigate',
    badges: ['notifications', 'time', 'location'],
    title: 'Track every step live',
    text: 'Get notified as your order is accepted, prepared and picked up, then follow your rider on the map.',
    tint: HERO_TINT,
  },
  {
    key: 'rewards',
    icon: 'gift',
    badges: ['pricetags', 'people', 'game-controller'],
    title: 'Offers, rewards & more',
    text: 'Save with coupons and deals, refer friends, and play games while you wait.',
    tint: HERO_TINT,
  },
];

// Badge positions around the hero circle (top-right, bottom-right, left).
const BADGE_POSITIONS = [
  { top: 6, right: 4 },
  { bottom: 14, right: -4 },
  { top: 92, left: -8 },
];

type Props = { onFinish: () => void };

const FADE_MS = 320;
const SWIPE_DISTANCE = 50;

/** First-launch intro (app/_layout.tsx shows it once per install, before login).
 *  One fixed page: on a slide change only the illustration cross-fades; the title and
 *  text swap in place with no motion. Swipe left/right or tap Next to change slides. */
export default function OnboardingSlides({ onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  // Read by the PanResponder, which is created once.
  const indexRef = useRef(0);
  indexRef.current = index;

  const skip = () => {
    track('onboarding_skipped', { slide: index + 1 });
    onFinish();
  };

  const goNext = () => {
    if (isLast) {
      track('onboarding_completed');
      onFinish();
      return;
    }
    setIndex(index + 1);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderRelease: (_, g) => {
          const i = indexRef.current;
          if (g.dx <= -SWIPE_DISTANCE && i < SLIDES.length - 1) setIndex(i + 1);
          else if (g.dx >= SWIPE_DISTANCE && i > 0) setIndex(i - 1);
        },
      }),
    []
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.brand}>
          Prayagi <Text style={{ color: ORANGE }}>Foodwala</Text>
        </Text>
        {/* Hidden rather than removed on the last slide so the header doesn't shift. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip intro"
          accessibilityElementsHidden={isLast}
          disabled={isLast}
          hitSlop={12}
          onPress={skip}
          style={[styles.skip, isLast && { opacity: 0 }]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <View style={styles.slide} {...pan.panHandlers}>
        <View style={styles.hero}>
          {/* Badge circles stay put (Android elevation shadows break up while
              semi-transparent); only the tint and the badge icons cross-fade. */}
          {SLIDES.map((s, i) => (
            <Fade key={s.key} active={i === index} style={styles.heroBg}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: s.tint }]} />
            </Fade>
          ))}
          {/* Keyed on the slide so the disc zooms in again on every change. */}
          <Animated.View key={slide.key} entering={ZoomIn.duration(400)} style={styles.heroIcon}>
            <Ionicons name={slide.icon} size={64} color="#fff" />
          </Animated.View>
          {BADGE_POSITIONS.map((pos, b) => (
            <View key={b} style={[styles.badge, pos]}>
              {SLIDES.map((s, i) => (
                <Fade key={s.key} active={i === index} style={styles.glyph}>
                  <Ionicons name={s.badges[b]} size={22} color={ORANGE} />
                </Fade>
              ))}
            </View>
          ))}
        </View>
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.text}>{slide.text}</Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={goNext}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.primaryText}>{isLast ? 'Get Started' : 'Next'}</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

/** Cross-fades its children in when `active`, out when not. Memoised so a slide change
 *  re-renders only the layers whose `active` flipped. */
const Fade = memo(function Fade({ active, style, children }: { active: boolean; style: StyleProp<ViewStyle>; children: ReactNode }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, { duration: FADE_MS });
  }, [active, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[style, animated]} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 52 },
  brand: { fontSize: 18, fontWeight: '800', color: T.color.ink },
  skip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: T.color.brandSoft },
  skipText: { color: ORANGE, fontWeight: '700', fontSize: 14 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  hero: { width: 240, height: 240, alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
  heroBg: { position: 'absolute', width: 240, height: 240, borderRadius: 120, overflow: 'hidden' },
  glyph: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heroIcon: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ORANGE,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  badge: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  // Fixed height so the hero sits at the same spot on every slide, whatever the text length.
  copy: { minHeight: 150 },
  title: { fontSize: 24, fontWeight: '800', color: T.color.ink, textAlign: 'center' },
  text: { marginTop: 12, fontSize: 15, lineHeight: 22, color: '#6b5a4e', textAlign: 'center' },
  footer: { paddingHorizontal: 24, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.color.brandBorder },
  dotActive: { width: 24, backgroundColor: ORANGE },
  primary: { ...PRIMARY_BUTTON_STYLE, alignSelf: 'stretch', gap: 8 },
  primaryText: PRIMARY_BUTTON_TEXT_STYLE,
});
