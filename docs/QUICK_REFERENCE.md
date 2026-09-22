# Dual Database Configuration - Quick Reference

## 🎯 One-Minute Summary

```typescript
// 1. Import in any service
import { getCollectionName } from '@/utils/collectionResolver';
import { COLLECTION_NAMES } from '@/config/database';

// 2. Use instead of hardcoded names
collection(db, getCollectionName(COLLECTION_NAMES.ORDERS))
doc(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS), userId)

// 3. Change database mode in one place
// config/database.ts
export const DATABASE_MODE: DatabaseMode = 'TEST'; // or 'LIVE'
```

That's it! Everything else is automatic.

---

## 📊 Collection Mapping

| Base Collection | LIVE Mode | TEST Mode | Status |
|---|---|---|---|
| customers | customers | test_customers | ✅ 3 services done |
| orders | orders | test_orders | ✅ 3 services done |
| restaurants | restaurants | test_restaurants | ⏳ |
| menuItems | menuItems | test_menuItems | ⏳ |
| categoris | categoris | test_categoris | ✅ 1 service done |
| coupons | coupons | test_coupons | ✅ 1 service done |
| users | users | test_users | ✅ 1 service done |
| orderTracking | orderTracking | test_orderTracking | ✅ 2 services done |
| app_updates | app_updates | test_app_updates | ⏳ |
| notificationBroadcasts | notificationBroadcasts | test_notificationBroadcasts | ⏳ |
| orderCounters | orderCounters | test_orderCounters | ✅ 1 service done |
| deliveryPartners | deliveryPartners | test_deliveryPartners | ⏳ |
| offers | offers | test_offers | ⏳ |
| inventory | inventory | test_inventory | ⏳ |
| addons | addons | test_addons | ⏳ |
| rewardDeals | rewardDeals | test_rewardDeals | ⏳ |
| deals_menu | deals_menu | test_deals_menu | ⏳ |
| deals_offers | deals_offers | test_deals_offers | ⏳ |
| employees | employees | test_employees | ⏳ |
| notifications | notifications | test_notifications | ⏳ |

---

## 🔗 Subcollections

| Parent/Path | Subcollection | Status |
|---|---|---|
| customers/{uid}/addresses | addresses | ✅ addressService done |
| customers/{uid}/walletTransactions | walletTransactions | ✅ userService done |
| deliveryPartners/{uid}/liveLocation | liveLocation | ⏳ |

---

## ✅ Services Refactored (7/23)

### Phase 1 - Critical (COMPLETED)
- ✅ `services/orderService.ts` - 5 refs
- ✅ `services/userService.ts` - 9 refs  
- ✅ `services/addressService.ts` - 5 refs
- ✅ `delivery/services/deliveryApi.ts` - 7 refs
- ✅ `delivery/services/liveLocationService.ts` - 3 refs
- ✅ `services/couponService.ts` - 1 ref
- ✅ `screens/user/track-order.tsx` - 3 refs

### Phase 2 - High Priority (TO DO)
- ⏳ `screens/user/restaurant-details.tsx` - 2 refs
- ⏳ `screens/user/checkout.tsx` - 2 refs
- ⏳ `screens/manager/dashboard.tsx` - 2 refs
- ⏳ `services/menuService.ts` - 1 ref
- ⏳ `services/restaurantService.ts` - 1 ref
- ⏳ `services/addonsService.ts` - 1 ref

### Phase 3 - Medium Priority (TO DO)
- ⏳ `services/offerNotificationService.ts` - 2 refs
- ⏳ `services/appUpdateService.ts` - 1 ref
- ⏳ `app/(tabs)/orders.tsx` - 2 refs
- ⏳ `app/home.tsx` - 5 refs
- ⏳ `app/(tabs)/order/[id].tsx` - 1 ref

### Phase 4 - Low Priority (TO DO)
- ⏳ `screens/user/wallet-history.tsx` - 1 ref
- ⏳ `delivery/services/deliveryAuthService.ts` - 1 ref
- ⏳ Admin/POS system files

---

## 📝 Copy-Paste Refactoring Template

For any service file:

