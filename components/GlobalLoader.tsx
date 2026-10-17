import { RootState } from '@/store';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSelector } from 'react-redux';

/** Don't show the loader at all for work that finishes faster than this — a flash of
 *  overlay for a 100ms request reads as a glitch, not feedback. */
const SHOW_DELAY_MS = 200;
/** Once shown, keep it up at least this long so it never blinks on and straight off. */
const MIN_VISIBLE_MS = 450;
const RING_SIZE = 84;

/**
 * App-wide blocking loader (driven by store/slices/loaderSlice via hooks/useAppLoader):
 * the brand logo inside a spinning ring on a compact card over a light scrim. Rendered
 * only while needed, so it never sits invisibly on top of the app between uses.
 */
export default function GlobalLoader() {
  const { visible, message } = useSelector((state: RootState) => state.loader);
  const [mounted, setMounted] = useState(false);
  const shownAtRef = useRef(0);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fade = useSharedValue(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (visible) {
      // Shown again mid-fade-out: cancel the pending unmount and fade straight back in.
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
      }
      timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setMounted(true);
        fade.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
        rotation.value = 0;
        rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
      }, SHOW_DELAY_MS);
    } else if (mounted) {
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAtRef.current));
      timer = setTimeout(() => {
        fade.value = withTiming(0, { duration: 160 });
        unmountTimerRef.current = setTimeout(() => {
          unmountTimerRef.current = null;
          cancelAnimation(rotation);
          setMounted(false);
        }, 170);
      }, remaining);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ scale: 0.92 + fade.value * 0.08 }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  if (!mounted) return null;

  const label = message || 'Please wait…';
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} pointerEvents="auto">
      <Animated.View
        style={[styles.card, cardStyle]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.ringWrap}>
          <View style={styles.ringTrack} />
          <Animated.View style={[styles.ringArc, ringStyle]} />
          <Animated.Image source={require('../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <Animated.Text style={styles.message} numberOfLines={2}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: 'rgba(24, 18, 12, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 168,
    maxWidth: 260,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RING_SIZE / 2,
    borderWidth: 3,
    borderColor: '#fdebd8',
  },
  ringArc: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RING_SIZE / 2,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: '#f68712',
    borderRightColor: '#f68712',
  },
  logo: {
    width: RING_SIZE - 26,
    height: RING_SIZE - 26,
  },
  message: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '600',
    color: '#2b2f3a',
    textAlign: 'center',
  },
});
