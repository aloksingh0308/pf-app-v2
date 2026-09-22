import { RootState } from '@/store';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSelector } from 'react-redux';

function LoadingDot({ index, visible }: { index: number; visible: boolean }) {
  const dotOpacity = useSharedValue(0.3);

  useEffect(() => {
    if (visible) {
      dotOpacity.value = withDelay(
        index * 200,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 400 }),
            withTiming(0.3, { duration: 400 }),
          ),
          -1,
          false,
        ),
      );
    } else {
      dotOpacity.value = withTiming(0.3, { duration: 150 });
    }
  }, [visible]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: dotOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: '#f68712',
          marginHorizontal: 4,
        },
        dotStyle,
      ]}
    />
  );
}

export default function GlobalLoader() {
  const { visible, message } = useSelector((state: RootState) => state.loader);

  const scale = useSharedValue(0.7);
  const opacity = useSharedValue(0);
  const translateX = useSharedValue(-18);
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      overlayOpacity.value = withTiming(1, { duration: 200 });
      opacity.value = withTiming(1, { duration: 250 });
      // Zoom-in + slide entrance then gentle pulse
      scale.value = withSequence(
        withSpring(1, { damping: 14, stiffness: 120 }),
        withDelay(
          400,
          withRepeat(
            withSequence(
              withTiming(1.06, { duration: 550, easing: Easing.inOut(Easing.sin) }),
              withTiming(0.97, { duration: 550, easing: Easing.inOut(Easing.sin) }),
            ),
            -1,
            false,
          ),
        ),
      );
      translateX.value = withSequence(
        withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }),
        withDelay(
          200,
          withRepeat(
            withSequence(
              withTiming(-5, { duration: 420, easing: Easing.inOut(Easing.sin) }),
              withTiming(0, { duration: 420, easing: Easing.inOut(Easing.sin) }),
            ),
            -1,
            false,
          ),
        ),
      );
    } else {
      scale.value = withTiming(0.8, { duration: 180 });
      opacity.value = withTiming(0, { duration: 180 });
      overlayOpacity.value = withTiming(0, { duration: 180 });
      translateX.value = 0;
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
    ],
  }));

  const messageOpacityStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
    >
      <View style={styles.card}>
        <Animated.Image
          source={require('../assets/images/logo.png')}
          style={[styles.logo, logoStyle]}
          resizeMode="contain"
        />
        {!!message && (
          <Animated.Text style={[styles.messageText, messageOpacityStyle]}>
            {message}
          </Animated.Text>
        )}
        <View style={styles.dotsRow}>
          {[0, 1, 2].map((i) => (
            <LoadingDot key={i} index={i} visible={visible} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 40,
    alignItems: 'center',
    elevation: 12,
    minWidth: 180,
  },
  logo: {
    width: 110,
    height: 110,
  },
  messageText: {
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
    color: '#282939',
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    marginTop: 18,
    alignItems: 'center',
  },
});
