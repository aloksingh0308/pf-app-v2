#!/usr/bin/env node

/**
 * Verify Database Configuration
 * Lists all configured collections and current database mode
 */

const fs = require('fs');
const path = require('path');

// Read the config/database.ts file to extract collection names
const configPath = path.join(__dirname, '../config/database.ts');
const configContent = fs.readFileSync(configPath, 'utf8');

// Extract COLLECTION_NAMES object
const collectionsMatch = configContent.match(/export const COLLECTION_NAMES = \{([^}]+)\}/s);
if (!collectionsMatch) {
  console.error('❌ Could not find COLLECTION_NAMES in config/database.ts');
  process.exit(1);
}

// Parse collection names
const collectionsStr = collectionsMatch[1];
const collections = [];

const lines = collectionsStr.split('\n');
for (const line of lines) {
  const match = line.match(/(\w+):\s*['"]([^'"]+)['"]/);
  if (match) {
    const [, key, value] = match;
    collections.push({
      name: key,
      base: value,
      live: value,
      test: `test_${value}`
    });
  }
}

// Extract DATABASE_MODE
const modeMatch = configContent.match(/export const DATABASE_MODE.*?=\s*['"](\w+)['"]/);
const envMode = String(process.env.EXPO_PUBLIC_DATABASE_MODE || '').trim().toUpperCase();
const mode = envMode === 'LIVE' || envMode === 'TEST'
  ? envMode
  : (modeMatch ? modeMatch[1] : 'UNKNOWN');
const isTest = mode === 'TEST';

// Display results
console.log('\n📊 Database Configuration Status\n');
console.log('═'.repeat(70));
console.log(`Mode: ${mode} ${isTest ? '🧪 TEST MODE' : '🚀 LIVE MODE'}`);
console.log(`Is Test Database: ${isTest ? 'YES ✅' : 'NO'}`);
console.log('═'.repeat(70));

console.log('\n📋 Configured Collections:\n');
console.table(collections);

console.log('\n✅ Total Collections:', collections.length);
console.log('═'.repeat(70));

if (isTest) {
  console.log('\n⚠️  WARNING: System is in TEST mode');
  console.log('   All reads/writes will use test_* collections');
} else {
  console.log('\n✅ System is in LIVE mode');
  console.log('   Using production collections');
}

console.log('\n');
