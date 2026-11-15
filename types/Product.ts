// types/Product.ts
/** Mirrors the backend MenuItem.foodType enum (models/MenuItem.ts). */
export type FoodType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';

export interface ProductVariant {
  id?: string;
  name: string;
  description?: string;
  price: number;
  appPrice?: number | null;
}

/** One modifier GROUP available on an item (e.g. "Spice Level") — the group definition
 *  itself, not a customer's picks (see SelectedModifier below for that). */
export interface ModifierOption {
  name: string;
  priceDelta: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

export interface AddonOption {
  id: string;
  name: string;
  price: number;
}

/** A customer's picks from one modifier group — sent to the backend exactly as
 *  `{modifierId, optionNames}`, matching posItemSchema's modifierSelectionSchema. */
export interface SelectedModifier {
  modifierId: string;
  optionNames: string[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  images: string[];
  price: number;
  rating?: number;
  ratingCount?: number;
  qty?: string | null;
  serves?: string | null;
  categoryId: string | null;
  /** Coupons never discount this dish (its category is marked "no coupons", e.g. beverages). */
  couponExcluded?: boolean;
  cafeId?: string | null;
  restaurantId?: string | null;
  /** The restaurant (organization slug + branch code) this item was loaded from — lets the
   *  cart be mirrored to the server for abandoned-cart reminders (services/cartSyncService). */
  orgSlug?: string | null;
  branchCode?: string | null;
  emoji: string | null;
  /** Veg / non-veg marker from the backend menu item — absent on older cached cart items. */
  foodType?: FoodType;
  available: boolean;
  inStock?: boolean;
  hasHalfPortion?: boolean;
  halfPrice?: number | null;
  variants?: ProductVariant[];
  selectedVariantId?: string | null;
  selectedVariantName?: string | null;
  selectedVariantDescription?: string | null;
  /** IDs of modifier groups / standalone addons this item can be customized with — the
   *  definitions themselves are fetched separately (menuService.getModifiers/getAddons)
   *  and filtered down to these ids, same pattern as variants. */
  modifierGroupIds?: string[];
  addonIds?: string[];
  /** A customer's actual picks, once added to cart — absent on the raw catalog item. */
  selectedModifiers?: SelectedModifier[];
  selectedAddonIds?: string[];
  baseProductId?: string;
  firebaseId?: string;
  isDeal?: boolean;
  dealId?: string | null;
  dealCartId?: string | null;
  dealName?: string | null;
  dealPrice?: number | null;
  /** How many of this item ONE combo contains (e.g. 2 for "Veg Noodles x2"). Combo count
   *  in the cart = quantity / dealUnitQty — see utils/dealCart.ts. */
  dealUnitQty?: number | null;
  originalDealPrice?: number | null;
  createdAt?: any;
}

export interface ProductWithFirebaseId extends Product {
  firebaseId: string;
  tags?: string[];
  isBestSeller?: boolean;
  isMostOrdered?: boolean;
  isBudgetPick?: boolean;
  isSellingFast?: boolean;
  discountPercent?: number;
  saveAmount?: number;
}