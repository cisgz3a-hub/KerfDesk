import { useEffect } from 'react';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

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
  let sentinel: ScreenWakeLockSentinel | null = null;
  const nav = env.navigator as ScreenWakeLockNavigator;

  const clearSentinel = (): void => {
    sentinel?.removeEventListener('release', onRelease);
    sentinel = null;
  };

  const request = async (): Promise<void> => {
    if (disposed || !wanted || requesting || sentinel !== null) return;
    if (nav.wakeLock === undefined) return;
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
      // Wake lock can be denied by the browser or operating system. The
      // machine stream still runs; this is best-effort protection against
      // screen sleep interrupting Web Serial.
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
