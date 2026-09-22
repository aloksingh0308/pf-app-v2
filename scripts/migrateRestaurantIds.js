#!/usr/bin/env node

/**
 * Backfill restaurantId/cafeId on menuItems and categoris docs that are
 * missing it. Safe because, at time of writing, only ONE restaurant exists
 * ("Hungry's Bucket Cafe"), so every record missing the field unambiguously
 * belongs to it. Run inspectRestaurantData.js again after adding a second
 * restaurant — do NOT reuse this script blindly once more than one
 * restaurant exists, since the correct assignment would then be ambiguous.
 *
 * Usage:
 *   node scripts/migrateRestaurantIds.js            (dry run, no writes)
 *   node scripts/migrateRestaurantIds.js --apply     (writes)
 */

const admin = require('firebase-admin');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function main() {
  const restaurantsSnap = await db.collection('restaurants').get();
  if (restaurantsSnap.size !== 1) {
    console.error(
      `Refusing to run: expected exactly 1 restaurant doc, found ${restaurantsSnap.size}. ` +
      `This script only backfills unambiguous single-restaurant data. Re-run inspectRestaurantData.js and assign manually if there are multiple restaurants.`
    );
    process.exit(1);
  }
  const restaurantId = restaurantsSnap.docs[0].id;
  console.log(`Target restaurantId: ${restaurantId} (${restaurantsSnap.docs[0].data().name})`);
  console.log(APPLY ? 'Mode: APPLY (writes will happen)' : 'Mode: DRY RUN (no writes)');

  const categoriesSnap = await db.collection('categoris').get();
  const categoryUpdates = categoriesSnap.docs.filter((doc) => {
    const d = doc.data();
    return !d.restaurantId && !d.cafeId;
  });

  console.log(`\ncategoris docs to update: ${categoryUpdates.length}`);
  categoryUpdates.forEach((doc) => console.log(`  ${doc.id} (${doc.data().name})`));

  const menuItemsSnap = await db.collection('menuItems').get();
  const menuItemUpdates = menuItemsSnap.docs.filter((doc) => {
    const d = doc.data();
    return !d.restaurantId && !d.cafeId;
  });

  console.log(`\nmenuItems docs to update: ${menuItemUpdates.length}`);
  menuItemUpdates.forEach((doc) => console.log(`  ${doc.id} (${doc.data().name})`));

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write these changes.');
    process.exit(0);
  }

  const batch = db.batch();
  [...categoryUpdates, ...menuItemUpdates].forEach((doc) => {
    batch.update(doc.ref, { restaurantId, cafeId: restaurantId });
  });
  await batch.commit();
  console.log(`\nApplied: tagged ${categoryUpdates.length} categories and ${menuItemUpdates.length} menu items with restaurantId=${restaurantId}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
