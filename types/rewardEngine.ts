export type RewardKind = 'FREE_ITEM' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'COINS';

export type FreeItemConfig = {
  id: string;
  title: string;
  description: string;
  freeItemSku: string;
  unlockOrder: number;
  minimumOrder: number;
  weight: number;
  expiryDays: number;
  couponPrefix: string;
};

export type FlatDiscountConfig = {
  id: string;
  title: string;
  description: string;
  discountValue: number;
  unlockOrder: number;
  minimumOrder: number;
  weight: number;
  expiryDays: number;
  couponPrefix: string;
};

export type PercentageDiscountConfig = {
  id: string;
  title: string;
  description: string;
  discountPercent: number;
  maximumDiscount: number;
  unlockOrder: number;
  minimumOrder: number;
  weight: number;
  expiryDays: number;
  couponPrefix: string;
};

export type CoinConfig = {
  id: string;
  title: string;
  description: string;
  multiplierPercent: number;
  unlockOrder: number;
  weight: number;
};

export type ScratchRewardConfig = {
  freeItems: FreeItemConfig[];
  flatDiscounts: FlatDiscountConfig[];
  percentageDiscounts: PercentageDiscountConfig[];
  coins: CoinConfig[];
};

export type EligibleReward = {
  id: string;
  kind: RewardKind;
  title: string;
  description: string;
  weight: number;
  unlockOrder: number;
  minimumOrder: number;
  expiryDays: number;
  couponPrefix: string;
  discountType: 'Flat' | 'Percentage' | 'Freebie' | 'Coins';
  discountValue: number;
  maximumDiscount: number;
  freeItemSku: string;
  multiplierPercent: number;
};

export type ScratchGeneratedCoupon = {
  id: string;
  code: string;
  couponCode: string;
  userId: string;
  orderId: string;
  rewardType: string;
  discountType: 'Flat' | 'Percentage' | 'Freebie';
  discountValue: number;
  minimumOrder: number;
  maximumDiscount: number;
  freeItemSku: string;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  createdFrom: 'SCRATCH';
  createdAt: unknown;
  expiryDate: unknown;
};

export type ScratchOrderRewardMeta = {
  generated: boolean;
  scratched: boolean;
  rewardType: RewardKind;
  couponId: string;
  coinsEarned: number;
  generatedAt: unknown;
};

export type ScratchGenerationResult = {
  orderId: string;
  deal: EligibleReward;
  coupon: ScratchGeneratedCoupon | null;
  reward: ScratchOrderRewardMeta;
};
