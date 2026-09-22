export interface PlatterType {
  id: string;
  name: string;
  price: number;
  /** Number of premium item upgrades included free of charge. Ignored when unlimitedPremiumItems is true. */
  freePremiumUpgrades: number;
  /** When true, every premium item is included at no extra charge regardless of freePremiumUpgrades. */
  unlimitedPremiumItems: boolean;
  description?: string;
  image?: string;
}

export interface PartyMenu {
  firebaseId: string;
  id?: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  active: boolean;
  platterTypes: PlatterType[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PartyMenuItem {
  firebaseId: string;
  menuId: string;
  step: number;
  /** Human label for the step this item belongs to (e.g. "Starter", "Main Course"). Redundant across items of the same step by design, so the whole flow stays Firestore-driven without a separate steps collection. */
  stepLabel: string;
  category: string;
  name: string;
  description?: string;
  image?: string;
  portion?: string;
  /** How many items may be picked in total within this step (shared across all items of the step). */
  selectionLimit: number;
  premium: boolean;
  upgradePrice: number;
  displayOrder: number;
  active: boolean;
}

export interface PartyMenuStepCategory {
  category: string;
  items: PartyMenuItem[];
}

export interface PartyMenuStep {
  step: number;
  label: string;
  selectionLimit: number;
  categories: PartyMenuStepCategory[];
}

export interface DecorationPackage {
  firebaseId: string;
  id?: string;
  name: string;
  description?: string;
  price: number;
  recommended: boolean;
  displayOrder: number;
  active: boolean;
  coverImage?: string;
  gallery: string[];
  includes: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SelectedDecorationPackage {
  id: string;
  name: string;
  price: number;
}

export type PartyCouponDiscountType = 'flat' | 'percentage';

export interface PartyCoupon {
  firebaseId: string;
  code: string;
  description?: string;
  discountType: PartyCouponDiscountType;
  discountValue: number;
  minBookingAmount: number;
  /** Caps the discount amount for percentage coupons. Ignored for flat coupons. Null = no cap. */
  maxDiscountAmount: number | null;
  /** Max times a single customer may redeem this coupon. Null = unlimited. */
  usageLimitPerUser: number | null;
  active: boolean;
  displayOrder: number;
  /** ISO date string (YYYY-MM-DD) or null = never expires. */
  expiryDate: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AppliedPartyCoupon {
  code: string;
  discountType: PartyCouponDiscountType;
  discountValue: number;
  discountAmount: number;
}

export interface PartySelectedItem {
  itemId: string;
  step: number;
  stepLabel: string;
  category: string;
  name: string;
  portion?: string | null;
  premium: boolean;
  upgradePrice: number;
  chargedUpgradePrice: number;
  isFreeUpgrade: boolean;
}

export type PartyBookingOccasion =
  | 'Birthday'
  | 'Anniversary'
  | 'Office Party'
  | 'House Party'
  | 'Kitty Party'
  | 'Baby Shower'
  | 'Other';

export const PARTY_BOOKING_OCCASIONS: PartyBookingOccasion[] = [
  'Birthday',
  'Anniversary',
  'Office Party',
  'House Party',
  'Kitty Party',
  'Baby Shower',
  'Other',
];

export interface PartyBookingCustomerDetails {
  name: string;
  mobile: string;
  address: string;
  occasion: PartyBookingOccasion | string;
  specialInstructions?: string | null;
}

export type PartyBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'decoration_ready'
  | 'completed'
  | 'cancelled';

export const PARTY_BOOKING_STATUSES: PartyBookingStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'decoration_ready',
  'completed',
  'cancelled',
];

export const PARTY_BOOKING_STATUS_LABELS: Record<PartyBookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  decoration_ready: 'Decoration Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export interface PartyBookingTimelineEntry {
  status: PartyBookingStatus;
  at: unknown;
  note?: string | null;
}

export interface PartyBooking {
  firebaseId: string;
  bookingId: string;
  customerId: string;
  partyMenuId: string;
  partyMenuName: string;
  platterType: string;
  platterTypeName: string;
  quantity: number;
  selectedItems: PartySelectedItem[];
  perPersonPrice: number;
  /** Food subtotal before decoration: perPersonPrice * quantity. */
  subtotal: number;
  decorationPackage: SelectedDecorationPackage | null;
  decorationPrice: number;
  couponApplied: AppliedPartyCoupon | null;
  /** max(0, subtotal + decorationPrice - couponApplied.discountAmount). */
  grandTotal: number;
  eventDate: string;
  eventTime: string;
  customerDetails: PartyBookingCustomerDetails;
  bookingStatus: PartyBookingStatus;
  bookingNotes?: string | null;
  bookingTimeline: PartyBookingTimelineEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type NewPartyBooking = Omit<
  PartyBooking,
  'firebaseId' | 'bookingId' | 'bookingStatus' | 'bookingTimeline' | 'createdAt' | 'updatedAt'
>;
