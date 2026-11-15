import { apiClient } from '../utils/apiClient';

export type RestaurantReferralStatus = 'CLAIMED' | 'PENDING' | 'UNDER_REVIEW' | 'CREDITED' | 'EXPIRED' | 'REJECTED';

export interface RestaurantReferral {
  id: string;
  refereeName: string;
  status: RestaurantReferralStatus;
  progress: { sales: number };
  target: { sales?: number };
  reward: number;
  startedAt: string;
  expiresAt: string | null;
  creditedAt: string | null;
}

/** "Refer a restaurant" (backend services/referral): the customer's PF code, the reward that
 *  lands in their wallet once the restaurant reaches `minSales` within `windowDays`, and the
 *  restaurants they've referred so far. */
export interface RestaurantReferralSummary {
  enabled: boolean;
  code: string;
  /** The website's restaurant sign-up form with the code filled in. */
  shareUrl: string;
  reward: number;
  minSales: number;
  windowDays: number;
  earnedTotal: number;
  referrals: RestaurantReferral[];
}

export const restaurantReferralService = {
  getSummary: (): Promise<RestaurantReferralSummary> => apiClient.get('/public/customers/me/restaurant-referrals'),
};

export const formatRupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
