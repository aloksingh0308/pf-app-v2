# Firebase Authentication & User Profile Implementation

## Overview
This document describes the Firebase authentication flow implemented in the Hungry's Bucket Cafe mobile application.

## Features Implemented

### 1. **Email/Password Authentication**
- Users can register with email, password, and profile information
- Users can login with email and password
- Passwords are securely stored in Firebase Authentication
- Session management with auto-logout capability

### 2. **User Profile Creation**
- User profiles are stored in Firestore database
- Profile includes:
  - Full Name
  - Email Address
  - Phone Number
  - Location (optional)
  - Address (optional)
  - Account creation date
  - User ID (UID)

### 3. **State Management**
- Redux store manages authentication state
- Auth state includes:
  - Current user profile
  - Authentication status
  - Loading state
  - Error messages

### 4. **Navigation Flow**
```
Splash Screen (2 seconds)
    ↓
Login Screen (if not authenticated)
    ├→ Sign Up Screen (create new account)
    └→ Home/Tabs Screen (if authenticated)
```

## File Structure

```
/store/slices/
  ├── authSlice.ts          # Redux auth state management
  └── cartSlice.ts          # Existing cart state

/services/
  ├── authService.ts        # Firebase auth operations
  └── userService.ts        # Firestore user profile operations

/app/
  ├── login.tsx             # Login screen
  ├── signup.tsx            # Registration & profile creation
  ├── splash.tsx            # Splash screen
  └── (tabs)/
      └── profile.tsx       # User profile display & logout
```

## Usage

### Login
```typescript
// User enters email and password
const firebaseUser = await authService.loginUser(email, password);
const userProfile = await userService.getUserProfile(firebaseUser.uid);
dispatch(setUser(userProfile));
```

### Sign Up
```typescript
// 1. Create Firebase Auth user
const firebaseUser = await authService.registerUser(email, password);

// 2. Create Firestore user profile
const userProfile = await userService.createUserProfile(firebaseUser.uid, {
  email,
  name,
  phoneNumber,
  location,
  address,
  createdAt: new Date().toISOString(),
});

// 3. Save to Redux
dispatch(setUser(userProfile));
```

### Logout
```typescript
await authService.logoutUser();
dispatch(logout());
```

## Validation Rules

### Email
- Must be a valid email format (user@example.com)
- Must not already exist in database

### Phone Number
- Must be 10 digits (format: XXXXXXXXXX)

### Password
- Minimum 6 characters
- Must match confirmation password during signup

### Name
- Required field
- Cannot be empty or whitespace only

## Firebase Firestore Structure

Users are stored in the `users` collection with the following structure:

```json
{
  "uid": "user-id-from-firebase-auth",
  "email": "user@example.com",
  "name": "John Doe",
  "phoneNumber": "1234567890",
  "location": "New York",
  "address": "123 Main St, New York, NY 10001",
  "createdAt": "2026-02-19T10:30:00.000Z"
}
```

## Auth State Management

### Store Structure
```typescript
interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}
```

### Available Actions
- `setUser(userProfile)` - Set authenticated user
- `setLoading(boolean)` - Set loading state
- `setError(errorMessage)` - Set error message
- `logout()` - Clear auth state
- `clearError()` - Clear error message

## Error Handling

The app handles the following Firebase Auth errors:

| Error Code | Message |
|-----------|---------|
| `auth/user-not-found` | User not found |
| `auth/wrong-password` | Incorrect password |
| `auth/email-already-in-use` | Email is already in use |
| `auth/weak-password` | Password is too weak |

## Security Features

1. **Password Security**: Passwords are never stored in Redux or Firestore
2. **Firebase Rules**: Firestore rules should be configured to:
   - Allow users to read their own profile
   - Allow users to update their own profile
   - Prevent users from accessing other users' data
3. **Auth State Persistence**: Firebase automatically restores auth state on app restart

## Testing the Implementation

### 1. Create an Account
- Navigate to Sign Up screen
- Enter valid email, name, and phone number
- Set password (min 6 characters)
- Confirm password
- Click "Create Account"
- Should navigate to home screen automatically

### 2. Login
- Enter registered email and password
- Click "Login"
- Should navigate to home screen if credentials are correct

### 3. View Profile
- Navigate to Profile tab
- Should display user information from Firestore
- All fields should match what was entered during signup

### 4. Logout
- Click "Logout" button on profile screen
- Confirm logout action
- Should navigate back to login screen

## Firestore Security Rules

Recommended security rules for the users collection:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

## Future Enhancements

1. **Profile Picture Upload**
   - Store profile images in Firebase Storage
   - Update userService.ts with image upload functionality

2. **Email Verification**
   - Use Firebase sendSignInLinkToEmail() for verification
   - Verify user email before allowing access to app

3. **Social Authentication**
   - Add Google Sign-In
   - Add Facebook Sign-In
   - Share profile data across social accounts

4. **Password Reset**
   - Implement sendPasswordResetEmail() functionality
   - Create password reset flow screen

5. **Profile Updates**
   - Allow users to edit their profile information
   - Update address book
   - Change password

6. **Two-Factor Authentication**
   - Add phone number verification (SMS OTP)
   - Enhanced security for sensitive operations

## Dependencies

- `firebase` - Firebase SDK
- `react-redux` & `@reduxjs/toolkit` - State management
- `expo-router` - Navigation
- `styled-components/native` - Styling

## Environment Setup

1. Firebase configuration is in `utils/firebase-config.ts`
2. Ensure Firebase project has:
   - Authentication enabled (Email/Password)
   - Firestore database created
   - Appropriate security rules configured

For any issues or questions, refer to Firebase documentation:
- https://firebase.google.com/docs/auth
- https://firebase.google.com/docs/firestore
