import { dobToIso } from '@/utils/dateOfBirth';
import { getPendingReferralCode, normalizeReferralCode, onPendingLinkChange } from '@/utils/deepLinks';
import { getInstallReferrer } from '@/utils/referral';
import DateOfBirthPicker from '@/components/DateOfBirthPicker';
import AppButton from "@/components/common/AppButton";
import { AppColors } from "@/constants/appColors";
import { useAppLoader } from "@/hooks/useAppLoader";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDispatch } from "react-redux";
import styled from "styled-components/native";
import { showAlert, showErrorAlert } from "../services/alertService";
import { errorReason, track } from "../services/analytics";
import { authService } from "../services/authService";
import { storageService } from "../services/storageService";
import { userService } from "../services/userService";
import { AppDispatch } from "../store";
import { setError, setLoading, setUser } from "../store/slices/authSlice";

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
      track('sign_up_failed', { reason: errorReason(error) });
      showErrorAlert(error, errorMessage, 'Setup Failed');
    }
  };

  return (
    <Container>
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
            contentContainerStyle={{ paddingBottom: insets.bottom + 40, flexGrow: 1, paddingHorizontal: 20, paddingTop: insets.top + 32 }}
          >
            <Title accessibilityRole="header">Complete your profile</Title>
            <Subtitle>Just a few details to finish setting up your account.</Subtitle>

            <FieldInput
              placeholder="Full Name *"
              placeholderTextColor="#888"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />

            <FieldInput
              placeholder="Email Address (Optional)"
              placeholderTextColor="#888"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />

            <DateOfBirthPicker value={dateOfBirth} onChange={setDateOfBirth} disabled={loading} />

            <FieldInput
              placeholder="Phone Number"
              placeholderTextColor="#888"
              value={phoneNumber}
              editable={false}
            />

            <FieldInput
              placeholder="Referral Code (Optional)"
              placeholderTextColor="#888"
              autoCapitalize="characters"
              value={referralCode}
              onChangeText={setReferralCode}
              editable={!loading}
            />

            <AppButton
              title={loading ? 'Saving...' : 'Continue'}
              onPress={handleContinue}
              loading={loading}
              style={{ minHeight: 50, marginTop: 8 }}
            />

            <DifferentNumberButton accessibilityRole="button" onPress={handleCancel} disabled={loading}>
              <DifferentNumberText>Not you? Use a different number</DifferentNumberText>
            </DifferentNumberButton>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Container>
  );
};

export default CompleteProfileScreen;

const Container = styled.ImageBackground.attrs({
  source: require('../assets/images/signup_bg.png'),
  resizeMode: 'cover',
})`
  flex: 1;
  background-color: ${AppColors.background};
  min-height: 100%;
  width: 100%;
`;





const Title = styled.Text`
  font-size: 26px;
  font-weight: 800;
  color: ${AppColors.textPrimary};
  text-align: center;
  margin-bottom: 8px;
`;

const DifferentNumberButton = styled.TouchableOpacity`
  margin-top: 18px;
  align-self: center;
  padding: 8px 12px;
`;

const DifferentNumberText = styled.Text`
  color: ${AppColors.primary};
  font-size: 14px;
  font-weight: 700;
`;

const Subtitle = styled.Text`
  font-size: 15px;
  color: ${AppColors.textSecondary};
  margin-bottom: 24px;
  text-align: center;
`;

const FieldInput = styled.TextInput`
  border: 1px solid ${AppColors.inputBorder};
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
  font-size: 16px;
  color: ${AppColors.textPrimary};
  background-color: ${AppColors.background};
  width: 100%;
  align-self: stretch;
`;
