import PageHeader from '@/components/common/PageHeader';
import AppearIn from '@/components/common/AppearIn';
import ScratchRewardModal from '@/components/common/ScratchRewardModal';
import { T } from '@/constants/tokens';
import { rewardService, type RewardSummary, type UserRewardItem } from '@/services/rewardService';
import { usePagedList } from '@/hooks/usePagedList';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';

const formatExpiryDate = (expiryMs: number) => {
  if (!expiryMs) return 'N/A';
  const parsed = new Date(expiryMs);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

type RewardState = 'TO_SCRATCH' | 'COINS' | 'ACTIVE' | 'USED' | 'EXPIRED';
type Filter = 'ALL' | 'TO_SCRATCH' | 'ACTIVE' | 'PAST';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'TO_SCRATCH', label: 'To scratch' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PAST', label: 'Used & expired' },
];

const isCoinReward = (item: UserRewardItem) =>
  String(item.rewardType || '').toUpperCase() === 'COINS' || Number(item.coinsEarned || 0) > 0;

const rewardState = (item: UserRewardItem): RewardState => {
  if (!item.scratched) return 'TO_SCRATCH';
  if (isCoinReward(item)) return 'COINS';
  const status = String(item.status || '').toUpperCase();
  if (status === 'USED') return 'USED';
  if (status === 'EXPIRED' || (Number(item.expiryMs || 0) > 0 && Number(item.expiryMs) <= Date.now())) return 'EXPIRED';
  return 'ACTIVE';
};

const matchesFilter = (state: RewardState, filter: Filter) => {
  if (filter === 'ALL') return true;
  if (filter === 'TO_SCRATCH') return state === 'TO_SCRATCH';
  if (filter === 'ACTIVE') return state === 'ACTIVE' || state === 'COINS';
  return state === 'USED' || state === 'EXPIRED';
};

const EMPTY_COPY: Record<Filter, { title: string; text: string }> = {
  ALL: { title: 'No rewards yet', text: 'Every order unlocks a scratch card. Place one to win coupons and coins.' },
  TO_SCRATCH: { title: 'All scratched', text: 'You have no cards waiting. Your next order brings a new one.' },
  ACTIVE: { title: 'No active rewards', text: 'Scratch a card to unlock a coupon or coins.' },
  PAST: { title: 'Nothing here', text: 'Used and expired coupons will show up here.' },
};

