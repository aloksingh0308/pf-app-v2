import AppImage from '@/components/AppImage';
import { formatDistance, formatEta, type RestaurantRecord } from '@/services/restaurantService';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import { Pressable } from 'react-native';
import styled from 'styled-components/native';

const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';

/** The one restaurant-card shape used everywhere a restaurant is listed on the home
 *  screen — Order Again, Recommended for You, New on Prayagi, and the main Restaurants
 *  list all render the SAME two components below, just with different data/badge inputs.
 *  Previously `RestaurantCard`/`RestaurantMiniCard` were defined locally inside
 *  app/home.tsx; pulled out here so no screen ever grows a second, subtly-different
 *  restaurant card. */

export type RestaurantCardBadge = 'New' | 'Sponsored' | 'Offer' | null;

/** Full card — the main "Restaurants" list and search results. */
export function RestaurantCard({
  restaurant,
  onViewMenu,
  onViewDetails,
}: {
  restaurant: RestaurantRecord;
  onViewMenu: () => void;
  onViewDetails: () => void;
}) {
  const image = restaurant.coverImage || restaurant.image || FALLBACK_CAFE_IMAGE;
  const subtitle = String(restaurant.cuisine || restaurant.desc || '').trim();
  const openingHours = String(restaurant.openingHours || '').trim();
  const phone = String(restaurant.phone || '').trim();
  const distanceLabel = formatDistance(restaurant.distanceKm);
  const etaLabel = formatEta(restaurant.eta);

  return (
    <ExploreCafeCard>
      <ExploreCafeImageWrap>
        <AppImage uri={image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
        <ExploreCafeVerifiedBadge>
          <Ionicons name="checkmark-circle" size={moderateScale(14)} color="#fff" />
        </ExploreCafeVerifiedBadge>
      </ExploreCafeImageWrap>
      <ExploreCafeContent>
        <ExploreCafeTitleRow>
          <ExploreCafeTitle numberOfLines={1}>{restaurant.name || 'Restaurant'}</ExploreCafeTitle>
          {restaurant.isSponsored ? (
            <RankingBadge $variant="sponsored">
              <RankingBadgeText $variant="sponsored">Sponsored</RankingBadgeText>
            </RankingBadge>
          ) : restaurant.isNew ? (
            <RankingBadge $variant="new">
              <RankingBadgeText $variant="new">New</RankingBadgeText>
            </RankingBadge>
          ) : null}
        </ExploreCafeTitleRow>
        {subtitle ? <ExploreCafeSubtitle numberOfLines={1}>{subtitle}</ExploreCafeSubtitle> : null}
        <ExploreCafeInfoRow>
          {etaLabel ? (
            <ExploreCafeInfoChip>
              <Ionicons name="bicycle-outline" size={moderateScale(12)} color="#5f5f5f" />
              <ExploreCafeInfoText numberOfLines={1}>{etaLabel}</ExploreCafeInfoText>
            </ExploreCafeInfoChip>
          ) : null}
          {distanceLabel ? (
            <ExploreCafeInfoChip>
              <Ionicons name="location-outline" size={moderateScale(12)} color="#5f5f5f" />
              <ExploreCafeInfoText numberOfLines={1}>{distanceLabel}</ExploreCafeInfoText>
            </ExploreCafeInfoChip>
          ) : null}
          {openingHours ? (
            <ExploreCafeInfoChip>
              <Ionicons name="time-outline" size={moderateScale(12)} color="#5f5f5f" />
              <ExploreCafeInfoText numberOfLines={1}>{openingHours}</ExploreCafeInfoText>
            </ExploreCafeInfoChip>
          ) : null}
          {phone ? (
            <ExploreCafeInfoChip>
              <Ionicons name="call-outline" size={moderateScale(12)} color="#5f5f5f" />
              <ExploreCafeInfoText numberOfLines={1}>{phone}</ExploreCafeInfoText>
            </ExploreCafeInfoChip>
          ) : null}
        </ExploreCafeInfoRow>
        <ExploreCafeActions>
          <ExplorePrimaryButton activeOpacity={0.88} onPress={onViewMenu}>
            <ExplorePrimaryText>View Full Menu</ExplorePrimaryText>
          </ExplorePrimaryButton>
          <ExploreSecondaryButton activeOpacity={0.88} onPress={onViewDetails}>
            <Ionicons name="information-circle-outline" size={moderateScale(14)} color="#f68712" style={{ marginRight: moderateScale(5) }} />
            <ExploreSecondaryText>Details</ExploreSecondaryText>
          </ExploreSecondaryButton>
        </ExploreCafeActions>
      </ExploreCafeContent>
    </ExploreCafeCard>
  );
}

/** Compact card for every horizontal carousel — Order Again, Recommended for You, and New
 *  on Prayagi all use this one, differing only in which `badge` they pass in. */
export function RestaurantMiniCard({
  restaurant,
  badge,
  onPress,
}: {
  restaurant: RestaurantRecord;
  badge?: RestaurantCardBadge;
  onPress: () => void;
}) {
  const image = restaurant.coverImage || restaurant.image || FALLBACK_CAFE_IMAGE;
  const subtitle = String(restaurant.cuisine || restaurant.desc || '').trim();
  const distanceLabel = formatDistance(restaurant.distanceKm);
  const etaLabel = formatEta(restaurant.eta);
  const metaLine = [etaLabel, distanceLabel].filter(Boolean).join(' · ');
  const badgeVariant = badge === 'Sponsored' ? 'sponsored' : badge === 'Offer' ? 'offer' : 'new';

  return (
    <Pressable onPress={onPress}>
      <MiniCard>
        <MiniCardImageWrap>
          <AppImage uri={image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
        </MiniCardImageWrap>
        <MiniCardContent>
          <MiniCardTitleRow>
            <MiniCardTitle numberOfLines={1}>{restaurant.name || 'Restaurant'}</MiniCardTitle>
            {badge ? (
              <RankingBadge $variant={badgeVariant}>
                <RankingBadgeText $variant={badgeVariant}>{badge}</RankingBadgeText>
              </RankingBadge>
            ) : null}
          </MiniCardTitleRow>
          {subtitle ? <MiniCardSubtitle numberOfLines={1}>{subtitle}</MiniCardSubtitle> : null}
          {metaLine ? <MiniCardMeta numberOfLines={1}>{metaLine}</MiniCardMeta> : null}
        </MiniCardContent>
      </MiniCard>
    </Pressable>
  );
}

const ExploreCafeCard = styled.View`
  border-radius: ${moderateScale(18)}px;
  overflow: hidden;
  background-color: #fff;
  margin-bottom: ${moderateVerticalScale(16)}px;
  shadow-color: #000;
  shadow-opacity: 0.06;
  shadow-radius: 10px;
  shadow-offset: 0px 4px;
  elevation: 2;
`;

const ExploreCafeImageWrap = styled.View`
  width: 100%;
  height: ${moderateVerticalScale(150)}px;
  background-color: #f2f2f2;
`;

const ExploreCafeVerifiedBadge = styled.View`
  position: absolute;
  top: ${moderateScale(10)}px;
  right: ${moderateScale(10)}px;
  background-color: rgba(0, 0, 0, 0.45);
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateScale(4)}px;
`;

const ExploreCafeContent = styled.View`
  padding: ${moderateVerticalScale(12)}px ${moderateScale(14)}px ${moderateVerticalScale(14)}px;
`;

const ExploreCafeTitleRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const ExploreCafeTitle = styled.Text`
  color: #1f1f1f;
  font-size: ${scaleFont(17)}px;
  font-weight: 800;
  flex-shrink: 1;
`;

type BadgeVariant = 'sponsored' | 'new' | 'offer';

// Deliberately quiet styling — a small pill, not a loud marketplace-style banner, per the
// product principle that ranking should still feel quality-driven, not "paid always wins".
const RankingBadge = styled.View<{ $variant: BadgeVariant }>`
  margin-left: ${moderateScale(8)}px;
  padding: ${moderateScale(3)}px ${moderateScale(8)}px;
  border-radius: ${moderateScale(999)}px;
  background-color: ${({ $variant }: { $variant: BadgeVariant }) =>
    $variant === 'sponsored' ? '#fdf0dd' : $variant === 'offer' ? '#fdeaea' : '#e6f4ea'};
`;

const RankingBadgeText = styled.Text<{ $variant: BadgeVariant }>`
  font-size: ${scaleFont(10)}px;
  font-weight: 700;
  color: ${({ $variant }: { $variant: BadgeVariant }) =>
    $variant === 'sponsored' ? '#a3610a' : $variant === 'offer' ? '#c0392b' : '#1f7a3d'};
`;

const ExploreCafeSubtitle = styled.Text`
  margin-top: ${moderateVerticalScale(2)}px;
  color: #f68712;
  font-size: ${scaleFont(13)}px;
  font-weight: 600;
`;

const ExploreCafeInfoRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: ${moderateVerticalScale(6)}px;
`;

const ExploreCafeInfoChip = styled.View`
  flex-direction: row;
  align-items: center;
  margin-right: ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(2)}px;
`;

const ExploreCafeInfoText = styled.Text`
  margin-left: ${moderateScale(5)}px;
  color: #5f5f5f;
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;

const ExploreCafeActions = styled.View`
  flex-direction: row;
  margin-top: ${moderateVerticalScale(12)}px;
`;

const ExplorePrimaryButton = styled.TouchableOpacity`
  flex: 1;
  border-radius: ${moderateScale(8)}px;
  background-color: #f68712;
  align-items: center;
  justify-content: center;
  padding: ${moderateVerticalScale(9)}px 0;
`;

const ExplorePrimaryText = styled.Text`
  color: #fff;
  font-size: ${scaleFont(12)}px;
  font-weight: 800;
`;

const ExploreSecondaryButton = styled.TouchableOpacity`
  flex: 1;
  border-radius: ${moderateScale(8)}px;
  border-width: 1px;
  border-color: #f68712;
  margin-left: ${moderateScale(8)}px;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  padding: ${moderateVerticalScale(9)}px 0;
`;

const ExploreSecondaryText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(12)}px;
  font-weight: 800;
`;

const MiniCard = styled.View`
  width: ${moderateScale(224)}px;
  margin-right: ${moderateScale(12)}px;
  border-width: 1px;
  border-color: #ececec;
  border-radius: ${moderateScale(14)}px;
  overflow: hidden;
  background-color: #fff;
`;

const MiniCardImageWrap = styled.View`
  width: 100%;
  height: ${moderateVerticalScale(110)}px;
  background-color: #f4f4f4;
`;

const MiniCardContent = styled.View`
  padding: ${moderateScale(10)}px;
`;

const MiniCardTitleRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

const MiniCardTitle = styled.Text`
  flex-shrink: 1;
  color: #1b1b1b;
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
`;

const MiniCardSubtitle = styled.Text`
  margin-top: ${moderateVerticalScale(3)}px;
  color: #f68712;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const MiniCardMeta = styled.Text`
  margin-top: ${moderateVerticalScale(3)}px;
  color: #7a7a7a;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;
