import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { ListRow, Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import { AppContent } from '@/constants/appContent';
import { AppStrings } from '@/constants/appStrings';
import Ionicons from '@react-native-vector-icons/ionicons';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';

export default function MoreScreen() {
  const user = useSelector((state: RootState) => state.auth.user);
  const appVersion = String(Constants.expoConfig?.version || '1.0.0');
  const walletBalance = Number(user?.walletBalance || 0);
  const coins = Number(user?.earnedCoin || 0);
  const go = (path: string) => router.push(path as never);

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="More" showBack={false} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refer and earn, invite friends"
          onPress={() => go('/user/refer-earn')}
          style={({ pressed }) => [styles.referCard, pressed && { opacity: 0.92 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.referKicker}>REFER & EARN</Text>
            <Text style={styles.referTitle}>Invite friends, earn wallet cash</Text>
            <Text style={styles.referCopy}>{AppContent.referral.hint}</Text>
            <View style={styles.referCta}>
              <Text style={styles.referCtaText}>Invite now</Text>
              <Ionicons name="arrow-forward" size={16} color={Palette.primary} />
            </View>
          </View>
          <View style={styles.referIcon}>
            <Ionicons name="gift" size={40} color="#fff" />
          </View>
        </Pressable>

        <SectionTitle>Wallet & Rewards</SectionTitle>
        <SectionCard>
          <ListRow
            icon="wallet-outline"
            title={AppStrings.common.walletHistory}
            subtitle={`${coins} reward ${coins === 1 ? 'coin' : 'coins'}`}
            value={`₹${walletBalance.toFixed(2)}`}
            onPress={() => go('/user/wallet-history')}
          />
          <ListRow icon="ticket-outline" title="My Rewards" subtitle="Scratch cards and coupon wins" onPress={() => go('/user/rewards')} />
          <ListRow
            icon="people-outline"
            title="Refer & Earn"
            subtitle={user?.referralCode ? `Your code: ${user.referralCode}` : 'Share your code with friends'}
            value={Number(user?.referralCount || 0) > 0 ? `${Number(user?.referralCount || 0)} joined` : undefined}
            onPress={() => go('/user/refer-earn')}
          />
        </SectionCard>

        <SectionTitle>Celebrations & Fun</SectionTitle>
        <SectionCard>
          <ListRow icon="balloon-outline" title="Customise Your Party" subtitle="Party menus and decoration packages" onPress={() => go('/user/party-booking')} />
          <ListRow icon="game-controller-outline" title="Tic Tac Toe" subtitle="Play a quick game" onPress={() => go('/user/tic-tac-toe')} />
        </SectionCard>

        <SectionTitle>{AppStrings.common.legalSupport}</SectionTitle>
        <SectionCard>
          <ListRow icon="headset-outline" title={AppStrings.common.customerSupport} onPress={() => go('/user/support')} />
          <ListRow icon="document-text-outline" title={AppStrings.common.terms} onPress={() => go('/user/terms-and-conditions')} />
          <ListRow icon="shield-checkmark-outline" title={AppStrings.common.privacy} onPress={() => go('/user/privacy-policy')} />
        </SectionCard>

        <Text style={styles.version}>Version {appVersion}</Text>
      </ScrollView>
    </PageScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  content: { padding: 16, paddingBottom: 40 },
  referCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Palette.primary,
    borderRadius: 20,
    padding: 18,
    overflow: 'hidden',
  },
  referKicker: { color: '#ffe3c4', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  referTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 4, lineHeight: 23 },
  referCopy: { color: '#fff4e8', fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  referCta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 14, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  referCtaText: { color: Palette.primary, fontWeight: '800', fontSize: 13 },
  referIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  version: { textAlign: 'center', color: Palette.textMuted, fontSize: 12, marginTop: 28 },
});
