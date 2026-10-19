import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { usePlatformOptional } from '../app/platform-context';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { installDesktopCloseReceiver } from '../app/desktop-close-runtime';
import { LicenceDevicesPanel } from './LicenceDevicesPanel';
import {
  LicenceActivationForm,
  LicenceDeviceActions,
  LicencePaymentActions,
  licenceButtons,
} from './LicenceControls';
import {
  EditionSummary,
  LicenceNotice,
  SavedLicence,
  licencePanelStyle,
  offersActivation,
} from './LicencePanel';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { useLicenceActions } from './use-licence-actions';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly failure: string | null;
  readonly onStatus: (status: LicenceStatus) => Promise<void>;
  readonly onRetry: () => Promise<void>;
  /** A key to start with: the one a kerfdesk://licence link found on the clipboard. */
  readonly initialKey?: string;
};

export const LICENCE_GATE_LABEL = 'Activate KerfDesk';

/**
 * The window a commercial desktop build opens behind until this device has an
 * active trial or licence (ADR-623). It stands in place of the workspace, so no
 * menu, shortcut, project, machine or remote command runs behind it. It has no
 * Close and ignores Escape: activating, or Quit KerfDesk, are the only ways out.
 */
export function DesktopLicenceGate({
  client,
  status,
  failure,
  onStatus,
  onRetry,
  initialKey = '',
}: Props): JSX.Element {
  const { key, setKey, busy, error, run, activate } = useLicenceActions(
    client,
    onStatus,
    initialKey,
  );
  const dialog = useRef<HTMLElement>(null);
  const checkUpdates = useRef<HTMLButtonElement>(null);
  // Check for updates opens its panel over this window: it then holds the
  // modal role, so assistive technology can reach it.
  const updatesOpen = useCommercialUpdateStore((state) => state.controls?.panelOpen === true);
  useEffect(() => dialog.current?.focus(), []);
  useUpdatesHandOff(dialog, checkUpdates, updatesOpen);
  // The workspace has not mounted its close receiver yet (ADR-623). Keep the
  // ordinary guarded handoff available for Quit and the native window close.
  useEffect(() => installDesktopCloseReceiver(window), []);
  return (
    <div style={backdrop}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal={!updatesOpen}
        aria-hidden={updatesOpen || undefined}
        aria-label={LICENCE_GATE_LABEL}
        aria-busy={busy}
        // The splash and native qualification wait for a settled state: a
        // status, or a failed first read showing Retry, not the first check.
        data-licence-state={settledState(status, failure)}
        tabIndex={-1}
        style={card}
      >
        <div style={wordmark} aria-hidden="true">
          Kerf<span style={{ color: 'var(--lf-accent)' }}>Desk</span>
        </div>
        <h1 style={titleStyle}>{LICENCE_GATE_LABEL}</h1>
        <p style={leadStyle}>{gateLead(status)}</p>
        <LicenceNotice
          status={status}
          failure={failure}
          message={error ?? failure ?? status?.message}
          busy={busy}
          onRetry={onRetry}
        />
        <SavedLicence client={client} status={status} busy={busy} run={run} />
        <LicenceDeviceActions client={client} status={status} busy={busy} run={run} />
        {offersActivation(status) ? (
          <LicenceActivationForm
            value={key}
            setValue={setKey}
            busy={busy}
            submit={activate}
            client={client}
          />
        ) : null}
        <LicenceDevicesPanel client={client} status={status} typedKey={key} busy={busy} />
        <LicencePaymentActions client={client} status={status} busy={busy} run={run} />
        <EditionSummary />
        <GateExits checkUpdates={checkUpdates} />
      </section>
    </div>
  );
}

/**
 * While the updates panel is open over this window, the window is inert, so
 * neither Tab nor assistive technology reaches it, and focus moves into the
 * panel; it comes back to Check for updates when the panel closes.
 */
function useUpdatesHandOff(
  dialog: RefObject<HTMLElement>,
  checkUpdates: RefObject<HTMLButtonElement>,
  updatesOpen: boolean,
): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (dialog.current !== null) dialog.current.inert = updatesOpen;
    if (updatesOpen) {
      const panel = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="KerfDesk updates"]',
      );
      panel?.querySelector<HTMLElement>('button:not(:disabled), a[href], input, select')?.focus();
    } else if (wasOpen.current) checkUpdates.current?.focus();
    wasOpen.current = updatesOpen;
  }, [checkUpdates, dialog, updatesOpen]);
}

/** Quit KerfDesk closes the app as its window's X does. */
function useQuit(): () => void {
  const desktopWindow = usePlatformOptional()?.desktopWindow;
  return useCallback(() => {
    if (desktopWindow === undefined) window.close();
    else void desktopWindow.exit().catch(() => window.close());
  }, [desktopWindow]);
}

function GateExits({
  checkUpdates,
}: {
  readonly checkUpdates: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const quit = useQuit();
  return (
    <div style={{ ...licenceButtons, justifyContent: 'space-between' }}>
      <button
        ref={checkUpdates}
        type="button"
        className="lf-btn lf-btn--ghost"
        onClick={() => window.dispatchEvent(new Event(CHECK_UPDATES_EVENT))}
        title="See whether a newer version of KerfDesk is available"
      >
        Check for updates
      </button>
      <button
        type="button"
        className="lf-btn"
        onClick={quit}
        title="Close KerfDesk without activating it"
      >
        Quit KerfDesk
      </button>
    </div>
  );
}

function settledState(status: LicenceStatus | null, failure: string | null): string {
  if (status !== null) return status.state;
  return failure === null ? 'checking' : 'unreachable';
}

function gateLead(status: LicenceStatus | null): string {
  if (status !== null && status.tier !== null)
    return 'KerfDesk opens once this device’s licence is in order.';
  return 'Start a free 30-day trial, or enter your licence key, to open KerfDesk.';
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  // Below the updates panel (1000), which Check for updates opens over this.
  zIndex: 900,
  display: 'flex',
  alignItems: 'safe center',
  justifyContent: 'center',
  padding: 16,
  overflow: 'auto',
  background: 'var(--lf-bg-0)',
};
const card: React.CSSProperties = {
  ...licencePanelStyle,
  maxWidth: 520,
  border: '1px solid var(--lf-border-strong)',
  boxShadow: 'var(--lf-shadow)',
  outline: 'none',
};
const wordmark: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 750,
  letterSpacing: -1,
  marginBottom: 14,
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 24 };
const leadStyle: React.CSSProperties = { margin: '8px 0 4px', lineHeight: 1.5 };
