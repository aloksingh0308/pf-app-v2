import { parseDeepLink, savePendingLink } from '@/utils/deepLinks';

/**
 * Restaurant / invite links are parked as a pending link (see utils/deepLinks.ts) rather than
 * routed: a cold start goes to "/" so the root layout's splash → login/tabs flow runs as usual
 * and then opens the restaurant; a warm start returns "" (no navigation) and the layout picks
 * the link up from its onPendingLinkChange subscription. Every other URL passes through.
 */
export async function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  const link = parseDeepLink(path);
  if (!link) return path;
  await savePendingLink(link);
  return initial ? '/' : '';
}
