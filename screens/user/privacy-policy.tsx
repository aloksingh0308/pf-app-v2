import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React from 'react';
import styled from 'styled-components/native';

export default function PrivacyPolicyScreen() {
  return (
    <Container>
      <Header>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>Privacy Policy</Title>
        <Spacer />
      </Header>

      <Content>
        <MetaText>Effective Date: 20 July 2026</MetaText>

        <SectionTitle>1. Information We Collect</SectionTitle>
        <Paragraph>
          We may collect profile data (name, email, phone), account identifiers, delivery details, order history, and location information needed to provide food ordering, delivery, and support services.
        </Paragraph>

        <SectionTitle>2. Location Information</SectionTitle>
        <Paragraph>
          When location-based features are used, we may collect precise or approximate location from your device. This may include foreground location and, where enabled, background location for delivery tracking, route updates, nearby service availability, and order fulfillment. You can disable location access in your device settings, but some app features may stop working.
        </Paragraph>

        <SectionTitle>3. How We Use Your Information</SectionTitle>
        <Paragraph>
          We use data to create/manage accounts, process orders, provide customer support, prevent abuse or fraud, show nearby service availability, improve delivery tracking, and improve app performance and reliability.
        </Paragraph>

        <SectionTitle>4. Data Sharing</SectionTitle>
        <Paragraph>
          We do not sell personal information. Data may be shared with trusted service providers only when required to operate core app services (for example, authentication, storage, maps, location services, or order fulfillment support).
        </Paragraph>

        <SectionTitle>5. Data Retention</SectionTitle>
        <Paragraph>
          We retain data only as long as needed for service delivery, legal compliance, dispute resolution, security, and operational record-keeping.
        </Paragraph>

        <SectionTitle>6. Security Practices</SectionTitle>
        <Paragraph>
          We apply reasonable technical and organizational safeguards to protect personal data. No method of storage or transmission is fully secure, but we continuously improve protections.
        </Paragraph>

        <SectionTitle>7. Account Disable Request</SectionTitle>
        <Paragraph>
          If you request account deletion from within the app, your account is permanently disabled from further login or use. Some records may be retained where required for legal, security, or operational reasons.
        </Paragraph>

        <SectionTitle>8. Children&apos;s Privacy</SectionTitle>
        <Paragraph>
          This app is not directed to children under 13. We do not knowingly collect personal data from children under 13.
        </Paragraph>

        <SectionTitle>9. Changes to this Policy</SectionTitle>
        <Paragraph>
          We may update this Privacy Policy from time to time. Continued app usage after updates indicates acceptance of the revised policy.
        </Paragraph>

        <SectionTitle>10. Contact Us</SectionTitle>
        <Paragraph>
          For privacy questions or concerns, contact us at 8957246131 or prayagraj.alok@gmail.com.
        </Paragraph>
      </Content>
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Spacer = styled.View`
  min-width: 48px;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const Content = styled.ScrollView.attrs({
  contentContainerStyle: {
    padding: 20,
    paddingBottom: 44,
  },
  scrollIndicatorInsets: {
    bottom: 20,
  },
})`
  flex: 1;
`;

const MetaText = styled.Text`
  font-size: 13px;
  color: ${AppColors.textSecondary};
  margin-bottom: 8px;
`;

const SectionTitle = styled.Text`
  font-size: 16px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
  margin-bottom: 8px;
  margin-top: 12px;
`;

const Paragraph = styled.Text`
  font-size: 14px;
  color: ${AppColors.textSecondary};
  line-height: 22px;
`;
