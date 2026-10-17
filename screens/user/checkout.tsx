import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import AppButton from '@/components/common/AppButton';
import { AppColors } from '@/constants/appColors';
import { AppStrings } from '@/constants/appStrings';
import { useAppLoader } from '@/hooks/useAppLoader';
import { computeDeliveryFee, DEFAULT_PRICING_CONFIG, getPricingConfig, PricingConfig } from '@/services/appConfigService';
import { validateCoupon, CouponItem, fetchActiveCoupons, formatCouponOrderTypes, isCouponValidForOrderType, toBackendOrderType } from '@/services/couponService';
import { OrderItem, placeOrder, toPosOrderItems } from '@/services/orderService';
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
import { ActivityIndicator, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
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

  useFocusEffect(
    useCallback(() => {
      hideGlobalLoader();
    }, [hideGlobalLoader])
  );

  useEffect(() => {
    getPricingConfig().then(setPricingConfig);
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
  const totalBeforeWallet = subtotalAfterDiscount + packagingCharge + deliveryFee;
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
  const total = Number(Math.max(0, totalBeforeWallet - walletUsed - coinDiscount).toFixed(2));

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
    if (!branchId || couponsLoading || coupons.length === 0 || appliedCoupon) return;
    const pending = consumePendingOffer(branchId);
    if (!pending) return;
    const match = coupons.find((coupon) => String(coupon.code || '').trim().toUpperCase() === pending.couponCode.trim().toUpperCase());
    if (match) void handleApplyCoupon(match);
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

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setInfluencerCouponResult(null);
    setCouponCodeInput('');
  };

  const visibleCoupons = coupons.filter(
    (coupon) => String(coupon.createdFrom || '').trim().toUpperCase() !== 'SCRATCH_CARD'
      && isCouponValidForOrderType(coupon, backendOrderType)
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
          showAlert(
            "Restaurant isn't taking orders",
            `${live.description ? `${live.description}. ` : ''}Please try again later or order from another restaurant.`
          );
          return;
        }
        const closedMessage = getRestaurantClosedMessage(String(restaurantRecord?.openingHours || ''));
        if (closedMessage) {
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

      // Place order with pricing details
      const orderId = await placeOrder(
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
      );

      placed = true;

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
      showErrorAlert(error, 'Failed to place order. Please try again.', 'Error');
    } finally {
      // Keep the guard locked after success until checkout unmounts.
      if (!placed) placementInFlight.current = false;
      setPlacingOrder(false);
      hideGlobalLoader();
    }
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

  return (
    <Container>
      <PageHeader title="Checkout" />

      <ScrollContainer keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}>
        <CheckoutIntro>One last look before we get cooking.</CheckoutIntro>
        <Summary>
          <CardHeading><Ionicons name="receipt-outline" size={20} color="#ee7513" /><CardTitle>Order summary</CardTitle></CardHeading>
          {summaryItems.map(item => (
            <SummaryRow key={item.key} style={{ alignItems: 'flex-start' }}>
              <QuantityBadge>{item.quantity}×</QuantityBadge>
              <View style={{ flex: 1, marginRight: 12 }}>
                <ItemName>{item.name}</ItemName>
                {!!item.detail && <ItemDetail>{item.detail}</ItemDetail>}
              </View>
              <ItemAmount>₹{item.amount.toFixed(2)}</ItemAmount>
            </SummaryRow>
          ))}
          {cartSavings > 0 && <SavingsNote>You’re saving ₹{cartSavings.toFixed(2)} on your items</SavingsNote>}
          <Divider />
          <SummaryRow>
            <SubtotalLabel>Item subtotal</SubtotalLabel>
            <SubtotalValue>₹{subtotal.toFixed(2)}</SubtotalValue>
          </SummaryRow>
          {appliedCoupon && !isCouponSectionDisabled && (
            <SummaryRow>
              <DiscountLabel>Coupon discount</DiscountLabel>
              <DiscountValue>{appliedCoupon.type === 'Freebie' ? 'FREE' : `−₹${discountAmount.toFixed(2)}`}</DiscountValue>
            </SummaryRow>
          )}
          {walletUsed > 0 && <SummaryRow>
            <WalletLabel>Wallet used</WalletLabel>
            <WalletValue>−₹{walletUsed.toFixed(2)}</WalletValue>
          </SummaryRow>}
          {packagingCharge > 0 && <SummaryRow>
            <ChargeLabel>Packaging charges</ChargeLabel>
            <ChargeValue>₹{packagingCharge.toFixed(2)}</ChargeValue>
          </SummaryRow>}

          {isHomeDeliveryOrder ? (
            <SummaryRow>
              <ChargeLabel>Delivery Fee</ChargeLabel>
              <ChargeValue>₹{deliveryFee.toFixed(2)}</ChargeValue>
            </SummaryRow>
          ) : null}

          <Divider />

          {/* --- Reward Coin System UI --- */}
          {canRedeemCoins && (
            <>
              <SummaryRow>
                <SubtotalLabel>Reward Coins</SubtotalLabel>
                <SubtotalValue>{earnedCoin}</SubtotalValue>
              </SummaryRow>
              <SummaryRow>
                <SubtotalLabel>Coin Value</SubtotalLabel>
                <SubtotalValue>₹{coinValue}</SubtotalValue>
              </SummaryRow>
              <SummaryRow>
                <DiscountLabel>Coin Discount</DiscountLabel>
                <DiscountValue>-₹{coinDiscount}</DiscountValue>
              </SummaryRow>
            </>
          )}
          {/* --- End Reward Coin System UI --- */}

          <SummaryRow>
            <TotalLabel>To pay</TotalLabel>
            <TotalValue>₹{total.toFixed(2)}</TotalValue>
          </SummaryRow>
        </Summary>

        <CouponSection>
          <CardHeading><Ionicons name="pricetag-outline" size={20} color="#ee7513" /><CardTitle>Offers & coupons</CardTitle></CardHeading>
          {isCouponSectionDisabled ? (
            <CouponStatusText>Your cart contains only deals or beverages, which aren’t eligible for coupons.</CouponStatusText>
          ) : null}
          {!isCouponSectionDisabled && (hasDealItems || hasBeverageItems) ? (
            <CouponStatusText>Coupons apply to eligible items only. Deals and beverages are excluded.</CouponStatusText>
          ) : null}
          {appliedCoupon ? (
            <CouponAppliedText>
              ✅ {appliedCoupon.code} — {appliedCoupon.dealHeadline
                ? appliedCoupon.dealHeadline
                : appliedCoupon.type === 'Percentage'
                ? `${appliedCoupon.value}% OFF`
                : appliedCoupon.type === 'Flat'
                  ? `₹${appliedCoupon.value} OFF`
                  : `${freebieName} FREE`}
            </CouponAppliedText>
          ) : null}

          <CouponContainer>
            <CouponInput
              value={couponCodeInput}
              onChangeText={setCouponCodeInput}
              placeholder="Enter coupon code"
              accessibilityLabel="Coupon code"
              placeholderTextColor="#969397"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!appliedCoupon && !isCouponSectionDisabled}
              $disabledInput={Boolean(appliedCoupon) || isCouponSectionDisabled}
            />
            {appliedCoupon ? (
              <InlineRemoveButton onPress={handleRemoveCoupon}>
                <InlineRemoveText>{AppStrings.common.remove}</InlineRemoveText>
              </InlineRemoveButton>
            ) : (
              <ApplyCouponButton
                onPress={handleApplyCouponByCode}
                disabled={isCouponSectionDisabled || isApplyingCoupon || !String(couponCodeInput || '').trim()}
              >
                <ApplyCouponText>{isApplyingCoupon ? 'Applying...' : 'Apply'}</ApplyCouponText>
              </ApplyCouponButton>
            )}
          </CouponContainer>

          <ViewAllCouponsButton onPress={handleOpenCouponModal} disabled={isCouponSectionDisabled}>
            <ViewAllCouponsText>Browse available coupons</ViewAllCouponsText><Ionicons name="chevron-forward" size={16} color="#ee7513" />
          </ViewAllCouponsButton>

        </CouponSection>
      </ScrollContainer>

      <Modal
        visible={couponModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCouponModalVisible(false)}
      >
        <CouponSheetOverlay>
          <CouponSheet style={{ paddingBottom: Math.max(insets.bottom, moderateVerticalScale(16)) }}>
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
          <ReserveSheet style={{ paddingBottom: Math.max(insets.bottom, moderateVerticalScale(16)) }}>
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

      {/* Payment info for home delivery */}
      {isHomeDeliveryOrder && (
        <PaymentInfoBox>
          <PaymentInfoText>
            Payment will be collected by the delivery partner at the time of delivery.
          </PaymentInfoText>
        </PaymentInfoBox>
      )}
      <RestaurantPausedBanner />
      {!isCafeOpen && (
        <View>
        <CafeClosedBanner>
          <CafeClosedBannerText>{cafeClosedMessage}</CafeClosedBannerText>
        </CafeClosedBanner>
        </View>
      )}
      <View>
      <AppButton
        title={restaurantUnavailable ? 'Not taking orders' : isCafeOpen ? AppStrings.common.placeOrder : 'Schedule Order'}
        onPress={handlePlaceOrder}
        disabled={restaurantUnavailable || placingOrder}
        loading={placingOrder}
        style={{
          width: '90%',
          alignSelf: 'center',
          borderRadius: moderateScale(10),
          padding: moderateScale(16),
          marginTop: moderateVerticalScale(20),
          marginBottom: Math.max(moderateVerticalScale(20), insets.bottom),
        }}
      />
      </View>
    </Container>
  );
};



