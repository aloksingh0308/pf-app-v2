import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppContent } from '@/constants/appContent';
import { useAppLoader } from '@/hooks/useAppLoader';
import { rewardService, type UserRewardItem } from '@/services/rewardService';
import Ionicons from '@react-native-vector-icons/ionicons';
import { userService } from '@/services/userService';
import { DATABASE_MODE } from '@/config/database';
import Constants from 'expo-constants';
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useDispatch, useSelector } from "react-redux";
import styled from "styled-components/native";
import { showAlert, showErrorAlert } from "../../services/alertService";
import { authService } from "../../services/authService";
import { storageService } from "../../services/storageService";
import { AppDispatch, RootState } from "../../store";
import { logout } from "../../store/slices/authSlice";

const ProfileScreen = () => {
    const dispatch = useDispatch<AppDispatch>();
    const { user } = useSelector((state: RootState) => state.auth);
    const appLoader = useAppLoader();
    const [loggingOut, setLoggingOut] = useState(false);
    const [disablingAccount, setDisablingAccount] = useState(false);
    const [loadingRewards, setLoadingRewards] = useState(false);
    const [rewards, setRewards] = useState<UserRewardItem[]>([]);
    const appVersion = String(
        Constants.expoConfig?.version ||
        (Constants as any)?.manifest?.version ||
        (Constants as any)?.manifest2?.extra?.expoClient?.version ||
        '1.0.0'
    );

    useEffect(() => {
        let active = true;

        const loadRewards = async () => {
            if (!user?.uid) {
                if (active) setRewards([]);
                return;
            }

            try {
                if (active) setLoadingRewards(true);
                const rows = await rewardService.listUserRewards(user.uid);
                if (active) {
                    setRewards(rows);
                }
            } catch (error) {
                if (active) {
                    setRewards([]);
                }
            } finally {
                if (active) {
                    setLoadingRewards(false);
                }
            }
        };

        loadRewards();
        return () => {
            active = false;
        };
    }, [user?.uid]);

    const handleLogout = async () => {
        showAlert(
            'Logout',
            'Are you sure you want to logout?',
            [
                {
                    text: 'Cancel',
                    onPress: () => { },
                    style: 'cancel',
                },
                {
                    text: 'Logout',
                    onPress: async () => {
                        try {
                            setLoggingOut(true);
                            await authService.logoutUser();
                            // Clear local storage
                            await storageService.clearUserData();
                            dispatch(logout());
                            appLoader.show();
                            router.replace('/login');
                        } catch (error) {
                            showErrorAlert(error, 'Failed to logout. Please try again.', 'Error');
                            setLoggingOut(false);
                        }
                    },
                    style: 'destructive',
                },
            ]
        );
    };

    const handleDisableAccount = () => {
        if (!user) {
            showAlert('Error', 'User information not available');
            return;
        }

        showAlert(
            'Delete Account',
            'This will permanently delete your account. You will not be able to login again with this account. Continue?',
            [
                {
                    text: 'Cancel',
                    style: 'cancel',
                },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setDisablingAccount(true);
                            await userService.disableUserAccount(user.uid);
                            await authService.logoutUser();
                            await storageService.clearUserData();
                            dispatch(logout());
                            appLoader.show();
                            router.replace('/login');
                        } catch (error) {
                            showErrorAlert(error, 'Failed to delete account. Please try again.', 'Error');
                            setDisablingAccount(false);
                        }
                    },
                },
            ]
        );
    };

    if (!user) {
        return (
            <Container>
                <LoadingContainer>
                    <ActivityIndicator size="large" color="#f68712" />
                </LoadingContainer>
            </Container>
        );
    }

    const formatDisplayDate = (isoDate: string) => {
        if (!isoDate) return '';
        const date = new Date(isoDate);
        if (isNaN(date.getTime())) return isoDate;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    };

    return (
        <Container>
            <HeaderContainer>
                <BackButton onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={AppColors.textPrimary} />
                </BackButton>
                <Title>Your Profile</Title>
                <PlaceholderButton />
            </HeaderContainer>
            <ProfileContentContainer>
                <Animated.View entering={FadeInDown.delay(60).springify().damping(16)} style={{ alignItems: 'center' }}>
                    <ProfileImageContainer>
                        <ProfileImage source={{ uri: user.profileImage || AppContent.images.defaultProfile }} />
                    </ProfileImageContainer>
                    <NameText>{user.name}</NameText>
                    <EmailText>{user.email}</EmailText>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(130).springify().damping(16)} style={{ width: '100%' }}>
                    <AppButton
                        title="Edit Profile"
                        onPress={() => { appLoader.show(); router.push('/user/edit-profile' as never); }}
                        style={{ marginBottom: 20, minHeight: 48 }}
                    />
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(200).springify().damping(16)} style={{ width: '100%' }}>
                    <InfoCard>
                        <InfoRow>
                            <InfoLabel>Full Name</InfoLabel>
                            <InfoValue>{user.name}</InfoValue>
                        </InfoRow>
                        <InfoRow>
                            <InfoLabel>Email</InfoLabel>
                            <InfoValue>{user.email}</InfoValue>
                        </InfoRow>
                        {user.dateOfBirth ? (
                            <InfoRow>
                                <InfoLabel>Date of Birth</InfoLabel>
                                <InfoValue>{formatDisplayDate(user.dateOfBirth)}</InfoValue>
                            </InfoRow>
                        ) : null}
                        <InfoRow>
                            <InfoLabel>Phone Number</InfoLabel>
                            <InfoValue>{user.phoneNumber}</InfoValue>
                        </InfoRow>
                        {user.location && (
                            <InfoRow>
                                <InfoLabel>Location</InfoLabel>
                                <InfoValue>{user.location}</InfoValue>
                            </InfoRow>
                        )}
                        {user.address && (
                            <InfoRow>
                                <InfoLabel>Address</InfoLabel>
                                <InfoValue numberOfLines={2}>{user.address}</InfoValue>
                            </InfoRow>
                        )}
                        <InfoRow>
                            <InfoLabel>Member Since</InfoLabel>
                            <InfoValue>{new Date(user.createdAt).toLocaleDateString()}</InfoValue>
                        </InfoRow>
                        <InfoRow>
                            <InfoLabel>Wallet Balance</InfoLabel>
                            <InfoValue>₹{Number(user.walletBalance || 0).toFixed(2)}</InfoValue>
                        </InfoRow>
                        <LastInfoButtonRow onPress={() => router.push('/user/rewards' as never)} activeOpacity={0.8}>
                            <InfoLabel>Rewards</InfoLabel>
                            <InfoButtonValueWrap>
                                <InfoValue>{loadingRewards ? '...' : String(rewards.length)}</InfoValue>
                                <InfoChevron name="chevron-forward" size={18} color={AppColors.textSecondary} />
                            </InfoButtonValueWrap>
                        </LastInfoButtonRow>
                    </InfoCard>
                </Animated.View>

                <Animated.View entering={FadeInUp.delay(260).springify().damping(16)} style={{ width: '100%' }}>
                    <AppButton
                        title="Logout"
                        onPress={handleLogout}
                        disabled={loggingOut || disablingAccount}
                        loading={loggingOut}
                        backgroundColor="#ff4444"
                        style={{ marginTop: 60, minHeight: 50 }}
                    />

                    <AppButton
                        title="Delete Account"
                        onPress={handleDisableAccount}
                        disabled={loggingOut || disablingAccount}
                        loading={disablingAccount}
                        backgroundColor={AppColors.lightBorder}
                        textColor={AppColors.textPrimary}
                        style={{ marginTop: 12, marginBottom: 24, minHeight: 50 }}
                    />

                    <BuildMetaText>
                        Version {appVersion} • {DATABASE_MODE} mode
                    </BuildMetaText>
                </Animated.View>
            </ProfileContentContainer>
        </Container>
    );
};

