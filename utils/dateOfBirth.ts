/**
 * Date of birth is a calendar date, not a moment in time — convert it without ever going
 * through a timezone. (`new Date(y, m, d).toISOString()` in India gives the PREVIOUS day,
 * because local midnight IST is 18:30 UTC the day before.)
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "03/08/2000" → "2000-08-03" */
export function dobToIso(ddmmyyyy: string): string {
  const [day, month, year] = String(ddmmyyyy).split('/').map(Number);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Reads the Y-M-D part of "2000-08-03" or "2000-08-03T00:00:00.000Z" (never shifted by timezone). */
function isoParts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '').trim());
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

/** "2000-08-03…" → "03/08/2000" (the form fields' format). Anything else is returned as-is. */
export function isoToDob(iso: string): string {
  const parts = isoParts(iso);
  return parts ? `${pad(parts.day)}/${pad(parts.month)}/${parts.year}` : String(iso || '');
}

/** "2000-08-03…" → "03 Aug 2000" for display. */
export function formatDob(iso: string): string {
  const parts = isoParts(iso);
  return parts ? `${pad(parts.day)} ${MONTHS[parts.month - 1]} ${parts.year}` : String(iso || '');
}
