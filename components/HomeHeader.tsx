import { AppColors } from "@/constants/appColors";
import { AppContent } from "@/constants/appContent";
import { AppStrings } from "@/constants/appStrings";
import Ionicons from '@react-native-vector-icons/ionicons';
import { DEFAULT_LOCATION_MAX_AGE_MS, hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from "react-redux";
import styled from "styled-components/native";
import { AppDispatch, RootState } from "../store";
import { moderateScale, moderateVerticalScale, scaleFont } from "@/utils/responsive";
import ChangeLocationModal from './ChangeLocationModal';

const HomeHeader = () => {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const locationState = useSelector((state: RootState) => state.location);
  const [locationBootstrapDone, setLocationBootstrapDone] = useState(false);
  const [isChangeLocationVisible, setIsChangeLocationVisible] = useState(false);

  const currentLocation = useMemo(() => {
    const address = String(locationState.addressLine || '').trim();
    if (address) {
      return address;
    }

    // `Number(null)` coerces to `0`, which `Number.isFinite` happily accepts — without the
    // `!= null` guard, a location that was never resolved (redux still holding its `null`
    // initial state) would read as "coordinates present", and this text would never fall
    // through to the "unavailable" branch below even after the fetch definitively failed.
    const hasCoordinates = locationState.latitude != null && locationState.longitude != null
      && Number.isFinite(Number(locationState.latitude))
      && Number.isFinite(Number(locationState.longitude));
    if (hasCoordinates) {
      return AppStrings.home.loadingLocation;
    }

    return locationBootstrapDone
      ? AppStrings.home.locationUnavailable
      : AppStrings.home.loadingLocation;
  }, [locationState.addressLine, locationState.latitude, locationState.longitude, locationBootstrapDone]);

  useEffect(() => {
    let active = true;

    const loadCurrentLocation = async () => {
      try {
        const cachedOrFresh = await warmupUserLocationCache({
          dispatch,
          maxAgeMs: DEFAULT_LOCATION_MAX_AGE_MS,
        });

        if (cachedOrFresh) {
          await hydrateCachedLocationAddress({
            dispatch,
            maxAgeMs: DEFAULT_LOCATION_MAX_AGE_MS,
          });
        }
      } catch {
        // Derived UI below handles unavailable state.
      } finally {
        if (active) {
          setLocationBootstrapDone(true);
        }
      }
    };

    loadCurrentLocation();

    return () => {
      active = false;
    };
  }, [dispatch]);

    return (
        <HeaderContainer>
            <LeftSectionContainer>
                <LogoContainer disabled>
                    <LogoImage source={require('../assets/images/logo.png')} />
                </LogoContainer>
                <LocationContainer activeOpacity={0.7} onPress={() => setIsChangeLocationVisible(true)}>
                  <Ionicons name="location-sharp" size={moderateScale(16)} color={AppColors.primary} />
                  <LocationTextWrap>
                    <LocationLabel numberOfLines={1}>Delivering to</LocationLabel>
                    <HeaderTitle numberOfLines={1}>{currentLocation}</HeaderTitle>
                  </LocationTextWrap>
                  <Ionicons name="chevron-down" size={moderateScale(18)} color={AppColors.primary} />
                </LocationContainer>
            <ProfileImageContainer onPress={() => router.push('/user/profile' as never)}>
              <ProfileImage source={{ uri: user?.profileImage ?? AppContent.images.defaultProfile }} />
            </ProfileImageContainer>
            </LeftSectionContainer>
            <ChangeLocationModal visible={isChangeLocationVisible} onClose={() => setIsChangeLocationVisible(false)} />
        </HeaderContainer>
    );
}

export default HomeHeader;


const HeaderContainer = styled.View`
  flex-direction: row;
  padding: ${moderateVerticalScale(0)}px ${moderateScale(10)}px ${moderateVerticalScale(20)}px ${moderateScale(10)}px;

`;

const HeaderTitle = styled.Text`
  font-size: ${scaleFont(14)}px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const LocationLabel = styled.Text`
  font-size: ${scaleFont(11)}px;
  font-weight: 500;
  color: #8b8b8b;
`;

const LocationTextWrap = styled.View`
  flex: 1;
  margin-left: ${moderateScale(6)}px;
  padding-right: ${moderateScale(4)}px;
`;

const LocationContainer = styled.TouchableOpacity`
  flex: 1;
  margin: 0 ${moderateScale(10)}px;
  min-height: ${moderateVerticalScale(44)}px;
  border-radius: ${moderateScale(10)}px;
  padding: 0 ${moderateScale(10)}px;
  background-color: #f4f4f4;
  flex-direction: row;
  align-items: center;
`;

const LogoContainer = styled.TouchableOpacity`
  width: ${moderateScale(48)}px;
  height: ${moderateVerticalScale(48)}px;
  justify-content: center;
  align-items: center;
`;

const LeftSectionContainer = styled.View`
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
`;

const LogoImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const ProfileImageContainer = styled.TouchableOpacity`
  width: ${moderateScale(48)}px;
  height: ${moderateVerticalScale(48)}px;
  border-radius: ${moderateScale(24)}px;
  overflow: hidden;
  background-color: ${AppColors.primary};
`;

const ProfileImage = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: ${moderateScale(24)}px;
`;