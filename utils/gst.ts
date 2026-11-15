/**
 * Food GST is intra-state, so every bill shows it as two equal halves: CGST + SGST
 * (5% → 2.5% + 2.5%). The rate is read back from the order itself — tax ÷ the item total
 * after discounts — so it stays right for any rate the platform sets (0/5/18).
 */
export type GstSplit = { ratePercent: number; halfRateLabel: string; cgst: number; sgst: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitGst(taxAmount: number, taxableAmount?: number, ratePercent?: number): GstSplit | null {
  const tax = round2(Number(taxAmount) || 0);
  if (tax <= 0) return null;
  const base = Number(taxableAmount) || 0;
  const rate = Number.isFinite(Number(ratePercent)) && Number(ratePercent) > 0
    ? Number(ratePercent)
    : base > 0 ? Math.round((tax / base) * 100) : 0;
  const cgst = round2(tax / 2);
  return { ratePercent: rate, halfRateLabel: rate > 0 ? `${rate / 2}%` : '', cgst, sgst: round2(tax - cgst) };
}

/** ["CGST (2.5%)", amount], ["SGST (2.5%)", amount] — or [] when there's no tax. */
export function gstRows(taxAmount: number, taxableAmount?: number, ratePercent?: number): Array<[string, number]> {
  const split = splitGst(taxAmount, taxableAmount, ratePercent);
  if (!split) return [];
  const suffix = split.halfRateLabel ? ` (${split.halfRateLabel})` : '';
  return [[`CGST${suffix}`, split.cgst], [`SGST${suffix}`, split.sgst]];
}
