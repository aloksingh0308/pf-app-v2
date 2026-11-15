import AppImage from '@/components/AppImage';
import { memo } from 'react';
import { Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import styled from 'styled-components/native';
import { T } from '@/constants/tokens';

type AnnouncementBottomSheetProps = {
  visible: boolean;
  title: string;
  description: string;
  imageUrl?: string | null;
  onClose: () => void;
};

const AnnouncementBottomSheet = memo(function AnnouncementBottomSheet({
  visible,
  title,
  description,
  imageUrl,
  onClose,
}: AnnouncementBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const hasImage = Boolean(imageUrl && imageUrl.trim());

  return (
    <AnnouncementModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <AnnouncementModalOverlay>
        <AnnouncementModalBackdrop onPress={onClose} />
        <AnnouncementModalCard style={{ paddingBottom: insets.bottom + 20 }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: 8, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: T.color.line }} />
            </View>

            {hasImage ? (
              <AnnouncementImageWrap>
                <AppImage uri={imageUrl || undefined} contentFit="cover" style={{ width: '100%', height: '100%' }} />
              </AnnouncementImageWrap>
            ) : null}

            <AnnouncementTitle>{title}</AnnouncementTitle>
            <AnnouncementDescription>{description}</AnnouncementDescription>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onClose}
              style={{
                backgroundColor: '#FF9100',
                borderRadius: 12,
                minHeight: 52,
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 24,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 }}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </AnnouncementModalCard>
      </AnnouncementModalOverlay>
    </AnnouncementModal>
  );
});

export default AnnouncementBottomSheet;

const AnnouncementModal = styled.Modal``;

const AnnouncementModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: flex-end;
`;

const AnnouncementModalBackdrop = styled(Pressable)`
  flex: 1;
`;

const AnnouncementModalCard = styled.View`
  background-color: #fff;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding: 16px 20px 20px 20px;
  max-height: 86%;
  width: 100%;
`;

const AnnouncementImageWrap = styled.View`
  width: 100%;
  height: 170px;
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
  background-color: #f2f2f2;
`;

const AnnouncementTitle = styled.Text`
  font-size: 20px;
  font-weight: bold;
  color: #181c2e;
  margin-bottom: 8px;
`;

const AnnouncementDescription = styled.Text`
  font-size: 15px;
  line-height: 21px;
  color: #666666;
`;
