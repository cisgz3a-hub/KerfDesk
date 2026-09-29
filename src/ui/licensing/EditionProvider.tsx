import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionContext, setActiveEdition, type EditionValue } from './edition';
import { LicencePanel } from './LicencePanel';
import { ProFeatureDialog } from './ProFeatureDialog';
import type { ProFeature } from './pro-features';

export const LICENCE_SETTINGS_EVENT = 'kerfdesk:licence-settings';

type PendingPro = { readonly feature: ProFeature; readonly onAllowed?: (() => void) | undefined };

/**
 * Supplies the Free/Pro edition to the app (ADR-540). The workspace always
 * mounts at once: a licence never blocks opening KerfDesk, a project or a
 * machine. Without a licence adapter every feature is available.
 */
export function EditionProvider({
  client,
  children,
}: {
  readonly client?: LicenceAdapter;
  readonly children: ReactNode;
}): JSX.Element {
  if (client === undefined) return <>{children}</>;
  return <LicensedEdition client={client}>{children}</LicensedEdition>;
}

function LicensedEdition({
  client,
  children,
}: {
  readonly client: LicenceAdapter;
  readonly children: ReactNode;
}): JSX.Element {
  const session = useLicenceSession(client);
  const [managing, setManaging] = useState(false);
  const { load } = session;
  useEffect(() => {
    const manage = (): void => {
      setManaging(true);
      void load();
    };
    window.addEventListener(LICENCE_SETTINGS_EVENT, manage);
    return () => window.removeEventListener(LICENCE_SETTINGS_EVENT, manage);
  }, [load]);
  const closeManager = useCallback(() => setManaging(false), []);
  useDismissOnEscape(managing, closeManager);
  const openLicence = useCallback((): void => {
    window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT));
  }, []);
  const value = useMemo<EditionValue>(
    () => ({
      status: session.status,
      licensed: session.status?.channel === 'commercial',
      pro: session.status?.edition === 'pro',
      requestPro: session.requestPro,
      openLicence,
    }),
    [openLicence, session.requestPro, session.status],
  );
  useEffect(() => {
    setActiveEdition(value);
    return () => setActiveEdition(null);
  }, [value]);
  return (
    <EditionContext.Provider value={value}>
      {children}
      {managing ? (
        <div role="dialog" aria-modal="false" aria-label="KerfDesk licence" style={overlay}>
          <LicencePanel
            client={client}
            status={session.status}
            failure={session.failure}
            onStatus={session.accept}
            onRetry={load}
            onClose={closeManager}
          />
        </div>
      ) : null}
      {session.pending !== null && !managing ? (
        <ProFeatureDialog
          feature={session.pending.feature}
          client={client}
          status={session.status}
          onStatus={session.accept}
          onClose={() => session.settle(null)}
        />
      ) : null}
    </EditionContext.Provider>
  );
}

/** The saved licence, and the Pro request waiting on it, for one running app. */
function useLicenceSession(client: LicenceAdapter) {
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPro | null>(null);
  const statusRef = useRef<LicenceStatus | null>(null);
  const pendingRef = useRef<PendingPro | null>(null);
  const settle = useCallback((next: PendingPro | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);
  const accept = useCallback(
    async (result: LicenceStatus): Promise<void> => {
      statusRef.current = result;
      setStatus(result);
      setFailure(null);
      const waiting = pendingRef.current;
      if (waiting !== null && result.edition === 'pro') {
        // Pro was unlocked from the prompt: carry on into the tool that asked.
        settle(null);
        waiting.onAllowed?.();
      }
    },
    [settle],
  );
  const load = useCallback(async (): Promise<void> => {
    try {
      await accept(await client.status());
    } catch {
      setFailure('The licence service could not be reached. Please retry or restart KerfDesk.');
    }
  }, [accept, client]);
  useEffect(() => {
    void load();
  }, [load]);
  const requestPro = useCallback(
    (feature: ProFeature, onAllowed?: () => void): boolean => {
      if (statusRef.current?.edition === 'pro') {
        onAllowed?.();
        return true;
      }
      settle({ feature, onAllowed });
      return false;
    },
    [settle],
  );
  return { status, failure, pending, settle, accept, load, requestPro };
}

function useDismissOnEscape(open: boolean, close: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
}

// A nonmodal panel leaves the workspace usable and keyboard recovery active.
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
