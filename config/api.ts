/**
 * Config for the restaurant-saas-platform backend that replaces Firebase for this app —
 * see utils/apiClient.ts. `baseUrl` is fixed per-build config. `orgSlug`/`branchCode` are
 * only a fallback default now — the app is a cross-organization marketplace (see
 * `/public/restaurants` and services/restaurantContext.ts), so the actual restaurant a
 * screen talks to is normally resolved per-screen, not fixed build-wide. The default here
 * just keeps things working before any restaurant has been selected (e.g. Home's initial
 * restaurant-directory fetch, which doesn't need one).
 */
export const API_CONFIG = {
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://10.0.2.2:4000/api',
  orgSlug: process.env.EXPO_PUBLIC_ORG_SLUG || 'hungry-s-bucket-cafe',
  branchCode: process.env.EXPO_PUBLIC_BRANCH_CODE || 'MAIN',
};
