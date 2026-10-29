import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * Customer invoice for a completed order, rendered to PDF with expo-print and handed to the
 * system share sheet (save to Files/Drive, WhatsApp, print, …).
 *
 * Every amount comes from the server-priced order (`pricing.*` and each line's
 * `lineTotal`) — never recomputed from unit price × quantity, which would drop variant,
 * modifier and add-on prices and make the rows disagree with the charged total.
 */

type InvoiceLine = {
  name?: string;
  quantity?: number;
  price?: number;
  lineTotal?: number;
  selectedVariantName?: string | null;
  modifierNames?: string[];
  addonNames?: string[];
};

export type InvoiceOrder = {
  id: string;
  displayOrderId?: string;
  createdAt?: unknown;
  status?: string;
  statusLabel?: string;
  orderTypeLabel?: string;
  items?: InvoiceLine[];
  total?: number;
  amountPaid?: number;
  paymentStatus?: string;
  deliveryAddress?: string;
  customerName?: string;
  mobileNumber?: string;
  pricing?: {
    subtotal?: number;
    discount?: number;
    couponCode?: string | null;
    tax?: number;
    serviceCharge?: number;
    roundOff?: number;
    packagingCharge?: number;
    deliveryFee?: number;
    walletUsed?: number;
  };
  restaurant?: { name?: string; address?: string; phone?: string; fssai?: string; gstNumber?: string } | null;
};

export type InvoiceCustomer = { name?: string; email?: string; phone?: string };

