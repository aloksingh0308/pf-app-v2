import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState, TouchableOpacity } from 'react-native';
import 'react-native-reanimated';

import AppAlertProvider from '@/components/AppAlertProvider';
import AppStatusProvider from '@/components/AppStatusProvider';
import GlobalLoader from '@/components/GlobalLoader';
import { useColorScheme } from '@/hooks/useColorScheme';
import { authService } from '@/services/authService';
import { notificationService } from '@/services/notificationService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { storageService } from '@/services/storageService';
import { userService } from '@/services/userService';
import { AppDispatch, RootState, store } from '@/store';
import { logout, setUser } from '@/store/slices/authSlice';
import { Settings } from 'react-native-fbsdk-next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider, useDispatch, useSelector } from 'react-redux';
import SplashScreen from './splash';

function RootLayoutContent() {
  useColorScheme();
  const [loaded, fontError] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [isFontLoadTimedOut, setIsFontLoadTimedOut] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSplashDelayDone, setIsSplashDelayDone] = useState(false);
  const pushTokenSyncedForUidRef = useRef<string | null>(null);
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useSelector((state: RootState) => state.auth);
  const isAppShellReady = loaded || Boolean(fontError) || isFontLoadTimedOut;
  const pathname = usePathname();
  // Read via ref inside the auth-redirect effect below so that effect keeps
  // firing only on auth-state changes, not on every navigation — otherwise an
  // authenticated user gets force-redirected to the home tab on every route
  // change (e.g. Edit Profile bouncing straight back to Home).
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const touchableDefaults = (TouchableOpacity as any).defaultProps || {};
    (TouchableOpacity as any).defaultProps = {
      ...touchableDefaults,
      activeOpacity: 0.7,
    };
  }, []);

  useEffect(() => {
    const fbAppId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;
    const fbClientToken = process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN;

    if (!fbAppId || !fbClientToken) {
      console.log('Facebook SDK config missing EXPO_PUBLIC_FACEBOOK_APP_ID or EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN');
      return;
    }

    try {
      Settings.setAppID(fbAppId);
      Settings.setClientToken(fbClientToken);
      Settings.initializeSDK();
    } catch (error) {
      console.log('Facebook SDK initialization failed:', error);
    }
  }, []);

  useEffect(() => {
    if (loaded || fontError) {
      return;
    }

    const timeout = setTimeout(() => {
      setIsFontLoadTimedOut(true);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [fontError, loaded]);

  useEffect(() => {
    if (!isAppShellReady) {
      return;
    }

    const timer = setTimeout(() => {
      setIsSplashDelayDone(true);
    }, 5000);

    return () => clearTimeout(timer);
  }, [isAppShellReady]);

  useEffect(() => {
    // Force a fresh GPS fix on every app open (not just whenever the 6h
    // cache happens to expire) so address/map/checkout screens all start
    // from the user's real current position instead of a stale one.
    void warmupUserLocationCache({ dispatch, forceRefresh: true })
      .then(() => hydrateCachedLocationAddress({ dispatch }))
      .catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    // Also refresh when the app returns to the foreground — the device may
    // have moved while backgrounded, and this is the point users think of
    // as "opening the app" just as much as a cold launch.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void warmupUserLocationCache({ dispatch, forceRefresh: true })
          .then(() => hydrateCachedLocationAddress({ dispatch }))
          .catch(() => {});
      }
    });

    return () => subscription.remove();
  }, [dispatch]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    const checkAuthState = async () => {
      try {
        const cachedProfile = await storageService.getUserProfile();

        unsubscribe = authService.onAuthStateChange(async (firebaseUser) => {
          try {
            if (firebaseUser) {
              const userProfile = await userService.getUserProfile(firebaseUser.uid, firebaseUser.email);
              if (userProfile) {
                if (userProfile.isDisabled) {
                  await authService.logoutUser();
                  await storageService.clearUserData();
                  dispatch(logout());
                } else {
                  dispatch(setUser(userProfile));
                  await storageService.saveUserProfile(userProfile);
                }
              } else if (cachedProfile && cachedProfile.uid === firebaseUser.uid && !cachedProfile.isDisabled) {
                dispatch(setUser(cachedProfile));
              } else {
                await storageService.clearUserData();
                dispatch(logout());
              }
            } else {
              await storageService.clearUserData();
              dispatch(logout());
            }
          } catch (error) {
            console.log('Error resolving auth state:', error);
            if (firebaseUser && cachedProfile && cachedProfile.uid === firebaseUser.uid && !cachedProfile.isDisabled) {
              dispatch(setUser(cachedProfile));
            } else {
              dispatch(logout());
            }
          } finally {
            if (mounted) {
              setIsCheckingAuth(false);
            }
          }
        });
      } catch (error) {
        console.log('Error checking auth state:', error);
        if (mounted) {
          setIsCheckingAuth(false);
        }
      }
    };

    checkAuthState();

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [dispatch]);

  useEffect(() => {
    if (!isAuthenticated || !user?.uid) {
      return;
    }

    if (pushTokenSyncedForUidRef.current === user.uid) {
      return;
    }

    let mounted = true;

    const syncPushToken = async () => {
      try {
        const tokenData = await notificationService.registerForPushNotificationsAsync();
        if (!mounted || !tokenData) {
          pushTokenSyncedForUidRef.current = user.uid;
          return;
        }

        const shouldUpdateToken =
          user.pushToken !== tokenData.token || user.pushTokenType !== tokenData.tokenType;

        if (!shouldUpdateToken) {
          pushTokenSyncedForUidRef.current = user.uid;
          return;
        }

        const tokenUpdate = {
          pushToken: tokenData.token,
          pushTokenType: tokenData.tokenType,
          pushTokenUpdatedAt: new Date().toISOString(),
        };

        await userService.updateUserProfile(user.uid, tokenUpdate);
        await storageService.updateUserProfile(tokenUpdate);
        pushTokenSyncedForUidRef.current = user.uid;
      } catch (error) {
        console.log('Push token sync failed:', error);
      }
    };

    syncPushToken();

    userService.processPendingReferralRewardsForUser(user.uid).catch((error) => {
      console.log('Referral reward startup sync failed:', error);
    });

    const receiveSub = notificationService.addForegroundNotificationListener(() => {
      // Foreground notification received - app can handle custom UX here if needed
    });

    const handleNotificationRoute = (orderId?: string) => {
      const normalizedOrderId = String(orderId || '').trim();
      if (!normalizedOrderId) {
        return;
      }

      router.push({
        pathname: '/user/track-order',
        params: { orderId: normalizedOrderId },
      } as never);
    };

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const orderId = response?.notification?.request?.content?.data?.orderId as string | undefined;
      handleNotificationRoute(orderId);
    }).catch(() => {});

    const responseSub = notificationService.addNotificationResponseListener((response) => {
      const orderId = response.notification.request.content.data?.orderId as string | undefined;
      handleNotificationRoute(orderId);
    });

    return () => {
      mounted = false;
      receiveSub.remove();
      responseSub.remove();
    };
  }, [isAuthenticated, user?.uid, user?.role]);

  useEffect(() => {
    if (!isCheckingAuth && isSplashDelayDone) {
      if (isAuthenticated) {
        if (!user?.uid) {
          dispatch(logout());
          router.replace('/login');
          return;
        }

        router.replace('/(tabs)' as never);
      } else if (pathnameRef.current !== '/complete-profile') {
        // A verified phone-auth user with no Firestore profile yet lands here
        // with isAuthenticated=false (see the onAuthStateChange handler below)
        // while they fill in their profile — don't bounce them to /login.
        router.replace('/login');
      }
    }
    // pathname is intentionally read via ref, not as a dependency — this effect
    // must only fire on auth-state changes, not on every navigation, or an
    // authenticated user gets force-redirected to the home tab on every route
    // change (e.g. Edit Profile bouncing straight back to Home).
  }, [dispatch, isAuthenticated, isCheckingAuth, isSplashDelayDone, user?.role, user?.uid]);

  if (!isAppShellReady) {
    return <SplashScreen />;
  }


  if (!isSplashDelayDone || isCheckingAuth) {
    return <SplashScreen />;
  }

  return (
    <AppStatusProvider>
      <AppAlertProvider>
          <Stack key={isAuthenticated ? `auth-${user?.uid || user?.role || 'user'}` : 'guest'} screenOptions={{ headerShown: false }}>
            <Stack.Screen name="splash" />
            <Stack.Screen name="login" />
            <Stack.Screen name="complete-profile" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="order-success" />
            <Stack.Screen name="user/cart" />
            <Stack.Screen name="user/checkout" />
            <Stack.Screen name="user/deals" />
            <Stack.Screen name="user/edit-profile" />
            <Stack.Screen name="user/location-detials" />
            <Stack.Screen name="user/order-success" />
            <Stack.Screen name="user/privacy-policy" />
            <Stack.Screen name="user/product-details" />
            <Stack.Screen name="user/profile" />
            <Stack.Screen name="user/rewards" />
            <Stack.Screen name="user/restaurant-details" />
            <Stack.Screen name="user/support" />
            <Stack.Screen name="user/terms-and-conditions" />
            <Stack.Screen name="user/tic-tac-toe" />
            <Stack.Screen name="user/track-order" />
            <Stack.Screen name="user/wallet-history" />
            <Stack.Screen name="+not-found" />
          </Stack>
        </AppAlertProvider>
      <GlobalLoader />
    </AppStatusProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <RootLayoutContent />
        <StatusBar style="dark" translucent />
      </Provider>
    </SafeAreaProvider>
  );
}
