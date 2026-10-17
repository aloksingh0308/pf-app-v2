import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Shared building blocks for the settings-style screens (Profile, More, Wallet History,
 * Refer & Earn) so they share one spacing scale, type scale and card treatment:
 * a small uppercase SectionTitle above a rounded SectionCard holding ListRows.
 */

export const Palette = {
  page: '#f7f7f9',
  card: '#ffffff',
  hairline: '#eeeef1',
  primary: AppColors.primary,
  primarySoft: '#fff3e6',
  text: '#1c1f26',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  success: '#15803d',
  successSoft: '#e8f6ec',
  danger: '#d92d20',
  dangerSoft: '#fdecea',
};

export function SectionTitle({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionTitleWrap, style]}>
      <Text style={styles.sectionTitle}>{children}</Text>
    </View>
  );
}

export function SectionCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, style]}>
      {rows.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 && <View style={styles.divider} />}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

type ListRowProps = {
  icon?: IconName;
  iconColor?: string;
  iconBackground?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  loading?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
  accessibilityLabel?: string;
};

export function ListRow({
  icon,
  iconColor,
  iconBackground,
  title,
  subtitle,
  value,
  onPress,
  destructive,
  loading,
  disabled,
  showChevron = Boolean(onPress),
  accessibilityLabel,
}: ListRowProps) {
  const tint = destructive ? Palette.danger : iconColor || Palette.primary;
  const content = (
    <>
      {icon ? (
        <View style={[styles.iconBubble, { backgroundColor: iconBackground || (destructive ? Palette.dangerSoft : Palette.primarySoft) }]}>
          <Ionicons name={icon} size={19} color={tint} />
        </View>
      ) : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, destructive && { color: Palette.danger }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
      {loading ? <ActivityIndicator size="small" color={tint} /> : showChevron ? <Ionicons name="chevron-forward" size={18} color={Palette.textMuted} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: Boolean(disabled || loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, (disabled || loading) && { opacity: 0.55 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitleWrap: { paddingHorizontal: 4, marginTop: 24, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Palette.textMuted },
  card: {
    backgroundColor: Palette.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6e6ea',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.hairline, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  rowPressed: { backgroundColor: '#fafafa' },
  iconBubble: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Palette.text },
  rowSubtitle: { fontSize: 12.5, color: Palette.textSecondary, marginTop: 2, lineHeight: 17 },
  rowValue: { fontSize: 14, fontWeight: '700', color: Palette.text, maxWidth: '45%', textAlign: 'right' },
});
