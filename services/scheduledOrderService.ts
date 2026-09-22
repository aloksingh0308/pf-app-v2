import type { OrderItem, OrderPricing } from './orderService';
import { apiClient } from '../utils/apiClient';
import { getActiveOrgSlug, getActiveBranchCode } from './restaurantContext';

/**
 * Replaces the original app's Firestore `scheduled_orders`/`scheduled_order_slots`
 * collections (backend/src/services/scheduledOrder.service.ts) — reserving a future order
 * in a capacity-limited time slot. Slot times are still generated client-side from the
 * restaurant's opening hours (unchanged from the original — see generateReserveSlots
 * below); only the booked-count-per-slot and the reservation write itself moved server-side.
 */

const DEFAULT_SLOT_DURATION_MINUTES = 60;
const DEFAULT_SLOT_CAPACITY = 15;

export type SlotStatus = 'available' | 'limited' | 'full';

export type ReserveSlot = {
  slotIndex: number;
  slotStart: string;
  slotEnd: string;
  slotLabel: string;
  startMinutes: number;
  endMinutes: number;
  capacity: number;
  bookedCount: number;
  slotsLeft: number;
  status: SlotStatus;
};

export type ReserveSlotConfig = {
  slotDurationMinutes: number;
  slotCapacity: number;
};

type PlaceScheduledOrderParams = {
  customerId: string | null;
  customerName: string;
  mobileNumber: string;
  email?: string | null;
  restaurantId: string;
  restaurantName: string;
  deliveryAddress?: string | null;
  deliveryAddressId?: string | null;
  deliveryLocation?: { latitude: number; longitude: number } | null;
  items: OrderItem[];
  pricing: OrderPricing;
  total: number;
  couponCode?: string | null;
  couponType?: string | null;
  couponValue?: number | null;
  couponTitle?: string | null;
  couponDescription?: string | null;
  freeItemName?: string | null;
  walletUsed?: number;
  rewardCoinsUsed?: number;
  paymentMethod?: string | null;
  cashAmount?: number;
  upiAmount?: number;
  orderType: string;
  tableNumber?: string | null;
  specialInstruction?: string | null;
  scheduledDate: string;
  slot: ReserveSlot;
  slotCapacity: number;
};

const to2 = (value: number) => String(value).padStart(2, '0');

const normalizeId = (value: unknown) => String(value || '').trim();

const parseTimeToken = (value: string): { minutes: number; label: string } | null => {
  const normalized = String(value || '').replace(/\s+/g, '').toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);
  if (!match) {
    return null;
  }

  const rawHour = Number(match[1]);
  const rawMinutes = Number(match[2] || 0);
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinutes) || rawHour < 1 || rawHour > 12 || rawMinutes < 0 || rawMinutes > 59) {
    return null;
  }

  const meridiem = match[3];
  const baseHour = rawHour % 12;
  const hours24 = meridiem === 'PM' ? baseHour + 12 : baseHour;
  const minutes = (hours24 * 60) + rawMinutes;
  const label = `${rawHour}:${to2(rawMinutes)} ${meridiem}`;

  return { minutes, label };
};

