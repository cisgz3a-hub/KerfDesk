// useActiveJobWakeLock (ADR-117) — hold a screen wake lock while a job is
// active so OS display-sleep can't suspend the tab / renderer mid-stream.
// Best-effort: a denied or missing Wake Lock API never blocks the job, but
// the operator is told once (Console transcript) so a marathon burn isn't trusted to a
// machine that will sleep. The Electron side needs 'screen-wake-lock' in the
// trusted-renderer-policy permission allowlist; the web side works wherever
// Chromium ships the API.

import { useEffect } from 'react';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

const KEEP_AWAKE_UNAVAILABLE_MESSAGE =
  '[lf2] Keep-awake unavailable — the OS may sleep the screen mid-job. ' +
  'Disable system sleep before starting long burns.';

type ScreenWakeLockSentinel = EventTarget & {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: (event: Event) => void): void;
  removeEventListener(type: 'release', listener: (event: Event) => void): void;
};

type ScreenWakeLockNavigator = Navigator & {
  readonly wakeLock?: {
    request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
  };
};

type WakeLockEnvironment = {
  readonly document: Document;
  readonly navigator: Navigator;
};

export function installActiveJobWakeLock(
  env: WakeLockEnvironment = { document, navigator },
): () => void {
  const controller = createScreenWakeLockController(env);
  let active = isActiveJob(useLaserStore.getState().streamer);
  if (active) controller.start();

  const unsubscribe = useLaserStore.subscribe((state) => {
    const nextActive = isActiveJob(state.streamer);
    if (nextActive === active) return;
    active = nextActive;
    if (active) controller.start();
    else controller.stop();
  });

  return () => {
    unsubscribe();
    controller.dispose();
  };
}

export function useActiveJobWakeLock(): void {
  useEffect(() => installActiveJobWakeLock(), []);
}

function createScreenWakeLockController(env: WakeLockEnvironment): {
  readonly start: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
} {
  let wanted = false;
  let requesting = false;
  let disposed = false;
  let warned = false;
  let sentinel: ScreenWakeLockSentinel | null = null;
  const nav = env.navigator as ScreenWakeLockNavigator;

  const clearSentinel = (): void => {
    sentinel?.removeEventListener('release', onRelease);
    sentinel = null;
  };

  // One line, once per session: the job keeps running either way, but the
  // operator must know the display may sleep before trusting an hours-long
  // burn to it. Repeat visibility flaps re-attempt silently.
  const warnUnavailableOnce = (): void => {
    if (warned) return;
    warned = true;
    useLaserStore.getState().pushSystemNotice(KEEP_AWAKE_UNAVAILABLE_MESSAGE);
  };

  const request = async (): Promise<void> => {
    if (disposed || !wanted || requesting || sentinel !== null) return;
    if (nav.wakeLock === undefined) {
      warnUnavailableOnce();
      return;
    }
    if (env.document.visibilityState === 'hidden') return;
    requesting = true;
    try {
      const next = await nav.wakeLock.request('screen');
      if (disposed || !wanted) {
        await next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
      sentinel.addEventListener('release', onRelease);
    } catch {
      // Wake lock can be denied by the browser or operating system (battery
      // saver, permission policy — on Electron the trusted-renderer-policy
      // allowlist must include 'screen-wake-lock'). The machine stream still
      // runs; this is best-effort protection against screen sleep
      // interrupting Web Serial.
      warnUnavailableOnce();
    } finally {
      requesting = false;
    }
  };

  function onRelease(): void {
    clearSentinel();
    if (!disposed && wanted && env.document.visibilityState !== 'hidden') void request();
  }

  const onVisibilityChange = (): void => {
    if (!disposed && wanted && env.document.visibilityState !== 'hidden') void request();
  };

  env.document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start: () => {
      wanted = true;
      void request();
    },
    stop: () => {
      wanted = false;
      const current = sentinel;
      clearSentinel();
      void current?.release().catch(() => undefined);
    },
    dispose: () => {
      disposed = true;
      wanted = false;
      env.document.removeEventListener('visibilitychange', onVisibilityChange);
      const current = sentinel;
      clearSentinel();
      void current?.release().catch(() => undefined);
    },
  };
}
