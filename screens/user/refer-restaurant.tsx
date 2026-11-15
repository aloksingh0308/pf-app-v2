import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import { track } from '@/services/analytics';
import {
  formatRupees,
  restaurantReferralService,
  type RestaurantReferral,
  type RestaurantReferralStatus,
  type RestaurantReferralSummary,
} from '@/services/restaurantReferralService';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showErrorAlert } from '../../services/alertService';

const STATUS: Record<RestaurantReferralStatus, { label: string; color: string; bg: string }> = {
  CLAIMED: { label: 'Waiting to join', color: '#92400e', bg: '#fef3c7' },
  PENDING: { label: 'In progress', color: '#1d4ed8', bg: '#e0ebff' },
  UNDER_REVIEW: { label: 'Under review', color: '#92400e', bg: '#fef3c7' },
  CREDITED: { label: 'Reward added', color: Palette.success, bg: Palette.successSoft },
  EXPIRED: { label: 'Expired', color: Palette.textSecondary, bg: Palette.hairline },
  REJECTED: { label: 'Not eligible', color: Palette.danger, bg: Palette.dangerSoft },
};

/**
 * Refer a restaurant: the customer shares a link to the website's restaurant sign-up form with
 * their code filled in. Once that restaurant joins and reaches the sales target in time, the
 * reward is added to the customer's wallet (backend services/referral).
 */
