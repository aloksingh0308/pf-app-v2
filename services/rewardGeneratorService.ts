import { COLLECTION_NAMES } from '@/config/database';
import { getCollectionName } from '@/utils/collectionResolver';
import { getEligibleRewards } from '@/utils/getEligibleRewards';
import { weightedRandom } from '@/utils/weightedRandom';
import { db } from '@/utils/firebase-config';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import {
  EligibleReward,
  ScratchGeneratedCoupon,
  ScratchGenerationResult,
  ScratchOrderRewardMeta,
} from '@/types/rewardEngine';

const sanitizeCodePart = (value: string, fallback: string) => {
  const clean = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return clean || fallback;
};

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isEligibleOrderStatus = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('failed')) {
    return false;
  }
  return true;
};

const generateRandomAlphaNumeric = (length = 8): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
};

const buildCouponCode = (reward: EligibleReward) => {
  const prefix = sanitizeCodePart(reward.couponPrefix, 'RW');
  return `${prefix}${generateRandomAlphaNumeric(8)}`;
};

const buildRewardDocId = (orderId: string) => `reward_${orderId}`;

const resolveOrderDocId = async (orderIdentifier: string): Promise<string | null> => {
  const normalized = String(orderIdentifier || '').trim();
  if (!normalized) return null;

  const directRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), normalized);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) return directRef.id;

  const byDisplayIdSnap = await getDocs(
    query(
      collection(db, getCollectionName(COLLECTION_NAMES.ORDERS)),
      where('displayOrderId', '==', normalized)
    )
  );

  if (!byDisplayIdSnap.empty) {
    return byDisplayIdSnap.docs[0].id;
  }

  return null;
};

const mapTimestamp = (value: unknown): Timestamp => {
  if (value && typeof (value as any).toDate === 'function') {
    return value as Timestamp;
  }
  return Timestamp.now();
};

const toCoupon = (couponId: string, raw: Record<string, unknown>): ScratchGeneratedCoupon => {
  return {
    id: couponId,
    code: String(raw.code || raw.couponCode || '').toUpperCase(),
    couponCode: String(raw.couponCode || raw.code || '').toUpperCase(),
    userId: String(raw.userId || ''),
    orderId: String(raw.orderId || ''),
    rewardType: String(raw.rewardType || raw.type || ''),
    discountType: String(raw.discountType || 'Flat') as ScratchGeneratedCoupon['discountType'],
    discountValue: toNumber(raw.discountValue ?? raw.rewardValue, 0),
    minimumOrder: toNumber(raw.minimumOrder ?? raw.minOrderAmount, 0),
    maximumDiscount: toNumber(raw.maximumDiscount ?? raw.maxDiscount, 0),
    freeItemSku: String(raw.freeItemSku || ''),
    status: String(raw.status || 'ACTIVE').toUpperCase() as ScratchGeneratedCoupon['status'],
    createdFrom: 'SCRATCH',
    createdAt: mapTimestamp(raw.createdAt),
    expiryDate: mapTimestamp(raw.expiryDate ?? raw.expiry),
  };
};

const mapRewardMeta = (raw: Record<string, unknown>): ScratchOrderRewardMeta => {
  return {
    generated: Boolean(raw.generated),
    scratched: Boolean(raw.scratched),
    rewardType: String(raw.rewardType || 'FLAT_DISCOUNT') as ScratchOrderRewardMeta['rewardType'],
    couponId: String(raw.couponId || ''),
    coinsEarned: toNumber(raw.coinsEarned, 0),
    generatedAt: mapTimestamp(raw.generatedAt),
  };
};

const buildFallbackDealFromReward = (raw: Record<string, unknown>): EligibleReward => {
  const rewardType = String(raw.rewardType || '').toUpperCase();
  const fallbackKind: EligibleReward['kind'] =
    rewardType === 'FREE_ITEM'
      ? 'FREE_ITEM'
      : rewardType === 'PERCENTAGE_DISCOUNT'
        ? 'PERCENTAGE_DISCOUNT'
        : rewardType === 'COINS'
          ? 'COINS'
          : 'FLAT_DISCOUNT';

  const discountType: EligibleReward['discountType'] =
    fallbackKind === 'PERCENTAGE_DISCOUNT'
      ? 'Percentage'
      : fallbackKind === 'FREE_ITEM'
        ? 'Freebie'
        : fallbackKind === 'COINS'
          ? 'Coins'
          : 'Flat';

  return {
    id: String(raw.dealId || raw.rewardId || rewardType || 'LEGACY_REWARD'),
    kind: fallbackKind,
    title: String(raw.title || 'Reward'),
    description: String(raw.description || ''),
    weight: 0,
    unlockOrder: 0,
    minimumOrder: toNumber(raw.minimumOrder ?? raw.minOrderAmount, 0),
    expiryDays: 7,
    couponPrefix: String(raw.couponPrefix || 'RW'),
    discountType,
    discountValue: toNumber(raw.discountValue ?? raw.rewardValue, 0),
    maximumDiscount: toNumber(raw.maximumDiscount ?? raw.maxDiscount, 0),
    freeItemSku: String(raw.freeItemSku || ''),
    multiplierPercent: toNumber(raw.multiplierPercent, 0),
  };
};

