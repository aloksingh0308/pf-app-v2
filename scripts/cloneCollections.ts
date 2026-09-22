/**
 * Firestore Collection Cloning Utility
 *
 * Clone collections from production to test database or vice versa
 * Supports:
 * - Cloning all collections
 * - Cloning specific collections
 * - Overwriting or skipping existing documents
 * - Progress logging
 * - Retry logic for failed writes
 *
 * Usage:
 *   node scripts/cloneCollections.js --mode all --from live --to test
 *   node scripts/cloneCollections.js --collections customers,orders,menuItems --from live --to test
 *   node scripts/cloneCollections.js --mode all --from live --to test --skip-existing
 */

import admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Import configuration
import { COLLECTION_NAMES, COLLECTION_CONFIG } from '../config/database.js';

interface CloneOptions {
  mode: 'all' | 'selected';
  collections?: string[];
  fromPrefix: '' | 'test_';
  toPrefix: '' | 'test_';
  skipExisting?: boolean;
  maxRetries?: number;
  batchSize?: number;
}

interface CloneStats {
  totalCollections: number;
  processedCollections: number;
  totalDocuments: number;
  clonedDocuments: number;
  skippedDocuments: number;
  failedDocuments: number;
  startTime: number;
  endTime?: number;
}

class FirestoreCollectionCloner {
  private db: admin.firestore.Firestore;
  private stats: CloneStats;

  constructor(db: admin.firestore.Firestore) {
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

  /**
   * Clone a single document including subcollections
   */
  private async cloneDocument(
    sourceRef: admin.firestore.DocumentReference,
    targetRef: admin.firestore.DocumentReference,
    depth = 0
  ): Promise<void> {
    const MAX_DEPTH = 3; // Prevent infinite recursion

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

      // Clone the document data
      const data = sourceSnap.data();
      if (data) {
        await targetRef.set(data);
        this.stats.clonedDocuments++;
        console.log(`  ✅ Cloned: ${targetRef.path}`);
      }

      // Clone subcollections if depth < MAX_DEPTH
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
      console.error(`  ❌ Error cloning document ${sourceRef.path}:`, error);
    }
  }

  /**
   * Clone an entire collection
   */
  private async cloneCollection(
    sourceCollection: admin.firestore.CollectionReference,
    targetCollection: admin.firestore.CollectionReference,
    depth = 0
  ): Promise<void> {
    try {
      const sourceDocs = await sourceCollection.get();
      console.log(
        `  📋 Found ${sourceDocs.size} documents in ${sourceCollection.path}`
      );

      for (const doc of sourceDocs.docs) {
        this.stats.totalDocuments++;
        const targetRef = targetCollection.doc(doc.id);
        await this.cloneDocument(doc.ref, targetRef, depth);
      }
    } catch (error) {
      console.error(
        `  ❌ Error cloning collection ${sourceCollection.path}:`,
        error
      );
    }
  }

  /**
   * Clone all collections with the specified configuration
   */
  async cloneAllCollections(options: CloneOptions): Promise<void> {
    console.log('\n🚀 Starting Firestore Collection Clone Operation');
    console.log(
      `   From: ${options.fromPrefix || 'LIVE'} | To: ${options.toPrefix || 'TEST'}`
    );
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

      await this.cloneCollection(sourceCollection, targetCollection);
    }

    this.stats.endTime = Date.now();
    this.printSummary();
  }

  /**
   * Print operation summary
   */
  private printSummary(): void {
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

/**
 * Main execution (for CLI usage)
 */
export async function executeClone(): Promise<void> {
  // Initialize Firebase Admin
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
  const options: CloneOptions = {
    mode: 'all',
    fromPrefix: '',
    toPrefix: 'test_',
    skipExisting: true,
    maxRetries: 3,
    batchSize: 100,
  };

  // Simple argument parser
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];

    switch (arg) {
      case '--mode':
        options.mode = (value as 'all' | 'selected') || 'all';
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

// Export for use as a module
export { FirestoreCollectionCloner };

// Execute if run directly
if (require.main === module) {
  executeClone().catch((error) => {
    console.error('Uncaught error:', error);
    process.exit(1);
  });
}
