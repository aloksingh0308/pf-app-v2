import { resolveImageUrl } from "../utils/resolveImageUrl";
import { OrderType } from "../types/enums";
import { apiClient } from "../utils/apiClient";
import { getActiveOrgSlug, getActiveBranchCode } from "./restaurantContext";
import type { CheckoutPayment } from './paymentService';

// Placeholder for the original Firestore `Timestamp` type these fields were typed with.
// The backend sends plain ISO date strings instead; every call site already falls back to
// `new Date(value)` when `.seconds`/`.toDate`/`.toMillis` aren't present (see
// track-order.tsx's timeInfo and home.tsx's getOrderCreatedAtMs), so a raw ISO string works
// unmodified — this type only needs to keep those optional-chained accesses type-checking.
export type Timestamp = string | { seconds?: number; toDate?: () => Date; toMillis?: () => number };

export interface OrderItem {
    id: string;
    name: string;
    price: number;
    quantity: number;
    firebaseId: string;
    selectedVariantId?: string | null;
    selectedVariantName?: string | null;
    selectedVariantDescription?: string | null;
    selectedModifiers?: { modifierId: string; optionNames: string[] }[];
    selectedAddonIds?: string[];
    isDeal?: boolean;
    dealId?: string | null;
    dealName?: string | null;
    dealPrice?: number | null;
    originalDealPrice?: number | null;
}

export interface OrderPricing {
    subtotal: number;
    discount: number;
    packagingCharge: number;
    deliveryFee: number;
    walletUsed?: number;
    /** Whole coins redeemed (not a ₹ value) — the backend converts via its own
     *  COIN_TO_INR_RATE and re-validates the live balance server-side; this is intent only. */
    coinsRedeemed?: number;
    totalBeforeWallet?: number;
    tax?: number;
    serviceCharge?: number;
    roundOff?: number;
    couponCode?: string | null;
    couponType?: string | null;
    couponValue?: number | null;
    couponTitle?: string | null;
    couponDescription?: string | null;
    freeItemName?: string | null;
    /** Set only for influencer next-coupon-unlock coupons — the coupon doc id (not just
     *  its code) plus who used it and at which cycle, so the used-by/verification flow in
     *  POS can look the assignment up directly. Absent/null for normal coupons. */
    couponId?: string | null;
    influencerUid?: string | null;
    influencerCycle?: number | null;
}

export interface Order {
    items: OrderItem[];
    total: number;
    orderType: string;
    cafeId?: string | null;
    restaurantId?: string | null;
    restaurantID?: string | null;
    restaurant?: string | null;
    cafeName?: string | null;
    restaurantName?: string | null;
    tableNumber?: string;
    deliveryAddress?: string;
    deliveryAddressId?: string | null;
    deliveryLocation?: {
        latitude: number;
        longitude: number;
    } | null;
    status: string;
    source?: string;
    createdAt: Timestamp;
    /** When the customer's own "Cancel order" option ends (ISO) — null once it can't be
     *  cancelled from the app (server-decided: 2 min after placing, before the food is ready). */
    cancellableUntil?: string | null;
    customerName: string;
    mobileNumber: string;
    email?: string | null;
    couponCode?: string | null;
    couponType?: string | null;
    couponValue?: number | null;
    couponTitle?: string | null;
    couponDescription?: string | null;
    freeItemName?: string | null;
    couponId?: string | null;
    influencerUid?: string | null;
    influencerCycle?: number | null;
    pricing?: OrderPricing;
    /** COD = pay on delivery/pickup; ONLINE = paid through the app (Razorpay) before placing. */
    paymentMode?: 'COD' | 'ONLINE';
    userId?: string | null;
    displayOrderId?: string;
    reward?: {
        generated: boolean;
        scratched: boolean;
        rewardType?: 'FREE_ITEM' | 'FLAT_DISCOUNT' | 'PERCENTAGE_DISCOUNT' | 'COINS';
        couponId: string;
        coinsEarned?: number;
        dealId: string;
        generatedAt: Timestamp;
    };
    orderRevision?: number;
    posSeenRevision?: number;
    lastEditedBy?: string;
    lastEditedAt?: Timestamp;
    review?: OrderReviewSummary | null;
    itemReviews?: Record<string, OrderItemReview>;
    /** Who delivered it (delivered Home Delivery orders only) — can be rated with the review. */
    deliveryRider?: { name: string } | null;
    /** The customer's rating of that rider, once given. */
    riderReview?: RiderReview | null;
    isScheduledOrder?: boolean;
    scheduledDate?: string;
    slotLabel?: string;
    slotStart?: string;
    slotEnd?: string;
}

