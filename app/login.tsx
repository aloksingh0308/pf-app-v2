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
import { AppAuthUser, authService } from "../services/authService";
import { storageService } from "../services/storageService";
import { userService } from "../services/userService";
import { AppDispatch } from "../store";
import { setError, setLoading, setUser } from "../store/slices/authSlice";
import { moderateScale, moderateVerticalScale, scaleFont } from "../utils/responsive";

type OtpConfirmation = { confirm: (code: string) => Promise<{ user: AppAuthUser }> };

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
  const [confirmationResult, setConfirmationResult] = useState<OtpConfirmation | null>(null);
  const [loading, setLoadingState] = useState(false);
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

      const confirmation = await authService.sendPhoneOtp(e164Phone);
      setConfirmationResult(confirmation);
      setOtpSent(true);
      setLoadingState(false);
      dispatch(setLoading(false));
      showAlert('OTP Sent', `Please enter the 6-digit OTP sent to ${e164Phone}.`);
    } catch (error: any) {
      setLoadingState(false);
      dispatch(setLoading(false));
      hideGlobalLoader();
      const errorCode = String(error?.code || '');
      const errorMessage = errorCode === 'auth/too-many-requests'
        ? 'Too many OTP requests from this device/number. Please wait and retry later.'
        : errorCode === 'auth/quota-exceeded'
          ? 'SMS quota exceeded on Firebase project. Please try again later.'
          : errorCode === 'auth/invalid-phone-number'
            ? 'Please enter a valid mobile number.'
            : errorCode === 'auth/missing-phone-number'
              ? 'Phone number is missing. Please enter a phone number.'
              : errorCode === 'auth/captcha-check-failed'
                ? 'reCAPTCHA verification failed. Please retry and complete the challenge.'
                : errorCode === 'auth/operation-not-allowed'
                  ? 'Phone authentication is disabled in Firebase. Enable Phone provider in Authentication > Sign-in method.'
                  : errorCode === 'auth/app-not-authorized'
                    ? 'This app is not authorized for Firebase Auth. Check Firebase project settings and app configuration.'
                    : errorCode === 'auth/network-request-failed'
                      ? 'Network error while requesting OTP. Check internet and retry.'
                      : `Failed to send OTP. ${errorCode ? `(${errorCode})` : ''}`.trim();
      dispatch(setError(errorMessage));
      showErrorAlert(error, errorMessage, 'OTP Failed');
    }
  };

  const handleVerifyOtp = async () => {
    if (!confirmationResult) {
      showAlert('Error', 'Please request OTP first');
      return;
    }

    if (!otpCode.trim() || otpCode.trim().length < 6) {
      showAlert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    try {
      setLoadingState(true);
      dispatch(setLoading(true));

      const credential = await authService.verifyPhoneOtp(confirmationResult, otpCode.trim());
      const firebaseUser = credential.user;
      const normalizedPhone = normalizePhoneForLookup(firebaseUser.phoneNumber || phoneNumber);

      // The backend creates (or finds) the Customer record itself during OTP verify —
      // there's no "no profile yet" case to migrate/link the way Firebase's separate
      // per-provider UIDs used to require. A brand-new phone number just comes back with
      // an empty name, which is what routes to /complete-profile below.
      let userProfile = await userService.getUserProfile(firebaseUser.uid, firebaseUser.email);

      if (!userProfile || !userProfile.name) {
        setLoadingState(false);
        dispatch(setLoading(false));
        router.push({
          pathname: '/complete-profile',
          params: {
            uid: firebaseUser.uid,
            phone: normalizedPhone,
            email: String(firebaseUser.email || '').trim().toLowerCase(),
          },
        } as never);
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
      const errorCode = error?.code;
      const errorMessage = errorCode === 'auth/invalid-verification-code'
        ? 'Incorrect OTP. Please try again.'
        : errorCode === 'auth/code-expired'
          ? 'OTP expired. Please request a new one.'
          : 'OTP verification failed. Please try again.';
      dispatch(setError(errorMessage));
      showErrorAlert(error, errorMessage, 'Verification Failed');
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
              onChangeText={(value) => setPhoneNumber(normalizePhoneInput(value))}
              editable={!loading}
            />
          </Animated.View>

          {otpSent ? (
            <View>
              <AuthInput
                placeholder="Enter 6-digit OTP"
                placeholderTextColor="#888"
                keyboardType="number-pad"
                value={otpCode}
                onChangeText={setOtpCode}
                maxLength={6}
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
              <ForgotPasswordLink onPress={handleSendOtp} disabled={loading}>
                <ForgotPasswordText>Resend OTP</ForgotPasswordText>
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


