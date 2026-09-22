import { COLLECTION_NAMES, SUBCOLLECTIONS } from '@/config/database';
import { rewardDeals as rewardDealsFallback } from '@/constants/rewardDeals';
import { RewardGeneratorService } from '@/services/rewardGeneratorService';
import { ScratchGenerationResult } from '@/types/rewardEngine';
import { getCollectionName, getSubcollectionName } from '@/utils/collectionResolver';
import { db } from '@/utils/firebase-config';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

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
  createdAt?: unknown;
};

export type RewardCoupon = {
  id: string;
  code: string;
  couponCode: string;
  userId: string;
  orderId: string;
  dealId: string;
  title: string;
  description: string;
  type: string;
  rewardValue: number;
  minOrderAmount: number;
  status: 'ACTIVE' | 'USED' | 'EXPIRED';
  isActive: boolean;
  createdFrom: 'SCRATCH_CARD' | 'SCRATCH';
  createdAt: Timestamp;
  expiry: Timestamp;
};

export type OrderRewardMeta = {
  generated: boolean;
  scratched: boolean;
  rewardType?: 'FREE_ITEM' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'COINS';
  couponId: string;
  coinsEarned?: number;
  dealId: string;
  generatedAt: Timestamp;
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
  rewardType?: 'FREE_ITEM' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'COINS';
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

const toBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

const isEligibleOrderStatus = (status: unknown) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('failed')) {
    return false;
  }
  return true;
};

const mapDealDoc = (docId: string, raw: Record<string, unknown>): RewardDeal => {
  const rewardValue = toNumber(
    raw.rewardValue ?? raw.discountValue ?? raw.discountAmount ?? raw.cashbackAmount ?? raw.discount,
    0
  );

  return {
    id: docId,
    title: String(raw.title || 'Reward'),
    description: String(raw.description || ''),
    type: String(raw.type || raw.rewardType || 'Flat'),
    couponPrefix: sanitizeCodePart(String(raw.couponPrefix || 'RW'), 'RW'),
    rewardValue,
    minOrder: toNumber(raw.minOrder ?? raw.minOrderAmount, 0),
    expiryDays: Math.max(1, toNumber(raw.expiryDays, 7)),
    probability: Math.max(0, toNumber(raw.probability, 1)),
    active: toBoolean(raw.active ?? raw.isActive, false),
    image: raw.image ? String(raw.image) : undefined,
    priority: toNumber(raw.priority, 0),
    createdAt: raw.createdAt,
  };
};

const mapCouponDoc = (docId: string, raw: Record<string, unknown>): RewardCoupon => {
  const code = String(raw.code || raw.couponCode || '').toUpperCase();
  const createdFromRaw = String(raw.createdFrom || 'SCRATCH').toUpperCase();
  const createdFrom: RewardCoupon['createdFrom'] = createdFromRaw === 'SCRATCH_CARD' ? 'SCRATCH_CARD' : 'SCRATCH';
  return {
    id: docId,
    code,
    couponCode: code,
    userId: String(raw.userId || ''),
    orderId: String(raw.orderId || ''),
    dealId: String(raw.dealId || ''),
    title: String(raw.title || ''),
    description: String(raw.description || ''),
    type: String(raw.type || raw.rewardType || 'Flat'),
    rewardValue: toNumber(raw.rewardValue ?? raw.discountValue, 0),
    minOrderAmount: toNumber(raw.minOrderAmount, 0),
    status: String(raw.status || 'ACTIVE').toUpperCase() as RewardCoupon['status'],
    isActive: toBoolean(raw.isActive, true),
    createdFrom,
    createdAt: (raw.createdAt as Timestamp) || Timestamp.now(),
    expiry: (raw.expiry as Timestamp) || Timestamp.now(),
  };
};

const selectDealByProbability = (deals: RewardDeal[]): RewardDeal | null => {
  if (!deals.length) return null;

  const weighted = deals.map((deal) => ({
    deal,
    weight: Math.max(0, toNumber(deal.probability, 0)),
  }));

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    const sortedByPriority = [...deals].sort((left, right) => toNumber(right.priority, 0) - toNumber(left.priority, 0));
    return sortedByPriority[0] || deals[0];
  }

  let cursor = Math.random() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.deal;
    }
  }

  return weighted[weighted.length - 1]?.deal || null;
};

const generateRandomAlphaNumeric = (length = 8): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
};

const buildCouponCode = (deal: RewardDeal, orderId: string) => {
  const prefix = sanitizeCodePart(deal.couponPrefix, 'RW');
  const randomPart = generateRandomAlphaNumeric(8);
  return `${prefix}${randomPart}`;
};

