# Firestore Collection Resolver - Migration Guide

This guide explains how to refactor existing Firestore queries to use the new collection resolver system.

## Quick Start

### Before (Hardcoded collection names)
```typescript
import { collection, doc, getDocs } from 'firebase/firestore';
import { db } from './firebase';

const usersRef = collection(db, 'customers');
const orderRef = doc(db, 'orders', orderId);
```

### After (Using collection resolver)
```typescript
import { collection, doc, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { getCollectionName } from '../utils/collectionResolver';
import { COLLECTION_NAMES } from '../config/database';

const usersRef = collection(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS));
const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId);
```

## Refactoring Patterns

### Pattern 1: Using `collection()` for queries
```typescript
// ❌ BEFORE
const snapshot = await getDocs(collection(db, 'orders'));

// ✅ AFTER
const snapshot = await getDocs(
  collection(db, getCollectionName(COLLECTION_NAMES.ORDERS))
);
```

### Pattern 2: Using `doc()` for direct references
```typescript
// ❌ BEFORE
const orderRef = doc(db, 'orders', orderId);
await getDoc(orderRef);

// ✅ AFTER
const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId);
await getDoc(orderRef);
```

### Pattern 3: Using `query()` with `where()` clauses
```typescript
// ❌ BEFORE
const q = query(
  collection(db, 'orders'),
  where('userId', '==', uid),
  orderBy('createdAt', 'desc')
);
const snapshot = await getDocs(q);

// ✅ AFTER
const q = query(
  collection(db, getCollectionName(COLLECTION_NAMES.ORDERS)),
  where('userId', '==', uid),
  orderBy('createdAt', 'desc')
);
const snapshot = await getDocs(q);
```

### Pattern 4: Subcollections (addresses, walletTransactions, etc.)
```typescript
// ❌ BEFORE
const addressesRef = collection(db, 'customers', userId, 'addresses');

// ✅ AFTER
const addressesRef = collection(
  db,
  getCollectionName(COLLECTION_NAMES.CUSTOMERS),
  userId,
  getSubcollectionName(SUBCOLLECTIONS.ADDRESSES)
);
```

### Pattern 5: Batch writes
```typescript
// ❌ BEFORE
const batch = writeBatch(db);
batch.set(doc(db, 'orders', orderId), orderData);
batch.set(doc(db, 'customers', customerId), customerData);
await batch.commit();

// ✅ AFTER
const batch = writeBatch(db);
batch.set(
  doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId),
  orderData
);
batch.set(
  doc(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS), customerId),
  customerData
);
await batch.commit();
```

### Pattern 6: Transactions
```typescript
// ❌ BEFORE
await runTransaction(db, async (transaction) => {
  const orderRef = doc(db, 'orders', orderId);
  const orderSnap = await transaction.get(orderRef);
  transaction.update(orderRef, { status: 'completed' });
});

// ✅ AFTER
await runTransaction(db, async (transaction) => {
  const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId);
  const orderSnap = await transaction.get(orderRef);
  transaction.update(orderRef, { status: 'completed' });
});
```

### Pattern 7: Real-time listeners (onSnapshot)
```typescript
// ❌ BEFORE
const unsubscribe = onSnapshot(
  collection(db, 'orders'),
  (snapshot) => {
    snapshot.forEach((doc) => {
      console.log(doc.data());
    });
  }
);

// ✅ AFTER
const unsubscribe = onSnapshot(
  collection(db, getCollectionName(COLLECTION_NAMES.ORDERS)),
  (snapshot) => {
    snapshot.forEach((doc) => {
      console.log(doc.data());
    });
  }
);
```

### Pattern 8: addDoc (auto-generate document ID)
```typescript
// ❌ BEFORE
await addDoc(collection(db, 'coupons'), couponData);

// ✅ AFTER
await addDoc(
  collection(db, getCollectionName(COLLECTION_NAMES.COUPONS)),
  couponData
);
```

### Pattern 9: setDoc (manual document ID)
```typescript
// ❌ BEFORE
await setDoc(doc(db, 'users', uid), userData);

// ✅ AFTER
await setDoc(
  doc(db, getCollectionName(COLLECTION_NAMES.USERS), uid),
  userData
);
```

### Pattern 10: updateDoc
```typescript
// ❌ BEFORE
await updateDoc(doc(db, 'orders', orderId), { status: 'completed' });

// ✅ AFTER
await updateDoc(
  doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId),
  { status: 'completed' }
);
```