/** Quick tags for a rider rating — must match the backend's RIDER_RATING_TAGS
 *  (models/OrderReview.ts). Praise is offered for 4–5 stars, complaints for 1–3. */
export const RIDER_PRAISE_TAGS = ['On time', 'Polite', 'Handled food with care', 'Followed instructions'] as const;
export const RIDER_COMPLAINT_TAGS = ['Late delivery', 'Rude behaviour', 'Food spilled or damaged', "Didn't follow instructions", 'Asked for extra money'] as const;
export type RiderRatingTag = (typeof RIDER_PRAISE_TAGS)[number] | (typeof RIDER_COMPLAINT_TAGS)[number];

export interface RiderReview {
    riderName: string;
    rating: number;
    tags: RiderRatingTag[];
}

export interface OrderReviewSummary {
    rating: number;
    comment: string;
    imageUrl: string;
    submittedAt: Timestamp;
    userId: string;
    userName: string;
    userEmail: string;
    reviewCount: number;
}

export interface OrderItemReview {
    reviewId: string;
    productId: string;
    productName: string;
    rating: number;
    comment: string;
    imageUrl: string;
    submittedAt: Timestamp;
    userId: string;
    userName: string;
    userEmail: string;
}

type BranchTable = { name: string; qrToken: string; occupied: boolean };

