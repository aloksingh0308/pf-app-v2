import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile } from '../store/slices/authSlice';

const USER_PROFILE_KEY = 'app_user_profile';
const AUTH_TOKEN_KEY = 'app_auth_token';
// Not cleared on logout — the intro slides show once per install.
const ONBOARDING_SEEN_KEY = 'app_onboarding_seen_v1';

export const storageService = {
  // Save user profile
  saveUserProfile: async (userProfile: UserProfile): Promise<void> => {
    try {
      await AsyncStorage.setItem(USER_PROFILE_KEY, JSON.stringify(userProfile));
    } catch (error) {
      console.log('Error saving user profile to storage:', error);
      throw error;
    }
  },

  // Get user profile
  getUserProfile: async (): Promise<UserProfile | null> => {
    try {
      const profileData = await AsyncStorage.getItem(USER_PROFILE_KEY);
      return profileData ? JSON.parse(profileData) : null;
    } catch (error) {
      console.log('Error retrieving user profile from storage:', error);
      return null;
    }
  },

  // Update user profile
  updateUserProfile: async (updates: Partial<UserProfile>): Promise<UserProfile | null> => {
    try {
      const currentProfile = await storageService.getUserProfile();
      if (!currentProfile) {
        return null;
      }
      const updatedProfile = { ...currentProfile, ...updates };
      await storageService.saveUserProfile(updatedProfile);
      return updatedProfile;
    } catch (error) {
      console.log('Error updating user profile in storage:', error);
      throw error;
    }
  },

  // Clear user profile and auth data
  clearUserData: async (): Promise<void> => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(USER_PROFILE_KEY),
        AsyncStorage.removeItem(AUTH_TOKEN_KEY),
      ]);
    } catch (error) {
      console.log('Error clearing user data from storage:', error);
      throw error;
    }
  },

  // Check if user exists in local storage
  hasUserData: async (): Promise<boolean> => {
    try {
      const profileData = await AsyncStorage.getItem(USER_PROFILE_KEY);
      return profileData !== null;
    } catch (error) {
      console.log('Error checking user data:', error);
      return false;
    }
  },
  // First-launch intro slides
  hasSeenOnboarding: async (): Promise<boolean> => {
    try {
      return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) === '1';
    } catch (error) {
      console.log('Error reading onboarding flag:', error);
      // Unreadable storage: don't trap the user in the intro on every launch.
      return true;
    }
  },

  markOnboardingSeen: async (): Promise<void> => {
    try {
      await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    } catch (error) {
      console.log('Error saving onboarding flag:', error);
    }
  },
};
