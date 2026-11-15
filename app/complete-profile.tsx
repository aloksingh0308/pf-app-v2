import { dobToIso } from '@/utils/dateOfBirth';
import { getPendingReferralCode, normalizeReferralCode, onPendingLinkChange } from '@/utils/deepLinks';
import { getInstallReferrer } from '@/utils/referral';
import DateOfBirthPicker from '@/components/DateOfBirthPicker';
import { AuthBackdrop, AuthBrandHeader, AuthCard } from "@/components/AuthBackdrop";
import AppButton from "@/components/common/AppButton";
import { AppColors } from "@/constants/appColors";
import { useAppLoader } from "@/hooks/useAppLoader";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInputProps, TouchableWithoutFeedback } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDispatch } from "react-redux";
import styled from "styled-components/native";
import { showAlert, showErrorAlert } from "../services/alertService";
import { errorParams, track } from "../services/analytics";
import { authService } from "../services/authService";
import { storageService } from "../services/storageService";
import { userService } from "../services/userService";
import { AppDispatch } from "../store";
import { setError, setLoading, setUser } from "../store/slices/authSlice";
import { T } from '@/constants/tokens';

const INPUT_BG = T.color.inputBg;

const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateDateOfBirth = (dob: string): boolean => {
  const dobRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
  if (!dobRegex.test(dob.trim())) return false;
  const [day, month, year] = dob.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

const getIsoDateFromDob = dobToIso;

// Firestore's setDoc/updateDoc reject `undefined` field values outright — since
// dateOfBirth is optional here, strip any undefined keys before writing rather
// than letting them reach Firestore (e.g. when no DOB was entered and there's
// no existing value to fall back to).
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

const normalizePhoneForLookup = (phone: string): string => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 10) return digits;
  return digits.slice(-10);
};

const CompleteProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ uid?: string; phone?: string; email?: string }>();
  const uid = String(params.uid || '');
  const phoneNumber = normalizePhoneForLookup(String(params.phone || ''));

  const { hide: hideGlobalLoader } = useAppLoader();
  const dispatch = useDispatch<AppDispatch>();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(String(params.email || ''));
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoadingState] = useState(false);

  useEffect(() => {
    hideGlobalLoader();
  }, [hideGlobalLoader]);

  // Prefill from an invite link (opened with the app installed) or, on a fresh Android
  // install, from the Play Store install referrer the website's /invite page sets. Never
  // overwrites a code the user has typed.
  useEffect(() => {
    let active = true;
    const prefill = async () => {
      const code = (await getPendingReferralCode()) || normalizeReferralCode(await getInstallReferrer());
      if (active && code) setReferralCode((current) => current.trim() ? current : code);
    };
    void prefill();
    const unsubscribe = onPendingLinkChange(() => void prefill());
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    // Guard against opening this screen without a valid pending phone-auth
    // session (e.g. a stale deep link or a hot reload mid-flow).
    if (!uid || phoneNumber.length !== 10) {
      router.replace('/login' as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = async () => {
    try {
      await authService.logoutUser();
    } catch {
      // Ignore logout errors for cancellation path.
    }
    router.replace('/login' as never);
  };

  const handleContinue = async () => {
    if (!uid || phoneNumber.length !== 10) {
      showAlert('Error', 'Phone verification session expired. Please try OTP login again.');
      router.replace('/login' as never);
      return;
    }

    if (!name.trim()) {
      showAlert('Error', 'Please enter your name');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail && !validateEmail(normalizedEmail)) {
      showAlert('Error', 'Please enter a valid email address');
      return;
    }

    const trimmedDob = dateOfBirth.trim();
    if (trimmedDob && !validateDateOfBirth(trimmedDob)) {
      showAlert('Error', 'Please enter a valid date of birth in DD/MM/YYYY format');
      return;
    }
    const isoDateOfBirth = trimmedDob ? getIsoDateFromDob(trimmedDob) : undefined;

    try {
      setLoadingState(true);
      dispatch(setLoading(true));

      await userService.updateUserProfile(uid, stripUndefined({
        name: name.trim(),
        email: normalizedEmail || undefined,
        dateOfBirth: isoDateOfBirth,
        // Applied at most once, server-side — a bad/unknown/self code is just ignored
        // rather than blocking profile completion (see customerAuthService.applyReferralCode).
        referredByCode: referralCode.trim() || undefined,
      }));
      const userProfile = await userService.getUserProfile(uid, normalizedEmail || undefined);

      if (!userProfile) {
        throw new Error('Unable to complete profile setup. Please try again.');
      }

      await storageService.saveUserProfile(userProfile);
      setLoadingState(false);
      dispatch(setLoading(false));

      // Go to Home BEFORE marking the user signed in. Signing in re-mounts the root Stack
      // (its key changes from "guest" to the user — see app/_layout.tsx), and a redirect
      // fired during that re-mount is lost, leaving the new Stack on this screen. Navigating
      // first means the re-mounted Stack starts on Home.
      track('sign_up', { method: 'phone' });
      router.replace('/(tabs)' as never);
      requestAnimationFrame(() => dispatch(setUser(userProfile)));
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      const errorMessage = error?.message || 'Failed to complete profile setup. Please try again.';
      dispatch(setError(errorMessage));
      track('sign_up_failed', { ...errorParams(error) });
      showErrorAlert(error, errorMessage, 'Setup Failed');
    }
  };

  return (
    <AuthBackdrop>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 16, flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: insets.top + 12 }}
          >
            <AuthBrandHeader logoSize={72} />
            <AuthCard>
              <Title accessibilityRole="header">Complete your profile</Title>
              <Subtitle>Just a few details to finish setting up your account.</Subtitle>

              <FieldLabel>Full name *</FieldLabel>
              <ProfileInput
                placeholder="Your name"
                placeholderTextColor="#a99a8e"
                value={name}
                onChangeText={setName}
                editable={!loading}
              />

              <FieldLabel>Email (optional)</FieldLabel>
              <ProfileInput
                placeholder="you@example.com"
                placeholderTextColor="#a99a8e"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
              />

              <FieldLabel>Date of birth (optional)</FieldLabel>
              <DateOfBirthPicker value={dateOfBirth} onChange={setDateOfBirth} placeholder="DD/MM/YYYY" disabled={loading} fieldStyle={DOB_FIELD_STYLE} />

              <FieldLabel>Mobile number</FieldLabel>
              <ProfileInput
                placeholder="Phone Number"
                placeholderTextColor="#a99a8e"
                value={phoneNumber ? `+91 ${phoneNumber}` : ''}
                editable={false}
                style={{ color: '#8a6a55' }}
              />

              <FieldLabel>Referral code (optional)</FieldLabel>
              <ProfileInput
                placeholder="Have a friend's code?"
                placeholderTextColor="#a99a8e"
                autoCapitalize="characters"
                value={referralCode}
                onChangeText={setReferralCode}
                editable={!loading}
              />

              <AppButton
                title={loading ? 'Saving...' : 'Continue'}
                onPress={handleContinue}
                loading={loading}
                style={{ marginTop: 6 }}
              />
            </AuthCard>

            <DifferentNumberButton accessibilityRole="button" onPress={handleCancel} disabled={loading}>
              <DifferentNumberText>Not you? Use a different number</DifferentNumberText>
            </DifferentNumberButton>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </AuthBackdrop>
  );
};

export default CompleteProfileScreen;

// Matches FieldInput below.
const DOB_FIELD_STYLE = { borderWidth: 1.5, borderColor: 'transparent', borderRadius: 14, backgroundColor: INPUT_BG, marginBottom: 12, minHeight: 48 } as const;

type FocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];

/** Same look as the login fields: soft peach fill, white with an orange border while focused. */
function ProfileInput(props: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <FieldInput
      {...props}
      $focused={focused}
      onFocus={(e: FocusEvent) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e: FocusEvent) => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

const Title = styled.Text`
  font-size: 22px;
  font-weight: 800;
  color: #252a36;
`;

const Subtitle = styled.Text`
  font-size: 14px;
  color: ${T.color.muted};
  margin-top: 4px;
  margin-bottom: 14px;
`;

const FieldLabel = styled.Text`
  font-size: 13px;
  font-weight: 700;
  color: #653919;
  margin-bottom: 5px;
`;

const FieldInput = styled.TextInput<{ $focused?: boolean }>`
  border: 1.5px solid ${(p: { $focused?: boolean }) => (p.$focused ? T.color.brand : 'transparent')};
  border-radius: 14px;
  background-color: ${(p: { $focused?: boolean }) => (p.$focused ? T.color.surface : INPUT_BG)};
  padding: 11px 14px;
  margin-bottom: 12px;
  font-size: 16px;
  color: ${T.color.ink};
  align-self: stretch;
`;

const DifferentNumberButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  margin-top: 10px;
  align-self: center;
  padding: 8px 12px;
`;

const DifferentNumberText = styled.Text`
  color: ${T.color.brand};
  font-size: 14px;
  font-weight: 700;
`;
