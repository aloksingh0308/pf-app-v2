import ScratchCard, { type ScratchRewardView } from '@/components/ScratchCard';
import { T } from '@/constants/tokens';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type ScratchRewardModalProps = {
  visible: boolean;
  reward: ScratchRewardView | null;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onScratchComplete: () => void;
};

/** Pops a scratch card over the screen. The prize stays hidden under the card's cover —
 *  nothing above the card gives it away. */
export default function ScratchRewardModal({
  visible,
  reward,
  title = 'Congratulations',
  subtitle = 'You unlocked a scratch card reward.',
  onClose,
  onScratchComplete,
}: ScratchRewardModalProps) {
  const appear = useRef(new Animated.Value(0)).current;
  const open = visible && Boolean(reward);

  useEffect(() => {
    if (!open) return;
    appear.setValue(0);
    Animated.spring(appear, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
  }, [open, appear]);

  if (!open || !reward) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.sheet,
            {
              opacity: appear.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
            },
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={20} color={T.color.inkSoft} />
          </Pressable>

          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name="gift" size={26} color="#fff" />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <ScratchCard reward={reward} onScratchComplete={onScratchComplete} onContinue={onClose} variant="embedded" />

          <View style={styles.note}>
            <Ionicons name="shield-checkmark-outline" size={15} color={T.color.muted} />
            <Text style={styles.noteText}>
              {reward.isCoinReward
                ? 'Each card can be scratched once. Coins go straight to your Reward coins.'
                : 'Each card can be scratched once. Apply the code at checkout.'}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(28, 25, 23, 0.55)', justifyContent: 'center', padding: T.space.lg },
  sheet: { borderRadius: 24, backgroundColor: T.color.surface, padding: T.space.lg, paddingTop: T.space.xl, ...T.shadow.float },
  close: {
    position: 'absolute',
    top: T.space.md,
    right: T.space.md,
    zIndex: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.color.canvas,
    borderWidth: 1,
    borderColor: T.color.line,
  },
  header: { alignItems: 'center', marginBottom: T.space.lg },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: T.color.brand, alignItems: 'center', justifyContent: 'center', marginBottom: T.space.md },
  title: { fontSize: T.font.heading + 2, fontWeight: '900', color: T.color.ink, textAlign: 'center' },
  subtitle: { marginTop: 4, fontSize: T.font.body, color: T.color.muted, textAlign: 'center' },
  note: { marginTop: T.space.md, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  noteText: { flexShrink: 1, fontSize: T.font.small, color: T.color.muted, textAlign: 'center' },
});
