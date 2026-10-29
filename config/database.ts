/**
 * LIVE or TEST backend (see config/api.ts for the URL each one points at).
 */

export type DatabaseMode = 'LIVE' | 'TEST';

// ===== CONFIGURATION =====
// Switch by setting EXPO_PUBLIC_DATABASE_MODE=LIVE or TEST.
// Set by the npm scripts / eas.json; see below for the default.
// Unset → TEST while developing (Metro), LIVE in a release build.
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;
const rawDatabaseMode = String(process.env.EXPO_PUBLIC_DATABASE_MODE || (isDevelopmentBuild ? 'TEST' : 'LIVE')).trim().toUpperCase();
export const DATABASE_MODE: DatabaseMode = rawDatabaseMode === 'LIVE' ? 'LIVE' : 'TEST';

export const IS_TEST_DATABASE = DATABASE_MODE === 'TEST';
