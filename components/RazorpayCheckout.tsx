import React, { useMemo, useRef } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import Ionicons from '@react-native-vector-icons/ionicons';
import styled from 'styled-components/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckoutPayment, CheckoutResult, DONE_PATH, redirectCallbackUrl } from '../services/paymentService';
import { moderateScale, scaleFont } from '../utils/responsive';

/** UPI / wallet app links the checkout page may open — handed to the OS, never loaded in the WebView. */
const EXTERNAL_SCHEMES = /^(upi|intent|tez|gpay|phonepe|paytmmp|paytm|credpay|bhim|mobikwik|whatsapp):/i;

function checkoutHtml(payment: CheckoutPayment): string {
  const options = {
    key: payment.keyId,
    order_id: payment.gatewayOrderId,
    amount: payment.amount,
    currency: payment.currency,
    name: payment.name,
    description: payment.description,
    prefill: payment.prefill || {},
    theme: { color: '#f68712' },
    // Redirect mode: Razorpay POSTs the result to our backend (which verifies it) instead
    // of calling JS — the reliable way inside a WebView, where bank pages can't open popups.
    redirect: true,
    callback_url: redirectCallbackUrl(payment.orderId),
    timeout: Math.max(60, Math.floor((new Date(payment.expiresAt).getTime() - Date.now()) / 1000) - 60),
    modal: { confirm_close: true },
  };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#fffbf7}#msg{text-align:center;padding:40px 16px;color:#555}</style></head>
<body><div id="msg">Opening secure payment…</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  function send(m){ window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  try {
    var opts = ${JSON.stringify(options)};
    opts.modal.ondismiss = function(){ send({ type: 'dismissed' }); };
    var rzp = new Razorpay(opts);
    rzp.on('payment.failed', function(r){ send({ type: 'failed', reason: (r && r.error && r.error.description) || '' }); });
    rzp.open();
  } catch (e) { send({ type: 'error', reason: String(e && e.message || e) }); }
</script></body></html>`;
}

/**
 * Full-screen Razorpay checkout for one order. Calls `onResult` exactly once:
 * paid / pending (backend verified it, or is still confirming), failed, or dismissed.
 */
export default function RazorpayCheckout({ payment, onResult }: { payment: CheckoutPayment | null; onResult: (result: CheckoutResult) => void }) {
  const insets = useSafeAreaInsets();
  const doneRef = useRef(false);
  const lastFailure = useRef<string | undefined>(undefined);
  const html = useMemo(() => (payment ? checkoutHtml(payment) : ''), [payment]);

  const finish = (result: CheckoutResult) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onResult(result);
  };

  // Reset for each new checkout.
  const paymentKey = payment?.gatewayOrderId;
  const keyRef = useRef(paymentKey);
  if (keyRef.current !== paymentKey) {
    keyRef.current = paymentKey;
    doneRef.current = false;
    lastFailure.current = undefined;
  }

  const onNavigation = (nav: WebViewNavigation | { url: string }): boolean => {
    const url = nav.url || '';
    if (EXTERNAL_SCHEMES.test(url)) {
      Linking.openURL(url).catch(() => undefined);
      return false;
    }
    if (url.includes(DONE_PATH)) {
      const query = url.split('?')[1] || '';
      const params = new URLSearchParams(query);
      const result = params.get('result');
      if (result === 'paid') finish({ status: 'paid' });
      else if (result === 'pending') finish({ status: 'pending' });
      else finish({ status: 'failed', reason: params.get('reason') || lastFailure.current });
      return false;
    }
    return true;
  };

  return (
    <Modal visible={Boolean(payment)} animationType="slide" onRequestClose={() => finish(lastFailure.current ? { status: 'failed', reason: lastFailure.current } : { status: 'dismissed' })}>
      <Wrap style={{ paddingTop: insets.top }}>
        <Header>
          <HeaderTitle>Secure payment</HeaderTitle>
          <CloseButton
            accessibilityLabel="Close payment"
            onPress={() => finish(lastFailure.current ? { status: 'failed', reason: lastFailure.current } : { status: 'dismissed' })}
          >
            <Ionicons name="close" size={moderateScale(24)} color="#333" />
          </CloseButton>
        </Header>
        {payment ? (
          <WebView
            key={payment.gatewayOrderId}
            originWhitelist={['*']}
            source={{ html, baseUrl: 'https://checkout.razorpay.com' }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            startInLoadingState
            renderLoading={() => (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#f68712" />
              </View>
            )}
            onShouldStartLoadWithRequest={onNavigation}
            // Android doesn't route every redirect through onShouldStartLoadWithRequest.
            onNavigationStateChange={(nav) => {
              if (Platform.OS === 'android') onNavigation(nav);
            }}
            onMessage={(event) => {
              try {
                const message = JSON.parse(event.nativeEvent.data) as { type: string; reason?: string };
                if (message.type === 'failed') lastFailure.current = message.reason || 'The payment didn’t go through.';
                else if (message.type === 'dismissed') finish(lastFailure.current ? { status: 'failed', reason: lastFailure.current } : { status: 'dismissed' });
                else if (message.type === 'error') finish({ status: 'failed', reason: 'Couldn’t open the payment window. Please try again.' });
              } catch {
                /* not ours */
              }
            }}
          />
        ) : null}
      </Wrap>
    </Modal>
  );
}

const Wrap = styled.View`
  flex: 1;
  background-color: #fffbf7;
`;

const Header = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: ${moderateScale(12)}px ${moderateScale(16)}px;
  border-bottom-width: 1px;
  border-bottom-color: #f1e6db;
`;

const HeaderTitle = styled.Text`
  font-size: ${scaleFont(16)}px;
  font-weight: 700;
  color: #222;
`;

const CloseButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  padding: ${moderateScale(4)}px;
`;
