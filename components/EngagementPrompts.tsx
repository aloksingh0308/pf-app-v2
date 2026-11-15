import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import AppImage from '@/components/AppImage';
import { PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_TEXT_STYLE } from '@/components/common/AppButton';
import { T } from '@/constants/tokens';
import { showErrorAlert } from '@/services/alertService';
import { engagementService, PermissionEducation, RatingPrompt, savePushToken } from '@/services/engagementService';
import { notificationService } from '@/services/notificationService';
import { RootState } from '@/store';

/**
 * Home-screen engagement popups (backend services/customerEngagement):
 *  - "How was your food experience?" — once per delivered order. Submit or an explicit
 *    close/"Maybe later"/back = done for good (server-side). Leaving the app without
 *    answering keeps it for a later visit.
 *  - "Never miss an important food update!" — the app's own explanation, shown after the
 *    first delivery; only its "Enable notifications" button opens the OS dialog.
 * At most ONE popup per app session (rating wins), never while Home has another modal up.
 */
const REVEAL_DELAY_MS = 3500; // after the announcement sheet's 2 s slot
const RECHECK_MS = 60 * 1000;

// Module-level = per app process (one "session").
let shownThisSession = false;
let lastCheckAt = 0;

type Props = { blocked: boolean };

export default function EngagementPrompts({ blocked }: Props) {
  const user = useSelector((state: RootState) => state.auth.user);
  const [rating, setRating] = useState<RatingPrompt | null>(null);
  const [education, setEducation] = useState<Extract<PermissionEducation, { eligible: true }> | null>(null);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.uid || shownThisSession) return;
      let cancelled = false;
      const timer = setTimeout(async () => {
        if (cancelled || shownThisSession || blockedRef.current || Date.now() - lastCheckAt < RECHECK_MS) return;
        lastCheckAt = Date.now();
        try {
          const state = await notificationService.getPermissionState();
          const result = await engagementService.home(state);
          // Re-check: the customer may have opened something (or left Home) meanwhile.
          if (cancelled || shownThisSession || blockedRef.current) return;
          if (result.ratingPrompt) {
            shownThisSession = true;
            setRating(result.ratingPrompt);
            void engagementService.ratingShown(result.ratingPrompt.requestId);
          } else if (result.permissionEducation.eligible) {
            shownThisSession = true;
            setEducation(result.permissionEducation);
            void engagementService.permissionEvent('permission_education_viewed');
          }
        } catch (error) {
          console.log('Engagement check failed:', error);
        }
      }, REVEAL_DELAY_MS);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [user?.uid])
  );

  return (
    <>
      {rating && <RatingSheet prompt={rating} onDone={() => setRating(null)} />}
      {education && (
        <PermissionEducationSheet
          mode={education.mode}
          onDone={() => setEducation(null)}
          uid={user?.uid ?? ''}
          known={{ pushToken: user?.pushToken, pushTokenType: user?.pushTokenType }}
        />
      )}
    </>
  );
}

/* ───────────────────────── Rating ───────────────────────── */

const STAR_LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Loved it!'];

