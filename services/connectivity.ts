import NetInfo from '@react-native-community/netinfo';
import { API_CONFIG } from '../config/api';

/**
 * App-wide connectivity, as two separate problems the customer sees differently:
 *   - 'offline'            — the phone has no internet (NetInfo)
 *   - 'server-unreachable' — internet is fine, but our API can't be reached (a request failed
 *                            to connect at all — e.g. server down, or TEST mode with no local
 *                            backend running)
 * ConnectivityGate shows the fallback screen for either; apiClient reports every request's
 * outcome here, so the state clears as soon as any call gets through again.
 */
export type ConnectivityStatus = 'online' | 'offline' | 'server-unreachable';

let status: ConnectivityStatus = 'online';
/** The phone has a network interface at all (Wi-Fi / mobile data connected). */
let deviceOnline = true;
/** Android/iOS's own "internet reachable" probe (a Google/Apple URL). It's only a hint: it
 *  fails on networks that block those hosts or on a flaky emulator while our own API still
 *  answers — so it never takes the app offline by itself, it only picks the message. */
let internetProbeOk = true;
let serverReachable = true;
const listeners = new Set<(status: ConnectivityStatus) => void>();

function publish() {
  const next: ConnectivityStatus = !deviceOnline
    ? 'offline'
    : !serverReachable
      ? internetProbeOk
        ? 'server-unreachable'
        : 'offline'
      : 'online';
  if (next === status) return;
  status = next;
  listeners.forEach((listener) => listener(status));
}

export const connectivity = {
  getStatus: () => status,

  subscribe(listener: (status: ConnectivityStatus) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Called by apiClient for every request: false only when the request couldn't connect. */
  reportServer(reachable: boolean) {
    serverReachable = reachable;
    publish();
  },

  /** Pings the API's health endpoint (short timeout) and updates the status. */
  async checkNow(): Promise<ConnectivityStatus> {
    const net = await NetInfo.fetch().catch(() => null);
    // isInternetReachable can be null while unknown — only a definite "false" counts.
    deviceOnline = !(net && net.isConnected === false);
    internetProbeOk = !(net && net.isInternetReachable === false);
    if (deviceOnline) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        await fetch(`${API_CONFIG.baseUrl}/health`, { signal: controller.signal });
        serverReachable = true;
      } catch {
        serverReachable = false;
      } finally {
        clearTimeout(timer);
      }
    }
    publish();
    return status;
  },
};

// Follow the phone's network state for the whole app lifetime.
NetInfo.addEventListener((state) => {
  const online = state.isConnected !== false;
  const probeOk = state.isInternetReachable !== false;
  if (online === deviceOnline && probeOk === internetProbeOk) return;
  deviceOnline = online;
  internetProbeOk = probeOk;
  publish();
  // Coming back online: re-check the server too, rather than waiting for the next request.
  if (online && !serverReachable) void connectivity.checkNow();
});

/** True for errors thrown when a request couldn't reach the server at all (not HTTP errors). */
export function isNetworkFailure(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return error instanceof TypeError && (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network'));
}
