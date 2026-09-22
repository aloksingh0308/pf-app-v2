#!/usr/bin/env node

/**
 * Firestore Collection Cloning Utility (JavaScript Version)
 * Clone collections from production to test database or vice versa
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ===== CONFIGURATION =====
const COLLECTION_NAMES = {
  CUSTOMERS: 'customers',
  ORDERS: 'orders',
  RESTAURANTS: 'restaurants',
  USERS: 'users',
  MENU_ITEMS: 'menuItems',
  CATEGORIES: 'categoris',
  ADDONS: 'addons',
  COUPONS: 'coupons',
  OFFERS: 'offers',
  DEALS_MENU: 'deals_menu',
  DEALS_OFFERS: 'deals_offers',
  ORDER_TRACKING: 'orderTracking',
  DELIVERY_PARTNERS: 'deliveryPartners',
  INVENTORY: 'inventory',
  EMPLOYEES: 'employees',
  NOTIFICATIONS: 'notifications',
  NOTIFICATION_BROADCASTS: 'notificationBroadcasts',
  APP_UPDATES: 'app_updates',
  ORDER_COUNTERS: 'orderCounters',
  REWARD_DEALS: 'rewardDeals',
};

const COLLECTION_CONFIG = {
  [COLLECTION_NAMES.CUSTOMERS]: { displayName: 'Customers', isClonable: true },
  [COLLECTION_NAMES.ORDERS]: { displayName: 'Orders', isClonable: true },
  [COLLECTION_NAMES.RESTAURANTS]: { displayName: 'Restaurants', isClonable: true },
  [COLLECTION_NAMES.USERS]: { displayName: 'Users', isClonable: true },
  [COLLECTION_NAMES.MENU_ITEMS]: { displayName: 'Menu Items', isClonable: true },
  [COLLECTION_NAMES.CATEGORIES]: { displayName: 'Categories', isClonable: true },
  [COLLECTION_NAMES.ADDONS]: { displayName: 'Addons', isClonable: true },
  [COLLECTION_NAMES.COUPONS]: { displayName: 'Coupons', isClonable: true },
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
  [COLLECTION_NAMES.ORDER_COUNTERS]: { displayName: 'Order Counters', isClonable: false },
  [COLLECTION_NAMES.REWARD_DEALS]: { displayName: 'Reward Deals', isClonable: true },
};

class FirestoreCollectionCloner {
  constructor(db) {
    this.db = db;
    this.stats = {
      totalCollections: 0,
      processedCollections: 0,
      totalDocuments: 0,
      clonedDocuments: 0,
      skippedDocuments: 0,
      failedDocuments: 0,
      startTime: Date.now(),
    };
  }

  async cloneDocument(sourceRef, targetRef, depth = 0) {
    const MAX_DEPTH = 3;
    try {
      const sourceSnap = await sourceRef.get();

      if (!sourceSnap.exists) {
        console.log(`  ⚠️  Source document does not exist: ${sourceRef.path}`);
        return;
      }

      const targetSnap = await targetRef.get();
      if (targetSnap.exists) {
        this.stats.skippedDocuments++;
        console.log(`  ⏭️  Document already exists (skipped): ${targetRef.path}`);
        return;
      }

      const data = sourceSnap.data();
      if (data) {
        await targetRef.set(data);
        this.stats.clonedDocuments++;
        console.log(`  ✅ Cloned: ${targetRef.path}`);
      }

      if (depth < MAX_DEPTH) {
        const subcollections = await sourceRef.listCollections();
        for (const subcol of subcollections) {
          console.log(`    📂 Cloning subcollection: ${subcol.id}`);
          await this.cloneCollection(
            sourceRef.collection(subcol.id),
            targetRef.collection(subcol.id),
            depth + 1
          );
        }
      }
    } catch (error) {
      this.stats.failedDocuments++;
      console.error(`  ❌ Error cloning document ${sourceRef.path}:`, error.message);
    }
  }

  async cloneCollection(sourceCollection, targetCollection, depth = 0, limit = null) {
    try {
      let query = sourceCollection;
      if (limit) {
        query = sourceCollection.limit(limit);
      }
      
      const sourceDocs = await query.get();
      console.log(
        `  📋 Found ${sourceDocs.size} documents in ${sourceCollection.path}${limit ? ` (limited to ${limit})` : ''}`
      );

      for (const doc of sourceDocs.docs) {
        this.stats.totalDocuments++;
        const targetRef = targetCollection.doc(doc.id);
        await this.cloneDocument(doc.ref, targetRef, depth);
      }
    } catch (error) {
      console.error(
        `  ❌ Error cloning collection ${sourceCollection.path}:`,
        error.message
      );
    }
  }

  async cloneAllCollections(options) {
    console.log('\n🚀 Starting Firestore Collection Clone Operation');
    console.log(
      `   From: ${options.fromPrefix || 'LIVE'} | To: ${options.toPrefix || 'TEST'}`
    );
    if (options.limit) {
      console.log(`   Limit: ${options.limit} documents per collection`);
    }
    console.log('='.repeat(60));

    const collectionsToClone =
      options.mode === 'all'
        ? Object.values(COLLECTION_NAMES).filter(
            (name) => COLLECTION_CONFIG[name]?.isClonable !== false
          )
        : options.collections || [];

    this.stats.totalCollections = collectionsToClone.length;

    for (const collectionName of collectionsToClone) {
      this.stats.processedCollections++;
      console.log(
        `\n[${this.stats.processedCollections}/${this.stats.totalCollections}] Processing: ${collectionName}`
      );

      const sourceCollectionName = `${options.fromPrefix}${collectionName}`;
      const targetCollectionName = `${options.toPrefix}${collectionName}`;

      const sourceCollection = this.db.collection(sourceCollectionName);
      const targetCollection = this.db.collection(targetCollectionName);

      await this.cloneCollection(sourceCollection, targetCollection, 0, options.limit);
    }

    this.stats.endTime = Date.now();
    this.printSummary();
  }

  printSummary() {
    const duration = ((this.stats.endTime || Date.now()) - this.stats.startTime) / 1000;

    console.log('\n' + '='.repeat(60));
    console.log('📊 CLONE OPERATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Time: ${duration.toFixed(2)} seconds`);
    console.log(`📦 Collections Processed: ${this.stats.processedCollections}/${this.stats.totalCollections}`);
    console.log(`📄 Total Documents: ${this.stats.totalDocuments}`);
    console.log(`✅ Successfully Cloned: ${this.stats.clonedDocuments}`);
    console.log(`⏭️  Skipped (Already Exist): ${this.stats.skippedDocuments}`);
    console.log(`❌ Failed: ${this.stats.failedDocuments}`);
    console.log('='.repeat(60) + '\n');
  }
}

async function executeClone() {
  const serviceAccountPath = path.join(__dirname, '../scripts/serviceAccountKey.json');

  if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ serviceAccountKey.json not found at:', serviceAccountPath);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const db = admin.firestore();

  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    mode: 'all',
    fromPrefix: '',
    toPrefix: 'test_',
    skipExisting: true,
    limit: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--mode':
        options.mode = value || 'all';
        break;
      case '--collections':
        options.collections = value?.split(',').map((c) => c.trim());
        options.mode = 'selected';
        break;
      case '--from':
        options.fromPrefix = value === 'test' ? 'test_' : '';
        break;
      case '--to':
        options.toPrefix = value === 'test' ? 'test_' : '';
        break;
      case '--skip-existing':
        options.skipExisting = true;
        break;
      case '--overwrite':
        options.skipExisting = false;
        break;
      case '--limit':
        options.limit = parseInt(value, 10) || null;
        break;
    }
  }

  const cloner = new FirestoreCollectionCloner(db);

  try {
    await cloner.cloneAllCollections(options);
    console.log('✨ Clone operation completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error during clone operation:', error);
    process.exit(1);
  }
}

// Execute if run directly
executeClone().catch((error) => {
  console.error('Uncaught error:', error);
  process.exit(1);
});
