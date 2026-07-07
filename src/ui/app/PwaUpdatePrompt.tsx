// Service-worker registration + the safe-update UI (ADR-060). `useRegisterSW`
// registers the SW (the plugin's injectRegister is off) and surfaces:
//   * offlineReady — a one-time "ready to work offline" toast.
//   * needRefresh  — a new version is waiting; we show a Reload banner. It is
//     NEVER shown while a job is still active, because a reload can abort
//     motion or hide a terminal job state that still needs operator handling.
//     `needRefresh` stays true, so the banner appears once the job clears.
//   * a persisted "Later" — workbox-window re-fires `waiting` for an
//     already-waiting SW on EVERY load, so without this the banner re-nags on
//     every reload for an update the user already deferred (see
//     pwa-update-dismissal). A strictly-newer SW re-arms it via `updatefound`.
// Toasts are intentionally button-less (see toast-store), so the update prompt
// is a small banner (lf-banner) rather than a toast.

import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import {
  clearDismissedUpdateVersion,
  loadDismissedUpdateVersion,
  saveDismissedUpdateVersion,
} from './pwa-update-dismissal';

export function PwaUpdatePrompt(): JSX.Element | null {
  const pushToast = useToastStore((s) => s.pushToast);
  const jobActive = useLaserStore((s) => isActiveJob(s.streamer));
  // Bumped by the `updatefound` handler after it clears the persisted dismissal.
  // The value is unused for logic (storage is the source of truth); its only job
  // is to re-render THIS mounted instance so a currently-suppressed prompt (which
  // returned null) recomputes `isDismissed` and shows the banner for the newer SW.
  const [, setUpdateRevision] = useState(0);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      // A strictly-newer service worker fires `updatefound` on the registration;
      // clear any prior "Later" so an update accepted since then is not swallowed
      // by the persisted dismissal below, then force a re-render so an
      // already-mounted suppressed prompt re-evaluates and surfaces the banner.
      registration?.addEventListener('updatefound', () => {
        clearDismissedUpdateVersion();
        setUpdateRevision((revision) => revision + 1);
      });
    },
    onRegisterError(error) {
      // A failed registration means offline mode won't work; surface it rather
      // than fail silently (ADR-060 audit). console is the UI-layer logger here,
      // matching platform/web/web-serial.ts.
      console.error('Service worker registration failed; offline mode unavailable.', error);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    pushToast('Ready to work offline.', 'success');
    setOfflineReady(false);
  }, [offlineReady, pushToast, setOfflineReady]);

  // Suppress the banner for an update the user already dismissed. We key the
  // marker to the running build's version (__APP_VERSION__) because the waiting
  // SW's own version is not legible client-side — sw.js is unhashed — and the
  // running bundle stays fixed until the waiting SW activates.
  const isDismissed = loadDismissedUpdateVersion() === __APP_VERSION__;
  if (!needRefresh || jobActive || isDismissed) return null;
  return (
    <div
      role="alert"
      aria-label="App update available"
      className="lf-banner lf-banner--info"
      style={bannerStyle}
    >
      <span>A new version of {APP_DISPLAY_NAME} is available.</span>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        title="Reload now to apply the update"
        onClick={() => void updateServiceWorker(true)}
      >
        Reload
      </button>
      <button
        type="button"
        className="lf-btn lf-btn--ghost"
        title="Keep the current version for now"
        onClick={() => {
          saveDismissedUpdateVersion(__APP_VERSION__);
          setNeedRefresh(false);
        }}
      >
        Later
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 'var(--lf-space-6)',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--lf-space-5)',
  boxShadow: 'var(--lf-shadow)',
  // --lf-z-toast layer: above the canvas, panels, and status bar.
  zIndex: 1100,
};
