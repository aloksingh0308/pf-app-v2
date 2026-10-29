import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import ScratchRewardModal from '@/components/common/ScratchRewardModal';
import { Palette } from '@/components/common/ListSection';
import { getMyOrdersPage } from '@/services/orderService';
import { rewardService, type GeneratedReward } from '@/services/rewardService';
import { OrderType } from '@/types/enums';
import Ionicons from '@react-native-vector-icons/ionicons';
import { StackActions, useNavigation } from '@react-navigation/native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { ComponentProps, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** The placed order as shown on this screen (order number, restaurant, totals). */
type OrderSummary = {
  displayOrderId: string;
  restaurantName: string;
  itemCount: number;
  total: number;
  amountDue: number;
  orderType: string;
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  [OrderType.DINE_IN]: 'Dine In',
  [OrderType.TAKE_AWAY]: 'Takeaway',
  [OrderType.HOME_DELIVERY]: 'Home Delivery',
};

const NEXT_STEPS: Record<string, Array<{ icon: IconName; title: string; body: string }>> = {
  [OrderType.HOME_DELIVERY]: [
    { icon: 'receipt-outline', title: 'Restaurant confirms', body: 'Your order is sent to the kitchen right away.' },
    { icon: 'flame-outline', title: 'Food is prepared', body: 'Freshly cooked and packed for you.' },
    { icon: 'bicycle-outline', title: 'On the way', body: 'Track your rider live once it is picked up.' },
  ],
  [OrderType.TAKE_AWAY]: [
    { icon: 'receipt-outline', title: 'Restaurant confirms', body: 'Your order is sent to the kitchen right away.' },
    { icon: 'flame-outline', title: 'Food is prepared', body: 'We will let you know when it is ready.' },
    { icon: 'bag-handle-outline', title: 'Pick it up', body: 'Collect your order at the counter.' },
  ],
  [OrderType.DINE_IN]: [
    { icon: 'receipt-outline', title: 'Order sent to kitchen', body: 'Sit back while we prepare it.' },
    { icon: 'flame-outline', title: 'Food is prepared', body: 'Freshly cooked for your table.' },
    { icon: 'restaurant-outline', title: 'Served at your table', body: 'Enjoy your meal!' },
  ],
};

const ORDER_SUCCESS_BANNER_AD_UNIT_ID = String(
  process.env.EXPO_PUBLIC_ORDER_SUCCESS_BANNER_AD_UNIT_ID
  || process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID
  || ''
).trim();

