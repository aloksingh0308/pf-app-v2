import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSelector } from 'react-redux';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import { Palette, SectionCard, SectionTitle } from '@/components/common/ListSection';
import { T } from '@/constants/tokens';
import { showErrorAlert } from '@/services/alertService';
import { engagementService, savePushToken } from '@/services/engagementService';
import { notificationPreferenceService, NotificationPreferences, PromoCategory } from '@/services/notificationPreferenceService';
import { notificationService, OsPermissionState } from '@/services/notificationService';
import { RootState } from '@/store';

const CATEGORIES: { key: PromoCategory; icon: 'heart-outline' | 'sparkles-outline' | 'repeat-outline' | 'pricetag-outline'; title: string; subtitle: string }[] = [
  { key: 'favouriteRestaurants', icon: 'heart-outline', title: 'Favourite restaurant updates', subtitle: 'News and new dishes from places you love' },
  { key: 'recommendations', icon: 'sparkles-outline', title: 'Food recommendations', subtitle: 'Dishes and restaurants you might like' },
  { key: 'repeatOrderReminders', icon: 'repeat-outline', title: 'Order reminders', subtitle: 'Your usual order time, and items left in your cart' },
  { key: 'offers', icon: 'pricetag-outline', title: 'Offers and promotions', subtitle: 'Deals, coupons and limited-time offers' },
];

/** Profile → Notification preferences. Order updates are always on (transactional); each
 *  promotional category is switched separately. Also shows the phone's own permission. */
export default function NotificationPreferencesScreen() {
  const user = useSelector((state: RootState) => state.auth.user);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState<PromoCategory | 'all' | null>(null);
  const [os, setOs] = useState<OsPermissionState | null>(null);
  const [enabling, setEnabling] = useState(false);

  const readOs = useCallback(() => {
    void notificationService.getPermissionState().then(setOs);
  }, []);
  useFocusEffect(readOs);
  useEffect(() => {
    // Back from device settings → show the new state straight away.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && readOs());
    return () => sub.remove();
  }, [readOs]);

  useEffect(() => {
    let active = true;
    notificationPreferenceService
      .get()
      .then((p) => active && setPrefs(p))
      .catch((error) => {
        if (active) showErrorAlert(error, 'Could not load your notification settings.', 'Error');
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (key: PromoCategory | 'all', next: boolean) => {
    if (!prefs || saving) return;
    setSaving(key);
    try {
      setPrefs(key === 'all' ? await notificationPreferenceService.setPromotional(next) : await notificationPreferenceService.setCategory(key, next));
    } catch (error) {
      showErrorAlert(error, 'Could not update notification settings. Please try again.', 'Error');
    } finally {
      setSaving(null);
    }
  };

  /** An explicit tap here may open the OS dialog (or device settings if it won't show). */
  const turnOn = async () => {
    if (!os || enabling) return;
    setEnabling(true);
    try {
      if (os.osStatus === 'denied' && os.canAskAgain === false) {
        void engagementService.permissionEvent('notification_settings_opened');
        await notificationService.openSystemSettings();
        return;
      }
      const result = await notificationService.requestPermissionFromUser();
      void engagementService.permissionEvent(result.granted ? 'os_permission_granted' : 'os_permission_denied');
      void engagementService.reportPermission({ osStatus: result.granted ? 'granted' : 'denied', canAskAgain: result.canAskAgain }).catch(() => {});
      if (result.granted && user?.uid) await savePushToken(user.uid, result.token, { pushToken: user.pushToken, pushTokenType: user.pushTokenType }).catch(() => {});
      readOs();
    } finally {
      setEnabling(false);
    }
  };

  const allowed = os?.osStatus === 'granted';

  return (
    <PageScreen style={styles.page}>
      <PageHeader title="Notification preferences" />
      <ScrollView contentContainerStyle={styles.content}>
        {os && !allowed && (
          <View style={styles.banner}>
            <Ionicons name="notifications-off-outline" size={22} color={T.color.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Notifications are off on this phone</Text>
              <Text style={styles.bannerText}>You won&apos;t get order updates or anything below until you turn them on.</Text>
            </View>
            <Pressable onPress={turnOn} disabled={enabling} style={styles.bannerButton}>
              {enabling ? <ActivityIndicator color={T.color.surface} size="small" /> : <Text style={styles.bannerButtonText}>{os.osStatus === 'denied' && os.canAskAgain === false ? 'Settings' : 'Turn on'}</Text>}
            </Pressable>
          </View>
        )}

        <SectionTitle>Order updates</SectionTitle>
        <SectionCard>
          <Row icon="receipt-outline" title="Order updates" subtitle="Confirmation, preparation and delivery status" value locked />
        </SectionCard>

        <SectionTitle>Promotional</SectionTitle>
        <SectionCard>
          {!prefs ? (
            <ActivityIndicator style={{ padding: 20 }} color={T.color.brand} />
          ) : prefs.categories ? (
            CATEGORIES.map((c) => (
              <Row key={c.key} icon={c.icon} title={c.title} subtitle={c.subtitle} value={prefs.categories![c.key]} busy={saving === c.key} onChange={(v) => toggle(c.key, v)} />
            ))
          ) : (
            <Row icon="pricetag-outline" title="Offers & order reminders" subtitle="Deals and a nudge when it's time to reorder" value={prefs.promotional} busy={saving === 'all'} onChange={(v) => toggle('all', v)} />
          )}
        </SectionCard>
        <Text style={styles.note}>Turning promotional notifications off never stops updates about your orders.</Text>
      </ScrollView>
    </PageScreen>
  );
}

function Row({
  icon,
  title,
  subtitle,
  value,
  onChange,
  busy,
  locked,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  busy?: boolean;
  locked?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBubble}>
        <Ionicons name={icon} size={19} color={Palette.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{locked ? `${subtitle} · Always on` : subtitle}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={T.color.brand} />
      ) : (
        <Switch value={value} onValueChange={onChange} disabled={locked} trackColor={{ true: T.color.brand, false: T.color.line }} thumbColor={T.color.surface} accessibilityLabel={title} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Palette.page },
  content: { padding: 16, paddingBottom: 32 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.color.brandSoft, borderColor: T.color.brandBorder, borderWidth: 1, borderRadius: T.radius.lg, padding: 14, marginBottom: 8 },
  bannerTitle: { fontSize: T.font.body, fontWeight: '700', color: T.color.ink },
  bannerText: { fontSize: T.font.small, color: T.color.inkSoft, marginTop: 2 },
  bannerButton: { backgroundColor: T.color.brand, borderRadius: T.radius.pill, paddingHorizontal: 14, paddingVertical: 8, minWidth: 76, alignItems: 'center' },
  bannerButtonText: { color: T.color.surface, fontWeight: '700', fontSize: T.font.small },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  iconBubble: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.primarySoft },
  rowTitle: { fontSize: 15, fontWeight: '600', color: T.color.ink },
  rowSubtitle: { fontSize: T.font.small, color: T.color.muted, marginTop: 2 },
  note: { marginTop: 12, fontSize: T.font.small, color: T.color.muted, textAlign: 'center' },
});
