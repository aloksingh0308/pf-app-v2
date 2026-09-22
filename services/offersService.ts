import { apiClient } from '../utils/apiClient';
import { resolveImageUrl } from '../utils/resolveImageUrl';
import { getActiveOrgSlug, getActiveBranchCode } from './restaurantContext';

/** Home screen's "Offers Near You" — each row is a real coupon tied to a real restaurant
 *  (never a bare code list), backed by publicOrderingService.getOffersNearYou() which reuses
 *  the exact same Coupon model/eligibility window as the existing per-branch coupon list
 *  (services/couponService.ts) and the exact same distance/ETA machinery as the restaurant
 *  directory (services/restaurantService.ts) — see that backend service's own doc-comment. */
export type OfferRecord = {
  offerId: string;
  couponId: string;
  branchId: string;
  restaurantId: string;
  orgSlug: string;
  branchCode: string;
  restaurantName: string;
  restaurantImage: string | null;
  title: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FLAT' | 'FREE_ITEM';
  discountValue: number;
  maxDiscount: number;
  minOrderAmount: number;
  couponCode: string;
  validUntil: string;
  distanceKm: number | null;
  deliveryTime?: { min: number; max: number; exceedsMax: boolean };
};

/** Same discount-label convention as checkout's coupon sheet (couponService.ts) — kept here
 *  too since this card needs it before a restaurant/branch context exists to reuse that
 *  screen's own formatting helper directly. */
export const formatOfferHeadline = (offer: OfferRecord): string => {
  if (offer.discountType === 'PERCENTAGE') {
    return `${offer.discountValue}% OFF`;
  }
  if (offer.discountType === 'FLAT') {
    return `₹${offer.discountValue} OFF`;
  }
  return 'FREE ITEM';
};

export const getOffersNearYou = async (coords?: { latitude: number; longitude: number } | null): Promise<OfferRecord[]> => {
  const query = coords ? `?lat=${coords.latitude}&lng=${coords.longitude}` : '';
  const offers = await apiClient.get<OfferRecord[]>(`/public/offers-near-you${query}`);
  return offers.map((offer) => ({ ...offer, restaurantImage: resolveImageUrl(offer.restaurantImage) || null }));
};

/** Promotional/browsable offers (Admin's Offers page — Today's Deal, BOGO, Happy Hours,
 *  Flat/Percentage discount, Free Item) live at the currently active restaurant right now.
 *  Backed by publicOrderingService.getBranchOffers(), which already applies the same
 *  active-window (date/day/time) filter the admin's own "Active" list uses — so this only
 *  ever returns offers actually live at this exact moment, nothing to re-filter client-side.
 *  Informational only per the Offer model's own doc-comment: never auto-applied to pricing,
 *  that's still exclusively the Coupon engine's job. */
export type BranchOfferRecord = {
  _id: string;
  name: string;
  description: string;
  type: 'TODAYS_DEAL' | 'BOGO' | 'COMBO' | 'FREE_ITEM' | 'HAPPY_HOURS' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT';
  discountType: 'PERCENTAGE' | 'FLAT' | null;
  discountValue: number;
  maxDiscount: number;
  minimumOrder: number;
  bogoBuyItemName: string | null;
  bogoGetItemName: string | null;
  freeItemName: string | null;
  startDate: string;
  endDate: string;
};

/** Same discount-label convention as formatOfferHeadline above, adapted for the richer set
 *  of offer types this branch-scoped endpoint can return (BOGO/Happy Hours/Free Item have
 *  no single "X% off" headline). */
export const formatBranchOfferHeadline = (offer: BranchOfferRecord): string => {
  switch (offer.type) {
    case 'BOGO':
      return offer.bogoBuyItemName && offer.bogoGetItemName
        ? `Buy ${offer.bogoBuyItemName}, Get ${offer.bogoGetItemName}`
        : 'Buy One Get One';
    case 'FREE_ITEM':
      return offer.freeItemName ? `Free ${offer.freeItemName}` : 'Free Item';
    case 'HAPPY_HOURS':
      return 'Happy Hours';
    case 'FLAT_DISCOUNT':
      return `₹${offer.discountValue} OFF`;
    case 'PERCENTAGE_DISCOUNT':
      return `${offer.discountValue}% OFF`;
    default:
      if (offer.discountType === 'PERCENTAGE' && offer.discountValue > 0) return `${offer.discountValue}% OFF`;
      if (offer.discountType === 'FLAT' && offer.discountValue > 0) return `₹${offer.discountValue} OFF`;
      return "Today's Deal";
  }
};

export const getBranchOffers = async (): Promise<BranchOfferRecord[]> => {
  return apiClient.get<BranchOfferRecord[]>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/offers`);
};
