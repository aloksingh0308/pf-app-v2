import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';

import ChangeLocationModal from '@/components/ChangeLocationModal';
import { track } from '@/services/analytics';
import { WEBSITE_ORIGIN } from '@/utils/deepLinks';
import { moderateScale, moderateVerticalScale, scaleFont } from '@/utils/responsive';

/** The restaurant sign-up page customers pass on to restaurants they like. */
export const PARTNER_PAGE_URL = `${WEBSITE_ORIGIN}/partner`;

/**
 * "No restaurants here yet" on Home — lets the customer try another location, or invite a
 * restaurant they love to join (shares the website's /partner page through the share sheet).
 */
export default function NoRestaurantsHere({ city }: { city: string }) {
  const [changeLocationVisible, setChangeLocationVisible] = useState(false);

  const invite = async () => {
    track('invite_restaurant', { city });
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
      <Ionicons name="restaurant-outline" size={34} color="#ff6b00" />
      <Text style={{ marginTop: moderateVerticalScale(10), fontSize: scaleFont(16), fontWeight: '700', color: '#3d2a1e', textAlign: 'center' }}>
        No restaurants {city ? `in ${city}` : 'near you'} yet
      </Text>
      <Text style={{ marginTop: moderateVerticalScale(4), fontSize: scaleFont(13), color: '#8a7769', textAlign: 'center' }}>
        Try another location, or invite your favourite restaurant to join Prayagi Foodwala.
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
          borderColor: '#ff6b00',
          backgroundColor: '#fff',
        }}
      >
        <Ionicons name="location-outline" size={18} color="#ff6b00" />
        <Text style={{ color: '#ff6b00', fontWeight: '700', fontSize: scaleFont(14) }}>Change location</Text>
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
          backgroundColor: '#ff6b00',
        }}
      >
        <Ionicons name="share-social-outline" size={18} color="#fff" />
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: scaleFont(14) }}>Invite your favourite restaurant</Text>
      </Pressable>

      <ChangeLocationModal visible={changeLocationVisible} onClose={() => setChangeLocationVisible(false)} />
    </View>
  );
}
