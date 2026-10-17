import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { rateLimitRemainingMs } from './apiClient';

/**
 * Every "live" screen here polls the backend because there's no push channel yet. Left
 * alone, each poller kept firing on its own timer whether or not anyone was looking — on
 * a hidden tab, with the app in the background, and even while the server was answering
 * 429 — which is exactly what exhausted the rate limit. A poller built here:
 *  - never overlaps itself (the next tick is scheduled only after the previous one ends),
 *  - pauses while the app is backgrounded and runs straight away on return,
 *  - waits out a rate-limit cooldown instead of piling on more requests.
 */
export type PollTick = () => Promise<unknown> | unknown;

export interface Poller {
  /** Run a tick now (skipped if one is already in flight) and restart the timer. */
  refresh: () => void;
  stop: () => void;
}

export function startPolling(tick: PollTick, intervalMs: number | (() => number), options: { immediate?: boolean } = {}): Poller {
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let appState: AppStateStatus = AppState.currentState;

  const nextDelay = () => (typeof intervalMs === 'function' ? intervalMs() : intervalMs);

  const schedule = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped || appState !== 'active') return;
    timer = setTimeout(run, Math.max(delayMs, rateLimitRemainingMs()));
  };

  async function run() {
    if (stopped || inFlight || appState !== 'active') return;
    const cooldown = rateLimitRemainingMs();
    if (cooldown > 0) {
      schedule(cooldown);
      return;
    }
    inFlight = true;
    try {
      await tick();
    } catch {
      // Each caller handles/logs its own errors; a failed tick must never stop the loop.
    } finally {
      inFlight = false;
      schedule(nextDelay());
    }
  }

  const subscription = AppState.addEventListener('change', (next) => {
    const wasActive = appState === 'active';
    appState = next;
    if (next === 'active' && !wasActive) void run();
    else if (next !== 'active' && timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  if (options.immediate === false) schedule(nextDelay());
  else void run();

  return {
    refresh: () => void run(),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    },
  };
}

/**
 * Screen-level polling: runs only while this screen is focused (a tab you've left, or a
 * screen underneath another one, goes quiet) and the app is in the foreground. The latest
 * `tick` is always used, so callers don't need to memoize it.
 */
export function usePolling(tick: PollTick, intervalMs: number | (() => number), enabled = true): void {
  const isFocused = useIsFocused();
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useEffect(() => {
    if (!enabled || !isFocused) return;
    const poller = startPolling(
      () => tickRef.current(),
      () => (typeof intervalRef.current === 'function' ? intervalRef.current() : intervalRef.current)
    );
    return () => poller.stop();
  }, [enabled, isFocused]);
}
