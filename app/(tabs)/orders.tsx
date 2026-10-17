import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import AppImage from '@/components/AppImage';
import CancelOrderButton from '@/components/CancelOrderButton';
import { getMenuItems } from '@/services/menuService';
import { findRestaurantByAnyId } from '@/services/restaurantService';
import { userService } from '@/services/userService';
import { getMyOrdersPage, OrderRestaurantSummary, submitOrderReview as submitOrderReviewApi, uploadReviewImage } from '@/services/orderService';
import { setCartItems, setEditingOrderMeta } from '@/store/slices/cartSlice';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { shareInvoicePdf } from '@/utils/invoice';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { RootState } from '../../store';
import { OrderType } from '../../types/enums';
import { isOrderActive, isOrderCancelled, isOrderDelivered, orderStatusColors, orderStatusLabel } from '@/utils/orderStatus';
import { buildCartItemFromProduct, getSelectedProductVariant } from '@/utils/productVariants';
import { usePolling } from '@/utils/polling';
import { isRateLimited } from '@/utils/apiClient';

const ORDERS_POLL_MS = 30_000;

// Haversine formula to calculate distance in km between two lat/lng points
function getDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ORDER_TYPE_META: Record<string, { label: string; icon: string }> = {
  [OrderType.DINE_IN]: { label: 'Dine In', icon: 'restaurant-outline' },
  [OrderType.TAKE_AWAY]: { label: 'Takeaway', icon: 'bag-handle-outline' },
  [OrderType.HOME_DELIVERY]: { label: 'Delivery', icon: 'bicycle-outline' },
};

const MAX_VISIBLE_ITEMS = 3;

