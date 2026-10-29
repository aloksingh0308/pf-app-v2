import { apiClient } from '../utils/apiClient';
import { API_CONFIG } from '../config/api';

/**
 * Online payment (Razorpay) for delivery/takeaway orders.
 *
 * The backend creates the order AWAITING_PAYMENT plus a Razorpay order for the amount IT
 * priced, and returns the checkout details below (public key id only — the secret never
 * leaves the server). The app opens them in components/RazorpayCheckout.tsx (a WebView in
 * Razorpay's redirect mode); the backend verifies the result before the restaurant sees it.
 */
export interface CheckoutPayment {
  provider: 'RAZORPAY';
  keyId: string;
  orderId: string;
  gatewayOrderId: string;
  /** Paise. */
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name?: string; contact?: string; email?: string };
  expiresAt: string;
}

export type CheckoutResult =
  | { status: 'paid' }
  | { status: 'pending' }
  | { status: 'failed'; reason?: string }
  | { status: 'dismissed' };

export async function getPaymentConfig(): Promise<{ onlinePayments: boolean }> {
  return apiClient.get<{ onlinePayments: boolean }>('/public/payments/config');
}

/** The same checkout again for an order still awaiting payment. */
export async function resumePayment(orderId: string): Promise<CheckoutPayment> {
  return apiClient.post<CheckoutPayment>(`/public/orders/${encodeURIComponent(orderId)}/payment/resume`, {});
}

/** Gives up on paying — the order is closed and wallet/coins/coupon returned. */
export async function abandonPayment(orderId: string): Promise<void> {
  await apiClient.post(`/public/orders/${encodeURIComponent(orderId)}/payment/abandon`, {});
}

/** Where Razorpay POSTs the result in redirect mode; the backend verifies and then
 *  redirects to DONE_PATH, which the WebView watches for. */
export function redirectCallbackUrl(orderId: string): string {
  return `${API_CONFIG.baseUrl}/public/payments/razorpay/callback/${encodeURIComponent(orderId)}`;
}
export const DONE_PATH = '/public/payments/razorpay/done';
