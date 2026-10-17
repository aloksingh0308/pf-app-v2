import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { DATABASE_MODE } from './database';

/**
 * Which backend the app talks to, by app mode (EXPO_PUBLIC_DATABASE_MODE — see
 * config/database.ts and the `start:test` / `start:live` scripts):
 *
 *   LIVE → https://backend.prayagifoodwala.com/api
 *   TEST → the backend running on this computer (port 4000)
 *
 * In TEST the host is taken from where Metro served the JavaScript (Constants hostUri —
 * "localhost" over adb reverse on the emulator/USB, "192.168.x.x" on a Wi-Fi phone), so
 * it works on every kind of device without hard-coding an IP. For the emulator/USB case
 * also run `adb reverse tcp:4000 tcp:4000`. EXPO_PUBLIC_TEST_API_URL overrides the TEST
 * address (e.g. a LAN IP for a TEST-mode APK that has no Metro).
 *
 * `orgSlug`/`branchCode` are only a fallback default — the restaurant a screen talks to
 * is normally resolved per-screen (see services/restaurantContext.ts).
 */
export const LIVE_API_URL = 'https://backend.prayagifoodwala.com/api';
const LOCAL_API_PORT = 4000;

function localApiUrl(): string {
  const override = String(process.env.EXPO_PUBLIC_TEST_API_URL || '').trim();
  if (override) return override;
  const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (metroHost) return `http://${metroHost}:${LOCAL_API_PORT}/api`;
  // No Metro (a TEST-mode release build): the Android emulator's alias for this computer.
  return Platform.OS === 'android' ? `http://10.0.2.2:${LOCAL_API_PORT}/api` : `http://localhost:${LOCAL_API_PORT}/api`;
}

export const API_CONFIG = {
  mode: DATABASE_MODE,
  baseUrl: (DATABASE_MODE === 'LIVE' ? LIVE_API_URL : localApiUrl()).replace(/\/+$/, ''),
  orgSlug: process.env.EXPO_PUBLIC_ORG_SLUG || 'hungry-s-bucket-cafe',
  branchCode: process.env.EXPO_PUBLIC_BRANCH_CODE || 'MAIN',
};

if (__DEV__) {
  console.log(`[api] ${API_CONFIG.mode} mode → ${API_CONFIG.baseUrl}`);
}