const CafeClosedBanner = styled.View`
  width: 90%;
  align-self: center;
  background-color: #fef2f2;
  border: 1px solid #ef4444;
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateVerticalScale(12)}px ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(6)}px;
`;

const CafeClosedBannerText = styled.Text`
  color: #dc2626;
  font-size: ${scaleFont(13)}px;
  text-align: center;
  line-height: ${scaleFont(18)}px;
`;

const PaymentInfoBox = styled.View`
  width: 90%;
  align-self: center;
  background-color: #fff7ef;
  border: 1px solid #f68712;
  border-radius: ${moderateScale(8)}px;
  padding: ${moderateVerticalScale(12)}px ${moderateScale(14)}px;
  margin-bottom: ${moderateVerticalScale(8)}px;
`;

const PaymentInfoText = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(15)}px;
  text-align: center;
`;

export default CheckoutScreen;

const Container = styled(PageScreen)`
  flex: 1;
  background-color: #fffbf7;
`;




const ScrollContainer = styled.ScrollView`
  flex: 1;
`;

const Summary = styled.View`
  background-color: #fff;
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateScale(16)}px;
  margin: 0 ${moderateScale(18)}px ${moderateScale(16)}px;
  border: 1px solid #eee5dc;
`;

const SummaryRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: ${moderateVerticalScale(12)}px;
  align-items: center;
`;


