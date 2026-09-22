#!/usr/bin/env node

import { getAllCollectionNames } from '../utils/collectionResolver';
import { IS_TEST_DATABASE, DATABASE_MODE } from '../config/database';

console.log('\n📊 Database Configuration Status\n');
console.log('═'.repeat(50));
console.log(`Mode: ${DATABASE_MODE} ${IS_TEST_DATABASE ? '🧪 TEST' : '🚀 LIVE'}`);
console.log('═'.repeat(50));

const collections = getAllCollectionNames();

console.log('\n📋 Configured Collections:\n');
console.table(collections);

console.log('\n✅ Total Collections:', collections.length);
console.log('═'.repeat(50) + '\n');
