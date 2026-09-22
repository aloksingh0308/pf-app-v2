import scratchRewardConfig from '@/constants/scratchRewardConfig';
import { EligibleReward, ScratchRewardConfig } from '@/types/rewardEngine';

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildFreeItemRewards = (orderAmount: number, config: ScratchRewardConfig): EligibleReward[] => {
  return config.freeItems
    .filter((item) => orderAmount >= toNumber(item.unlockOrder, 0))
    .map((item) => ({
      id: String(item.id),
      kind: 'FREE_ITEM' as const,
      title: String(item.title || 'Free Item'),
      description: String(item.description || ''),
      weight: toNumber(item.weight, 0),
      unlockOrder: toNumber(item.unlockOrder, 0),
      minimumOrder: toNumber(item.minimumOrder, 0),
      expiryDays: Math.max(1, toNumber(item.expiryDays, 7)),
      couponPrefix: String(item.couponPrefix || 'FREE'),
      discountType: 'Freebie' as const,
      discountValue: 0,
      maximumDiscount: 0,
      freeItemSku: String(item.freeItemSku || ''),
      multiplierPercent: 0,
    }));
};

const buildFlatRewards = (orderAmount: number, config: ScratchRewardConfig): EligibleReward[] => {
  return config.flatDiscounts
    .filter((item) => orderAmount >= toNumber(item.unlockOrder, 0))
    .map((item) => ({
      id: String(item.id),
      kind: 'FLAT_DISCOUNT' as const,
      title: String(item.title || 'Flat Discount'),
      description: String(item.description || ''),
      weight: toNumber(item.weight, 0),
      unlockOrder: toNumber(item.unlockOrder, 0),
      minimumOrder: toNumber(item.minimumOrder, 0),
      expiryDays: Math.max(1, toNumber(item.expiryDays, 15)),
      couponPrefix: String(item.couponPrefix || 'OFF'),
      discountType: 'Flat' as const,
      discountValue: toNumber(item.discountValue, 0),
      maximumDiscount: 0,
      freeItemSku: '',
      multiplierPercent: 0,
    }));
};

const buildPercentageRewards = (orderAmount: number, config: ScratchRewardConfig): EligibleReward[] => {
  return config.percentageDiscounts
    .filter((item) => orderAmount >= toNumber(item.unlockOrder, 0))
    .map((item) => ({
      id: String(item.id),
      kind: 'PERCENTAGE_DISCOUNT' as const,
      title: String(item.title || 'Percentage Discount'),
      description: String(item.description || ''),
      weight: toNumber(item.weight, 0),
      unlockOrder: toNumber(item.unlockOrder, 0),
      minimumOrder: toNumber(item.minimumOrder, 0),
      expiryDays: Math.max(1, toNumber(item.expiryDays, 15)),
      couponPrefix: String(item.couponPrefix || 'SAVE'),
      discountType: 'Percentage' as const,
      discountValue: toNumber(item.discountPercent, 0),
      maximumDiscount: toNumber(item.maximumDiscount, 0),
      freeItemSku: '',
      multiplierPercent: 0,
    }));
};

const buildCoinRewards = (orderAmount: number, config: ScratchRewardConfig): EligibleReward[] => {
  return config.coins
    .filter((item) => orderAmount >= toNumber(item.unlockOrder, 0))
    .map((item) => ({
      id: String(item.id),
      kind: 'COINS' as const,
      title: String(item.title || 'Reward Coins'),
      description: String(item.description || ''),
      weight: toNumber(item.weight, 0),
      unlockOrder: toNumber(item.unlockOrder, 0),
      minimumOrder: 0,
      expiryDays: 0,
      couponPrefix: 'COINS',
      discountType: 'Coins' as const,
      discountValue: 0,
      maximumDiscount: 0,
      freeItemSku: '',
      multiplierPercent: toNumber(item.multiplierPercent, 0),
    }));
};

export function getEligibleRewards(orderAmount: number, config: ScratchRewardConfig = scratchRewardConfig): EligibleReward[] {
  const normalizedOrderAmount = toNumber(orderAmount, 0);
  if (normalizedOrderAmount <= 0) {
    return [];
  }

  return [
    ...buildFreeItemRewards(normalizedOrderAmount, config),
    ...buildFlatRewards(normalizedOrderAmount, config),
    ...buildPercentageRewards(normalizedOrderAmount, config),
    ...buildCoinRewards(normalizedOrderAmount, config),
  ];
}