async function fetchBranchTables(): Promise<BranchTable[]> {
    return apiClient.get<BranchTable[]>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/tables`);
}

/** Numeric-aware compare so "Table 2" sorts before "Table 10" — falls back to a plain
 *  string compare for branches that name tables non-numerically (e.g. "VIP-1"). */
function compareTableNames(a: string, b: string): number {
    const numA = Number(a);
    const numB = Number(b);
    if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
    return a.localeCompare(b);
}

/** The floor plan's real table list for the currently active branch (see
 *  services/restaurantContext.ts) — replaces any fixed/guessed table count with whatever
 *  the branch has actually configured, so a branch with 4 tables shows 4 and one with 20
 *  shows 20, occupied ones flagged from live order state. */
export async function getBranchTableList(): Promise<{ name: string; occupied: boolean }[]> {
    try {
        const tables = await fetchBranchTables();
        return tables
            .map((table) => ({ name: table.name, occupied: table.occupied }))
            .sort((a, b) => compareTableNames(a.name, b.name));
    } catch (error) {
        console.error("Error loading branch tables:", error);
        return [];
    }
}

/** Replaces the app's own Firestore occupancy query with the backend's table list for the
 *  currently active restaurant (see services/restaurantContext.ts) — `restaurantId` is
 *  accepted for interface-compatibility with existing call sites but ignored, since the
 *  active restaurant is already resolved via context, not passed explicitly here. */
export async function getOccupiedDineInTables(restaurantId?: string | null): Promise<string[]> {
    void restaurantId;
    try {
        const tables = await fetchBranchTables();
        return tables
            .filter((table) => table.occupied)
            .map((table) => table.name)
            .sort(compareTableNames);
    } catch (error) {
        console.error("Error loading occupied dine-in tables:", error);
        return [];
    }
}

const MONGO_ID_PATTERN = /^[0-9a-f]{24}$/i;

export type PosOrderItemPayload = {
    menuItemId: string;
    quantity: number;
    variantId?: string;
    variantName?: string;
    modifierSelections?: { modifierId: string; optionNames: string[] }[];
    addonIds?: string[];
    /** Set on a combo's dishes — the server then charges the combo's price for them. */
    comboId?: string;
};

export function toPosOrderItems(items: OrderItem[]): PosOrderItemPayload[] {
    return items.map((item) => {
        const payload: PosOrderItemPayload = { menuItemId: item.firebaseId || item.id, quantity: Number(item.quantity || 0) };
        // Only a REAL backend variant id (a Mongo ObjectId) is ever sent — an item with no
        // real variants configured still gets a synthetic 'variant-1'/'variant-2' id
        // client-side (see utils/productVariants.ts's getProductVariants fallback) purely
        // so the cart-key logic can tell lines apart; that placeholder is never a variant
        // the backend knows about, so sending it would just fail item lookup.
        // The name goes only with a real variant too — the synthetic "Regular" of a dish with
        // no sizes would otherwise be looked up as a size the dish doesn't have.
        if (item.selectedVariantId && MONGO_ID_PATTERN.test(item.selectedVariantId)) {
            payload.variantId = item.selectedVariantId;
            if (item.selectedVariantName) {
                payload.variantName = item.selectedVariantName;
            }
        }
        if (item.selectedModifiers && item.selectedModifiers.length > 0) {
            payload.modifierSelections = item.selectedModifiers;
        }
        if (item.selectedAddonIds && item.selectedAddonIds.length > 0) {
            payload.addonIds = item.selectedAddonIds;
        }
        // A combo's dishes go with the combo's id, or the server would bill them at full price.
        if (item.isDeal && item.dealId && MONGO_ID_PATTERN.test(item.dealId)) {
            payload.comboId = item.dealId;
        }
        return payload;
    });
}

/**
 * Places an order against the new backend — replaces the original Firestore write (a new
 * `orders` doc, plus a transactional daily-sequence counter for `displayOrderId`, both now
 * handled server-side by posService.createOrder/generateOrderNumber). A dine-in order still
 * goes through the same `/tables/:qrToken/order` endpoint any QR scan uses — the table
 * picked in-app is resolved to its qrToken first — while takeaway/delivery use the
 * table-less branch endpoint; both already merge into a still-open order for the same
 * table/customer server-side, so the old client-side merge/edit logic is gone.
 *
 * Kept the exact same signature as the Firestore-era version so every call site
 * (checkout.tsx, etc.) is untouched. One parameter still has no server-side equivalent:
 * - `existingOrderId` — there's no public "edit an already-placed order" endpoint, so every
 *   call places a new order instead of amending one.
 *
 * `pricing.couponCode` is forwarded: the backend prices, validates, and consumes the
 * coupon itself server-side (see coupon.service.ts's validateAndPriceCoupon) — this app
 * never computes or sends a discount amount, only which coupon to apply. Same now for
 * `pricing.walletUsed`/`pricing.coinsRedeemed`: sent as INTENT only — the backend
 * re-validates the live wallet/coin balance and debits atomically inside the order's own
 * transaction (see pos.service.ts createOrder, wallet.service.ts), never trusting this
 * app's own client-computed amount. The auth token (already attached by apiClient for a
 * logged-in customer) is how the backend knows which account to debit — no account id is
 * sent in this payload.
 *
 * Returns the new order's id and, for an ONLINE (prepaid) order, the checkout to open
 * (services/paymentService.ts) — the restaurant only gets that order once it's paid.
 */
export async function placeOrder(
    customerName: string,
    mobileNumber: string,
    email: string | null,
    items: OrderItem[],
    total: number,
    orderType: string,
    tableNumber?: string,
    deliveryAddress?: string,
    pricing?: OrderPricing,
    userId?: string | null,
    cafeId?: string | null,
    deliveryLocation?: { latitude: number; longitude: number } | null,
    deliveryAddressId?: string | null,
    existingOrderId?: string | null,
    restaurantName?: string | null,
    paymentMode: 'COD' | 'ONLINE' = 'COD',
): Promise<{ orderId: string; payment: CheckoutPayment | null }> {
    void email; void userId; void cafeId; void deliveryAddressId; void existingOrderId; void restaurantName;

    const isTakeAwayOrder = String(orderType || '') === OrderType.TAKE_AWAY;
    const isHomeDeliveryOrder = String(orderType || '') === OrderType.HOME_DELIVERY;
    const couponCode = pricing?.couponCode || undefined;
    const walletAmount = Number(pricing?.walletUsed || 0) > 0 ? Number(pricing?.walletUsed) : undefined;
    const coinsRedeemed = Number(pricing?.coinsRedeemed || 0) > 0 ? Number(pricing?.coinsRedeemed) : undefined;

    const posItems = toPosOrderItems(items);
    if (posItems.length === 0) throw new Error("Add at least one item.");

    if (orderType === OrderType.DINE_IN) {
        const tables = await fetchBranchTables();
        const table = tables.find((t) => t.name === String(tableNumber || ''));
        if (!table) throw new Error(`Table "${tableNumber}" was not found.`);
        const order = await apiClient.post<BackendOrder>(`/public/tables/${table.qrToken}/order`, {
            items: posItems,
            customerName,
            customerPhone: mobileNumber,
            couponCode,
            walletAmount,
            coinsRedeemed,
            source: "APP",
        });
        return { orderId: order._id, payment: null };
    }

    const order = await apiClient.post<BackendOrder>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/orders`, {
        orderType: isTakeAwayOrder ? "TAKEAWAY" : "HOME_DELIVERY",
        deliveryAddress: isHomeDeliveryOrder ? deliveryAddress : undefined,
        // The pinned drop location — shown on the customer's live tracking map.
        ...(isHomeDeliveryOrder && deliveryLocation && Number.isFinite(deliveryLocation.latitude) && Number.isFinite(deliveryLocation.longitude)
            ? { deliveryLatitude: deliveryLocation.latitude, deliveryLongitude: deliveryLocation.longitude }
            : {}),
        items: posItems,
        customerName,
        customerPhone: mobileNumber,
        couponCode,
        walletAmount,
        coinsRedeemed,
        source: "APP",
        ...(paymentMode === 'ONLINE' ? { paymentMode: 'ONLINE' } : {}),
    });

    return { orderId: order._id, payment: order.payment ?? null };
}

