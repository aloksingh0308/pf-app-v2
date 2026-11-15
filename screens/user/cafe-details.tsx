import { PRIMARY_BUTTON_STYLE } from '@/components/common/AppButton';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { RootState } from '@/store';
import { extractCoordinates, getDistanceInKm } from '@/utils/locationUtils';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { setActiveRestaurant, setPendingOffer } from '../../services/restaurantContext';
import type { OfferRecord } from '../../services/offersService';
import { formatOfferHeadline } from '../../services/offersService';
import { getRestaurantOpeningStatus, getRestaurantPublicInfo, to12Hour, type WeeklyHours } from '../../services/restaurantService';
import { T } from '@/constants/tokens';
import RestaurantPausedBanner from '@/components/RestaurantPausedBanner';

type Restaurant = {
  id: string;
  restaurantId?: string;
  cafeId?: string;
  orgSlug?: string;
  branchCode?: string;
  name?: string;
  cuisine?: string;
  address?: string;
  openingHours?: string;
  operatingHours?: WeeklyHours;
  fssai?: string;
  phone?: string;
  image?: string;
  coverImage?: string;
  desc?: string;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
  };
  coordinates?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
  };
  rating?: number;
  ratingCount?: number;
  tags?: string[];
  offer?: string;
};

const FALLBACK_CAFE_IMAGE = 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80';
const DEFAULT_ADDRESS = 'Address not available';
const DEFAULT_PHONE = '+911234567890';
const DEFAULT_OPENING_HOURS = '10:30 AM - 10:30 PM';
const WEEK_DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
] as const;