export default ProfileScreen;

const Container = styled.SafeAreaView`
  flex: 1;
    align-items: center;
    background-color: ${AppColors.background};
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: bold;
    color: ${AppColors.textPrimary};
`;

const HeaderContainer = styled.View`
  width: 100%;
  padding: 16px;
    background-color: ${AppColors.background};
  border-bottom-width: 1px;
    border-bottom-color: ${AppColors.border};
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const PlaceholderButton = styled.View`
  width: 40px;
  height: 40px;
`;

const ProfileContentContainer = styled.ScrollView`
  flex: 1;
  width: 100%;
  padding: 20px;
`;

const InfoCard = styled.View`
    border-width: 1px;
    border-color: ${AppColors.border};
    border-radius: 12px;
    background-color: ${AppColors.white};
    padding: 0 14px;
`;

const ProfileImageContainer = styled.View`
  width: 120px;
  height: 120px;
  border-radius: 60px;
    background-color: ${AppColors.border};
  align-self: center;
  margin-bottom: 20px;
  border-width: 2px;
    border-color: ${AppColors.primary};
`;

const ProfileImage = styled.Image`
  width: 100%;
  height: 100%;
  border-radius: 60px;
`;

const NameText = styled.Text`
  font-size: 24px;
  font-weight: bold;
    color: ${AppColors.textPrimary};
  text-align: center;
  margin-bottom: 5px;
`;

const EmailText = styled.Text`
  font-size: 14px;
    color: ${AppColors.textSecondary};
  text-align: center;
  margin-bottom: 25px;
`;

const InfoRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
  align-items: center;
`;

const LastInfoRow = styled(InfoRow)`
    border-bottom-width: 0px;
`;

const LastInfoButtonRow = styled.TouchableOpacity`
    flex-direction: row;
    justify-content: space-between;
    padding: 16px 0;
    align-items: center;
`;

const InfoLabel = styled.Text`
  font-size: 14px;
    color: ${AppColors.textSecondary};
  font-weight: 500;
  flex: 1;
`;

const InfoValue = styled.Text`
  font-size: 14px;
    color: ${AppColors.textPrimary};
  font-weight: 600;
  flex: 1;
  text-align: right;
  margin-left: 10px;
`;

const InfoButtonValueWrap = styled.View`
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    flex: 1;
`;

const InfoChevron = styled(Ionicons)`
    margin-left: 4px;
`;

const BuildMetaText = styled.Text`
    text-align: center;
    font-size: 12px;
    color: ${AppColors.textSecondary};
    margin-bottom: 8px;
`;
