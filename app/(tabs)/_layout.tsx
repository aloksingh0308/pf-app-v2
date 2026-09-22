import React from 'react';

import { AppColors } from '@/constants/appColors';

// app/navigation/AppNavigator.tsx
import { store } from '@/store';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Product } from '../../types/Product';
import HomeScreen from './index';
import MealScreen from './meal';
import MoreScreen from './more';
import OrdersScreen from './orders';

export type RootStackParamList = {
  Home: undefined;
  ProductDetail: { product: Product };
  Cart: undefined;
  Checkout: undefined;
  SplashScreen: undefined;
  LoginScreen: undefined;
  Meal: undefined;
  More: undefined;
  Orders: undefined;
  OrderTypeLocationScreen: undefined;
};

const TabStack = createBottomTabNavigator<RootStackParamList>();
const TAB_ICON_BY_ROUTE: Record<string, string> = {
  Home: 'home-outline',
  Orders: 'receipt-outline',
  Meal: 'restaurant-outline',
  More: 'grid-outline',
};


export default function TabLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Provider store={store}>
        <TabStack.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarShowIcon: true,
            tabBarActiveTintColor: AppColors.primary,
            tabBarInactiveTintColor: AppColors.textMuted,
            tabBarLabelPosition: 'below-icon',
            tabBarIcon: ({ color, size }) => {
              const iconName = TAB_ICON_BY_ROUTE[route.name] ?? 'ellipse-outline';
              return <Ionicons name={iconName} size={size || 22} color={color} />;
            },
          })}
        >
          <TabStack.Screen name="Home" component={HomeScreen} options={{ title: 'Home' }} />
          <TabStack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Orders' }} />
          <TabStack.Screen name="Meal" component={MealScreen} options={{ title: 'Meal' }} />
          <TabStack.Screen name="More" component={MoreScreen} options={{ title: 'More' }} />
        </TabStack.Navigator>
      </Provider>
    </GestureHandlerRootView>
  );
}
