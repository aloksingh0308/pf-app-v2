import { T } from '@/constants/tokens';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Shared building blocks for the settings-style screens (Profile, More, Wallet History,
 * Refer & Earn) so they share one spacing scale, type scale and card treatment:
 * a small uppercase SectionTitle above a rounded SectionCard holding ListRows.
 */

/** Aliases onto the app-wide tokens (constants/tokens.ts) so these screens match the rest. */
export const Palette = {
  page: T.color.canvas,
  card: T.color.surface,
  hairline: T.color.line,
  primary: T.color.brand,
  primarySoft: T.color.brandSoft,
  text: T.color.ink,
  textSecondary: T.color.muted,
  textMuted: T.color.faint,
  success: T.color.success,
  successSoft: T.color.successSoft,
  danger: T.color.danger,
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
    borderRadius: T.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.color.line,
    overflow: 'hidden',
    ...T.shadow.card,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.hairline, marginLeft: 64 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  rowPressed: { backgroundColor: T.color.canvas },
  iconBubble: { width: 38, height: 38, borderRadius: T.radius.md, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Palette.text },
  rowSubtitle: { fontSize: 12.5, color: Palette.textSecondary, marginTop: 2, lineHeight: 17 },
  rowValue: { fontSize: 14, fontWeight: '700', color: Palette.text, maxWidth: '45%', textAlign: 'right' },
});
