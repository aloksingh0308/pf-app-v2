import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import AppButton, { PRIMARY_BUTTON_GUTTER } from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppStrings } from '@/constants/appStrings';
import { T } from '@/constants/tokens';
import { useAppLoader } from '@/hooks/useAppLoader';
import { computeDeliveryFee, DEFAULT_PRICING_CONFIG, getPricingConfig, PricingConfig } from '@/services/appConfigService';
import { validateCoupon, CouponItem, fetchActiveCoupons, formatCouponOrderTypes, isCouponValidForOrderType, toBackendOrderType } from '@/services/couponService';
import { OrderItem, placeOrder, toPosOrderItems } from '@/services/orderService';
import { abandonPayment, CheckoutPayment, CheckoutResult, getPaymentConfig, resumePayment } from '@/services/paymentService';
import RazorpayCheckout from '@/components/RazorpayCheckout';
import { EvaluatedOffer, evaluateOffers } from '@/services/offersService';
import { getReserveSlotConfigFromRestaurant, getReserveSlotsForTomorrow, placeScheduledOrder, ReserveSlot } from '@/services/scheduledOrderService';
import { findRestaurantByAnyId, getRestaurantClosedMessage } from '@/services/restaurantService';
import { setActiveRestaurant, consumePendingOffer } from '@/services/restaurantContext';
import { getActiveRestaurantStatus, isRestaurantUnavailable } from '@/services/appConfigService';
import { useAppStatus } from '@/components/AppStatusProvider';
import RestaurantPausedBanner from '@/components/RestaurantPausedBanner';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, TouchableOpacity, View } from 'react-native';
import { splitGst } from '@/utils/gst';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { errorParams, track } from '../../services/analytics';
import { userService } from '../../services/userService';
import { RootState } from '../../store';
import { setUser } from '../../store/slices/authSlice';
import { clearCart } from '../../store/slices/cartSlice';
import { OrderType } from '../../types/enums';
import { calculateCartTotals, getDealBundleQuantity, getDealUnitQuantity } from '../../utils/dealCart';
import { moderateScale, moderateVerticalScale, scaleFont } from '../../utils/responsive';

const normalizeText = (value: unknown) => String(value || '').trim().toLowerCase();

const isDealCartItem = (item: any) => {
  const dealId = normalizeText(item?.dealId);
  return Boolean(dealId) && item?.isDeal === true;
};

const BEVERAGE_CATEGORY_ID = '1';