const formatMinutesAs12h = (minutes: number) => {
  const clamped = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const isPM = hours24 >= 12;
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${to2(mins)} ${isPM ? 'PM' : 'AM'}`;
};

const readOpeningWindow = (openingHours?: string | null) => {
  const matches = String(openingHours || '').match(/\d{1,2}(?::\d{2})?\s*[AaPp][Mm]/g);
  if (!matches || matches.length < 2) {
    return {
      openingMinutes: 10 * 60 + 30,
      closingMinutes: 21 * 60 + 30,
    };
  }

  const opening = parseTimeToken(matches[0]);
  const closing = parseTimeToken(matches[1]);

  if (!opening || !closing) {
    return {
      openingMinutes: 10 * 60 + 30,
      closingMinutes: 21 * 60 + 30,
    };
  }

  let closingMinutes = closing.minutes;
  if (closingMinutes <= opening.minutes) {
    closingMinutes += 24 * 60;
  }

  return {
    openingMinutes: opening.minutes,
    closingMinutes,
  };
};

const toDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = to2(date.getMonth() + 1);
  const d = to2(date.getDate());
  return `${y}-${m}-${d}`;
};

const getTomorrowDateKey = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return toDateKey(d);
};

const getTodayDateKey = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toDateKey(d);
};

const resolveDefaultReservationDate = (openingHours?: string | null, now = new Date()) => {
  const { openingMinutes } = readOpeningWindow(openingHours);
  const currentMinutes = (now.getHours() * 60) + now.getMinutes();

  // If current time is after midnight but before opening, reserve for today.
  // Otherwise (including post-closing night), reserve for tomorrow.
  if (currentMinutes < openingMinutes) {
    return {
      scheduledDate: getTodayDateKey(),
      dateLabel: 'Today',
    };
  }

  return {
    scheduledDate: getTomorrowDateKey(),
    dateLabel: 'Tomorrow',
  };
};

export const getReserveSlotConfigFromRestaurant = (restaurant: Record<string, unknown> | null | undefined): ReserveSlotConfig => {
  const slotDurationMinutesRaw = Number(
    restaurant?.slotDurationMinutes
    ?? restaurant?.reservationSlotDurationMinutes
    ?? restaurant?.scheduledOrderSlotDurationMinutes
    ?? DEFAULT_SLOT_DURATION_MINUTES
  );

  const slotCapacityRaw = Number(
    restaurant?.slotCapacity
    ?? restaurant?.reservationSlotCapacity
    ?? restaurant?.scheduledOrderSlotCapacity
    ?? DEFAULT_SLOT_CAPACITY
  );

  const slotDurationMinutes = Number.isFinite(slotDurationMinutesRaw) && slotDurationMinutesRaw >= 15
    ? Math.round(slotDurationMinutesRaw)
    : DEFAULT_SLOT_DURATION_MINUTES;

  const slotCapacity = Number.isFinite(slotCapacityRaw) && slotCapacityRaw >= 1
    ? Math.round(slotCapacityRaw)
    : DEFAULT_SLOT_CAPACITY;

  return {
    slotDurationMinutes,
    slotCapacity,
  };
};

export const generateReserveSlots = (params: {
  openingHours?: string | null;
  slotDurationMinutes?: number;
  slotCapacity?: number;
}) => {
  const { openingMinutes, closingMinutes } = readOpeningWindow(params.openingHours);
  const duration = Number(params.slotDurationMinutes || DEFAULT_SLOT_DURATION_MINUTES);
  const slotDurationMinutes = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SLOT_DURATION_MINUTES;
  const slotCapacity = Number(params.slotCapacity || DEFAULT_SLOT_CAPACITY) > 0
    ? Number(params.slotCapacity)
    : DEFAULT_SLOT_CAPACITY;

  const slots: ReserveSlot[] = [];
  let slotIndex = 0;

  for (let cursor = openingMinutes; cursor + slotDurationMinutes <= closingMinutes; cursor += slotDurationMinutes) {
    const endMinutes = cursor + slotDurationMinutes;
    slots.push({
      slotIndex,
      slotStart: formatMinutesAs12h(cursor),
      slotEnd: formatMinutesAs12h(endMinutes),
      slotLabel: `${formatMinutesAs12h(cursor)} - ${formatMinutesAs12h(endMinutes)}`,
      startMinutes: cursor,
      endMinutes,
      capacity: slotCapacity,
      bookedCount: 0,
      slotsLeft: slotCapacity,
      status: 'available',
    });
    slotIndex += 1;
  }

  return slots;
};

export const getReserveSlotsForTomorrow = async (params: {
  restaurantId: string;
  openingHours?: string | null;
  slotDurationMinutes?: number;
  slotCapacity?: number;
}) => {
  const dateContext = resolveDefaultReservationDate(params.openingHours);
  const restaurantId = normalizeId(params.restaurantId);
  if (!restaurantId) {
    return {
      scheduledDate: dateContext.scheduledDate,
      dateLabel: dateContext.dateLabel,
      slots: [] as ReserveSlot[],
    };
  }

  const scheduledDate = dateContext.scheduledDate;
  const generated = generateReserveSlots({
    openingHours: params.openingHours,
    slotDurationMinutes: params.slotDurationMinutes,
    slotCapacity: params.slotCapacity,
  });

  if (generated.length < 1) {
    return { scheduledDate, dateLabel: dateContext.dateLabel, slots: generated };
  }

  let bookedCounts: Record<number, number> = {};
  try {
    bookedCounts = await apiClient.get<Record<number, number>>(
      `/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/scheduled-slots?date=${encodeURIComponent(scheduledDate)}`
    );
  } catch (error) {
    console.warn('Failed to fetch scheduled-slot booked counts:', error);
  }

  const slots = generated.map((slot) => {
    const bookedCount = Number(bookedCounts[slot.slotIndex] || 0);
    const slotsLeft = Math.max(0, slot.capacity - bookedCount);
    const status: SlotStatus = slotsLeft <= 0 ? 'full' : slotsLeft <= 3 ? 'limited' : 'available';

    return {
      ...slot,
      bookedCount,
      slotsLeft,
      status,
    };
  });

  return {
    scheduledDate,
    dateLabel: dateContext.dateLabel,
    slots,
  };
};

export const placeScheduledOrder = async (params: PlaceScheduledOrderParams): Promise<string> => {
  const scheduledDate = normalizeId(params.scheduledDate);
  if (!scheduledDate) {
    throw new Error('Missing reservation date.');
  }
  if (params.items.length === 0) {
    throw new Error('Add at least one item.');
  }

  const isHomeDeliveryOrder = String(params.orderType || '') === 'HOME_DELIVERY' || String(params.orderType) === '3';
  const order = await apiClient.post<{ _id: string }>(`/public/branch/${getActiveOrgSlug()}/${getActiveBranchCode()}/scheduled-orders`, {
    items: params.items.map((item) => ({ menuItemId: item.firebaseId || item.id, quantity: Number(item.quantity || 0) })),
    customerName: params.customerName,
    customerPhone: params.mobileNumber,
    orderType: isHomeDeliveryOrder ? 'HOME_DELIVERY' : 'TAKEAWAY',
    deliveryAddress: isHomeDeliveryOrder ? params.deliveryAddress || undefined : undefined,
    couponCode: params.couponCode || undefined,
    scheduledDate,
    slotIndex: params.slot.slotIndex,
    slotLabel: params.slot.slotLabel,
    slotStart: params.slot.slotStart,
    slotEnd: params.slot.slotEnd,
    slotCapacity: params.slotCapacity,
  });

  return order._id;
};
