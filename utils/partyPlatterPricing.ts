import { PlatterType } from '@/types/PartyBooking';

export interface PartyPriceLineItem {
  itemId: string;
  name: string;
  premium: boolean;
  upgradePrice: number;
}

export interface PartyPriceBreakdownItem extends PartyPriceLineItem {
  chargedUpgradePrice: number;
  isFreeUpgrade: boolean;
}

export interface PartyPriceResult {
  basePrice: number;
  premiumUpgradeTotal: number;
  perPersonPrice: number;
  quantity: number;
  grandTotal: number;
  freeUpgradesUsed: number;
  /** null means unlimited (Deluxe-style platters) */
  freeUpgradesAvailable: number | null;
  items: PartyPriceBreakdownItem[];
}

/**
 * Reusable price engine for party platters. Works for any platter tier (Standard, Premium,
 * Deluxe, or any future tier) purely from `platterType.freePremiumUpgrades` /
 * `unlimitedPremiumItems` — no per-tier branching, so new tiers just work once added in Firestore.
 *
 * Free-upgrade slots (when limited) are applied to the highest-value premium items first, so the
 * customer always gets the best available benefit from their allowance.
 */
export function calculatePartyPlatterPrice(params: {
  platterType: Pick<PlatterType, 'price' | 'freePremiumUpgrades' | 'unlimitedPremiumItems'>;
  selectedItems: PartyPriceLineItem[];
  quantity: number;
}): PartyPriceResult {
  const { platterType, selectedItems, quantity } = params;

  const basePrice = Math.max(0, Number(platterType.price) || 0);
  const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
  const unlimited = Boolean(platterType.unlimitedPremiumItems);
  const freeAllowance = Math.max(0, Number(platterType.freePremiumUpgrades) || 0);

  const premiumEntries = selectedItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.premium)
    .sort((a, b) => (Number(b.item.upgradePrice) || 0) - (Number(a.item.upgradePrice) || 0));

  const freeSlotCount = unlimited ? premiumEntries.length : Math.min(freeAllowance, premiumEntries.length);
  const freeIndexSet = new Set(premiumEntries.slice(0, freeSlotCount).map(({ index }) => index));

  let premiumUpgradeTotal = 0;
  const items: PartyPriceBreakdownItem[] = selectedItems.map((item, index) => {
    const isFreeUpgrade = item.premium && freeIndexSet.has(index);
    const chargedUpgradePrice = item.premium && !isFreeUpgrade ? Math.max(0, Number(item.upgradePrice) || 0) : 0;
    premiumUpgradeTotal += chargedUpgradePrice;
    return { ...item, chargedUpgradePrice, isFreeUpgrade };
  });

  const perPersonPrice = Number((basePrice + premiumUpgradeTotal).toFixed(2));
  const grandTotal = Number((perPersonPrice * safeQuantity).toFixed(2));

  return {
    basePrice,
    premiumUpgradeTotal,
    perPersonPrice,
    quantity: safeQuantity,
    grandTotal,
    freeUpgradesUsed: freeSlotCount,
    freeUpgradesAvailable: unlimited ? null : freeAllowance,
    items,
  };
}
