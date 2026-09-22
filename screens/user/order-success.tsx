import ScratchRewardModal from '@/components/common/ScratchRewardModal';
import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { rewardService, type GeneratedReward } from '@/services/rewardService';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { RootState } from '../../store';

const ORDER_SUCCESS_BANNER_AD_UNIT_ID = String(
  process.env.EXPO_PUBLIC_ORDER_SUCCESS_BANNER_AD_UNIT_ID
  || process.env.EXPO_PUBLIC_TRACK_ORDER_BANNER_AD_UNIT_ID
  || ''
).trim();

export default function OrderSuccessScreen() {
  const { orderId, isUpdate, isScheduled, scheduledDateLabel, scheduledSlotLabel } = useLocalSearchParams<{
    orderId?: string;
    isUpdate?: string;
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

  const headerText = useMemo(() => {
    if (isScheduledOrder) return 'Reservation Confirmed';
    return isOrderUpdate ? 'Order Updated' : 'Order Placed';
  }, [isOrderUpdate, isScheduledOrder]);

  return (
    <Container>
      <Card>
        <IconWrap>
          <Ionicons name="checkmark-circle" size={64} color="#16a34a" />
        </IconWrap>

        <Title>{headerText}</Title>
        <SubTitle>
          {isScheduledOrder
            ? 'Your reservation has been placed successfully.'
            : isOrderUpdate
              ? 'Your order changes were saved successfully.'
              : 'Your order has been placed successfully.'}
        </SubTitle>

        {isScheduledOrder ? (
          <ReservationDetailsCard>
            <ReservationDate>{reservationDateLabel || 'Scheduled Date'}</ReservationDate>
            <ReservationSlot>{reservationSlotLabel || 'Selected Slot'}</ReservationSlot>
            <ReservationHint>We&apos;ll remind you before we start preparing your order.</ReservationHint>
          </ReservationDetailsCard>
        ) : null}

        {normalizedOrderId ? <OrderIdText>Order ID: {normalizedOrderId}</OrderIdText> : null}

        {loading ? (
          <LoaderWrap>
            <ActivityIndicator color={AppColors.primary} />
          </LoaderWrap>
        ) : null}

        {!loading ? (
          <AppButton
            title="Continue"
            onPress={handleContinue}
            style={{ marginTop: 18, borderRadius: 10 }}
          />
        ) : null}
      </Card>

      <BannerWrap style={{ bottom: insets.bottom + 8 }}>
        {ORDER_SUCCESS_BANNER_AD_UNIT_ID ? (
          <BannerAd
            unitId={ORDER_SUCCESS_BANNER_AD_UNIT_ID}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          />
        ) : (
          <BannerFallback>
            <BannerFallbackText>Ad unavailable</BannerFallbackText>
          </BannerFallback>
        )}
      </BannerWrap>

      <ScratchRewardModal
        visible={scratchModalVisible && Boolean(showScratchCard)}
        reward={
          {
            title: reward?.deal?.title || 'Scratch Reward',
            description: reward?.deal?.description || 'Scratch to generate your reward.',
            couponCode: reward?.coupon?.code || 'REVEAL',
            isCoinReward: String(reward?.reward?.rewardType || '').toUpperCase() === 'COINS' || Number(reward?.reward?.coinsEarned || 0) > 0,
            coinsEarned: Number(reward?.reward?.coinsEarned || 0),
          }
        }
        title="Congratulations"
        subtitle="You have won a scratch card"
        onClose={() => setScratchModalVisible(false)}
        onScratchComplete={handleScratchComplete}
      />
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
  justify-content: center;
  padding: 18px;
`;

const Card = styled.View`
  background-color: #fff;
  border-radius: 16px;
  padding: 20px;
  border: 1px solid ${AppColors.lightBorder};
`;

const IconWrap = styled.View`
  align-items: center;
`;

const Title = styled.Text`
  margin-top: 12px;
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  color: #1f2937;
`;

const SubTitle = styled.Text`
  margin-top: 8px;
  text-align: center;
  font-size: 14px;
  color: #4b5563;
`;

const OrderIdText = styled.Text`
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: #6b7280;
`;

const ReservationDetailsCard = styled.View`
  margin-top: 12px;
  border-radius: 12px;
  border-width: 1px;
  border-color: #e5e7eb;
  background-color: #f8fafc;
  padding: 12px;
`;

const ReservationDate = styled.Text`
  text-align: center;
  color: #374151;
  font-size: 14px;
  font-weight: 700;
`;

const ReservationSlot = styled.Text`
  margin-top: 4px;
  text-align: center;
  color: #111827;
  font-size: 22px;
  font-weight: 800;
`;

const ReservationHint = styled.Text`
  margin-top: 8px;
  text-align: center;
  color: #4b5563;
  font-size: 13px;
`;

const LoaderWrap = styled.View`
  margin-top: 16px;
  align-items: center;
`;

const BannerWrap = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 6px;
`;

const BannerFallback = styled.View`
  width: 100%;
  min-height: 60px;
  background-color: #fef3c7;
  border-top-width: 1px;
  border-top-color: #fcd34d;
  align-items: center;
  justify-content: center;
`;

const BannerFallbackText = styled.Text`
  color: #a16207;
  font-size: 12px;
  font-weight: 700;
`;
