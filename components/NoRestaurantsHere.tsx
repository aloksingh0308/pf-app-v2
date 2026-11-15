import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { useSelector } from 'react-redux';

import ChangeLocationModal from '@/components/ChangeLocationModal';
import { track } from '@/services/analytics';
import { formatRupees, restaurantReferralService } from '@/services/restaurantReferralService';
import { RootState } from '@/store';
import { WEBSITE_ORIGIN } from '@/utils/deepLinks';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';
import { T } from '@/constants/tokens';

/** The restaurant sign-up page customers pass on to restaurants they like. */
export const PARTNER_PAGE_URL = `${WEBSITE_ORIGIN}/partner`;

/**
 * "No restaurants here yet" on Home — lets the customer try another location, or refer a
 * restaurant they love and earn the restaurant-referral reward (screens/user/refer-restaurant).
 * Signed out (or with the programme off), it just shares the website's /partner page.
 */
export default function NoRestaurantsHere({ city }: { city: string }) {
  const [changeLocationVisible, setChangeLocationVisible] = useState(false);
  const signedIn = useSelector((state: RootState) => Boolean(state.auth.user));
  const [reward, setReward] = useState<number | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    restaurantReferralService
      .getSummary()
      .then((s) => active && setReward(s.enabled && s.reward > 0 ? s.reward : null))
      .catch(() => active && setReward(null));
    return () => {
      active = false;
    };
  }, [signedIn]);

  const invite = async () => {
    track('invite_restaurant', { city, referral: reward !== null });
    if (reward !== null) {
      router.push('/user/refer-restaurant' as never);
      return;
    }
    try {
      await Share.share({
        title: 'Join Prayagi Foodwala',
        message: `Hey! I'd love to order from you on Prayagi Foodwala. Join as a restaurant partner here: ${PARTNER_PAGE_URL}`,
      });
    } catch {
      // Share sheet unavailable or dismissed — nothing to do.
    }
  };

  return (
    <View
      style={{
        marginTop: moderateVerticalScale(20),
        marginBottom: moderateVerticalScale(10),
        paddingVertical: moderateVerticalScale(22),
        paddingHorizontal: moderateScale(18),
        borderRadius: moderateScale(16),
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#ffd2ad',
        backgroundColor: '#fff8f2',
        alignItems: 'center',
      }}
    >
      <Ionicons name="restaurant-outline" size={34} color={T.color.brand} />
      <Text style={{ marginTop: moderateVerticalScale(10), fontSize: scaleFont(16), fontWeight: '700', color: '#3d2a1e', textAlign: 'center' }}>
        No restaurants {city ? `in ${city}` : 'near you'} yet
      </Text>
      <Text style={{ marginTop: moderateVerticalScale(4), fontSize: scaleFont(13), color: '#8a7769', textAlign: 'center' }}>
        {reward !== null
          ? `Try another location, or refer your favourite restaurant — get ${formatRupees(reward)} in your wallet when it joins and starts taking orders.`
          : 'Try another location, or invite your favourite restaurant to join Prayagi Foodwala.'}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => setChangeLocationVisible(true)}
        style={{
          marginTop: moderateVerticalScale(16),
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: moderateVerticalScale(11),
          borderRadius: moderateScale(12),
          borderWidth: 1.5,
          borderColor: T.color.brand,
          backgroundColor: '#fff',
        }}
      >
        <Ionicons name="location-outline" size={18} color={T.color.brand} />
        <Text style={{ color: T.color.brand, fontWeight: '700', fontSize: scaleFont(14) }}>Change location</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={invite}
        style={{
          marginTop: moderateVerticalScale(10),
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          paddingVertical: moderateVerticalScale(12),
          borderRadius: moderateScale(12),
          backgroundColor: T.color.brand,
        }}
      >
        <Ionicons name={reward !== null ? 'gift-outline' : 'share-social-outline'} size={18} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: scaleFont(14) }}>
          {reward !== null ? `Refer a restaurant · get ${formatRupees(reward)}` : 'Invite your favourite restaurant'}
        </Text>
      </Pressable>

      <ChangeLocationModal visible={changeLocationVisible} onClose={() => setChangeLocationVisible(false)} />
    </View>
  );
}
