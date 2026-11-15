import { formatDob } from '@/utils/dateOfBirth';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { ListRow, Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import { AppContent } from '@/constants/appContent';
import { useAppLoader } from '@/hooks/useAppLoader';
import { rewardService, type UserRewardItem } from '@/services/rewardService';
import Ionicons from '@react-native-vector-icons/ionicons';
import { userService } from '@/services/userService';
import Constants from 'expo-constants';
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDispatch, useSelector } from "react-redux";
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
            <PageScreen style={styles.page}>
                <View style={styles.loading}>
                    <ActivityIndicator size="large" color={Palette.primary} />
                </View>
            </PageScreen>
        );
    }

    const formatDisplayDate = (isoDate: string) => {
        if (!isoDate) return '';
        const date = new Date(isoDate);
        if (isNaN(date.getTime())) return isoDate;
        return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const memberSince = formatDisplayDate(String(user.createdAt || ''));
    const busy = loggingOut || disablingAccount;
    const activeRewards = rewards.filter((reward) => reward.isActive && !reward.status?.toUpperCase().includes('USED')).length;

    return (
        <PageScreen style={styles.page}>
            <PageHeader title="Your Profile" />
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <Animated.View entering={FadeInDown.delay(60).springify().damping(16)} style={styles.headerCard}>
                    <Image source={{ uri: user.profileImage || AppContent.images.defaultProfile }} style={styles.avatar} />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{user.name || 'Your name'}</Text>
                        {user.phoneNumber ? <Text style={styles.meta} numberOfLines={1}>{user.phoneNumber}</Text> : null}
                        {user.email ? <Text style={styles.meta} numberOfLines={1}>{user.email}</Text> : null}
                    </View>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Edit profile"
                        onPress={() => { appLoader.show(); router.push('/user/edit-profile' as never); }}
                        style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.8 }]}
                    >
                        <Ionicons name="create-outline" size={16} color={Palette.primary} />
                        <Text style={styles.editText}>Edit</Text>
                    </Pressable>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(120).springify().damping(16)} style={styles.statsRow}>
                    <Pressable accessibilityRole="button" style={styles.stat} onPress={() => router.push('/user/wallet-history' as never)}>
                        <Text style={styles.statValue}>₹{Number(user.walletBalance || 0).toFixed(0)}</Text>
                        <Text style={styles.statLabel}>Wallet</Text>
                    </Pressable>
                    <View style={styles.statDivider} />
                    <Pressable accessibilityRole="button" style={styles.stat} onPress={() => router.push('/user/wallet-history' as never)}>
                        <Text style={styles.statValue}>{Number(user.earnedCoin || 0)}</Text>
                        <Text style={styles.statLabel}>Coins</Text>
                    </Pressable>
                    <View style={styles.statDivider} />
                    <Pressable accessibilityRole="button" style={styles.stat} onPress={() => router.push('/user/rewards' as never)}>
                        <Text style={styles.statValue}>{loadingRewards ? '…' : String(activeRewards)}</Text>
                        <Text style={styles.statLabel}>Rewards</Text>
                    </Pressable>
                </Animated.View>

                {/* Fade as one layer: on Android the elevated SectionCards inside otherwise draw
                    their shadows as dark boxes while the opacity animates. */}
                <Animated.View entering={FadeInDown.delay(180).springify().damping(16)} needsOffscreenAlphaCompositing>
                    <SectionTitle>Personal details</SectionTitle>
                    <SectionCard>
                        <ListRow icon="person-outline" title="Full name" subtitle={user.name || 'Not added'} />
                        <ListRow icon="call-outline" title="Phone number" subtitle={user.phoneNumber || 'Not added'} />
                        <ListRow icon="mail-outline" title="Email" subtitle={user.email || 'Not added'} />
                        {user.dateOfBirth ? <ListRow icon="calendar-outline" title="Date of birth" subtitle={formatDob(user.dateOfBirth)} /> : null}
                        {user.address || user.location ? <ListRow icon="location-outline" title="Address" subtitle={String(user.address || user.location)} /> : null}
                        {memberSince ? <ListRow icon="ribbon-outline" title="Member since" subtitle={memberSince} /> : null}
                    </SectionCard>

                    <SectionTitle>Saved</SectionTitle>
                    <SectionCard>
                        <ListRow icon="heart-outline" title="My favourites" subtitle="Restaurants and dishes you've saved" onPress={() => router.push('/user/favorites' as never)} />
                    </SectionCard>

                    <SectionTitle>Wallet & rewards</SectionTitle>
                    <SectionCard>
                        <ListRow icon="wallet-outline" title="Wallet history" value={`₹${Number(user.walletBalance || 0).toFixed(2)}`} onPress={() => router.push('/user/wallet-history' as never)} />
                        <ListRow icon="ticket-outline" title="My rewards" value={loadingRewards ? undefined : `${rewards.length}`} loading={loadingRewards} onPress={() => router.push('/user/rewards' as never)} />
                        <ListRow icon="gift-outline" title="Refer & earn" subtitle={user.referralCode ? `Code: ${user.referralCode}` : undefined} onPress={() => router.push('/user/refer-earn' as never)} />
                        <ListRow icon="storefront-outline" title="Refer a restaurant" subtitle="Get ₹1,000 in your wallet when they join" onPress={() => router.push('/user/refer-restaurant' as never)} />
                    </SectionCard>

                    <SectionTitle>Notifications</SectionTitle>
                    <SectionCard>
                        <ListRow
                            icon="notifications-outline"
                            title="Notification preferences"
                            subtitle="Order updates, offers and reminders"
                            onPress={() => router.push('/user/notification-preferences' as never)}
                        />
                    </SectionCard>

                    <SectionTitle>Account</SectionTitle>
                    <SectionCard>
                        <ListRow icon="log-out-outline" title="Logout" onPress={handleLogout} loading={loggingOut} disabled={busy} showChevron={false} />
                        <ListRow icon="trash-outline" title="Delete account" subtitle="Permanently remove your account" destructive onPress={handleDisableAccount} loading={disablingAccount} disabled={busy} showChevron={false} />
                    </SectionCard>

                    <Text style={styles.version}>Version {appVersion}</Text>
                </Animated.View>
            </ScrollView>
        </PageScreen>
    );
};

export default ProfileScreen;

const styles = StyleSheet.create({
    page: { flex: 1, backgroundColor: Palette.page },
    loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { padding: 16, paddingBottom: 40 },
    headerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Palette.hairline,
    },
    avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: Palette.hairline, borderWidth: 2, borderColor: Palette.primary },
    name: { fontSize: 19, fontWeight: '800', color: Palette.text },
    meta: { fontSize: 13, color: Palette.textSecondary, marginTop: 2 },
    editButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.primarySoft, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
    editText: { color: Palette.primary, fontWeight: '800', fontSize: 13 },
    statsRow: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 16,
        paddingVertical: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: Palette.hairline,
    },
    stat: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 18, fontWeight: '800', color: Palette.primary },
    statLabel: { fontSize: 12, color: Palette.textSecondary, marginTop: 2 },
    statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: Palette.hairline },
    version: { textAlign: 'center', fontSize: 12, color: Palette.textMuted, marginTop: 28 },
});