const SubtotalLabel = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #666;
  font-weight: 500;
`;

const SubtotalValue = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #333;
  font-weight: 600;
`;

const DiscountLabel = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #27ae60;
  font-weight: 500;
`;

const DiscountValue = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #27ae60;
  font-weight: 600;
`;

const WalletLabel = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #27ae60;
  font-weight: 500;
`;

const WalletValue = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #27ae60;
  font-weight: 600;
`;

const ChargeLabel = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #666;
  font-weight: 500;
`;

const ChargeValue = styled.Text`
  font-size: ${scaleFont(15)}px;
  color: #333;
  font-weight: 600;
`;

const Divider = styled.View`
  height: ${moderateVerticalScale(1)}px;
  background-color: #eee7e0;
  margin: ${moderateVerticalScale(12)}px 0;
`;

const TotalLabel = styled.Text`
  font-size: ${scaleFont(18)}px;
  font-weight: bold;
  color: #333;
`;

const TotalValue = styled.Text`
  color: #f68712;
  font-size: ${scaleFont(18)}px;
  font-weight: bold;
`;

const CouponSection = styled.View`
  margin: 0 ${moderateScale(18)}px;
  padding: ${moderateScale(16)}px;
  background-color: #fff;
  border-radius: ${moderateScale(12)}px;
  border: 1px solid #eee5dc;
