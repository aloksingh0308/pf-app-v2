import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React from 'react';
import styled from 'styled-components/native';

export default function TermsAndConditionsScreen() {
  return (
    <Container>
      <Header>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>Terms & Conditions</Title>
        <Spacer />
      </Header>

      <Content>
        <MetaText>Effective Date: 1 March 2026</MetaText>

        <SectionTitle>1. Acceptance of Terms</SectionTitle>
        <Paragraph>
          By creating an account, placing an order, or using Hungry&apos;s Bucket Cafe app, you agree to these Terms & Conditions.
        </Paragraph>

        <SectionTitle>2. Eligibility & Account Responsibility</SectionTitle>
        <Paragraph>
          You must provide accurate profile and delivery information. You are responsible for activities under your account and for keeping login credentials secure.
        </Paragraph>

        <SectionTitle>3. Orders, Pricing & Availability</SectionTitle>
        <Paragraph>
          Menu availability, pricing, and offers may change without notice. Orders are confirmed only after successful acceptance by the app/system.
        </Paragraph>

        <SectionTitle>4. Payments</SectionTitle>
        <Paragraph>
          You agree to pay all charges applicable to your orders. Any payment disputes should be raised through Support with complete order details.
        </Paragraph>

        <SectionTitle>5. Cancellation, Refund & Resolution</SectionTitle>
        <Paragraph>
          Cancellation and refund decisions depend on order status, preparation stage, and issue verification. We review requests in good faith and share updates through support channels.
        </Paragraph>

        <SectionTitle>6. Prohibited Use</SectionTitle>
        <Paragraph>
          You must not misuse the app, attempt unauthorized access, submit fraudulent orders, abuse promotions, or disrupt service operations.
        </Paragraph>

        <SectionTitle>7. Account Suspension or Permanent Disable</SectionTitle>
        <Paragraph>
          We may suspend or permanently disable accounts involved in fraud, abuse, policy violations, or safety risks. A user-requested delete action permanently disables account access without necessarily deleting all records required for legal or operational purposes.
        </Paragraph>

        <SectionTitle>8. Privacy</SectionTitle>
        <Paragraph>
          Your personal data is handled according to our Privacy Policy. By using the app, you consent to our data practices described there.
        </Paragraph>

        <SectionTitle>9. Limitation of Liability</SectionTitle>
        <Paragraph>
          To the extent permitted by law, Hungry&apos;s Bucket Cafe is not liable for indirect, incidental, or consequential damages arising from app use, service interruptions, or third-party systems.
        </Paragraph>

        <SectionTitle>10. Updates to Terms</SectionTitle>
        <Paragraph>
          We may revise these terms periodically. Continued use of the app after updates means you accept the revised Terms & Conditions.
        </Paragraph>

        <SectionTitle>11. Contact</SectionTitle>
        <Paragraph>
          For legal, account, or policy questions, contact Support at 8957246131 or prayagraj.alok@gmail.com.
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