function RatingSheet({ prompt, onDone }: { prompt: RatingPrompt; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [thanks, onDone]);

  /** Explicit close / "Maybe later" / Android back — permanent for this order. */
  const dismiss = () => {
    if (closingRef.current || submitting) return;
    closingRef.current = true;
    if (thanks) return onDone();
    void engagementService.ratingDismiss(prompt.requestId).catch((error) => console.log('rating dismiss failed:', error));
    onDone();
  };

  const submit = async () => {
    if (!stars || submitting) return;
    setSubmitting(true);
    try {
      await engagementService.ratingSubmit(prompt.requestId, stars, review);
      closingRef.current = true;
      setThanks(true);
    } catch (error) {
      showErrorAlert(error, 'Could not save your rating. Please try again.', 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  const itemLine = prompt.items
    .slice(0, 3)
    .map((i) => `${i.quantity} × ${i.name}`)
    .join(', ') + (prompt.items.length > 3 ? ` +${prompt.items.length - 3} more` : '');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss} statusBarTranslucent>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
          {thanks ? (
            <View style={s.thanks}>
              <View style={s.thanksIcon}>
                <Ionicons name="checkmark" size={34} color={T.color.surface} />
              </View>
              <Text style={s.title}>Thank you!</Text>
              <Text style={s.body}>Your rating helps {prompt.restaurant.name} and other food lovers.</Text>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Pressable onPress={dismiss} hitSlop={12} style={s.close} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={T.color.muted} />
              </Pressable>
              <View style={s.restaurantRow}>
                <AppImage uri={prompt.restaurant.logoUrl || undefined} style={s.logo} />
                <View style={{ flex: 1 }}>
                  <Text style={s.restaurantName} numberOfLines={1}>{prompt.restaurant.name}</Text>
                  {itemLine ? <Text style={s.items} numberOfLines={2}>{itemLine}</Text> : null}
                </View>
              </View>
              <Text style={s.title}>How was your food experience?</Text>
              <Text style={s.body}>Your order has been delivered! Share your experience and help us improve Prayagi Foodwala.</Text>

              <View style={s.stars} accessibilityRole="adjustable" accessibilityLabel={`Rating ${stars} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                    <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={40} color={n <= stars ? T.color.star : T.color.faint} />
                  </Pressable>
                ))}
              </View>
              <Text style={s.starLabel}>{stars ? STAR_LABELS[stars] : 'Tap a star to rate'}</Text>

              {stars > 0 && (
                <TextInput
                  value={review}
                  onChangeText={setReview}
                  placeholder={stars <= 2 ? 'What went wrong? (optional)' : 'Tell us what you liked (optional)'}
                  placeholderTextColor={T.color.faint}
                  multiline
                  maxLength={1000}
                  style={s.input}
                />
              )}

              <Pressable onPress={submit} disabled={!stars || submitting} style={[PRIMARY_BUTTON_STYLE, s.cta, (!stars || submitting) && s.disabled]}>
                {submitting ? <ActivityIndicator color={T.color.surface} /> : <Text style={PRIMARY_BUTTON_TEXT_STYLE}>Submit Rating</Text>}
              </Pressable>
              <Pressable onPress={dismiss} style={s.secondary} hitSlop={6}>
                <Text style={s.secondaryText}>Maybe Later</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ───────────────────── Permission education ───────────────────── */

const BENEFITS: { icon: 'receipt-outline' | 'bicycle-outline' | 'heart-outline' | 'restaurant-outline'; text: string }[] = [
  { icon: 'receipt-outline', text: 'Order confirmation and status updates' },
  { icon: 'bicycle-outline', text: 'Preparation and delivery updates' },
  { icon: 'heart-outline', text: 'Updates from your favourite restaurants' },
  { icon: 'restaurant-outline', text: 'Relevant food recommendations and reminders' },
];

function PermissionEducationSheet({
  mode,
  onDone,
  uid,
  known,
}: {
  mode: 'REQUEST' | 'OPEN_SETTINGS';
  onDone: () => void;
  uid: string;
  known: { pushToken?: string | null; pushTokenType?: string | null };
}) {
  const insets = useSafeAreaInsets();
  const [working, setWorking] = useState(false);

  const later = () => {
    if (working) return;
    void engagementService.permissionEvent('permission_later_clicked');
    onDone();
  };

  const enable = async () => {
    if (working) return;
    setWorking(true);
    try {
      if (mode === 'OPEN_SETTINGS') {
        void engagementService.permissionEvent('notification_settings_opened');
        await notificationService.openSystemSettings();
        return; // the app re-checks the permission when it comes back (app/_layout.tsx)
      }
      void engagementService.permissionEvent('permission_enable_clicked');
      const result = await notificationService.requestPermissionFromUser();
      void engagementService.permissionEvent(result.granted ? 'os_permission_granted' : 'os_permission_denied');
      void engagementService
        .reportPermission({ osStatus: result.granted ? 'granted' : 'denied', canAskAgain: result.canAskAgain })
        .catch((error) => console.log('permission report failed:', error));
      if (result.granted && uid) await savePushToken(uid, result.token, known).catch((error) => console.log('push token save failed:', error));
    } finally {
      setWorking(false);
      onDone();
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={later} statusBarTranslucent>
      <View style={[s.overlay, s.center]}>
        <View style={[s.card, { marginBottom: insets.bottom }]}>
          <View style={s.bell}>
            <Ionicons name="notifications" size={30} color={T.color.brand} />
          </View>
          <Text style={[s.title, { textAlign: 'center' }]}>Never miss an important food update!</Text>
          <Text style={[s.body, { textAlign: 'center' }]}>
            {mode === 'OPEN_SETTINGS'
              ? 'Notifications are turned off for this app in your phone settings. Turn them on to stay updated about your orders and favourite restaurants.'
              : 'Stay updated about your orders and receive useful updates from your favourite restaurants.'}
          </Text>
          <View style={s.benefits}>
            {BENEFITS.map((b) => (
              <View key={b.text} style={s.benefit}>
                <Ionicons name={b.icon} size={18} color={T.color.brand} />
                <Text style={s.benefitText}>{b.text}</Text>
              </View>
            ))}
          </View>
          <Text style={s.fine}>You can choose which updates you get anytime in Profile → Notification preferences.</Text>
          <Pressable onPress={enable} disabled={working} style={[PRIMARY_BUTTON_STYLE, s.cta, working && s.disabled]}>
            {working ? <ActivityIndicator color={T.color.surface} /> : <Text style={PRIMARY_BUTTON_TEXT_STYLE}>{mode === 'OPEN_SETTINGS' ? 'Open Settings' : 'Enable Notifications'}</Text>}
          </Pressable>
          <Pressable onPress={later} style={s.secondary} hitSlop={6}>
            <Text style={s.secondaryText}>Maybe Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(28,25,23,0.45)', justifyContent: 'flex-end' },
  center: { justifyContent: 'center', paddingHorizontal: 20 },
  sheet: { backgroundColor: T.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, maxHeight: '90%' },
  card: { backgroundColor: T.color.surface, borderRadius: 24, padding: 22, ...T.shadow.float },
  close: { position: 'absolute', right: 0, top: 0, zIndex: 2, padding: 4 },
  restaurantRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, paddingRight: 32 },
  logo: { width: 48, height: 48, borderRadius: T.radius.md, overflow: 'hidden', backgroundColor: T.color.brandSoft },
  restaurantName: { fontSize: T.font.title, fontWeight: '700', color: T.color.ink },
  items: { fontSize: T.font.small, color: T.color.muted, marginTop: 2 },
  title: { fontSize: T.font.heading, fontWeight: '800', color: T.color.ink, marginBottom: 6 },
  body: { fontSize: T.font.body, color: T.color.inkSoft, lineHeight: 20 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 20 },
  starLabel: { textAlign: 'center', marginTop: 8, fontSize: T.font.body, fontWeight: '600', color: T.color.muted },
  input: {
    marginTop: 16,
    minHeight: 84,
    borderWidth: 1,
    borderColor: T.color.line,
    borderRadius: T.radius.md,
    padding: 12,
    fontSize: T.font.body,
    color: T.color.ink,
    textAlignVertical: 'top',
    backgroundColor: T.color.canvas,
  },
  cta: { marginTop: 20 },
  disabled: { opacity: 0.5 },
  secondary: { alignItems: 'center', paddingVertical: 14 },
  secondaryText: { fontSize: 15, fontWeight: '600', color: T.color.muted },
  thanks: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  thanksIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: T.color.success, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  bell: { alignSelf: 'center', width: 64, height: 64, borderRadius: 32, backgroundColor: T.color.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  benefits: { marginTop: 16, gap: 10, backgroundColor: T.color.canvas, borderRadius: T.radius.lg, padding: 14 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefitText: { flex: 1, fontSize: T.font.body, color: T.color.inkSoft },
  fine: { marginTop: 12, fontSize: T.font.small, color: T.color.muted, textAlign: 'center' },
});
