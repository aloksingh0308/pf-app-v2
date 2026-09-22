import { Platform } from 'react-native';

export const getInstallReferrer = async (): Promise<string | null> => {
  if (Platform.OS !== 'android') return null;
  try {
    const PlayInstallReferrer = require('react-native-play-install-referrer').default;
    const response = await PlayInstallReferrer.getInstallReferrer();
    // response.installReferrer might be: "referral=XXXX"
    const match = response.installReferrer.match(/referral=([A-Z0-9]+)/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
};
