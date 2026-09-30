import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { EarlyUpdatesOption } from './EarlyUpdatesOption';
import { licenceButtons, licenceMuted } from './LicenceControls';
import { updateCheckAllowed, updateStatusText } from './update-status-text';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: CommercialUpdateStatus | null;
  /** The licence's end of updates, in seconds, when it has one. */
  readonly updatesUntil: number | null;
  readonly onCheck: () => Promise<void>;
  readonly busy: boolean;
  readonly onDownload: () => Promise<void>;
  readonly onInstallOnQuit: () => Promise<void>;
  readonly onClose: () => void;
};

/**
 * Help > Check for Updates (ADR-547): the version this computer runs, where
 * its updates stand, Check now, and the beta choice (ADR-541). A licence or
 * update never stops a running job. Manual installers require explicit consent
 * and wait for the normal close flow.
 */
export function UpdatesPanel({
  client,
  status,
  updatesUntil,
  onCheck,
  busy: requestBusy,
  onDownload,
  onInstallOnQuit,
  onClose,
}: Props): JSX.Element {
  const busy = requestBusy || status?.state === 'checking' || status?.state === 'downloading';
  const updating = status !== null && status.state !== 'unavailable';
  return (
    <section style={panel} aria-busy={busy}>
      <div style={heading}>
        <h1 style={{ margin: 0, fontSize: 24 }}>KerfDesk updates</h1>
        <button
          type="button"
          className="lf-btn"
          onClick={onClose}
          aria-label="Close updates"
          title="Close updates"
        >
          Close
        </button>
      </div>
      {status === null ? null : (
        <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>
          You have KerfDesk {status.currentVersion}
        </p>
      )}
      <p role="status" style={{ lineHeight: 1.5 }}>
        {updateStatusText(status, updatesUntil)}
      </p>
      <UpdateActions
        client={client}
        status={status}
        busy={busy}
        onCheck={onCheck}
        onDownload={onDownload}
        onInstallOnQuit={onInstallOnQuit}
      />
      <EarlyUpdatesOption client={client} />
      {updating ? (
        <p style={licenceMuted}>
          {status?.mode === 'manual'
            ? 'You choose when to download and prepare an installation. KerfDesk stays open while you work.'
            : 'New versions download in the background and install when you close KerfDesk.'}
        </p>
      ) : null}
    </section>
  );
}

function UpdateActions({
  client,
  status,
  busy,
  onCheck,
  onDownload,
  onInstallOnQuit,
}: Pick<
  Props,
  'client' | 'status' | 'busy' | 'onCheck' | 'onDownload' | 'onInstallOnQuit'
>): JSX.Element | null {
  if (status === null || status.state === 'unavailable') return null;
  return (
    <div style={licenceButtons}>
      <button
        type="button"
        className="lf-btn"
        disabled={busy || !updateCheckAllowed(status)}
        onClick={() => void onCheck()}
        title="Look for a newer version of KerfDesk now"
      >
        Check now
      </button>
      {status.mode === 'manual' && status.state === 'available' ? (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={busy || client.downloadUpdate === undefined}
          onClick={() => void onDownload()}
          title="Download and verify this update while KerfDesk stays open. Installation is a separate choice."
        >
          Download update
        </button>
      ) : null}
      {status.mode === 'manual' && status.state === 'ready' && status.installOnQuit !== true ? (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={busy || client.installUpdateOnQuit === undefined}
          onClick={() => void onInstallOnQuit()}
          title="Prepare the verified installer to open after you close KerfDesk normally. This does not close the app or interrupt a job."
        >
          Install when I close KerfDesk
        </button>
      ) : null}
    </div>
  );
}

const heading = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
} as const;

const panel = {
  width: '100%',
  maxWidth: 480,
  padding: 28,
  boxSizing: 'border-box',
  background: 'var(--lf-bg-1)',
  borderRadius: 8,
  color: 'var(--lf-text)',
  fontFamily: 'var(--lf-font)',
} as const;
