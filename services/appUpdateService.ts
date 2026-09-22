import { apiClient } from '../utils/apiClient';

export type AndroidAppUpdateConfig = {
  latestVersion?: string;
  minRequiredVersion?: string;
  forceUpdate?: boolean;
  storeUrl?: string;
  title?: string;
  message?: string;
};

/** Replaces the Firestore `app_updates`/`app_settings` docs with the (platform-wide, not
 *  per-organization) `GET /public/app-update/:platform` endpoint — see
 *  backend/src/models/AppUpdateConfig.ts. Writing this config has no endpoint yet (no admin
 *  UI exists to set it on either side), so `setAndroidUpdateConfig` is a documented no-op
 *  rather than silently pretending to succeed. */
export const appUpdateService = {
  getAndroidUpdateConfig: async (): Promise<AndroidAppUpdateConfig | null> => {
    try {
      return await apiClient.get<AndroidAppUpdateConfig | null>('/public/app-update/android');
    } catch (error) {
      console.warn('Failed to fetch Android update config:', error);
      return null;
    }
  },

  setAndroidUpdateConfig: async (_config: AndroidAppUpdateConfig): Promise<void> => {
    console.warn('setAndroidUpdateConfig is not supported yet — no admin endpoint exists for it.');
  },
};
