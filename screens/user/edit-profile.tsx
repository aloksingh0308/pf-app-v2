import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppContent } from '@/constants/appContent';
import { useAppLoader } from '@/hooks/useAppLoader';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { storageService } from '../../services/storageService';
import { userService } from '../../services/userService';
import { apiClient } from '../../utils/apiClient';
import { AppDispatch, RootState } from '../../store';
import { setUser } from '../../store/slices/authSlice';

const DEFAULT_PROFILE_IMAGE = AppContent.images.defaultProfile;

export default function EditProfileScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const appLoader = useAppLoader();
  useEffect(() => { appLoader.hide(); }, []);
  const [name, setName] = useState(user?.name || '');
  const phoneNumber = user?.phoneNumber || '';
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [profileImage, setProfileImage] = useState(user?.profileImage || DEFAULT_PROFILE_IMAGE);
  const [saving, setSaving] = useState(false);
  const [saveStatusText, setSaveStatusText] = useState('');

  useEffect(() => {
    if (user?.dateOfBirth) {
      setDateOfBirth(formatDateOfBirth(user.dateOfBirth));
    }
  }, [user?.dateOfBirth]);

  if (!user) {
    return (
      <Container>
        <Header>
          <BackButton onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color="#282939" />
          </BackButton>
          <Title>Edit Profile</Title>
          <Spacer />
        </Header>
        <Center>
          <InfoText>User not found.</InfoText>
        </Center>
      </Container>
    );
  }

  const formatDateOfBirth = (isoDate: string) => {
    if (!isoDate) return '';
    const parsed = new Date(isoDate);
    if (!isoDate.includes('-') || isNaN(parsed.getTime())) {
      return isoDate;
    }
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const validateDateOfBirth = (dob: string) => {
    const dobRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    if (!dobRegex.test(dob.trim())) {
      return false;
    }
    const [day, month, year] = dob.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };

  const getIsoDateFromDob = (dob: string) => {
    const [day, month, year] = dob.split('/').map(Number);
    return new Date(year, month - 1, day).toISOString().split('T')[0];
  };

  const uploadProfileImageIfNeeded = async (uri: string) => {
    if (!uri) return DEFAULT_PROFILE_IMAGE;
    setSaveStatusText('Uploading profile photo...');
    return apiClient.uploadImage(uri, 'profile');
  };

  const pickProfileImage = async () => {
    try {

      // Use system photo picker for Android 13+ (no permissions required)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setProfileImage(result.assets[0].uri);
      }
    } catch (error) {
      showErrorAlert(error, 'Unable to pick image right now.', 'Error');
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      showAlert('Validation', 'Please enter your name.');
      return;
    }

    if (!dateOfBirth.trim()) {
      showAlert('Validation', 'Please enter your date of birth.');
      return;
    }

    if (!validateDateOfBirth(dateOfBirth)) {
      showAlert('Validation', 'Please enter a valid date of birth in DD/MM/YYYY format.');
      return;
    }

    try {
      setSaving(true);

      const uploadedProfileImage = await uploadProfileImageIfNeeded(profileImage);
      setSaveStatusText('Saving profile...');

      const updates = {
        name: trimmedName,
        dateOfBirth: getIsoDateFromDob(dateOfBirth),
        profileImage: uploadedProfileImage,
      };

      await userService.updateUserProfile(user.uid, updates);
      const updatedProfile = {
        ...user,
        ...updates,
      };

      dispatch(setUser(updatedProfile));
      await storageService.saveUserProfile(updatedProfile);

      setSaving(false);
      setSaveStatusText('');
      showAlert('Success', 'Profile updated successfully.', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (error) {
      setSaving(false);
      setSaveStatusText('');
      showErrorAlert(error, 'Failed to update profile. Please try again.', 'Error');
    }
  };

  return (
    <Container>
      <Header>
        <BackButton onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#282939" />
        </BackButton>
        <Title>Edit Profile</Title>
        <Spacer />
      </Header>

      <Content>
        <ProfileImageContainer>
          <ProfileImage source={{ uri: profileImage || DEFAULT_PROFILE_IMAGE }} />
          <ImagePickerButton onPress={pickProfileImage}>
            <ImagePickerText>Change Photo</ImagePickerText>
          </ImagePickerButton>
        </ProfileImageContainer>

        <Label>Full Name</Label>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Enter full name"
          placeholderTextColor="#999"
          editable={!saving}
        />

        <Label>Mobile Number</Label>
        {/* Phone is this account's own login identity (verified by OTP), so it isn't
            editable here — matches customerAuth.service.ts's updateMe, which deliberately
            has no phone field at all. */}
        <Input value={phoneNumber} editable={false} placeholderTextColor="#999" />

        <Label>Date of Birth</Label>
        <Input
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder="DD/MM/YYYY"
          placeholderTextColor="#999"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          editable={!saving}
        />

        <AppButton
          title="Save Changes"
          onPress={handleSave}
          disabled={saving}
          loading={saving}
          style={{ minHeight: 50, marginTop: 8, marginBottom: 24 }}
        />

        {saving && saveStatusText ? <StatusText>{saveStatusText}</StatusText> : null}
      </Content>
    </Container>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${AppColors.background};
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${AppColors.border};
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Spacer = styled.View`
  width: 40px;
  height: 40px;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: 700;
  color: ${AppColors.textPrimary};
`;

const Content = styled.ScrollView`
  flex: 1;
  padding: 20px;
`;

const ProfileImageContainer = styled.View`
  align-items: center;
  margin-bottom: 24px;
`;

const ProfileImage = styled.Image`
  width: 120px;
  height: 120px;
  border-radius: 60px;
  border-width: 2px;
  border-color: ${AppColors.primary};
`;

const ImagePickerButton = styled.TouchableOpacity`
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background-color: #fff3e0;
  border-width: 1px;
  border-color: #ffe0b2;
`;

const ImagePickerText = styled.Text`
  color: ${AppColors.primary};
  font-size: 14px;
  font-weight: 600;
`;

const Label = styled.Text`
  color: ${AppColors.textDark};
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
`;

const Input = styled.TextInput`
  border-width: 1px;
  border-color: ${AppColors.inputBorder};
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 16px;
  font-size: 16px;
  color: ${AppColors.textPrimary};
  background-color: ${AppColors.lightBackground};
`;

const StatusText = styled.Text`
  margin-top: -12px;
  margin-bottom: 18px;
  text-align: center;
  color: ${AppColors.textSecondary};
  font-size: 13px;
`;

const Center = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const InfoText = styled.Text`
  color: ${AppColors.textSecondary};
  font-size: 14px;
`;
