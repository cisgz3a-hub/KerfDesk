// Service-worker registration + the safe-update UI (ADR-060). `useRegisterSW`
// registers the SW (the plugin's injectRegister is off) and surfaces:
//   * offlineReady — a one-time "ready to work offline" toast.
//   * needRefresh  — a new version is waiting; we show a Reload banner. It is
//     NEVER shown while the laser is streaming, because a reload aborts the
//     live job. `needRefresh` stays true, so the banner appears once the job
//     ends (mirrors the streaming guard in use-autosave).
// Toasts are intentionally button-less (see toast-store), so the update prompt
// is a small banner (lf-banner) rather than a toast.

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';

export function PwaUpdatePrompt(): JSX.Element | null {
  const pushToast = useToastStore((s) => s.pushToast);
  const isStreaming = useLaserStore(
    (s) =>
      s.streamer !== null && (s.streamer.status === 'streaming' || s.streamer.status === 'paused'),
  );
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    if (!offlineReady) return;
    pushToast('Ready to work offline.', 'success');
    setOfflineReady(false);
  }, [offlineReady, pushToast, setOfflineReady]);

  if (!needRefresh || isStreaming) return null;
  return (
    <div
      role="alert"
      aria-label="App update available"
      className="lf-banner lf-banner--info"
      style={bannerStyle}
    >
      <span>A new version of LaserForge is available.</span>
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
