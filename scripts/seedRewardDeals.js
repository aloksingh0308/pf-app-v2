#!/usr/bin/env node

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const rewardDeals = [
  {
    id: 'FREE_MASALA_COKE',
    title: 'Free Masala Coke',
    rewardType: 'FREE_ITEM',
    productId: 'masala_coke_product_id',
    probability: 30,
    minOrder: 199,
    expiryDays: 15,
    couponPrefix: 'COKE',
    description: 'Get a FREE Masala Coke on your next order.',
    isActive: true,
  },
  {
    id: 'FREE_FRENCH_FRIES',
    title: 'Free French Fries',
    rewardType: 'FREE_ITEM',
    productId: 'french_fries_product_id',
    probability: 20,
    minOrder: 249,
    expiryDays: 15,
    couponPrefix: 'FRIES',
    description: 'Enjoy FREE French Fries with your next order.',
    isActive: true,
  },
  {
    id: 'FREE_VEG_STEAM_MOMOS',
    title: 'Free Veg Steam Momos',
    rewardType: 'FREE_ITEM',
    productId: 'veg_steam_momos_product_id',
    probability: 15,
    minOrder: 299,
    expiryDays: 15,
    couponPrefix: 'MOMOS',
    isActive: true,
  },
  {
    id: 'HALF_PIZZA',
    title: '50% Off MARGHERITA Pizza',
    rewardType: 'PRODUCT_PERCENTAGE',
    category: 'PIZZA',
    discount: 50,
    maxDiscount: 250,
    minOrder: 399,
    expiryDays: 10,
    couponPrefix: 'PIZZA50',
    isActive: true,
  },
  {
    id: 'FREE_DELIVERY',
    title: 'Free Delivery',
    rewardType: 'FREE_DELIVERY',
    expiryDays: 15,
    couponPrefix: 'DELFREE',
    isActive: true,
  },
  {
    id: 'FREE_DESSERT',
    title: 'Free Dessert',
    rewardType: 'FREE_ITEM',
    productId: 'dessert_product_id',
    minOrder: 249,
    expiryDays: 15,
    couponPrefix: 'DESSERT',
    isActive: true,
  },
];

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'test').toLowerCase();
const collectionName = mode === 'live' ? 'deals' : 'test_deals';

async function main() {
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Missing service account file at ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  const db = admin.firestore();
  const batch = db.batch();

  rewardDeals.forEach((deal) => {
    const docRef = db.collection(collectionName).doc(deal.id);
    batch.set(docRef, {
      ...deal,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  console.log(`Seeded ${rewardDeals.length} documents into ${collectionName}`);
}

main().catch((error) => {
  console.error('Failed to seed reward deals:', error);
  process.exit(1);
});
