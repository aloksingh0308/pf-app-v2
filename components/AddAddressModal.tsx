import Ionicons from '@react-native-vector-icons/ionicons';
import { memo } from 'react';
import { Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import styled from 'styled-components/native';

export type AddressLabel = 'Home' | 'Work' | 'Other';

type AddAddressModalProps = {
  visible: boolean;
  editingAddressId: string;
  insetsBottom: number;
  deliveryAddressDetails: string;
  selectedAddressLabel: AddressLabel;
  savingAddress: boolean;
  disableSaveAddress?: boolean;
  saveAddressButtonText?: string;
  mapPickerSection: React.ReactNode;
  onClose: () => void;
  onDeliveryAddressDetailsChange: (text: string) => void;
  onSelectAddressLabel: (label: AddressLabel) => void;
  onSaveAddress: () => void;
};

const AddAddressModal = memo(function AddAddressModal({
  visible,
  editingAddressId,
  insetsBottom,
  deliveryAddressDetails,
  selectedAddressLabel,
  savingAddress,
  disableSaveAddress = false,
  saveAddressButtonText,
  mapPickerSection,
  onClose,
  onDeliveryAddressDetailsChange,
  onSelectAddressLabel,
  onSaveAddress,
}: AddAddressModalProps) {
  return (
    <AddressModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <AddressModalOverlay>
        <AddressModalBackdrop onPress={onClose} />
        <AddressModalCard>
          <ScrollView
            contentContainerStyle={{ paddingBottom: insetsBottom + 24, flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#eee', marginBottom: 12 }} />
              <ModalTitle>{editingAddressId ? 'Edit Address' : 'Add New Address'}</ModalTitle>
              <ModalSubtitle>Help us deliver to you accurately</ModalSubtitle>
              <AddressModalCloseButton onPress={onClose} activeOpacity={0.8} style={{ position: 'absolute', right: 0, top: 0 }}>
                <Ionicons name="close" size={22} color="#282939" />
              </AddressModalCloseButton>
            </View>

            {mapPickerSection}

            <View style={{ backgroundColor: '#FAFAFA', borderRadius: 12, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: '#F2F2F2', flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="business-outline" size={18} color="#B0B0B0" style={{ marginRight: 10 }} />
              <TextInput
                style={{ flex: 1, color: '#222', fontSize: 14, padding: 0 }}
                placeholder="Flat / House No. / Floor / Landmark (Optional)"
                placeholderTextColor="#B0B0B0"
                value={deliveryAddressDetails}
                onChangeText={onDeliveryAddressDetailsChange}
              />
            </View>

            <Text style={{ color: '#222', fontWeight: 'bold', fontSize: 14, marginBottom: 10 }}>Save as</Text>
            <View style={{ flexDirection: 'row', marginBottom: 18 }}>
              <SaveAsPill $selected={selectedAddressLabel === 'Home'} onPress={() => onSelectAddressLabel('Home')}>
                <Ionicons name="home" size={18} color={selectedAddressLabel === 'Home' ? '#FF9100' : '#B0B0B0'} style={{ marginRight: 6 }} />
                <SaveAsPillText $selected={selectedAddressLabel === 'Home'}>Home</SaveAsPillText>
              </SaveAsPill>
              <SaveAsPill $selected={selectedAddressLabel === 'Work'} onPress={() => onSelectAddressLabel('Work')}>
                <Ionicons name="briefcase-outline" size={18} color={selectedAddressLabel === 'Work' ? '#FF9100' : '#B0B0B0'} style={{ marginRight: 6 }} />
                <SaveAsPillText $selected={selectedAddressLabel === 'Work'}>Work</SaveAsPillText>
              </SaveAsPill>
              <SaveAsPill $selected={selectedAddressLabel === 'Other'} onPress={() => onSelectAddressLabel('Other')}>
                <Ionicons name="star-outline" size={18} color={selectedAddressLabel === 'Other' ? '#FF9100' : '#B0B0B0'} style={{ marginRight: 6 }} />
                <SaveAsPillText $selected={selectedAddressLabel === 'Other'}>Other</SaveAsPillText>
              </SaveAsPill>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              disabled={disableSaveAddress}
              onPress={onSaveAddress}
              style={{
                backgroundColor: '#FF9100',
                borderRadius: 12,
                minHeight: 52,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
                opacity: disableSaveAddress ? 0.7 : 1,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 0.5 }}>
                {saveAddressButtonText || (savingAddress ? 'Saving Address...' : editingAddressId ? 'Update Address' : 'Save Address')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </AddressModalCard>
      </AddressModalOverlay>
    </AddressModal>
  );
});

export default AddAddressModal;

type SelectedProp = { $selected: boolean };

const AddressModal = styled.Modal``;

const AddressModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: flex-end;
`;

const AddressModalBackdrop = styled(Pressable)`
  flex: 1;
`;

const AddressModalCard = styled.View`
  background-color: #fff;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding: 16px;
  max-height: 86%;
  width: 100%;
`;

const AddressModalCloseButton = styled.TouchableOpacity`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: #f2f2f2;
`;

const ModalTitle = styled.Text`
  font-size: 22px;
  font-weight: bold;
  color: #181c2e;
  margin-bottom: 2px;
`;

const ModalSubtitle = styled.Text`
  font-size: 14px;
  color: #888;
  margin-bottom: 8px;
`;

const SaveAsPill = styled.TouchableOpacity<SelectedProp>`
  flex-direction: row;
  align-items: center;
  border-width: 1.5px;
  border-color: ${(props) => props.$selected ? '#ff9100' : '#e0e0e0'};
  background-color: ${(props) => props.$selected ? '#fff3e0' : '#fff'};
  border-radius: 10px;
  padding: 8px 18px;
  margin-right: 10px;
`;

const SaveAsPillText = styled.Text<SelectedProp>`
  color: ${(props) => props.$selected ? '#ff9100' : '#888'};
  font-size: 15px;
  font-weight: bold;
`;
