import AppImage from '@/components/AppImage';
import { T } from '@/constants/tokens';
import { formatDistance, formatEta, type RestaurantRecord } from '@/services/restaurantService';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';
import Ionicons from '@react-native-vector-icons/ionicons';
import React, { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import styled from 'styled-components/native';

// iOS only: on Android the shadow is `elevation`, which Android draws apart from the view —
// while the card fades in (AppearIn) or its photo is still loading, it showed as a grey box
// around/behind the card. The 1px border already outlines the card there.
const CARD_SHADOW = Platform.OS === 'ios' ? T.shadow.card : undefined;

const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';

/** The one restaurant-card shape used everywhere a restaurant is listed on the home
 *  screen — Order Again, Recommended for You, New on Prayagi, and the main Restaurants
 *  list all render the SAME two components below, just with different data/badge inputs.
 *  Previously `RestaurantCard`/`RestaurantMiniCard` were defined locally inside
 *  app/home.tsx; pulled out here so no screen ever grows a second, subtly-different
 *  restaurant card. */

export type RestaurantCardBadge = 'New' | 'Sponsored' | 'Offer' | null;

/** Full card — the main "Restaurants" list and search results. Memoized: callbacks get the
 *  restaurant back, so Home passes the same stable handler to every card. */
export const RestaurantCard = memo(function RestaurantCard<T extends RestaurantRecord>({
  restaurant,
  onViewMenu,
  onViewDetails,
}: {
  restaurant: T;
  onViewMenu: (restaurant: T) => void;
  onViewDetails: (restaurant: T) => void;
}) {
  const image = restaurant.coverImage || restaurant.image || FALLBACK_CAFE_IMAGE;
  const subtitle = String(restaurant.cuisine || restaurant.desc || '').trim();
  const distanceLabel = formatDistance(restaurant.distanceKm);
  const etaLabel = formatEta(restaurant.eta);

  const rating = Number(restaurant.rating) || 0;

  return (
    <Pressable
      onPress={() => onViewMenu(restaurant)}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={`View menu for ${restaurant.name || 'restaurant'}`}
    >
      <ExploreCafeCard style={CARD_SHADOW}>
        <ExploreCafeImageWrap>
          <AppImage uri={image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
          {restaurant.freeDelivery ? <FreeDeliveryTag /> : null}
        </ExploreCafeImageWrap>
        <ExploreCafeContent>
          <ExploreCafeTitleRow>
            <ExploreCafeTitle numberOfLines={2}>{restaurant.name || 'Restaurant'}</ExploreCafeTitle>
            <Pressable
              onPress={() => onViewDetails(restaurant)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Details for ${restaurant.name || 'restaurant'}`}
              style={{ marginLeft: 6, marginTop: -2 }}
            >
              <Ionicons name="information-circle-outline" size={moderateScale(20)} color={T.color.faint} />
            </Pressable>
          </ExploreCafeTitleRow>
          {subtitle ? <ExploreCafeSubtitle numberOfLines={1}>{subtitle}</ExploreCafeSubtitle> : null}
          <ExploreCafeInfoRow>
            {rating > 0 ? (
              <RatingPill>
                <Ionicons name="star" size={moderateScale(10)} color="#fff" />
                <RatingPillText>{rating.toFixed(1)}</RatingPillText>
              </RatingPill>
            ) : null}
            {etaLabel ? (
              <ExploreCafeInfoChip>
                <Ionicons name="time-outline" size={moderateScale(13)} color={T.color.muted} />
                <ExploreCafeInfoText numberOfLines={1}>{etaLabel}</ExploreCafeInfoText>
              </ExploreCafeInfoChip>
            ) : null}
            {distanceLabel ? (
              <ExploreCafeInfoChip>
                <Ionicons name="location-outline" size={moderateScale(13)} color={T.color.muted} />
                <ExploreCafeInfoText numberOfLines={1}>{distanceLabel}</ExploreCafeInfoText>
              </ExploreCafeInfoChip>
            ) : null}
          </ExploreCafeInfoRow>
          <ExploreCafeFooter>
            {restaurant.isSponsored ? (
              <RankingBadge $variant="sponsored"><RankingBadgeText $variant="sponsored">Sponsored</RankingBadgeText></RankingBadge>
            ) : restaurant.isNew ? (
              <RankingBadge $variant="new"><RankingBadgeText $variant="new">New</RankingBadgeText></RankingBadge>
            ) : <Spacer />}
            <ExploreMenuLink>
              <ExploreMenuLinkText>View menu</ExploreMenuLinkText>
              <Ionicons name="chevron-forward" size={moderateScale(14)} color={T.color.brand} />
            </ExploreMenuLink>
          </ExploreCafeFooter>
        </ExploreCafeContent>
      </ExploreCafeCard>
    </Pressable>
  );
}) as <T extends RestaurantRecord>(props: { restaurant: T; onViewMenu: (restaurant: T) => void; onViewDetails: (restaurant: T) => void }) => React.ReactElement;

/** Compact card for every horizontal carousel — Order Again, Recommended for You, and New
 *  on Prayagi all use this one, differing only in which `badge` they pass in. */
export const RestaurantMiniCard = memo(function RestaurantMiniCard<T extends RestaurantRecord>({
  restaurant,
  badge,
  actionLabel,
  onPress,
}: {
  restaurant: T;
  badge?: RestaurantCardBadge;
  actionLabel?: string;
  onPress: (restaurant: T) => void;
}) {
  const image = restaurant.coverImage || restaurant.image || FALLBACK_CAFE_IMAGE;
  const subtitle = String(restaurant.cuisine || restaurant.desc || '').trim();
  const distanceLabel = formatDistance(restaurant.distanceKm);
  const etaLabel = formatEta(restaurant.eta);
  const badgeVariant = badge === 'Sponsored' ? 'sponsored' : badge === 'Offer' ? 'offer' : 'new';

  return (
    <Pressable style={{ flexShrink: 0, alignSelf: 'flex-start' }} onPress={() => onPress(restaurant)} accessibilityRole="button" accessibilityLabel={`${actionLabel || 'View menu for'} ${restaurant.name || 'restaurant'}`}>
      <MiniCard collapsable={false}>
        <MiniCardImageWrap collapsable={false}>
          <AppImage uri={image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
          {badge ? <RankingBadge style={{ position: 'absolute', top: 8, left: 8 }} $variant={badgeVariant}><RankingBadgeText $variant={badgeVariant}>{badge}</RankingBadgeText></RankingBadge> : null}
          {restaurant.freeDelivery ? <FreeDeliveryTag /> : null}
        </MiniCardImageWrap>
        <MiniCardContent collapsable={false}>
          <MiniCardTitle numberOfLines={1}>{restaurant.name || 'Restaurant'}</MiniCardTitle>
          {subtitle ? <MiniCardSubtitle numberOfLines={1}>{subtitle}</MiniCardSubtitle> : null}
          <MiniCardTitleRow style={{ marginTop: 5, gap: 5 }}>
            {Number(restaurant.rating) > 0 ? <><Ionicons name="star" size={13} color={T.color.star} /><MiniCardMeta>{Number(restaurant.rating).toFixed(1)}</MiniCardMeta></> : null}
            {etaLabel ? <><Ionicons name="time-outline" size={12} color="#888" /><MiniCardMeta>{etaLabel}</MiniCardMeta></> : null}
            {distanceLabel ? <><Ionicons name="location-outline" size={12} color="#888" /><MiniCardMeta>{distanceLabel}</MiniCardMeta></> : null}
          </MiniCardTitleRow>
          {actionLabel ? <MiniCardAction><ExplorePrimaryText>{actionLabel}</ExplorePrimaryText></MiniCardAction> : null}
        </MiniCardContent>
      </MiniCard>
    </Pressable>
  );
}) as <T extends RestaurantRecord>(props: { restaurant: T; badge?: RestaurantCardBadge; actionLabel?: string; onPress: (restaurant: T) => void }) => React.ReactElement;

/** Compact row card (photo left, details right, round action) for Home's "Order Again" —
 *  about a third of RestaurantMiniCard's height, so returning users see more of the feed. */
export const RestaurantCompactCard = memo(function RestaurantCompactCard<T extends RestaurantRecord>({
  restaurant,
  actionLabel = 'Order again',
  onPress,
}: {
  restaurant: T;
  actionLabel?: string;
  onPress: (restaurant: T) => void;
}) {
  const image = restaurant.coverImage || restaurant.image || FALLBACK_CAFE_IMAGE;
  const subtitle = String(restaurant.cuisine || restaurant.desc || '').trim();
  const etaLabel = formatEta(restaurant.eta);
  const rating = Number(restaurant.rating);
  return (
    <Pressable onPress={() => onPress(restaurant)} accessibilityRole="button" accessibilityLabel={`${actionLabel} from ${restaurant.name || 'restaurant'}`}
      style={({ pressed }) => [compactStyles.card, pressed && { opacity: 0.8 }]}>
      <View style={compactStyles.photo}>
        <AppImage uri={image} fallbackUri={FALLBACK_CAFE_IMAGE} style={{ width: '100%', height: '100%' }} />
      </View>
      <View style={compactStyles.body}>
        <Text style={compactStyles.title} numberOfLines={1}>{restaurant.name || 'Restaurant'}</Text>
        {subtitle ? <Text style={compactStyles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        <View style={compactStyles.meta}>
          {rating > 0 ? <><Ionicons name="star" size={12} color={T.color.star} /><Text style={compactStyles.metaText}>{rating.toFixed(1)}</Text></> : null}
          {etaLabel ? <><Ionicons name="time-outline" size={11} color="#888" /><Text style={compactStyles.metaText}>{etaLabel}</Text></> : null}
          {restaurant.freeDelivery ? <><Ionicons name="bicycle" size={12} color={T.color.success} /><Text style={compactStyles.free} numberOfLines={1}>Free</Text></> : null}
        </View>
      </View>
      <View style={compactStyles.action}>
        <Ionicons name="refresh" size={18} color="#fff" />
      </View>
    </Pressable>
  );
}) as <T extends RestaurantRecord>(props: { restaurant: T; actionLabel?: string; onPress: (restaurant: T) => void }) => React.ReactElement;

const compactStyles = StyleSheet.create({
  card: { width: 300, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: T.radius.lg, backgroundColor: T.color.surface, borderWidth: 1, borderColor: T.color.line },
  photo: { width: 60, height: 60, borderRadius: T.radius.md, overflow: 'hidden', backgroundColor: T.color.canvas },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '800', color: T.color.ink },
  subtitle: { fontSize: 12, color: T.color.muted, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  metaText: { fontSize: 11, fontWeight: '600', color: T.color.inkSoft, marginRight: 3 },
  free: { fontSize: 10, fontWeight: '800', color: T.color.success, flexShrink: 1 },
  action: { width: 34, height: 34, borderRadius: 17, backgroundColor: T.color.brand, alignItems: 'center', justifyContent: 'center' },
});

/** Green strip across the bottom of the card photo — restaurants that deliver for ₹0. */
function FreeDeliveryTag() {
  return (
    <FreeDeliveryStrip accessibilityLabel="Free delivery">
      <Ionicons name="bicycle" size={moderateScale(11)} color="#fff" />
      <FreeDeliveryText numberOfLines={1}>FREE DELIVERY</FreeDeliveryText>
    </FreeDeliveryStrip>
  );
}

const FreeDeliveryStrip = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: ${moderateVerticalScale(3)}px ${moderateScale(4)}px;
  background-color: ${T.color.success};
`;

const FreeDeliveryText = styled.Text`
  margin-left: ${moderateScale(4)}px;
  color: #fff;
  font-size: ${scaleFont(9)}px;
  font-weight: 800;
  letter-spacing: 0.4px;
`;

const ExploreCafeCard = styled.View`
  flex-direction: row;
  border-radius: ${T.radius.lg}px;
  padding: 10px;
  background-color: ${T.color.surface};
  border-width: 1px;
  border-color: ${T.color.line};
  margin-bottom: 12px;
`;

const ExploreCafeImageWrap = styled.View`
  width: ${moderateScale(104)}px;
  height: ${moderateScale(104)}px;
  border-radius: ${T.radius.md}px;
  overflow: hidden;
  background-color: #f2f2f2;
`;

const ExploreCafeContent = styled.View`
  flex: 1;
  padding-left: 12px;
  justify-content: space-between;
`;

const ExploreCafeTitleRow = styled.View`
  flex-direction: row;
  align-items: flex-start;
`;

const ExploreCafeTitle = styled.Text`
  flex: 1;
  color: ${T.color.ink};
  font-size: ${scaleFont(15)}px;
  font-weight: 800;
`;

type BadgeVariant = 'sponsored' | 'new' | 'offer';

// Deliberately quiet styling — a small pill, not a loud marketplace-style banner, per the
// product principle that ranking should still feel quality-driven, not "paid always wins".
const RankingBadge = styled.View<{ $variant: BadgeVariant }>`
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
  margin-top: 2px;
  color: ${T.color.muted};
  font-size: ${scaleFont(12)}px;
  font-weight: 500;
`;

const ExploreCafeInfoRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  margin-top: ${moderateVerticalScale(6)}px;
`;

const RatingPill = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 2px 6px;
  border-radius: 6px;
  background-color: ${T.color.ratingGood};
  margin-right: 10px;
`;

const RatingPillText = styled.Text`
  margin-left: 3px;
  color: #fff;
  font-size: ${scaleFont(11)}px;
  font-weight: 800;
`;

const ExploreCafeInfoChip = styled.View`
  flex-direction: row;
  align-items: center;
  margin-right: 10px;
`;

const ExploreCafeInfoText = styled.Text`
  margin-left: 3px;
  color: ${T.color.inkSoft};
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;

const ExploreCafeFooter = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
`;

const Spacer = styled.View``;

const ExploreMenuLink = styled.View`
  flex-direction: row;
  align-items: center;
`;

const ExploreMenuLinkText = styled.Text`
  color: ${T.color.brand};
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const ExplorePrimaryText = styled.Text`
  color: ${T.color.brand};
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const MiniCard = styled.View`
  width: ${moderateScale(218)}px;
  margin-right: ${moderateScale(12)}px;
  border-width: 1px;
  border-color: ${T.color.line};
  border-radius: ${T.radius.lg}px;
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
  color: #777;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const MiniCardMeta = styled.Text`
  margin-top: ${moderateVerticalScale(3)}px;
  color: #7a7a7a;
  font-size: ${scaleFont(11)}px;
  font-weight: 600;
`;

const MiniCardAction = styled.View`margin-top: 10px; padding: 8px; background-color: ${T.color.brandSoft}; border-radius: ${T.radius.sm}px; align-items: center;`;
