/**
 * Database Configuration
 * Centralizes all Firestore collection names and database mode
 * Change only DATABASE_MODE to switch between LIVE and TEST databases
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

// Enable while debugging mode routing. Set to false to silence logs.
export const TRACE_COLLECTION_RESOLUTION = true;

// ===== COLLECTION MAPPING =====
// All collections must be registered here
// The system will automatically prefix with 'test_' when DATABASE_MODE is TEST

export const COLLECTION_NAMES = {
  // Core Collections
  CUSTOMERS: 'customers',
  ORDERS: 'orders',
  RESTAURANTS: 'restaurants',
  USERS: 'users',

  // Product & Menu Collections
  MENU_ITEMS: 'menuItems',
  CATEGORIES: 'categoris', // Note: intentional typo preserved from original project
  ADDONS: 'addons',
  PRODUCT_REVIEWS: 'productReviews',

  // Commerce Collections
  COUPONS: 'coupons',
  DEALS: 'deals',
  OFFERS: 'offers',
  DEALS_MENU: 'deals_menu',
  DEALS_OFFERS: 'deals_offers',

  // Delivery & Tracking
  ORDER_TRACKING: 'orderTracking',
  DELIVERY_PARTNERS: 'deliveryPartners',

  // Business Operations
  INVENTORY: 'inventory',
  EMPLOYEES: 'employees',
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_BROADCASTS: 'notificationBroadcasts',

  // System Collections
  APP_UPDATES: 'app_updates',
  APP_CONFIG: 'app_config',
  ORDER_COUNTERS: 'orderCounters',
  SCHEDULED_ORDERS: 'scheduled_orders',
  SCHEDULED_ORDER_SLOTS: 'scheduled_order_slots',

  // Rewards & Loyalty
  REWARDS: 'rewards',
  REWARD_DEALS: 'rewardDeals',

  // Party Booking
  PARTY_MENUS: 'party_menus',
  PARTY_MENU_ITEMS: 'party_menu_items',
  PARTY_DECORATION_PACKAGES: 'party_decoration_packages',
  PARTY_COUPONS: 'party_coupons',
  PARTY_BOOKINGS: 'party_bookings',
} as const;

/**
 * Subcollection paths that require special handling
 * Used when building document references with subcollections
 */
export const SUBCOLLECTIONS = {
  ADDRESSES: 'addresses',
  WALLET_TRANSACTIONS: 'walletTransactions',
  LIVE_LOCATION: 'liveLocation',
} as const;

/**
 * Configuration for each collection in the system
 * Useful for admin utilities, cloning scripts, and validation
 */
export const COLLECTION_CONFIG = {
  [COLLECTION_NAMES.CUSTOMERS]: { displayName: 'Customers', isClonable: true },
  [COLLECTION_NAMES.ORDERS]: { displayName: 'Orders', isClonable: true },
  [COLLECTION_NAMES.RESTAURANTS]: { displayName: 'Restaurants', isClonable: true },
  [COLLECTION_NAMES.USERS]: { displayName: 'Users', isClonable: true },
  [COLLECTION_NAMES.MENU_ITEMS]: { displayName: 'Menu Items', isClonable: true },
  [COLLECTION_NAMES.CATEGORIES]: { displayName: 'Categories', isClonable: true },
  [COLLECTION_NAMES.ADDONS]: { displayName: 'Addons', isClonable: true },
  [COLLECTION_NAMES.PRODUCT_REVIEWS]: { displayName: 'Product Reviews', isClonable: true },
  [COLLECTION_NAMES.COUPONS]: { displayName: 'Coupons', isClonable: true },
  [COLLECTION_NAMES.DEALS]: { displayName: 'Deals', isClonable: true },
  [COLLECTION_NAMES.OFFERS]: { displayName: 'Offers', isClonable: true },
  [COLLECTION_NAMES.DEALS_MENU]: { displayName: 'Deals Menu', isClonable: true },
  [COLLECTION_NAMES.DEALS_OFFERS]: { displayName: 'Deals Offers', isClonable: true },
  [COLLECTION_NAMES.ORDER_TRACKING]: { displayName: 'Order Tracking', isClonable: true },
  [COLLECTION_NAMES.DELIVERY_PARTNERS]: { displayName: 'Delivery Partners', isClonable: true },
  [COLLECTION_NAMES.INVENTORY]: { displayName: 'Inventory', isClonable: true },
  [COLLECTION_NAMES.EMPLOYEES]: { displayName: 'Employees', isClonable: true },
  [COLLECTION_NAMES.NOTIFICATIONS]: { displayName: 'Notifications', isClonable: true },
  [COLLECTION_NAMES.NOTIFICATION_BROADCASTS]: { displayName: 'Notification Broadcasts', isClonable: true },
  [COLLECTION_NAMES.APP_UPDATES]: { displayName: 'App Updates', isClonable: false },
  [COLLECTION_NAMES.APP_CONFIG]: { displayName: 'App Config', isClonable: false },
  [COLLECTION_NAMES.ORDER_COUNTERS]: { displayName: 'Order Counters', isClonable: false },
  [COLLECTION_NAMES.SCHEDULED_ORDERS]: { displayName: 'Scheduled Orders', isClonable: true },
  [COLLECTION_NAMES.SCHEDULED_ORDER_SLOTS]: { displayName: 'Scheduled Order Slots', isClonable: true },
  [COLLECTION_NAMES.REWARDS]: { displayName: 'Rewards', isClonable: true },
  [COLLECTION_NAMES.REWARD_DEALS]: { displayName: 'Reward Deals', isClonable: true },
  [COLLECTION_NAMES.PARTY_MENUS]: { displayName: 'Party Menus', isClonable: true },
  [COLLECTION_NAMES.PARTY_MENU_ITEMS]: { displayName: 'Party Menu Items', isClonable: true },
  [COLLECTION_NAMES.PARTY_DECORATION_PACKAGES]: { displayName: 'Party Decoration Packages', isClonable: true },
  [COLLECTION_NAMES.PARTY_COUPONS]: { displayName: 'Party Coupons', isClonable: true },
  [COLLECTION_NAMES.PARTY_BOOKINGS]: { displayName: 'Party Bookings', isClonable: true },
};
