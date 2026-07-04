// Service-worker registration + the safe-update UI (ADR-060). `useRegisterSW`
// registers the SW (the plugin's injectRegister is off) and surfaces:
//   * offlineReady — a one-time "ready to work offline" toast.
//   * needRefresh  — a new version is waiting; we show a Reload banner. It is
//     NEVER shown while a job is still active, because a reload can abort
//     motion or hide a terminal job state that still needs operator handling.
//     `needRefresh` stays true, so the banner appears once the job clears.
// Toasts are intentionally button-less (see toast-store), so the update prompt
// is a small banner (lf-banner) rather than a toast.

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';

export function PwaUpdatePrompt(): JSX.Element | null {
  const pushToast = useToastStore((s) => s.pushToast);
  const jobActive = useLaserStore((s) => isActiveJob(s.streamer));
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
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

  if (!needRefresh || jobActive) return null;
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
        onClick={() => setNeedRefresh(false)}
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
