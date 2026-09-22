#!/usr/bin/env node

// Seeds the Chinese Party Platter menu + its step-by-step item catalog into
// party_menus / party_menu_items. Run with --mode=live or --mode=test (default).
//
// Usage:
//   node scripts/seedPartyMenu.js --mode=test
//   node scripts/seedPartyMenu.js --mode=live

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const MENU_DOC_ID = 'chinese_party_platter';

const partyMenu = {
  name: 'Chinese Party Platter',
  slug: 'chinese_party_platter',
  description: 'Create your own Chinese Party Platter',
  active: true,
  platterTypes: [
    {
      id: 'standard',
      name: 'Standard',
      price: 249,
      freePremiumUpgrades: 0,
      unlimitedPremiumItems: false,
    },
    {
      id: 'premium',
      name: 'Premium',
      price: 289,
      freePremiumUpgrades: 1,
      unlimitedPremiumItems: false,
    },
    {
      id: 'deluxe',
      name: 'Deluxe',
      price: 329,
      freePremiumUpgrades: 999,
      unlimitedPremiumItems: true,
    },
  ],
};

// step: wizard step number. stepLabel is derived from the step number and shared
// by every item in that step, matching the wizard's grouping convention.
const STEP_LABELS = { 1: 'Starter', 2: 'Snack', 3: 'Main Course', 4: 'Beverage' };