export default function OrderSuccessScreen() {
  const { orderId, isUpdate, isScheduled, scheduledDateLabel, scheduledSlotLabel, paymentPending } = useLocalSearchParams<{
    orderId?: string;
    isUpdate?: string;
    /** "true" when an online payment went through but is still being confirmed. */
    paymentPending?: string;
    isScheduled?: string;
    scheduledDateLabel?: string;
    scheduledSlotLabel?: string;
  }>();
  const insets = useSafeAreaInsets();
  const authUser = useSelector((state: RootState) => state.auth.user);

  const [loading, setLoading] = useState(true);
  const [reward, setReward] = useState<GeneratedReward | null>(null);
  const [showScratchCard, setShowScratchCard] = useState(false);
  const [scratchModalVisible, setScratchModalVisible] = useState(false);
  const [order, setOrder] = useState<OrderSummary | null>(null);

  const normalizedOrderId = String(orderId || '').trim();
  const isOrderUpdate = String(isUpdate || '').toLowerCase() === 'true';
  const isScheduledOrder = String(isScheduled || '').toLowerCase() === 'true';
  const reservationDateLabel = String(scheduledDateLabel || '').trim();
  const reservationSlotLabel = String(scheduledSlotLabel || '').trim();

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      if (!normalizedOrderId) {
        if (active) setLoading(false);
        return;
      }

      try {
        if (isScheduledOrder) {
          if (active) {
            setShowScratchCard(false);
          }
          return;
        }

        if (isOrderUpdate) {
          if (active) {
            setShowScratchCard(false);
          }
          return;
        }

        const existingReward = await rewardService.getRewardForOrder(normalizedOrderId);
        if (existingReward) {
          if (active) {
            setReward(existingReward);
            setShowScratchCard(!existingReward.reward.scratched);
          }
          return;
        }

        const generatedReward = await rewardService.generateReward(normalizedOrderId, authUser?.uid || null);
        if (active && generatedReward) {
          setReward(generatedReward);
          setShowScratchCard(!generatedReward.reward.scratched);
        }
      } catch (error) {
        if (active) {
          console.error('Reward flow failed on order success:', error);
          setShowScratchCard(false);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    initialize();
    return () => {
      active = false;
    };
  }, [normalizedOrderId, authUser?.uid, isOrderUpdate, isScheduledOrder]);

  // The order summary card — the order was just placed, so it's on the first history page.
  useEffect(() => {
    if (!normalizedOrderId || isScheduledOrder) return;
    let active = true;
    getMyOrdersPage(null, 10)
      .then(({ orders }) => {
        const match: any = orders.find((entry) => String(entry.id) === normalizedOrderId);
        if (!active || !match) return;
        setOrder({
          displayOrderId: String(match.displayOrderId || ''),
          restaurantName: String(match.restaurant?.name || ''),
          itemCount: (match.items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0),
          total: Number(match.total || 0),
          amountDue: Number(match.amountDue || 0),
          orderType: String(match.orderType || ''),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [normalizedOrderId, isScheduledOrder]);

  useEffect(() => {
    if (showScratchCard && reward) {
      setScratchModalVisible(true);
    }
  }, [showScratchCard, reward]);

  const handleScratchComplete = async () => {
    if (!normalizedOrderId) return;
    try {
      if (reward?.reward?.generated) {
        await rewardService.markOrderRewardGenerated(normalizedOrderId, {
          scratched: true,
        });
        setReward((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            reward: {
              ...prev.reward,
              scratched: true,
            },
          };
        });
        return;
      }

      const generatedReward = await rewardService.generateReward(normalizedOrderId, authUser?.uid || null);
      if (generatedReward) {
        setReward(generatedReward);
      }
    } catch (_) {
      // Do not block UI for metadata update.
    }
  };

  const handleContinue = () => {
    router.replace('/(tabs)/orders' as never);
  };

  // Going "back" from a placed order must never return to the cart/checkout — it closes
  // every screen above the tabs and opens the Home tab (header back arrow and Android back
  // button). The tabs are a nested navigator, so `screen: 'Home'` picks the tab; if the tabs
  // aren't in the history (e.g. opened from a notification) popTo adds them instead.
  const navigation = useNavigation();
  const goHome = useCallback(() => {
    navigation.dispatch(StackActions.popTo('(tabs)', { screen: 'Home' }));
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        goHome();
        return true;
      });
      return () => subscription.remove();
    }, [goHome])
  );

  const headerText = useMemo(() => {
    if (isScheduledOrder) return 'Reservation Confirmed';
    return isOrderUpdate ? 'Order Updated' : 'Order Placed';
  }, [isOrderUpdate, isScheduledOrder]);

  const isDelivery = order?.orderType === OrderType.HOME_DELIVERY;
  const steps = NEXT_STEPS[order?.orderType || ''] || NEXT_STEPS[OrderType.HOME_DELIVERY];
  const rewardScratched = Boolean(reward?.reward?.scratched);
  const rewardIsCoins = String(reward?.reward?.rewardType || '').toUpperCase() === 'COINS' || Number(reward?.reward?.coinsEarned || 0) > 0;
  const subtitle = isScheduledOrder
    ? 'Your reservation has been placed successfully.'
    : isOrderUpdate
      ? 'Your order changes were saved successfully.'
      : String(paymentPending || '').toLowerCase() === 'true'
        ? 'Payment received — we\u2019re confirming it with your bank. The restaurant gets your order as soon as it\u2019s confirmed.'
        : 'Sit tight — the restaurant has received your order.';

  return (
    <PageScreen style={styles.page}>
      <PageHeader title={headerText} onBack={goHome} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.checkRing}>
            <View style={styles.checkCircle}>
              <Ionicons name={isScheduledOrder ? 'calendar' : 'checkmark'} size={44} color="#fff" />
            </View>
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(150)} style={styles.title}>{headerText}!</Animated.Text>
          <Animated.Text entering={FadeInDown.delay(220)} style={styles.subtitle}>{subtitle}</Animated.Text>
        </View>

        {isScheduledOrder ? (
          <Animated.View entering={FadeInDown.delay(280)} style={styles.card}>
            <Text style={styles.cardLabel}>RESERVED FOR</Text>
            <Text style={styles.reserveDate}>{reservationDateLabel || 'Scheduled date'}</Text>
            <Text style={styles.reserveSlot}>{reservationSlotLabel || 'Selected slot'}</Text>
            <Text style={styles.muted}>We&apos;ll remind you before we start preparing your order.</Text>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.delay(280)} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>ORDER</Text>
                <Text style={styles.orderNumber}>#{order?.displayOrderId || normalizedOrderId.slice(-8).toUpperCase() || '—'}</Text>
              </View>
              {order?.orderType ? (
                <View style={styles.typePill}>
                  <Text style={styles.typePillText}>{ORDER_TYPE_LABEL[order.orderType] || 'Order'}</Text>
                </View>
              ) : null}
            </View>
            {order ? (
              <>
                {order.restaurantName ? (
                  <View style={[styles.row, { marginTop: 12 }]}>
                    <Ionicons name="storefront-outline" size={16} color={Palette.textSecondary} />
                    <Text style={styles.metaText} numberOfLines={1}>{order.restaurantName}</Text>
                  </View>
                ) : null}
                <View style={styles.divider} />
                <View style={styles.rowBetween}>
                  <Text style={styles.metaText}>{order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}</Text>
                  <Text style={styles.total}>₹{order.total.toFixed(2)}</Text>
                </View>
                {order.amountDue > 0 ? (
                  <Text style={styles.dueText}>₹{order.amountDue.toFixed(2)} to pay {isDelivery ? 'on delivery' : 'at the restaurant'}</Text>
                ) : (
                  <Text style={styles.paidText}>Paid</Text>
                )}
              </>
            ) : null}
          </Animated.View>
        )}

        {reward && !isScheduledOrder && !isOrderUpdate ? (
          <Animated.View entering={FadeInDown.delay(340)}>
            <Pressable
              accessibilityRole="button"
              disabled={rewardScratched}
              onPress={() => setScratchModalVisible(true)}
              style={({ pressed }) => [styles.rewardCard, rewardScratched && styles.rewardCardDone, pressed && { opacity: 0.9 }]}
            >
              <View style={[styles.rewardIcon, rewardScratched && { backgroundColor: Palette.successSoft }]}>
                <Ionicons name={rewardScratched ? 'checkmark-circle' : 'gift'} size={24} color={rewardScratched ? Palette.success : '#fff'} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rewardTitle, rewardScratched && { color: Palette.text }]}>
                  {rewardScratched ? reward.deal?.title || 'Reward unlocked' : 'You won a scratch card!'}
                </Text>
                <Text style={[styles.rewardBody, rewardScratched && { color: Palette.textSecondary }]}>
                  {rewardScratched
                    ? rewardIsCoins
                      ? 'Coins added to your Reward coins.'
                      : `Code ${reward.coupon?.code || ''} saved in My Rewards.`
                    : 'Tap to scratch and reveal your reward.'}
                </Text>
              </View>
              {!rewardScratched ? <Ionicons name="chevron-forward" size={20} color="#fff" /> : null}
            </Pressable>
          </Animated.View>
        ) : null}

        {!isScheduledOrder ? (
          <Animated.View entering={FadeInDown.delay(400)} style={styles.card}>
            <Text style={styles.cardLabel}>WHAT HAPPENS NEXT</Text>
            {steps.map((step, index) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, index === 0 && styles.stepDotActive]}>
                    <Ionicons name={step.icon} size={16} color={index === 0 ? '#fff' : Palette.primary} />
                  </View>
                  {index < steps.length - 1 ? <View style={styles.stepLine} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: index < steps.length - 1 ? 14 : 0 }}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.muted}>{step.body}</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {loading ? (
          <ActivityIndicator color={Palette.primary} style={{ marginTop: 8 }} />
        ) : (
          <View style={{ gap: 10, marginTop: 4 }}>
            {isDelivery ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.replace({ pathname: '/user/track-order', params: { orderId: normalizedOrderId } } as never)}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
              >
                <Ionicons name="navigate" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Track order</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={handleContinue}
              style={({ pressed }) => [isDelivery ? styles.secondaryBtn : styles.primaryBtn, pressed && { opacity: 0.9 }]}
            >
              <Ionicons name="receipt-outline" size={18} color={isDelivery ? Palette.primary : '#fff'} />
              <Text style={isDelivery ? styles.secondaryBtnText : styles.primaryBtnText}>View my orders</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={goHome} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>Back to home</Text>
            </Pressable>
          </View>
        )}

        {ORDER_SUCCESS_BANNER_AD_UNIT_ID ? (
          <View style={styles.ad}>
            <BannerAd
              unitId={ORDER_SUCCESS_BANNER_AD_UNIT_ID}
              size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            />
          </View>
        ) : null}
      </ScrollView>

      <ScratchRewardModal
        visible={scratchModalVisible && Boolean(reward) && !rewardScratched}
        reward={
          {
            title: reward?.deal?.title || 'Scratch Reward',
            description: reward?.deal?.description || 'Scratch to generate your reward.',
            couponCode: reward?.coupon?.code || 'REVEAL',
            isCoinReward: rewardIsCoins,
            coinsEarned: Number(reward?.reward?.coinsEarned || 0),
          }
        }
        title="Congratulations"
        subtitle="You have won a scratch card"
        onClose={() => setScratchModalVisible(false)}
        onScratchComplete={handleScratchComplete}
      />
    </PageScreen>
  );
}

