import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

export type OsPermissionState = { osStatus: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean | null };
export type PushTokenData = { token: string; tokenType: 'fcm' | 'apns' };

async function readDeviceToken(): Promise<PushTokenData | null> {
  try {
    await notificationService.configureAndroidChannel();
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    if (!devicePushToken?.data) return null;
    const rawType = String(devicePushToken.type || '').toLowerCase();
    const tokenType: 'fcm' | 'apns' = rawType.includes('fcm') || rawType === 'android'
      ? 'fcm'
      : rawType.includes('apns') || rawType === 'ios'
        ? 'apns'
        : (Platform.OS === 'android' ? 'fcm' : 'apns');
    return { token: String(devicePushToken.data), tokenType };
  } catch (error) {
    const message = String((error as Error)?.message || error || '');
    if (Platform.OS === 'ios' && message.toLowerCase().includes('aps-environment')) {
      console.log('Push notifications unavailable: missing aps-environment entitlement for this iOS build.');
      return null;
    }
    console.log('Error registering push notifications:', error);
    return null;
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let pendingAsk: Promise<{ granted: boolean; canAskAgain: boolean | null; token: PushTokenData | null } | null> | null = null;

export const notificationService = {
  configureAndroidChannel: async () => {
    if (Platform.OS !== 'android') return;

    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f68712',
      sound: 'default',
    });
  },

  /** The device's current answer — never shows the OS dialog. */
  getPermissionState: async (): Promise<OsPermissionState> => {
    try {
      const p = await Notifications.getPermissionsAsync();
      const osStatus = p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined';
      return { osStatus, canAskAgain: p.canAskAgain ?? null };
    } catch {
      return { osStatus: 'undetermined', canAskAgain: null };
    }
  },

  /**
   * The push token, ONLY if the customer already allowed notifications. Never prompts —
   * the OS dialog is only ever opened by requestPermissionFromUser(): once right after
   * sign-in on a never-asked phone (askPermissionOnFirstSignIn), or when the customer taps
   * "Enable notifications" on the app's explanation screen (EngagementPrompts).
   * Re-read on every launch/resume: an old token doesn't mean permission is still on.
   */
  getTokenIfPermitted: async (): Promise<PushTokenData | null> => {
    const { osStatus } = await notificationService.getPermissionState();
    if (osStatus !== 'granted') return null;
    return readDeviceToken();
  },

  /** Opens the OS permission dialog (explicit customer action only) and, if allowed,
   *  returns the token. `canAskAgain: false` = the OS won't ask again; use settings. */
  requestPermissionFromUser: async (): Promise<{ granted: boolean; canAskAgain: boolean | null; token: PushTokenData | null }> => {
    try {
      await notificationService.configureAndroidChannel();
      const result = await Notifications.requestPermissionsAsync();
      const granted = result.status === 'granted';
      return { granted, canAskAgain: result.canAskAgain ?? null, token: granted ? await readDeviceToken() : null };
    } catch (error) {
      console.log('Notification permission request failed:', error);
      return { granted: false, canAskAgain: null, token: null };
    }
  },

  /**
   * Shows the OS dialog only if this phone has never been asked (Android 13+ / iOS
   * "undetermined"). Returns null when nothing was asked. Single-flight: a launch-time ask
   * and the sign-in ask running together share one dialog and one answer.
   */
  askIfNeverAsked: (): Promise<{ granted: boolean; canAskAgain: boolean | null; token: PushTokenData | null } | null> => {
    if (pendingAsk) return pendingAsk;
    pendingAsk = (async () => {
      const state = await notificationService.getPermissionState();
      if (state.osStatus !== 'undetermined' || state.canAskAgain === false) return null;
      return notificationService.requestPermissionFromUser();
    })().finally(() => {
      // Keep the settled answer briefly so a caller arriving right after reuses it.
      setTimeout(() => (pendingAsk = null), 5000);
    });
    return pendingAsk;
  },

  /** The app's own notification page in device settings. */
  openSystemSettings: async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.log('Could not open notification settings:', error);
    }
  },

  addForegroundNotificationListener: (onReceive: (notification: Notifications.Notification) => void) => {
    return Notifications.addNotificationReceivedListener(onReceive);
  },

  addNotificationResponseListener: (onResponse: (response: Notifications.NotificationResponse) => void) => {
    return Notifications.addNotificationResponseReceivedListener(onResponse);
  },
};
