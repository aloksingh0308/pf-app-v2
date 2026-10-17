import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { Palette } from '@/components/common/ListSection';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';

import { RootState } from '../../store';
import { userService } from '../../services/userService';

type WalletEntry = {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  referenceId?: string;
  balanceAfter?: number;
  createdAt?: any;
  /** Reward coins share the wallet ledger — shown in coins, never counted as ₹. */
  isCoins?: boolean;
};

type Filter = 'all' | 'credit' | 'debit';
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'credit', label: 'Credits' },
  { id: 'debit', label: 'Debits' },
];

const toDate = (value: any): Date | null => {
  const raw = value?.toDate?.() || value;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** "Today" / "Yesterday" / "12 Sep 2026" — the header each day's transactions sit under. */
const dayLabel = (date: Date | null) => {
  if (!date) return 'Earlier';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function WalletHistoryScreen() {
  const insets = useSafeAreaInsets();
  const user = useSelector((state: RootState) => state.auth.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!user?.uid) {
      setEntries([]);
      return;
    }
    try {
      const rows = await userService.listWalletTransactions();
      setEntries(rows.map((row) => ({ ...row, id: row._id, isCoins: row.metadata?.unit === 'coins' })));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [user?.uid]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const totals = useMemo(
    () =>
      entries.reduce(
        (acc, entry) => {
          if (entry.isCoins) return acc;
          if (entry.type === 'credit') acc.credit += Number(entry.amount || 0);
          else acc.debit += Number(entry.amount || 0);
          return acc;
        },
        { credit: 0, debit: 0 }
      ),
    [entries]
  );

  const sections = useMemo(() => {
    const groups = new Map<string, WalletEntry[]>();
    entries
      .filter((entry) => filter === 'all' || entry.type === filter)
      .forEach((entry) => {
        const label = dayLabel(toDate(entry.createdAt));
        groups.set(label, [...(groups.get(label) || []), entry]);
      });
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [entries, filter]);

  const walletBalance = Number(user?.walletBalance || 0);
  const coins = Number(user?.earnedCoin || 0);

  const header = (
    <View>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Wallet balance</Text>
        <Text style={styles.balanceValue}>₹{walletBalance.toFixed(2)}</Text>
        <View style={styles.balanceFooter}>
          <View style={styles.coinChip}>
            <Ionicons name="logo-bitcoin" size={14} color="#8a5a00" />
            <Text style={styles.coinText}>{coins} reward {coins === 1 ? 'coin' : 'coins'}</Text>
          </View>
          <Text style={styles.balanceHint}>Up to 10% of an order can be paid from wallet</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <View style={[styles.summaryIcon, { backgroundColor: Palette.successSoft }]}><Ionicons name="arrow-down" size={16} color={Palette.success} /></View>
          <View>
            <Text style={styles.summaryLabel}>Money in</Text>
            <Text style={[styles.summaryValue, { color: Palette.success }]}>₹{totals.credit.toFixed(2)}</Text>
          </View>
        </View>
        <View style={styles.summaryCard}>
          <View style={[styles.summaryIcon, { backgroundColor: Palette.dangerSoft }]}><Ionicons name="arrow-up" size={16} color={Palette.danger} /></View>
          <View>
            <Text style={styles.summaryLabel}>Money out</Text>
            <Text style={[styles.summaryValue, { color: Palette.danger }]}>₹{totals.debit.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={18} color="#8a5a00" />
        <Text style={styles.noticeText}>Reward coins can be redeemed on Sundays (20 coins = ₹1).</Text>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Transactions</Text>
        <View style={styles.filters}>
          {FILTERS.map((option) => {
            const active = option.id === filter;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(option.id)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Wallet History" />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Palette.primary} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={Palette.primary} colors={[Palette.primary]} />}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          renderSectionHeader={({ section }) => <Text style={styles.dayLabel}>{section.title}</Text>}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name={failed ? 'cloud-offline-outline' : 'receipt-outline'} size={28} color={Palette.textMuted} /></View>
              <Text style={styles.emptyTitle}>{failed ? "Couldn't load transactions" : filter === 'all' ? 'No transactions yet' : `No ${filter === 'credit' ? 'credits' : 'debits'} yet`}</Text>
              <Text style={styles.emptyBody}>{failed ? 'Pull down to try again.' : 'Wallet credits from referrals, refunds and rewards will show up here.'}</Text>
            </View>
          }
          renderItem={({ item, index, section }) => {
            const isCredit = item.type === 'credit';
            const date = toDate(item.createdAt);
            const first = index === 0;
            const last = index === section.data.length - 1;
            return (
              <View style={[styles.txn, first && styles.txnFirst, last && styles.txnLast, !last && styles.txnDivider]}>
                <View style={[styles.txnIcon, { backgroundColor: isCredit ? Palette.successSoft : Palette.dangerSoft }]}>
                  <Ionicons name={isCredit ? 'arrow-down' : 'arrow-up'} size={18} color={isCredit ? Palette.success : Palette.danger} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.txnTitle} numberOfLines={2}>{item.description || (isCredit ? 'Wallet credit' : 'Wallet debit')}</Text>
                  <Text style={styles.txnMeta}>
                    {date ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                    {typeof item.balanceAfter === 'number'
                      ? item.isCoins
                        ? ` · ${Number(item.balanceAfter)} coins`
                        : ` · Balance ₹${Number(item.balanceAfter).toFixed(2)}`
                      : ''}
                  </Text>
                </View>
                <Text style={[styles.txnAmount, { color: isCredit ? Palette.success : Palette.danger }]}>
                  {isCredit ? '+' : '−'}
                  {item.isCoins ? `${Number(item.amount || 0)} coins` : `₹${Number(item.amount || 0).toFixed(2)}`}
                </Text>
              </View>
            );
          }}
        />
      )}
    </PageScreen>
  );
}

const card = { backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e6ea' } as const;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  balanceCard: { backgroundColor: Palette.primary, borderRadius: 20, padding: 20 },
  balanceLabel: { color: '#ffe3c4', fontSize: 13, fontWeight: '600' },
  balanceValue: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  balanceFooter: { marginTop: 14, gap: 8 },
  coinChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff4d6', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  coinText: { color: '#8a5a00', fontWeight: '700', fontSize: 12.5 },
  balanceHint: { color: '#fff1e0', fontSize: 12 },
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  summaryCard: { ...card, flex: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontSize: 12, color: Palette.textSecondary },
  summaryValue: { fontSize: 15, fontWeight: '800', marginTop: 1 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, backgroundColor: '#fff8e6', borderRadius: 12, borderWidth: 1, borderColor: '#ffe7a8', padding: 12 },
  noticeText: { flex: 1, color: '#8a5a00', fontSize: 12.5, lineHeight: 18 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 4 },
  listTitle: { fontSize: 17, fontWeight: '800', color: Palette.text },
  filters: { flexDirection: 'row', gap: 6 },
  filterChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#e2e3e8', backgroundColor: '#fff' },
  filterChipActive: { borderColor: Palette.primary, backgroundColor: Palette.primarySoft },
  filterText: { fontSize: 12, fontWeight: '600', color: Palette.textSecondary },
  filterTextActive: { color: Palette.primary, fontWeight: '800' },
  dayLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', color: Palette.textMuted, marginTop: 16, marginBottom: 8, paddingHorizontal: 4 },
  txn: { ...card, borderTopWidth: 0, borderBottomWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  txnFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  txnLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  txnDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Palette.hairline },
  txnIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txnTitle: { fontSize: 14.5, fontWeight: '600', color: Palette.text },
  txnMeta: { fontSize: 12, color: Palette.textMuted, marginTop: 3 },
  txnAmount: { fontSize: 15, fontWeight: '800' },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e6ea' },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: Palette.text, marginTop: 12 },
  emptyBody: { fontSize: 13, color: Palette.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 19 },
});
