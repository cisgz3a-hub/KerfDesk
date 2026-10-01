import { useEffect, useState, type ReactNode } from 'react';
import { installDesktopCloseReceiver } from './desktop-close-runtime';

type StartupState = 'opening' | 'ready' | 'failed';
const PACKAGED_DESKTOP = () =>
  window.location.protocol === 'app:' && window.location.hostname === 'app';

/** Put this inside first-use agreement, and outside every workspace provider. */
export function DesktopStartupGate({ children }: { readonly children: ReactNode }): JSX.Element {
  const [state, setState] = useState<StartupState>(() =>
    PACKAGED_DESKTOP() ? 'opening' : 'ready',
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!PACKAGED_DESKTOP()) return;
    let mounted = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void fetch('./api/desktop/workspace-ready', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'X-KerfDesk-Desktop': '1' },
      signal: controller.signal,
    })
      .then((response) => {
        if (response.status !== 204) throw new Error('Desktop startup unavailable');
        if (mounted) setState(controller.signal.aborted ? 'failed' : 'ready');
      })
      .catch(() => {
        if (mounted) setState('failed');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      mounted = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [attempt]);
  useEffect(() => {
    if (state !== 'ready') return installDesktopCloseReceiver(window);
    return;
  }, [state]);
  if (state === 'ready') return <>{children}</>;
  if (state === 'opening') return <div role="status">Opening KerfDesk…</div>;
  return (
    <div role="alert">
      <p>KerfDesk could not finish opening.</p>
      <button
        type="button"
        onClick={() => {
          setState('opening');
          setAttempt((value) => value + 1);
        }}
      >
        Try again
      </button>
    </div>
  );
}