const money = (value: number) => `₹${(Math.round(value * 100) / 100).toFixed(2)}`;

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toDate(value: unknown): Date | null {
  const raw = (value as { toDate?: () => Date })?.toDate?.() ?? value;
  const date = raw instanceof Date ? raw : new Date(String(raw ?? ''));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function invoiceNumber(order: InvoiceOrder) {
  return String(order.displayOrderId || order.id || 'N/A').replace(/^#/, '');
}

export function buildInvoiceHtml(order: InvoiceOrder, customer: InvoiceCustomer = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const pricing = order.pricing || {};
  const lineAmount = (item: InvoiceLine) =>
    Number.isFinite(Number(item.lineTotal)) ? Number(item.lineTotal) : Number(item.price || 0) * Number(item.quantity || 0);

  const subtotal = Number.isFinite(Number(pricing.subtotal)) && Number(pricing.subtotal) > 0
    ? Number(pricing.subtotal)
    : items.reduce((sum, item) => sum + lineAmount(item), 0);
  const discount = Number(pricing.discount || 0);
  const tax = Number(pricing.tax || 0);
  const serviceCharge = Number(pricing.serviceCharge || 0);
  const packagingCharge = Number(pricing.packagingCharge || 0);
  const deliveryFee = Number(pricing.deliveryFee || 0);
  const roundOff = Number(pricing.roundOff || 0);
  const total = Number.isFinite(Number(order.total))
    ? Number(order.total)
    : subtotal - discount + tax + serviceCharge + packagingCharge + deliveryFee + roundOff;
  const walletUsed = Number(pricing.walletUsed || 0);
  const amountPaid = Math.max(Number(order.amountPaid || 0), order.paymentStatus === 'PAID' ? total : 0);
  const balance = Math.max(0, Math.round((total - amountPaid) * 100) / 100);

  const date = toDate(order.createdAt);
  const restaurant = order.restaurant || {};
  const customerName = customer.name || order.customerName || 'Customer';
  const customerPhone = customer.phone || order.mobileNumber || '';

  const rows = items
    .map((item) => {
      const quantity = Number(item.quantity || 0);
      const amount = lineAmount(item);
      const unit = quantity > 0 ? amount / quantity : Number(item.price || 0);
      const extras = [item.selectedVariantName, ...(item.modifierNames || []), ...(item.addonNames || [])].filter(Boolean);
      return `<tr>
        <td><div class="item">${escapeHtml(item.name || 'Item')}</div>${extras.length ? `<div class="extras">${escapeHtml(extras.join(' · '))}</div>` : ''}</td>
        <td class="c">${quantity}</td>
        <td class="r">${money(unit)}</td>
        <td class="r">${money(amount)}</td>
      </tr>`;
    })
    .join('');

  const summary: Array<[string, number, string?]> = [['Item total', subtotal]];
  if (discount > 0) summary.push([pricing.couponCode ? `Discount (${pricing.couponCode})` : 'Discount', -discount, 'save']);
  if (tax > 0) summary.push(['Taxes', tax]);
  if (serviceCharge > 0) summary.push(['Service charge', serviceCharge]);
  if (packagingCharge > 0) summary.push(['Packaging charge', packagingCharge]);
  if (deliveryFee > 0) summary.push(['Delivery fee', deliveryFee]);
  if (Math.abs(roundOff) >= 0.01) summary.push(['Round off', roundOff]);

  const summaryRows = summary
    .map(([label, value, cls]) => `<div class="row ${cls || ''}"><span>${escapeHtml(label)}</span><span>${value < 0 ? '−' : ''}${money(Math.abs(value))}</span></div>`)
    .join('');

  const paymentRows = [
    walletUsed > 0 ? `<div class="row"><span>Paid from wallet</span><span>${money(walletUsed)}</span></div>` : '',
    amountPaid - walletUsed > 0.009 ? `<div class="row"><span>Paid at ${order.orderTypeLabel === 'Home Delivery' ? 'delivery' : 'restaurant'}</span><span>${money(amountPaid - walletUsed)}</span></div>` : '',
    balance > 0 ? `<div class="row due"><span>Balance due</span><span>${money(balance)}</span></div>` : '',
  ].join('');

  const meta = (label: string, value?: string) =>
    value ? `<div class="meta"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; margin: 0; padding: 32px; color: #1f2937; font-size: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f68712; padding-bottom: 16px; }
  .brand { font-size: 20px; font-weight: 800; color: #111827; }
  .muted { color: #6b7280; margin-top: 3px; line-height: 1.5; }
  .title { text-align: right; }
  .title h1 { margin: 0; font-size: 26px; letter-spacing: 2px; color: #f68712; }
  .grid { display: flex; gap: 24px; margin-top: 20px; }
  .card { flex: 1; background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 12px 14px; }
  .card h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #9ca3af; }
  .meta { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
  .meta span { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th { background: #fff4e8; color: #92400e; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; padding: 10px; text-align: left; }
  td { padding: 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; }
  .item { font-weight: 600; } .extras { color: #6b7280; font-size: 11px; margin-top: 2px; }
  .totals { width: 300px; margin-left: auto; margin-top: 16px; }
  .row { display: flex; justify-content: space-between; padding: 5px 0; }
  .row.save span:last-child { color: #15803d; }
  .grand { border-top: 2px solid #111827; margin-top: 6px; padding-top: 8px; font-size: 16px; font-weight: 800; }
  .due span { color: #b91c1c; font-weight: 700; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px dashed #d1d5db; text-align: center; color: #9ca3af; font-size: 11px; line-height: 1.6; }
</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">${escapeHtml(restaurant.name || 'Restaurant')}</div>
      ${restaurant.address ? `<div class="muted">${escapeHtml(restaurant.address)}</div>` : ''}
      ${restaurant.phone ? `<div class="muted">Phone: ${escapeHtml(restaurant.phone)}</div>` : ''}
      ${restaurant.gstNumber ? `<div class="muted">GSTIN: ${escapeHtml(restaurant.gstNumber)}</div>` : ''}
      ${restaurant.fssai ? `<div class="muted">FSSAI Lic. No: ${escapeHtml(restaurant.fssai)}</div>` : ''}
    </div>
    <div class="title">
      <h1>INVOICE</h1>
      <div class="muted">No. ${escapeHtml(invoiceNumber(order))}</div>
      ${date ? `<div class="muted">${escapeHtml(date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Billed to</h3>
      <div class="item">${escapeHtml(customerName)}</div>
      ${customerPhone ? `<div class="muted">${escapeHtml(customerPhone)}</div>` : ''}
      ${customer.email ? `<div class="muted">${escapeHtml(customer.email)}</div>` : ''}
      ${order.deliveryAddress ? `<div class="muted">${escapeHtml(order.deliveryAddress)}</div>` : ''}
    </div>
    <div class="card">
      <h3>Order details</h3>
      ${meta('Order type', order.orderTypeLabel)}
      ${meta('Status', order.statusLabel)}
      ${meta('Payment', order.paymentStatus === 'PAID' || balance === 0 ? 'Paid' : order.paymentStatus === 'PARTIAL' ? 'Partially paid' : 'Unpaid')}
    </div>
  </div>

  <table>
    <thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="c">No items</td></tr>'}</tbody>
  </table>

  <div class="totals">
    ${summaryRows}
    <div class="row grand"><span>Grand total</span><span>${money(total)}</span></div>
    ${paymentRows}
  </div>

  <div class="footer">
    Thank you for ordering from ${escapeHtml(restaurant.name || 'us')}!<br />
    This is a computer-generated invoice and does not require a signature.
  </div>
</body>
</html>`;
}

/** Renders the invoice to a PDF and opens the share sheet (or returns the file path when
 *  sharing isn't available on this device). */
export async function shareInvoicePdf(order: InvoiceOrder, customer?: InvoiceCustomer): Promise<{ uri: string; shared: boolean }> {
  const printed = await Print.printToFileAsync({ html: buildInvoiceHtml(order, customer), width: 595, height: 842 });
  // expo-print names the file with a random UUID — give it a readable name for the share sheet.
  let uri = printed.uri;
  try {
    const target = `${FileSystem.cacheDirectory}Invoice-${invoiceNumber(order).replace(/[^\w-]+/g, '_')}.pdf`;
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: printed.uri, to: target });
    uri = target;
  } catch {
    // Keep the original file if the rename fails.
  }
  if (!(await Sharing.isAvailableAsync())) return { uri, shared: false };
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: `Invoice ${invoiceNumber(order)}`,
    UTI: 'com.adobe.pdf',
  });
  return { uri, shared: true };
}
