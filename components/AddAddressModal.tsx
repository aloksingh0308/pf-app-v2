import { PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_TEXT_STYLE } from '@/components/common/AppButton';
import { T } from '@/constants/tokens';
import Ionicons from '@react-native-vector-icons/ionicons';
import { memo } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import styled from 'styled-components/native';

export type AddressLabel = 'Home' | 'Work' | 'Other';

const SAVE_AS_OPTIONS = [
  { label: 'Home', icon: 'home-outline' },
  { label: 'Work', icon: 'briefcase-outline' },
  { label: 'Other', icon: 'location-outline' },
] as const;

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
  /** The address resolved for the map pin, shown back to the customer before saving. */
  pinnedAddress?: string;
  detectingAddress?: boolean;
  /** Pin's distance from the restaurant — anything past `maxDeliveryKm` gets a warning. */
  distanceKm?: number | null;
  maxDeliveryKm?: number;
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
  pinnedAddress = '',
  detectingAddress = false,
  distanceKm = null,
  maxDeliveryKm = 5,
  onClose,
  onDeliveryAddressDetailsChange,
  onSelectAddressLabel,
  onSaveAddress,
}: AddAddressModalProps) {
  const outOfRange = distanceKm != null && distanceKm > maxDeliveryKm;
  const addressText = pinnedAddress.trim();

  return (
    <AddressModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <AddressModalOverlay>
        <AddressModalBackdrop onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ maxHeight: '92%' }}>
          <AddressModalCard>
            <SheetHandle />
            <SheetHeader>
              <View style={{ flex: 1 }}>
                <ModalTitle>{editingAddressId ? 'Edit address' : 'Add new address'}</ModalTitle>
                <ModalSubtitle>Search or move the map to set your location</ModalSubtitle>
              </View>
              <AddressModalCloseButton onPress={onClose} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={T.color.ink} />
              </AddressModalCloseButton>
            </SheetHeader>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 16 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {mapPickerSection}

              <LocationCard $warn={outOfRange}>
                <LocationIcon $warn={outOfRange}>
                  {detectingAddress && !addressText ? (
                    <ActivityIndicator size="small" color={T.color.brand} />
                  ) : (
                    <Ionicons name={outOfRange ? 'warning-outline' : 'location'} size={18} color={outOfRange ? T.color.danger : T.color.brand} />
                  )}
                </LocationIcon>
                <View style={{ flex: 1 }}>
                  <LocationLabel>DELIVERY LOCATION</LocationLabel>
                  <LocationText numberOfLines={3}>
                    {addressText || (detectingAddress ? 'Detecting your location…' : 'Move the map or search to pick a spot')}
                  </LocationText>
                  {outOfRange ? (
                    <LocationWarning>
                      This spot is {distanceKm!.toFixed(1)} km away. We deliver within {maxDeliveryKm} km of the restaurant.
                    </LocationWarning>
                  ) : null}
                </View>
              </LocationCard>

              <FieldLabel>House / flat / floor <FieldOptional>(optional)</FieldOptional></FieldLabel>
              <FieldBox>
                <Ionicons name="business-outline" size={18} color={T.color.faint} style={{ marginRight: 10 }} />
                <TextInput
                  style={{ flex: 1, color: T.color.ink, fontSize: 14, padding: 0 }}
                  placeholder="e.g. Flat 302, 3rd floor, near the park gate"
                  placeholderTextColor={T.color.faint}
                  value={deliveryAddressDetails}
                  onChangeText={onDeliveryAddressDetailsChange}
                  returnKeyType="done"
                />
              </FieldBox>
              <FieldHint>Helps the rider find your door without calling.</FieldHint>

              <FieldLabel>Save as</FieldLabel>
              <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
                {SAVE_AS_OPTIONS.map((option) => {
                  const selected = selectedAddressLabel === option.label;
                  return (
                    <SaveAsPill
                      key={option.label}
                      $selected={selected}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => onSelectAddressLabel(option.label)}
                    >
                      <Ionicons name={option.icon} size={16} color={selected ? T.color.brand : T.color.muted} style={{ marginRight: 6 }} />
                      <SaveAsPillText $selected={selected}>{option.label}</SaveAsPillText>
                    </SaveAsPill>
                  );
                })}
              </View>
            </ScrollView>

            {/* Pinned below the scroll so Save is always in reach, above the system nav bar. */}
            <SheetFooter style={{ paddingBottom: insetsBottom + 12 }}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={disableSaveAddress}
                onPress={onSaveAddress}
                accessibilityRole="button"
                style={[PRIMARY_BUTTON_STYLE, { gap: 10, opacity: disableSaveAddress ? 0.6 : 1 }]}
              >
                {savingAddress ? <ActivityIndicator color="#fff" /> : null}
                <Text style={PRIMARY_BUTTON_TEXT_STYLE}>
                  {saveAddressButtonText || (savingAddress ? 'Saving Address...' : editingAddressId ? 'Update Address' : 'Save Address')}
                </Text>
              </TouchableOpacity>
            </SheetFooter>
          </AddressModalCard>
        </KeyboardAvoidingView>
      </AddressModalOverlay>
    </AddressModal>
  );
});

