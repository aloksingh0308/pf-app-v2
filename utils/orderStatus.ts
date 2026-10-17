/**
 * The one place the customer app interprets an order's status. Statuses come from the
 * platform backend's Order.status enum (lower-cased by orderService.mapBackendOrder):
 * placed → accepted → preparing → ready → assigned → out_for_delivery → delivered/completed,
 * or cancelled/rejected. Matched EXACTLY — never by substring: "out_for_delivery"
 * contains "deliver", which is how an order on its way used to show as "Delivered".
 */

export type OrderStage =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'SCHEDULED';

const STAGE_BY_STATUS: Record<string, OrderStage> = {
  draft: 'PLACED',
  // Held for the platform Care Team's confirmation call (cash home delivery, new customer).
  pending_verification: 'PLACED',
  placed: 'PLACED',
  pending: 'PLACED',
  accepted: 'ACCEPTED',
  confirmed: 'ACCEPTED',
  preparing: 'PREPARING',
  processing: 'PREPARING',
  ready: 'READY',
  assigned: 'ASSIGNED',
  picked_up: 'OUT_FOR_DELIVERY',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  dispatched: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  completed: 'DELIVERED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
  rejected: 'CANCELLED',
  scheduled: 'SCHEDULED',
};

const normalize = (status: unknown) =>
  String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Unknown/missing statuses count as just placed — the safe, still-in-progress reading. */
export function getOrderStage(status: unknown): OrderStage {
  return STAGE_BY_STATUS[normalize(status)] ?? 'PLACED';
}

/** Placed, but waiting for a quick confirmation call before the restaurant gets it. */
export const isAwaitingConfirmation = (status: unknown) => normalize(status) === 'pending_verification';

export const isRejected = (status: unknown) => normalize(status) === 'rejected';
export const isOrderDelivered = (status: unknown) => getOrderStage(status) === 'DELIVERED';
export const isOrderCancelled = (status: unknown) => getOrderStage(status) === 'CANCELLED';
export const isOrderFinished = (status: unknown) => isOrderDelivered(status) || isOrderCancelled(status);
/** Still happening — shows on Home's live order bar and can be tracked. */
export const isOrderActive = (status: unknown) => {
  const stage = getOrderStage(status);
  return stage !== 'DELIVERED' && stage !== 'CANCELLED' && stage !== 'SCHEDULED';
};
/** The rider has the food. */
export const isOnTheWay = (status: unknown) => getOrderStage(status) === 'OUT_FOR_DELIVERY';

/** Short label for chips/pills. Takeaway/dine-in orders say "Ready for pickup"/"Served"
 *  where a delivery would say "Ready"/"Delivered". */
export function orderStatusLabel(status: unknown, orderType?: 'delivery' | 'takeaway' | 'dinein'): string {
  if (isAwaitingConfirmation(status)) return 'Confirming';
  switch (getOrderStage(status)) {
    case 'PLACED':
      return 'Placed';
    case 'ACCEPTED':
      return 'Confirmed';
    case 'PREPARING':
      return 'Preparing';
    case 'READY':
      return orderType === 'takeaway' ? 'Ready for pickup' : orderType === 'dinein' ? 'Ready to serve' : 'Ready';
    case 'ASSIGNED':
      return 'Rider assigned';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'DELIVERED':
      return orderType === 'takeaway' ? 'Picked up' : orderType === 'dinein' ? 'Served' : 'Delivered';
    case 'CANCELLED':
      return isRejected(status) ? 'Rejected' : 'Cancelled';
    case 'SCHEDULED':
      return 'Scheduled';
  }
}

/** One-line explanation for the live order bar / tracking screen. */
export function orderStatusMessage(status: unknown, orderType?: 'delivery' | 'takeaway' | 'dinein'): string {
  if (isAwaitingConfirmation(status)) return 'Confirming your order — our team may call you shortly';
  switch (getOrderStage(status)) {
    case 'PLACED':
      return 'Waiting for the restaurant to confirm your order';
    case 'ACCEPTED':
      return 'Order confirmed — the kitchen will start shortly';
    case 'PREPARING':
      return 'Your food is being prepared';
    case 'READY':
      return orderType === 'takeaway' ? 'Your order is ready for pickup' : orderType === 'dinein' ? 'Your order is ready to be served' : 'Food is ready — assigning a delivery partner';
    case 'ASSIGNED':
      return 'Delivery partner is heading to the restaurant';
    case 'OUT_FOR_DELIVERY':
      return 'Your order is on the way';
    case 'DELIVERED':
      return orderType === 'takeaway' ? 'Order picked up — enjoy your meal!' : 'Order delivered — enjoy your meal!';
    case 'CANCELLED':
      return isRejected(status) ? 'The restaurant could not accept this order' : 'This order was cancelled';
    case 'SCHEDULED':
      return 'Reserved for later';
  }
}

/** Progress through the delivery journey, 0–1, for progress bars. */
export function orderProgress(status: unknown): number {
  const order: OrderStage[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const index = order.indexOf(getOrderStage(status));
  return index < 0 ? 0 : index / (order.length - 1);
}

export function orderStatusColors(status: unknown): { bg: string; fg: string } {
  switch (getOrderStage(status)) {
    case 'DELIVERED':
      return { bg: '#e8f6ee', fg: '#1e8e4e' };
    case 'CANCELLED':
      return { bg: '#fdecea', fg: '#c0392b' };
    case 'OUT_FOR_DELIVERY':
    case 'ASSIGNED':
      return { bg: '#e8f2fc', fg: '#2471b8' };
    case 'SCHEDULED':
      return { bg: '#eef0ff', fg: '#4f46e5' };
    default:
      return { bg: '#fff4e6', fg: '#d9730d' };
  }
}
