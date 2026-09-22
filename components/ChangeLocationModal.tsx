import Ionicons from '@react-native-vector-icons/ionicons';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import AddressModalMapPicker from './AddressModalMapPicker';
import { saveCachedUserLocation } from '../services/locationCacheService';
import { AppDispatch, RootState } from '../store';

const GOOGLE_MAPS_API_KEY = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();

// Same fallback used by the delivery-details map picker, so a user who has
// never resolved any location yet still gets a sensible starting point.
const DEFAULT_MAP_CENTER = { latitude: 25.4358, longitude: 81.8463 };

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Home's "Delivering to" field opens this to let the user search an address
 * (Google Places autocomplete) or drop a pin and browse the app as if they
 * were there — distinct from AddAddressModal, which saves a named address
 * (Home/Work/Other) to the account. This only updates the app-wide current
 * location (redux + AsyncStorage cache) that Home/restaurant listings read.
 */
export default function ChangeLocationModal({ visible, onClose }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const locationState = useSelector((state: RootState) => state.location);

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [addressText, setAddressText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const hasCoords = locationState.latitude != null && locationState.longitude != null;
    setPin(hasCoords ? { latitude: Number(locationState.latitude), longitude: Number(locationState.longitude) } : null);
    setAddressText(String(locationState.addressLine || '').trim());
    // Only re-seed from redux the moment the modal opens — not on every
    // keystroke/pin-drag while it's open, which live in local state instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleConfirm = useCallback(async () => {
    if (!pin) return;
    setSaving(true);
    try {
      const trimmedAddress = addressText.trim();
      await saveCachedUserLocation(
        {
          latitude: pin.latitude,
          longitude: pin.longitude,
          timestamp: Date.now(),
          addressLine: trimmedAddress || null,
          addressResolvedAt: trimmedAddress ? Date.now() : null,
        },
        dispatch
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }, [pin, addressText, dispatch, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Overlay>
        <Backdrop onPress={onClose} />
        <Card>
          <View style={{ alignItems: 'center', marginBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#eee', marginBottom: 12 }} />
            <Title>Change Location</Title>
            <Subtitle>Search an area, street name, or drop a pin</Subtitle>
            <CloseButton onPress={onClose} activeOpacity={0.8} style={{ position: 'absolute', right: 0, top: 0 }}>
              <Ionicons name="close" size={22} color="#282939" />
            </CloseButton>
          </View>

          <AddressModalMapPicker
            visible={visible}
            enabled
            editingAddressId=""
            defaultMapCenter={pin || DEFAULT_MAP_CENTER}
            restaurantCoords={null}
            googleMapsApiKey={GOOGLE_MAPS_API_KEY}
            initialAddressText={addressText}
            initialPin={pin}
            onAddressChange={setAddressText}
            onPinChange={setPin}
          />

          <ConfirmButton activeOpacity={0.8} disabled={!pin || saving} onPress={handleConfirm} style={{ opacity: !pin || saving ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
              {saving ? 'Saving...' : 'Confirm Location'}
            </Text>
          </ConfirmButton>
        </Card>
      </Overlay>
    </Modal>
  );
}

const Overlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.4);
  justify-content: flex-end;
`;

const Backdrop = styled(Pressable)`
  flex: 1;
`;

const Card = styled.View`
  background-color: #fff;
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding: 16px;
  min-height: 60%;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: bold;
  color: #181c2e;
`;

const Subtitle = styled.Text`
  font-size: 13px;
  color: #888;
  margin-bottom: 4px;
`;

const CloseButton = styled.TouchableOpacity`
  width: 28px;
  height: 28px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: #f2f2f2;
`;

const ConfirmButton = styled.TouchableOpacity`
  background-color: #ff9100;
  border-radius: 12px;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
`;