const cardBase = {
  backgroundColor: '#fff',
  borderRadius: 18,
  padding: 16,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: '#e6e6ea',
} as const;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  content: { padding: 16, gap: 12 },
  hero: { alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  checkRing: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#dcf5e3', alignItems: 'center', justifyContent: 'center' },
  checkCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 14, fontSize: 24, fontWeight: '800', color: Palette.text },
  subtitle: { marginTop: 6, fontSize: 14, color: Palette.textSecondary, textAlign: 'center', paddingHorizontal: 16, lineHeight: 20 },
  card: { ...cardBase },
  cardLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: Palette.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderNumber: { fontSize: 20, fontWeight: '800', color: Palette.text },
  typePill: { backgroundColor: Palette.primarySoft, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  typePillText: { color: Palette.primary, fontWeight: '800', fontSize: 12 },
  metaText: { flex: 1, fontSize: 14, color: Palette.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Palette.hairline, marginVertical: 12 },
  total: { fontSize: 20, fontWeight: '900', color: Palette.text },
  dueText: { marginTop: 4, fontSize: 12.5, fontWeight: '600', color: '#b45309', textAlign: 'right' },
  paidText: { marginTop: 4, fontSize: 12.5, fontWeight: '700', color: Palette.success, textAlign: 'right' },
  reserveDate: { fontSize: 15, fontWeight: '700', color: Palette.text },
  reserveSlot: { fontSize: 24, fontWeight: '900', color: Palette.primary, marginVertical: 4 },
  muted: { fontSize: 12.5, color: Palette.textSecondary, lineHeight: 18 },
  rewardCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 16, backgroundColor: Palette.primary },
  rewardCardDone: { ...cardBase },
  rewardIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  rewardTitle: { fontSize: 16, fontWeight: '800', color: '#fff' },
  rewardBody: { fontSize: 12.5, color: '#fff3e6', marginTop: 2 },
  step: { flexDirection: 'row', gap: 12, marginTop: 8 },
  stepRail: { alignItems: 'center' },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: Palette.primary },
  stepLine: { flex: 1, width: 2, backgroundColor: '#f3d9bf', marginTop: 4 },
  stepTitle: { fontSize: 14.5, fontWeight: '700', color: Palette.text, marginTop: 5 },
  primaryBtn: { minHeight: 52, borderRadius: 14, backgroundColor: Palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryBtn: { minHeight: 52, borderRadius: 14, backgroundColor: Palette.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryBtnText: { color: Palette.primary, fontSize: 15, fontWeight: '800' },
  linkBtn: { alignItems: 'center', paddingVertical: 8 },
  linkBtnText: { color: Palette.textSecondary, fontSize: 14, fontWeight: '600' },
  ad: { marginTop: 8, alignItems: 'center' },
});
