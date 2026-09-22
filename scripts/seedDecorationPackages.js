#!/usr/bin/env node

// Seeds the default party_decoration_packages catalog.
// Usage:
//   node scripts/seedDecorationPackages.js --mode=test
//   node scripts/seedDecorationPackages.js --mode=live

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const decorationPackages = [
  {
    id: 'elegant_celebration',
    name: 'Elegant Celebration',
    description: 'Perfect for small celebrations.',
    price: 999,
    recommended: false,
    displayOrder: 1,
    active: true,
    coverImage: '',
    gallery: [],
    includes: [
      '50 Premium Balloons',
      'Birthday / Anniversary Banner',
      'Fairy Lights',
      'Balloon Bunches',
      'Cake Table Decoration',
      'LED Candles',
    ],
  },
  {
    id: 'signature_celebration',
    name: 'Signature Celebration',
    description: 'Our most popular package for memorable celebrations.',
    price: 1999,
    recommended: true,
    displayOrder: 2,
    active: true,
    coverImage: '',
    gallery: [],
    includes: [
      'Everything from Elegant +',
      '120 Premium Balloons',
      'Half Balloon Arch',
      'LED Neon Sign',
      'Artificial Flowers',
      'Selfie Corner',
      'Premium Cake Table',
      'Gift Table Decoration',
    ],
  },
  {
    id: 'royal_celebration',
    name: 'Royal Celebration',
    description: 'The ultimate premium decoration experience.',
    price: 2999,
    recommended: false,
    displayOrder: 3,
    active: true,
    coverImage: '',
    gallery: [],
    includes: [
      'Everything from Signature +',
      '220 Premium Balloons',
      'Full Balloon Arch',
      'Premium Neon Sign',
      'Luxury Cake Table',
      'Welcome Decoration',
      'Premium Photo Backdrop',
      'Hanging Decorations',
      'Table Decorations',
    ],
  },
];

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'test').toLowerCase();
const prefix = mode === 'live' ? '' : 'test_';
const packagesCollection = `${prefix}party_decoration_packages`;

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

  decorationPackages.forEach((pkg) => {
    const docRef = db.collection(packagesCollection).doc(pkg.id);
    batch.set(docRef, {
      ...pkg,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await batch.commit();
  console.log(`Seeded ${decorationPackages.length} decoration packages into ${packagesCollection}`);
}

main().catch((error) => {
  console.error('Failed to seed decoration packages:', error);
  process.exit(1);
});