```typescript
// 1. Add to imports
import { getCollectionName, getSubcollectionName } from '@/utils/collectionResolver';
import { COLLECTION_NAMES, SUBCOLLECTIONS } from '@/config/database';

// 2. Replace patterns
// ❌ collection(db, 'orders')
// ✅ collection(db, getCollectionName(COLLECTION_NAMES.ORDERS))

// ❌ doc(db, 'customers', userId)
// ✅ doc(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS), userId)

// ❌ collection(db, 'customers', uid, 'addresses')
// ✅ collection(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS), uid, getSubcollectionName(SUBCOLLECTIONS.ADDRESSES))
```

---

## 🔧 Configuration Files

| File | Purpose |
|---|---|
| `config/database.ts` | 🎯 Single source of truth (DATABASE_MODE) |
| `utils/collectionResolver.ts` | 🔧 Helper functions |
| `scripts/cloneCollections.ts` | 📋 Admin utility for copying collections |
| `components/TestDatabaseBadge.tsx` | ⚠️ Visual indicator badge |
| `docs/DATABASE_MIGRATION_GUIDE.md` | 📖 Detailed refactoring guide |
| `docs/DUAL_DATABASE_SETUP.md` | 📚 Full setup guide |

---

## 🚀 5-Minute Setup

```bash
# 1. Collections already configured ✓
# 2. Resolver utility ready ✓
# 3. Clone script prepared ✓

# To use in your app:
npm run clone:collections  # Copy LIVE → TEST

# Switch to TEST mode
# Edit: config/database.ts → DATABASE_MODE = 'TEST'
npm run build

# Run & verify TEST badge appears
# Verify reads/writes use test_* collections

# Switch back to LIVE
# Edit: config/database.ts → DATABASE_MODE = 'LIVE'
npm run build
```

---

## 🎓 Refactoring Checklist (Per Service)

- [ ] Add imports: `getCollectionName`, `COLLECTION_NAMES`
- [ ] Add imports: `getSubcollectionName`, `SUBCOLLECTIONS` (if using subcollections)
- [ ] Find all `collection(db, 'name')` → Replace with `getCollectionName()`
- [ ] Find all `doc(db, 'name',` → Replace with `getCollectionName()`
- [ ] Find all subcollection paths → Replace with `getSubcollectionName()`
- [ ] No hardcoded collection names remain
- [ ] Test in both LIVE and TEST modes
- [ ] Commit with message: `refactor: use collection resolver for [service]`

---

## ⚡ Common Patterns Quick Fix

### Pattern 1: Simple Query
```typescript
// Before
const snap = await getDocs(collection(db, 'customers'));

// After
const snap = await getDocs(collection(db, getCollectionName(COLLECTION_NAMES.CUSTOMERS)));
```

### Pattern 2: Query with Where
```typescript
// Before
const q = query(collection(db, 'orders'), where('status', '==', 'pending'));

// After
const q = query(
  collection(db, getCollectionName(COLLECTION_NAMES.ORDERS)),
  where('status', '==', 'pending')
);
```

### Pattern 3: Doc Reference
```typescript
// Before
const orderRef = doc(db, 'orders', orderId);

// After
const orderRef = doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId);
```

### Pattern 4: Subcollection
```typescript
// Before
const addressesRef = collection(db, 'customers', userId, 'addresses');

// After
const addressesRef = collection(
  db,
  getCollectionName(COLLECTION_NAMES.CUSTOMERS),
  userId,
  getSubcollectionName(SUBCOLLECTIONS.ADDRESSES)
);
```

### Pattern 5: Batch Write
```typescript
// Before
batch.set(doc(db, 'orders', orderId), data);

// After
batch.set(
  doc(db, getCollectionName(COLLECTION_NAMES.ORDERS), orderId),
  data
);
```

---

## 🎯 What's Protected

✅ **Production Isolation**: TEST mode never touches production collections  
✅ **Single Config Point**: Change DATABASE_MODE once, entire app switches  
✅ **Type Safe**: TypeScript ensures correct collection names  
✅ **Backward Compatible**: Existing code still works during transition  
✅ **Admin Safety**: TEST badge prevents accidental wrong-mode usage  
✅ **Cloning Support**: Script copies data between modes automatically  

---

## 🚨 What NOT to Do

❌ Hardcode collection names in new code  
❌ Use strings directly in `collection()` or `doc()`  
❌ Mix LIVE and TEST queries in one operation  
❌ Forget to add imports at top of files  
❌ Deploy without testing both modes  

---

**Need help?** See full docs in `docs/DATABASE_MIGRATION_GUIDE.md` or `docs/DUAL_DATABASE_SETUP.md`
