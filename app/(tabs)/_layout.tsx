import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


// app/navigation/AppNavigator.tsx
import { store } from '@/store';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Product } from '../../types/Product';
import HomeScreen from './index';
import BestDealsScreen from './best-deals';
import MoreScreen from './more';
import OrdersScreen from './orders';
import { T } from '@/constants/tokens';

export type RootStackParamList = {
  Home: undefined;
  ProductDetail: { product: Product };
  Cart: undefined;
  Checkout: undefined;
  SplashScreen: undefined;
  LoginScreen: undefined;
  Deals: undefined;
  More: undefined;
  Orders: undefined;
  OrderTypeLocationScreen: undefined;
};

const TabStack = createBottomTabNavigator<RootStackParamList>();
const TAB_ICON_BY_ROUTE: Record<string, string> = {
  Home: 'home-outline',
  Orders: 'receipt-outline',
  Deals: 'pricetags-outline',
  More: 'grid-outline',
};


export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <TabStack.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowIcon: true,
            tabBarActiveTintColor: T.color.brand,
            tabBarStyle: { backgroundColor: '#fff', borderTopColor: '#f0e6de', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, height: 64 + Math.max(insets.bottom, 12), paddingBottom: Math.max(insets.bottom, 12) },
            tabBarLabelStyle: { fontSize: 12, fontWeight: '600', marginTop: 3 },
            tabBarInactiveTintColor: T.color.muted,
            tabBarLabelPosition: 'below-icon',
            tabBarIcon: ({ color, size, focused }) => {
              const outline = TAB_ICON_BY_ROUTE[route.name] ?? 'ellipse-outline';
              const iconName = focused ? outline.replace('-outline', '') : outline;
              return <Ionicons name={iconName} size={size || 22} color={color} />;
            },
          })}
        >
          <TabStack.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
          <TabStack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
          <TabStack.Screen name="Deals" component={BestDealsScreen} options={{ title: 'Deals' }} />
          <TabStack.Screen name="More" component={MoreScreen} options={{ title: 'More' }} />
        </TabStack.Navigator>
      </Provider>
    </GestureHandlerRootView>
  );
}