`;


const CouponContainer = styled.View`
  flex-direction: row;
  gap: ${moderateScale(10)}px;
  align-items: center;
`;

const CouponInput = styled.TextInput<{ $disabledInput?: boolean }>`
  flex: 1;
  border: 1px solid #e8ded4;
  border-radius: ${moderateScale(10)}px;
  padding: ${moderateScale(12)}px;
  font-size: ${scaleFont(14)}px;
  background-color: ${(props: { $disabledInput?: boolean }) => (props.$disabledInput ? '#f3f4f6' : AppColors.background)};
  color: ${(props: { $disabledInput?: boolean }) => (props.$disabledInput ? '#6b7280' : AppColors.textDark)};
`;

const ApplyCouponButton = styled.TouchableOpacity`
  background-color: ${AppColors.primary};
  padding: ${moderateVerticalScale(12)}px ${moderateScale(20)}px;
  border-radius: ${moderateScale(8)}px;
  opacity: ${(props: any) => props.disabled ? 0.6 : 1};
`;

const InlineRemoveButton = styled.TouchableOpacity`
  background-color: ${AppColors.background};
  border: 1px solid ${AppColors.primary};
  padding: ${moderateVerticalScale(12)}px ${moderateScale(16)}px;
  border-radius: ${moderateScale(8)}px;
`;

const InlineRemoveText = styled.Text`
  color: ${AppColors.primary};
  font-weight: bold;
  font-size: ${scaleFont(14)}px;
`;

const CouponStatusText = styled.Text`
  font-size: ${scaleFont(12)}px;
  line-height: ${scaleFont(18)}px;
  color: #666;
  margin-bottom: ${moderateVerticalScale(10)}px;
`;

const CouponAppliedText = styled.Text`
  font-size: ${scaleFont(14)}px;
  color: ${AppColors.success};
  margin-bottom: ${moderateVerticalScale(10)}px;
  font-weight: 700;
`;

const ApplyCouponText = styled.Text`
  color: ${AppColors.white};
  font-weight: bold;
  font-size: ${scaleFont(14)}px;
`;


const ViewAllCouponsButton = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  opacity: ${(props: any) => props.disabled ? 0.45 : 1};
  margin-top: ${moderateVerticalScale(10)}px;
  padding: ${moderateVerticalScale(8)}px ${moderateScale(2)}px;
`;

const ViewAllCouponsText = styled.Text`
  color: ${AppColors.primary};
  font-size: ${scaleFont(13)}px;
  font-weight: 700;
`;

// ── Coupon bottom-sheet styles ──────────────────────────────────────
const CouponSheetOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: flex-end;
`;

const CouponSheet = styled.View`
  background-color: ${AppColors.background};
  border-top-left-radius: ${moderateScale(20)}px;
  border-top-right-radius: ${moderateScale(20)}px;
  padding: 0 ${moderateScale(16)}px ${moderateVerticalScale(16)}px;
  max-height: 70%;
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

const CouponSheetCloseBtn = styled.TouchableOpacity`
  padding: ${moderateScale(4)}px;
`;

