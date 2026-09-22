import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppContent } from '@/constants/appContent';
import { AppStrings } from '@/constants/appStrings';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Share, Text, TouchableOpacity, View } from 'react-native';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { RootState } from '../../store';

import QRCode from 'react-native-qrcode-svg';

export default function MoreScreen() {
  const user = useSelector((state: RootState) => state.auth.user);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [qrModalVisible, setQrModalVisible] = useState(false);

  const appBaseLink = 'https://play.google.com/store/apps/details?id=com.alok0308.praygagifoodwala';
  const referralLink = `${appBaseLink}&code=${user?.referralCode}`;

  const handleShareReferral = () => {
    if (!user?.referralCode) return;
    setShareModalVisible(true);
  };

  const handleShareQRCode = () => {
    setShareModalVisible(false);
    setQrModalVisible(true);
  };

  const handleShareSocial = async () => {
    setShareModalVisible(false);
    const message = `${AppStrings.referral.shareTemplate.replace('{CODE}', user?.referralCode || '')}\n${referralLink}`;
    await Share.share({ message, url: referralLink });
  };

  return (
    <Container>
      <HeaderContainer>
        <Title>More</Title>
      </HeaderContainer>

      <Content>
        <SectionHeading>{AppStrings.referral.sectionTitle}</SectionHeading>
        <InfoRow>
          <InfoLabel>{AppStrings.referral.codeLabel}</InfoLabel>
          <InfoValue>{user?.referralCode || 'N/A'}</InfoValue>
        </InfoRow>
        <InfoRow>
          <InfoLabel>{AppStrings.referral.countLabel}</InfoLabel>
          <InfoValue>{Number(user?.referralCount || 0)}</InfoValue>
        </InfoRow>
        <HintText>{AppContent.referral.hint}</HintText>

        <AppButton title={AppStrings.referral.shareAction} onPress={handleShareReferral} style={{ marginTop: 12 }} />

        {/* Share Modal */}
        <Modal
          visible={shareModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setShareModalVisible(false)}
        >
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 24, width: '90%' }}>
              <Text style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 25, textAlign: 'center' }}>Share Referral</Text>
              <TouchableOpacity onPress={handleShareQRCode} style={{ padding: 12,backgroundColor: AppColors.primary, borderRadius: 8, marginBottom: 12 }}>
                <Text style={{ fontSize: 16,textAlign:'center', color: '#fff' }}>Share via QR Code</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleShareSocial} style={{ padding: 12,backgroundColor: AppColors.primary, borderRadius: 8 }}>
                <Text style={{ fontSize: 16,textAlign:'center', color: '#fff' }}>Share via Social Media</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShareModalVisible(false)} style={{ padding: 12, marginTop: 8,backgroundColor: '#f0f0f0', borderRadius: 8  }}> 
                <Text style={{ color: '#000', textAlign: 'center',fontWeight:'bold' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* QR Code Modal */}
        <Modal
          visible={qrModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setQrModalVisible(false)}
        >
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', width: '90%' }}>
              <Text style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 16 }}>Scan to Join with Referral</Text>
              <QRCode value={referralLink} 
              size={200} />
              <Text selectable style={{ marginTop: 16, fontSize: 12, color: '#888', textAlign: 'center' }}>{user?.referralCode}</Text>
              <TouchableOpacity onPress={() => setQrModalVisible(false)} style={{ padding: 12, marginTop: 8 }}>
                <Text style={{ color: 'red', textAlign: 'center' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <AppButton title={AppStrings.common.walletHistory} onPress={() => router.push('/user/wallet-history' as never)} style={{ marginTop: 12 }} />

        <AppButton title="Tic Tac Toe" onPress={() => router.push('/user/tic-tac-toe' as never)} style={{ marginTop: 12 }} />

        <SectionHeading>Celebrations</SectionHeading>
        <LinkRow onPress={() => router.push('/user/party-booking' as never)}>
          <LinkText>Customise Your Party</LinkText>
          <Ionicons name="chevron-forward" size={20} color={AppColors.muted} />
        </LinkRow>

        <SectionHeading>{AppStrings.common.legalSupport}</SectionHeading>
        <LinkRow onPress={() => router.push('/user/terms-and-conditions' as never)}>
          <LinkText>{AppStrings.common.terms}</LinkText>
          <Ionicons name="chevron-forward" size={20} color={AppColors.muted} />
        </LinkRow>
        <LinkRow onPress={() => router.push('/user/privacy-policy' as never)}>
          <LinkText>{AppStrings.common.privacy}</LinkText>
          <Ionicons name="chevron-forward" size={20} color={AppColors.muted} />
        </LinkRow>
        <LinkRow onPress={() => router.push('/user/support' as never)}>
          <LinkText>{AppStrings.common.customerSupport}</LinkText>
          <Ionicons name="chevron-forward" size={20} color={AppColors.muted} />
        </LinkRow>
      </Content>
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
`;

const HeaderContainer = styled.View`
  width: 100%;
  padding: 16px;
  background-color: ${AppColors.background};
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
  align-items: center;
  justify-content: center;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: bold;
  color: ${AppColors.textPrimary};
`;

const Content = styled.ScrollView`
  flex: 1;
  padding: 20px;
`;

const SectionHeading = styled.Text`
  margin-top: 16px;
  font-size: 16px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
  margin-bottom: 8px;
`;

const InfoRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
  align-items: center;
`;

const InfoLabel = styled.Text`
  font-size: 14px;
  color: ${AppColors.textSecondary};
  font-weight: 500;
  flex: 1;
`;

const InfoValue = styled.Text`
  font-size: 14px;
  color: ${AppColors.textPrimary};
  font-weight: 600;
  flex: 1;
  text-align: right;
`;

const HintText = styled.Text`
  margin-top: 12px;
  color: ${AppColors.textSecondary};
  font-size: 12px;
  line-height: 18px;
`;

const LinkRow = styled.TouchableOpacity`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
`;

const LinkText = styled.Text`
  font-size: 14px;
  color: ${AppColors.textPrimary};
  font-weight: 600;
`;
