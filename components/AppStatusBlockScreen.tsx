import { AppColors } from '@/constants/appColors';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import styled from 'styled-components/native';

export type BlockingAppStatus = 'temporarily_paused' | 'emergency_closed' | 'maintenance';

type Props = {
  status: BlockingAppStatus;
  title?: string;
  description?: string;
};

const STATUS_PRESETS: Record<BlockingAppStatus, { icon: string; color: string; title: string; message: string }> = {
  temporarily_paused: {
    icon: 'time-outline',
    color: '#f68712',
    title: "We're Temporarily Paused",
    message: 'We are temporarily unable to accept orders. Please check back shortly.',
  },
  emergency_closed: {
    icon: 'alert-circle-outline',
    color: '#e53935',
    title: 'Service Temporarily Closed',
    message: 'Due to an unexpected operational issue, our services are currently unavailable.',
  },
  maintenance: {
    icon: 'construct-outline',
    color: '#1a1a1a',
    title: "We'll Be Back Soon!",
    message: 'We are currently performing maintenance to improve your experience.',
  },
};

export default function AppStatusBlockScreen({ status, title, description }: Props) {
  const preset = STATUS_PRESETS[status] ?? STATUS_PRESETS.maintenance;
  const displayTitle = title && title.trim() ? title : preset.title;
  const displayMessage = description && description.trim() ? description : preset.message;

  return (
    <Container>
      <IconWrap>
        <Ionicons name={preset.icon as any} size={64} color={preset.color} />
      </IconWrap>
      <Title>{displayTitle}</Title>
      <Message>{displayMessage}</Message>
    </Container>
  );
}

const Container = styled.View`
  flex: 1;
  background-color: ${AppColors.background};
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const IconWrap = styled.View`
  margin-bottom: 12px;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
  text-align: center;
`;

const Message = styled.Text`
  margin-top: 8px;
  font-size: 14px;
  color: ${AppColors.textSecondary};
  text-align: center;
`;
