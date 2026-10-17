import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { AppColors } from '@/constants/appColors';
import React from 'react';
import styled from 'styled-components/native';

export default function SupportScreen() {
  return (
    <Container>
      <PageHeader title="Customer Support" />

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

const Container = styled(PageScreen)`
  flex: 1;
  background-color: ${AppColors.background};
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
