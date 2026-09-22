import { Product } from '@/types/Product';

const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
};

export const getDealBundleQuantity = (items: Pick<Product, 'quantity'>[]): number => {
  const quantities = items
    .map((item) => Math.max(1, Math.round(Number((item as any)?.quantity || 1))))
    .filter((value) => Number.isFinite(value));

  if (quantities.length < 1) {
    return 1;
  }

  return Math.max(1, quantities.reduce((acc, value) => gcd(acc, value), quantities[0]));
};

export const calculateCartTotals = (cartItems: (Product & { quantity: number })[]) => {
  const dealMap = new Map<string, (Product & { quantity: number })[]>();
  const regularItems: (Product & { quantity: number })[] = [];

  cartItems.forEach((item) => {
    const dealId = String(item?.isDeal ? (item?.dealId || '') : '').trim();
    if (!dealId) {
      regularItems.push(item);
      return;
    }

    const bucket = dealMap.get(dealId) || [];
    bucket.push(item);
    dealMap.set(dealId, bucket);
  });

  let total = 0;
  let displayCount = 0;
  let savings = 0;

  regularItems.forEach((item) => {
    const qty = Math.max(1, Number(item.quantity || 1));
    total += Number(item.price || 0) * qty;
    displayCount += qty;
    savings += Number((item as any).saveAmount || 0) * qty;
  });

  dealMap.forEach((items) => {
    const first = items[0];
    const bundleQty = getDealBundleQuantity(items as Pick<Product, 'quantity'>[]);
    const dealPrice = Math.max(0, Number(first?.dealPrice || 0));
    const originalDealPrice = Math.max(0, Number(first?.originalDealPrice || 0));

    total += dealPrice * bundleQty;
    displayCount += bundleQty;

    if (originalDealPrice > dealPrice) {
      savings += (originalDealPrice - dealPrice) * bundleQty;
    }
  });

  return {
    total: Number(total.toFixed(2)),
    displayCount,
    savings: Number(savings.toFixed(2)),
  };
};