interface BackendOrderReview {
    rating: number;
    comment: string;
    imageUrl?: string | null;
    items: { menuItemId: string; menuItemName: string; rating: number }[];
    rider?: RiderReview | null;
    createdAt: string;
}

interface BackendOrder {
    _id: string;
    /** Only on a just-placed ONLINE order: the Razorpay checkout to open. */
    payment?: CheckoutPayment | null;
    paymentMode?: 'COD' | 'ONLINE';
    orderNumber: string;
    orderType: "DINE_IN" | "TAKEAWAY" | "HOME_DELIVERY";
    status: string;
    // Present on every order document (see models/Order.ts) — not previously read here.
    // Used by the home screen's "Order Again" section to match a past order back to the
    // restaurant it was placed at, via the same `restaurants` list already loaded from
    // getRestaurants() (whose `id`/`cafeId` is this same branch id).
    branchId?: string;
    total?: number;
    pricing: {
        subtotal: number;
        discountAmount: number;
        taxAmount: number;
        deliveryChargeAmount: number;
        couponCode?: string;
        packagingChargeAmount: number;
        serviceChargeAmount?: number;
        roundOffAmount?: number;
        total: number;
        walletPayment?: number;
        coinDiscount?: number;
    };
    /** What's been paid so far (wallet at checkout, then cash/UPI on delivery). */
    amountPaid?: number;
    paymentStatus?: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
    items: {
        menuItemId: string;
        name: string;
        unitPrice: number;
        quantity: number;
        lineTotal: number;
        variantName?: string;
        modifiers?: { groupName: string; optionName: string }[];
        addons?: { name: string }[];
    }[];
    customerName: string;
    customerPhone?: string;
    createdAt: string;
    cancellableUntil?: string | null;
    deliveryAddress?: string | null;
    review?: BackendOrderReview | null;
    deliveryRider?: { name: string } | null;
    isScheduledOrder?: boolean;
    scheduledDate?: string;
    slotLabel?: string;
    slotStart?: string;
    slotEnd?: string;
    /** Where the order was placed — attached by the backend's "my orders" endpoint only. */
    restaurant?: OrderRestaurantSummary | null;
}

export interface OrderRestaurantSummary {
    id: string;
    name: string;
    orgSlug: string;
    branchCode: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    phone: string;
    address: string;
    fssai?: string;
    gstNumber?: string;
}

/** Backend stores one review per order (one shared comment/photo, per-item star ratings) —
 *  maps it into the original per-item-keyed `review`/`itemReviews` shape orders.tsx reads,
 *  reproducing the same "every item review shares the order's one comment/image" behavior
 *  the original client already had (see its buildOrderReviewSummary/submitOrderReview). */
