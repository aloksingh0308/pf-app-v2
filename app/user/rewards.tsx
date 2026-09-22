import ScratchRewardModal from '@/components/common/ScratchRewardModal';
import { AppColors } from '@/constants/appColors';
import { rewardService, type UserRewardItem } from '@/services/rewardService';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
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

export default function RewardsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useSelector((state: RootState) => state.auth);
  const [loading, setLoading] = useState(true);
  const [rewards, setRewards] = useState<UserRewardItem[]>([]);
  const [scratchModalVisible, setScratchModalVisible] = useState(false);
  const [activeScratchReward, setActiveScratchReward] = useState<{
    orderId: string;
    title: string;
    description: string;
    couponCode: string;
    isCoinReward?: boolean;
    coinsEarned?: number;
  } | null>(null);
  const [copiedCouponId, setCopiedCouponId] = useState('');

  useEffect(() => {
    let active = true;

    const loadRewards = async () => {
      if (!user?.uid) {
        if (active) {
          setRewards([]);
          setLoading(false);
        }
        return;
      }

      try {
        if (active) setLoading(true);
        const rows = await rewardService.listUserRewards(user.uid);
        if (active) setRewards(rows);
      } catch (_) {
        if (active) setRewards([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRewards();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const pendingCount = useMemo(() => rewards.filter((item) => !item.scratched).length, [rewards]);

  return (
    <Container>
      <Header style={{ paddingTop: Math.max(insets.top + 8, 18) }}>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={AppColors.textPrimary} />
        </BackButton>
        <HeaderTitle>Rewards</HeaderTitle>
        <HeaderSpacer />
      </Header>

      <FlatList
        data={rewards}
        keyExtractor={(item) => `${item.couponId}-${item.orderId}`}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingTop: 18,
          paddingBottom: Math.max(insets.bottom + 24, 32),
          gap: 12,
        }}
        ListHeaderComponent={
          <>
            <HeroCard>
              <HeroEyebrow>Your rewards</HeroEyebrow>
              <HeroTitle>Scratch cards and coupon wins in one place</HeroTitle>
              <HeroSubtext>
                Pending rewards: {pendingCount} of {rewards.length}
              </HeroSubtext>
            </HeroCard>

            {loading ? (
              <StateWrap>
                <ActivityIndicator size="small" color={AppColors.primary} />
              </StateWrap>
            ) : null}

            {!loading && rewards.length === 0 ? (
              <EmptyCard>
                <EmptyTitle>No rewards yet</EmptyTitle>
                <EmptyText>Place an order to unlock scratch rewards here.</EmptyText>
              </EmptyCard>
            ) : null}
          </>
        }
        renderItem={({ item }) => {
          const isCoinReward = String(item.rewardType || '').toUpperCase() === 'COINS' || Number(item.coinsEarned || 0) > 0;
          const normalizedStatus = String(item.status || '').toUpperCase();
          const isUsed = !isCoinReward && normalizedStatus === 'USED';
          const isExpired = !isCoinReward && !isUsed && (
            normalizedStatus === 'EXPIRED' || (Number(item.expiryMs || 0) > 0 && Number(item.expiryMs) <= Date.now())
          );
          const showScratchPlaceholder = !item.scratched;
          const isCopyDisabled = !item.scratched || isExpired || isUsed;
          const dateLabel = isExpired ? 'Expired on' : 'Valid till';
          const dateValue = formatExpiryDate(item.expiryMs);

          const handleCopy = async () => {
            if (isCopyDisabled || !item.couponCode) return;
            await Clipboard.setStringAsync(String(item.couponCode || '').trim());
            setCopiedCouponId(item.couponId);
            setTimeout(() => {
              setCopiedCouponId((current) => (current === item.couponId ? '' : current));
            }, 1200);
          };

          return (
            <RewardCard style={{ opacity: item.scratched && !isCoinReward && isExpired ? 0.72 : 1 }}>
              <RewardContent>
                <TopRow>
                  {showScratchPlaceholder ? (
                    <StatusPill style={{ backgroundColor: '#FFF4D8' }}>
                      <StatusText style={{ color: '#B7791F' }}>Generated - Scratch pending</StatusText>
                    </StatusPill>
                  ) : isCoinReward ? (
                    <StatusPill style={{ backgroundColor: '#EAF7EE' }}>
                      <StatusText style={{ color: '#1B8F3A' }}>Coins reward</StatusText>
                    </StatusPill>
                  ) : (
                    <StatusPill style={{ backgroundColor: isUsed ? '#EEF2F7' : (isExpired ? '#FDEAEA' : '#E7F7F3') }}>
                      <StatusText style={{ color: isUsed ? '#4B5563' : (isExpired ? '#E53E3E' : '#16A34A') }}>
                        {isUsed ? 'Used' : (isExpired ? 'Expired' : 'Active')}
                      </StatusText>
                    </StatusPill>
                  )}
                  <TopActions>
                    <Ionicons name="ellipsis-horizontal" size={18} color="#1f2937" />
                  </TopActions>
                </TopRow>

                <RewardName numberOfLines={2}>{item.title || 'Reward'}</RewardName>
                <RewardDesc numberOfLines={2}>{item.description || 'Use this reward during checkout.'}</RewardDesc>

                {showScratchPlaceholder ? (
                  <ScratchPlaceholder
                    onPress={() => {
                      setActiveScratchReward({
                        orderId: item.orderId,
                        title: item.title || 'Reward',
                        description: item.description || 'Use this reward during checkout.',
                        couponCode: item.couponCode || 'PENDING',
                        isCoinReward,
                        coinsEarned: Number(item.coinsEarned || 0),
                      });
                      setScratchModalVisible(true);
                    }}
                  >
                    <Ionicons name="hand-left-outline" size={30} color="#4B5563" />
                    <ScratchPlaceholderText>Scratch here</ScratchPlaceholderText>
                    <ScratchPlaceholderSubtext>to reveal</ScratchPlaceholderSubtext>
                  </ScratchPlaceholder>
                ) : (
                  <>
                    {isCoinReward ? (
                      <CoinInfoCard>
                        {Number(item.coinsEarned || 0) > 0 ? (
                          <CoinInfoTitle>You won {Math.floor(Number(item.coinsEarned || 0))} coins</CoinInfoTitle>
                        ) : null}
                        <CoinInfoText>
                          Scratch this reward to add coins in Reward coins
                        </CoinInfoText>
                      </CoinInfoCard>
                    ) : (
                      <>
                        <CouponLabel>COUPON CODE</CouponLabel>
                        <CouponCodeRow style={{ borderColor: isExpired ? '#E5E7EB' : '#FFD3AE' }}>
                          <CouponCodeText style={{ color: isExpired ? '#9CA3AF' : '#111827' }}>
                            {String(item.couponCode || 'PENDING').toUpperCase()}
                          </CouponCodeText>
                          {!isUsed && !isExpired ? (
                            <CopyButton onPress={handleCopy} disabled={isCopyDisabled}>
                              <Ionicons
                                name="copy-outline"
                                size={18}
                                color={isCopyDisabled ? '#9CA3AF' : AppColors.primary}
                              />
                              <CopyButtonText style={{ color: isCopyDisabled ? '#9CA3AF' : AppColors.primary }}>
                                {copiedCouponId === item.couponId ? 'Copied' : 'Copy'}
                              </CopyButtonText>
                            </CopyButton>
                          ) : null}
                        </CouponCodeRow>
                      </>
                    )}

                    {!isCoinReward ? (
                      isUsed ? (
                        <DateRow>
                          <Ionicons name="checkmark-circle-outline" size={16} color="#6B7280" />
                          <DateText style={{ color: '#4B5563' }}>
                            Coupon already used
                          </DateText>
                        </DateRow>
                      ) : (
                        <DateRow>
                          <Ionicons name="calendar-outline" size={16} color={isExpired ? '#9CA3AF' : '#6B7280'} />
                          <DateText style={{ color: isExpired ? '#6B7280' : '#374151' }}>
                            {dateLabel} {dateValue}
                          </DateText>
                        </DateRow>
                      )
                    ) : null}
                  </>
                )}
              </RewardContent>
            </RewardCard>
          );
        }}
        ListFooterComponent={!loading && rewards.length > 0 ? <FooterSpace /> : null}
      />

      <ScratchRewardModal
        visible={scratchModalVisible}
        reward={
          activeScratchReward
            ? {
                title: activeScratchReward.title,
                description: activeScratchReward.description,
                couponCode: activeScratchReward.couponCode,
                isCoinReward: activeScratchReward.isCoinReward,
                coinsEarned: activeScratchReward.coinsEarned,
              }
            : null
        }
        title="Congratulations"
        subtitle="You have won a scratch card"
        onClose={() => {
          setScratchModalVisible(false);
          setActiveScratchReward(null);
        }}
        onScratchComplete={async () => {
          if (!activeScratchReward?.orderId) return;
          try {
            await rewardService.markOrderRewardGenerated(activeScratchReward.orderId, {
              scratched: true,
            });
            setRewards((prev) =>
              prev.map((reward) =>
                reward.orderId === activeScratchReward.orderId
                  ? { ...reward, scratched: true }
                  : reward
              )
            );
          } catch (_) {
            // Ignore metadata update failure and keep reward visible.
          }
        }}
      />
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: #f7f8fa;
`;

const Header = styled.View`
  padding: 12px 18px 10px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: #f7f8fa;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #e7ebf0;
`;

const HeaderTitle = styled.Text`
  font-size: 22px;
  font-weight: 800;
  color: ${AppColors.textPrimary};
`;

const HeaderSpacer = styled.View`
  width: 40px;
  height: 40px;
`;

const HeroCard = styled.View`
  background-color: #ffffff;
  border-radius: 24px;
  padding: 20px;
  margin-bottom: 16px;
  border-width: 1px;
  border-color: #eceff3;
`;

const HeroEyebrow = styled.Text`
  font-size: 13px;
  font-weight: 700;
  color: ${AppColors.primary};
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

const HeroTitle = styled.Text`
  margin-top: 8px;
  font-size: 26px;
  line-height: 32px;
  font-weight: 800;
  color: ${AppColors.textPrimary};
`;

const HeroSubtext = styled.Text`
  margin-top: 8px;
  font-size: 14px;
  color: ${AppColors.textSecondary};
`;

const StateWrap = styled.View`
  align-items: center;
  padding: 12px 0 4px;
`;

const EmptyCard = styled.View`
  background-color: #ffffff;
  border-radius: 20px;
  padding: 20px;
  border-width: 1px;
  border-color: #eceff3;
`;

const EmptyTitle = styled.Text`
  font-size: 18px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const EmptyText = styled.Text`
  margin-top: 8px;
  font-size: 14px;
  line-height: 20px;
  color: ${AppColors.textSecondary};
`;

const RewardCard = styled.View`
  border-radius: 18px;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #e6e8ec;
  margin-bottom: 2px;
  overflow: hidden;
`;

const RewardContent = styled.View`
  padding: 14px 14px 15px;
`;

const TopRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const TopActions = styled.View`
  width: 24px;
  align-items: center;
`;

const RewardName = styled.Text`
  margin-top: 10px;
  font-size: 20px;
  line-height: 26px;
  font-weight: 800;
  color: #111827;
`;

const RewardDesc = styled.Text`
  margin-top: 6px;
  font-size: 14px;
  line-height: 21px;
  color: #374151;
`;

const ScratchPlaceholder = styled.TouchableOpacity`
  margin-top: 10px;
  border-radius: 14px;
  border-width: 1px;
  border-color: #d8dce3;
  background-color: #eceef1;
  min-height: 146px;
  align-items: center;
  justify-content: center;
`;

const ScratchPlaceholderText = styled.Text`
  margin-top: 8px;
  font-size: 19px;
  line-height: 24px;
  color: #1f2937;
  font-weight: 800;
`;

const ScratchPlaceholderSubtext = styled.Text`
  font-size: 18px;
  line-height: 24px;
  color: #4b5563;
  font-weight: 700;
`;

const CouponLabel = styled.Text`
  margin-top: 14px;
  font-size: 12px;
  color: #8b949e;
  letter-spacing: 0.6px;
  font-weight: 700;
`;

const CouponCodeRow = styled.View`
  margin-top: 6px;
  min-height: 52px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-width: 1px;
  border-style: dashed;
  border-radius: 12px;
  padding: 0 12px;
`;

const CouponCodeText = styled.Text`
  font-size: 18px;
  font-weight: 800;
`;

const CopyButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;

const CopyButtonText = styled.Text`
  margin-left: 6px;
  font-size: 14px;
  font-weight: 700;
`;

const StatusText = styled.Text`
  font-size: 12px;
  font-weight: 700;
`;

const StatusPill = styled.View`
  padding: 7px 11px;
  border-radius: 10px;
`;

const DateRow = styled.View`
  margin-top: 12px;
  flex-direction: row;
  align-items: center;
`;

const DateText = styled.Text`
  margin-left: 8px;
  font-size: 13px;
  font-weight: 600;
`;

const FooterSpace = styled.View`
  height: 4px;
`;

const CoinInfoCard = styled.View`
  margin-top: 10px;
  border-width: 1px;
  border-color: #ffe1bd;
  border-radius: 12px;
  background-color: #fff8ef;
  padding: 12px;
`;

const CoinInfoTitle = styled.Text`
  color: #9a5b1a;
  font-size: 14px;
  font-weight: 700;
`;

const CoinInfoText = styled.Text`
  margin-top: 4px;
  color: #5f6368;
  font-size: 12px;
  line-height: 18px;
`;