export const RewardGeneratorService = {
  getEligibleRewards,
  weightedRandom,

  async generateOnScratch(orderId: string, userId?: string | null): Promise<ScratchGenerationResult | null> {
    const resolvedOrderId = await resolveOrderDocId(orderId);
    if (!resolvedOrderId) {
      return null;
    }

    const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), resolvedOrderId);
    const rewardRef = doc(db, getCollectionName(COLLECTION_NAMES.REWARDS), buildRewardDocId(resolvedOrderId));
    const couponRef = doc(db, getCollectionName(COLLECTION_NAMES.COUPONS), `scratch_${resolvedOrderId}`);

    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) {
      return null;
    }

    const orderData = orderSnap.data() as Record<string, unknown>;
    if (!isEligibleOrderStatus(orderData.status)) {
      return null;
    }

    const resolvedUserId = String(userId || orderData.userId || '').trim();
    if (!resolvedUserId) {
      return null;
    }

    const orderAmount = Math.max(
      toNumber(orderData.total, 0),
      toNumber((orderData.pricing as Record<string, unknown> | undefined)?.total, 0)
    );
    const eligibleRewards = getEligibleRewards(orderAmount);
    const selectedReward = weightedRandom(eligibleRewards);
    if (!selectedReward) {
      return null;
    }

    const txnResult = await runTransaction(db, async (transaction) => {
      const [freshOrderSnap, rewardSnap, couponSnap] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(rewardRef),
        transaction.get(couponRef),
      ]);

      if (!freshOrderSnap.exists()) {
        throw new Error('Order not found for scratch reward generation');
      }

      const currentOrderData = freshOrderSnap.data() as Record<string, unknown>;
      const existingOrderReward = (currentOrderData.reward || {}) as Record<string, unknown>;
      if (Boolean(existingOrderReward.generated)) {
        const rewardData = rewardSnap.exists() ? (rewardSnap.data() as Record<string, unknown>) : existingOrderReward;
        return {
          deal: buildFallbackDealFromReward(rewardData),
          reward: mapRewardMeta(rewardData),
          coupon: couponSnap.exists() ? toCoupon(couponRef.id, couponSnap.data() as Record<string, unknown>) : null,
        };
      }

      if (rewardSnap.exists()) {
        const rewardData = rewardSnap.data() as Record<string, unknown>;
        if (Boolean(rewardData.generated)) {
          return {
            deal: buildFallbackDealFromReward(rewardData),
            reward: mapRewardMeta(rewardData),
            coupon: couponSnap.exists() ? toCoupon(couponRef.id, couponSnap.data() as Record<string, unknown>) : null,
          };
        }
      }

      const now = Timestamp.now();
      const deal = selectedReward;
      const couponCode = buildCouponCode(deal);
      const couponExpiryDate = deal.kind === 'COINS'
        ? now
        : Timestamp.fromDate(new Date(Date.now() + deal.expiryDays * 24 * 60 * 60 * 1000));
      const coinsEarned = deal.kind === 'COINS'
        ? Math.max(0, Math.round((orderAmount * deal.multiplierPercent) / 100))
        : 0;

      let createdCoupon: ScratchGeneratedCoupon | null = null;

      if (deal.kind !== 'COINS') {
        const couponPayload = {
          code: couponCode,
          couponCode,
          userId: resolvedUserId,
          orderId: resolvedOrderId,
          rewardType: deal.kind,
          discountType: deal.discountType,
          discountValue: deal.kind === 'FREE_ITEM' ? 0 : deal.discountValue,
          minimumOrder: deal.minimumOrder,
          maximumDiscount: deal.maximumDiscount,
          freeItemSku: deal.freeItemSku,
          freeItemName: deal.title,
          status: 'ACTIVE',
          isActive: true,
          singleUse: true,
          timesPerUser: 1,
          maxUsesPerUser: 1,
          usageLimit: 1,
          createdFrom: 'SCRATCH',
          createdAt: now,
          expiryDate: couponExpiryDate,
          expiry: couponExpiryDate,
          validTill: couponExpiryDate,
          title: deal.title,
          description: deal.description,
          type: deal.kind,
          rewardValue: deal.kind === 'FREE_ITEM' ? 0 : deal.discountValue,
          minOrderAmount: deal.minimumOrder,
          dealId: deal.id,
        };

        if (!couponSnap.exists()) {
          transaction.set(couponRef, couponPayload);
          createdCoupon = toCoupon(couponRef.id, couponPayload as Record<string, unknown>);
        } else {
          createdCoupon = toCoupon(couponRef.id, couponSnap.data() as Record<string, unknown>);
        }
      }

      const rewardMeta: ScratchOrderRewardMeta = {
        generated: true,
        scratched: false,
        rewardType: deal.kind,
        couponId: createdCoupon?.id || '',
        coinsEarned,
        generatedAt: now,
      };

      transaction.update(orderRef, {
        reward: rewardMeta,
      });

      transaction.set(
        rewardRef,
        {
          id: rewardRef.id,
          orderId: resolvedOrderId,
          userId: resolvedUserId,
          dealId: deal.id,
          title: deal.title,
          description: deal.description,
          rewardType: deal.kind,
          discountType: deal.discountType,
          discountValue: deal.kind === 'FREE_ITEM' ? 0 : deal.discountValue,
          minimumOrder: deal.minimumOrder,
          maximumDiscount: deal.maximumDiscount,
          freeItemSku: deal.freeItemSku,
          multiplierPercent: deal.multiplierPercent,
          couponId: createdCoupon?.id || '',
          couponCode: createdCoupon?.couponCode || '',
          generated: true,
          scratched: false,
          coinsEarned,
          coinsCredited: false,
          coinsCreditedAt: null,
          createdFrom: 'SCRATCH',
          status: 'ACTIVE',
          isActive: true,
          generatedAt: now,
          expiry: couponExpiryDate,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return {
        deal,
        reward: rewardMeta,
        coupon: createdCoupon,
      };
    });

    if (!txnResult) {
      return null;
    }

    return {
      orderId: resolvedOrderId,
      deal: txnResult.deal,
      coupon: txnResult.coupon,
      reward: txnResult.reward,
    };
  },
};