const CheckoutScreen = () => {
  const insets = useSafeAreaInsets();
  const placementInFlight = useRef(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [gstExpanded, setGstExpanded] = useState(false);
  const dispatch = useDispatch();
  const {
    orderType,
    tableNumber,
    deliveryAddress,
    customerName,
    customerPhone,
    restaurantId,
    deliveryLatitude,
    deliveryLongitude,
    deliveryAddressId,
    existingOrderId,
  } = useLocalSearchParams();
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const authUser = useSelector((state: RootState) => state.auth.user);
  const [appliedCoupon, setAppliedCoupon] = useState<CouponItem | null>(null);
  // Server-authoritative validation result for the applied coupon (any type) — set by
  // validateCoupon(), never computed client-side. Cleared whenever the coupon
  // changes/is removed. `influencerCycle` is only meaningful for influencer coupons.
  const [influencerCouponResult, setInfluencerCouponResult] = useState<{ couponId: string; discountAmount: number; influencerCycle?: number } | null>(null);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [couponModalVisible, setCouponModalVisible] = useState(false);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [couponsLoading, setCouponsLoading] = useState(false);
  // Restaurant offers checked against this cart (evaluateOffers). The best one is applied by
  // itself unless the customer removed an offer or picked a coupon instead.
  const [offerResults, setOfferResults] = useState<EvaluatedOffer[]>([]);
  const [autoOfferDismissed, setAutoOfferDismissed] = useState(false);
  const [preferredOfferCode, setPreferredOfferCode] = useState<string | null>(null);
  const [isCafeOpen, setIsCafeOpen] = useState(true);
  const restaurantUnavailable = isRestaurantUnavailable(useAppStatus().status);
  const [cafeClosedMessage, setCafeClosedMessage] = useState('');
  const [restaurantMeta, setRestaurantMeta] = useState<Record<string, unknown> | null>(null);
  const [reserveModalVisible, setReserveModalVisible] = useState(false);
  const [reserveSlots, setReserveSlots] = useState<ReserveSlot[]>([]);
  const [reserveDateLabel, setReserveDateLabel] = useState('Tomorrow');
  const [reserveDateKey, setReserveDateKey] = useState('');
  const [selectedReserveSlotIndex, setSelectedReserveSlotIndex] = useState<number | null>(null);
  const [reserveLoading, setReserveLoading] = useState(false);
  const [reserveSubmitting, setReserveSubmitting] = useState(false);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(DEFAULT_PRICING_CONFIG);
  const { show: showGlobalLoader, hide: hideGlobalLoader } = useAppLoader();
  // Online payment (Razorpay) — offered when the server has it set up; dine-in pays at the table.
  const [onlineAvailable, setOnlineAvailable] = useState(false);
  const [payMode, setPayMode] = useState<'ONLINE' | 'COD'>('ONLINE');
  const [checkoutPayment, setCheckoutPayment] = useState<CheckoutPayment | null>(null);
  // The prepaid order whose payment is open — it only reaches the restaurant once paid.
  const pendingOnlineOrder = useRef<{ orderId: string; usedWallet: boolean } | null>(null);

  useEffect(() => {
    getPaymentConfig()
      .then((cfg) => setOnlineAvailable(Boolean(cfg?.onlinePayments)))
      .catch(() => setOnlineAvailable(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      hideGlobalLoader();
    }, [hideGlobalLoader])
  );

  useEffect(() => {
    getPricingConfig().then(setPricingConfig);
  }, []);

  useEffect(() => {
    track('begin_checkout', { order_type: String(orderType || ''), items: cartItems.length });
    // Once per checkout visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coupons are branch-scoped (and reward coupons are tied to the one restaurant that
  // issued them), so wait until the cart's restaurant has been resolved and set as the
  // active restaurant below — fetching on mount raced that lookup and listed the
  // previously-active (or default) restaurant's coupons instead.
  const couponOrgSlug = String((restaurantMeta as any)?.orgSlug || '');
  const couponBranchCode = String((restaurantMeta as any)?.branchCode || '');
  useEffect(() => {
    if (!couponOrgSlug || !couponBranchCode) return;
    setCouponsLoading(true);
    fetchActiveCoupons(authUser?.uid || null)
      .then(setCoupons)
      .catch(() => setCoupons([]))
      .finally(() => setCouponsLoading(false));
  }, [authUser?.uid, couponOrgSlug, couponBranchCode]);

  useEffect(() => {
    const cartCafeId = String(
      restaurantId ||
      (cartItems[0] as any)?.cafeId ||
      (cartItems[0] as any)?.restaurantId ||
      ''
    ).trim();
    if (!cartCafeId) return;
    findRestaurantByAnyId(cartCafeId).then((restaurant) => {
      setRestaurantMeta((restaurant || null) as any);
      setActiveRestaurant(restaurant);
      const closedMsg = getRestaurantClosedMessage(String(restaurant?.openingHours || ''));
      if (closedMsg) {
        setIsCafeOpen(false);
        setCafeClosedMessage(closedMsg);
      } else {
        setIsCafeOpen(true);
        setCafeClosedMessage('');
      }
    }).catch(() => {
      // If we can't determine status, allow placing order (fail-open)
      setIsCafeOpen(true);
      setRestaurantMeta(null);
    });
  }, [restaurantId, cartItems]);


  const { total: subtotal, savings: cartSavings } = calculateCartTotals(cartItems as any);
  const summaryItems = useMemo(() => {
    const seenDeals = new Set<string>();
    return cartItems.flatMap((item, index) => {
      const dealId = String(item.isDeal ? item.dealId || '' : '').trim();
      if (!dealId) return [{ key: `item-${index}`, name: item.name,
        detail: (item as any).selectedVariantName || '', quantity: item.quantity,
        amount: Number(item.price || 0) * Math.max(1, Number(item.quantity || 1)) }];
      if (seenDeals.has(dealId)) return [];
      seenDeals.add(dealId);
      const items = cartItems.filter(entry => entry.isDeal && String(entry.dealId || '').trim() === dealId);
      const quantity = getDealBundleQuantity(items);
      return [{ key: `deal-${dealId}`, name: item.dealName || 'Combo deal',
        detail: items.map(entry => `${getDealUnitQuantity(entry, quantity)} × ${entry.name}${(entry as any).selectedVariantName ? ` (${(entry as any).selectedVariantName})` : ''}`).join(' · '),
        quantity, amount: Math.max(0, Number(item.dealPrice || 0)) * quantity }];
    });
  }, [cartItems]);
  const hasDealItems = cartItems.some((item) => isDealCartItem(item));

  // "No coupons" dishes (beverages…) come flagged from the menu; the server applies the same
  // rule. The old Firebase beverage category id is kept for carts saved before the flag.
  const isBeverageCartItem = useCallback((item: any) => {
    if (item?.couponExcluded === true) return true;
    const categoryId = normalizeText(item?.categoryId);
    return categoryId === BEVERAGE_CATEGORY_ID;
  }, []);

  const hasBeverageItems = cartItems.some((item) => isBeverageCartItem(item));

  const couponEligibleSubtotal = cartItems.reduce((sum, item) => {
    if (isDealCartItem(item)) {
      return sum;
    }

    if (isBeverageCartItem(item)) {
      return sum;
    }

    return sum + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);

  const isCouponSectionDisabled = couponEligibleSubtotal <= 0;

  // Every applied coupon (not just influencer ones) is now server-priced by
  // validateCoupon() in handleApplyCoupon — never recomputed client-side — matching the
  // backend's own "coupon discount is always server-computed" rule for order placement.
  const discountAmount = isCouponSectionDisabled || !appliedCoupon ? 0 : Number(influencerCouponResult?.discountAmount || 0);

  const freebieName = String(
    appliedCoupon?.freeItemName || appliedCoupon?.title || appliedCoupon?.description || 'Free Item'
  ).trim();

  // Calculate subtotal after discount
  const subtotalAfterDiscount = subtotal - discountAmount;

  const orderTypeValue = String(orderType || OrderType.DINE_IN);
  const isTakeAwayOrder = orderTypeValue === OrderType.TAKE_AWAY;
  const isHomeDeliveryOrder = orderTypeValue === OrderType.HOME_DELIVERY;
  const isOffPremiseOrder = isTakeAwayOrder || isHomeDeliveryOrder;
  // Coupons restricted to other service types are hidden from the list and rejected when
  // typed in — the backend enforces the same rule at validate and order-placement time.
  const backendOrderType = toBackendOrderType(orderTypeValue);
  const orderTypeLabel = isHomeDeliveryOrder ? 'Home Delivery' : isTakeAwayOrder ? 'Take-Away' : 'Dine In';
  const showOrderTypeMismatch = (coupon: CouponItem) => {
    showAlert('Coupon Not Applicable', `${coupon.code} is only valid for ${formatCouponOrderTypes(coupon)} orders, not ${orderTypeLabel}.`);
  };

  // Packaging applies only for take-away and home delivery
  const packagingCharge = isOffPremiseOrder ? pricingConfig.packagingCharge : 0;

  // Delivery fee applies only for home delivery. Ranges are the branch's own delivery
  // charges (Branch Settings in the SaaS panel); none set = ₹0. Who delivers never changes it.
  const deliveryFee = isHomeDeliveryOrder ? computeDeliveryFee(subtotal, pricingConfig.deliveryFeeTiers) : 0;


  // --- Reward Coin System ---
  const earnedCoin = Number(authUser?.earnedCoin || 0);
  const coinValue = Math.floor(earnedCoin / 20);
  // Change: Allow coin redemption on Sunday (day 0)
  const isSunday = new Date().getDay() === 0;
  const canRedeemCoins = isSunday && coinValue > 0;
  const coinDiscount = canRedeemCoins ? coinValue : 0;
  // --- End Reward Coin System ---


  // Wallet logic for order edit: add back previous walletUsed
  const [virtualWalletBalance, setVirtualWalletBalance] = useState<number | null>(null);
  const [prevWalletUsed, setPrevWalletUsed] = useState<number>(0);

  const walletBalance = Number(authUser?.walletBalance || 0);
  // Same order as the backend (orderPricing.ts): coins are a discount, GST is on the item
  // total after every discount, then packaging + delivery, rounded to the rupee; wallet pays last.
  const gstPercent = Number(pricingConfig.gstPercent ?? 0);
  // Menu prices may already include GST (restaurant's setting): then it's taken out of
  // the price and shown as "included" — nothing is added on top.
  const gstIncluded = Boolean(pricingConfig.pricesIncludeGst) && gstPercent > 0;
  const foodAfterDiscounts = Math.max(0, subtotalAfterDiscount - coinDiscount);
  const gstAmount = gstIncluded
    ? Math.round((foodAfterDiscounts * gstPercent * 100) / (100 + gstPercent)) / 100
    : Math.round(foodAfterDiscounts * gstPercent) / 100;
  const gstBase = gstIncluded ? foodAfterDiscounts - gstAmount : foodAfterDiscounts;
  const preRoundTotal = foodAfterDiscounts + (gstIncluded ? 0 : gstAmount) + packagingCharge + deliveryFee;
  const totalBeforeWallet = Math.max(0, Math.round(preRoundTotal));
  const roundOff = Math.round((totalBeforeWallet - preRoundTotal) * 100) / 100;
  const gstSplit = splitGst(gstAmount, gstBase, gstPercent);
  const maxWalletUsageByItems = subtotal * 0.1;

  // There's no public "edit an already-placed order" endpoint on the new backend (see
  // orderService.placeOrder's docblock — `existingOrderId` is accepted-but-inert there too),
  // and wallet isn't migrated yet (userService.addWalletTransaction throws), so an order
  // edit's previous wallet usage has nothing to read back and is always treated as zero.
  useEffect(() => {
    setPrevWalletUsed(0);
    setVirtualWalletBalance(walletBalance);
  }, [existingOrderId, authUser?.uid, walletBalance]);

  const walletUsed = Number(
    Math.min(
      maxWalletUsageByItems,
      virtualWalletBalance !== null ? virtualWalletBalance : walletBalance,
      totalBeforeWallet
    ).toFixed(2)
  );

  // Final total with coin discount
  const total = Number(Math.max(0, totalBeforeWallet - walletUsed).toFixed(2));

  useEffect(() => {
    if (!isCouponSectionDisabled) {
      return;
    }

    if (appliedCoupon) {
      setAppliedCoupon(null);
      setCouponCodeInput('');
    }
  }, [appliedCoupon, isCouponSectionDisabled]);

  const handleApplyCoupon = async (coupon: CouponItem) => {
    if (isCouponSectionDisabled) {
      showAlert('Coupon Not Applicable', 'Your cart contains only deals or beverages, which aren’t eligible for coupons.');
      return;
    }

    if (couponEligibleSubtotal <= 0) {
      showAlert('Coupon Not Applicable', 'Coupons are not applicable on beverage category items.');
      return;
    }

    if (!isCouponValidForOrderType(coupon, backendOrderType)) {
      showOrderTypeMismatch(coupon);
      return;
    }

    if (couponEligibleSubtotal < coupon.minOrder) {
      showAlert('Minimum Order Required', `Add items worth ₹${coupon.minOrder} or more to use ${coupon.code}.`);
      return;
    }

    if (coupon.timesPerUser && (coupon.userUsageCount ?? 0) >= coupon.timesPerUser) {
      showAlert(
        'Coupon Already Used',
        `You can use ${coupon.code} only ${coupon.timesPerUser} time${coupon.timesPerUser === 1 ? '' : 's'} per user.`
      );
      return;
    }

    // Every coupon is validated + priced server-side — never trust the client's own
    // eligibility/usage fields or compute the discount amount locally.
    setIsApplyingCoupon(true);
    try {
      const result = await validateCoupon({
        code: coupon.code,
        orderSubtotal: couponEligibleSubtotal,
        items: toPosOrderItems(deriveOrderItems()),
        orderType: backendOrderType,
      });
      setInfluencerCouponResult({ couponId: result.couponId, discountAmount: result.discountAmount, influencerCycle: coupon.influencerCycle });
      setAppliedCoupon(coupon);
      setCouponCodeInput(coupon.code || '');
      setCouponModalVisible(false);
    } catch (error: any) {
      track('coupon_apply_failed', { coupon_code: coupon.code, ...errorParams(error) });
      showAlert('Coupon Not Applicable', error?.message || 'This coupon could not be applied.');
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  // A coupon carried from Home's "Offers Near You" → cafe-details flow (see
  // services/restaurantContext.ts's setPendingOffer/consumePendingOffer) — applied through
  // this screen's own existing `handleApplyCoupon`, the same server-validated path every
  // manually-typed/tapped coupon already goes through, never a second validation path.
  // Runs once coupons for this branch have actually loaded, so the code can be matched
  // against the real list instead of guessed at.
  useEffect(() => {
    const branchId = String(restaurantMeta?.id || '').trim();
    if (!branchId || couponsLoading || appliedCoupon?.code) return;
    const pending = consumePendingOffer(branchId);
    if (!pending) return;
    const match = coupons.find((coupon) => String(coupon.code || '').trim().toUpperCase() === pending.couponCode.trim().toUpperCase());
    if (match) void handleApplyCoupon(match);
    // A restaurant offer's code isn't in the coupon list — the offers check below applies it.
    else setPreferredOfferCode(pending.couponCode.trim().toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantMeta, couponsLoading, coupons, appliedCoupon]);

  const handleApplyCouponByCode = async () => {
    if (isCouponSectionDisabled) {
      showAlert('Coupon Not Applicable', 'Your cart contains only deals or beverages, which aren’t eligible for coupons.');
      return;
    }

    const normalizedCode = String(couponCodeInput || '').trim().toUpperCase();
    if (!normalizedCode) {
      showAlert('Coupon Required', 'Please enter a coupon code.');
      return;
    }

    const match = coupons.find((coupon) => String(coupon.code || '').trim().toUpperCase() === normalizedCode);
    if (match) {
      await handleApplyCoupon(match);
      return;
    }

    // Not in the listed coupons (e.g. a reward/scratch-card code, or a list that loaded
    // before the latest reward was issued) — let the server decide instead of rejecting
    // it locally. The backend is the source of truth for eligibility and the discount.
    setIsApplyingCoupon(true);
    try {
      const result = await validateCoupon({
        code: normalizedCode,
        orderSubtotal: couponEligibleSubtotal,
        items: toPosOrderItems(deriveOrderItems()),
        orderType: backendOrderType,
      });
      const refreshed = await fetchActiveCoupons(authUser?.uid || null).catch(() => [] as CouponItem[]);
      setCoupons(refreshed);
      const listed = refreshed.find((coupon) => coupon.id === result.couponId);
      const applied: CouponItem = listed || {
        id: result.couponId,
        code: normalizedCode,
        type: result.freeItemMenuItemId ? 'Freebie' : 'Flat',
        value: result.discountAmount,
        maxDiscount: 0,
        minOrder: 0,
        expiry: null,
        isActive: true,
        applicableOrderTypes: [],
      };
      setInfluencerCouponResult({ couponId: result.couponId, discountAmount: result.discountAmount, influencerCycle: applied.influencerCycle });
      setAppliedCoupon(applied);
      setCouponCodeInput(applied.code);
      setCouponModalVisible(false);
    } catch (error: any) {
      track('coupon_apply_failed', { coupon_code: couponCodeInput.trim().toUpperCase(), ...errorParams(error), entered_manually: true });
      showAlert('Coupon Not Applicable', error?.message || 'This coupon code is not available or expired.');
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const handleOpenCouponModal = () => {
    if (isCouponSectionDisabled) {
      showAlert('Coupon Not Applicable', 'Your cart contains only deals or beverages, which aren’t eligible for coupons.');
      return;
    }

    setCouponModalVisible(true);
  };

  const applyOffer = useCallback((offer: EvaluatedOffer) => {
    setAppliedCoupon({
      id: offer.offerId,
      offerId: offer.offerId,
      code: offer.couponCode,
      type: 'Flat',
      value: offer.discountAmount,
      dealHeadline: offer.headline,
      title: offer.name,
      maxDiscount: 0,
      minOrder: 0,
      expiry: null,
      isActive: true,
      applicableOrderTypes: [],
    });
    setInfluencerCouponResult({ couponId: offer.offerId, discountAmount: offer.discountAmount });
    setCouponCodeInput('');
  }, []);

  const handleRemoveCoupon = () => {
    if (appliedCoupon?.offerId) setAutoOfferDismissed(true);
    setAppliedCoupon(null);
    setInfluencerCouponResult(null);
    setCouponCodeInput('');
  };

  const visibleCoupons = coupons.filter(
    (coupon) => String(coupon.createdFrom || '').trim().toUpperCase() !== 'SCRATCH_CARD'
      && isCouponValidForOrderType(coupon, backendOrderType)
      // Hide coupons the customer has already used up to their per-user limit.
      && !(coupon.timesPerUser && (coupon.userUsageCount ?? 0) >= coupon.timesPerUser && appliedCoupon?.id !== coupon.id)
  );
  const hiddenByOrderTypeCount = coupons.filter((coupon) => !isCouponValidForOrderType(coupon, backendOrderType)).length;

  const reserveSelectedSlot = useMemo(() => {
    if (selectedReserveSlotIndex == null) return null;
    return reserveSlots.find((slot) => slot.slotIndex === selectedReserveSlotIndex) || null;
  }, [reserveSlots, selectedReserveSlotIndex]);

  const reserveDateDisplay = useMemo(() => {
    const dateKey = String(reserveDateKey || '').trim();
    if (!dateKey) {
      return reserveDateLabel;
    }

    const parsed = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return reserveDateLabel;
    }

    const formatted = parsed.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    return `${reserveDateLabel} (${formatted})`;
  }, [reserveDateKey, reserveDateLabel]);

  const deriveOrderItems = useCallback((): OrderItem[] => {
    return cartItems.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      firebaseId: item.firebaseId || item.id,
      selectedVariantId: (item as any).selectedVariantId || null,
      selectedVariantName: (item as any).selectedVariantName || null,
      selectedVariantDescription: (item as any).selectedVariantDescription || null,
      selectedModifiers: (item as any).selectedModifiers || undefined,
      selectedAddonIds: (item as any).selectedAddonIds || undefined,
      isDeal: Boolean((item as any).isDeal),
      dealId: (item as any).dealId || null,
      dealName: (item as any).dealName || null,
      dealPrice: (item as any).dealPrice ?? null,
      originalDealPrice: (item as any).originalDealPrice ?? null,
    }));
  }, [cartItems]);

  // Re-check the restaurant's offers whenever the cart or service type changes.
  const offerCartKey = JSON.stringify(toPosOrderItems(deriveOrderItems())) + String(backendOrderType || '');
  useEffect(() => {
    if (isCouponSectionDisabled || cartItems.length === 0) {
      setOfferResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await evaluateOffers({ items: toPosOrderItems(deriveOrderItems()), orderType: backendOrderType });
        if (!cancelled) setOfferResults(result.offers || []);
      } catch {
        if (!cancelled) setOfferResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerCartKey, isCouponSectionDisabled]);

  // Keep an applied offer in step with the cart, and apply the best one when none is chosen.
  useEffect(() => {
    if (appliedCoupon?.offerId) {
      const current = offerResults.find((offer) => offer.offerId === appliedCoupon.offerId);
      if (!current || !current.applicable) {
        setAppliedCoupon(null);
        setInfluencerCouponResult(null);
      } else if (current.discountAmount !== influencerCouponResult?.discountAmount) {
        applyOffer(current);
      }
      return;
    }
    if (appliedCoupon || autoOfferDismissed) return;
    const usable = offerResults.filter((offer) => offer.applicable && offer.discountAmount > 0);
    const pick = usable.find((offer) => offer.couponCode === preferredOfferCode) || usable.find((offer) => offer.autoApply);
    if (pick) applyOffer(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerResults, appliedCoupon, autoOfferDismissed, preferredOfferCode]);


  const getCartCafeId = useCallback(() => {
    return String(
      restaurantId ||
      (cartItems[0] as any)?.cafeId ||
      (cartItems[0] as any)?.restaurantId ||
      ''
    ).trim() || null;
  }, [restaurantId, cartItems]);

  const openReserveOrderSheet = useCallback(async () => {
    const cartCafeId = getCartCafeId();
    if (!cartCafeId) {
      showAlert('Cafe Info Missing', 'Unable to load cafe schedule. Please try again.');
      return;
    }

    setReserveLoading(true);
    try {
      const restaurant = restaurantMeta || await findRestaurantByAnyId(cartCafeId) as any;
      const slotConfig = getReserveSlotConfigFromRestaurant(restaurant || null);
      const { slots, scheduledDate, dateLabel } = await getReserveSlotsForTomorrow({
        restaurantId: cartCafeId,
        openingHours: String(restaurant?.openingHours || ''),
        slotDurationMinutes: slotConfig.slotDurationMinutes,
        slotCapacity: slotConfig.slotCapacity,
      });

      setReserveSlots(slots);
      setReserveDateKey(scheduledDate);
      setReserveDateLabel(String(dateLabel || 'Tomorrow'));

      const firstAvailable = slots.find((slot) => slot.status !== 'full');
      setSelectedReserveSlotIndex(firstAvailable ? firstAvailable.slotIndex : null);
      setReserveModalVisible(true);
    } catch (error) {
      console.error('Failed to load reserve slots:', error);
      showAlert('Unable To Load Slots', 'Please try again in a moment.');
    } finally {
      setReserveLoading(false);
    }
  }, [getCartCafeId, restaurantMeta]);

  const handlePlaceOrder = async () => {
    if (placementInFlight.current) return;
    placementInFlight.current = true;
    setPlacingOrder(true);
    let placed = false;
    try {
      const cartCafeId = getCartCafeId();

      if (cartCafeId) {
        const restaurantRecord = await findRestaurantByAnyId(cartCafeId);
        setActiveRestaurant(restaurantRecord);
        // Paused/closed by the restaurant itself — nothing to schedule, it can't take orders.
        const live = await getActiveRestaurantStatus();
        if (isRestaurantUnavailable(live.status)) {
          track('order_blocked', { reason: 'restaurant_unavailable', order_type: String(orderType || '') });
          showAlert(
            "Restaurant isn't taking orders",
            `${live.description ? `${live.description}. ` : ''}Please try again later or order from another restaurant.`
          );
          return;
        }
        const closedMessage = getRestaurantClosedMessage(String(restaurantRecord?.openingHours || ''));
        if (closedMessage) {
          track('order_blocked', { reason: 'restaurant_closed', order_type: String(orderType || '') });
          setIsCafeOpen(false);
          setCafeClosedMessage(closedMessage);
          await openReserveOrderSheet();
          return;
        }
      }

      showGlobalLoader('Placing order...');

      const orderItems: OrderItem[] = deriveOrderItems();

      const parsedLatitude = Number(deliveryLatitude || 0);
      const parsedLongitude = Number(deliveryLongitude || 0);
      const hasDeliveryLocation = Number.isFinite(parsedLatitude)
        && Number.isFinite(parsedLongitude)
        && parsedLatitude !== 0
        && parsedLongitude !== 0;

      if (appliedCoupon?.timesPerUser && authUser?.uid) {
        const latestCoupons = await fetchActiveCoupons(authUser.uid);
        const latestCoupon = latestCoupons.find((item) => item.code === appliedCoupon.code);

        if (latestCoupon && (latestCoupon.userUsageCount ?? 0) >= (latestCoupon.timesPerUser ?? 0)) {
          hideGlobalLoader();
          showAlert(
            'Coupon Already Used',
            `You can use ${latestCoupon.code} only ${latestCoupon.timesPerUser} time${latestCoupon.timesPerUser === 1 ? '' : 's'} per user.`
          );
          return;
        }
      }


      // Wallet & coin: sent as INTENT on the order-placement call itself (walletUsed/
      // coinsRedeemed below) — the backend re-validates the live balance and debits
      // atomically inside the order's own DB transaction (pos.service.ts createOrder,
      // wallet.service.ts), never trusting this screen's locally-computed amount. There is
      // no separate post-order "spend" step anymore; the two client-side mutation calls
      // this screen used to make afterward (updateUserProfile({earnedCoin}) and
      // addWalletTransaction) never actually reached the server either way —
      // updateUserProfile silently drops earnedCoin as a read-only field, and
      // addWalletTransaction always throws — so removing them changes nothing that was
      // previously working; it just stops calling dead code.
      //
      // Order edit (existingOrderId) still has no equivalent: there's no public "edit an
      // already-placed order" endpoint (orderService.placeOrder always creates a new
      // order), so a wallet/coin amount used on an edited order was never reversible
      // either way — unchanged by this migration.

      const paysOnline = onlineAvailable && payMode === 'ONLINE' && isOffPremiseOrder;
      // Place order with pricing details
      const { orderId, payment } = await placeOrder(
        (customerName as string) || authUser?.name || "John Doe",
        (customerPhone as string) || authUser?.phoneNumber || "1234567890",
        authUser?.email || null,
        orderItems,
        total,
        orderType as string,
        tableNumber as string | undefined,
        deliveryAddress as string | undefined,
        {
          subtotal,
          discount: discountAmount + coinDiscount,
          tax: gstAmount,
          packagingCharge,
          deliveryFee,
          walletUsed,
          coinsRedeemed: coinDiscount > 0 ? coinDiscount * 20 : undefined,
          totalBeforeWallet,
          couponCode: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.code : null,
          couponType: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.type : null,
          couponValue: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.value : null,
          couponTitle: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.title || null : null,
          couponDescription: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.description || null : null,
          freeItemName: !isCouponSectionDisabled && appliedCoupon ? (appliedCoupon.freeItemName || appliedCoupon.title || null) : null,
          couponId: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? influencerCouponResult?.couponId || null : null,
          influencerUid: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? authUser?.uid || null : null,
          influencerCycle: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? influencerCouponResult?.influencerCycle ?? null : null,
        },
        authUser?.uid || null,
        cartCafeId,
        hasDeliveryLocation ? { latitude: parsedLatitude, longitude: parsedLongitude } : null,
        String(deliveryAddressId || '').trim() || null,
        String(existingOrderId || '').trim() || null,
        String(restaurantMeta?.name || (cartItems[0] as any)?.restaurantName || '').trim() || null,
        paysOnline ? 'ONLINE' : 'COD',
      );

      if (payment) {
        // Prepaid: open Razorpay; the rest happens in handlePaymentResult. Keep the
        // placement lock until the payment is settled one way or the other.
        placed = true;
        pendingOnlineOrder.current = { orderId, usedWallet: walletUsed > 0 || coinDiscount > 0 };
        hideGlobalLoader();
        setCheckoutPayment(payment);
        return;
      }

      placed = true;
      track('purchase', { transaction_id: String(orderId || ''), value: Number(total) || 0, currency: 'INR', order_type: String(orderType || ''), coupon: appliedCoupon?.code });

      // No post-order "mark coupon used"/"spend wallet"/"spend coins" step needed anymore —
      // the backend consumes the coupon and debits wallet/coins itself, transactionally,
      // inside order placement (see coupon.service.ts's consumeCoupon and
      // wallet.service.ts's debit, both called from posService.createOrder). Refresh the
      // profile from the server so Redux reflects the real post-redemption balance rather
      // than a locally-guessed one.
      if ((walletUsed > 0 || coinDiscount > 0) && authUser?.uid) {
        try {
          const refreshed = await userService.getUserProfile(authUser.uid);
          if (refreshed) dispatch(setUser({ ...authUser, ...refreshed }));
        } catch (profileError) {
          console.error('Failed to refresh wallet/coin balance after order:', profileError);
        }
      }

      hideGlobalLoader();
      dispatch(clearCart());
      router.replace({
        pathname: '/order-success',
        params: {
          orderId,
          isUpdate: String(Boolean(String(existingOrderId || '').trim())),
        },
      } as never);
    } catch (error) {
      hideGlobalLoader();
      console.error('Error placing order:', error);
      track('order_place_failed', { ...errorParams(error), order_type: String(orderType || ''), value: Number(total) || 0 });
      showErrorAlert(error, 'Failed to place order. Please try again.', 'Error');
    } finally {
      // Keep the guard locked after success until checkout unmounts.
      if (!placed) placementInFlight.current = false;
      setPlacingOrder(false);
      hideGlobalLoader();
    }
  };

  const refreshWallet = async () => {
    if (!authUser?.uid) return;
    try {
      const refreshed = await userService.getUserProfile(authUser.uid);
      if (refreshed) dispatch(setUser({ ...authUser, ...refreshed }));
    } catch (profileError) {
      console.error('Failed to refresh wallet/coin balance after payment:', profileError);
    }
  };

  const handlePaymentResult = (result: CheckoutResult) => {
    const pending = pendingOnlineOrder.current;
    setCheckoutPayment(null);
    if (!pending) return;
    if (result.status === 'paid' || result.status === 'pending') {
      track('purchase', { transaction_id: pending.orderId, value: Number(total) || 0, currency: 'INR', order_type: String(orderType || ''), coupon: appliedCoupon?.code, payment_mode: 'ONLINE' });
      pendingOnlineOrder.current = null;
      if (pending.usedWallet) void refreshWallet();
      dispatch(clearCart());
      router.replace({ pathname: '/order-success', params: { orderId: pending.orderId, isUpdate: 'false', paymentPending: String(result.status === 'pending') } } as never);
      return;
    }
    track('payment_not_completed', { outcome: result.status, reason: result.status === 'failed' ? result.reason || '' : '' });
    showAlert(
      result.status === 'failed' ? 'Payment Failed' : 'Payment Not Completed',
      `${result.status === 'failed' && result.reason ? `${result.reason} ` : ''}Your order is placed only after it's paid. Try again, or cancel and choose another way to pay.`,
      [
        {
          text: 'Cancel Order',
          style: 'cancel',
          onPress: () => {
            pendingOnlineOrder.current = null;
            placementInFlight.current = false;
            abandonPayment(pending.orderId)
              .catch(() => undefined)
              .finally(() => {
                if (pending.usedWallet) void refreshWallet();
              });
            showAlert('Order Not Placed', "You weren't charged. Your cart is still here.");
          },
        },
        {
          text: 'Try Again',
          onPress: () => {
            resumePayment(pending.orderId)
              .then(setCheckoutPayment)
              .catch((error) => {
                pendingOnlineOrder.current = null;
                placementInFlight.current = false;
                showErrorAlert(error, "This order's payment can't be restarted. Please place the order again.", 'Payment');
              });
          },
        },
      ]
    );
  };

  const handleReserveOrder = async () => {
    if (!reserveSelectedSlot || reserveSelectedSlot.status === 'full') {
      showAlert('Select Time Slot', 'Please choose an available slot to reserve your order.');
      return;
    }

    const cartCafeId = getCartCafeId();
    if (!cartCafeId) {
      showAlert('Cafe Info Missing', 'Unable to reserve order right now. Please try again.');
      return;
    }

    const restaurantName = String(
      restaurantMeta?.name
      || (cartItems[0] as any)?.restaurantName
      || (cartItems[0] as any)?.cafeName
      || "Hungry's Bucket Cafe"
    ).trim() || "Hungry's Bucket Cafe";

    setReserveSubmitting(true);
    try {
      const orderItems = deriveOrderItems();

      if (appliedCoupon?.timesPerUser && authUser?.uid) {
        const latestCoupons = await fetchActiveCoupons(authUser.uid);
        const latestCoupon = latestCoupons.find((item) => item.code === appliedCoupon.code);

        if (latestCoupon && (latestCoupon.userUsageCount ?? 0) >= (latestCoupon.timesPerUser ?? 0)) {
          showAlert(
            'Coupon Already Used',
            `You can use ${latestCoupon.code} only ${latestCoupon.timesPerUser} time${latestCoupon.timesPerUser === 1 ? '' : 's'} per user.`
          );
          return;
        }
      }

      const slotConfig = getReserveSlotConfigFromRestaurant(restaurantMeta || null);

      const scheduledOrderId = await placeScheduledOrder({
        customerId: authUser?.uid || null,
        customerName: (customerName as string) || authUser?.name || 'John Doe',
        mobileNumber: (customerPhone as string) || authUser?.phoneNumber || '1234567890',
        email: authUser?.email || null,
        restaurantId: cartCafeId,
        restaurantName,
        deliveryAddress: (deliveryAddress as string) || null,
        deliveryAddressId: String(deliveryAddressId || '').trim() || null,
        deliveryLocation:
          Number.isFinite(Number(deliveryLatitude || 0))
          && Number.isFinite(Number(deliveryLongitude || 0))
          && Number(deliveryLatitude || 0) !== 0
          && Number(deliveryLongitude || 0) !== 0
            ? { latitude: Number(deliveryLatitude), longitude: Number(deliveryLongitude) }
            : null,
        items: orderItems,
        pricing: {
          subtotal,
          discount: discountAmount + coinDiscount,
          tax: gstAmount,
          packagingCharge,
          deliveryFee,
          walletUsed,
          totalBeforeWallet,
          couponCode: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.code : null,
          couponType: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.type : null,
          couponValue: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.value : null,
          couponTitle: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.title || null : null,
          couponDescription: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.description || null : null,
          freeItemName: !isCouponSectionDisabled && appliedCoupon ? (appliedCoupon.freeItemName || appliedCoupon.title || null) : null,
          couponId: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? influencerCouponResult?.couponId || null : null,
          influencerUid: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? authUser?.uid || null : null,
          influencerCycle: !isCouponSectionDisabled && appliedCoupon?.isInfluencer ? influencerCouponResult?.influencerCycle ?? null : null,
        },
        total,
        couponCode: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.code : null,
        couponType: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.type : null,
        couponValue: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.value : null,
        couponTitle: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.title || null : null,
        couponDescription: !isCouponSectionDisabled && appliedCoupon ? appliedCoupon.description || null : null,
        freeItemName: !isCouponSectionDisabled && appliedCoupon ? (appliedCoupon.freeItemName || appliedCoupon.title || null) : null,
        walletUsed,
        rewardCoinsUsed: coinDiscount * 20,
        paymentMethod: isHomeDeliveryOrder ? 'COD' : 'CASH',
        cashAmount: total,
        upiAmount: 0,
        orderType: orderType as string,
        tableNumber: (tableNumber as string) || null,
        specialInstruction: null,
        scheduledDate: reserveDateKey,
        slot: reserveSelectedSlot,
        slotCapacity: slotConfig.slotCapacity,
      });

      // Scheduled/reserve orders still go through scheduledOrderService.ts, which is not
      // migrated off Firestore yet (see that file) — so unlike the immediate-order path
      // above, a coupon applied on a reserve order has no server-side consumption to rely
      // on. Deliberately not calling anything here rather than a Firestore write against a
      // coupon model the new backend doesn't share.

      // Scheduled/reserve orders still go through scheduledOrderService.ts, which has no
      // server-side wallet/coin redemption endpoint (unlike the immediate-order path above
      // — see pos.service.ts createOrder) — so there is deliberately no wallet/coin spend
      // call here (the two calls this used to make were already dead code — see the note
      // on the immediate-order path above). Pre-existing, separate limitation, not
      // introduced by this change: scheduledOrder.service.ts's own server-computed total
      // doesn't factor in wallet/coin at all, so a reserve order's displayed total (which
      // does, client-side, via `total` above) can understate what's actually charged —
      // flagged for a follow-up that gives scheduled orders the same wallet/coin support
      // immediate orders now have, not addressed in this pass.

      setReserveModalVisible(false);
      dispatch(clearCart());
      router.replace({
        pathname: '/order-success',
        params: {
          orderId: String(scheduledOrderId || ''),
          isScheduled: 'true',
          scheduledDateLabel: String(reserveDateDisplay || reserveDateLabel || ''),
          scheduledSlotLabel: String(reserveSelectedSlot.slotLabel || ''),
        },
      } as never);
    } catch (error: any) {
      console.error('Error reserving order:', error);
      track('order_place_failed', { ...errorParams(error), order_type: String(orderType || ''), scheduled: true });
      const message = String(error?.message || '').trim();
      if (message.toLowerCase().includes('slot is full')) {
        showAlert('Slot Full', 'Selected slot is full. Please choose another slot.');
        await openReserveOrderSheet();
        return;
      }
      showErrorAlert(error, 'Failed to reserve order. Please try again.', 'Error');
    } finally {
      setReserveSubmitting(false);
    }
  };

  const restaurantName = String(restaurantMeta?.name || (cartItems[0] as any)?.restaurantName || '').trim();
  const isEditingOrder = Boolean(String(existingOrderId || '').trim());
  const itemCount = summaryItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalSavings = cartSavings + discountAmount + coinDiscount;
  const tableValue = String(tableNumber || '').trim();
  const orderDetail: { icon: 'location-outline' | 'bag-handle-outline' | 'restaurant-outline'; title: string; subtitle: string } = isHomeDeliveryOrder
    ? { icon: 'location-outline', title: 'Home Delivery', subtitle: String(deliveryAddress || '').trim() || 'Your delivery address' }
    : isTakeAwayOrder
      ? { icon: 'bag-handle-outline', title: 'Take-Away', subtitle: restaurantName ? `Pick up from ${restaurantName}` : 'Pick up from the restaurant' }
      : {
        icon: 'restaurant-outline',
        title: tableValue ? `Dine In · ${/^\d+$/.test(tableValue) ? `Table ${tableValue}` : tableValue}` : 'Dine In',
        subtitle: restaurantName || 'Served at your table',
      };
  const appliedCouponHeadline = !appliedCoupon
    ? ''
    : appliedCoupon.offerId
      ? String(appliedCoupon.dealHeadline || appliedCoupon.title || 'Restaurant offer')
      : appliedCoupon.dealHeadline
        ? appliedCoupon.dealHeadline
        : appliedCoupon.type === 'Percentage'
          ? `${appliedCoupon.value}% OFF`
          : appliedCoupon.type === 'Flat'
            ? `₹${appliedCoupon.value} OFF`
            : `${freebieName} FREE`;
  const showPaymentChoice = onlineAvailable && isOffPremiseOrder && isCafeOpen;
  const offlinePayment = isHomeDeliveryOrder
    ? { title: 'Pay on delivery', hint: 'Payment will be collected by the delivery partner at the time of delivery.' }
    : { title: 'Pay at the restaurant', hint: isTakeAwayOrder ? 'Cash or UPI when you pick up your food.' : 'Cash or UPI once you’re done.' };

  return (
    <Container>
      <PageHeader title="Checkout" />

      <ScrollContainer keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}>
        <IntroBlock>
          {!isEditingOrder ? (
            <StepBar>
              <StepSegment $active />
              <StepSegment $active />
            </StepBar>
          ) : null}
          <IntroStep>{isEditingOrder ? 'UPDATING YOUR ORDER' : 'STEP 2 OF 2'}</IntroStep>
          <IntroTitle>Review & place order</IntroTitle>
          <IntroSubtitle>One last look before we get cooking.</IntroSubtitle>
        </IntroBlock>

        <Card>
          <DetailRow>
            <IconCircle>
              <Ionicons name={orderDetail.icon} size={18} color={T.color.brand} />
            </IconCircle>
            <View style={{ flex: 1 }}>
              <DetailTitle>{orderDetail.title}</DetailTitle>
              <DetailText numberOfLines={2}>{orderDetail.subtitle}</DetailText>
            </View>
            {!isEditingOrder && router.canGoBack() ? (
              <LinkButton accessibilityRole="button" accessibilityLabel="Change order details" onPress={() => router.back()}>
                <LinkButtonText>Change</LinkButtonText>
              </LinkButton>
            ) : null}
          </DetailRow>
        </Card>

        <Card>
          <CardHeading>
            <CardTitle>Your order</CardTitle>
            <CardHint>{itemCount} item{itemCount === 1 ? '' : 's'}</CardHint>
          </CardHeading>
          {!!restaurantName && <CardSubtitle>{restaurantName}</CardSubtitle>}
          {summaryItems.map((item, index) => (
            <ItemRow key={item.key} $first={index === 0} $last={index === summaryItems.length - 1}>
              <QuantityBadge>
                <QuantityBadgeText>{item.quantity}×</QuantityBadgeText>
              </QuantityBadge>
              <View style={{ flex: 1, marginRight: 12 }}>
                <ItemName>{item.name}</ItemName>
                {!!item.detail && <ItemDetail>{item.detail}</ItemDetail>}
              </View>
              <ItemAmount>₹{item.amount.toFixed(2)}</ItemAmount>
            </ItemRow>
          ))}
        </Card>

        <Card>
          <CardHeading>
            <Ionicons name="pricetag-outline" size={18} color={T.color.brand} />
            <CardTitle>Offers & coupons</CardTitle>
          </CardHeading>
          {isCouponSectionDisabled ? (
            <CouponStatusText>Your cart contains only deals or beverages, which aren’t eligible for coupons.</CouponStatusText>
          ) : null}
          {!isCouponSectionDisabled && (hasDealItems || hasBeverageItems) ? (
            <CouponStatusText>Coupons apply to eligible items only. Deals and beverages are excluded.</CouponStatusText>
          ) : null}
          {offerResults.length > 0 ? (
            <OffersList>
              {offerResults.map((offer) => {
                const isApplied = appliedCoupon?.offerId === offer.offerId;
                return (
                  <OfferRow key={offer.offerId} $applied={isApplied}>
                    <Ionicons
                      name={isApplied ? 'checkmark-circle' : 'gift-outline'}
                      size={18}
                      color={isApplied ? T.color.success : offer.applicable ? T.color.brand : T.color.faint}
                    />
                    <View style={{ flex: 1 }}>
                      <OfferRowHeadline>{offer.headline}</OfferRowHeadline>
                      {offer.applicable ? (
                        <OfferRowNote>{isApplied ? `You save ₹${offer.discountAmount.toFixed(0)}` : `Save ₹${offer.discountAmount.toFixed(0)} on this order`}</OfferRowNote>
                      ) : (
                        <OfferRowHint>{offer.message || 'Not available for this cart yet.'}</OfferRowHint>
                      )}
                    </View>
                    {isApplied ? (
                      <OfferRowApplied>APPLIED</OfferRowApplied>
                    ) : offer.applicable ? (
                      <OutlineButton
                        accessibilityRole="button"
                        accessibilityLabel={`Apply ${offer.headline}`}
                        onPress={() => {
                          setAutoOfferDismissed(false);
                          applyOffer(offer);
                        }}
                      >
                        <OutlineButtonText>Apply</OutlineButtonText>
                      </OutlineButton>
                    ) : null}
                  </OfferRow>
                );
              })}
            </OffersList>
          ) : null}

          {appliedCoupon && !isCouponSectionDisabled ? (
            <AppliedCouponBanner>
              <AppliedCouponIcon>
                <Ionicons name="pricetag" size={16} color={T.color.success} />
              </AppliedCouponIcon>
              <View style={{ flex: 1 }}>
                <AppliedCouponTitle>{appliedCoupon.offerId ? 'Offer applied' : `${appliedCoupon.code} applied`}</AppliedCouponTitle>
                <AppliedCouponText numberOfLines={2}>
                  {appliedCouponHeadline}
                  {appliedCoupon.type !== 'Freebie' && discountAmount > 0 ? ` · You save ₹${discountAmount.toFixed(2)}` : ''}
                </AppliedCouponText>
              </View>
              <LinkButton accessibilityRole="button" accessibilityLabel="Remove coupon" onPress={handleRemoveCoupon}>
                <LinkButtonText $danger>{AppStrings.common.remove}</LinkButtonText>
              </LinkButton>
            </AppliedCouponBanner>
          ) : (
            <CouponContainer>
              <CouponInput
                value={couponCodeInput}
                onChangeText={setCouponCodeInput}
                placeholder="Enter coupon code"
                accessibilityLabel="Coupon code"
                placeholderTextColor={T.color.faint}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isCouponSectionDisabled}
                $disabledInput={isCouponSectionDisabled}
              />
              <ApplyCouponButton
                accessibilityRole="button"
                onPress={handleApplyCouponByCode}
                disabled={isCouponSectionDisabled || isApplyingCoupon || !String(couponCodeInput || '').trim()}
              >
                <ApplyCouponText>{isApplyingCoupon ? 'Applying…' : 'Apply'}</ApplyCouponText>
              </ApplyCouponButton>
            </CouponContainer>
          )}

          <ViewAllCouponsButton accessibilityRole="button" onPress={handleOpenCouponModal} disabled={isCouponSectionDisabled}>
            <Ionicons name="ticket-outline" size={16} color={T.color.brand} />
            <ViewAllCouponsText>View all coupons</ViewAllCouponsText>
            <Ionicons name="chevron-forward" size={16} color={T.color.brand} />
          </ViewAllCouponsButton>
        </Card>

        <Card>
          <CardHeading>
            <Ionicons name="receipt-outline" size={18} color={T.color.brand} />
            <CardTitle>Bill details</CardTitle>
          </CardHeading>
          <BillRow>
            <BillLabel>Item total</BillLabel>
            <BillValue>₹{subtotal.toFixed(2)}</BillValue>
          </BillRow>
          {appliedCoupon && !isCouponSectionDisabled && (
            <BillRow>
              <BillLabel $saving>{appliedCoupon.offerId ? 'Offer discount' : 'Coupon discount'}</BillLabel>
              <BillValue $saving>{appliedCoupon.type === 'Freebie' ? 'FREE' : `−₹${discountAmount.toFixed(2)}`}</BillValue>
            </BillRow>
          )}
          {canRedeemCoins && (
            <BillRow>
              <BillLabel $saving>Reward coins ({earnedCoin})</BillLabel>
              <BillValue $saving>−₹{coinDiscount.toFixed(2)}</BillValue>
            </BillRow>
          )}
          {walletUsed > 0 && (
            <BillRow>
              <BillLabel $saving>Wallet used</BillLabel>
              <BillValue $saving>−₹{walletUsed.toFixed(2)}</BillValue>
            </BillRow>
          )}
          {packagingCharge > 0 && (
            <BillRow>
              <BillLabel>Packaging charges</BillLabel>
              <BillValue>₹{packagingCharge.toFixed(2)}</BillValue>
            </BillRow>
          )}
          {gstSplit && (
            <>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setGstExpanded((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: gstExpanded }}
                accessibilityLabel={`GST ${gstPercent}%, ₹${gstAmount.toFixed(2)}. ${gstExpanded ? 'Hide' : 'Show'} CGST and SGST`}
              >
                <BillRow>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <BillLabel>{gstIncluded ? `GST ${gstPercent}% (included)` : `GST (${gstPercent}%)`}</BillLabel>
                    <Ionicons name={gstExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={T.color.inkSoft} />
                  </View>
                  <BillValue>₹{gstAmount.toFixed(2)}</BillValue>
                </BillRow>
              </TouchableOpacity>
              {gstExpanded && (
                <GstBreakup>
                  <BillRow>
                    <GstBreakupText>CGST ({gstSplit.halfRateLabel})</GstBreakupText>
                    <GstBreakupText>₹{gstSplit.cgst.toFixed(2)}</GstBreakupText>
                  </BillRow>
                  <BillRow>
                    <GstBreakupText>SGST ({gstSplit.halfRateLabel})</GstBreakupText>
                    <GstBreakupText>₹{gstSplit.sgst.toFixed(2)}</GstBreakupText>
                  </BillRow>
                </GstBreakup>
              )}
            </>
          )}
          {isHomeDeliveryOrder ? (
            <BillRow>
              <BillLabel>Delivery fee</BillLabel>
              <BillValue $saving={deliveryFee === 0}>{deliveryFee === 0 ? 'FREE' : `₹${deliveryFee.toFixed(2)}`}</BillValue>
            </BillRow>
          ) : null}
          {roundOff !== 0 && (
            <BillRow>
              <BillLabel>Round off</BillLabel>
              <BillValue>{roundOff < 0 ? '−' : ''}₹{Math.abs(roundOff).toFixed(2)}</BillValue>
            </BillRow>
          )}
          <BillTotalRow>
            <BillTotalLabel>To pay</BillTotalLabel>
            <BillTotalValue>₹{total.toFixed(2)}</BillTotalValue>
          </BillTotalRow>
          {totalSavings > 0 ? (
            <SavingsStrip>
              <Ionicons name="sparkles-outline" size={16} color={T.color.success} />
              <SavingsStripText>You’re saving ₹{totalSavings.toFixed(2)} on this order</SavingsStripText>
            </SavingsStrip>
          ) : null}
        </Card>

        <Card>
          <CardHeading>
            <Ionicons name="wallet-outline" size={18} color={T.color.brand} />
            <CardTitle>Payment</CardTitle>
          </CardHeading>
          {showPaymentChoice ? (
            <View accessibilityRole="radiogroup">
              {([
                { id: 'ONLINE', icon: 'card-outline', title: 'Pay online', hint: 'UPI, cards, net banking — secured by Razorpay' },
                { id: 'COD', icon: 'cash-outline', title: isHomeDeliveryOrder ? 'Pay on delivery' : 'Pay at the restaurant', hint: 'Cash or UPI when you get your food' },
              ] as const).map((option) => {
                const selected = payMode === option.id;
                return (
                  <PaymentOption
                    key={option.id}
                    $selected={selected}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setPayMode(option.id)}
                    activeOpacity={0.8}
                  >
                    <PaymentIcon $selected={selected}>
                      <Ionicons name={option.icon} size={18} color={selected ? T.color.brand : T.color.inkSoft} />
                    </PaymentIcon>
                    <View style={{ flex: 1 }}>
                      <PaymentOptionTitle>{option.title}</PaymentOptionTitle>
                      <PaymentOptionHint>{option.hint}</PaymentOptionHint>
                    </View>
                    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? T.color.brand : '#d6d3d1'} />
                  </PaymentOption>
                );
              })}
              {payMode === 'ONLINE' ? <PaymentOptionHint style={{ marginTop: 2 }}>The exact amount, including taxes, is shown on the payment screen.</PaymentOptionHint> : null}
            </View>
          ) : (
            <DetailRow>
              <IconCircle>
                <Ionicons name="cash-outline" size={18} color={T.color.brand} />
              </IconCircle>
              <View style={{ flex: 1 }}>
                <DetailTitle>{offlinePayment.title}</DetailTitle>
                <DetailText>{offlinePayment.hint}</DetailText>
              </View>
            </DetailRow>
          )}
        </Card>
      </ScrollContainer>

      <Modal
        visible={couponModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCouponModalVisible(false)}
      >
        <CouponSheetOverlay>
          <CouponSheet style={{ paddingBottom: insets.bottom + moderateVerticalScale(16) }}>
            <CouponSheetHandle />
            <CouponSheetHeader>
              <CouponModalTitle>{AppStrings.checkout.couponTitle}</CouponModalTitle>
              <CouponSheetCloseBtn onPress={() => setCouponModalVisible(false)}>
                <Ionicons name="close" size={moderateScale(22)} color={AppColors.textDark} />
              </CouponSheetCloseBtn>
            </CouponSheetHeader>

            {couponsLoading ? (
              <CouponLoadingWrap>
                <ActivityIndicator color={AppColors.primary} />
              </CouponLoadingWrap>
            ) : visibleCoupons.length === 0 ? (
              <CouponEmptyText>
                {hiddenByOrderTypeCount > 0 ? `No coupons available for ${orderTypeLabel} orders right now.` : 'No coupons available right now.'}
              </CouponEmptyText>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {visibleCoupons.map(coupon => {
                  const eligible = couponEligibleSubtotal >= coupon.minOrder;
                  const isApplied = appliedCoupon?.id === coupon.id;
                  const isUsageLimitReached = Boolean(
                    coupon.timesPerUser && (coupon.userUsageCount ?? 0) >= coupon.timesPerUser
                  );
                  const canApplyCoupon = eligible && !isUsageLimitReached;
                  return (
                    <CouponCard key={coupon.id} applied={isApplied}>
                      <CouponCardLeft>
                        <CouponCode>{coupon.code}</CouponCode>
                        <CouponDesc>
                          {coupon.dealHeadline
                            ? coupon.dealHeadline
                            : coupon.type === 'Percentage'
                            ? `${coupon.value}% off${coupon.maxDiscount > 0 ? ` up to ₹${coupon.maxDiscount}` : ''}`
                            : coupon.type === 'Flat'
                              ? `₹${coupon.value} flat off`
                              : `${String(coupon.freeItemName || coupon.title || 'Free item')} free`}
                          {' · '}Min order ₹{coupon.minOrder}
                        </CouponDesc>
                        {coupon.timesPerUser ? (
                          <CouponUsageText>
                            {coupon.timesPerUser} time{coupon.timesPerUser === 1 ? '' : 's'} per user
                            {' · '}
                            Used {coupon.userUsageCount ?? 0}/{coupon.timesPerUser}
                          </CouponUsageText>
                        ) : null}
                        {!eligible && (
                          <CouponNotEligible>
                            Add ₹{(coupon.minOrder - couponEligibleSubtotal).toFixed(0)} more eligible items to unlock
                          </CouponNotEligible>
                        )}
                        {isUsageLimitReached && (
                          <CouponNotEligible>
                            Already used the maximum allowed times
                          </CouponNotEligible>
                        )}
                        {coupon.expiry && (
                          <CouponExpiry>
                            Expires {coupon.expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </CouponExpiry>
                        )}
                      </CouponCardLeft>
                      <CouponApplyBtn
                        onPress={() => handleApplyCoupon(coupon)}
                        disabled={!canApplyCoupon || isApplyingCoupon}
                        eligible={canApplyCoupon}
                        applied={isApplied}
                      >
                        <CouponApplyBtnText applied={isApplied}>
                          {isApplied ? 'Applied' : isUsageLimitReached ? 'Used' : 'Apply'}
                        </CouponApplyBtnText>
                      </CouponApplyBtn>
                    </CouponCard>
                  );
                })}
              </ScrollView>
            )}
          </CouponSheet>
        </CouponSheetOverlay>
      </Modal>

      <Modal
        visible={reserveModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!reserveSubmitting) {
            setReserveModalVisible(false);
          }
        }}
      >
        <ReserveSheetOverlay>
          <ReserveSheet style={{ paddingBottom: insets.bottom + moderateVerticalScale(16) }}>
            <ReserveSheetHandle />
            <ReserveHeaderRow>
              <ReserveHeaderTitle>Cafe is Closed</ReserveHeaderTitle>
              <ReserveCloseBtn disabled={reserveSubmitting} onPress={() => setReserveModalVisible(false)}>
                <Ionicons name="close" size={moderateScale(22)} color={AppColors.textDark} />
              </ReserveCloseBtn>
            </ReserveHeaderRow>

            <ReserveSubText>
              We are currently closed. Reserve your order now and we&apos;ll prepare it fresh during your selected time slot.
            </ReserveSubText>

            <ReserveDateCard>
              <ReserveDateLabel>Delivery Date</ReserveDateLabel>
              <ReserveDateValue>{reserveDateDisplay}</ReserveDateValue>
            </ReserveDateCard>

            <ReserveSectionTitle>Select Time Slot</ReserveSectionTitle>

            {reserveLoading ? (
              <ReserveLoadingWrap>
                <ActivityIndicator color={AppColors.primary} />
              </ReserveLoadingWrap>
            ) : reserveSlots.length < 1 ? (
              <ReserveEmptyText>No slots available for tomorrow.</ReserveEmptyText>
            ) : (
              <ReserveSlotsScroll showsVerticalScrollIndicator={false}>
                {reserveSlots.map((slot) => {
                  const isSelected = slot.slotIndex === selectedReserveSlotIndex;
                  const isFull = slot.status === 'full';
                  const slotStatusLabel = isFull
                    ? 'Full'
                    : slot.status === 'limited'
                      ? `Only ${slot.slotsLeft} slots left`
                      : 'Available';

                  return (
                    <ReserveSlotCard
                      key={`${slot.slotIndex}-${slot.slotLabel}`}
                      disabled={isFull || reserveSubmitting}
                      $selected={isSelected}
                      $disabled={isFull}
                      onPress={() => setSelectedReserveSlotIndex(slot.slotIndex)}
                    >
                      <ReserveSlotTime>{slot.slotLabel}</ReserveSlotTime>
                      <ReserveSlotBadge $status={slot.status}>
                        <ReserveSlotBadgeText $status={slot.status}>{slotStatusLabel}</ReserveSlotBadgeText>
                      </ReserveSlotBadge>
                    </ReserveSlotCard>
                  );
                })}
              </ReserveSlotsScroll>
            )}

            <ReserveSummaryCard>
              <ReserveSummaryRow>
                <ReserveSummaryLabel>Cart Total</ReserveSummaryLabel>
                <ReserveSummaryValue>₹{total.toFixed(2)}</ReserveSummaryValue>
              </ReserveSummaryRow>
              <ReserveSummaryRow>
                <ReserveSummaryLabel>Selected Slot</ReserveSummaryLabel>
                <ReserveSummaryValue>{reserveSelectedSlot?.slotLabel || 'Not selected'}</ReserveSummaryValue>
              </ReserveSummaryRow>
              <ReserveSummaryRow>
                <ReserveSummaryLabel>Payment Method</ReserveSummaryLabel>
                <ReserveSummaryValue>{isHomeDeliveryOrder ? 'Cash on Delivery' : 'Cash'}</ReserveSummaryValue>
              </ReserveSummaryRow>
            </ReserveSummaryCard>

            <AppButton
              title={reserveSubmitting ? 'Reserving...' : 'Reserve Order'}
              onPress={handleReserveOrder}
              disabled={reserveSubmitting || !reserveSelectedSlot || reserveSelectedSlot.status === 'full'}
              style={{ width: '100%', marginTop: moderateVerticalScale(12) }}
            />
          </ReserveSheet>
        </ReserveSheetOverlay>
      </Modal>
      <RazorpayCheckout payment={checkoutPayment} onResult={handlePaymentResult} />
      <RestaurantPausedBanner />
      {!isCafeOpen && (
        <CafeClosedBanner>
          <Ionicons name="time-outline" size={16} color={T.color.danger} />
          <CafeClosedBannerText>{cafeClosedMessage}</CafeClosedBannerText>
        </CafeClosedBanner>
      )}
      <Footer style={{ paddingBottom: insets.bottom + 12 }}>
        <FooterTotal>
          <FooterLabel>TO PAY</FooterLabel>
          <FooterAmount>₹{total.toFixed(2)}</FooterAmount>
          {totalSavings > 0 ? <FooterSaved>Saved ₹{totalSavings.toFixed(0)}</FooterSaved> : null}
        </FooterTotal>
        <AppButton
          title={
            restaurantUnavailable
              ? 'Not taking orders'
              : !isCafeOpen
                ? 'Schedule Order'
                : onlineAvailable && payMode === 'ONLINE' && isOffPremiseOrder
                  ? 'Proceed to Pay'
                  : AppStrings.common.placeOrder
          }
          onPress={handlePlaceOrder}
          disabled={restaurantUnavailable || placingOrder}
          loading={placingOrder}
          style={{ flex: 1 }}
        />
      </Footer>
    </Container>
  );
};

export default CheckoutScreen;

const Container = styled(PageScreen)`
  flex: 1;
  background-color: ${T.color.canvas};
`;

const ScrollContainer = styled.ScrollView`
  flex: 1;
`;

// ── Intro ───────────────────────────────────────────────────────────────────
const IntroBlock = styled.View`
  padding: 16px 16px 14px;
`;

const StepBar = styled.View`
  flex-direction: row;
  gap: 6px;
  margin-bottom: 12px;
`;

const StepSegment = styled.View<{ $active?: boolean }>`
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background-color: ${(props: { $active?: boolean }) => (props.$active ? T.color.brand : T.color.line)};
`;

const IntroStep = styled.Text`
  color: ${T.color.brand};
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  margin-bottom: 6px;
`;

const IntroTitle = styled.Text`
  font-size: ${scaleFont(22)}px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 4px;
`;

const IntroSubtitle = styled.Text`
  color: ${T.color.muted};
  font-size: ${scaleFont(13)}px;
`;

// ── Cards ───────────────────────────────────────────────────────────────────
const Card = styled.View`
  background-color: ${T.color.surface};
  border-radius: ${T.radius.lg}px;
  border: 1px solid ${T.color.line};
  padding: 14px;
  margin: 0 16px 12px;
`;

const CardHeading = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
`;

const CardTitle = styled.Text`
  flex: 1;
  font-size: ${scaleFont(15)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const CardHint = styled.Text`
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
  color: ${T.color.muted};
`;

const CardSubtitle = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: ${T.color.muted};
  margin-top: -8px;
  margin-bottom: 8px;
`;

const DetailRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

const IconCircle = styled.View`
  width: 38px;
  height: 38px;
  border-radius: 19px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.brandSoft};
`;

const DetailTitle = styled.Text`
  font-size: ${scaleFont(14)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const DetailText = styled.Text`
  font-size: ${scaleFont(12)}px;
  line-height: ${scaleFont(17)}px;
  color: ${T.color.muted};
  margin-top: 2px;
`;

const LinkButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  padding: 6px 4px 6px 10px;
`;

const LinkButtonText = styled.Text<{ $danger?: boolean }>`
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
  color: ${(props: { $danger?: boolean }) => (props.$danger ? T.color.danger : T.color.brand)};
`;

// ── Items ───────────────────────────────────────────────────────────────────
const ItemRow = styled.View<{ $first?: boolean; $last?: boolean }>`
  flex-direction: row;
  align-items: flex-start;
  padding: 10px 0 ${(props: { $last?: boolean }) => (props.$last ? 0 : 10)}px;
  border-top-width: ${(props: { $first?: boolean }) => (props.$first ? 0 : 1)}px;
  border-top-color: ${T.color.line};
`;

const QuantityBadge = styled.View`
  min-width: 30px;
  align-items: center;
  background-color: ${T.color.brandSoft};
  border-radius: 6px;
  padding: 3px 6px;
  margin-right: 10px;
`;

const QuantityBadgeText = styled.Text`
  color: #b75b12;
  font-size: ${scaleFont(12)}px;
  font-weight: 800;
`;

const ItemName = styled.Text`
  color: ${T.color.ink};
  font-size: ${scaleFont(14)}px;
  font-weight: 600;
`;

const ItemDetail = styled.Text`
  color: ${T.color.muted};
  font-size: ${scaleFont(11)}px;
  line-height: ${scaleFont(17)}px;
  margin-top: 3px;
`;

const ItemAmount = styled.Text`
  color: ${T.color.ink};
  font-size: ${scaleFont(14)}px;
  font-weight: 700;
`;

// ── Offers & coupons ────────────────────────────────────────────────────────
const CouponStatusText = styled.Text`
  font-size: ${scaleFont(12)}px;
  line-height: ${scaleFont(18)}px;
  color: ${T.color.muted};
  margin-bottom: 10px;
`;

const OffersList = styled.View`
  margin-bottom: 12px;
  gap: 8px;
`;

const OfferRow = styled.View<{ $applied?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: ${T.radius.md}px;
  border-width: 1px;
  border-style: dashed;
  border-color: ${(props: { $applied?: boolean }) => (props.$applied ? T.color.success : T.color.brandBorder)};
  background-color: ${(props: { $applied?: boolean }) => (props.$applied ? T.color.successSoft : '#fffaf5')};
`;

const OfferRowHeadline = styled.Text`
  font-size: ${scaleFont(13)}px;
  font-weight: 700;
  color: ${T.color.ink};
`;

const OfferRowNote = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: ${T.color.success};
  margin-top: 2px;
`;

const OfferRowHint = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #a35a12;
  margin-top: 2px;
`;

const OfferRowApplied = styled.Text`
  font-size: ${scaleFont(11)}px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: ${T.color.success};
`;

const OutlineButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  border: 1px solid ${T.color.brand};
  background-color: ${T.color.surface};
  padding: 7px 14px;
  border-radius: ${T.radius.sm}px;
`;

const OutlineButtonText = styled.Text`
  color: ${T.color.brand};
  font-weight: 800;
  font-size: ${scaleFont(13)}px;
`;

const AppliedCouponBanner = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: ${T.radius.md}px;
  background-color: ${T.color.successSoft};
  border: 1px solid #bbf7d0;
`;

const AppliedCouponIcon = styled.View`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: #dcfce7;
`;

const AppliedCouponTitle = styled.Text`
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
  color: #166534;
`;

const AppliedCouponText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #15803d;
  margin-top: 1px;
`;

const CouponContainer = styled.View`
  flex-direction: row;
  gap: 10px;
  align-items: center;
`;

const CouponInput = styled.TextInput<{ $disabledInput?: boolean }>`
  flex: 1;
  border: 1px solid ${T.color.line};
  border-radius: ${T.radius.md}px;
  padding: 11px 12px;
  font-size: ${scaleFont(14)}px;
  font-weight: 600;
  letter-spacing: 0.5px;
  background-color: ${(props: { $disabledInput?: boolean }) => (props.$disabledInput ? '#f5f5f4' : T.color.canvas)};
  color: ${(props: { $disabledInput?: boolean }) => (props.$disabledInput ? T.color.muted : T.color.ink)};
`;

const ApplyCouponButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  background-color: ${T.color.brand};
  padding: 12px 18px;
  border-radius: ${T.radius.md}px;
  opacity: ${(props: any) => props.disabled ? 0.5 : 1};
`;

const ApplyCouponText = styled.Text`
  color: ${AppColors.white};
  font-weight: 800;
  font-size: ${scaleFont(14)}px;
`;

const ViewAllCouponsButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-top: 10px;
  padding-top: 8px;
  border-top-width: 1px;
  border-top-color: ${T.color.line};
  opacity: ${(props: any) => props.disabled ? 0.45 : 1};
`;

const ViewAllCouponsText = styled.Text`
  flex: 1;
  color: ${T.color.brand};
  font-size: ${scaleFont(13)}px;
  font-weight: 700;
`;

// ── Bill ────────────────────────────────────────────────────────────────────
const BillRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
`;

const BillLabel = styled.Text<{ $saving?: boolean }>`
  font-size: ${scaleFont(13)}px;
  color: ${(props: { $saving?: boolean }) => (props.$saving ? T.color.success : T.color.inkSoft)};
`;

const BillValue = styled.Text<{ $saving?: boolean }>`
  font-size: ${scaleFont(13)}px;
  font-weight: 600;
  color: ${(props: { $saving?: boolean }) => (props.$saving ? T.color.success : T.color.ink)};
`;

const GstBreakup = styled.View`
  margin: 0 0 4px 10px;
  padding-left: 10px;
  border-left-width: 2px;
  border-left-color: ${T.color.line};
`;

const GstBreakupText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: ${T.color.inkSoft};
`;

const BillTotalRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 12px;
  border-top-width: 1px;
  border-top-color: ${T.color.line};
  border-style: dashed;
`;

const BillTotalLabel = styled.Text`
  font-size: ${scaleFont(15)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const BillTotalValue = styled.Text`
  font-size: ${scaleFont(16)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const SavingsStrip = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: ${T.radius.sm}px;
  background-color: ${T.color.successSoft};
`;

const SavingsStripText = styled.Text`
  flex: 1;
  color: #15803d;
  font-size: ${scaleFont(12)}px;
  font-weight: 700;
`;

// ── Payment ─────────────────────────────────────────────────────────────────
const PaymentOption = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $selected?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  background-color: ${(p: { $selected?: boolean }) => (p.$selected ? '#fffaf5' : T.color.surface)};
  border: 1.5px solid ${(p: { $selected?: boolean }) => (p.$selected ? T.color.brand : T.color.line)};
  border-radius: ${T.radius.md}px;
  padding: 12px;
  margin-bottom: 8px;
`;

const PaymentIcon = styled.View<{ $selected?: boolean }>`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background-color: ${(p: { $selected?: boolean }) => (p.$selected ? T.color.brandSoft : T.color.canvas)};
`;

const PaymentOptionTitle = styled.Text`
  color: ${T.color.ink};
  font-size: ${scaleFont(14)}px;
  font-weight: 700;
`;

const PaymentOptionHint = styled.Text`
  color: ${T.color.muted};
  font-size: ${scaleFont(12)}px;
  line-height: ${scaleFont(17)}px;
  margin-top: 1px;
`;

// ── Footer ──────────────────────────────────────────────────────────────────
const CafeClosedBanner = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  background-color: #fef2f2;
  border-top-width: 1px;
  border-top-color: #fecaca;
  padding: 10px 16px;
`;

const CafeClosedBannerText = styled.Text`
  flex: 1;
  color: ${T.color.danger};
  font-size: ${scaleFont(13)}px;
  line-height: ${scaleFont(18)}px;
`;

const Footer = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 12px ${PRIMARY_BUTTON_GUTTER}px 0;
  background-color: ${T.color.surface};
  border-top-width: 1px;
  border-top-color: ${T.color.line};
`;

const FooterTotal = styled.View`
  min-width: 90px;
`;

const FooterLabel = styled.Text`
  font-size: 10px;
  letter-spacing: 0.8px;
  color: ${T.color.muted};
  font-weight: 700;
  margin-bottom: 2px;
`;

const FooterAmount = styled.Text`
  font-size: ${scaleFont(20)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const FooterSaved = styled.Text`
  font-size: 11px;
  font-weight: 700;
  color: ${T.color.success};
  margin-top: 1px;
`;

// ── Coupon bottom-sheet styles ──────────────────────────────────────
const CouponSheetOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: flex-end;
`;

const CouponSheet = styled.View`
  background-color: ${T.color.canvas};
  border-top-left-radius: ${moderateScale(20)}px;
  border-top-right-radius: ${moderateScale(20)}px;
  padding: 0 ${moderateScale(16)}px ${moderateVerticalScale(16)}px;
  max-height: 75%;
`;

const CouponSheetHandle = styled.View`
  width: ${moderateScale(40)}px;
  height: ${moderateVerticalScale(4)}px;
  background-color: #ddd;
  border-radius: ${moderateScale(2)}px;
  align-self: center;
  margin: ${moderateVerticalScale(10)}px 0 ${moderateVerticalScale(4)}px;
`;

const CouponSheetHeader = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: ${moderateVerticalScale(8)}px 0 ${moderateVerticalScale(14)}px;
`;

const CouponSheetCloseBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.line};
`;

const CouponModalTitle = styled.Text`
  font-size: ${scaleFont(18)}px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const CouponLoadingWrap = styled.View`
  padding: ${moderateVerticalScale(32)}px 0;
  align-items: center;
`;

const CouponEmptyText = styled.Text`
  text-align: center;
  color: ${T.color.muted};
  padding: ${moderateVerticalScale(32)}px 0;
  font-size: ${scaleFont(14)}px;
`;

const CouponCard = styled.View<{ applied?: boolean }>`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${(props: any) => props.applied ? T.color.successSoft : T.color.surface};
  border-radius: ${T.radius.md}px;
  padding: ${moderateVerticalScale(14)}px ${moderateScale(12)}px;
  margin-bottom: ${moderateVerticalScale(10)}px;
  border-width: 1px;
  border-left-width: 4px;
  border-color: ${(props: any) => props.applied ? T.color.success : T.color.line};
  border-left-color: ${(props: any) => props.applied ? T.color.success : T.color.brand};
`;

const CouponCardLeft = styled.View`
  flex: 1;
  margin-right: ${moderateScale(12)}px;
`;

const CouponCode = styled.Text`
  font-size: ${scaleFont(15)}px;
  font-weight: 800;
  color: ${T.color.ink};
  letter-spacing: 0.5px;
  margin-bottom: ${moderateVerticalScale(4)}px;
`;

const CouponDesc = styled.Text`
  font-size: ${scaleFont(13)}px;
  color: ${T.color.inkSoft};
  margin-bottom: ${moderateVerticalScale(2)}px;
`;

const CouponUsageText = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #9a3412;
  margin-top: ${moderateVerticalScale(2)}px;
  margin-bottom: ${moderateVerticalScale(2)}px;
  font-weight: 600;
`;

const CouponNotEligible = styled.Text`
  font-size: ${scaleFont(12)}px;
  color: #c2410c;
  margin-top: ${moderateVerticalScale(4)}px;
`;

const CouponExpiry = styled.Text`
  font-size: ${scaleFont(11)}px;
  color: ${T.color.faint};
  margin-top: ${moderateVerticalScale(2)}px;
`;

const CouponApplyBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ eligible?: boolean; applied?: boolean }>`
  background-color: ${(props: any) =>
    props.applied ? T.color.success : props.eligible ? T.color.brand : '#d6d3d1'};
  padding: ${moderateVerticalScale(9)}px ${moderateScale(16)}px;
  border-radius: ${T.radius.sm}px;
`;

const CouponApplyBtnText = styled.Text<{ applied?: boolean }>`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 800;
`;

const ReserveSheetOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: flex-end;
`;

const ReserveSheet = styled.View`
  background-color: ${AppColors.background};
  border-top-left-radius: ${moderateScale(20)}px;
  border-top-right-radius: ${moderateScale(20)}px;
  padding: 0 ${moderateScale(16)}px ${moderateVerticalScale(16)}px;
  max-height: 88%;
`;

const ReserveSheetHandle = styled.View`
  width: ${moderateScale(40)}px;
  height: ${moderateVerticalScale(4)}px;
  background-color: #ddd;
  border-radius: ${moderateScale(2)}px;
  align-self: center;
  margin: ${moderateVerticalScale(10)}px 0 ${moderateVerticalScale(8)}px;
`;

const ReserveHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const ReserveHeaderTitle = styled.Text`
  font-size: ${scaleFont(21)}px;
  font-weight: 800;
  color: #111827;
`;

const ReserveCloseBtn = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  padding: ${moderateScale(4)}px;
`;

const ReserveSubText = styled.Text`
  margin-top: ${moderateVerticalScale(8)}px;
  color: #4b5563;
  font-size: ${scaleFont(14)}px;
  line-height: ${scaleFont(20)}px;
`;

const ReserveDateCard = styled.View`
  margin-top: ${moderateVerticalScale(12)}px;
  background-color: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateVerticalScale(10)}px ${moderateScale(12)}px;
`;

const ReserveDateLabel = styled.Text`
  color: #9a3412;
  font-size: ${scaleFont(12)}px;
  font-weight: 700;
`;

const ReserveDateValue = styled.Text`
  color: #7c2d12;
  font-size: ${scaleFont(16)}px;
  font-weight: 800;
  margin-top: ${moderateVerticalScale(2)}px;
`;

const ReserveSectionTitle = styled.Text`
  margin-top: ${moderateVerticalScale(14)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
  color: #111827;
  font-size: ${scaleFont(16)}px;
  font-weight: 800;
`;

const ReserveLoadingWrap = styled.View`
  padding: ${moderateVerticalScale(20)}px 0;
  align-items: center;
`;

const ReserveEmptyText = styled.Text`
  color: #6b7280;
  text-align: center;
  padding: ${moderateVerticalScale(14)}px 0 ${moderateVerticalScale(10)}px;
`;

const ReserveSlotsScroll = styled.ScrollView`
  max-height: ${moderateVerticalScale(260)}px;
`;

const ReserveSlotCard = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $selected: boolean; $disabled: boolean }>`
  border-width: 1px;
  border-color: ${({ $selected, $disabled }: { $selected: boolean; $disabled: boolean }) => ($disabled ? '#e5e7eb' : $selected ? '#f68712' : '#e5e7eb')};
  background-color: ${({ $selected, $disabled }: { $selected: boolean; $disabled: boolean }) => ($disabled ? '#f9fafb' : $selected ? '#fff7ed' : '#fff')};
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateScale(12)}px;
  margin-bottom: ${moderateVerticalScale(10)}px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const ReserveSlotTime = styled.Text`
  color: #111827;
  font-size: ${scaleFont(14)}px;
  font-weight: 700;
`;

const ReserveSlotBadge = styled.View<{ $status: 'available' | 'limited' | 'full' }>`
  padding: ${moderateVerticalScale(5)}px ${moderateScale(8)}px;
  border-radius: 999px;
  background-color: ${({ $status }: { $status: 'available' | 'limited' | 'full' }) => ($status === 'full' ? '#fee2e2' : $status === 'limited' ? '#ffedd5' : '#dcfce7')};
`;

const ReserveSlotBadgeText = styled.Text<{ $status: 'available' | 'limited' | 'full' }>`
  color: ${({ $status }: { $status: 'available' | 'limited' | 'full' }) => ($status === 'full' ? '#b91c1c' : $status === 'limited' ? '#c2410c' : '#15803d')};
  font-size: ${scaleFont(11)}px;
  font-weight: 800;
`;

const ReserveSummaryCard = styled.View`
  margin-top: ${moderateVerticalScale(12)}px;
  border-width: 1px;
  border-color: #e5e7eb;
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateScale(12)}px;
  background-color: #fff;
`;

const ReserveSummaryRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${moderateVerticalScale(8)}px;
`;

const ReserveSummaryLabel = styled.Text`
  color: #6b7280;
  font-size: ${scaleFont(13)}px;
  font-weight: 600;
`;

const ReserveSummaryValue = styled.Text`
  color: #111827;
  font-size: ${scaleFont(13)}px;
  font-weight: 700;
`;
