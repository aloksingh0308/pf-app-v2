import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/constants/tokens';

const ORANGE = T.color.brand;
// Same image and size as the native splash (app.json → expo-splash-screen, imageWidth 180), and
// centred like it, so the hand-off from the native splash to this screen doesn't move the logo.
const LOGO_SIZE = 180;
const DISC_SIZE = 140; // white disc inside splash-logo.png

function LoadingDot({ index }: { index: number }) {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withDelay(
      index * 180,
      withRepeat(withSequence(withTiming(1, { duration: 360 }), withTiming(0.3, { duration: 360 })), -1)
    );
  }, [index, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

/** Launch screen shown while fonts load and the session is restored (see app/_layout.tsx). */
const SplashScreen = () => {
  const insets = useSafeAreaInsets();
  const ringScale = useSharedValue(1);

  useEffect(() => {
    ringScale.value = withRepeat(withTiming(1.35, { duration: 1600, easing: Easing.out(Easing.quad) }), -1);
  }, [ringScale]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: 1.35 - ringScale.value,
  }));

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={[styles.blob, styles.blobTop]} />
      <View style={[styles.blob, styles.blobBottom]} />

      <View style={styles.center}>
        <Animated.View style={[styles.ring, ringStyle]} />
        <Image source={require('../assets/images/splash-logo.png')} style={styles.logo} contentFit="contain" />
      </View>

      <View style={styles.titleBlock}>
        <Animated.View entering={FadeInDown.delay(150).duration(500)} style={{ alignItems: 'center' }}>
          <Text style={styles.title}>
            Prayagi <Text style={{ color: ORANGE }}>Foodwala</Text>
          </Text>
          <Text style={styles.tagline}>Explore nearby restaurants</Text>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(400).duration(500)} style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => <LoadingDot key={i} index={i} />)}
        </View>
        <Text style={styles.footerText}>Powered by Hungry&apos;s Bucket Cafe</Text>
      </Animated.View>
    </View>
  );
};

export default SplashScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fffbf7', overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  blobTop: { width: 320, height: 320, top: -120, right: -110, backgroundColor: '#ffe6d1' },
  blobBottom: { width: 260, height: 260, bottom: -90, left: -100, backgroundColor: T.color.brandSoft },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: DISC_SIZE, height: DISC_SIZE, borderRadius: DISC_SIZE / 2, borderWidth: 2, borderColor: ORANGE },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  titleBlock: { position: 'absolute', left: 24, right: 24, top: '50%', marginTop: LOGO_SIZE / 2 + 8 },
  title: { fontSize: 30, fontWeight: '800', color: T.color.ink, letterSpacing: 0.3 },
  tagline: { marginTop: 8, fontSize: 15, fontWeight: '600', color: '#653919' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: ORANGE },
  footerText: { fontSize: 13, color: '#8a6a55', fontWeight: '500' },
});