type ActiveScratch = {
  orderId: string;
  title: string;
  description: string;
  couponCode: string;
  isCoinReward?: boolean;
  coinsEarned?: number;
};

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useSelector((state: RootState) => state.auth);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [activeScratchReward, setActiveScratchReward] = useState<ActiveScratch | null>(null);
  const [copiedCouponId, setCopiedCouponId] = useState('');
  const [serverSummary, setServerSummary] = useState<RewardSummary | null>(null);

  // Pages of rewards from the API; each chip re-queries from page 1.
  const list = usePagedList<UserRewardItem>(
    async (page) => {
      const result = await rewardService.pageUserRewards(page, filter === 'ALL' ? undefined : filter);
      if (page === 1) setServerSummary(result.summary);
      return { items: result.items, hasMore: result.hasMore };
    },
    (item) => `${item.couponId}-${item.orderId}`,
    [filter, user?.uid],
    { enabled: Boolean(user?.uid) }
  );
  const rewards = list.items;
  const loading = list.loading && rewards.length === 0;

  // The server counts every reward; an older backend sends no summary but returns them all,
  // so counting the loaded ones gives the same numbers.
  const summary = useMemo(() => {
    if (serverSummary) return serverSummary;
    let toScratch = 0;
    let activeCoupons = 0;
    let coins = 0;
    rewards.forEach((item) => {
      const state = rewardState(item);
      if (state === 'TO_SCRATCH') toScratch++;
      if (state === 'ACTIVE') activeCoupons++;
      if (state === 'COINS') coins += Math.floor(Number(item.coinsEarned || 0));
    });
    return { toScratch, activeCoupons, coins };
  }, [rewards, serverSummary]);

  const visible = useMemo(() => rewards.filter((item) => matchesFilter(rewardState(item), filter)), [rewards, filter]);

  const copyCode = async (item: UserRewardItem) => {
    if (!item.couponCode) return;
    await Clipboard.setStringAsync(String(item.couponCode).trim());
    setCopiedCouponId(item.couponId);
    setTimeout(() => setCopiedCouponId((current) => (current === item.couponId ? '' : current)), 1200);
  };

  const openScratch = (item: UserRewardItem) => {
    setActiveScratchReward({
      orderId: item.orderId,
      title: item.title || 'Reward',
      description: item.description || 'Use this reward during checkout.',
      couponCode: item.couponCode || 'PENDING',
      isCoinReward: isCoinReward(item),
      coinsEarned: Number(item.coinsEarned || 0),
    });
  };

  const renderItem = ({ item, index }: { item: UserRewardItem; index: number }) => {
    const state = rewardState(item);

    if (state === 'TO_SCRATCH') {
      return (
        <AppearIn index={index}>
          <Pressable accessibilityRole="button" accessibilityLabel="Scratch this card" onPress={() => openScratch(item)} style={({ pressed }) => [styles.scratchTile, pressed && styles.pressed]}>
            <View style={[styles.tileDot, { top: -30, right: -20, width: 110, height: 110 }]} />
            <View style={[styles.tileDot, { bottom: -36, left: 40, width: 80, height: 80 }]} />
            <View style={styles.tileIcon}><Ionicons name="gift" size={26} color={T.color.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileTitle}>Scratch card waiting</Text>
              <Text style={styles.tileText}>Tap to scratch and reveal your reward</Text>
            </View>
            <View style={styles.tileCta}>
              <Text style={styles.tileCtaText}>Scratch</Text>
              <Ionicons name="arrow-forward" size={14} color={T.color.brand} />
            </View>
          </Pressable>
        </AppearIn>
      );
    }

    if (state === 'COINS') {
      const coins = Math.floor(Number(item.coinsEarned || 0));
      return (
        <AppearIn index={index} style={styles.card}>
          <View style={styles.cardRow}>
            <View style={[styles.cardIcon, { backgroundColor: '#fef3c7' }]}><Ionicons name="sparkles" size={20} color={T.color.star} /></View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{coins > 0 ? `You won ${coins} coins` : item.title || 'Reward coins'}</Text>
              <Text style={styles.cardText}>Added to your Reward coins</Text>
            </View>
            <StatusPill label="Credited" tone="success" />
          </View>
        </AppearIn>
      );
    }

    const past = state === 'USED' || state === 'EXPIRED';
    return (
      <AppearIn index={index} style={[styles.card, past && styles.cardPast]}>
        <View style={styles.cardRow}>
          <View style={[styles.cardIcon, past && { backgroundColor: T.color.line }]}>
            <Ionicons name="pricetag" size={20} color={past ? T.color.faint : T.color.brand} />
          </View>
          <View style={styles.cardBody}>
            <Text numberOfLines={2} style={[styles.cardTitle, past && { color: T.color.muted }]}>{item.title || 'Reward'}</Text>
            {item.description ? <Text numberOfLines={2} style={styles.cardText}>{item.description}</Text> : null}
          </View>
          <StatusPill label={state === 'USED' ? 'Used' : state === 'EXPIRED' ? 'Expired' : 'Active'} tone={past ? 'muted' : 'success'} />
        </View>

        {/* Ticket perforation between the offer and its code. */}
        <View style={styles.perforation}>
          <View style={[styles.notch, { left: -22 }]} />
          <View style={styles.perforationLine} />
          <View style={[styles.notch, { right: -22 }]} />
        </View>

        <View style={styles.codeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.codeLabel}>COUPON CODE</Text>
            <Text selectable style={[styles.code, past && { color: T.color.faint, textDecorationLine: 'line-through' }]}>
              {String(item.couponCode || 'PENDING').toUpperCase()}
            </Text>
          </View>
          {!past ? (
            <Pressable accessibilityRole="button" onPress={() => void copyCode(item)} style={styles.copy}>
              <Ionicons name={copiedCouponId === item.couponId ? 'checkmark' : 'copy-outline'} size={15} color={T.color.brand} />
              <Text style={styles.copyText}>{copiedCouponId === item.couponId ? 'Copied' : 'Copy'}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name={state === 'USED' ? 'checkmark-circle-outline' : 'calendar-outline'} size={14} color={T.color.muted} />
          <Text style={styles.metaText}>
            {state === 'USED' ? 'Coupon already used' : `${state === 'EXPIRED' ? 'Expired on' : 'Valid till'} ${formatExpiryDate(item.expiryMs)}`}
          </Text>
        </View>
      </AppearIn>
    );
  };

  const header = (
    <>
      <View style={styles.hero}>
        <View style={[styles.tileDot, { top: -40, right: -30, width: 150, height: 150, backgroundColor: '#ffe2c6' }]} />
        <Text style={styles.heroEyebrow}>YOUR REWARDS</Text>
        <Text style={styles.heroTitle}>Scratch, win, save</Text>
        <View style={styles.stats}>
          <Stat value={summary.toScratch} label="To scratch" />
          <View style={styles.statDivider} />
          <Stat value={summary.activeCoupons} label="Active coupons" />
          <View style={styles.statDivider} />
          <Stat value={summary.coins} label="Coins won" />
        </View>
      </View>
      <View style={styles.filters}>
        {FILTERS.map((option) => (
          <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: filter === option.id }} onPress={() => setFilter(option.id)} style={[styles.chip, filter === option.id && styles.chipActive]}>
            <Text style={[styles.chipText, filter === option.id && styles.chipTextActive]}>
              {option.label}{option.id === 'TO_SCRATCH' && summary.toScratch > 0 ? ` · ${summary.toScratch}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  const empty = loading ? (
    <View style={styles.state}><ActivityIndicator color={T.color.brand} /></View>
  ) : (
    <View style={styles.state}>
      <View style={styles.emptyIcon}><Ionicons name="gift-outline" size={34} color={T.color.brand} /></View>
      <Text style={styles.emptyTitle}>{EMPTY_COPY[filter].title}</Text>
      <Text style={styles.emptyText}>{EMPTY_COPY[filter].text}</Text>
      {filter === 'ALL' ? (
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)' as never)} style={styles.emptyCta}>
          <Text style={styles.emptyCtaText}>Order now</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.page}>
      <PageHeader title="Rewards" />
      <FlatList
        data={visible}
        keyExtractor={(item) => `${item.couponId}-${item.orderId}`}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom + 24, 32) }]}
        onEndReached={() => void list.loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ paddingVertical: 16 }} color={T.color.brand} /> : null}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={T.color.brand} colors={[T.color.brand]} />}
      />

      <ScratchRewardModal
        visible={Boolean(activeScratchReward)}
        reward={activeScratchReward}
        title="You've won a scratch card"
        subtitle="Scratch the card to reveal your reward"
        onClose={() => setActiveScratchReward(null)}
        onScratchComplete={async () => {
          if (!activeScratchReward?.orderId) return;
          try {
            await rewardService.markOrderRewardGenerated(activeScratchReward.orderId, {
              scratched: true,
            });
            list.setItems((prev) =>
              prev.map((reward) =>
                reward.orderId === activeScratchReward.orderId
                  ? { ...reward, scratched: true }
                  : reward
              )
            );
            // Keep the server's counts in step without refetching.
            setServerSummary((current) => current && {
              toScratch: Math.max(0, current.toScratch - 1),
              activeCoupons: current.activeCoupons + (activeScratchReward.isCoinReward ? 0 : 1),
              coins: current.coins + (activeScratchReward.isCoinReward ? Math.floor(Number(activeScratchReward.coinsEarned || 0)) : 0),
            });
          } catch (_) {
            // Ignore metadata update failure and keep reward visible.
          }
        }}
      />
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: 'success' | 'muted' }) {
  return (
    <View style={[styles.pill, { backgroundColor: tone === 'success' ? T.color.successSoft : T.color.line }]}>
      <Text style={[styles.pillText, { color: tone === 'success' ? T.color.success : T.color.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: T.color.canvas },
  list: { paddingHorizontal: T.space.lg, paddingTop: T.space.lg, gap: T.space.md, flexGrow: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },

  hero: { borderRadius: T.radius.lg + 4, padding: T.space.lg + 2, backgroundColor: T.color.brandSoft, borderWidth: 1, borderColor: T.color.brandBorder, overflow: 'hidden' },
  heroEyebrow: { fontSize: T.font.caption, fontWeight: '800', letterSpacing: 0.8, color: T.color.brand },
  heroTitle: { marginTop: 4, fontSize: 24, fontWeight: '900', color: T.color.ink },
  stats: { marginTop: T.space.lg, flexDirection: 'row', alignItems: 'center', backgroundColor: T.color.surface, borderRadius: T.radius.md, paddingVertical: T.space.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: T.font.heading, fontWeight: '900', color: T.color.ink },
  statLabel: { marginTop: 2, fontSize: T.font.caption, fontWeight: '600', color: T.color.muted },
  statDivider: { width: 1, height: 28, backgroundColor: T.color.line },

  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm, marginTop: T.space.lg, marginBottom: T.space.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: T.radius.pill, borderWidth: 1, borderColor: T.color.line, backgroundColor: T.color.surface },
  chipActive: { backgroundColor: T.color.ink, borderColor: T.color.ink },
  chipText: { fontSize: T.font.small, fontWeight: '700', color: T.color.inkSoft },
  chipTextActive: { color: '#fff' },

  scratchTile: { flexDirection: 'row', alignItems: 'center', gap: T.space.md, padding: T.space.lg, borderRadius: T.radius.lg, backgroundColor: T.color.brand, overflow: 'hidden', ...T.shadow.card },
  tileDot: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  tileIcon: { width: 48, height: 48, borderRadius: T.radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: T.font.title, fontWeight: '800', color: '#fff' },
  tileText: { marginTop: 2, fontSize: T.font.small, color: 'rgba(255,255,255,0.88)' },
  tileCta: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: T.radius.pill, backgroundColor: '#fff' },
  tileCtaText: { fontSize: T.font.small, fontWeight: '800', color: T.color.brand },

  card: { borderRadius: T.radius.lg, backgroundColor: T.color.surface, padding: T.space.lg, borderWidth: 1, borderColor: T.color.line, overflow: 'hidden', ...T.shadow.card },
  cardPast: { opacity: 0.8 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: T.space.md },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: T.color.brandSoft, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: T.font.title, fontWeight: '800', color: T.color.ink },
  cardText: { marginTop: 2, fontSize: T.font.small, lineHeight: 17, color: T.color.muted },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: T.radius.pill },
  pillText: { fontSize: T.font.caption, fontWeight: '800' },

  perforation: { marginVertical: T.space.md, height: 16, justifyContent: 'center' },
  perforationLine: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: T.color.line },
  notch: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: T.color.canvas, borderWidth: 1, borderColor: T.color.line },

  codeRow: { flexDirection: 'row', alignItems: 'center' },
  codeLabel: { fontSize: T.font.caption, fontWeight: '700', letterSpacing: 0.6, color: T.color.faint },
  code: { marginTop: 2, fontSize: T.font.heading - 2, fontWeight: '900', letterSpacing: 1, color: T.color.ink },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: T.radius.pill, borderWidth: 1, borderColor: T.color.brandBorder, backgroundColor: T.color.brandSoft },
  copyText: { fontSize: T.font.small, fontWeight: '800', color: T.color.brand },
  metaRow: { marginTop: T.space.md, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: T.font.small, fontWeight: '600', color: T.color.muted },

  state: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: T.space.xl, gap: T.space.sm },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: T.color.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: T.space.xs },
  emptyTitle: { fontSize: T.font.title + 1, fontWeight: '800', color: T.color.ink, textAlign: 'center' },
  emptyText: { fontSize: T.font.body, lineHeight: 20, color: T.color.muted, textAlign: 'center' },
  emptyCta: { marginTop: T.space.sm, paddingHorizontal: T.space.xl, paddingVertical: 11, borderRadius: T.radius.pill, backgroundColor: T.color.brand },
  emptyCtaText: { color: '#fff', fontWeight: '800' },
});
