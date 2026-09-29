import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DesktopLicenceAdapter, DesktopLicenceStatus } from '../../platform/types';
import { LicencePanel } from './LicencePanel';

export const LICENCE_SETTINGS_EVENT = 'kerfdesk:licence-settings';

/** Admission is latched for this mounted workspace; no expiry polling or timer. */
export function CommercialLicenceGate({
  client,
  children,
}: {
  readonly client?: DesktopLicenceAdapter;
  readonly children: ReactNode;
}): JSX.Element {
  const [admitted, setAdmitted] = useState(client === undefined);
  const [status, setStatus] = useState<DesktopLicenceStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const accept = useCallback(
    async (result: DesktopLicenceStatus): Promise<void> => {
      setStatus(result);
      if (result.channel === 'free' || result.sessionAuthorized) {
        setAdmitted(true);
        return;
      }
      if (result.state === 'ready' && client !== undefined) {
        const launched = await client.launch();
        setStatus(launched);
        if (launched.sessionAuthorized) setAdmitted(true);
      }
    },
    [client],
  );
  const load = useCallback(async (): Promise<void> => {
    setFailure(null);
    try {
      if (client !== undefined) await accept(await client.status());
    } catch {
      setFailure(
        'The desktop licence service could not be reached. Please retry or restart KerfDesk.',
      );
    }
  }, [accept, client]);
  useEffect(() => {
    void load();
  }, [load]);
  useDismissLicenceManager(managing, setManaging);
  useEffect(() => {
    if (client === undefined) return;
    const manage = (): void => {
      setManaging(true);
      void load();
    };
    window.addEventListener(LICENCE_SETTINGS_EVENT, manage);
    return () => window.removeEventListener(LICENCE_SETTINGS_EVENT, manage);
  }, [client, load]);
  if (admitted && !managing) return <>{children}</>;
  const panel =
    client === undefined ? null : (
      <LicencePanel
        client={client}
        status={status}
        failure={failure}
        onStatus={accept}
        onRetry={load}
        {...(admitted ? { onClose: () => setManaging(false) } : {})}
      />
    );
  if (admitted)
    return (
      <>
        {children}
        <div role="dialog" aria-modal="false" aria-label="KerfDesk licence" style={overlay}>
          {panel}
        </div>
      </>
    );
  return (
    <main data-licence-gate aria-label="KerfDesk activation" style={gate}>
      {panel}
    </main>
  );
}

function useDismissLicenceManager(managing: boolean, setManaging: (value: boolean) => void): void {
  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setManaging(false);
    };
    if (managing) window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [managing, setManaging]);
}

const gate = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: 'var(--lf-bg-0)',
  color: 'var(--lf-text)',
} as const;
// A nonmodal panel leaves the workspace mounted and keyboard recovery active.
const overlay = {
  position: 'fixed',
  zIndex: 1000,
  top: 56,
  left: 16,
  maxWidth: 'min(480px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 80px)',
  overflow: 'auto',
  border: '1px solid var(--lf-border-strong)',
  background: 'var(--lf-bg-1)',
} as const;
