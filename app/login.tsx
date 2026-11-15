import { AuthBackdrop, AuthBrandHeader, AuthCard } from "@/components/AuthBackdrop";
import AppButton from "@/components/common/AppButton";
import { AppColors } from "@/constants/appColors";
import { AppStrings } from "@/constants/appStrings";
import { useAppLoader } from "@/hooks/useAppLoader";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch } from "react-redux";
import styled from "styled-components/native";
import { showAlert, showErrorAlert } from "../services/alertService";
import { errorParams, track } from "../services/analytics";
import { AppAuthUser, authService, OtpConfirmationResult } from "../services/authService";
import { OTP_CONFIG } from "../config/otp";
import { storageService } from "../services/storageService";
import { userService } from "../services/userService";
import { AppDispatch } from "../store";
import { setError, setLoading, setUser } from "../store/slices/authSlice";
import { moderateScale, moderateVerticalScale, scaleFont } from "../utils/responsive";
import { T } from '@/constants/tokens';

const INPUT_BG = T.color.inputBg;

const normalizePhoneForLookup = (phone: string): string => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 10) {
    return digits;
  }
  return digits.slice(-10);
};

const isValidE164 = (phone: string): boolean => /^\+[1-9]\d{9,14}$/.test(phone);

const normalizePhoneInput = (value: string): string => {
  const digits = String(value || '').replace(/\D/g, '').slice(-10);
  return digits;
};

const LOGIN_BUTTON_STYLE = { marginTop: moderateVerticalScale(6) } as const;

