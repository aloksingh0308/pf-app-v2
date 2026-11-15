import AppImage from '@/components/AppImage';
import { formatOfferHeadline, type OfferRecord } from '@/services/offersService';
import { formatDistance, formatEta } from '@/services/restaurantService';
import { moderateScale, scaleFont } from '@/utils/responsive';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { memo } from 'react';
import { Pressable, View } from 'react-native';
import styled from 'styled-components/native';

const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';

/** "20% OFF" → ["20%", "OFF"], "FREE ITEM" → ["FREE", "ITEM"] — the ticket stub stacks them. */
const splitHeadline = (headline: string): [string, string] => {
  const index = headline.lastIndexOf(' ');
  return index > 0 ? [headline.slice(0, index), headline.slice(index + 1)] : [headline, ''];
};

const formatValidity = (validUntil: string): string => {
  const date = new Date(validUntil);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'Ends today';
  if (days === 1) return 'Ends tomorrow';
  if (days <= 7) return `Ends in ${days} days`;
  return `Valid till ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
};

/** "Offers Near You" coupon ticket — every offer is tied to a real restaurant, never a bare
 *  code chip. Tapping it hands the offer to the restaurant details screen (app/home.tsx's
 *  `handleOfferPress`). `fullWidth` is the stacked "View All" list; otherwise it's sized for
 *  the horizontal home carousel. */
export const OfferCard = memo(function OfferCard({ offer, onPress, fullWidth = false }: { offer: OfferRecord; onPress: (offer: OfferRecord) => void; fullWidth?: boolean }) {
  const [amount, unit] = splitHeadline(formatOfferHeadline(offer));
  const conditions = [
    offer.minOrderAmount > 0 ? `Min order ₹${offer.minOrderAmount}` : 'No minimum order',
    offer.discountType === 'PERCENTAGE' && offer.maxDiscount > 0 ? `Up to ₹${offer.maxDiscount}` : '',
  ].filter(Boolean).join(' · ');
  const meta = [formatEta(offer.deliveryTime), formatDistance(offer.distanceKm)].filter(Boolean).join(' · ');
  const validity = formatValidity(offer.validUntil);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${amount} ${unit} at ${offer.restaurantName}, code ${offer.couponCode}`}
      onPress={() => onPress(offer)}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] })}
    >
      <Ticket
        style={[
          fullWidth ? { width: '100%' } : { width: moderateScale(300), marginRight: moderateScale(12) },
          { shadowColor: '#b85a12', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
        ]}
      >
        <Stub>
          <StubAmount numberOfLines={1} adjustsFontSizeToFit>{amount}</StubAmount>
          {unit ? <StubUnit>{unit}</StubUnit> : null}
        </Stub>

        {/* Perforation: two half-circle notches cut into the ticket where stub meets body. */}
        <Notch style={{ top: -9 }} />
        <Notch style={{ bottom: -9 }} />

        <Body>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Logo>
              <AppImage uri={offer.restaurantImage || undefined} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
            </Logo>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <RestaurantName numberOfLines={1}>{offer.restaurantName}</RestaurantName>
              {meta ? <MetaText numberOfLines={1}>{meta}</MetaText> : null}
            </View>
          </View>

          <ConditionText numberOfLines={1}>{offer.title && offer.title !== offer.couponCode ? offer.title : conditions}</ConditionText>
          {offer.title && offer.title !== offer.couponCode ? <MetaText numberOfLines={1}>{conditions}</MetaText> : null}

          <Divider />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <CodeChip>
              <Ionicons name="pricetag" size={11} color="#e0680c" />
              <CodeText numberOfLines={1}>{offer.couponCode}</CodeText>
            </CodeChip>
            {validity ? <ValidityText numberOfLines={1}>{validity}</ValidityText> : null}
          </View>
        </Body>
      </Ticket>
    </Pressable>
  );
});

const Ticket = styled.View`
  flex-direction: row;
  min-height: 132px;
  border-radius: 16px;
  background-color: #fff;
  border-width: 1px;
  border-color: #f6e2cf;
`;

const Stub = styled.View`
  width: 92px;
  background-color: #f47b1f;
  border-top-left-radius: 15px;
  border-bottom-left-radius: 15px;
  align-items: center;
  justify-content: center;
  padding: 10px 8px;
`;

const StubAmount = styled.Text`
  color: #fff;
  font-size: ${scaleFont(26)}px;
  font-weight: 900;
`;

const StubUnit = styled.Text`
  color: #ffe6cf;
  font-size: ${scaleFont(13)}px;
  font-weight: 900;
  letter-spacing: 2px;
  margin-top: 2px;
`;

const Notch = styled.View`
  position: absolute;
  left: 83px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background-color: #fffbf7;
  border-width: 1px;
  border-color: #f6e2cf;
`;

const Body = styled.View`
  flex: 1;
  padding: 12px 14px 12px 16px;
`;

const Logo = styled.View`
  width: 34px;
  height: 34px;
  border-radius: 10px;
  overflow: hidden;
  background-color: #fff3e6;
`;

const RestaurantName = styled.Text`
  color: #1b1f29;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
`;

const MetaText = styled.Text`
  color: #8a8f98;
  font-size: ${scaleFont(11)}px;
  margin-top: 1px;
`;

const ConditionText = styled.Text`
  color: #3a3f4a;
  font-size: ${scaleFont(12)}px;
  font-weight: 700;
  margin-top: 10px;
`;

const Divider = styled.View`
  border-top-width: 1px;
  border-top-color: #f1e3d6;
  border-style: dashed;
  margin: 10px 0 9px;
`;

const CodeChip = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  flex-shrink: 1;
  border-radius: 6px;
  border-width: 1px;
  border-style: dashed;
  border-color: #f4a261;
  background-color: #fff6ec;
  padding: 4px 8px;
`;

const CodeText = styled.Text`
  color: #e0680c;
  font-size: ${scaleFont(12)}px;
  font-weight: 900;
  letter-spacing: 0.5px;
`;

const ValidityText = styled.Text`
  color: #8a8f98;
  font-size: ${scaleFont(11)}px;
  margin-left: 8px;
`;
