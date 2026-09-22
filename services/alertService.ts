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
  showAlert(title, getUserFriendlyErrorMessage(error, fallbackMessage));
}