const LoginScreen = () => {
  const { show: showGlobalLoader, hide: hideGlobalLoader } = useAppLoader();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<OtpConfirmationResult | null>(null);
  const [loading, setLoadingState] = useState(false);
  const [resending, setResending] = useState(false);
  const otpLength = confirmationResult?.otpLength ?? OTP_CONFIG.otpLength;
  // Seconds until "Resend OTP" is allowed — mirrors the backend's resend cooldown so the
  // customer sees a countdown instead of hitting a "please wait" error.
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  const dispatch = useDispatch<AppDispatch>();
  const insets = useSafeAreaInsets();
  const [phoneFocused, setPhoneFocused] = useState(false);

  useEffect(() => {
    hideGlobalLoader();
  }, [hideGlobalLoader]);

  useFocusEffect(
    useCallback(() => {
      hideGlobalLoader();
    }, [hideGlobalLoader])
  );

  const handleSendOtp = async () => {
    const normalizedPhone = normalizePhoneForLookup(phoneNumber);
    if (!normalizedPhone || normalizedPhone.length !== 10) {
      showAlert('Error', 'Please enter a valid 10-digit phone number');
      return;
    }

    const e164Phone = authService.normalizePhoneToE164(normalizedPhone);
    if (!isValidE164(e164Phone)) {
      showAlert('Error', 'Phone format is invalid. Please use a valid mobile number.');
      return;
    }

    try {
      setLoadingState(true);
      dispatch(setLoading(true));

      const result = await authService.sendPhoneOtp(e164Phone);
      track('otp_requested', { result: result.status });
      if (result.status === 'logged-in') {
        // Verified without an OTP (MSG91 invisible verification on mobile data).
        await finishLogin(result.user);
        return;
      }
      setConfirmationResult(result.confirmation);
      setOtpCode('');
      setOtpSent(true);
      setResendIn(RESEND_COOLDOWN_SECONDS);
      setLoadingState(false);
      dispatch(setLoading(false));
      showAlert('OTP Sent', `Please enter the ${result.confirmation.otpLength}-digit OTP sent to ${e164Phone}.`);
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      hideGlobalLoader();
      // The backend's OTP endpoint returns a customer-readable message (rate limit, invalid
      // number, SMS provider failure) — show it as-is.
      // Rate-limited: start the countdown from what the server says.
      if (error?.status === 429 && error?.retryAfterSeconds) setResendIn(Math.min(Number(error.retryAfterSeconds), 24 * 60 * 60));
      const isNetworkError = error instanceof TypeError && error?.name !== 'OtpError';
      const errorMessage = isNetworkError
        ? 'Network error while requesting OTP. Check your internet connection and retry.'
        : String(error?.message || 'Failed to send OTP. Please try again.');
      dispatch(setError(errorMessage));
      track('otp_request_failed', { ...errorParams(error), network: isNetworkError });
      showErrorAlert(error, errorMessage, 'OTP Failed');
    }
  };

  const handleVerifyOtp = async () => {
    if (!confirmationResult) {
      showAlert('Error', 'Please request OTP first');
      return;
    }

    if (!new RegExp(`^\\d{${otpLength}}$`).test(otpCode.trim())) {
      showAlert('Error', `Please enter the ${otpLength}-digit OTP`);
      return;
    }

    try {
      setLoadingState(true);
      dispatch(setLoading(true));

      const credential = await authService.verifyPhoneOtp(confirmationResult, otpCode.trim());
      await finishLogin(credential.user);
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      hideGlobalLoader();
      const errorCode = error?.code;
      // OTP providers and the backend explain what went wrong ("Incorrect OTP.", "This OTP
      // has expired…", "Too many attempts…") — show that, not a generic line.
      const serverMessage =
        error?.name === 'OtpError' || (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) ? String(error.message || '') : '';
      const errorMessage = serverMessage
        ? serverMessage
        : errorCode === 'auth/invalid-verification-code'
          ? 'Incorrect OTP. Please try again.'
          : errorCode === 'auth/code-expired'
            ? 'OTP expired. Please request a new one.'
            : 'OTP verification failed. Please try again.';
      dispatch(setError(errorMessage));
      track('otp_verify_failed', { ...errorParams(error) });
      showErrorAlert(error, errorMessage, 'Verification Failed');
    }
  };

  const handleResendOtp = async () => {
    if (!confirmationResult || resendIn > 0 || resending) return;
    try {
      setResending(true);
      await confirmationResult.resend();
      setOtpCode('');
      setResendIn(RESEND_COOLDOWN_SECONDS);
      showAlert('OTP Sent', 'A new OTP is on its way.');
    } catch (error: any) {
      if (error?.status === 429 && error?.retryAfterSeconds) setResendIn(Math.min(Number(error.retryAfterSeconds), 24 * 60 * 60));
      const message = String(error?.message || "Couldn't resend the OTP. Please try again.");
      dispatch(setError(message));
      track('otp_request_failed', { ...errorParams(error), resend: true });
      showErrorAlert(error, message, 'Resend Failed');
    } finally {
      setResending(false);
    }
  };

  /** Shared end of every successful login (OTP verified, or verified without one). */
  const finishLogin = async (sessionUser: AppAuthUser) => {
    try {
      setLoadingState(true);
      dispatch(setLoading(true));

      // The backend creates (or finds) the Customer record itself during OTP verify —
      // there's no "no profile yet" case to migrate/link the way the old auth
      // provider's separate per-provider UIDs used to require. A brand-new phone number just comes back with
      // an empty name, which is what routes to /complete-profile below.
      let userProfile = await userService.getUserProfile(sessionUser.uid, sessionUser.email);

      if (!userProfile || !userProfile.name) {
        // New customer: the root layout (app/_layout.tsx, incompleteSession) sends them to
        // /complete-profile — it's the single owner of that redirect, so two navigations
        // can never race each other here.
        setLoadingState(false);
        dispatch(setLoading(false));
        return;
      }

      if (userProfile.isDisabled) {
        await authService.logoutUser();
        await storageService.clearUserData();
        dispatch(setLoading(false));
        setLoadingState(false);
        showAlert(
          'Account Disabled',
          'This account has been permanently disabled and cannot be used to login.'
        );
        return;
      }

      dispatch(setUser(userProfile));
      track('login', { method: 'phone' });
      await storageService.saveUserProfile(userProfile);
      setLoadingState(false);
      dispatch(setLoading(false));
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      hideGlobalLoader();
      const errorMessage = "Logged in, but your profile couldn't be loaded. Please try again.";
      dispatch(setError(errorMessage));
      track('login_failed', { ...errorParams(error), stage: 'profile_load' });
      showErrorAlert(error, errorMessage, 'Login Failed');
    }
  };


  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  return (
    <AuthBackdrop>
      <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingHorizontal: moderateScale(20),
              paddingTop: insets.top + moderateVerticalScale(24),
              paddingBottom: insets.bottom + moderateVerticalScale(24),
            }}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <AuthBrandHeader />
          <AuthCard>
            <FieldLabel>Enter Mobile number</FieldLabel>
            <PhoneRow>
              <CountryCode $focused={phoneFocused}>
                <CountryCodeText>+91</CountryCodeText>
              </CountryCode>
              <PhoneInput
                $focused={phoneFocused}
                onFocus={() => setPhoneFocused(true)}
                onBlur={() => setPhoneFocused(false)}
                placeholder="10-digit mobile number"
                placeholderTextColor="#a99a8e"
                keyboardType="phone-pad"
                maxLength={10}
                value={phoneNumber}
                style={phoneNumber ? PHONE_FILLED_STYLE : undefined}
                onChangeText={(value: string) => {
                  const next = normalizePhoneInput(value);
                  // A different number needs a fresh OTP — drop the pending one.
                  if (otpSent && next !== phoneNumber) {
                    setOtpSent(false);
                    setConfirmationResult(null);
                    setOtpCode('');
                    setResendIn(0);
                  }
                  setPhoneNumber(next);
                }}
                editable={!loading}
              />
            </PhoneRow>

            {otpSent ? (
              <View>
                <FieldLabel>Enter OTP</FieldLabel>
                <OtpHint>
                  Sent a {otpLength}-digit code to <OtpHintStrong>+91 {phoneNumber}</OtpHintStrong>
                </OtpHint>
                <OtpBoxes
                  length={otpLength}
                  value={otpCode}
                  onChange={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, otpLength))}
                  editable={!loading}
                />
              </View>
            ) : (
              <Hint>We&apos;ll send a one-time password to verify your number. New here? Your account is created after verification.</Hint>
            )}

            <AppButton
              title={otpSent ? 'Verify OTP & Login' : 'Continue'}
              onPress={otpSent ? handleVerifyOtp : handleSendOtp}
              loading={loading}
              style={LOGIN_BUTTON_STYLE}
            />

            {otpSent ? (
              <ResendContainer>
                <ResendLink onPress={handleResendOtp} disabled={loading || resending || resendIn > 0}>
                  <ResendText style={resendIn > 0 || resending ? { opacity: 0.5 } : undefined}>
                    {resending ? 'Sending…' : resendIn > 0 ? `Resend OTP in ${formatWait(resendIn)}` : 'Resend OTP'}
                  </ResendText>
                </ResendLink>
              </ResendContainer>
            ) : null}
          </AuthCard>

          <PolicyContainer>
            <PolicyText>{AppStrings.auth.byContinuing}</PolicyText>
            <PolicyLink onPress={() => router.push('/user/terms-and-conditions' as never)} disabled={loading}>
              <PolicyLinkText>{AppStrings.common.terms}</PolicyLinkText>
            </PolicyLink>
            <PolicyText>{AppStrings.auth.and}</PolicyText>
            <PolicyLink onPress={() => router.push('/user/privacy-policy' as never)} disabled={loading}>
              <PolicyLinkText>{AppStrings.common.privacy}</PolicyLinkText>
            </PolicyLink>
            <PolicyText>{AppStrings.auth.dot}</PolicyText>
          </PolicyContainer>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </AuthBackdrop>
  );
};

