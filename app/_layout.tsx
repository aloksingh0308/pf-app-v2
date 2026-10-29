import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, TouchableOpacity } from 'react-native';
import 'react-native-reanimated';

import AppAlertProvider from '@/components/AppAlertProvider';
import AppStatusProvider from '@/components/AppStatusProvider';
import ConnectivityGate from '@/components/ConnectivityGate';
import GlobalLoader from '@/components/GlobalLoader';
import { useColorScheme } from '@/hooks/useColorScheme';
import { analyticsService } from '@/services/analytics';
import { authService } from '@/services/authService';
import { notificationService } from '@/services/notificationService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { storageService } from '@/services/storageService';
import { userService } from '@/services/userService';
import { showAlert } from '@/services/alertService';
import { getRestaurants } from '@/services/restaurantService';
import { clearPendingReferralCode, getPendingReferralCode, onPendingLinkChange, takePendingRestaurant } from '@/utils/deepLinks';
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
  // A verified phone session whose profile has no name yet (brand-new customer, or the app
  // was closed mid sign-up). Such a user is NOT signed in yet — they're sent to
  // /complete-profile, which signs them in once the profile is saved.
  const [incompleteSession, setIncompleteSession] = useState<{ uid: string; phone: string; email: string } | null>(null);
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
    analyticsService.screen(pathname);
  }, [pathname]);

  useEffect(() => {
    analyticsService.setUser(isAuthenticated && user?.uid ? user.uid : null);
  }, [isAuthenticated, user?.uid]);

  useEffect(() => {
    // Uncaught JS errors → GA (event app_exception), then the default handler as before.
    const errorUtils = (global as any).ErrorUtils;
    const previous = errorUtils?.getGlobalHandler?.();
    if (!errorUtils?.setGlobalHandler) return;
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      analyticsService.exception(error, Boolean(isFatal));
      previous?.(error, isFatal);
    });
    return () => errorUtils.setGlobalHandler(previous);
  }, []);

  /** Opens a restaurant parked by a shared link (app/+native-intent.tsx). Only called once the
   *  user is signed in and the auth redirect has landed on the tabs — signed-out users stay on
   *  login and the link waits there until they sign in. */
  const openPendingRestaurant = useCallback(async () => {
    const pending = await takePendingRestaurant();
    if (!pending) return;
    try {
      const restaurants = await getRestaurants();
      const match = restaurants.find(
        (r) => r.orgSlug === pending.orgSlug && String(r.branchCode || '').toLowerCase() === pending.branchCode.toLowerCase()
      );
      if (!match || match.available === false) {
        showAlert('Restaurant unavailable', 'This restaurant is not taking orders on Prayagi Foodwala right now.');
        return;
      }
      router.push({ pathname: '/user/restaurant-details', params: { restaurant: JSON.stringify(match), categoryId: '0' } } as never);
    } catch {
      showAlert('Unable to open restaurant', 'Please check your connection and try again.');
    }
  }, []);

  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;
  const isNavReadyRef = useRef(false);
  isNavReadyRef.current = !isCheckingAuth && isSplashDelayDone;

  // A link tapped while the app is already running (cold starts are handled by the auth
  // redirect below once it has decided where to land).
  useEffect(() => onPendingLinkChange(() => {
    if (!isNavReadyRef.current) return;
    if (isAuthenticatedRef.current) {
      void openPendingRestaurant();
      // Invites are for new sign-ups only — nothing to do for a signed-in customer.
      void clearPendingReferralCode();
    }
    // Signed out: already on login / complete-profile, which pick up the pending link.
  }), [openPendingRestaurant]);

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

        unsubscribe = authService.onAuthStateChange(async (sessionUser) => {
          try {
            if (sessionUser) {
              const userProfile = await userService.getUserProfile(sessionUser.uid, sessionUser.email);
              const profileIncomplete = Boolean(userProfile && !userProfile.isDisabled && !String(userProfile.name || '').trim());
              setIncompleteSession(
                profileIncomplete
                  ? {
                      uid: sessionUser.uid,
                      phone: String(sessionUser.phoneNumber || '').replace(/\D/g, '').slice(-10),
                      email: String(sessionUser.email || '').trim().toLowerCase(),
                    }
                  : null
              );
              if (profileIncomplete) {
                dispatch(logout());
              } else if (userProfile) {
                if (userProfile.isDisabled) {
                  await authService.logoutUser();
                  await storageService.clearUserData();
                  dispatch(logout());
                } else {
                  dispatch(setUser(userProfile));
                  await storageService.saveUserProfile(userProfile);
                }
              } else if (cachedProfile && cachedProfile.uid === sessionUser.uid && !cachedProfile.isDisabled) {
                dispatch(setUser(cachedProfile));
              } else {
                await storageService.clearUserData();
                dispatch(logout());
              }
            } else {
              setIncompleteSession(null);
              await storageService.clearUserData();
              dispatch(logout());
            }
          } catch (error) {
            console.log('Error resolving auth state:', error);
            if (sessionUser && cachedProfile && cachedProfile.uid === sessionUser.uid && !cachedProfile.isDisabled) {
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
        // After the replace has settled, so the restaurant is pushed on top of Home.
        setTimeout(() => {
          void openPendingRestaurant();
          void getPendingReferralCode().then((code) => { if (code) void clearPendingReferralCode(); });
        }, 300);
      } else if (incompleteSession) {
        // Verified phone, no name yet — finish sign-up (see incompleteSession above).
        if (pathnameRef.current !== '/complete-profile') {
          router.replace({ pathname: '/complete-profile', params: incompleteSession } as never);
        }
      } else if (pathnameRef.current !== '/complete-profile') {
        router.replace('/login');
      }
    }
    // pathname is intentionally read via ref, not as a dependency — this effect
    // must only fire on auth-state changes, not on every navigation, or an
    // authenticated user gets force-redirected to the home tab on every route
    // change (e.g. Edit Profile bouncing straight back to Home).
  }, [dispatch, incompleteSession, isAuthenticated, isCheckingAuth, isSplashDelayDone, openPendingRestaurant, user?.role, user?.uid]);

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
            {/* No swipe-back to checkout after placing an order; back goes Home (see order-success). */}
            <Stack.Screen name="order-success" options={{ gestureEnabled: false }} />
            <Stack.Screen name="user/chess" />
            <Stack.Screen name="user/ludo" />
            <Stack.Screen name="user/sudoku" />
            <Stack.Screen name="user/cart" />
            <Stack.Screen name="user/checkout" />
            <Stack.Screen name="user/deals" />
            <Stack.Screen name="user/edit-profile" />
            <Stack.Screen name="user/location-detials" />
            <Stack.Screen name="user/order-success" options={{ gestureEnabled: false }} />
            <Stack.Screen name="user/privacy-policy" />
            <Stack.Screen name="user/product-details" />
            <Stack.Screen name="user/profile" />
            <Stack.Screen name="user/refer-earn" />
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
      {/* Full-screen "no internet / can't reach server" fallback over everything. */}
      <ConnectivityGate />
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
