import { apiClient } from '../utils/apiClient';

/**
 * Scratch-card rewards (one per order) — backed by the restaurant-saas-platform's
 * `/public/customers/me/.../reward` endpoints (backend services/scratchReward.service.ts).
 * Replaces the former Firestore `rewards`/`coupons` writes and the client-side reward
 * generator: the prize is now rolled server-side, coupon rewards are real single-customer
 * coupons, and coin rewards are credited to the wallet once, when the card is scratched.
 * The exported shapes below are unchanged so the screens using them didn't need rewriting.
 */

export type RewardType = 'FREE_ITEM' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'COINS';

export type RewardDeal = {
  id: string;
  title: string;
  description: string;
  type: string;
  couponPrefix: string;
  rewardValue: number;
  minOrder: number;
  expiryDays: number;
  probability: number;
  active: boolean;
  image?: string;
  priority?: number;
};

export type RewardCoupon = {
  id: string;
  code: string;
  couponCode: string;
  orderId: string;
  title: string;
  description: string;
  type: string;
  rewardValue: number;
  minOrderAmount: number;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  isActive: boolean;
  createdFrom: 'SCRATCH_CARD';
  expiry: string | null;
};

export type OrderRewardMeta = {
  generated: boolean;
  scratched: boolean;
  rewardType?: RewardType;
  couponId: string;
  coinsEarned?: number;
  dealId: string;
  generatedAt: string;
};

export type GeneratedReward = {
  orderId: string;
  deal: RewardDeal;
  coupon: RewardCoupon | null;
  reward: OrderRewardMeta;
};

export type UserRewardItem = {
  orderId: string;
  couponId: string;
  couponCode: string;
  rewardType?: RewardType;
  coinsEarned?: number;
  rewardId?: string;
  title: string;
  description: string;
  scratched: boolean;
  status: string;
  isActive: boolean;
  createdAtMs: number;
  expiryMs: number;
};

interface BackendReward {
  id: string;
  orderId: string;
  rewardType: RewardType | 'NONE';
  title: string;
  description: string;
  rewardValue: number;
  minimumOrder: number;
  coinsEarned: number;
  couponId: string;
  couponCode: string;
  scratched: boolean;
  coinsCredited: boolean;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  expiresAt: string | null;
  createdAt: string;
}

const toMs = (value: string | null | undefined) => {
  const ms = value ? new Date(value).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
};

const rewardType = (reward: BackendReward): RewardType | undefined =>
  reward.rewardType === 'NONE' ? undefined : reward.rewardType;

function toGeneratedReward(reward: BackendReward): GeneratedReward {
  const type = rewardType(reward);
  return {
    orderId: reward.orderId,
    deal: {
      id: reward.id,
      title: reward.title || 'Scratch Reward',
      description: reward.description,
      type: type || '',
      couponPrefix: '',
      rewardValue: reward.rewardValue,
      minOrder: reward.minimumOrder,
      expiryDays: 0,
      probability: 0,
      active: true,
    },
    coupon: reward.couponCode
      ? {
          id: reward.couponId,
          code: reward.couponCode,
          couponCode: reward.couponCode,
          orderId: reward.orderId,
          title: reward.title,
          description: reward.description,
          type: type || '',
          rewardValue: reward.rewardValue,
          minOrderAmount: reward.minimumOrder,
          status: reward.status,
          isActive: reward.status === 'ACTIVE',
          createdFrom: 'SCRATCH_CARD',
          expiry: reward.expiresAt,
        }
      : null,
    reward: {
      generated: true,
      scratched: reward.scratched,
      rewardType: type,
      couponId: reward.couponId,
      coinsEarned: reward.coinsEarned,
      dealId: reward.id,
      generatedAt: reward.createdAt,
    },
  };
}

function toUserRewardItem(reward: BackendReward): UserRewardItem {
  return {
    orderId: reward.orderId,
    couponId: reward.couponId,
    couponCode: reward.couponCode,
    rewardType: rewardType(reward),
    coinsEarned: reward.coinsEarned,
    rewardId: reward.id,
    title: reward.title || 'Reward',
    description: reward.description,
    scratched: reward.scratched,
    status: reward.status,
    isActive: reward.status === 'ACTIVE',
    createdAtMs: toMs(reward.createdAt),
    expiryMs: toMs(reward.expiresAt),
  };
}

const orderRewardPath = (orderId: string) => `/public/customers/me/orders/${encodeURIComponent(String(orderId || '').trim())}/reward`;

export const rewardService = {
  /** The order's existing scratch card, or null if none has been generated yet. */
  async getRewardForOrder(orderId: string): Promise<GeneratedReward | null> {
    if (!String(orderId || '').trim()) return null;
    const reward = await apiClient.get<BackendReward | null>(orderRewardPath(orderId));
    return reward ? toGeneratedReward(reward) : null;
  },

  /** Rolls this order's scratch card server-side (idempotent — returns the existing one if
   *  it already has one). Null when the order doesn't qualify. `userId` is ignored — the
   *  backend identifies the customer from the session token. */
  async generateReward(orderId: string, userId?: string | null): Promise<GeneratedReward | null> {
    void userId;
    if (!String(orderId || '').trim()) return null;
    const reward = await apiClient.post<BackendReward | null>(orderRewardPath(orderId));
    return reward ? toGeneratedReward(reward) : null;
  },

  /** Only `scratched: true` is meaningful now — generation state lives server-side. Marking
   *  a card scratched is also what credits a coin reward to the wallet. */
  async markOrderRewardGenerated(orderId: string, updates: Partial<Pick<OrderRewardMeta, 'scratched'>>): Promise<void> {
    if (updates.scratched !== true || !String(orderId || '').trim()) return;
    // Retried once — a dropped request here would leave the card "scratch pending" on the
    // server even though the customer already revealed it on screen.
    try {
      await apiClient.post(`${orderRewardPath(orderId)}/scratch`);
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await apiClient.post(`${orderRewardPath(orderId)}/scratch`).catch(() => {
        throw error;
      });
    }
  },

  /** Every scratch card the logged-in customer has, newest first. `userId` is ignored (see
   *  generateReward). */
  async listUserRewards(userId: string): Promise<UserRewardItem[]> {
    if (!String(userId || '').trim()) return [];
    const rewards = await apiClient.get<BackendReward[]>('/public/customers/me/rewards');
    return rewards.map(toUserRewardItem);
  },
};