export default function CafeDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { restaurant, offer } = useLocalSearchParams();
  const userCoords = useSelector((state: RootState) => state.location);
  const [rating, setRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [fssai, setFssai] = useState('');
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours | null>(null);

  const parsedRestaurant = useMemo(() => {
    try {
      if (!restaurant) return null;
      const raw = Array.isArray(restaurant) ? restaurant[0] : restaurant;
      return JSON.parse(raw) as Restaurant;
    } catch {
      return null;
    }
  }, [restaurant]);

  // Present only when arriving from Home's "Offers Near You" carousel (see
  // app/home.tsx's `handleOfferPress`) — every other entry point into this screen has no
  // `offer` param, so this section simply doesn't render for them.
  const parsedOffer = useMemo(() => {
    try {
      if (!offer) return null;
      const raw = Array.isArray(offer) ? offer[0] : offer;
      return JSON.parse(raw) as OfferRecord;
    } catch {
      return null;
    }
  }, [offer]);

  useEffect(() => {
    setActiveRestaurant(parsedRestaurant);

    // Show the rating that came with the record immediately, then refresh it live — the
    // average of every dish rating this restaurant has received (in-app order reviews plus
    // imported dish reviews), so it's in sync however this screen was opened.
    setRating(Number(parsedRestaurant?.rating || 0));
    setRatingCount(Number(parsedRestaurant?.ratingCount || 0));
    setFssai(String(parsedRestaurant?.fssai || '').trim());
    setWeeklyHours(parsedRestaurant?.operatingHours || null);
    if (!parsedRestaurant?.orgSlug || !parsedRestaurant?.branchCode) return;
    let active = true;
    getRestaurantPublicInfo(parsedRestaurant.orgSlug, parsedRestaurant.branchCode)
      .then((live) => {
        if (!active) return;
        setRating(live.rating.average);
        setRatingCount(live.rating.count);
        if (live.fssai) setFssai(live.fssai);
        if (live.operatingHours) setWeeklyHours(live.operatingHours);
      })
      .catch((error) => console.warn('Failed to refresh restaurant details.', error));
    return () => {
      active = false;
    };
  }, [parsedRestaurant]);

  const cafeImage = parsedRestaurant?.coverImage || parsedRestaurant?.image || FALLBACK_CAFE_IMAGE;
  const cafeName = String(parsedRestaurant?.name || "Hungry's Bucket Cafe").trim() || "Hungry's Bucket Cafe";
  const cafeAddress = String(parsedRestaurant?.address || DEFAULT_ADDRESS).trim() || DEFAULT_ADDRESS;
  const cafePhone = String(parsedRestaurant?.phone || DEFAULT_PHONE).trim() || DEFAULT_PHONE;
  const cafeHours = String(parsedRestaurant?.openingHours || DEFAULT_OPENING_HOURS).trim() || DEFAULT_OPENING_HOURS;
  const todayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];
  const openNow = getRestaurantOpeningStatus(cafeHours).isOpen && weeklyHours?.[todayKey]?.isOpen !== false;
  const cafeCuisine = String(parsedRestaurant?.cuisine || 'Pure Veg Cafe').trim() || 'Pure Veg Cafe';
  const cafeDescription = String(parsedRestaurant?.desc || 'Serving fresh and flavorful meals made with quality ingredients, with quick service and a comfortable cafe experience.').trim();

  const deviceCoords = userCoords.latitude != null && userCoords.longitude != null
    && Number.isFinite(Number(userCoords.latitude)) && Number.isFinite(Number(userCoords.longitude))
    ? { latitude: Number(userCoords.latitude), longitude: Number(userCoords.longitude) }
    : null;
  const cafeCoords = extractCoordinates(parsedRestaurant || undefined);
  const distanceKm = deviceCoords && cafeCoords ? getDistanceInKm(deviceCoords, cafeCoords) : null;

  const openMenu = () => {
    if (!parsedRestaurant) return;
    if (parsedOffer) {
      setPendingOffer({ branchId: String(parsedRestaurant.id), couponCode: parsedOffer.couponCode });
    }
    router.push({
      pathname: '/user/restaurant-details',
      params: {
        restaurant: JSON.stringify(parsedRestaurant),
        categoryId: '0',
      },
    });
  };

  const callCafe = () => {
    const sanitized = cafePhone.replace(/\s+/g, '');
    if (!sanitized) return;
    void Linking.openURL(`tel:${sanitized}`);
  };

  const openDirections = () => {
    if (!cafeCoords) return;
    const label = encodeURIComponent(cafeName);
    const url = `https://www.google.com/maps/search/?api=1&query=${cafeCoords.latitude},${cafeCoords.longitude}&query_place_id=${label}`;
    void Linking.openURL(url);
  };

  if (!parsedRestaurant) {
    return (
      <Container>
        <PageHeader title="Cafe Details" />
      <RestaurantPausedBanner restaurantName={cafeName} />
        <EmptyWrap>
          <EmptyText>Unable to load cafe details.</EmptyText>
        </EmptyWrap>
      </Container>
    );
  }

  return (
    <Container>
      <PageHeader title="Cafe Details" />

      <ScrollView contentContainerStyle={{ paddingBottom: Math.max(20, insets.bottom + 16) }} showsVerticalScrollIndicator={false}>
        <HeroImage source={{ uri: cafeImage }} resizeMode="cover" />

        <Content>
          <CafeTitle>{cafeName}</CafeTitle>
          <CuisineTag>
            <Ionicons name="leaf-outline" size={14} color="#16a34a" />
            <CuisineText numberOfLines={1}>{cafeCuisine}</CuisineText>
          </CuisineTag>

          {parsedOffer ? (
            <OfferBanner>
              <OfferHeadline>{formatOfferHeadline(parsedOffer)}</OfferHeadline>
              {parsedOffer.description ? <OfferBannerDesc numberOfLines={2}>{parsedOffer.description}</OfferBannerDesc> : null}
              {parsedOffer.minOrderAmount > 0 ? (
                <OfferBannerLine>Minimum order ₹{parsedOffer.minOrderAmount}</OfferBannerLine>
              ) : null}
              <OfferCodeRow>
                <OfferCodeText>Use code {parsedOffer.couponCode}</OfferCodeText>
              </OfferCodeRow>
              <OfferBannerLine>Valid until {new Date(parsedOffer.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</OfferBannerLine>
            </OfferBanner>
          ) : null}

          <StatsRow>
            <StatCard>
              <Ionicons name="star" size={16} color="#f59e0b" />
              <StatValue>{ratingCount > 0 ? rating.toFixed(1) : 'NEW'}</StatValue>
              <StatLabel>{ratingCount > 0 ? `${ratingCount} ratings` : 'No ratings yet'}</StatLabel>
            </StatCard>
            <StatCard>
              <Ionicons name="navigate-outline" size={16} color="#f68712" />
              <StatValue>{distanceKm != null ? `${distanceKm.toFixed(1)} km` : '--'}</StatValue>
              <StatLabel>From your location</StatLabel>
            </StatCard>
          </StatsRow>

          <InfoCard>
            <InfoRow>
              <InfoIconWrap>
                <Ionicons name="location-outline" size={18} color="#f68712" />
              </InfoIconWrap>
              <InfoTextWrap>
                <InfoLabel>Address</InfoLabel>
                <InfoValue>{cafeAddress}</InfoValue>
              </InfoTextWrap>
            </InfoRow>

            <InfoDivider />

            <InfoRow>
              <InfoIconWrap>
                <Ionicons name="call-outline" size={18} color="#f68712" />
              </InfoIconWrap>
              <InfoTextWrap>
                <InfoLabel>Phone</InfoLabel>
                <InfoValue>{cafePhone}</InfoValue>
              </InfoTextWrap>
            </InfoRow>

            {fssai ? (
              <>
                <InfoDivider />
                <InfoRow>
                  <InfoIconWrap>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#f68712" />
                  </InfoIconWrap>
                  <InfoTextWrap>
                    <InfoLabel>FSSAI Licence No.</InfoLabel>
                    <InfoValue selectable>{fssai}</InfoValue>
                  </InfoTextWrap>
                </InfoRow>
              </>
            ) : null}
          </InfoCard>

          <InfoCard>
            <HoursHeader>
              <Ionicons name="time-outline" size={18} color="#f68712" />
              <HoursTitle>Opening hours</HoursTitle>
              <OpenPill $open={openNow}><OpenPillText $open={openNow}>{openNow ? 'Open now' : 'Closed now'}</OpenPillText></OpenPill>
            </HoursHeader>
            {weeklyHours ? WEEK_DAYS.map((day) => {
              const entry = weeklyHours[day.key];
              const isToday = day.key === todayKey;
              const isOpen = Boolean(entry?.isOpen && entry.open && entry.close);
              return (
                <HoursRow key={day.key} $today={isToday}>
                  <HoursDay $today={isToday}>{day.label}{isToday ? ' (Today)' : ''}</HoursDay>
                  <HoursTime $today={isToday} $closed={!isOpen}>{isOpen ? `${to12Hour(entry.open)} – ${to12Hour(entry.close)}` : 'Closed'}</HoursTime>
                </HoursRow>
              );
            }) : (
              <HoursRow $today>
                <HoursDay $today>Every day</HoursDay>
                <HoursTime $today $closed={false}>{cafeHours}</HoursTime>
              </HoursRow>
            )}
          </InfoCard>

          <SectionTitle>About Cafe</SectionTitle>
          <Description>{cafeDescription}</Description>

          <ActionRow>
            <SecondaryAction onPress={openDirections} disabled={!cafeCoords}>
              <Ionicons name="map-outline" size={16} color={cafeCoords ? '#f68712' : '#9ca3af'} />
              <SecondaryActionText $disabled={!cafeCoords}>Directions</SecondaryActionText>
            </SecondaryAction>
            <SecondaryAction onPress={callCafe}>
              <Ionicons name="call-outline" size={16} color="#f68712" />
              <SecondaryActionText>Call</SecondaryActionText>
            </SecondaryAction>
          </ActionRow>

          <PrimaryAction onPress={openMenu}>
            <PrimaryActionText>View Full Menu</PrimaryActionText>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </PrimaryAction>
        </Content>
      </ScrollView>
    </Container>
  );
}

const Container = styled(PageScreen)`
  flex: 1;
  background-color: #fff;
`;





const HeroImage = styled.Image`
  width: 100%;
  height: 220px;
  background-color: #f2f2f2;
`;

const Content = styled.View`
  padding: 14px;
`;

const CafeTitle = styled.Text`
  color: #171717;
  font-size: 24px;
  font-weight: 900;
`;

const CuisineTag = styled.View`
  margin-top: 8px;
  align-self: flex-start;
  padding: 7px 10px;
  border-radius: 999px;
  background-color: #ecfdf3;
  border-width: 1px;
  border-color: #d2f3df;
  flex-direction: row;
  align-items: center;
`;

const CuisineText = styled.Text`
  margin-left: 5px;
  color: #18794d;
  font-size: 12px;
  font-weight: 700;
`;

const OfferBanner = styled.View`
  margin-top: 14px;
  border-radius: 14px;
  background-color: #fff6ec;
  border-width: 1px;
  border-color: #ffd3a8;
  padding: 14px;
`;

const OfferHeadline = styled.Text`
  color: #f68712;
  font-size: 20px;
  font-weight: 900;
`;

const OfferBannerDesc = styled.Text`
  margin-top: 4px;
  color: #4a4a4a;
  font-size: 13px;
  line-height: 18px;
`;

const OfferBannerLine = styled.Text`
  margin-top: 6px;
  color: #696969;
  font-size: 12px;
  font-weight: 600;
`;

const OfferCodeRow = styled.View`
  margin-top: 8px;
  align-self: flex-start;
  border-radius: 8px;
  border-width: 1px;
  border-color: #f68712;
  padding: 6px 12px;
`;

const OfferCodeText = styled.Text`
  color: #f68712;
  font-size: 13px;
  font-weight: 800;
`;

const StatsRow = styled.View`
  flex-direction: row;
  margin-top: 14px;
  justify-content: space-between;
`;

const StatCard = styled.View`
  width: 48.5%;
  border-width: 1px;
  border-color: #f0f0f0;
  border-radius: 12px;
  padding: 12px;
  background-color: #fff;
`;

const StatValue = styled.Text`
  margin-top: 8px;
  color: #131313;
  font-size: 18px;
  font-weight: 900;
`;

const StatLabel = styled.Text`
  margin-top: 3px;
  color: #666;
  font-size: 12px;
  font-weight: 600;
`;

const InfoCard = styled.View`
  margin-top: 14px;
  border-width: 1px;
  border-color: #f0f0f0;
  border-radius: 12px;
  padding: 10px 12px;
  background-color: #fff;
`;

const InfoRow = styled.View`
  flex-direction: row;
  align-items: flex-start;
  padding: 10px 0;
`;

const InfoIconWrap = styled.View`
  width: 24px;
  align-items: center;
  margin-top: 1px;
`;

const InfoTextWrap = styled.View`
  flex: 1;
  margin-left: 8px;
`;

const InfoLabel = styled.Text`
  color: #696969;
  font-size: 12px;
  font-weight: 700;
`;

const InfoValue = styled.Text`
  margin-top: 3px;
  color: #191919;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
`;

const InfoDivider = styled.View`
  height: 1px;
  background-color: #f2f2f2;
`;

const HoursHeader = styled.View`
  flex-direction: row;
  align-items: center;
  padding-bottom: 8px;
`;

const HoursTitle = styled.Text`
  flex: 1;
  margin-left: 8px;
  color: ${T.color.ink};
  font-size: 15px;
  font-weight: 800;
`;

const OpenPill = styled.View<{ $open: boolean }>`
  padding: 3px 10px;
  border-radius: 999px;
  background-color: ${({ $open }: { $open: boolean }) => ($open ? T.color.successSoft : '#fef2f2')};
`;

const OpenPillText = styled.Text<{ $open: boolean }>`
  font-size: 11px;
  font-weight: 800;
  color: ${({ $open }: { $open: boolean }) => ($open ? T.color.success : T.color.danger)};
`;

const HoursRow = styled.View<{ $today?: boolean }>`
  flex-direction: row;
  justify-content: space-between;
  padding: 8px 10px;
  margin: 0 -10px;
  border-radius: 10px;
  background-color: ${({ $today }: { $today?: boolean }) => ($today ? T.color.brandSoft : 'transparent')};
`;

const HoursDay = styled.Text<{ $today?: boolean }>`
  color: ${({ $today }: { $today?: boolean }) => ($today ? T.color.ink : T.color.inkSoft)};
  font-size: 13px;
  font-weight: ${({ $today }: { $today?: boolean }) => ($today ? '800' : '500')};
`;

const HoursTime = styled.Text<{ $today?: boolean; $closed: boolean }>`
  color: ${({ $closed, $today }: { $closed: boolean; $today?: boolean }) => ($closed ? T.color.danger : $today ? T.color.ink : T.color.inkSoft)};
  font-size: 13px;
  font-weight: ${({ $today }: { $today?: boolean }) => ($today ? '800' : '600')};
`;

const SectionTitle = styled.Text`
  margin-top: 16px;
  color: #161616;
  font-size: 17px;
  font-weight: 800;
`;

const Description = styled.Text`
  margin-top: 7px;
  color: #4a4a4a;
  font-size: 14px;
  line-height: 22px;
`;

const ActionRow = styled.View`
  margin-top: 18px;
  flex-direction: row;
  justify-content: space-between;
`;

const SecondaryAction = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 48.5%;
  border-width: 1px;
  border-color: #ffdcb8;
  border-radius: 11px;
  background-color: #fff7ef;
  height: 44px;
  align-items: center;
  justify-content: center;
  flex-direction: row;
`;

const SecondaryActionText = styled.Text<{ $disabled?: boolean }>`
  margin-left: 6px;
  color: ${({ $disabled }: { $disabled?: boolean }) => ($disabled ? T.color.faint : T.color.brand)};
  font-size: 13px;
  font-weight: 800;
`;

const PrimaryAction = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  margin-top: 12px;
  min-height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
  background-color: ${PRIMARY_BUTTON_STYLE.backgroundColor};
  align-items: center;
  justify-content: center;
  flex-direction: row;
`;

const PrimaryActionText = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  margin-right: 6px;
`;

const EmptyWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 20px;
`;

const EmptyText = styled.Text`
  color: #787878;
  font-size: 15px;
  font-weight: 600;
`;