export default function ReferRestaurantScreen() {
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<RestaurantReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const load = useCallback(async () => {
    try {
      setSummary(await restaurantReferralService.getSummary());
    } catch (error) {
      showErrorAlert(error, 'Unable to load your restaurant referrals right now.', 'Error');
    }
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const code = summary?.code ?? '';
  const reward = summary ? formatRupees(summary.reward) : '';

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (!summary) return;
    track('refer_restaurant_share', { reward: summary.reward });
    try {
      const message =
        `Hi! I order food on Prayagi Foodwala and would love to order from you there too. ` +
        `Register your restaurant here — my referral code ${summary.code} is already filled in:\n${summary.shareUrl}`;
      await Share.share({ title: 'Join Prayagi Foodwala', message, url: summary.shareUrl });
    } catch (error) {
      showErrorAlert(error, 'Unable to open the share sheet right now.', 'Error');
    }
  };

  const steps: Array<{ icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }> = summary
    ? [
        { icon: 'share-social-outline', title: 'Share your link', body: 'Send it to a restaurant you love that isn’t on Prayagi Foodwala yet.' },
        { icon: 'storefront-outline', title: 'They register', body: 'The restaurant fills in the partner form — your code is already added.' },
        {
          icon: 'wallet-outline',
          title: `You get ${reward}`,
          body: `Once they reach ${formatRupees(summary.minSales)} in orders within ${summary.windowDays} days of joining, ${reward} is added to your wallet.`,
        },
      ]
    : [];

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Refer a restaurant" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Palette.primary} />
        </View>
      ) : !summary ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Couldn’t load this page.</Text>
          <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void load().finally(() => setLoading(false)); }} style={[styles.secondaryBtn, { marginTop: 12, paddingHorizontal: 24, flex: 0 }]}>
            <Text style={styles.secondaryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Palette.primary} />}
        >
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="storefront" size={34} color={Palette.primary} />
            </View>
            {summary.enabled ? (
              <>
                <Text style={styles.heroTitle}>Refer a restaurant, get {reward}</Text>
                <Text style={styles.heroCopy}>
                  Bring your favourite restaurant to Prayagi Foodwala. When it reaches {formatRupees(summary.minSales)} in orders within {summary.windowDays} days, {reward} goes to your wallet.
                </Text>

                <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Copy referral code ${code}`}
                  onPress={() => void copyCode()}
                  style={({ pressed }) => [styles.codeBox, pressed && { opacity: 0.8 }]}
                >
                  <Text selectable style={styles.codeText}>{code}</Text>
                  <View style={styles.copyPill}>
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={copied ? Palette.success : Palette.primary} />
                    <Text style={[styles.copyText, copied && { color: Palette.success }]}>{copied ? 'Copied' : 'Copy'}</Text>
                  </View>
                </Pressable>

                <Pressable accessibilityRole="button" onPress={() => void share()} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}>
                  <Ionicons name="share-social" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>Share with a restaurant</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.heroTitle}>Restaurant referrals are paused</Text>
                <Text style={styles.heroCopy}>We’re not taking new restaurant referrals right now. Referrals you’ve already made still count.</Text>
              </>
            )}
          </View>

          <View style={styles.stats}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{formatRupees(summary.earnedTotal)}</Text>
              <Text style={styles.statLabel}>Earned</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{summary.referrals.length}</Text>
              <Text style={styles.statLabel}>Restaurants referred</Text>
            </View>
          </View>

          {summary.enabled && (
            <>
              <SectionTitle>How it works</SectionTitle>
              <SectionCard>
                {steps.map((step, index) => (
                  <View key={step.title} style={styles.step}>
                    <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepTitle}>{step.title}</Text>
                      <Text style={styles.stepBody}>{step.body}</Text>
                    </View>
                    <Ionicons name={step.icon} size={22} color={Palette.primary} />
                  </View>
                ))}
              </SectionCard>
            </>
          )}

          <SectionTitle>Your referrals</SectionTitle>
          <SectionCard>
            {summary.referrals.length === 0 ? (
              <Text style={[styles.muted, { padding: 16 }]}>No restaurants yet. Share your link to get started.</Text>
            ) : (
              summary.referrals.map((r) => <ReferralRow key={r.id} referral={r} />)
            )}
          </SectionCard>
        </ScrollView>
      )}
    </PageScreen>
  );
}

function ReferralRow({ referral: r }: { referral: RestaurantReferral }) {
  const status = STATUS[r.status];
  const target = r.target.sales ?? 0;
  const pct = target > 0 ? Math.min(1, r.progress.sales / target) : 0;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.rowName} numberOfLines={1}>{r.refereeName || 'Restaurant'}</Text>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      {r.status === 'PENDING' && target > 0 ? (
        <>
          <View style={styles.track}><View style={[styles.fill, { width: `${pct * 100}%` }]} /></View>
          <Text style={styles.rowMeta}>
            {formatRupees(r.progress.sales)} of {formatRupees(target)}
            {r.expiresAt ? ` · by ${new Date(r.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
          </Text>
        </>
      ) : r.status === 'CREDITED' ? (
        <Text style={styles.rowMeta}>{formatRupees(r.reward)} added to your wallet</Text>
      ) : r.status === 'CLAIMED' ? (
        <Text style={styles.rowMeta}>We’ll start counting once their account is set up.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { fontSize: 13.5, color: Palette.textSecondary, textAlign: 'center' },
  content: { padding: 16 },
  hero: { backgroundColor: '#fff', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: Palette.hairline },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: Palette.text, marginTop: 14, textAlign: 'center' },
  heroCopy: { fontSize: 13.5, lineHeight: 20, color: Palette.textSecondary, marginTop: 6, textAlign: 'center' },
  codeLabel: { marginTop: 20, fontSize: 11, fontWeight: '800', letterSpacing: 1, color: Palette.textMuted },
  codeBox: {
    marginTop: 8,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#f9b56b',
    backgroundColor: '#fffaf4',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  codeText: { fontSize: 22, fontWeight: '900', letterSpacing: 3, color: Palette.text },
  copyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  copyText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
  primaryBtn: { marginTop: 16, alignSelf: 'stretch', minHeight: 48, borderRadius: 12, backgroundColor: Palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: Palette.primary, fontWeight: '800', fontSize: 14 },
  stats: { flexDirection: 'row', gap: 12, marginTop: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: Palette.hairline },
  statValue: { fontSize: 20, fontWeight: '800', color: Palette.text },
  statLabel: { fontSize: 12.5, color: Palette.textSecondary, marginTop: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: Palette.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepTitle: { fontSize: 14.5, fontWeight: '700', color: Palette.text },
  stepBody: { fontSize: 12.5, lineHeight: 18, color: Palette.textSecondary, marginTop: 2 },
  row: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Palette.hairline },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: Palette.text },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  track: { marginTop: 10, height: 6, borderRadius: 3, backgroundColor: Palette.hairline, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: Palette.primary },
  rowMeta: { marginTop: 6, fontSize: 12.5, color: Palette.textSecondary },
});