function formatOrderDate(value: unknown) {
  const date = new Date((value as any)?.toDate?.() || (value as any));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

/** App order-type code ('1' dine-in, '2' takeaway, '3' delivery) → status-label flavour. */
function orderKind(orderType: unknown): 'delivery' | 'takeaway' | 'dinein' {
  const value = String(orderType || '');
  return value === OrderType.TAKE_AWAY ? 'takeaway' : value === OrderType.DINE_IN ? 'dinein' : 'delivery';
}

function formatScheduledDateKey(dateKey: unknown) {
  const normalized = String(dateKey || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const OrderHistoryScreen = () => {
  const CAFE_PHONE_NUMBER = '8957246131';
  const user = useSelector((state: RootState) => state.auth.user);
  const dispatch = useDispatch();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Order history is paged (newest first): the first page is polled for status changes,
  // older pages load as the list is scrolled to the end.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const pagesLoadedRef = useRef(1);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [reviewOrder, setReviewOrder] = useState<any | null>(null);
  const [itemRatings, setItemRatings] = useState<Record<string, number>>({});
  const [reviewComment, setReviewComment] = useState('');
  const [reviewImageUri, setReviewImageUri] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  // Price breakdowns start collapsed — the card shows just the total; tap to expand.
  const [expandedBills, setExpandedBills] = useState<Set<string>>(() => new Set());
  const toggleBill = (orderId: string) =>
    setExpandedBills((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  const lastOrdersFingerprintRef = useRef('');
  const lastReferralRunKeyRef = useRef('');

  const getReviewProductId = (item: any, index: number) => {
    const candidate = String(item?.firebaseId || item?.id || '').trim();
    if (candidate) {
      return candidate;
    }

    return `item-${index}-${String(item?.name || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  };

  const getReviewableOrderItems = (order: any) => {
    const seen = new Set<string>();
    return (Array.isArray(order?.items) ? order.items : []).reduce((acc: Array<any>, item: any, index: number) => {
      const productId = getReviewProductId(item, index);
      if (!productId || seen.has(productId)) {
        return acc;
      }

      seen.add(productId);
      acc.push({ ...item, productId });
      return acc;
    }, []);
  };

  const getOrderItemReviews = (order: any) => {
    if (!order?.itemReviews || typeof order.itemReviews !== 'object') {
      return {} as Record<string, any>;
    }

    return order.itemReviews as Record<string, any>;
  };

  const getExistingItemReview = (order: any, productId: string) => {
    const itemReviews = getOrderItemReviews(order);
    if (itemReviews[productId]) {
      return itemReviews[productId];
    }

    const reviewableItems = getReviewableOrderItems(order);
    if (reviewableItems.length === 1 && Number(order?.review?.rating || 0) > 0) {
      return order.review;
    }

    return null;
  };

  const getReviewedItemCount = (order: any) => {
    const reviewableItems = getReviewableOrderItems(order);
    return reviewableItems.filter((item) => Number(getExistingItemReview(order, item.productId)?.rating || 0) > 0).length;
  };

  const loadReviewForm = (order: any) => {
    const reviewableItems = getReviewableOrderItems(order);
    const nextRatings = reviewableItems.reduce((acc, item) => {
      const existingReview = getExistingItemReview(order, item.productId);
      acc[item.productId] = Number(existingReview?.rating || 0);
      return acc;
    }, {} as Record<string, number>);

    const existingEntries = reviewableItems
      .map((item) => getExistingItemReview(order, item.productId))
      .filter(Boolean) as Array<any>;
    const latestExisting = existingEntries[existingEntries.length - 1] || null;

    setItemRatings(nextRatings);
    setReviewComment(String(order?.review?.comment || latestExisting?.comment || ''));
    setReviewImageUri(String(order?.review?.imageUrl || latestExisting?.imageUrl || ''));
  };


  const isEditableAppOrder = (order: any) => {
    const source = String(order?.source || '').toLowerCase();
    const orderType = String(order?.orderType || '').toLowerCase();
    // Disallow editing for Home delivery orders
    if (orderType === "3" || orderType === 'delivery') {
      return false;
    }
    return source === 'app' && isOrderActive(order?.status);
  };

  const handleEditOrder = async (order: any) => {
    try {
      setEditingOrderId(String(order?.id || ''));
      const restaurantId = String(order?.cafeId || order?.restaurantId || order?.restaurantID || order?.restaurant || '').trim();
      if (!restaurantId) {
        showAlert('Edit Unavailable', 'Restaurant not found for this order.');
        return;
      }

      const [restaurant, liveMenuItems] = await Promise.all([
        findRestaurantByAnyId(restaurantId),
        getMenuItems(),
      ]);

      if (!restaurant) {
        showAlert('Edit Unavailable', 'Restaurant details are not available right now.');
        return;
      }

      const liveMenuByKey = new Map(
        liveMenuItems.map((item) => [String(item.firebaseId || item.id), item])
      );

      const restoredCartItems = (Array.isArray(order?.items) ? order.items : []).map((item: any, index: number) => {
        const itemKey = String(item?.firebaseId || item?.id || '');
        const liveItem = liveMenuByKey.get(itemKey);
        const isSellable = Boolean(liveItem && liveItem.available !== false && liveItem.inStock !== false);
        const selectedVariant = getSelectedProductVariant(liveItem || item, item?.selectedVariantId || null);
        return {
          id: String(liveItem?.id || item?.id || itemKey || `order-item-${index}`),
          firebaseId: String(liveItem?.firebaseId || item?.firebaseId || item?.id || itemKey || `order-item-${index}`),
          name: String(liveItem?.name || item?.name || 'Item'),
          description: String(liveItem?.description || ''),
          images: Array.isArray(liveItem?.images) ? liveItem.images : [],
          price: Number(selectedVariant?.price ?? liveItem?.price ?? item?.price ?? 0),
          qty: liveItem?.qty ?? null,
          serves: liveItem?.serves ?? null,
          categoryId: liveItem?.categoryId ?? null,
          cafeId: String(liveItem?.cafeId || liveItem?.restaurantId || restaurant.id),
          restaurantId: String(liveItem?.restaurantId || liveItem?.cafeId || restaurant.id),
          emoji: liveItem?.emoji ?? null,
          available: isSellable,
          inStock: Boolean(liveItem?.inStock),
          hasHalfPortion: Boolean(liveItem?.hasHalfPortion),
          halfPrice: liveItem?.halfPrice ?? null,
          variants: liveItem?.variants || [],
          selectedVariantId: item?.selectedVariantId || selectedVariant?.id || null,
          selectedVariantName: item?.selectedVariantName || selectedVariant?.name || null,
          selectedVariantDescription: item?.selectedVariantDescription || selectedVariant?.description || null,
          quantity: Number(item?.quantity || 1),
        };
      });

      const blockedItem = restoredCartItems.find((item: any) => item.available !== true || item.inStock !== true);
      if (blockedItem) {
        showAlert('Edit Unavailable', `${blockedItem.name} is disabled or out of stock right now.`);
        return;
      }

      dispatch(setCartItems(restoredCartItems as any));
      dispatch(setEditingOrderMeta({
        orderId: String(order.id || ''),
        orderType: String(order.orderType || ''),
        tableNumber: String(order.tableNumber || ''),
        deliveryAddress: String(order.deliveryAddress || order.address || ''),
        restaurantId,
        deliveryLatitude: String(order?.deliveryLocation?.latitude || order?.deliveryLatitude || ''),
        deliveryLongitude: String(order?.deliveryLocation?.longitude || order?.deliveryLongitude || ''),
        deliveryAddressId: String(order?.deliveryAddressId || ''),
      }));

      router.push({
        pathname: '/user/restaurant-details',
        params: {
          restaurant: JSON.stringify(restaurant),
        },
      });
    } catch (error) {
      showErrorAlert(error, 'Unable to load this order for editing right now.', 'Error');
    } finally {
      setEditingOrderId(null);
    }
  };

  // --- REORDER HANDLER ---
  const handleReorder = async (order: any) => {
    try {
      // Fetch live menu items to ensure product info is up-to-date
      const liveMenuItems = await getMenuItems();
      const liveMenuByKey = new Map(
        liveMenuItems.map((item) => [String(item.firebaseId || item.id), item])
      );
      const cartItems = (order.items || []).map((item: any, idx: number) => {
        const itemKey = String(item.firebaseId || item.id || '');
        const liveItem = liveMenuByKey.get(itemKey);
        if (!liveItem) throw new Error(`Menu item not available: ${item.name}`);
        return {
          ...buildCartItemFromProduct(liveItem, item?.selectedVariantId || null),
          quantity: Number(item.quantity || 1),
        };
      });
      dispatch(setCartItems(cartItems));
      router.push('/user/cart');
    } catch (e) {
      showErrorAlert(e, 'Could not reorder this order.', 'Reorder Failed');
    }
  };

  const closeReviewModal = () => {
    setReviewOrder(null);
    setItemRatings({});
    setReviewComment('');
    setReviewImageUri('');
    setSubmittingReview(false);
  };

  const openReviewModal = (order: any) => {
    if (!order?.id) {
      showAlert('Error', 'Unable to open review for this order.');
      return;
    }

    const reviewableItems = getReviewableOrderItems(order);
    if (reviewableItems.length === 0) {
      showAlert('Error', 'No reviewable items found for this order.');
      return;
    }

    setReviewOrder(order);
    loadReviewForm(order);
  };

  const pickReviewImage = async () => {
    try {

      // Use system photo picker for Android 13+ (no permissions required)
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setReviewImageUri(result.assets[0].uri);
      }
    } catch (error) {
      showErrorAlert(error, 'Unable to pick image right now.', 'Error');
    }
  };

  const submitOrderReview = async () => {
    if (!reviewOrder?.id) {
      showAlert('Error', 'Order not found for review submission.');
      return;
    }

    const reviewableItems = getReviewableOrderItems(reviewOrder);
    if (reviewableItems.length === 0) {
      showAlert('Validation', 'No reviewable items found for this order.');
      return;
    }

    const unratedItems = reviewableItems.filter((item) => {
      const rating = Number(itemRatings[item.productId] || 0);
      return rating < 1 || rating > 5;
    });
    if (unratedItems.length > 0) {
      showAlert('Validation', 'Please rate all items from 1 to 5 stars before submitting.');
      return;
    }

    const trimmedComment = reviewComment.trim();
    if (!trimmedComment) {
      showAlert('Validation', 'Please write your review before submitting.');
      return;
    }

    const hasLowItemRating = reviewableItems.some((item) => Number(itemRatings[item.productId] || 0) < 2);
    if (hasLowItemRating && !reviewImageUri) {
      showAlert('Validation', 'Please attach an image when rating is below 2 stars.');
      return;
    }

    try {
      setSubmittingReview(true);

      let imageUrl = '';
      if (reviewImageUri) {
        imageUrl = reviewImageUri.startsWith('http://') || reviewImageUri.startsWith('https://')
          ? reviewImageUri
          : await uploadReviewImage(reviewImageUri);
      }

      await submitOrderReviewApi(String(reviewOrder.id), {
        items: reviewableItems.map((item) => ({ menuItemId: item.productId, rating: Number(itemRatings[item.productId] || 0) })),
        comment: trimmedComment,
        imageUrl: imageUrl || null,
      });

      await refreshFirstPage();

      closeReviewModal();
      showAlert('Thank You', 'Your review has been submitted successfully.');
    } catch (error) {
      showErrorAlert(error, 'Unable to submit review right now. Please try again.', 'Error');
      setSubmittingReview(false);
    }
  };

  const ordersRef = useRef<any[]>([]);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  /** Swaps in a freshly-fetched first page while keeping any older pages already loaded
   *  (anything older than the first page's last order). */
  const mergeFirstPage = (firstPage: any[], current: any[]) => {
    const last = firstPage[firstPage.length - 1];
    if (!last || pagesLoadedRef.current <= 1) return firstPage;
    const cutoff = getCreatedTime(last.createdAt);
    const firstIds = new Set(firstPage.map((order) => String(order.id)));
    return [...firstPage, ...current.filter((order) => !firstIds.has(String(order.id)) && getCreatedTime(order.createdAt) < cutoff)];
  };

  const refreshFirstPage = async () => {
    const firstPage = await getMyOrdersPage();
    setOrders((current) => mergeFirstPage(firstPage.orders, current));
    if (pagesLoadedRef.current <= 1) setNextCursor(firstPage.nextCursor);
  };

  const loadMoreOrders = async () => {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await getMyOrdersPage(nextCursor);
      setOrders((current) => {
        const seen = new Set(current.map((order) => String(order.id)));
        return [...current, ...page.orders.filter((order) => !seen.has(String(order.id)))];
      });
      pagesLoadedRef.current += 1;
      setNextCursor(page.nextCursor);
    } catch (error) {
      console.error('Failed to load more orders:', error);
      setLoadMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDownloadInvoice = async (order: any) => {
    if (!isOrderDelivered(order?.status)) {
      showAlert('Invoice Not Available', 'The invoice is available once your order is delivered or completed.');
      return;
    }
    setDownloadingInvoiceId(order.id);
    try {
      const kind = orderKind(order.orderType);
      const result = await shareInvoicePdf(
        {
          ...order,
          statusLabel: orderStatusLabel(order.status, kind),
          orderTypeLabel: kind === 'delivery' ? 'Home Delivery' : kind === 'takeaway' ? 'Takeaway' : 'Dine In',
        },
        { name: user?.name || order.customerName, email: user?.email || order.email, phone: user?.phoneNumber || order.mobileNumber }
      );
      if (!result.shared) showAlert('Invoice Ready', `Your invoice has been saved to:\n${result.uri}`);
    } catch (error) {
      console.error('Failed to generate invoice:', error);
      showErrorAlert(error, 'Unable to generate invoice. Please try again.', 'Error');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const handleCallCafe = async (phone?: string) => {
    const phoneUrl = `tel:${String(phone || '').replace(/[^\d+]/g, '') || CAFE_PHONE_NUMBER}`;
    try {
      const canOpen = await Linking.canOpenURL(phoneUrl);
      if (!canOpen) {
        showAlert('Call Not Supported', 'Calling is not available on this device.');
        return;
      }
      await Linking.openURL(phoneUrl);
    } catch (error) {
      showErrorAlert(error, 'Unable to open dialer right now.', 'Error');
    }
  };

  // Replaces the original Firestore onSnapshot live listeners with polling against the
  // customer-app's own "my orders" endpoint — already scoped to the logged-in account and
  // aggregated across every restaurant it's ordered from (see orderService.getMyOrders).
  // The original app's in-app "manager mode" (role === '2') is gone — the
  // restaurant-saas-platform's own staff web dashboard replaces it.
  const updateOrdersIfChanged = (nextOrders: any[]) => {
    const fingerprint = JSON.stringify(
      nextOrders.map((order: any) => ({
        id: String(order.id || ''),
        status: String(order.status || ''),
        total: Number(order.total || 0),
        createdAt: getCreatedTime(order.createdAt),
        reviewRating: Number(order?.review?.rating || 0),
        reviewCount: Number(order?.review?.reviewCount || 0),
        itemReviewKeys: Object.keys(order?.itemReviews || {}).sort().join('|'),
      }))
    );

    if (fingerprint !== lastOrdersFingerprintRef.current) {
      lastOrdersFingerprintRef.current = fingerprint;
      setOrders(nextOrders);
    }
  };

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    pagesLoadedRef.current = 1;
    ordersRef.current = [];
    setNextCursor(null);
    setLoadMoreFailed(false);
  }, [user?.uid, user?.role]);

  // Only while this tab is on screen and the app is in the foreground (see utils/polling.ts)
  // — a tab you've switched away from used to keep polling every 20s regardless.
  usePolling(
    async () => {
      try {
        const firstPage = await getMyOrdersPage();
        updateOrdersIfChanged(mergeFirstPage(firstPage.orders, ordersRef.current));
        if (pagesLoadedRef.current <= 1) setNextCursor(firstPage.nextCursor);
      } catch (error) {
        if (!isRateLimited(error)) console.error('Failed to load orders:', error);
      } finally {
        setLoading(false);
      }
    },
    ORDERS_POLL_MS,
    Boolean(user)
  );

  useEffect(() => {
    if (!user?.uid || orders.length === 0) {
      return;
    }

    const successfulOrders = orders.filter((order: any) => {
      if (!order?.id) return false;
      if (order.userId !== user.uid) return false;
      return isOrderDelivered(order.status);
    });

    if (successfulOrders.length === 0) {
      return;
    }

    const successfulOrderRunKey = successfulOrders
      .map((order: any) => String(order.id || ''))
      .sort()
      .join('|');

    if (!successfulOrderRunKey || successfulOrderRunKey === lastReferralRunKeyRef.current) {
      return;
    }

    lastReferralRunKeyRef.current = successfulOrderRunKey;

    userService.processPendingReferralRewardsForUser(user.uid).catch((error: unknown) => {
      console.log('Referral reward processing failed:', error);
    });
  }, [orders, user?.uid]);

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const billExpanded = expandedBills.has(String(item.id));
    const orderTotal = Number(item.total ?? 0);
    const amountDue = Number(item.amountDue ?? Math.max(0, Number(item.total || 0) - Number(item.amountPaid || 0)));
    const balanceLabel = Number(item.amountDue || 0) > 0
      ? (String(item.orderType) === OrderType.HOME_DELIVERY ? 'To pay on delivery' : 'Amount due')
      : item.paymentStatus === 'PAID' || orderTotal === 0 ? 'Fully paid' : 'Amount due';
    const isScheduledOrder = item?.isScheduledOrder === true || String(item?.orderSource || '').toLowerCase() === 'scheduled';
    // Only show for home delivery orders
    const showTrackOrder = !isScheduledOrder && String(item.orderType) === OrderType.HOME_DELIVERY;
    // Calculate distance using cafe and delivery location
    let distanceKm = 0;
    // Set your cafe's coordinates here
    const cafeLat = 25.4660647;
    const cafeLng = 81.8507718;
    if (item.deliveryLocation?.latitude && item.deliveryLocation?.longitude) {
      distanceKm = getDistanceInKm(
        cafeLat,
        cafeLng,
        item.deliveryLocation.latitude,
        item.deliveryLocation.longitude
      );
    }
    const isDelivered = isOrderDelivered(item.status);
    const isCancelled = isOrderCancelled(item.status);
    const reviewedItemCount = getReviewedItemCount(item);
    const totalReviewableItems = getReviewableOrderItems(item).length;
    const hasReview = reviewedItemCount > 0;
    const allItemsReviewed = totalReviewableItems > 0 && reviewedItemCount >= totalReviewableItems;
    const visibleOrderId = String(item.displayOrderId || `#${item.id}`);
    const restaurant = item.restaurant as OrderRestaurantSummary | null | undefined;
    const statusStyle = isScheduledOrder ? orderStatusColors('scheduled') : orderStatusColors(item.status);
    const orderTypeMeta = isScheduledOrder ? null : ORDER_TYPE_META[String(item.orderType)];
    const allItems: any[] = item.items || [];
    const visibleItems = allItems.slice(0, MAX_VISIBLE_ITEMS);
    const hiddenItemCount = Math.max(0, allItems.length - MAX_VISIBLE_ITEMS);

    return (
      <Animated.View entering={FadeInDown.delay(index * 60).springify().damping(18)}>
      <Card>
        <CardPressArea disabled onPress={() => router.push(`/order/${item.id}`)}>
          <RestaurantHeader
            disabled={!restaurant?.orgSlug}
            onPress={() => restaurant && router.push({ pathname: '/user/restaurant-details', params: { restaurant: JSON.stringify({ ...restaurant, image: restaurant.logoUrl, coverImage: restaurant.coverImageUrl, restaurantId: restaurant.id, cafeId: restaurant.id }), categoryId: '0' } })}
          >
            <RestaurantLogo>
              {restaurant?.logoUrl ? <AppImage uri={restaurant.logoUrl} style={{ width: '100%', height: '100%' }} /> : <Ionicons name="storefront-outline" size={22} color="#f68712" />}
            </RestaurantLogo>
            <RestaurantInfo>
              <RestaurantName numberOfLines={1}>{restaurant?.name || 'Restaurant'}</RestaurantName>
              {restaurant?.address ? <RestaurantAddress numberOfLines={1}>{restaurant.address}</RestaurantAddress> : null}
            </RestaurantInfo>
            <StatusPill style={{ backgroundColor: statusStyle.bg }}>
              <StatusPillText style={{ color: statusStyle.fg }}>{isScheduledOrder ? 'Scheduled' : orderStatusLabel(item.status, orderKind(item.orderType))}</StatusPillText>
            </StatusPill>
          </RestaurantHeader>

          <MetaRow>
            <MetaText>{visibleOrderId}</MetaText>
            <MetaDot />
            <MetaText>{formatOrderDate(item.createdAt)}</MetaText>
            {orderTypeMeta ? (
              <>
                <MetaDot />
                <Ionicons name={orderTypeMeta.icon as any} size={13} color="#8a8f98" />
                <MetaText style={{ marginLeft: 3 }}>{orderTypeMeta.label}</MetaText>
              </>
            ) : null}
          </MetaRow>
          {isScheduledOrder ? (
            <ScheduledText>
              Reserved for {formatScheduledDateKey(item.scheduledDate) || item.scheduledDate || '-'}
              {item.slotLabel ? ` · ${item.slotLabel}` : ''}
            </ScheduledText>
          ) : null}

          <ItemsContainer>
            {visibleItems.map((it: any, itemIndex: number) => (
              <ItemRow key={`${item.id}-${String(it.firebaseId || it.id || it.name || 'item')}-${itemIndex}`}>
                <ItemQty>{it.quantity}×</ItemQty>
                <ItemName numberOfLines={1}>{it.name}</ItemName>
                <ItemPrice>₹{(it.price * it.quantity).toFixed(0)}</ItemPrice>
              </ItemRow>
            ))}
            {hiddenItemCount > 0 ? <MoreItemsText>+{hiddenItemCount} more item{hiddenItemCount === 1 ? '' : 's'}</MoreItemsText> : null}
          </ItemsContainer>

          <PricingSection>
            <BillToggle
              accessibilityRole="button"
              accessibilityState={{ expanded: billExpanded }}
              accessibilityLabel={`Order total ₹${orderTotal.toFixed(2)}. ${billExpanded ? 'Hide' : 'Show'} price breakdown`}
              onPress={() => toggleBill(String(item.id))}
            >
              <BillToggleText>
                <TotalLabel>Order total</TotalLabel>
                <BillToggleHint>{billExpanded ? 'Hide price breakdown' : isCancelled ? 'View price breakdown' : `${balanceLabel}${amountDue > 0 ? ` · ₹${amountDue.toFixed(2)}` : ''} · View breakdown`}</BillToggleHint>
              </BillToggleText>
              <TotalAmount>₹{orderTotal.toFixed(2)}</TotalAmount>
              <Ionicons name={billExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#8a8f98" style={{ marginLeft: 6 }} />
            </BillToggle>
            {billExpanded && (
              <BillDetails>
            <BillRow><PricingText>Item subtotal</PricingText><BillValue>{item.pricing?.subtotal != null ? `₹${Number(item.pricing.subtotal).toFixed(2)}` : 'Unavailable'}</BillValue></BillRow>
            <BillRow><PricingText>Discount</PricingText><BillValue style={Number(item.pricing?.discount || 0) > 0 ? { color: '#25854c' } : undefined}>{Number(item.pricing?.discount || 0) > 0 ? '−' : ''}₹{Number(item.pricing?.discount || 0).toFixed(2)}</BillValue></BillRow>
            <BillRow><PricingText>Packaging charges</PricingText><BillValue>₹{Number(item.pricing?.packagingCharge || 0).toFixed(2)}</BillValue></BillRow>
            {Number(item.pricing?.tax || 0) > 0 && <BillRow><PricingText>Taxes</PricingText><BillValue>₹{Number(item.pricing.tax).toFixed(2)}</BillValue></BillRow>}
            {Number(item.pricing?.deliveryFee || 0) > 0 && <BillRow><PricingText>Delivery fee</PricingText><BillValue>₹{Number(item.pricing.deliveryFee).toFixed(2)}</BillValue></BillRow>}
            {Number(item.pricing?.serviceCharge || 0) > 0 && <BillRow><PricingText>Service charge</PricingText><BillValue>₹{Number(item.pricing.serviceCharge).toFixed(2)}</BillValue></BillRow>}
            {Number(item.pricing?.roundOff || 0) !== 0 && <BillRow><PricingText>Rounding adjustment</PricingText><BillValue>{Number(item.pricing.roundOff) < 0 ? '−' : '+'}₹{Math.abs(Number(item.pricing.roundOff)).toFixed(2)}</BillValue></BillRow>}
            <BillRow><PricingText>Paid from wallet</PricingText><BillValue style={Number(item.pricing?.walletUsed || 0) > 0 ? { color: '#25854c' } : undefined}>₹{Number(item.pricing?.walletUsed || 0).toFixed(2)}</BillValue></BillRow>
            {Math.max(0, Number(item.amountPaid || 0) - Number(item.pricing?.walletUsed || 0)) > 0 && <BillRow><PricingText>Other payments received</PricingText><BillValue>₹{Math.max(0, Number(item.amountPaid || 0) - Number(item.pricing?.walletUsed || 0)).toFixed(2)}</BillValue></BillRow>}
            {!isCancelled && <BalanceRow>
              <BalanceLabel>{balanceLabel}</BalanceLabel>
              <BalanceValue>₹{amountDue.toFixed(2)}</BalanceValue>
            </BalanceRow>}
              </BillDetails>
            )}
          </PricingSection>
        </CardPressArea>

        <ActionsRow>
          {!isDelivered && !isCancelled && (
            <CancelOrderButton
              orderId={String(item.id)}
              cancellableUntil={item.cancellableUntil}
              onCancelled={() => void refreshFirstPage()}
              fallback={showTrackOrder ? (
              <ReviewButton
                onPress={() => router.push({
                  pathname: '/user/track-order',
                  params: {
                    status: item.status,
                    orderId: String(item.id),
                    distance: distanceKm,
                    placedAt: getCreatedTime(item.createdAt),
                  },
                })}
              >
                <ReviewButtonText>Track Order</ReviewButtonText>
              </ReviewButton>
              ) : null}
            />
          )}
          {!isDelivered && !isCancelled && (
            <CallButton onPress={() => handleCallCafe(restaurant?.phone)}>
              <Ionicons name="call-outline" size={16} color="#fff" />
              <CallButtonText>Call Restaurant</CallButtonText>
            </CallButton>
          )}


          {isDelivered && !isScheduledOrder && (
            <>
              <InvoiceIconButton
                accessibilityRole="button"
                accessibilityLabel="Download invoice"
                onPress={() => handleDownloadInvoice(item)}
                disabled={downloadingInvoiceId === item.id}
              >
                {downloadingInvoiceId === item.id ? (
                  <ActivityIndicator size="small" color="#f68712" />
                ) : (
                  <Ionicons name="document-text-outline" size={20} color="#f68712" />
                )}
              </InvoiceIconButton>

              <ReviewButton
                disabled={allItemsReviewed}
                onPress={() => openReviewModal(item)}
                style={{ opacity: allItemsReviewed ? 0.6 : 1 }}
              >
                <Ionicons name={allItemsReviewed ? 'star' : 'star-outline'} size={15} color="#f68712" />
                <ReviewButtonText>
                  {allItemsReviewed
                    ? 'Already Rated'
                    : hasReview
                      ? `Rate Items ${reviewedItemCount}/${totalReviewableItems}`
                      : 'Rate Items'}
                </ReviewButtonText>
              </ReviewButton>

              <InvoiceButton onPress={() => handleReorder(item)}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <InvoiceButtonText>Reorder</InvoiceButtonText>
              </InvoiceButton>
            </>
          )}

          {!isScheduledOrder && isEditableAppOrder(item) && (
            <ReviewButton
              disabled={editingOrderId === item.id}
              onPress={() => handleEditOrder(item)}
            >
              <ReviewButtonText>{editingOrderId === item.id ? 'Loading...' : 'Edit Order'}</ReviewButtonText>
            </ReviewButton>
          )}
        </ActionsRow>
      </Card>
      </Animated.View>
    );
  };

  if (loading) {
    return (
      <Center>
        <ActivityIndicator size="large" color="#f68712" />
      </Center>
    );
  }

  const reviewableModalItems = reviewOrder ? getReviewableOrderItems(reviewOrder) : [];
  const ratedItemsCount = reviewableModalItems.filter((item) => Number(itemRatings[item.productId] || 0) > 0).length;
  const hasLowItemRating = reviewableModalItems.some((item) => {
    const rating = Number(itemRatings[item.productId] || 0);
    return rating > 0 && rating < 2;
  });

  return (
    <Container>
      <PageHeader title="Order History" showBack={false} />

      {orders.length === 0 ? (
        <EmptyText>No orders found.</EmptyText>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={o => o.id}
          renderItem={renderItem}
          extraData={expandedBills}
          contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          onEndReached={() => { if (!loadMoreFailed) void loadMoreOrders(); }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <ListFooter><ActivityIndicator color="#f68712" /></ListFooter>
            ) : loadMoreFailed ? (
              <ListFooter>
                <LoadMoreButton onPress={() => void loadMoreOrders()}><LoadMoreText>Couldn&apos;t load older orders. Tap to retry</LoadMoreText></LoadMoreButton>
              </ListFooter>
            ) : !nextCursor && orders.length > 0 ? (
              <ListFooter><EndOfListText>You&apos;ve reached the end of your order history</EndOfListText></ListFooter>
            ) : null
          }
        />
      )}

      <Modal
        visible={Boolean(reviewOrder)}
        animationType="slide"
        transparent
        onRequestClose={closeReviewModal}
      >
        <ReviewModalOverlay>
          <ReviewModalCard>
            <ReviewModalTitle>Rate Delivered Items</ReviewModalTitle>
            <ReviewModalSubtitle>Rate every item and add one order-level review.</ReviewModalSubtitle>
            <ReviewProgressText>Rated {ratedItemsCount}/{reviewableModalItems.length} items</ReviewProgressText>

            <ReviewItemsList showsVerticalScrollIndicator={false}>
              {reviewableModalItems.map((item) => {
                const rating = Number(itemRatings[item.productId] || 0);
                return (
                  <ReviewItemRow key={`${reviewOrder?.id || 'review'}-${item.productId}`}>
                    <ReviewItemRowTop>
                      <ReviewItemName numberOfLines={1}>{item.name}</ReviewItemName>
                      <ReviewItemRatingText>{rating > 0 ? `${rating}/5` : 'Not rated'}</ReviewItemRatingText>
                    </ReviewItemRowTop>
                    <ReviewItemStars>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <StarButton
                          key={`${item.productId}-${star}`}
                          onPress={() => {
                            setItemRatings((prev) => ({
                              ...prev,
                              [item.productId]: star,
                            }));
                          }}
                          disabled={submittingReview}
                        >
                          <Ionicons
                            name={rating >= star ? 'star' : 'star-outline'}
                            size={24}
                            color={rating >= star ? '#f68712' : '#cfcfcf'}
                          />
                        </StarButton>
                      ))}
                    </ReviewItemStars>
                  </ReviewItemRow>
                );
              })}
            </ReviewItemsList>

            <ReviewInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Write your review for this order"
              placeholderTextColor="#999"
              multiline
              textAlignVertical="top"
              editable={!submittingReview}
            />

            <AttachImageButton onPress={pickReviewImage} disabled={submittingReview}>
              <AttachImageButtonText>
                {reviewImageUri ? 'Change Attached Image' : 'Attach Image'}
              </AttachImageButtonText>
            </AttachImageButton>

            {reviewImageUri ? (
              <ReviewImagePreview source={{ uri: reviewImageUri }} resizeMode="cover" />
            ) : null}

            {hasLowItemRating && (
              <LowRatingInfoText>Image is required for ratings below 2 stars.</LowRatingInfoText>
            )}

            <ReviewModalActions>
              <CancelButton onPress={closeReviewModal} disabled={submittingReview}>
                <CancelButtonText>Cancel</CancelButtonText>
              </CancelButton>
              <SubmitButton onPress={submitOrderReview} disabled={submittingReview}>
                {submittingReview ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <SubmitButtonText>Submit</SubmitButtonText>
                )}
              </SubmitButton>
            </ReviewModalActions>
          </ReviewModalCard>
        </ReviewModalOverlay>
      </Modal>
    </Container>
  );
};

export default OrderHistoryScreen;

function getCreatedTime(createdAt: any) {
  if (!createdAt) return 0;
  // Firestore Timestamp (kept for any leftover un-migrated data shapes)
  if (createdAt.toDate && typeof createdAt.toDate === 'function') {
    return createdAt.toDate().getTime();
  }
  // JS Date
  if (createdAt instanceof Date) return createdAt.getTime();
  // number (ms)
  if (typeof createdAt === 'number') return createdAt;
  // ISO string — what the backend actually sends now
  if (typeof createdAt === 'string') {
    const parsed = new Date(createdAt).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}


const Container = styled(PageScreen)`
  flex: 1;
  background-color: #faf7f4;
`;

const Center = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const EmptyText = styled.Text`
  text-align: center;
  margin-top: 40px;
  color: #666;
`;

const Card = styled.View.attrs({
  style: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
})`
  background: #fff;
  border-radius: 16px;
  padding: 14px;
  margin-bottom: 14px;
  border: 1px solid #f1ebe5;
`;

const CardPressArea = styled.TouchableOpacity``;

const RestaurantHeader = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
  padding-bottom: 12px;
  border-bottom-width: 1px;
  border-bottom-color: #f3eee9;
`;

const RestaurantLogo = styled.View`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  overflow: hidden;
  background-color: #fff4e6;
  align-items: center;
  justify-content: center;
`;

const RestaurantInfo = styled.View`
  flex: 1;
  margin: 0 10px;
`;

const RestaurantName = styled.Text`
  font-size: 15px;
  font-weight: 800;
  color: #1a1f2b;
`;

const RestaurantAddress = styled.Text`
  font-size: 12px;
  color: #8a8f98;
  margin-top: 2px;
`;

const StatusPill = styled.View`
  padding: 5px 10px;
  border-radius: 14px;
`;

const StatusPillText = styled.Text`
  font-size: 12px;
  font-weight: 800;
`;

const MetaRow = styled.View`
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 10px;
`;

const MetaText = styled.Text`
  font-size: 12px;
  color: #8a8f98;
`;

const MetaDot = styled.View`
  width: 3px;
  height: 3px;
  border-radius: 2px;
  background-color: #c4c7cc;
  margin: 0 7px;
`;

const ScheduledText = styled.Text`
  color: #4f46e5;
  font-size: 12px;
  font-weight: 600;
  margin-top: 6px;
`;

const ItemsContainer = styled.View`
  margin-top: 10px;
`;

const ItemRow = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 4px 0;
`;

const ItemQty = styled.Text`
  width: 28px;
  color: #f68712;
  font-weight: 800;
  font-size: 13px;
`;

const ItemName = styled.Text`
  flex: 1;
  color: #333;
  font-size: 14px;
  margin-right: 8px;
`;

const ItemPrice = styled.Text`
  color: #555;
  font-size: 13px;
`;

const MoreItemsText = styled.Text`
  color: #8a8f98;
  font-size: 12px;
  margin-top: 2px;
  margin-left: 28px;
`;

const PricingSection = styled.View`
  margin-top: 14px;
  padding: 14px;
  border-radius: 14px;
  background-color: #fffbf7;
  border: 1px solid #eee6df;
  gap: 8px;
`;
const BillToggle = styled.TouchableOpacity`
  flex-direction: row;
  align-items: center;
`;
const BillToggleText = styled.View`
  flex: 1;
  gap: 2px;
`;
const BillToggleHint = styled.Text`
  font-size: 12px;
  color: #8a8f98;
`;
const BillDetails = styled.View`
  gap: 8px;
  border-top-width: 1px;
  border-top-color: #e9e1d9;
  padding-top: 10px;
`;
const BillHeading = styled.Text`
  font-size: 13px;
  font-weight: 700;
  color: #303540;
  margin-bottom: 3px;
`;
const BillRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;
const PricingText = styled.Text`
  flex: 1;
  font-size: 12px;
  color: #837b78;
`;
const BillValue = styled.Text`
  font-size: 12px;
  color: #343945;
  font-weight: 600;
`;
const BillTotalRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top-width: 1px;
  border-top-color: #e9e1d9;
  padding-top: 10px;
  margin-top: 2px;
  margin-bottom: 4px;
`;
const TotalLabel = styled.Text`
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: #303540;
`;
const TotalAmount = styled.Text`
  font-size: 18px;
  font-weight: 800;
  color: #1a1f2b;
`;
const BalanceRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background-color: #fff0df;
  padding: 10px;
  border-radius: 8px;
  margin-top: 3px;
`;
const BalanceLabel = styled.Text`
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: #9b591d;
`;
const BalanceValue = styled.Text`
  font-size: 14px;
  font-weight: 700;
  color: #9b591d;
`;

const ActionsRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-top: 12px;
  gap: 8px;
`;

const CallButton = styled.TouchableOpacity`
  flex: 1;
  background-color: #2e7d32;
  border-radius: 10px;
  min-height: 42px;
  padding: 0 12px;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  justify-content: center;
`;

const CallButtonText = styled.Text`
  color: #fff;
  font-weight: 700;
  font-size: 13px;
`;

const ListFooter = styled.View`
  padding: 16px 0 8px;
  align-items: center;
`;

const LoadMoreButton = styled.TouchableOpacity`
  padding: 10px 16px;
  border-radius: 20px;
  border-width: 1px;
  border-color: #f68712;
`;

const LoadMoreText = styled.Text`
  color: #f68712;
  font-size: 13px;
  font-weight: 600;
`;

const EndOfListText = styled.Text`
  color: #9ca3af;
  font-size: 12px;
`;

const InvoiceIconButton = styled.TouchableOpacity`
  width: 42px;
  height: 42px;
  border-radius: 10px;
  border-width: 1px;
  border-color: #f3d3b0;
  background-color: #fff8f0;
  align-items: center;
  justify-content: center;
`;

const InvoiceButton = styled.TouchableOpacity`
  flex: 1;
  background-color: #f68712;
  border-radius: 10px;
  min-height: 42px;
  flex-direction: row;
  gap: 6px;
  justify-content: center;
  align-items: center;
`;

const InvoiceButtonText = styled.Text`
  color: #fff;
  font-weight: 700;
  font-size: 14px;
`;

const ReviewButton = styled.TouchableOpacity`
  flex: 1;
  background-color: #ffffff;
  border-width: 1px;
  border-color: #f68712;
  border-radius: 10px;
  min-height: 42px;
  padding: 0 12px;
  flex-direction: row;
  gap: 5px;
  justify-content: center;
  align-items: center;
`;

const ReviewButtonText = styled.Text`
  color: #f68712;
  font-weight: 700;
  font-size: 13px;
`;

const ReviewModalOverlay = styled.View`
  flex: 1;
  background-color: rgba(0, 0, 0, 0.45);
  justify-content: flex-end;
`;

const ReviewModalCard = styled.View`
  background-color: #fff;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  padding: 18px;
  padding-bottom: 22px;
`;

const ReviewModalTitle = styled.Text`
  font-size: 18px;
  font-weight: 700;
  color: #222;
`;

const ReviewModalSubtitle = styled.Text`
  margin-top: 4px;
  color: #666;
  font-size: 13px;
`;

const ReviewProgressText = styled.Text`
  margin-top: 6px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
`;

const ReviewItemsList = styled.ScrollView`
  margin-top: 12px;
  max-height: 240px;
`;

const ReviewItemRow = styled.View`
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 12px;
  border-width: 1px;
  border-color: #ececec;
  background-color: #fff;
`;

const ReviewItemRowTop = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const ReviewItemName = styled.Text`
  flex: 1;
  margin-right: 8px;
  color: #333;
  font-size: 13px;
  font-weight: 700;
`;

const ReviewItemRatingText = styled.Text`
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
`;

const ReviewItemStars = styled.View`
  margin-top: 8px;
  flex-direction: row;
`;

const StarButton = styled.TouchableOpacity`
  padding: 4px;
`;

const ReviewInput = styled.TextInput`
  margin-top: 12px;
  min-height: 100px;
  border-width: 1px;
  border-color: #e2e2e2;
  border-radius: 10px;
  padding: 10px;
  color: #222;
`;

const AttachImageButton = styled.TouchableOpacity`
  margin-top: 12px;
  border-width: 1px;
  border-color: #f68712;
  border-radius: 10px;
  min-height: 44px;
  justify-content: center;
  align-items: center;
`;

const AttachImageButtonText = styled.Text`
  color: #f68712;
  font-weight: 700;
`;

const ReviewImagePreview = styled.Image`
  margin-top: 10px;
  width: 100%;
  height: 160px;
  border-radius: 10px;
  background-color: #f2f2f2;
`;

const LowRatingInfoText = styled.Text`
  margin-top: 8px;
  color: #c0392b;
  font-size: 12px;
  font-weight: 600;
`;

const ReviewModalActions = styled.View`
  flex-direction: row;
  margin-top: 16px;
  gap: 10px;
`;

const CancelButton = styled.TouchableOpacity`
  flex: 1;
  min-height: 44px;
  border-radius: 10px;
  border-width: 1px;
  border-color: #ddd;
  justify-content: center;
  align-items: center;
`;

const CancelButtonText = styled.Text`
  color: #555;
  font-weight: 600;
`;

const SubmitButton = styled.TouchableOpacity`
  flex: 1;
  min-height: 44px;
  border-radius: 10px;
  background-color: #f68712;
  justify-content: center;
  align-items: center;
`;

const SubmitButtonText = styled.Text`
  color: #fff;
  font-weight: 700;
`;

