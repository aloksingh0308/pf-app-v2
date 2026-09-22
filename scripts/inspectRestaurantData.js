#!/usr/bin/env node

/**
 * READ-ONLY inspection script.
 * Reports current shape of restaurants / categoris / menuItems collections
 * so we can safely design the multi-restaurant migration.
 * Does NOT write anything.
 */

const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function main() {
  console.log('=== restaurants collection ===');
  const restaurantsSnap = await db.collection('restaurants').get();
  console.log(`count: ${restaurantsSnap.size}`);
  restaurantsSnap.forEach((doc) => {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  });

  console.log('\n=== categoris collection (sample + field audit) ===');
  const categoriesSnap = await db.collection('categoris').get();
  console.log(`count: ${categoriesSnap.size}`);
  let catMissingRestaurantId = 0;
  const catFieldSet = new Set();
  categoriesSnap.forEach((doc) => {
    const data = doc.data();
    Object.keys(data).forEach((k) => catFieldSet.add(k));
    if (!data.restaurantId && !data.cafeId) catMissingRestaurantId++;
  });
  console.log('fields seen across all category docs:', Array.from(catFieldSet));
  console.log(`categories missing restaurantId/cafeId: ${catMissingRestaurantId} / ${categoriesSnap.size}`);
  console.log('first 5 category docs:');
  categoriesSnap.docs.slice(0, 5).forEach((doc) => {
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
  });

  console.log('\n=== menuItems collection (sample + field audit) ===');
  const menuItemsSnap = await db.collection('menuItems').get();
  console.log(`count: ${menuItemsSnap.size}`);
  let itemMissingRestaurantId = 0;
  let itemMissingCategoryId = 0;
  const itemFieldSet = new Set();
  const categoryIdsUsedByItems = new Set();
  menuItemsSnap.forEach((doc) => {
    const data = doc.data();
    Object.keys(data).forEach((k) => itemFieldSet.add(k));
    if (!data.restaurantId && !data.cafeId) itemMissingRestaurantId++;
    if (!data.categoryId) itemMissingCategoryId++;
    if (data.categoryId) categoryIdsUsedByItems.add(data.categoryId);
  });
  console.log('fields seen across all menuItem docs:', Array.from(itemFieldSet));
  console.log(`menuItems missing restaurantId/cafeId: ${itemMissingRestaurantId} / ${menuItemsSnap.size}`);
  console.log(`menuItems missing categoryId: ${itemMissingCategoryId} / ${menuItemsSnap.size}`);
  console.log('first 5 menuItem docs (trimmed):');
  menuItemsSnap.docs.slice(0, 5).forEach((doc) => {
    const d = doc.data();
    console.log(JSON.stringify({ id: doc.id, name: d.name, categoryId: d.categoryId, cafeId: d.cafeId, restaurantId: d.restaurantId, available: d.available }, null, 2));
  });

  // cross-check: do menuItem categoryIds actually exist in categoris collection?
  // (categories carry a legacy internal `id` field distinct from the Firestore doc id, so check both)
  const categoryDocIds = new Set(categoriesSnap.docs.map((d) => d.id));
  const categoryInternalIds = new Set(categoriesSnap.docs.map((d) => String(d.data().id || '')));
  const orphanCategoryIds = Array.from(categoryIdsUsedByItems).filter(
    (id) => !categoryDocIds.has(id) && !categoryInternalIds.has(id)
  );
  console.log(`\ncategoryIds referenced by menuItems but NOT found as a categoris doc.id OR internal id field: ${orphanCategoryIds.length}`);
  if (orphanCategoryIds.length) console.log(orphanCategoryIds.slice(0, 20));

  console.log('\nall categoris doc.id -> internal id field mapping:');
  categoriesSnap.docs.forEach((d) => console.log(`  doc.id=${d.id}  internal id=${d.data().id}  name=${d.data().name}`));

  console.log('\nmenuItems missing restaurantId/cafeId (full list):');
  menuItemsSnap.docs.forEach((doc) => {
    const d = doc.data();
    if (!d.restaurantId && !d.cafeId) console.log(`  ${doc.id}  name=${d.name}`);
  });

  console.log('\ncategoris missing restaurantId/cafeId (full list):');
  categoriesSnap.docs.forEach((doc) => {
    const d = doc.data();
    if (!d.restaurantId && !d.cafeId) console.log(`  doc.id=${doc.id}  internal id=${d.id}  name=${d.name}`);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