export default AddAddressModal;

type SelectedProp = { $selected: boolean };
type WarnProp = { $warn: boolean };

const AddressModal = styled.Modal``;

const AddressModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: flex-end;
`;

const AddressModalBackdrop = styled(Pressable)`
  flex: 1;
`;

const AddressModalCard = styled.View`
  background-color: ${T.color.surface};
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 0 16px;
  width: 100%;
  flex-shrink: 1;
`;

const SheetHandle = styled.View`
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background-color: #e7e5e4;
  align-self: center;
  margin: 10px 0 12px;
`;

const SheetHeader = styled.View`
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
`;

const AddressModalCloseButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.line};
`;

const ModalTitle = styled.Text`
  font-size: 20px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 2px;
`;

const ModalSubtitle = styled.Text`
  font-size: 13px;
  color: ${T.color.muted};
`;

const LocationCard = styled.View<WarnProp>`
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  margin-bottom: 18px;
  border-radius: ${T.radius.md}px;
  border-width: 1px;
  border-color: ${(props: WarnProp) => (props.$warn ? '#fecaca' : T.color.brandBorder)};
  background-color: ${(props: WarnProp) => (props.$warn ? '#fef2f2' : '#fffaf5')};
`;

const LocationIcon = styled.View<WarnProp>`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background-color: ${(props: WarnProp) => (props.$warn ? '#fee2e2' : T.color.brandSoft)};
`;

const LocationLabel = styled.Text`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: ${T.color.muted};
  margin-bottom: 3px;
`;

const LocationText = styled.Text`
  font-size: 13px;
  line-height: 19px;
  font-weight: 600;
  color: ${T.color.ink};
`;

const LocationWarning = styled.Text`
  font-size: 12px;
  line-height: 17px;
  color: ${T.color.danger};
  margin-top: 6px;
  font-weight: 600;
`;

const FieldLabel = styled.Text`
  font-size: 13px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 8px;
`;

const FieldOptional = styled.Text`
  font-weight: 500;
  color: ${T.color.muted};
`;

const FieldBox = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 13px 14px;
  border-radius: ${T.radius.md}px;
  border-width: 1px;
  border-color: ${T.color.line};
  background-color: ${T.color.canvas};
`;

const FieldHint = styled.Text`
  font-size: 11px;
  color: ${T.color.muted};
  margin: 6px 2px 18px;
`;

const SaveAsPill = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<SelectedProp>`
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  border-width: 1.5px;
  border-color: ${(props: SelectedProp) => props.$selected ? T.color.brand : T.color.line};
  background-color: ${(props: SelectedProp) => props.$selected ? T.color.brandSoft : T.color.surface};
  border-radius: ${T.radius.pill}px;
  padding: 10px;
`;

const SaveAsPillText = styled.Text<SelectedProp>`
  color: ${(props: SelectedProp) => props.$selected ? T.color.brand : T.color.inkSoft};
  font-size: 14px;
  font-weight: 700;
`;

const SheetFooter = styled.View`
  padding-top: 12px;
  border-top-width: 1px;
  border-top-color: ${T.color.line};
  background-color: ${T.color.surface};
`;
