/**
 * Collection Name Resolver
 * Automatically prefixes collection names with 'test_' when in TEST mode
 * Use this everywhere instead of hardcoded collection names
 */

import { DATABASE_MODE, COLLECTION_NAMES, SUBCOLLECTIONS, TRACE_COLLECTION_RESOLUTION } from '../config/database';

const loggedCollectionMappings = new Set<string>();

/**
 * Get the actual collection name based on database mode
 * In TEST mode, automatically prefixes with 'test_'
 *
 * @param baseName - The base collection name (from COLLECTION_NAMES)
 * @returns The resolved collection name with mode-specific prefix
 *
 * @example
 * // In LIVE mode
 * getCollectionName(COLLECTION_NAMES.PRODUCTS) // returns 'products'
 *
 * // In TEST mode
 * getCollectionName(COLLECTION_NAMES.PRODUCTS) // returns 'test_products'
 */
export const getCollectionName = (baseName: string): string => {
  const resolved = DATABASE_MODE === 'TEST' ? `test_${baseName}` : baseName;

  const isDevRuntime = Boolean((globalThis as any)?.__DEV__);
  if (TRACE_COLLECTION_RESOLUTION && isDevRuntime && !loggedCollectionMappings.has(baseName)) {
    loggedCollectionMappings.add(baseName);
    console.log(`[collectionResolver] mode=${DATABASE_MODE} base=${baseName} resolved=${resolved}`);
  }

  return resolved;
};

/**
 * Get subcollection name (generally doesn't need prefixing)
 * Used for nested collections like customers/{uid}/addresses
 *
 * @param subName - The subcollection name
 * @returns The subcollection name (usually unchanged)
 */
export const getSubcollectionName = (subName: string): string => {
  // Subcollections typically don't need prefixing, only top-level do
  return subName;
};

/**
 * Utility function to get the opposite mode
 * Useful for admin utilities that need to reference the other database
 */
export const getOppositeModeCollectionName = (baseName: string): string => {
  if (DATABASE_MODE === 'TEST') {
    // Remove 'test_' prefix if in TEST mode
    return baseName.startsWith('test_') ? baseName.slice(5) : baseName;
  } else {
    // Add 'test_' prefix if in LIVE mode
    return `test_${baseName}`;
  }
};

/**
 * Check if a collection name is a test collection
 */
export const isTestCollection = (collectionName: string): boolean => {
  return collectionName.startsWith('test_');
};

/**
 * Get the base name from a collection name (removes test_ prefix if present)
 */
export const getBaseCollectionName = (collectionName: string): string => {
  return isTestCollection(collectionName) ? collectionName.slice(5) : collectionName;
};

/**
 * Get all collection names for the current mode
 * Useful for cloning, backup, and admin utilities
 */
export const getAllCollectionNames = (): { base: string; resolved: string }[] => {
  return Object.values(COLLECTION_NAMES).map((baseName) => ({
    base: baseName,
    resolved: getCollectionName(baseName),
  }));
};
