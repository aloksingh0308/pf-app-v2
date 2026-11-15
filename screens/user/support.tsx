import { ListRow, Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { showAlert } from '@/services/alertService';
import Ionicons from '@react-native-vector-icons/ionicons';
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

const SUPPORT_PHONE = '8957246131';
const SUPPORT_EMAIL = 'prayagraj.alok@gmail.com';

/** Opens the dialer / mail app; devices without one (tablets, emulators) get the raw value. */
const openLink = (url: string, fallback: string) => {
  Linking.openURL(url).catch(() => showAlert('Contact support', fallback));
};

export default function SupportScreen() {
  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Customer Support" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="headset-outline" size={28} color={Palette.primary} />
          </View>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroText}>
            Facing an issue with an order, a payment or your account? Reach our support team below.
          </Text>
        </View>

        <SectionTitle>Contact us</SectionTitle>
        <SectionCard>
          <ListRow
            icon="call-outline"
            title="Call support"
            subtitle={SUPPORT_PHONE}
            onPress={() => openLink(`tel:${SUPPORT_PHONE}`, SUPPORT_PHONE)}
          />
          <ListRow
            icon="mail-outline"
            title="Email support"
            subtitle={SUPPORT_EMAIL}
            onPress={() => openLink(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}
          />
        </SectionCard>
      </ScrollView>
    </PageScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  content: { padding: 16, paddingBottom: 40 },
  hero: {
    alignItems: 'center',
    backgroundColor: Palette.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Palette.hairline,
  },
  heroIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { marginTop: 12, fontSize: 18, fontWeight: '800', color: Palette.text },
  heroText: { marginTop: 6, fontSize: 14, lineHeight: 20, color: Palette.textSecondary, textAlign: 'center' },
});
