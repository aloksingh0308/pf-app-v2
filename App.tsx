// App.tsx

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect } from 'react';
import { Settings } from 'react-native-fbsdk-next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import AppNavigator from './app/navigation/AppNavigator';
import { store } from './store';
import { getInstallReferrer } from './utils/referral';


export default function App() {
  useEffect(() => {
    const fetchReferrer = async () => {
      const code = await getInstallReferrer();
      // alert(`Install referrer code: ${code}`);
      if (code) {
        await AsyncStorage.setItem('pendingReferralCode', code);
      }
    };
    Settings.initializeSDK();
    fetchReferrer();
    return () => { };
  }, []);
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom", "left", "right"]}>
          <Provider store={store}>
            <AppNavigator />
          </Provider>
        </SafeAreaView>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
