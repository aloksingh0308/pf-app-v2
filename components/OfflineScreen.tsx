import { AppColors } from '@/constants/appColors';
import { AppStrings } from '@/constants/appStrings';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Variant = 'offline' | 'server' | 'slow';

type Props = {
  onRetry?: () => void;
  /** Shows a spinner on the button while a re-check is running. */
  retrying?: boolean;
  variant?: Variant;
};

const COPY: Record<Variant, { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; message: string; tips: string[]; action: string }> = {
  offline: {
    icon: 'cloud-offline-outline',
    title: AppStrings.fallback.offlineTitle,
    message: AppStrings.fallback.offlineMessage,
    tips: ['Turn on mobile data or Wi-Fi', 'Turn off Airplane mode', 'Move to a spot with better signal'],
    action: AppStrings.fallback.retry,
  },
  server: {
    icon: 'server-outline',
    title: AppStrings.fallback.serverTitle,
    message: AppStrings.fallback.serverMessage,
    tips: ['Your internet is working', 'This usually fixes itself in a moment', 'We will reconnect automatically'],
    action: AppStrings.fallback.retry,
  },
  slow: {
    icon: 'speedometer-outline',
    title: AppStrings.fallback.slowTitle,
    message: AppStrings.fallback.slowMessage,
    tips: [],
    action: AppStrings.fallback.checkAgain,
  },
};

/** Full-screen "can't connect" state (see ConnectivityGate). */
export default function OfflineScreen({ onRetry, retrying = false, variant = 'offline' }: Props) {
  const insets = useSafeAreaInsets();
  const copy = COPY[variant];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} accessibilityRole="alert">
      <View style={styles.iconOuter}>
        <View style={styles.iconInner}>
          <Ionicons name={copy.icon} size={52} color={AppColors.primary} />
        </View>
      </View>

      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{copy.message}</Text>

      {copy.tips.length > 0 ? (
        <View style={styles.tips}>
          {copy.tips.map((tip) => (
            <View key={tip} style={styles.tipRow}>
              <Ionicons name="checkmark-circle-outline" size={18} color={AppColors.primary} />
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.action}
        disabled={retrying}
        onPress={onRetry}
        style={({ pressed }) => [styles.button, (pressed || retrying) && { opacity: 0.85 }]}
      >
        {retrying ? <ActivityIndicator color="#fff" /> : <Ionicons name="refresh" size={18} color="#fff" />}
        <Text style={styles.buttonText}>{retrying ? 'Checking…' : copy.action}</Text>
      </Pressable>
      <Text style={styles.hint}>We&apos;ll keep checking and continue automatically.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  iconOuter: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#fff4e8', alignItems: 'center', justifyContent: 'center' },
  iconInner: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#ffe6cc', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 24, fontSize: 22, fontWeight: '800', color: AppColors.textPrimary, textAlign: 'center' },
  message: { marginTop: 8, fontSize: 14.5, lineHeight: 21, color: AppColors.textSecondary, textAlign: 'center' },
  tips: { marginTop: 22, alignSelf: 'stretch', backgroundColor: '#fafafa', borderRadius: 16, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ececec' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tipText: { fontSize: 13.5, color: AppColors.textDark },
  button: {
    marginTop: 26,
    minWidth: 180,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: AppColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  hint: { marginTop: 12, fontSize: 12, color: AppColors.muted, textAlign: 'center' },
});