const buildCouponPayload = (
  couponCode: string,
  deal: RewardDeal,
  userId: string,
  orderId: string,
  dealId: string,
  now: Date
) => {
  const validTill = Timestamp.fromDate(new Date(now.getTime() + deal.expiryDays * 24 * 60 * 60 * 1000));
  const normalizedType = String(deal.type || '').toLowerCase();
  const discountType = normalizedType.includes('percent') ? 'Percentage' : 'Flat';

  return {
    code: couponCode,
    couponCode,
    userId,
    orderId,
    dealId,
    title: deal.title,
    description: deal.description,
    type: deal.type,
    rewardType: deal.type,
    rewardValue: deal.rewardValue,
    discountType,
    discountValue: deal.rewardValue,
    minOrderAmount: deal.minOrder,
    status: 'ACTIVE',
    isActive: true,
    singleUse: true,
    timesPerUser: 1,
    maxUsesPerUser: 1,
    usageLimit: 1,
    createdFrom: 'SCRATCH_CARD',
    createdAt: Timestamp.fromDate(now),
    expiry: validTill,
    validTill,
  };
};

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

const buildRewardDocId = (orderId: string) => `reward_${orderId}`;

const mapTimestampToMillis = (value: unknown): number => {
  const raw = value as any;
  if (typeof raw?.toMillis === 'function') {
    return raw.toMillis();
  }
  const parsed = new Date(String(raw || 0)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapRewardListDoc = (docId: string, raw: Record<string, unknown>): UserRewardItem => {
  const createdAtMs = mapTimestampToMillis(raw.generatedAt ?? raw.createdAt);
  const expiryMs = mapTimestampToMillis(raw.expiry ?? raw.validTill);
  const coinsEarned = toNumber(raw.coinsEarned, 0);
  const rewardType = String(raw.rewardType || '').trim().toUpperCase() as UserRewardItem['rewardType'];
  const couponCode = String(raw.couponCode || raw.code || '').toUpperCase();
  const fallbackCode = rewardType === 'COINS' ? '' : 'PENDING';

  return {
    rewardId: docId,
    orderId: String(raw.orderId || ''),
    couponId: String(raw.couponId || ''),
    couponCode: couponCode || fallbackCode,
    rewardType,
    coinsEarned,
    title: String(raw.title || 'Reward'),
    description: String(raw.description || ''),
    scratched: Boolean(raw.scratched),
    status: String(raw.status || 'ACTIVE'),
    isActive: Boolean(raw.isActive ?? true),
    createdAtMs,
    expiryMs,
  };
};

export const rewardService = {
  async fetchActiveDeals(): Promise<RewardDeal[]> {
    const dealsRef = collection(db, getCollectionName(COLLECTION_NAMES.DEALS));
    const snapshot = await getDocs(dealsRef);

    const firestoreDeals = snapshot.docs
      .map((docSnap) => mapDealDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
      .filter((deal) => deal.active)
      .sort((left, right) => toNumber(right.priority, 0) - toNumber(left.priority, 0));

    if (firestoreDeals.length > 0) {
      return firestoreDeals;
    }

    return rewardDealsFallback
      .map((deal) => mapDealDoc(String(deal.id), deal as unknown as Record<string, unknown>))
      .filter((deal) => deal.active)
      .sort((left, right) => toNumber(right.priority, 0) - toNumber(left.priority, 0));
  },

  async createCoupon(params: {
    deal: RewardDeal;
    userId: string;
    orderId: string;
    dealId?: string;
    couponId?: string;
  }): Promise<RewardCoupon> {
    const { deal, userId, orderId } = params;
    const dealId = String(params.dealId || deal.id || '').trim();
    if (!dealId) {
      throw new Error('dealId is required for coupon creation');
    }

    const couponDocId = String(params.couponId || `scratch_${orderId}`).trim();
    const couponRef = doc(db, getCollectionName(COLLECTION_NAMES.COUPONS), couponDocId);
    const existingSnap = await getDoc(couponRef);
    if (existingSnap.exists()) {
      return mapCouponDoc(existingSnap.id, existingSnap.data() as Record<string, unknown>);
    }

    const now = new Date();
    const couponCode = buildCouponCode(deal, orderId);
    const payload = buildCouponPayload(couponCode, deal, userId, orderId, dealId, now);
    await setDoc(couponRef, payload);

    return mapCouponDoc(couponRef.id, payload as Record<string, unknown>);
  },

  async markOrderRewardGenerated(orderId: string, updates: Partial<OrderRewardMeta>) {
    const resolvedOrderId = await resolveOrderDocId(orderId);
    if (!resolvedOrderId) {
      return;
    }

    const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), resolvedOrderId);
    const rewardRef = doc(db, getCollectionName(COLLECTION_NAMES.REWARDS), buildRewardDocId(resolvedOrderId));
    await runTransaction(db, async (transaction) => {
      const [orderSnap, rewardSnap] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(rewardRef),
      ]);

      if (!orderSnap.exists()) {
        return;
      }

      const orderData = orderSnap.data() as Record<string, unknown>;
      const orderReward = (orderData.reward || {}) as Record<string, unknown>;
      const rewardData = rewardSnap.exists() ? (rewardSnap.data() as Record<string, unknown>) : {};
      const now = Timestamp.now();

      const patch: Record<string, unknown> = {};
      if (typeof updates.generated === 'boolean') patch['reward.generated'] = updates.generated;
      if (typeof updates.scratched === 'boolean') patch['reward.scratched'] = updates.scratched;
      if (updates.rewardType) patch['reward.rewardType'] = updates.rewardType;
      if (updates.couponId) patch['reward.couponId'] = updates.couponId;
      if (typeof updates.coinsEarned === 'number') patch['reward.coinsEarned'] = updates.coinsEarned;
      if (updates.dealId) patch['reward.dealId'] = updates.dealId;
      if (updates.generatedAt) patch['reward.generatedAt'] = updates.generatedAt;
      if (updates.scratched === true) {
        patch['reward.scratched'] = true;
        patch['reward.scratchedAt'] = now;
      }

      const rewardPatch: Record<string, unknown> = {
        updatedAt: now,
      };
      if (typeof updates.generated === 'boolean') rewardPatch.generated = updates.generated;
      if (typeof updates.scratched === 'boolean') rewardPatch.scratched = updates.scratched;
      if (updates.rewardType) rewardPatch.rewardType = updates.rewardType;
      if (updates.couponId) rewardPatch.couponId = updates.couponId;
      if (typeof updates.coinsEarned === 'number') rewardPatch.coinsEarned = updates.coinsEarned;
      if (updates.dealId) rewardPatch.dealId = updates.dealId;
      if (updates.generatedAt) rewardPatch.generatedAt = updates.generatedAt;
      if (updates.scratched === true) {
        rewardPatch.scratched = true;
        rewardPatch.scratchedAt = now;
      }

      const resolvedRewardType = String(
        updates.rewardType
        || rewardData.rewardType
        || orderReward.rewardType
        || ''
      ).trim().toUpperCase();
      const resolvedCoinsEarned = toNumber(
        updates.coinsEarned
        ?? rewardData.coinsEarned
        ?? orderReward.coinsEarned,
        0
      );
      const alreadyCredited = Boolean(rewardData.coinsCredited ?? orderReward.coinsCredited);
      const resolvedUserId = String(
        rewardData.userId
        || orderData.userId
        || orderData.customerId
        || ''
      ).trim();

      if (updates.scratched === true && resolvedRewardType === 'COINS' && resolvedCoinsEarned > 0 && !alreadyCredited && resolvedUserId) {
        const customerRef = doc(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS), resolvedUserId);
        const walletTxRef = doc(
          db,
          getCollectionName(COLLECTION_NAMES.CUSTOMERS),
          resolvedUserId,
          getSubcollectionName(SUBCOLLECTIONS.WALLET_TRANSACTIONS),
          `scratch_coin_${resolvedOrderId}`
        );

        const [customerSnap, walletTxSnap] = await Promise.all([
          transaction.get(customerRef),
          transaction.get(walletTxRef),
        ]);

        if (customerSnap.exists()) {
          const safeCoins = Math.max(0, Math.floor(resolvedCoinsEarned));
          if (safeCoins > 0) {
            const prevCoin = Number(customerSnap.data().earnedCoin || 0);
            transaction.update(customerRef, { earnedCoin: prevCoin + safeCoins });

            if (!walletTxSnap.exists()) {
              transaction.set(walletTxRef, {
                uid: resolvedUserId,
                type: 'credit',
                amount: safeCoins,
                description: 'Scratch reward coins credited',
                referenceId: resolvedOrderId,
                metadata: {
                  source: 'SCRATCH_REWARD',
                  unit: 'coins',
                },
                createdAt: now,
              });
            }

            patch['reward.coinsCredited'] = true;
            patch['reward.coinsCreditedAt'] = now;
            rewardPatch.coinsCredited = true;
            rewardPatch.coinsCreditedAt = now;
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        transaction.update(orderRef, patch);
      }
      transaction.set(rewardRef, rewardPatch, { merge: true });
    });
  },

  async generateReward(orderId: string, userId?: string | null): Promise<GeneratedReward | null> {
    const generated = await RewardGeneratorService.generateOnScratch(orderId, userId);
    if (!generated) {
      return null;
    }

    const mappedDeal: RewardDeal = {
      id: generated.deal.id,
      title: generated.deal.title,
      description: generated.deal.description,
      type: generated.deal.kind,
      couponPrefix: generated.deal.couponPrefix,
      rewardValue: generated.deal.kind === 'COINS' ? generated.deal.multiplierPercent : generated.deal.discountValue,
      minOrder: generated.deal.minimumOrder,
      expiryDays: generated.deal.expiryDays,
      probability: generated.deal.weight,
      active: true,
      priority: 0,
    };

    return {
      orderId: generated.orderId,
      deal: mappedDeal,
      coupon: generated.coupon
        ? mapCouponDoc(generated.coupon.id, generated.coupon as unknown as Record<string, unknown>)
        : null,
      reward: {
        generated: generated.reward.generated,
        scratched: generated.reward.scratched,
        rewardType: generated.reward.rewardType,
        couponId: generated.reward.couponId,
        coinsEarned: generated.reward.coinsEarned,
        dealId: generated.deal.id,
        generatedAt: generated.reward.generatedAt as Timestamp,
      },
    };
  },

  async getRewardForOrder(orderId: string): Promise<GeneratedReward | null> {
    const resolvedOrderId = await resolveOrderDocId(orderId);
    if (!resolvedOrderId) {
      return null;
    }

    const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), resolvedOrderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) {
      return null;
    }

    const orderData = orderSnap.data() as Record<string, unknown>;
    const rewardDocRef = doc(db, getCollectionName(COLLECTION_NAMES.REWARDS), buildRewardDocId(resolvedOrderId));
    const rewardDocSnap = await getDoc(rewardDocRef);
    const rewardFromDoc = rewardDocSnap.exists()
      ? (rewardDocSnap.data() as Record<string, unknown>)
      : null;

    const reward = (orderData.reward || null) as Partial<OrderRewardMeta> | null;
    if (!reward?.generated) {
      if (!rewardFromDoc?.generated) {
        return null;
      }
    }

    const resolvedCouponId = String((rewardFromDoc?.couponId as string) || reward?.couponId || '');
    let couponSnapData: Record<string, unknown> | null = null;
    let couponDocId = resolvedCouponId;
    if (resolvedCouponId) {
      const couponRef = doc(
        db,
        getCollectionName(COLLECTION_NAMES.COUPONS),
        resolvedCouponId
      );
      const couponSnap = await getDoc(couponRef);
      if (couponSnap.exists()) {
        couponSnapData = couponSnap.data() as Record<string, unknown>;
        couponDocId = couponSnap.id;
      }
    }

    const dealId = String((rewardFromDoc?.dealId as string) || reward?.dealId || '');
    let deal: RewardDeal = {
      id: dealId,
      title: 'Reward',
      description: '',
      type: String((rewardFromDoc?.rewardType as string) || reward?.rewardType || 'Flat'),
      couponPrefix: 'RW',
      rewardValue: toNumber((couponSnapData as Record<string, unknown> | null)?.rewardValue ?? rewardFromDoc?.discountValue, 0),
      minOrder: toNumber((couponSnapData as Record<string, unknown> | null)?.minOrderAmount ?? rewardFromDoc?.minimumOrder, 0),
      expiryDays: 7,
      probability: 0,
      active: true,
      priority: 0,
    };

    if (dealId) {
      const dealSnap = await getDoc(doc(db, getCollectionName(COLLECTION_NAMES.DEALS), dealId));
      if (dealSnap.exists()) {
        deal = mapDealDoc(dealSnap.id, dealSnap.data() as Record<string, unknown>);
      }
    }

    return {
      orderId: resolvedOrderId,
      deal,
      coupon: couponSnapData ? mapCouponDoc(couponDocId, couponSnapData) : null,
      reward: {
        generated: true,
        scratched: Boolean(rewardFromDoc?.scratched ?? reward?.scratched),
        rewardType: String((rewardFromDoc?.rewardType as string) || reward?.rewardType || 'FLAT_DISCOUNT') as OrderRewardMeta['rewardType'],
        couponId: resolvedCouponId,
        coinsEarned: toNumber((rewardFromDoc?.coinsEarned as unknown) ?? reward?.coinsEarned, 0),
        dealId: String((rewardFromDoc?.dealId as string) || reward?.dealId || deal.id),
        generatedAt: (rewardFromDoc?.generatedAt as Timestamp) || (reward?.generatedAt as Timestamp) || Timestamp.now(),
      },
    };
  },

  async listUserRewards(userId: string): Promise<UserRewardItem[]> {
    const normalizedUid = String(userId || '').trim();
    if (!normalizedUid) {
      return [];
    }

    const rewardsRef = collection(db, getCollectionName(COLLECTION_NAMES.REWARDS));
    const rewardsSnapshot = await getDocs(query(rewardsRef, where('userId', '==', normalizedUid)));

    if (!rewardsSnapshot.empty) {
      const rows = rewardsSnapshot.docs
        .map((docSnap) => mapRewardListDoc(docSnap.id, docSnap.data() as Record<string, unknown>));

      const couponsRef = collection(db, getCollectionName(COLLECTION_NAMES.COUPONS));
      const couponsSnapshot = await getDocs(query(couponsRef, where('userId', '==', normalizedUid)));
      const couponsById = new Map<string, Record<string, unknown>>();
      const couponsByOrderId = new Map<string, Record<string, unknown>>();

      couponsSnapshot.docs.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        const createdFrom = String(raw.createdFrom || '').toUpperCase();
        if (createdFrom !== 'SCRATCH_CARD' && createdFrom !== 'SCRATCH') {
          return;
        }

        const coupon = {
          id: docSnap.id,
          ...raw,
        } as Record<string, unknown>;

        couponsById.set(docSnap.id, coupon);
        const orderId = String(coupon.orderId || '').trim();
        if (orderId) {
          couponsByOrderId.set(orderId, coupon);
        }
      });

      const mergedRows = rows.map((row) => {
        const rewardType = String(row.rewardType || '').trim().toUpperCase();
        if (rewardType === 'COINS') {
          return row;
        }

        const coupon = couponsById.get(String(row.couponId || '')) || couponsByOrderId.get(String(row.orderId || ''));
        if (!coupon) {
          return row;
        }

        const status = String(coupon.status || row.status || 'ACTIVE').toUpperCase();
        const couponCode = String(coupon.code || coupon.couponCode || row.couponCode || '').toUpperCase();
        const expiryMs = mapTimestampToMillis(coupon.expiry ?? coupon.validTill) || row.expiryMs;

        return {
          ...row,
          couponId: String(coupon.id || row.couponId || ''),
          couponCode: couponCode || row.couponCode,
          status,
          isActive: status === 'ACTIVE' && toBoolean(coupon.isActive, row.isActive),
          expiryMs,
        };
      });

      return mergedRows.sort((left, right) => right.createdAtMs - left.createdAtMs);
    }

    // Backward compatibility for older data where rewards were inferred from coupons + order metadata.
    const couponsRef = collection(db, getCollectionName(COLLECTION_NAMES.COUPONS));
    const couponsSnapshot = await getDocs(query(couponsRef, where('userId', '==', normalizedUid)));
    const rewardCoupons = couponsSnapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Record<string, unknown>),
      } as Record<string, unknown> & { id: string }))
      .filter((coupon) => {
        const createdFrom = String(coupon.createdFrom || '').toUpperCase();
        return createdFrom === 'SCRATCH_CARD' || createdFrom === 'SCRATCH';
      });

    const rows = await Promise.all(
      rewardCoupons.map(async (coupon) => {
        const orderId = String(coupon.orderId || '').trim();
        let scratched = false;

        if (orderId) {
          const orderSnap = await getDoc(doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId));
          if (orderSnap.exists()) {
            scratched = Boolean((orderSnap.data() as any)?.reward?.scratched);
          }
        }

        const createdAtMs = mapTimestampToMillis(coupon.createdAt);
        const expiryMs = mapTimestampToMillis(coupon.expiry);

        return {
          orderId,
          couponId: String(coupon.id || ''),
          couponCode: String(coupon.code || coupon.couponCode || '').toUpperCase(),
          rewardType: String(coupon.rewardType || coupon.type || '').trim().toUpperCase() as UserRewardItem['rewardType'],
          coinsEarned: toNumber(coupon.coinsEarned, 0),
          title: String(coupon.title || 'Reward'),
          description: String(coupon.description || ''),
          scratched,
          status: String(coupon.status || 'ACTIVE'),
          isActive: Boolean(coupon.isActive),
          createdAtMs,
          expiryMs,
        } as UserRewardItem;
      })
    );

    return rows.sort((left, right) => right.createdAtMs - left.createdAtMs);
  },
};
