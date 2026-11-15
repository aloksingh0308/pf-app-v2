import React, { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { showAlert, showErrorAlert } from '@/services/alertService';
import { cancelMyOrder } from '@/services/orderService';
import { userService } from '@/services/userService';
import { RootState } from '@/store';
import { setUser } from '@/store/slices/authSlice';

const formatLeft = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

type Props = {
  orderId: string;
  /** From the order (orderService's `cancellableUntil`) — null/past hides the card. */
  cancellableUntil?: string | null;
  onCancelled: () => void;
  /** Rendered instead once the cancel window has closed (e.g. the Track Order button). */
  fallback?: ReactNode;
};

/**
 * "Cancel Order" button with a live countdown — shown only while the backend says the customer
 * may still cancel (2 minutes after placing, before the food is ready). Swaps to `fallback`
 * the moment the window closes.
 */
export default function CancelOrderButton({ orderId, cancellableUntil, onCancelled, fallback = null }: Props) {
  const dispatch = useDispatch();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const until = cancellableUntil ? new Date(cancellableUntil).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!until) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);

  const left = until - now;
  if (!until || left <= 0) return <>{fallback}</>;

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelMyOrder(orderId);
      onCancelled();
      showAlert('Order cancelled', 'The restaurant has been told. Any wallet balance or coins you used are back in your account.');
      // Wallet money / coins used on the order were returned — refresh the balance.
      if (authUser?.uid) {
        userService
          .getUserProfile(authUser.uid)
          .then((profile) => profile && dispatch(setUser({ ...authUser, ...profile })))
          .catch(() => undefined);
      }
    } catch (error) {
      showErrorAlert(error, "Couldn't cancel this order. Please contact the restaurant.", 'Cancel failed');
      onCancelled();
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    showAlert('Cancel this order?', 'The restaurant will be told straight away.', [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => void cancel() },
    ]);

  return (
    <TouchableOpacity activeOpacity={0.8} accessibilityRole="button" style={styles.button} onPress={confirm} disabled={busy}>
      {busy ? (
        <ActivityIndicator size="small" color="#b42318" />
      ) : (
        <Text style={styles.buttonText}>
          Cancel Order <Text style={styles.time}>({formatLeft(left)})</Text>
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f87171',
    backgroundColor: '#ffffff',
  },
  buttonText: { fontSize: 13, fontWeight: '700', color: '#b42318' },
  time: { fontVariant: ['tabular-nums'] },
});