const CouponModalTitle = styled.Text`
  font-size: ${scaleFont(18)}px;
  font-weight: 700;
  color: ${AppColors.textDark};
`;

const CouponLoadingWrap = styled.View`
  padding: ${moderateVerticalScale(32)}px 0;
  align-items: center;
`;

const CouponEmptyText = styled.Text`
  text-align: center;
  color: #999;
  padding: ${moderateVerticalScale(32)}px 0;
  font-size: ${scaleFont(14)}px;
`;

const CouponCard = styled.View<{ applied?: boolean }>`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: ${(props: any) => props.applied ? '#f0fdf4' : AppColors.lightBackground};
  border-radius: ${moderateScale(12)}px;
  padding: ${moderateVerticalScale(14)}px ${moderateScale(12)}px;
  margin-bottom: ${moderateVerticalScale(12)}px;
  border-width: 1.5px;
  border-color: ${(props: any) => props.applied ? '#22c55e' : AppColors.lightBorder};
`;

const CouponCardLeft = styled.View`
  flex: 1;
  margin-right: ${moderateScale(12)}px;
`;

const CouponCode = styled.Text`
  font-size: ${scaleFont(15)}px;
  font-weight: 700;
  color: ${AppColors.textDark};
  letter-spacing: 0.5px;
  margin-bottom: ${moderateVerticalScale(4)}px;
`;

const CouponDesc = styled.Text`
  font-size: ${scaleFont(13)}px;
  color: #555;
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
  color: #e07b00;
  margin-top: ${moderateVerticalScale(4)}px;
`;

const CouponExpiry = styled.Text`
  font-size: ${scaleFont(11)}px;
  color: #999;
  margin-top: ${moderateVerticalScale(2)}px;
`;

const CouponApplyBtn = styled.TouchableOpacity<{ eligible?: boolean; applied?: boolean }>`
  background-color: ${(props: any) =>
    props.applied ? '#22c55e' : props.eligible ? AppColors.primary : '#ccc'};
  padding: ${moderateVerticalScale(10)}px ${moderateScale(18)}px;
  border-radius: ${moderateScale(8)}px;
  opacity: ${(props: any) => props.eligible ? 1 : 0.7};
`;

const CouponApplyBtnText = styled.Text<{ applied?: boolean }>`
  color: #fff;
  font-size: ${scaleFont(13)}px;
  font-weight: 700;
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

const ReserveCloseBtn = styled.TouchableOpacity`
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

const ReserveSlotCard = styled.TouchableOpacity<{ $selected: boolean; $disabled: boolean }>`
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

const CheckoutIntro = styled.Text`
  color: #85818a;
  font-size: ${scaleFont(13)}px;
  margin: ${moderateScale(18)}px;
`;
const CardHeading = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
`;
const CardTitle = styled.Text`
  flex: 1;
  font-size: ${scaleFont(16)}px;
  font-weight: 700;
  color: #252a36;
`;
const QuantityBadge = styled.Text`
  overflow: hidden;
  background-color: #fff3e6;
  color: #b75b12;
  border-radius: 6px;
  padding: 4px 6px;
  margin-right: 10px;
  font-size: ${scaleFont(12)}px;
  font-weight: 700;
`;
const ItemName = styled.Text`
  color: #303440;
  font-size: ${scaleFont(14)}px;
  font-weight: 600;
`;
const ItemDetail = styled.Text`
  color: #85818a;
  font-size: ${scaleFont(11)}px;
  line-height: ${scaleFont(17)}px;
  margin-top: 4px;
`;
const ItemAmount = styled.Text`
  color: #303440;
  font-size: ${scaleFont(14)}px;
  font-weight: 600;
`;
const SavingsNote = styled.Text`
  color: #25854c;
  background-color: #edf8ef;
  padding: 10px;
  border-radius: 8px;
  font-size: ${scaleFont(12)}px;
  font-weight: 600;
`;
