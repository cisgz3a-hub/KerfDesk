import { useCallback, useEffect, useRef, useState } from 'react';

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Discover updates in long-lived browser windows; applying one remains manual. */
export function usePwaUpdateDiscovery(): (
  scriptUrl: string,
  registration: ServiceWorkerRegistration | undefined,
) => void {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (registration === undefined) return;
    let checking = false;
    const check = async (): Promise<void> => {
      if (checking || navigator.onLine === false) return;
      checking = true;
      try {
        await registration.update();
      } catch {
        // Offline or temporarily unreachable: leave the running build alone.
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [registration]);

  return useCallback((_scriptUrl, registered) => {
    if (mounted.current) setRegistration(registered);
  }, []);
}