function mapBackendReview(review: BackendOrderReview): { review: OrderReviewSummary; itemReviews: Record<string, OrderItemReview> } {
    const submittedAt = review.createdAt as unknown as Timestamp;
    const itemReviews: Record<string, OrderItemReview> = {};
    review.items.forEach((item) => {
        itemReviews[item.menuItemId] = {
            reviewId: item.menuItemId,
            productId: item.menuItemId,
            productName: item.menuItemName,
            rating: item.rating,
            comment: review.comment,
            imageUrl: review.imageUrl || '',
            submittedAt,
            userId: '',
            userName: '',
            userEmail: '',
        };
    });
    return {
        review: {
            rating: review.rating,
            comment: review.comment,
            imageUrl: review.imageUrl || '',
            submittedAt,
            userId: '',
            userName: '',
            userEmail: '',
            reviewCount: review.items.length,
        },
        itemReviews,
    };
}

const BACKEND_ORDER_TYPE_TO_APP: Record<BackendOrder["orderType"], string> = {
    DINE_IN: OrderType.DINE_IN,
    TAKEAWAY: OrderType.TAKE_AWAY,
    HOME_DELIVERY: OrderType.HOME_DELIVERY,
};

function mapBackendOrder(order: BackendOrder): Order {
    const reviewFields = order.review ? mapBackendReview(order.review) : { review: null, itemReviews: undefined };
    return {
        items: order.items.map((item) => ({
            id: item.menuItemId,
            firebaseId: item.menuItemId,
            name: item.name,
            price: item.unitPrice,
            quantity: item.quantity,
            // Server-priced line amount (includes modifiers/add-ons) — the invoice and
            // order summaries use this rather than unitPrice × quantity.
            lineTotal: item.lineTotal,
            selectedVariantName: item.variantName || null,
            modifierNames: (item.modifiers || []).map((modifier) => modifier.optionName).filter(Boolean),
            addonNames: (item.addons || []).map((addon) => addon.name).filter(Boolean),
        })),
        total: order.pricing.total,
        orderType: BACKEND_ORDER_TYPE_TO_APP[order.orderType] || order.orderType,
        deliveryAddress: order.deliveryAddress || undefined,
        restaurantId: order.branchId || null,
        cafeId: order.branchId || null,
        // The original app's lowercase status strings ("pending"/"confirmed"/etc.) are
        // matched by substring everywhere they're read (see track-order.tsx's
        // normalizeStatus/isPickedStatus/isTerminalStatus) — lowercasing the backend's
        // enum is enough for that matching to keep working without a full status table.
        status: order.status.toLowerCase(),
        customerName: order.customerName,
        mobileNumber: order.customerPhone || "",
        createdAt: order.createdAt as unknown as Timestamp,
        cancellableUntil: order.cancellableUntil || null,
        pricing: {
            subtotal: order.pricing.subtotal,
            discount: order.pricing.discountAmount,
            couponCode: order.pricing.couponCode || null,
            tax: order.pricing.taxAmount,
            serviceCharge: order.pricing.serviceChargeAmount ?? 0,
            roundOff: order.pricing.roundOffAmount ?? 0,
            packagingCharge: order.pricing.packagingChargeAmount,
            deliveryFee: order.pricing.deliveryChargeAmount,
            // Wallet money is a PAYMENT towards `total` (not a discount), so it's shown as
            // "paid", and `amountDue` is what's left to pay on delivery.
            walletUsed: order.pricing.walletPayment ?? 0,
            coinDiscount: order.pricing.coinDiscount ?? 0,
        },
        amountPaid: order.amountPaid ?? 0,
        amountDue: order.paymentStatus === "PAID" ? 0 : Math.max(0, Math.round((order.pricing.total - (order.amountPaid ?? 0)) * 100) / 100),
        paymentStatus: order.paymentStatus ?? "UNPAID",
        paymentMode: order.paymentMode ?? "COD",
        displayOrderId: order.orderNumber,
        restaurant: order.restaurant
            ? { ...order.restaurant, logoUrl: resolveImageUrl(order.restaurant.logoUrl) || null, coverImageUrl: resolveImageUrl(order.restaurant.coverImageUrl) || null }
            : null,
        ...reviewFields,
        deliveryRider: order.deliveryRider ?? null,
        riderReview: order.review?.rider ? { riderName: order.review.rider.riderName, rating: order.review.rider.rating, tags: order.review.rider.tags || [] } : null,
        ...(order.isScheduledOrder
            ? {
                isScheduledOrder: true,
                orderSource: 'scheduled',
                scheduledDate: order.scheduledDate,
                slotLabel: order.slotLabel,
                slotStart: order.slotStart,
                slotEnd: order.slotEnd,
            }
            : {}),
    } as unknown as Order;
}