### Pattern 11: deleteDoc
```typescript
// ❌ BEFORE
await deleteDoc(doc(db, 'orders', orderId));

// ✅ AFTER
await deleteDoc(
  doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId)
);
```

### Pattern 12: collectionGroup (cross-collection queries)
```typescript
// ❌ BEFORE
const q = query(collectionGroup(db, 'addresses'));

// ✅ AFTER
const q = query(
  collectionGroup(db, getSubcollectionName(SUBCOLLECTIONS.ADDRESSES))
);
```

## File-by-File Refactoring Guide

### Priority Order (refactor in this order)
1. **Core Services** (most used)
   - `services/orderService.ts`
   - `services/userService.ts`
   - `services/menuService.ts`
   - `services/addressService.ts`

2. **Delivery Services**
   - `delivery/services/deliveryApi.ts`
   - `delivery/services/liveLocationService.ts`

3. **Admin/Dashboard**
   - `screens/manager/dashboard.tsx`

4. **User Screens**
   - `screens/user/track-order.tsx`
   - `screens/user/restaurant-details.tsx`
   - `screens/user/checkout.tsx`

5. **Other Services** (less frequently used)
   - `services/couponService.ts`
   - `services/restaurantService.ts`
   - `services/addonsService.ts`
   - `services/offerNotificationService.ts`
   - `services/appUpdateService.ts`

### Checklist Template
```typescript
// ✅ Add imports at top of file
import { getCollectionName, getSubcollectionName } from '../utils/collectionResolver';
import { COLLECTION_NAMES, SUBCOLLECTIONS } from '../config/database';

// ✅ Replace all collection(..., 'collectionName') with collection(..., getCollectionName(COLLECTION_NAMES.COLLECTION_NAME))
// ✅ Replace all doc(..., 'collectionName', ...) with doc(..., getCollectionName(COLLECTION_NAMES.COLLECTION_NAME), ...)
// ✅ Replace all subcollection references with getSubcollectionName(SUBCOLLECTIONS.SUBCOLLECTION_NAME)
// ✅ Test both LIVE and TEST modes
```

## Configuration Files to Update

### package.json - Add script for cloning collections
```json
{
  "scripts": {
    "clone:collections": "ts-node scripts/cloneCollections.ts --mode all --from live --to test",
    "clone:collections:selective": "ts-node scripts/cloneCollections.ts --collections customers,orders,menuItems",
    "clone:collections:overwrite": "ts-node scripts/cloneCollections.ts --mode all --overwrite"
  }
}
```

## Testing the Configuration

### 1. Verify Configuration Works
```typescript
import { getCollectionName, COLLECTION_NAMES, IS_TEST_DATABASE } from './config/database';

console.log(IS_TEST_DATABASE); // true or false
console.log(getCollectionName(COLLECTION_NAMES.CUSTOMERS)); // 'customers' or 'test_customers'
```

### 2. Test Mode Switching
- Change `DATABASE_MODE` in `config/database.ts` from 'LIVE' to 'TEST'
- Rebuild the app
- Verify all reads/writes target `test_*` collections
- Switch back to 'LIVE'

### 3. Verify Badge Display (admin pages)
```typescript
import { TestDatabaseBadge } from '../components/TestDatabaseBadge';

export const AdminDashboard = () => {
  return (
    <>
      <TestDatabaseBadge position="fixed" />
      {/* Rest of admin UI */}
    </>
  );
};
```

## Safety Checklist

- [ ] All collection references use `getCollectionName()` or hardcoded test collection names
- [ ] No hardcoded collection names in new code (except in `config/database.ts`)
- [ ] Test mode collections have `test_` prefix in Firestore
- [ ] Tested reading from both LIVE and TEST modes
- [ ] Tested writing to both modes (only targets correct database)
- [ ] Admin badge displays when DATABASE_MODE is TEST
- [ ] Production code runs against LIVE collections
- [ ] Test scripts/workflows run against TEST collections

## Switching Between Modes

**For Development/Testing:**
```typescript
// In config/database.ts
export const DATABASE_MODE: DatabaseMode = 'TEST';
```

**For Production:**
```typescript
// In config/database.ts
export const DATABASE_MODE: DatabaseMode = 'LIVE';
```

Then rebuild the entire app (the value is baked into the bundle at build time).

---

**Questions?** Check the original prompt in the conversation or review the implementation files.
