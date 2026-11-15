import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import 'react-native-reanimated';

import AppAlertProvider from '@/components/AppAlertProvider';
import AppStatusProvider from '@/components/AppStatusProvider';
import ConnectivityGate from '@/components/ConnectivityGate';
import GlobalLoader from '@/components/GlobalLoader';
import OnboardingSlides from '@/components/OnboardingSlides';
import { useColorScheme } from '@/hooks/useColorScheme';
import { analyticsService, track } from '@/services/analytics';
import { authService } from '@/services/authService';
import { notificationService } from '@/services/notificationService';
import { askPermissionOnFirstSignIn, refreshNotificationPermission } from '@/services/engagementService';
import { startCartSync, syncCartNow } from '@/services/cartSyncService';
import { hydrateCachedLocationAddress, warmupUserLocationCache } from '@/services/locationCacheService';
import { storageService } from '@/services/storageService';
import { userService } from '@/services/userService';
import { showAlert } from '@/services/alertService';
import { getRestaurants } from '@/services/restaurantService';
import { clearPendingReferralCode, getPendingReferralCode, onPendingLinkChange, parseDeepLink, savePendingLink, takePendingRestaurant } from '@/utils/deepLinks';
import { notificationPreferenceService } from '@/services/notificationPreferenceService';
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
  // null until read from storage. The intro slides show once per install, after the splash
  // and before login — never to someone already signed in (an existing user updating the app).
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  // A verified phone session whose profile has no name yet (brand-new customer, or the app
  // was closed mid sign-up). Such a user is NOT signed in yet — they're sent to
  // /complete-profile, which signs them in once the profile is saved.
  const [incompleteSession, setIncompleteSession] = useState<{ uid: string; phone: string; email: string } | null>(null);
  const pushTokenSyncedForUidRef = useRef<string | null>(null);
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useSelector((state: RootState) => state.auth);
  const isAppShellReady = loaded || Boolean(fontError) || isFontLoadTimedOut;
  const pathname = usePathname();
  const showOnboarding = hasSeenOnboarding === false && !isAuthenticated && !incompleteSession;
  const isLaunchDone = isSplashDelayDone && hasSeenOnboarding !== null && !showOnboarding;
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

  const handledNotificationIdsRef = useRef(new Set<string>());
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;
  const isNavReadyRef = useRef(false);
  isNavReadyRef.current = !isCheckingAuth && isLaunchDone;

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
    }, 2000);

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

    // After sign-in: asks the OS once if this phone was never asked (so the first order's
    // status pushes arrive), otherwise just reports the permission and registers the token.
    // Customers who decline get the education screen after their first delivery
    // (components/EngagementPrompts.tsx).
    const syncPushToken = async () => {
      try {
        await askPermissionOnFirstSignIn(user.uid, { pushToken: user.pushToken, pushTokenType: user.pushTokenType });
        syncCartNow(store);
        if (mounted) pushTokenSyncedForUidRef.current = user.uid;
      } catch (error) {
        console.log('Push token sync failed:', error);
      }
    };

    // Customers change notifications in device settings while the app is in the
    // background — re-check whenever it comes back.
    const resumeSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const latest = store.getState().auth.user;
      void refreshNotificationPermission(user.uid, { pushToken: latest?.pushToken, pushTokenType: latest?.pushTokenType }).catch((error) =>
        console.log('Push permission refresh failed:', error)
      );
    });

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

    /** Order-status pushes open the order; automated (repeat-order / first-order / cart) pushes report the tap
     *  and open their link — a restaurant link goes through the same pending-link path as a
     *  shared link. Each notification is handled once (the last response is re-read on every
     *  auth change). */
    const handleNotificationResponse = (response: Notifications.NotificationResponse | null | undefined) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id && handledNotificationIdsRef.current.has(id)) return;
      if (id) handledNotificationIdsRef.current.add(id);
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      if (data.type === 'REPEAT_ORDER' || data.type === 'FIRST_ORDER' || data.type === 'ABANDONED_CART') {
        const logId = String(data.notificationLogId || '');
        if (logId) void notificationPreferenceService.reportOpened(logId).catch(() => {});
        const link = parseDeepLink(String(data.link || ''));
        if (link) void savePendingLink(link);
        return;
      }
      handleNotificationRoute(data.orderId as string | undefined);
    };

    void Notifications.getLastNotificationResponseAsync().then(handleNotificationResponse).catch(() => {});

    const responseSub = notificationService.addNotificationResponseListener(handleNotificationResponse);

    return () => {
      mounted = false;
      receiveSub.remove();
      responseSub.remove();
      resumeSub.remove();
    };
  }, [isAuthenticated, user?.uid, user?.role]);

  useEffect(() => {
    void storageService.hasSeenOnboarding().then(setHasSeenOnboarding);
    startCartSync(store);
  }, []);

  // Ask for notifications up front: once the intro/splash is done, a signed-out customer on a
  // never-asked phone sees the OS dialog right away (signed-in customers are asked by the
  // sign-in sync above). Declining leads to the education screen after the first delivery.
  const launchAskedRef = useRef(false);
  useEffect(() => {
    if (launchAskedRef.current || !isLaunchDone || isCheckingAuth || isAuthenticated) return;
    launchAskedRef.current = true;
    void notificationService
      .askIfNeverAsked()
      .then((r) => {
        if (r) track(r.granted ? 'os_permission_granted' : 'os_permission_denied', { platform: Platform.OS, at: 'launch' });
      })
      .catch((error) => console.log('launch permission ask failed:', error));
  }, [isAuthenticated, isCheckingAuth, isLaunchDone]);

  useEffect(() => {
    // Signed-in users skip the intro; record it so it never appears after a later logout.
    if (hasSeenOnboarding === false && !isCheckingAuth && (isAuthenticated || incompleteSession)) {
      setHasSeenOnboarding(true);
      void storageService.markOnboardingSeen();
    }
  }, [hasSeenOnboarding, incompleteSession, isAuthenticated, isCheckingAuth]);

  const finishOnboarding = useCallback(() => {
    setHasSeenOnboarding(true);
    void storageService.markOnboardingSeen();
  }, []);

  useEffect(() => {
    if (!isCheckingAuth && isLaunchDone) {
      // Signing in/out starts a fresh history (nothing to go "back" to across accounts).
      // This used to be done by re-keying the whole <Stack>, which remounted it on the old
      // route first — login flashed again before Home appeared.
      if (router.canDismiss()) router.dismissAll();
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
  }, [dispatch, incompleteSession, isAuthenticated, isCheckingAuth, isLaunchDone, openPendingRestaurant, user?.role, user?.uid]);

  if (!isAppShellReady) {
    return <SplashScreen />;
  }


  if (!isSplashDelayDone || isCheckingAuth || hasSeenOnboarding === null) {
    return <SplashScreen />;
  }

  if (showOnboarding) {
    return <OnboardingSlides onFinish={finishOnboarding} />;
  }

  return (
    <AppStatusProvider>
      <AppAlertProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="splash" />
            <Stack.Screen name="login" options={{ animation: 'fade' }} />
            <Stack.Screen name="complete-profile" options={{ animation: 'fade' }} />
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
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
            <Stack.Screen name="user/favorites" />
            <Stack.Screen name="user/profile" />
            <Stack.Screen name="user/notification-preferences" />
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
