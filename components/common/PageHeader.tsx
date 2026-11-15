import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/tokens';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export type PageHeaderAction = {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
};

type Props = {
  title: string;
  onBack?: () => void;
  showBack?: boolean;
  backDisabled?: boolean;
  actions?: PageHeaderAction[];
};

/** Screens leave the top inset to PageHeader; bottom/side insets remain safe on iOS. */
export function PageScreen(props: ComponentProps<typeof SafeAreaView>) {
  return <SafeAreaView {...props} edges={['left', 'right', 'bottom']} />;
}

/** PageScreen for a bottom-tab screen: the tab bar already sits above the system nav bar,
 *  so a bottom inset here left an empty band that cut the scrolling content off. */
export function TabScreen(props: ComponentProps<typeof SafeAreaView>) {
  return <SafeAreaView {...props} edges={['left', 'right']} />;
}

/** Keep this outside scrolling content. Equal side slots center the title on the screen. */
export default function PageHeader({ title, onBack, showBack = true, backDisabled = false, actions = [] }: Props) {
  const insets = useSafeAreaInsets();
  const sideWidth = Math.max(44, actions.length * 44);
  return (
    <View style={[styles.safeArea, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.row}>
        <View style={[styles.side, { width: sideWidth }]}>
          {showBack && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityState={{ disabled: backDisabled }}
            disabled={backDisabled}
            onPress={onBack || (() => router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={({ pressed }) => [styles.button, (pressed || backDisabled) && styles.dimmed]}
          ><Ionicons name="chevron-back" size={24} color={T.color.ink} /></Pressable>}
        </View>
        <Text accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{title}</Text>
        <View style={[styles.side, styles.right, { width: sideWidth }]}>
          {actions.map(action => <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: Boolean(action.disabled) }}
            disabled={action.disabled}
            onPress={action.onPress}
            style={({ pressed }) => [styles.button, (pressed || action.disabled) && styles.dimmed]}
          ><Ionicons name={action.icon} size={23} color={action.color || T.color.brand} /></Pressable>)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { alignSelf: 'stretch', backgroundColor: T.color.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.color.line, zIndex: 1 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  side: { flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  dimmed: { opacity: 0.45 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: T.color.ink, paddingVertical: 12 },
});
