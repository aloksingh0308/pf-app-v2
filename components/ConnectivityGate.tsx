import OfflineScreen from '@/components/OfflineScreen';
import { connectivity, type ConnectivityStatus } from '@/services/connectivity';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** How often to re-check while the fallback is showing. */
const AUTO_RETRY_MS = 5000;

/**
 * Covers the whole app with the "can't connect" screen while the phone is offline or the
 * API can't be reached, and removes it as soon as the connection is back (auto re-check,
 * Retry button, or any request succeeding). The app underneath stays mounted, so the
 * customer lands back exactly where they were — e.g. the phone number they typed.
 */
export default function ConnectivityGate() {
  const [status, setStatus] = useState<ConnectivityStatus>(connectivity.getStatus());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => connectivity.subscribe(setStatus), []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await connectivity.checkNow();
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'online') return;
    const timer = setInterval(() => void connectivity.checkNow(), AUTO_RETRY_MS);
    return () => clearInterval(timer);
  }, [status]);

  if (status === 'online') return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      <OfflineScreen variant={status === 'offline' ? 'offline' : 'server'} onRetry={() => void retry()} retrying={retrying} />
    </View>
  );
}
