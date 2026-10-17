import AppButton from "@/components/common/AppButton";
import { AppColors } from "@/constants/appColors";
import { AppStrings } from "@/constants/appStrings";
import { useAppLoader } from "@/hooks/useAppLoader";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TouchableWithoutFeedback, View } from "react-native";
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDispatch } from "react-redux";
import styled from "styled-components/native";
import { showAlert, showErrorAlert } from "../services/alertService";
import { AppAuthUser, authService, OtpConfirmationResult } from "../services/authService";
import { OTP_CONFIG } from "../config/otp";
import { storageService } from "../services/storageService";
import { userService } from "../services/userService";
import { AppDispatch } from "../store";
import { setError, setLoading, setUser } from "../store/slices/authSlice";
import { moderateScale, moderateVerticalScale, scaleFont } from "../utils/responsive";

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

const LOGIN_BUTTON_STYLE = { minHeight: moderateVerticalScale(50) } as const;

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
  const scrollContentStyle = useMemo(
    () => ({
      flexGrow: 1,
      paddingBottom: moderateVerticalScale(40),
      paddingTop: moderateVerticalScale(300),
    }),
    []
  );

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
      await storageService.saveUserProfile(userProfile);
      setLoadingState(false);
      dispatch(setLoading(false));
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      hideGlobalLoader();
      const errorMessage = "Logged in, but your profile couldn't be loaded. Please try again.";
      dispatch(setError(errorMessage));
      showErrorAlert(error, errorMessage, 'Login Failed');
    }
  };


  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  return (
    <Container>
      <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        >
          <ScrollView
            contentContainerStyle={scrollContentStyle}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <Title>{AppStrings.auth.welcomeBack}</Title>
          <Subtitle>{AppStrings.auth.loginToContinue}</Subtitle>
          <Animated.View entering={FadeInDown.delay(80).springify().damping(16)}>
            <AuthInput
              placeholder="Phone Number"
              placeholderTextColor="#888"
              keyboardType="phone-pad"
              value={phoneNumber}
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
          </Animated.View>

          {otpSent ? (
            <View>
              <AuthInput
                placeholder={`Enter ${otpLength}-digit OTP`}
                placeholderTextColor="#888"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                value={otpCode}
                onChangeText={(value: string) => setOtpCode(value.replace(/\D/g, '').slice(0, otpLength))}
                maxLength={otpLength}
                editable={!loading}
              />
            </View>
          ) : null}

          <View>
            <AppButton
              title={otpSent ? 'Verify OTP & Login' : 'Send OTP'}
              onPress={otpSent ? handleVerifyOtp : handleSendOtp}
              loading={loading}
              style={LOGIN_BUTTON_STYLE}
            />
          </View>

          {otpSent ? (
            <ForgotPasswordContainer>
              <ForgotPasswordLink onPress={handleResendOtp} disabled={loading || resending || resendIn > 0}>
                <ForgotPasswordText style={resendIn > 0 || resending ? { opacity: 0.5 } : undefined}>
                  {resending ? 'Sending…' : resendIn > 0 ? `Resend OTP in ${formatWait(resendIn)}` : 'Resend OTP'}
                </ForgotPasswordText>
              </ForgotPasswordLink>
            </ForgotPasswordContainer>
          ) : null}

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
    </Container>
  );
};

const RESEND_COOLDOWN_SECONDS = 30;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
}

export default LoginScreen;

const Container = styled.ImageBackground.attrs({
  source: require('../assets/images/login_bg.png'),
  resizeMode: 'cover',
})`
  flex: 1;
  background-color: ${AppColors.background};
  padding: 0 ${moderateScale(20)}px;
`;

const Title = styled.Text`
  font-size: ${scaleFont(28)}px;
  font-weight: bold;
  color: ${AppColors.textPrimary};
  margin-bottom: ${moderateVerticalScale(10)}px;
`;

const Subtitle = styled.Text`
  font-size: ${scaleFont(16)}px;
  color: ${AppColors.textSecondary};
  margin-bottom: ${moderateVerticalScale(30)}px;
`;

const AuthInput = styled.TextInput`
  border: 1px solid ${AppColors.inputBorder};
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(16)}px;
  font-size: ${scaleFont(16)}px;
  color: ${AppColors.textPrimary};
  background-color: ${AppColors.background};
`;

const PolicyContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  margin-top: ${moderateVerticalScale(12)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
`;

const PolicyText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #000;
`;

const PolicyLink = styled.TouchableOpacity`
  padding-horizontal: ${moderateScale(2)}px;
`;

const PolicyLinkText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: ${AppColors.primary};
  font-weight: 700;
`;

// Forgot Password UI styled-components (must be defined before use)
const ForgotPasswordContainer = styled.View`
  align-items: flex-end;
  margin-top: ${moderateVerticalScale(8)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
`;

const ForgotPasswordLink = styled.TouchableOpacity``;
const ForgotPasswordText = styled.Text`
  color: ${AppColors.primary};
  font-size: ${scaleFont(15)}px;
  font-weight: 700;
`;


