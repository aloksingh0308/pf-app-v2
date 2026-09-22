import AppImage from '@/components/AppImage';
import { formatOfferHeadline, type OfferRecord } from '@/services/offersService';
import { formatDistance, formatEta } from '@/services/restaurantService';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';
import React from 'react';
import { Pressable } from 'react-native';
import styled from 'styled-components/native';

const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';

/** "Offers Near You" card — every offer is tied to a real restaurant (image/name/distance),
 *  never a bare coupon-code chip, per the discovery-through-offer product requirement.
 *  Tapping it hands the offer to the restaurant details screen (see app/home.tsx's
 *  `handleOfferPress`) rather than a generic coupon list. */
export function OfferCard({ offer, onPress }: { offer: OfferRecord; onPress: () => void }) {
  const metaLine = [formatEta(offer.deliveryTime), formatDistance(offer.distanceKm)].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress}>
      <Card>
        <ImageWrap>
          <AppImage uri={offer.restaurantImage || undefined} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
          <HeadlineBadge>
            <HeadlineText numberOfLines={1}>{formatOfferHeadline(offer)}</HeadlineText>
          </HeadlineBadge>
        </ImageWrap>
        <Content>
          {offer.minOrderAmount > 0 ? <OfferDesc numberOfLines={1}>On orders above ₹{offer.minOrderAmount}</OfferDesc> : null}
          <RestaurantName numberOfLines={1}>{offer.restaurantName}</RestaurantName>
          {metaLine ? <MetaText numberOfLines={1}>{metaLine}</MetaText> : null}
          <CodeRow>
            <CodeText numberOfLines={1}>Code: {offer.couponCode}</CodeText>
          </CodeRow>
        </Content>
      </Card>
    </Pressable>
  );
}

const Card = styled.View`
  width: ${moderateScale(240)}px;
  margin-right: ${moderateScale(12)}px;
  border-radius: ${moderateScale(14)}px;
  overflow: hidden;
  background-color: #fff;
  border-width: 1px;
  border-color: #ececec;
`;

const ImageWrap = styled.View`
  width: 100%;
  height: ${moderateVerticalScale(96)}px;
  background-color: #f4f4f4;
`;

const HeadlineBadge = styled.View`
  position: absolute;
  left: ${moderateScale(10)}px;
  bottom: ${moderateVerticalScale(8)}px;
  background-color: #f68712;
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateVerticalScale(4)}px ${moderateScale(9)}px;
`;

const HeadlineText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 900;
`;

const Content = styled.View`
  padding: ${moderateScale(10)}px;
`;

const OfferDesc = styled.Text`
  color: #7a7a7a;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const RestaurantName = styled.Text`
  margin-top: ${moderateVerticalScale(3)}px;
  color: #1b1b1b;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
`;

const MetaText = styled.Text`
  margin-top: ${moderateVerticalScale(3)}px;
  color: #7a7a7a;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const CodeRow = styled.View`
  margin-top: ${moderateVerticalScale(6)}px;
  align-self: flex-start;
  border-radius: ${moderateScale(6)}px;
  border-width: 1px;
  border-color: #ffd3a8;
  background-color: #fff6ec;
  padding: ${moderateVerticalScale(4)}px ${moderateScale(8)}px;
`;

const CodeText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(11)}px;
  font-weight: 800;
`;
