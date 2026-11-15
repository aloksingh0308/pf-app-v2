import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiClient } from '../utils/apiClient';
import { track } from './analytics';
import { notificationService, OsPermissionState, PushTokenData } from './notificationService';
import { storageService } from './storageService';
import { userService } from './userService';

/**
 * Customer engagement on the SaaS backend (services/customerEngagement): the OS
 * notification permission, the "Never miss an update" education screen, and the one-time
 * rating popup after a delivered order. Events also go to GA4 under the same names.
 */
export type RatingPrompt = {
  requestId: string;
  orderId: string;
  orderNumber: string;
  orderType: string;
  deliveredAt: string;
  restaurant: { name: string; logoUrl: string | null };
  items: { name: string; quantity: number }[];
  rider: { name: string } | null;
};
export type PermissionEducation =
  | { eligible: true; mode: 'REQUEST' | 'OPEN_SETTINGS' }
  | { eligible: false; reason: string };
export type HomeEngagement = {
  permission: { status: string; canAskAgain: boolean | null };
  ratingPrompt: RatingPrompt | null;
  permissionEducation: PermissionEducation;
};
export type PermissionEvent =
  | 'permission_education_viewed'
  | 'permission_enable_clicked'
  | 'permission_later_clicked'
  | 'os_permission_granted'
  | 'os_permission_denied'
  | 'notification_settings_opened';

const appVersion = String(Constants.expoConfig?.version || '').slice(0, 32) || null;
const client = () => ({ platform: Platform.OS === 'ios' ? 'ios' : 'android', appVersion });

export const engagementService = {
  home: (state: OsPermissionState) =>
    apiClient.post<HomeEngagement>('/public/customers/me/engagement/home', { ...state, ...client() }),

  reportPermission: (state: OsPermissionState) =>
    apiClient.post<{ status: string; canAskAgain: boolean | null }>('/public/customers/me/notification-permission', { ...state, ...client() }),

  permissionEvent: (event: PermissionEvent) => {
    track(event, { platform: Platform.OS });
    return apiClient.post<{ recorded: boolean }>('/public/customers/me/notification-permission/events', { event, ...client() }).catch((error) => {
      console.log(`engagement event ${event} not recorded:`, error);
    });
  },

  ratingShown: (requestId: string) => {
    track('rating_popup_viewed');
    return apiClient.post(`/public/customers/me/rating-requests/${encodeURIComponent(requestId)}/shown`, client()).catch((error) => {
      console.log('rating popup impression not recorded:', error);
    });
  },
  ratingDismiss: (requestId: string) => {
    track('rating_popup_dismissed');
    return apiClient.post<{ status: string }>(`/public/customers/me/rating-requests/${encodeURIComponent(requestId)}/dismiss`, client());
  },
  ratingSubmit: (requestId: string, rating: number, comment: string) => {
    track('rating_popup_submitted', { rating, has_review: comment.trim() ? 1 : 0 });
    return apiClient.post<{ status: string; alreadyRated: boolean }>(`/public/customers/me/rating-requests/${encodeURIComponent(requestId)}/submit`, {
      rating,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
      ...client(),
    });
  },
};

/** Saves the device's push token on the account when it differs from what's stored. */
export async function savePushToken(uid: string, token: PushTokenData | null, known?: { pushToken?: string | null; pushTokenType?: string | null }) {
  if (!token) return false;
  if (known && known.pushToken === token.token && known.pushTokenType === token.tokenType) return false;
  const update = { pushToken: token.token, pushTokenType: token.tokenType, pushTokenUpdatedAt: new Date().toISOString() };
  await userService.updateUserProfile(uid, update);
  await storageService.updateUserProfile(update);
  return true;
}

/**
 * First ask, right after sign-in (or at launch for a signed-in customer): if the phone has never been asked (Android 13+ / iOS
 * "undetermined"), show the OS dialog once so order-status pushes work for the customer's
 * very first order. Anyone who declines falls into the normal flow: the "Never miss an
 * update" education screen after their first delivered order (components/EngagementPrompts),
 * its cooldown, and "Open Settings" once the OS won't ask again. Already granted/denied
 * phones are never prompted here — this only re-reads and reports, like before.
 */
export async function askPermissionOnFirstSignIn(uid: string, known?: { pushToken?: string | null; pushTokenType?: string | null }) {
  const result = await notificationService.askIfNeverAsked();
  if (!result) return refreshNotificationPermission(uid, known);
  void engagementService.permissionEvent(result.granted ? 'os_permission_granted' : 'os_permission_denied');
  const next: OsPermissionState = { osStatus: result.granted ? 'granted' : 'denied', canAskAgain: result.canAskAgain };
  await engagementService.reportPermission(next).catch((error) => console.log('permission report failed:', error));
  if (result.granted) await savePushToken(uid, result.token, known).catch((error) => console.log('push token save failed:', error));
  return next;
}

/** Re-reads the OS permission, tells the backend, and registers the token if allowed.
 *  Never shows the OS dialog. Used on resume and after leaving device settings. */
export async function refreshNotificationPermission(uid: string, known?: { pushToken?: string | null; pushTokenType?: string | null }) {
  const state = await notificationService.getPermissionState();
  await engagementService.reportPermission(state).catch((error) => console.log('permission report failed:', error));
  if (state.osStatus === 'granted') await savePushToken(uid, await notificationService.getTokenIfPermitted(), known);
  return state;
}
