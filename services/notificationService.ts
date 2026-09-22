import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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

  registerForPushNotificationsAsync: async (): Promise<{ token: string; tokenType: string } | null> => {
    try {
      await notificationService.configureAndroidChannel();

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        return null;
      }

      const devicePushToken = await Notifications.getDevicePushTokenAsync();
      if (!devicePushToken?.data) {
        return null;
      }

      const rawType = String(devicePushToken.type || '').toLowerCase();
      const tokenType = rawType.includes('fcm') || rawType === 'android'
        ? 'fcm'
        : rawType.includes('apns') || rawType === 'ios'
          ? 'apns'
          : (Platform.OS === 'android' ? 'fcm' : 'apns');

      return {
        token: String(devicePushToken.data),
        tokenType,
      };
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      const isApsEntitlementMissing =
        Platform.OS === 'ios' &&
        message.toLowerCase().includes('aps-environment');

      if (isApsEntitlementMissing) {
        console.log('Push notifications unavailable: missing aps-environment entitlement for this iOS build.');
        return null;
      }

      console.log('Error registering push notifications:', error);
      return null;
    }
  },

  addForegroundNotificationListener: (onReceive: (notification: Notifications.Notification) => void) => {
    return Notifications.addNotificationReceivedListener(onReceive);
  },

  addNotificationResponseListener: (onResponse: (response: Notifications.NotificationResponse) => void) => {
    return Notifications.addNotificationResponseReceivedListener(onResponse);
  },
};
