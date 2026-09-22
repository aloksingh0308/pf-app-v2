import { getMenuItems } from '@/services/menuService';
import { findRestaurantByAnyId } from '@/services/restaurantService';
import { userService } from '@/services/userService';
import { getMyOrders, submitOrderReview as submitOrderReviewApi, uploadReviewImage } from '@/services/orderService';
import { setCartItems, setEditingOrderMeta } from '@/store/slices/cartSlice';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import { router, useNavigation } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components/native';
import { showAlert, showErrorAlert } from '../../services/alertService';
import { RootState } from '../../store';
import { OrderType } from '../../types/enums';
import { buildCartItemFromProduct, getSelectedProductVariant } from '@/utils/productVariants';

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
  const insets = useSafeAreaInsets();
  const user = useSelector((state: RootState) => state.auth.user);
  const dispatch = useDispatch();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
  const [reviewOrder, setReviewOrder] = useState<any | null>(null);
  const [itemRatings, setItemRatings] = useState<Record<string, number>>({});
  const [reviewComment, setReviewComment] = useState('');
  const [reviewImageUri, setReviewImageUri] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const navigation = useNavigation();
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
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
    const status = String(order?.status || '').toLowerCase();
    const source = String(order?.source || '').toLowerCase();
    const orderType = String(order?.orderType || '').toLowerCase();
    // Disallow editing for Home delivery orders
    if (orderType === "3" || orderType === 'delivery') {
      return false;
    }
    return source === 'app'
      && !status.includes('deliver')
      && !status.includes('complete')
      && !status.includes('cancel')
      && !status.includes('reject');
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

      const refreshedOrders = await getMyOrders();
      setOrders(refreshedOrders);

      closeReviewModal();
      showAlert('Thank You', 'Your review has been submitted successfully.');
    } catch (error) {
      showErrorAlert(error, 'Unable to submit review right now. Please try again.', 'Error');
      setSubmittingReview(false);
    }
  };

  const handleDownloadInvoice = async (order: any) => {
    try {
      if (formatStatus(order?.status || '') !== 'Delivered') {
        showAlert('Invoice Not Available', 'Invoice can be downloaded only for delivered orders.');
        return;
      }

      const visibleOrderId = String(order.displayOrderId || `#${order.id || 'N/A'}`);

      setDownloadingInvoiceId(order.id);

      const orderDate = new Date(order.createdAt?.toDate?.() || order.createdAt);
      const orderItems = Array.isArray(order.items) ? order.items : [];
      const subtotal = orderItems.reduce((sum: number, item: any) => {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);
        return sum + (quantity * price);
      }, 0);

      const discount = Number(order?.pricing?.discount || 0);
      const packagingCharge = Number(order?.pricing?.packagingCharge || 0);
      const deliveryFee = Number(order?.pricing?.deliveryFee || 0);
      const walletUsed = Number(order?.pricing?.walletUsed || 0);
      const total = Number(order?.total || Math.max(0, subtotal - discount + packagingCharge + deliveryFee - walletUsed));

      const itemsRows = orderItems.map((item: any) => {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);
        const lineTotal = quantity * price;
        return `
                  <tr>
                    <td>${escapeHtml(String(item.name || 'Item'))}</td>
                    <td style="text-align:center;">${quantity}</td>
                    <td style="text-align:right;">₹${price.toFixed(2)}</td>
                    <td style="text-align:right;">₹${lineTotal.toFixed(2)}</td>
                  </tr>
                `;
      }).join('');

      const invoiceHtml = `
              <html>
                <head>
                  <meta charset="utf-8" />
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 24px; color: #222; }
                    h1 { margin: 0 0 8px 0; font-size: 24px; }
                    .muted { color: #666; font-size: 12px; }
                    .section { margin-top: 16px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th, td { border: 1px solid #e5e5e5; padding: 10px; font-size: 13px; }
                    th { background: #f7f7f7; text-align: left; }
                    .totals { margin-top: 16px; width: 280px; margin-left: auto; }
                    .totals div { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
                    .total { font-weight: 700; font-size: 16px; }
                    .footer { margin-top: 28px; font-size: 11px; color: #666; }
                  </style>
                </head>
                <body>
                  <h1>Invoice</h1>
                  <div class="muted">Hungry's Bucket Cafe</div>
                  <div class="section">
                    <div><strong>Invoice No:</strong> ${escapeHtml(visibleOrderId)}</div>
                    <div><strong>Order Date:</strong> ${escapeHtml(orderDate.toLocaleString())}</div>
                    <div><strong>Status:</strong> ${escapeHtml(formatStatus(order.status || 'Pending'))}</div>
                    <div><strong>Customer:</strong> ${escapeHtml(user?.name || 'Customer')}</div>
                    <div><strong>Email:</strong> ${escapeHtml(user?.email || order.email || '-')}</div>
                    <div><strong>Phone:</strong> ${escapeHtml(user?.phoneNumber || order.mobileNumber || '-')}</div>
                  </div>

                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th style="text-align:center;">Qty</th>
                        <th style="text-align:right;">Price</th>
                        <th style="text-align:right;">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsRows || '<tr><td colspan="4">No items</td></tr>'}
                    </tbody>
                  </table>

                  <div class="totals">
                    <div><span>Subtotal</span><span>₹${subtotal.toFixed(2)}</span></div>
                    <div><span>Discount</span><span>-₹${discount.toFixed(2)}</span></div>
                    <div><span>Packaging & Other Charges</span><span>₹${packagingCharge.toFixed(2)}</span></div>
                    <div><span>Delivery Fee</span><span>₹${deliveryFee.toFixed(2)}</span></div>
                    ${walletUsed > 0 ? `<div><span>Wallet Used</span><span>-₹${walletUsed.toFixed(2)}</span></div>` : ''}
                    <div class="total"><span>Total</span><span>₹${total.toFixed(2)}</span></div>
                  </div>

                  <div class="footer">
                    Generated by Hungry's Bucket Cafe app. For help, contact support.
                  </div>
                </body>
              </html>
            `;

      const { uri } = await Print.printToFileAsync({ html: invoiceHtml });
      const canShare = await Sharing.isAvailableAsync();

      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Invoice_${visibleOrderId.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        showAlert('Invoice Ready', `Invoice has been created at:\n${uri}`);
      }
    } catch (error) {
      console.error('Failed to generate invoice:', error);
      showErrorAlert(error, 'Unable to generate invoice. Please try again.', 'Error');
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const handleCallCafe = async () => {
    const phoneUrl = `tel:${CAFE_PHONE_NUMBER}`;
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

  useEffect(() => {
    // Replaces the original Firestore onSnapshot live listeners with polling against the
    // customer-app's own "my orders" endpoint — already scoped to the logged-in account and
    // aggregated across every restaurant it's ordered from (see orderService.getMyOrders).
    // The original app's in-app "manager mode" (role === '2') is gone — the
    // restaurant-saas-platform's own staff web dashboard replaces it.
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

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

    const fetchOrders = async () => {
      try {
        const nextOrders = await getMyOrders();
        if (cancelled) return;
        updateOrdersIfChanged(nextOrders);
      } catch (error) {
        console.error('Failed to load orders:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    fetchOrders();
    const interval = setInterval(fetchOrders, 20000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.uid, user?.role]);

  useEffect(() => {
    if (!user?.uid || orders.length === 0) {
      return;
    }

    const successfulOrders = orders.filter((order: any) => {
      if (!order?.id) return false;
      if (order.userId !== user.uid) return false;
      const status = String(order.status || '').toLowerCase();
      return status.includes('deliver') || status.includes('completed') || status.includes('ready');
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
    const status = (item.status || '').toLowerCase();
    const isDelivered = formatStatus(item.status) === 'Delivered';
    const isCancelled = formatStatus(item.status) === 'Cancelled';
    const reviewedItemCount = getReviewedItemCount(item);
    const totalReviewableItems = getReviewableOrderItems(item).length;
    const hasReview = reviewedItemCount > 0;
    const allItemsReviewed = totalReviewableItems > 0 && reviewedItemCount >= totalReviewableItems;
    const visibleOrderId = String(item.displayOrderId || `#${item.id}`);

    return (
      <Animated.View entering={FadeInDown.delay(index * 60).springify().damping(18)}>
      <Card>
        <CardPressArea disabled onPress={() => router.push(`/order/${item.id}`)}>
          <Row>
            <OrderId>Order {visibleOrderId}</OrderId>
            <StatusBadge status={status}>{formatStatus(item.status)}</StatusBadge>
          </Row>
          <DateTimeText>{new Date(item.createdAt?.toDate?.() || item.createdAt).toLocaleString()}</DateTimeText>
          {isScheduledOrder ? (
            <DateTimeText>
              Reserved: {formatScheduledDateKey(item.scheduledDate) || item.scheduledDate || '-'}
              {item.slotLabel ? ` · ${item.slotLabel}` : ''}
            </DateTimeText>
          ) : null}

          <ItemsContainer>
            {item.items && item.items.map((it: any, index: number) => (
              <ItemRow key={`${item.id}-${String(it.firebaseId || it.id || it.name || 'item')}-${index}`}>
                <ItemName>{it.name} x {it.quantity}</ItemName>
                <ItemPrice>₹{(it.price * it.quantity).toFixed(2)}</ItemPrice>
              </ItemRow>
            ))}
          </ItemsContainer>

          <PricingSection>
            <TotalAmount>₹{(item.total || 0).toFixed(2)}</TotalAmount>
            {item.pricing && (
              <PricingDetails>
                {item.pricing.discount > 0 && <PricingText>Discount: -₹{item.pricing.discount.toFixed(2)}</PricingText>}
                {(item.pricing.packagingCharge || 0) > 0 && <PricingText>Packaging & Other Charges: ₹{item.pricing.packagingCharge.toFixed(2)}</PricingText>}
                {(item.pricing.deliveryFee || 0) > 0 && <PricingText>Delivery Fee: ₹{item.pricing.deliveryFee.toFixed(2)}</PricingText>}
                {(item.pricing.walletUsed || 0) > 0 && <PricingText>Wallet Used: -₹{item.pricing.walletUsed.toFixed(2)}</PricingText>}
              </PricingDetails>
            )}
          </PricingSection>
        </CardPressArea>

        <ActionsRow>
          {!isDelivered && !isCancelled && showTrackOrder && (
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
          )}
          {!isDelivered && !isCancelled && (
            <CallButton onPress={handleCallCafe}>
              <Ionicons name="call-outline" size={16} color="#fff" />
              <CallButtonText>Call Cafe</CallButtonText>
            </CallButton>
          )}


          {isDelivered && !isScheduledOrder && (
            <>
              <InvoiceButton
                onPress={() => handleDownloadInvoice(item)}
                disabled={downloadingInvoiceId === item.id}
              >
                {downloadingInvoiceId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <InvoiceButtonRow>
                    <InvoiceButtonText>Invoice</InvoiceButtonText>
                    <Ionicons name="download-outline" size={18} color="#fff" style={{ marginLeft: 6 }} />
                  </InvoiceButtonRow>
                )}
              </InvoiceButton>

              <ReviewButton
                onPress={() => handleReorder(item)}
              >
                <ReviewButtonText>Reorder</ReviewButtonText>
              </ReviewButton>

              <ReviewButton
                disabled={allItemsReviewed}
                onPress={() => openReviewModal(item)}
              >
                <ReviewButtonText>
                  {allItemsReviewed
                    ? 'Already Rated'
                    : hasReview
                      ? `Rate Items ${reviewedItemCount}/${totalReviewableItems}`
                      : 'Rate Items'}
                </ReviewButtonText>
              </ReviewButton>
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
      <Animated.View entering={FadeInDown.springify().damping(18)}>
      <HeaderContainer>
        <BackButton onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={32} color="#282939" />
        </BackButton>
        <Title>Order History</Title>
      </HeaderContainer>
      </Animated.View>

      {orders.length === 0 ? (
        <EmptyText>No orders found.</EmptyText>
      ) : (
        <FlatList data={orders} keyExtractor={o => o.id} renderItem={renderItem} contentContainerStyle={{ padding: 16 }} />
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

function formatStatus(s: string) {
  if (!s) return 'Pending';
  const lower = s.toLowerCase();
  if (lower.includes('scheduled')) return 'Scheduled';
  if (lower.includes('processing')) return 'Processing';
  if (lower.includes('cancel')) return 'Cancelled';
  if (lower.includes('confirm')) return 'Confirmed';
  if (lower.includes('prepar')) return 'Preparing';
  if (lower.includes('dispatch')) return 'Dispatched';
  if (lower.includes('ready')) return 'Ready for Pickup';
  if (lower.includes('deliver') || lower.includes('completed')) return 'Delivered';
  return s;
}

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: #fff;
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

const Card = styled.View`
  background: #fff;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid #f0f0f0;
`;

const CardPressArea = styled.TouchableOpacity``;

const Row = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const SmallRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 6px;
`;

const OrderId = styled.Text`
  font-weight: 700;
  color: #333;
`;

const StatusBadge = styled.Text<{ status: string }>`
  padding: 6px 10px;
  border-radius: 16px;
  color: #fff;
  background-color: ${(props) => {
    const s = props.status || '';
    if (s.includes('scheduled')) return '#6366f1';
    if (s.includes('processing')) return '#f39c12';
    if (s.includes('cancel')) return '#e74c3c';
    if (s.includes('confirm')) return '#2ecc71';
    if (s.includes('prepar')) return '#f39c12';
    if (s.includes('dispatch')) return '#3498db';
    if (s.includes('ready')) return '#f39c12';
    if (s.includes('deliver') || s.includes('completed')) return '#27ae60';
    return '#95a5a6';
  }};
`;


const DateTimeText = styled.Text`
  color: #666;
  font-size: 12px;
  margin-top: 6px;
  margin-bottom: 10px;
`;

const ItemsContainer = styled.View`
  margin-top: 10px;
`;

const ItemRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom-width: 1px;
  border-bottom-color: #f5f5f5;
`;

const ItemName = styled.Text`
  color: #333;
`;

const ItemPrice = styled.Text`
  color: #333;
`;

const PricingSection = styled.View`
  margin-top: 12px;
  padding-top: 12px;
  border-top-width: 1px;
  border-top-color: #f0f0f0;
`;

const TotalAmount = styled.Text`
  font-size: 18px;
  font-weight: 700;
  color: #f68712;
  margin-bottom: 6px;
`;

const PricingDetails = styled.View`
  flex-direction: column;
  gap: 4px;
`;

const PricingText = styled.Text`
  font-size: 12px;
  color: #666;
  font-weight: 500;
`;

const ActionsRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  gap: 10px;
`;

const CallButton = styled.TouchableOpacity`
  background-color: #2e7d32;
  border-radius: 8px;
  min-height: 40px;
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

const InvoiceButton = styled.TouchableOpacity`
  background-color: #f68712;
  border-radius: 8px;
  min-height: 40px;
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const InvoiceButtonText = styled.Text`
  color: #fff;
  font-weight: 700;
  font-size: 14px;
`;

const ReviewButton = styled.TouchableOpacity`
  background-color: #ffffff;
  border-width: 1px;
  border-color: #f68712;
  border-radius: 8px;
  min-height: 40px;
  padding: 0 12px;
  justify-content: center;
  align-items: center;
`;

const ReviewButtonText = styled.Text`
  color: #f68712;
  font-weight: 700;
  font-size: 13px;
`;

const HeaderContainer = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 10px;
  padding-top: 30px;
`;

const BackButton = styled.TouchableOpacity`
  width: 40px;
  height: 40px;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: bold;
  padding: 0 20px;
  width: 70%;
  text-align: center;
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
// Fix: Define InvoiceButtonRow before usage
const InvoiceButtonRow = styled.View`
  flex-direction: row;
  align-items: center;
`;