export type OrderTracking = {
    orderId: string;
    status: string;
    deliveryStatus: string | null;
    cafeLocation: { latitude: number; longitude: number } | null;
    restaurantPhone: string;
    deliveryLocation: { latitude: number; longitude: number } | null;
    partner: { name: string; phone: string } | null;
    partnerLocation: { latitude: number; longitude: number } | null;
    partnerLocationUpdatedAt: string | null;
};

/** Live tracking for one of the customer's orders — restaurant location, drop pin, and the
 *  rider's live position while they're carrying it (backend customerOrderTracking.service.ts).
 *  Replaces the Firestore `order_tracking` doc. */
/** The customer cancelling their own order (only while `cancellableUntil` is in the future).
 *  The backend returns any wallet/coins used and frees the coupon. */
export async function cancelMyOrder(orderId: string, reason?: string): Promise<void> {
    await apiClient.post(`/public/customers/me/orders/${encodeURIComponent(orderId)}/cancel`, reason ? { reason } : {});
}

export async function getOrderTracking(orderId: string): Promise<OrderTracking> {
    return apiClient.get<OrderTracking>(`/public/customers/me/orders/${encodeURIComponent(orderId)}/tracking`);
}

/** Replaces the Firestore Storage upload (`uploadBytes`/`getDownloadURL`) used for review
 *  photos — see apiClient.uploadImage. */
export async function uploadReviewImage(localUri: string): Promise<string> {
    return apiClient.uploadImage(localUri, 'review');
}

/** Replaces the Firestore `productReviews` writes + the per-order `review`/`itemReviews`
 *  field updates — one call submits the whole order's review (all rated items + one shared
 *  comment/photo), matching the original client's own all-at-once submission. */
export async function submitOrderReview(
    orderId: string,
    input: {
        items: { menuItemId: string; rating: number }[];
        comment: string;
        imageUrl?: string | null;
        /** Leave out to keep any earlier rider rating as it is. */
        rider?: { rating: number; tags: RiderRatingTag[] };
    }
): Promise<void> {
    await apiClient.post(`/public/customers/me/orders/${orderId}/review`, input);
}

/** Replaces the direct `orders` Firestore query (filtered by `userId`, sorted client-side)
 *  with the customer-app's own "my orders" endpoint — already scoped to the logged-in
 *  customer (platform-wide — see services/authService.ts — so this aggregates orders
 *  across every restaurant they've ordered from, not just the one currently open) and
 *  sorted newest-first server-side. */
export async function getMyOrders(): Promise<(Order & { id: string })[]> {
    const orders = await apiClient.get<BackendOrder[]>('/public/customers/me/orders');
    // Firestore docs always carried their id alongside their data (`docSnap.id`) — `id`
    // here plays that same role, since the mapped `Order` shape itself has no id field.
    return orders.map((order) => ({ id: order._id, ...mapBackendOrder(order) }));
}

export const ORDER_HISTORY_PAGE_SIZE = 15;

/** One page of the customer's order history, newest first. Pass the previous page's
 *  `nextCursor` as `before` to load the next (older) page; `nextCursor` is null once
 *  there's nothing older. */
export async function getMyOrdersPage(before?: string | null, limit = ORDER_HISTORY_PAGE_SIZE): Promise<{ orders: (Order & { id: string })[]; nextCursor: string | null }> {
    const query = `limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
    const page = await apiClient.get<{ orders: BackendOrder[]; nextCursor: string | null }>(`/public/customers/me/orders?${query}`);
    return { orders: page.orders.map((order) => ({ id: order._id, ...mapBackendOrder(order) })), nextCursor: page.nextCursor };
}

/** Polls a single order's current status — replaces the `onSnapshot` live listener on the
 *  order document. No live-rider-GPS equivalent exists on the new backend yet (see
 *  screens/user/track-order.tsx), so this only carries status/total/items, not location. */
export async function getOrderStatus(orderId: string): Promise<Order & { _id: string }> {
    const order = await apiClient.get<BackendOrder>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/orders/${orderId}`);
    return { ...mapBackendOrder(order), _id: order._id };
}