const partyMenuItems = [
  { id: 'starter_crispy_corn', menuId: 'chinese_party_platter', step: 1, category: 'Starter', name: 'Crispy Corn', description: 'Golden crispy sweet corn', portion: '80 gm', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 1, active: true, image: '' },
  { id: 'starter_salted_fries', menuId: 'chinese_party_platter', step: 1, category: 'Starter', name: 'Salted Fries', description: 'Classic salted french fries', portion: '80 gm', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 2, active: true, image: '' },
  { id: 'starter_peri_peri_fries', menuId: 'chinese_party_platter', step: 1, category: 'Starter', name: 'Peri Peri Fries', description: 'Fries tossed with peri peri seasoning', portion: '80 gm', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 3, active: true, image: '' },
  { id: 'starter_veg_steam_momos', menuId: 'chinese_party_platter', step: 1, category: 'Starter', name: 'Veg Steam Momos', description: 'Soft steamed vegetable momos', portion: '2 pcs', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 4, active: true, image: '' },

  { id: 'snack_veg_sandwich', menuId: 'chinese_party_platter', step: 2, category: 'Snack', name: 'Veg Sandwich', description: 'Half grilled veg sandwich', portion: '2 Triangles', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 1, active: true, image: '' },
  { id: 'snack_veg_burger', menuId: 'chinese_party_platter', step: 2, category: 'Snack', name: 'Veg Burger', description: 'Mini veg burger', portion: '1 Mini Burger', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 2, active: true, image: '' },
  { id: 'snack_dry_manchurian', menuId: 'chinese_party_platter', step: 2, category: 'Snack', name: 'Dry Manchurian', description: 'Dry veg manchurian', portion: '3 pcs', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 3, active: true, image: '' },
  { id: 'snack_veg_spring_roll', menuId: 'chinese_party_platter', step: 2, category: 'Snack', name: 'Veg Spring Roll', description: 'Mini crispy spring rolls', portion: '2 pcs', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 4, active: true, image: '' },

  { id: 'rice_veg_fried_rice', menuId: 'chinese_party_platter', step: 3, category: 'Rice', name: 'Veg Fried Rice', description: 'Classic vegetable fried rice', portion: '150 gm', selectionLimit: 2, premium: false, upgradePrice: 0, displayOrder: 1, active: true, image: '' },
  { id: 'rice_paneer_fried_rice', menuId: 'chinese_party_platter', step: 3, category: 'Rice', name: 'Paneer Fried Rice', description: 'Paneer loaded fried rice', portion: '150 gm', selectionLimit: 2, premium: true, upgradePrice: 20, displayOrder: 2, active: true, image: '' },
  { id: 'rice_schezwan_fried_rice', menuId: 'chinese_party_platter', step: 3, category: 'Rice', name: 'Schezwan Fried Rice', description: 'Spicy schezwan fried rice', portion: '150 gm', selectionLimit: 2, premium: true, upgradePrice: 20, displayOrder: 3, active: true, image: '' },
  { id: 'rice_manchurian_gravy', menuId: 'chinese_party_platter', step: 3, category: 'Rice', name: 'Manchurian Gravy', description: 'Veg manchurian in gravy', portion: '2 pcs + 80 ml', selectionLimit: 2, premium: false, upgradePrice: 0, displayOrder: 4, active: true, image: '' },

  { id: 'noodle_veg_noodles', menuId: 'chinese_party_platter', step: 3, category: 'Noodles', name: 'Veg Noodles', description: 'Street style veg noodles', portion: '150 gm', selectionLimit: 2, premium: false, upgradePrice: 0, displayOrder: 5, active: true, image: '' },
  { id: 'noodle_paneer_loaded_noodles', menuId: 'chinese_party_platter', step: 3, category: 'Noodles', name: 'Paneer Loaded Noodles', description: 'Noodles with paneer cubes', portion: '150 gm', selectionLimit: 2, premium: true, upgradePrice: 20, displayOrder: 6, active: true, image: '' },
  { id: 'noodle_schezwan_noodles', menuId: 'chinese_party_platter', step: 3, category: 'Noodles', name: 'Schezwan Noodles', description: 'Spicy schezwan noodles', portion: '150 gm', selectionLimit: 2, premium: true, upgradePrice: 20, displayOrder: 7, active: true, image: '' },
  { id: 'pasta_white_sauce', menuId: 'chinese_party_platter', step: 3, category: 'Pasta', name: 'White Sauce Pasta', description: 'Creamy white sauce pasta', portion: '150 gm', selectionLimit: 2, premium: true, upgradePrice: 30, displayOrder: 8, active: true, image: '' },

  { id: 'drink_sprite', menuId: 'chinese_party_platter', step: 4, category: 'Beverage', name: 'Sprite', description: 'Chilled Sprite', portion: '200 ml', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 1, active: true, image: '' },
  { id: 'drink_coke', menuId: 'chinese_party_platter', step: 4, category: 'Beverage', name: 'Coke', description: 'Chilled Coca-Cola', portion: '200 ml', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 2, active: true, image: '' },
  { id: 'drink_masala_coke', menuId: 'chinese_party_platter', step: 4, category: 'Beverage', name: 'Masala Coke', description: 'Special masala coke', portion: '200 ml', selectionLimit: 1, premium: true, upgradePrice: 20, displayOrder: 3, active: true, image: '' },
  { id: 'drink_hot_coffee', menuId: 'chinese_party_platter', step: 4, category: 'Beverage', name: 'Hot Coffee', description: 'Fresh hot coffee', portion: '150 ml', selectionLimit: 1, premium: false, upgradePrice: 0, displayOrder: 4, active: true, image: '' },
].map((item) => ({ ...item, stepLabel: STEP_LABELS[item.step] || `Step ${item.step}` }));

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'test').toLowerCase();
const prefix = mode === 'live' ? '' : 'test_';
const menusCollection = `${prefix}party_menus`;
const itemsCollection = `${prefix}party_menu_items`;

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

  const menuRef = db.collection(menusCollection).doc(MENU_DOC_ID);
  batch.set(menuRef, {
    ...partyMenu,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  partyMenuItems.forEach((item) => {
    const itemRef = db.collection(itemsCollection).doc(item.id);
    batch.set(itemRef, {
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  console.log(`Seeded 1 menu into ${menusCollection} and ${partyMenuItems.length} items into ${itemsCollection}`);
}

main().catch((error) => {
  console.error('Failed to seed party menu:', error);
  process.exit(1);
});
