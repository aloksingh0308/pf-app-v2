import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppStatus, AppStatusConfig, subscribeToAppStatus } from '@/services/appConfigService';
import AppStatusBlockScreen, { BlockingAppStatus } from './AppStatusBlockScreen';

const DEFAULT_STATE: AppStatusConfig = {
  status: 'active',
  title: '',
  description: '',
};

const AppStatusContext = createContext<AppStatusConfig>(DEFAULT_STATE);

export function useAppStatus(): AppStatusConfig {
  return useContext(AppStatusContext);
}

/** Only a platform-wide state may take over the whole app. A paused or closed restaurant is
 *  one restaurant in a multi-restaurant app — its own screens show that (see
 *  RestaurantPausedBanner) while customers keep browsing and ordering elsewhere. */
const BLOCKING_STATUSES: AppStatus[] = ['maintenance'];

function isBlockingStatus(status: AppStatus): status is BlockingAppStatus {
  return BLOCKING_STATUSES.includes(status);
}

type Props = {
  children: React.ReactNode;
};

export default function AppStatusProvider({ children }: Props) {
  const [appStatus, setAppStatus] = useState<AppStatusConfig>(DEFAULT_STATE);
  const hasSubscribedRef = useRef(false);

  useEffect(() => {
    if (hasSubscribedRef.current) {
      return;
    }
    hasSubscribedRef.current = true;

    const unsubscribe = subscribeToAppStatus((config) => {
      setAppStatus(config);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (isBlockingStatus(appStatus.status)) {
    return (
      <AppStatusContext.Provider value={appStatus}>
        <AppStatusBlockScreen
          status={appStatus.status}
          title={appStatus.title}
          description={appStatus.description}
        />
      </AppStatusContext.Provider>
    );
  }

  return (
    <AppStatusContext.Provider value={appStatus}>
      {children}
    </AppStatusContext.Provider>
  );
}
