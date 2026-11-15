import { apiClient } from '../utils/apiClient';

/**
 * The customer's notification choices on the SaaS backend. Order updates (transactional)
 * are always sent; each promotional category can be switched off on its own.
 * `promotional` = at least one category is on (what older app versions used).
 */
export type PromoCategory = 'favouriteRestaurants' | 'recommendations' | 'repeatOrderReminders' | 'offers';
export type NotificationPreferences = {
  promotional: boolean;
  transactional: boolean;
  orderUpdates?: boolean;
  /** Missing on a backend from before categories — the app then falls back to one switch. */
  categories?: Record<PromoCategory, boolean>;
};

export const notificationPreferenceService = {
  get: () => apiClient.get<NotificationPreferences>('/public/customers/me/notification-preferences'),
  setPromotional: (promotional: boolean) =>
    apiClient.patch<NotificationPreferences>('/public/customers/me/notification-preferences', { promotional }),
  setCategory: (category: PromoCategory, enabled: boolean) =>
    apiClient.patch<NotificationPreferences>('/public/customers/me/notification-preferences', { [category]: enabled }),
  /** Tells the backend an automated notification was tapped (repeat-order analytics). */
  reportOpened: (notificationLogId: string) =>
    apiClient.post<{ recorded: boolean }>(`/public/customers/me/notifications/${encodeURIComponent(notificationLogId)}/opened`),
};
