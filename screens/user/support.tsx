import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React from 'react';
import styled from 'styled-components/native';

export default function SupportScreen() {
  return (
    <Container>
      <Header>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>Customer Support</Title>
        <Spacer />
      </Header>

      <Content>
        <SectionTitle>Raise Your Concern</SectionTitle>
        <Paragraph>
          If you are facing any issue with orders, payments, or account details, contact our support team using the details below.
        </Paragraph>

        <Card>
          <CardLabel>Mobile Number</CardLabel>
          <CardValue>8957246131</CardValue>
        </Card>

        <Card>
          <CardLabel>Email</CardLabel>
          <CardValue>prayagraj.alok@gmail.com</CardValue>
        </Card>
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

const Content = styled.ScrollView`
  flex: 1;
  padding: 20px;
`;

const SectionTitle = styled.Text`
  font-size: 16px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
  margin-bottom: 8px;
`;

const Paragraph = styled.Text`
  font-size: 14px;
  color: ${AppColors.textSecondary};
  line-height: 22px;
  margin-bottom: 16px;
`;

const Card = styled.View`
  border-width: 1px;
  border-color: ${AppColors.border};
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  background-color: ${AppColors.white};
`;

const CardLabel = styled.Text`
  font-size: 13px;
  color: ${AppColors.textSecondary};
  margin-bottom: 6px;
`;

const CardValue = styled.Text`
  font-size: 16px;
  color: ${AppColors.textPrimary};
  font-weight: 700;
`;