const RESEND_COOLDOWN_SECONDS = 30;

/** One round box per digit. A single transparent TextInput sits on top of the row, so SMS
 *  autofill (oneTimeCode / sms-otp), paste and backspace all behave like a normal field. */
function OtpBoxes({ length, value, onChange, editable }: { length: number; value: string; onChange: (v: string) => void; editable: boolean }) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // Open the keyboard as soon as the OTP step appears.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);
  const activeIndex = Math.min(value.length, length - 1);
  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessibilityLabel={`Enter the ${length}-digit OTP`} style={otpStyles.wrap}>
      <View style={otpStyles.row} pointerEvents="none">
        {Array.from({ length }, (_, i) => {
          const digit = value[i];
          const isActive = focused && i === activeIndex;
          return (
            <View key={i} style={[otpStyles.box, digit ? otpStyles.boxFilled : null, isActive ? otpStyles.boxActive : null]}>
              <OtpDigit $empty={!digit}>{digit ?? '-'}</OtpDigit>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        editable={editable}
        caretHidden
        style={otpStyles.hiddenInput}
        accessibilityLabel="OTP"
      />
    </Pressable>
  );
}

const OTP_BOX = moderateScale(48);
const otpStyles = StyleSheet.create({
  wrap: { marginBottom: moderateVerticalScale(18) },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: moderateScale(8) },
  box: {
    flex: 1,
    maxWidth: OTP_BOX,
    aspectRatio: 1,
    borderRadius: moderateScale(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INPUT_BG,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  boxFilled: { backgroundColor: T.color.surface, borderColor: T.color.brandBorder },
  boxActive: { backgroundColor: T.color.surface, borderColor: T.color.brand },
  // Covers the row, invisible; still receives taps, typing, paste and SMS autofill.
  hiddenInput: { ...StyleSheet.absoluteFillObject, color: 'transparent', backgroundColor: 'transparent', opacity: 0.02 },
});

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
}

export default LoginScreen;


const FieldLabel = styled.Text`
  font-size: ${scaleFont(18)}px;
  font-weight: 800;
  color: #653919;
  margin-bottom: ${moderateVerticalScale(12)}px;
`;

const PhoneRow = styled.View`
  flex-direction: row;
  align-items: stretch;
  gap: ${moderateScale(10)}px;
  margin-bottom: ${moderateVerticalScale(14)}px;
`;

const CountryCode = styled.View<{ $focused?: boolean }>`
  width: ${moderateScale(56)}px;
  height: ${moderateScale(56)}px;
  border-radius: ${moderateScale(14)}px;
  align-items: center;
  justify-content: center;
  background-color: ${INPUT_BG};
  border: 1.5px solid ${(p: { $focused?: boolean }) => (p.$focused ? T.color.brandBorder : 'transparent')};
`;

const CountryCodeText = styled.Text`
  font-size: ${scaleFont(16)}px;
  font-weight: 700;
  color: #653919;
`;

const PhoneInput = styled.TextInput<{ $focused?: boolean }>`
  flex: 1;
  height: ${moderateScale(56)}px;
  border-radius: ${moderateScale(14)}px;
  padding: 0 ${moderateScale(20)}px;
  font-size: ${scaleFont(16)}px;
  color: ${T.color.ink};
  background-color: ${(p: { $focused?: boolean }) => (p.$focused ? T.color.surface : INPUT_BG)};
  border: 1.5px solid ${(p: { $focused?: boolean }) => (p.$focused ? T.color.brand : 'transparent')};
`;

// Bolder, spaced digits once typed; the placeholder stays regular weight.
const PHONE_FILLED_STYLE = { fontWeight: '600', letterSpacing: 1, fontSize: scaleFont(17) } as const;

const OtpHint = styled.Text`
  font-size: ${scaleFont(12.5)}px;
  color: #8a6a55;
  margin-top: ${moderateVerticalScale(-4)}px;
  margin-bottom: ${moderateVerticalScale(12)}px;
`;

const OtpHintStrong = styled.Text`
  font-weight: 700;
  color: #653919;
`;

const OtpDigit = styled.Text<{ $empty?: boolean }>`
  font-size: ${scaleFont(20)}px;
  font-weight: ${(p: { $empty?: boolean }) => (p.$empty ? '500' : '700')};
  color: ${(p: { $empty?: boolean }) => (p.$empty ? T.color.faint : T.color.ink)};
`;

const Hint = styled.Text`
  font-size: ${scaleFont(12.5)}px;
  line-height: ${scaleFont(18)}px;
  color: #8a6a55;
  margin-bottom: ${moderateVerticalScale(16)}px;
`;

const PolicyContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  margin-top: ${moderateVerticalScale(18)}px;
  padding: 0 ${moderateScale(12)}px;
`;

const PolicyText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #6b5a4e;
`;

const PolicyLink = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  padding-horizontal: ${moderateScale(2)}px;
`;

const PolicyLinkText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: ${T.color.brand};
  font-weight: 700;
`;

const ResendContainer = styled.View`
  align-items: center;
  margin-top: ${moderateVerticalScale(14)}px;
`;

const ResendLink = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })``;
const ResendText = styled.Text`
  color: ${T.color.brand};
  font-size: ${scaleFont(15)}px;
  font-weight: 700;
`;
