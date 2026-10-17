import { isNetworkFailure } from './connectivity';
import { NETWORK_ERROR_CODE } from '../utils/apiClient';
import { getUserFriendlyErrorMessage } from '@/utils/errorMessages';
import { Alert } from 'react-native';

export type AppAlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertHandler = (
  title: string,
  message?: string,
  buttons?: AppAlertButton[]
) => void;

let globalAlertHandler: AlertHandler | null = null;

export function setGlobalAlertHandler(handler: AlertHandler | null) {
  globalAlertHandler = handler;
}

export function showAlert(title: string, message?: string, buttons?: AppAlertButton[]) {
  if (globalAlertHandler) {
    globalAlertHandler(title, message, buttons);
    return;
  }

  Alert.alert(
    title,
    message,
    (buttons || [{ text: 'OK' }]).map((btn) => ({
      text: btn.text,
      onPress: btn.onPress,
      style: btn.style,
    }))
  );
}

export function showErrorAlert(
  error: unknown,
  fallbackMessage = 'Something went wrong. Please try again.',
  title = 'Oops'
) {
  // Connection failures are shown by the full-screen fallback (ConnectivityGate) instead of
  // a popup on top of it.
  if (isConnectionError(error)) return;
  showAlert(title, getUserFriendlyErrorMessage(error, fallbackMessage));
}

function isConnectionError(error: unknown): boolean {
  return (error as { code?: string })?.code === NETWORK_ERROR_CODE || isNetworkFailure(error);
}
