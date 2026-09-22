import ScratchCard, { type ScratchRewardView } from '@/components/ScratchCard';
import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import { Image } from 'react-native';
import { Modal } from 'react-native';
import styled from 'styled-components/native';

type ScratchRewardModalProps = {
  visible: boolean;
  reward: ScratchRewardView | null;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onScratchComplete: () => void;
};

export default function ScratchRewardModal({
  visible,
  reward,
  title = 'Congratulations',
  subtitle = 'You unlocked a scratch card reward.',
  onClose,
  onScratchComplete,
}: ScratchRewardModalProps) {
  if (!visible || !reward) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Overlay>
        <Sheet>
          <HeroSection>
            <HeroGlow />
            <CloseButton onPress={onClose}>
              <Ionicons name="close" size={22} color="#23263a" />
            </CloseButton>

            <HeroContent>
              <Title>{title}</Title>
              <Subtitle>{subtitle}</Subtitle>
              <Pill>
                <Ionicons name="gift-outline" size={16} color={AppColors.primary} />
                <PillText>Scratch now to reveal your surprise</PillText>
              </Pill>
            </HeroContent>

            <GiftWrap>
              <GiftImage source={require('../../assets/images/logo.png')} resizeMode="contain" />
            </GiftWrap>
          </HeroSection>

          <RewardCard>
            <RewardTop>
              <RewardIconWrap>
                <Ionicons name="restaurant-outline" size={24} color={AppColors.primary} />
              </RewardIconWrap>
              <RewardTextWrap>
                <RewardTitle>{reward.title}</RewardTitle>
                {!!reward.description && <RewardDescription>{reward.description}</RewardDescription>}
                <RewardDateRow>
                  <Ionicons name="calendar-outline" size={15} color="#81889b" />
                  <RewardDateText>{reward.isCoinReward ? 'Reward will be credited after scratch' : 'Valid reward coupon'}</RewardDateText>
                </RewardDateRow>
              </RewardTextWrap>
            </RewardTop>

            <ScratchWrap>
              <ScratchCard
                reward={reward}
                onScratchComplete={onScratchComplete}
                onContinue={onClose}
                variant="embedded"
              />
            </ScratchWrap>

            <InfoNote>
              <InfoIconWrap>
                <Ionicons name="shield-checkmark" size={16} color={AppColors.white} />
              </InfoIconWrap>
              <InfoTextWrap>
                <InfoText>Each scratch card can be used only once.</InfoText>
                  <InfoText>
                    {reward.isCoinReward
                      ? 'Scratch to add coins in Reward coins instantly.'
                      : 'Copy the coupon code and apply on checkout screen to use rewards.'}
                  </InfoText>
              </InfoTextWrap>
            </InfoNote>
          </RewardCard>
        </Sheet>
      </Overlay>
    </Modal>
  );
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(10, 15, 30, 0.5);
  justify-content: center;
  padding: 10px;
`;

const Sheet = styled.View`
  border-radius: 22px;
  background-color: #f7f9fc;
  border-width: 1px;
  border-color: rgba(222, 224, 230, 0.9);
  overflow: hidden;
  margin-horizontal: 5px;
`;

const HeroSection = styled.View`
  background-color: #fff2df;
  padding: 22px 18px 14px;
`;

const HeroGlow = styled.View`
  position: absolute;
  right: -28px;
  bottom: -32px;
  width: 240px;
  height: 180px;
  border-radius: 120px;
  background-color: rgba(246, 135, 18, 0.08);
`;

const HeroContent = styled.View`
  padding-right: 0;
  margin-bottom: 10px;
`;

const HeaderTextWrap = styled.View`
  padding-right: 10px;
`;

const GiftWrap = styled.View`
  position: absolute;
  right: 20px;
  bottom: 10px;
  width: 70px;
  height: 70px;
  border-radius: 35px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.55);
`;

const GiftImage = styled(Image)`
  width: 100%;
  height: 100%;
  opacity: 0.55;
`;

const Pill = styled.View`
  margin-top: 12px;
  align-self: flex-start;
  padding: 8px 12px;
  border-radius: 999px;
  border-width: 1px;
  border-color: #ffd4a6;
  background-color: rgba(255, 255, 255, 0.72);
  flex-direction: row;
  align-items: center;
`;

const PillText = styled.Text`
  margin-left: 8px;
  color: #7a4a19;
  font-size: 12px;
  font-weight: 600;
`;

const RewardCard = styled.View`
  margin: -10px 12px 12px;
  border-radius: 22px;
  border-width: 1px;
  border-color: #eceff3;
  background-color: #ffffff;
  padding: 14px;
`;

const RewardTop = styled.View`
  flex-direction: row;
  align-items: flex-start;
`;

const RewardIconWrap = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 24px;
  background-color: #fff4e2;
  border-width: 1px;
  border-color: #ffe1bd;
  align-items: center;
  justify-content: center;
`;

const RewardTextWrap = styled.View`
  flex: 1;
  margin-left: 12px;
`;

const RewardTitle = styled.Text`
  font-size: 16px;
  line-height: 20px;
  font-weight: 800;
  color: ${AppColors.primary};
`;

const RewardDescription = styled.Text`
  margin-top: 4px;
  color: #333b4d;
  font-size: 13px;
  line-height: 18px;
`;

const RewardDateRow = styled.View`
  margin-top: 8px;
  flex-direction: row;
  align-items: center;
`;

const RewardDateText = styled.Text`
  margin-left: 6px;
  color: #6f778b;
  font-size: 12px;
  font-weight: 600;
`;

const ScratchWrap = styled.View`
`;

const InfoNote = styled.View`
  margin-top: 12px;
  border-radius: 14px;
  background-color: #faf4ec;
  padding: 12px;
  flex-direction: row;
  align-items: center;
`;

const InfoIconWrap = styled.View`
  width: 34px;
  height: 34px;
  border-radius: 17px;
  background-color: ${AppColors.primary};
  align-items: center;
  justify-content: center;
`;

const InfoTextWrap = styled.View`
  margin-left: 10px;
  flex: 1;
`;

const InfoText = styled.Text`
  color: #344055;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
`;

const Title = styled.Text`
  font-size: 18px;
  line-height: 20px;
  font-weight: 800;
  color: #ef6d00;
`;

const Subtitle = styled.Text`
  margin-top: 6px;
  font-size: 14px;
  line-height: 18px;
  color: #2f3648;
  font-weight: 600;
`;

const CloseButton = styled.TouchableOpacity`
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #e8ebf2;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 16px;
  right: 14px;
  z-index: 5;
`;
