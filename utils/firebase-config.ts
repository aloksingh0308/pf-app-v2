
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from "firebase/app";
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

export const firebaseConfig = {
  apiKey: "AIzaSyCExt08hWTZk4diqZ4Md2aoYqA2JDO_H-k",
  authDomain: "hungry-s-bucket.firebaseapp.com",
  projectId: "hungry-s-bucket",
  storageBucket: "hungry-s-bucket.firebasestorage.app",
  messagingSenderId: "871571419878",
  appId: "1:871571419878:web:02571c8dc33d3169c78127",
  measurementId: "G-1DNDWCFH6Z"
};

const app = initializeApp(firebaseConfig);

let authInstance: FirebaseAuth.Auth;

const getReactNativePersistence = (FirebaseAuth as any).getReactNativePersistence as
  | ((storage: typeof AsyncStorage) => any)
  | undefined;

try {
  if (typeof getReactNativePersistence === 'function') {
    authInstance = FirebaseAuth.initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    authInstance = FirebaseAuth.getAuth(app);
  }
} catch {
  authInstance = FirebaseAuth.getAuth(app);
}

export const auth = authInstance;
let firestoreInstance;

try {
  firestoreInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
} catch {
  firestoreInstance = getFirestore(app);
}

export const db = firestoreInstance;
export const storage = getStorage(app);
export const functions = getFunctions(app, "asia-south1");
