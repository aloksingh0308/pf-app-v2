import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import { AppContent } from '@/constants/appContent';
import { AppStrings } from '@/constants/appStrings';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { showErrorAlert } from '../../services/alertService';
import { RootState } from '../../store';

const APP_STORE_LINK = 'https://play.google.com/store/apps/details?id=com.alok0308.praygagifoodwala';

const STEPS: Array<{ icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }> = [
  { icon: 'share-social-outline', title: 'Share your code', body: 'Send your referral link or QR code to friends and family.' },
  { icon: 'person-add-outline', title: 'They sign up', body: 'Your friend enters your code while creating their account.' },
  { icon: 'wallet-outline', title: 'You earn', body: AppContent.referral.hint },
];

export default function ReferEarnScreen() {
  const insets = useSafeAreaInsets();
  const user = useSelector((state: RootState) => state.auth.user);
  const code = String(user?.referralCode || '').trim();
  const referralCount = Number(user?.referralCount || 0);
  const referralLink = code ? `${APP_STORE_LINK}&code=${encodeURIComponent(code)}` : APP_STORE_LINK;
  const [copied, setCopied] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const copyCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    try {
      const message = `${AppStrings.referral.shareTemplate.replace('{CODE}', code)}\n${referralLink}`;
      await Share.share({ message, url: referralLink });
    } catch (error) {
      showErrorAlert(error, 'Unable to open the share sheet right now.', 'Error');
    }
  };

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Refer & Earn" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="gift" size={36} color={Palette.primary} />
          </View>
          <Text style={styles.heroTitle}>Invite friends, earn together</Text>
          <Text style={styles.heroCopy}>{AppContent.referral.hint}</Text>

          <Text style={styles.codeLabel}>{AppStrings.referral.codeLabel.toUpperCase()}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={code ? `Copy referral code ${code}` : 'Referral code not available'}
            disabled={!code}
            onPress={() => void copyCode()}
            style={({ pressed }) => [styles.codeBox, pressed && { opacity: 0.85 }]}
          >
            <Text selectable style={styles.codeText}>{code || '— — —'}</Text>
            <View style={styles.copyPill}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={copied ? Palette.success : Palette.primary} />
              <Text style={[styles.copyText, copied && { color: Palette.success }]}>{copied ? 'Copied' : 'Copy'}</Text>
            </View>
          </Pressable>

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={!code} onPress={() => void shareLink()} style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }, !code && { opacity: 0.5 }]}>
              <Ionicons name="share-social" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Share link</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={!code} onPress={() => setQrVisible(true)} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }, !code && { opacity: 0.5 }]}>
              <Ionicons name="qr-code-outline" size={18} color={Palette.primary} />
              <Text style={styles.secondaryBtnText}>Show QR</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statIcon}><Ionicons name="people" size={20} color={Palette.success} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statValue}>{referralCount}</Text>
            <Text style={styles.statLabel}>{AppStrings.referral.countLabel}</Text>
          </View>
        </View>

        <SectionTitle>How it works</SectionTitle>
        <SectionCard>
          {STEPS.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
              <Ionicons name={step.icon} size={22} color={Palette.primary} />
            </View>
          ))}
        </SectionCard>
      </ScrollView>

      <Modal visible={qrVisible} transparent animationType="fade" onRequestClose={() => setQrVisible(false)}>
        <Pressable style={styles.modalShade} onPress={() => setQrVisible(false)} accessibilityLabel="Close QR code">
          <Pressable style={styles.qrCard} onPress={() => undefined}>
            <Text style={styles.qrTitle}>Scan to join</Text>
            <Text style={styles.qrSubtitle}>Your friend can scan this to download the app with your code.</Text>
            <View style={styles.qrFrame}>
              <QRCode value={referralLink} size={200} color="#1c1f26" />
            </View>
            <Text selectable style={styles.qrCode}>{code}</Text>
            <Pressable accessibilityRole="button" onPress={() => setQrVisible(false)} style={styles.qrClose}>
              <Text style={styles.secondaryBtnText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </PageScreen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  content: { padding: 16 },
  hero: { backgroundColor: '#fff', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e6ea' },
  heroIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: Palette.text, marginTop: 14, textAlign: 'center' },
  heroCopy: { fontSize: 13.5, lineHeight: 20, color: Palette.textSecondary, marginTop: 6, textAlign: 'center' },
  codeLabel: { marginTop: 20, fontSize: 11, fontWeight: '800', letterSpacing: 1, color: Palette.textMuted },
  codeBox: {
    marginTop: 8,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#f9b56b',
    backgroundColor: '#fffaf4',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  codeText: { fontSize: 22, fontWeight: '900', letterSpacing: 3, color: Palette.text },
  copyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  copyText: { fontSize: 13, fontWeight: '700', color: Palette.primary },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, alignSelf: 'stretch' },
  primaryBtn: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: Palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: Palette.primarySoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryBtnText: { color: Palette.primary, fontWeight: '800', fontSize: 14 },
  statCard: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e6e6ea' },
  statIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: Palette.successSoft, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: Palette.text },
  statLabel: { fontSize: 12.5, color: Palette.textSecondary, marginTop: 1 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: Palette.primary, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  stepTitle: { fontSize: 14.5, fontWeight: '700', color: Palette.text },
  stepBody: { fontSize: 12.5, lineHeight: 18, color: Palette.textSecondary, marginTop: 2 },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  qrCard: { width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 20, padding: 22, alignItems: 'center' },
  qrTitle: { fontSize: 18, fontWeight: '800', color: Palette.text },
  qrSubtitle: { fontSize: 12.5, color: Palette.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 18 },
  qrFrame: { marginTop: 18, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: Palette.hairline },
  qrCode: { marginTop: 12, fontSize: 16, fontWeight: '800', letterSpacing: 2, color: Palette.text },
  qrClose: { marginTop: 16, alignSelf: 'stretch', minHeight: 46, borderRadius: 12, backgroundColor: Palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
