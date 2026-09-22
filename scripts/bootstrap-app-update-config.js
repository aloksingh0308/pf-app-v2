const admin = require('firebase-admin');
const path = require('path');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON file path.');
  process.exit(1);
}

const serviceAccount = require(path.resolve(serviceAccountPath));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const updateDoc = db.collection('app_updates').doc('android');

const config = {
  latestVersion: '1.0.2',
  minRequiredVersion: '1.0.1',
  forceUpdate: false,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.alok0308.praygagifoodwala',
  title: 'App Update Available',
  message: 'A newer version of Prayagi FoodWala is available. Please update to enjoy the latest features and fixes.',
};

(async () => {
  try {
    await updateDoc.set(config, { merge: true });
    console.log('✅ app_updates/android document created/updated successfully.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to create/update app_updates/android document:', error);
    process.exit(1);
  }
})();
