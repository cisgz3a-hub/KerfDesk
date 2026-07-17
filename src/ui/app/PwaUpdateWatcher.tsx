// Headless service-worker watcher (ADR-060 registration model, ADR-227 update
// UX). `useRegisterSW` registers the SW (the plugin's injectRegister is off)
// and this component renders nothing — it only publishes lifecycle state:
//   * offlineReady — a one-time "ready to work offline" toast.
//   * needRefresh  — a new version is waiting; published to pwa-update-store so
//     the status bar's PwaUpdateButton surfaces it. ADR-227 removed the old
//     Reload/Later popup — with a deploy landing most days, workbox re-firing
//     `waiting` on every load made it a permanent nag — so there is no banner
//     and no dismissal bookkeeping anymore; readiness just sits in the store
//     until the operator clicks the button.
// The update still applies only on a user click (ADR-060 forbids unprompted
// reloads), routed through applyPromptedReload so the click ends in a real
// reload in every service-worker state.

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { usePwaUpdateStore } from '../state/pwa-update-store';
import { useToastStore } from '../state/toast-store';
import { applyPromptedReload } from './pwa-prompted-reload';

export function PwaUpdateWatcher(): JSX.Element | null {
  const pushToast = useToastStore((s) => s.pushToast);
  const setAvailability = usePwaUpdateStore((s) => s.setAvailability);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // A failed registration means offline mode won't work; surface it rather
      // than fail silently (ADR-060 audit). console is the UI-layer logger
      // here, matching platform/web/web-serial.ts.
      console.error('Service worker registration failed; offline mode unavailable.', error);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    pushToast('Ready to work offline.', 'success');
    setOfflineReady(false);
  }, [offlineReady, pushToast, setOfflineReady]);

  useEffect(() => {
    if (!needRefresh) {
      setAvailability({ kind: 'none' });
      return;
    }
    setAvailability({
      kind: 'ready',
      // Not updateServiceWorker alone: its reload path needs a `controlling`
      // event an uncontrolled page never gets, and its SKIP_WAITING no-ops
      // once the waiting slot is empty — the click must always reload (see
      // pwa-prompted-reload).
      applyUpdate: () =>
        applyPromptedReload({
          getRegistration: () =>
            'serviceWorker' in navigator
              ? navigator.serviceWorker.getRegistration()
              : Promise.resolve(undefined),
          requestSkipWaiting: () => updateServiceWorker(true),
          reload: () => window.location.reload(),
        }),
    });
  }, [needRefresh, setAvailability, updateServiceWorker]);

  return null;
}
