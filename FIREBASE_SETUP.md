# Firebase Auth Setup Guide

## Quick Start

### 1. **Firestore Security Rules**
Add these rules to your Firebase Firestore to allow users to access their own profiles:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      // Users can read and write their own documents
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

### 2. **Enable Authentication Method**
In Firebase Console:
1. Go to Authentication > Sign-in method
2. Enable "Email/Password" provider
3. Save

### 3. **Initialize Firestore Database**
In Firebase Console:
1. Go to Firestore Database
2. Click "Create Database"
3. Start in production mode
4. Choose your location
5. Apply the security rules above

### 4. **Test the Implementation**

#### Sign Up:
1. Launch the app
2. Tap "Sign Up" on login screen
3. Enter details:
   - Full Name: John Doe
   - Email: john@example.com
   - Phone: 9876543210
   - Password: Test@123
4. Should navigate to home and create user in Firestore

#### Login:
1. Go back to login screen
2. Enter same email and password
3. Should load user profile from Firestore

#### Profile:
1. Navigate to Profile tab
2. Should see all user information
3. Tap Logout to sign out

## File Changes Summary

### New Files Created:
- `store/slices/authSlice.ts` - Redux authentication state
- `services/authService.ts` - Firebase auth functions
- `services/userService.ts` - Firestore user profile functions
- `app/signup.tsx` - Sign up screen with profile creation

### Modified Files:
- `app/_layout.tsx` - Auth state checking and navigation flow
- `app/login.tsx` - Updated to use Firebase auth
- `app/(tabs)/profile.tsx` - Display user info and logout
- `store/index.ts` - Added auth reducer

## User Data Structure in Firestore

Users collection stores documents like:
```json
{
  "uid": "user_id_from_firebase",
  "email": "user@example.com",
  "name": "John Doe",
  "phoneNumber": "9876543210",
  "location": "New York",
  "address": "123 Main St",
  "createdAt": "2026-02-19T10:30:00.000Z"
}
```

## Available Functions

### authService
- `registerUser(email, password)` - Create new auth account
- `loginUser(email, password)` - Login to account
- `logoutUser()` - Logout current user
- `onAuthStateChange(callback)` - Listen to auth changes
- `getCurrentUser()` - Get current Firebase user
- `updateUserPassword(newPassword)` - Update password

### userService
- `createUserProfile(uid, profileData)` - Save profile to Firestore
- `getUserProfile(uid)` - Get profile from Firestore
- `updateUserProfile(uid, updates)` - Update profile
- `checkEmailExists(email)` - Check if email is registered
- `checkPhoneExists(phoneNumber)` - Check if phone is registered

## Validation

### Email
- Must match: user@example.com format
- Must not already exist in database

### Phone
- Must be exactly 10 digits

### Password
- Minimum 6 characters
- Must match confirmation on signup

### Name
- Required, cannot be empty

## Next Steps (Optional Features)

1. **Profile Picture Upload**
   - Use Firebase Storage
   - Store URL in user profile

2. **Email Verification**
   - Send verification email on signup
   - Require verification before using app

3. **Google/Facebook Sign-In**
   - Add social authentication
   - Link social profile to account

4. **Password Reset**
   - Send password reset email
   - Allow users to reset forgotten passwords

5. **Profile Editing**
   - Allow users to edit their information
   - Update address and location

## Common Issues & Solutions

### Issue: "User not found" error
**Solution**: Make sure user has signed up first via signup screen

### Issue: Firestore rules blocking access
**Solution**: Update security rules to match snippet above

### Issue: User data not loading
**Solution**: Check Firestore has users collection and correct document structure

### Issue: Navigation stuck on splash screen
**Solution**: Check auth state is being initialized in _layout.tsx

## Environment Variables

Firebase config is already set in `utils/firebase-config.ts`. If you need to change it:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

## App Update Configuration (Android)

This app reads Android update settings from Firestore. The service checks the following document paths:

- `app_updates/android`
- `app_settings/android`

Example document structure:

```json
{
  "latestVersion": "1.0.2",
  "minRequiredVersion": "1.0.1",
  "forceUpdate": false,
  "storeUrl": "https://play.google.com/store/apps/details?id=com.alok0308.praygagifoodwala",
  "title": "Update Available",
  "message": "A newer version of Prayagi FoodWala is available. Please update to enjoy the latest features and fixes."
}
```

> Note: Firestore collections are created automatically when the first document is added.
> If `app_updates` does not exist yet, create a document at `app_updates/android` manually in the Firebase Console.
>
> Manual creation steps:
> 1. Open Firebase Console > Firestore Database.
> 2. Click `Start collection`.
> 3. Enter `app_updates` as the collection ID.
> 4. Add a document with ID `android`.
> 5. Paste the example JSON fields into the document.
>
- `latestVersion`: the version shown to users when an update exists.
- `minRequiredVersion`: the minimum version allowed before forcing an update.
- `forceUpdate`: if `true`, the popup stays until the user updates.
- `storeUrl`: optional Play Store link used by the update button.
- `title` / `message`: optional text for the update modal.

## Support Resources

- [Firebase Auth Docs](https://firebase.google.com/docs/auth)
- [Firestore Docs](https://firebase.google.com/docs/firestore)
- [React Native Firebase](https://rnfirebase.io/)

## Push Notifications (FCM - Android Focus)

### 1) Firebase Cloud Messaging Setup
1. Open Firebase Console > Project Settings > Cloud Messaging.
2. Ensure Firebase Cloud Messaging API is enabled.
3. For Android app package `com.alok0308.praygagifoodwala`, download `google-services.json`.
4. Put `google-services.json` in project root.

### 2) iOS (Optional but Supported)
1. Add your iOS app in Firebase.
2. Download `GoogleService-Info.plist`.
3. Put `GoogleService-Info.plist` in project root.
4. Configure APNs key/cert in Firebase for production delivery.

### 3) App Integration Notes
- App uses `expo-notifications` to request permission and fetch device push token.
- On login/authenticated startup, token is saved to Firestore user document:
   - `pushToken`
   - `pushTokenType` (typically `fcm` on Android)
   - `pushTokenUpdatedAt`

### 4) Sending Notifications
- App sends notifications through the deployed backend notification API.
- Configure app env variable:
  - `EXPO_PUBLIC_NOTIFICATION_BROADCAST_ENDPOINT=https://asia-south1-hungry-s-bucket.cloudfunctions.net`
- API endpoints used by app services:
  - `POST /api/send-notification`
  - `POST /api/send-bulk-notification`
- Include `data.orderId` in payload to deep-link customer to order details on tap.

Example single-send payload:

```json
{
   "fcmToken": "FCM_DEVICE_TOKEN",
   "title": "Order Update",
   "body": "Your order is out for delivery",
   "data": {
      "orderId": "YOUR_ORDER_DOC_ID"
   }
}
```

Example bulk-send payload:

```json
{
   "fcmTokens": ["FCM_TOKEN_1", "FCM_TOKEN_2"],
   "title": "Offer Alert",
   "body": "Flat discount available now",
   "data": {
      "screen": "offers"
   }
}
```
