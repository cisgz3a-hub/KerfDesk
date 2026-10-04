import { useId } from 'react';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { EarlyUpdatesOption } from './EarlyUpdatesOption';
import { licenceButtons, licenceMuted } from './LicenceControls';
import { updateCheckAllowed, updateStatusText } from './update-status-text';
import { ManualUpdateInstallActions } from './ManualUpdateInstallActions';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: CommercialUpdateStatus | null;
  /** The licence's end of updates, in seconds, when it has one. */
  readonly updatesUntil: number | null;
  readonly onCheck: () => Promise<void>;
  readonly busy: boolean;
  readonly feedback?: string | null | undefined;
  readonly onDownload: () => Promise<void>;
  readonly onInstallOnQuit: () => Promise<void>;
  readonly onInstallAndClose?: (() => Promise<void>) | undefined;
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
  feedback,
  onDownload,
  onInstallOnQuit,
  onInstallAndClose,
  onClose,
}: Props): JSX.Element {
  const busy = requestBusy || status?.state === 'checking' || status?.state === 'downloading';
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
      <div style={details} role="region" aria-label="Update details" tabIndex={0}>
        <UpdateDetails
          client={client}
          status={status}
          updatesUntil={updatesUntil}
          feedback={feedback}
        />
      </div>
      <UpdateActions
        client={client}
        status={status}
        busy={busy}
        onCheck={onCheck}
        onDownload={onDownload}
        onInstallOnQuit={onInstallOnQuit}
        onInstallAndClose={onInstallAndClose}
      />
    </section>
  );
}

function UpdateDetails({
  client,
  status,
  updatesUntil,
  feedback,
}: Pick<Props, 'client' | 'status' | 'updatesUntil' | 'feedback'>): JSX.Element {
  const updating = status !== null && status.state !== 'unavailable';
  return (
    <>
      {status === null ? null : (
        <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>
          You have KerfDesk {status.currentVersion}
        </p>
      )}
      <p role="status" style={{ lineHeight: 1.5 }}>
        {feedback ?? updateStatusText(status, updatesUntil)}
      </p>
      {status?.state === 'downloading' && status.downloadProgress !== undefined ? (
        <progress
          aria-label="Update download progress"
          max={status.downloadProgress.totalBytes}
          value={status.downloadProgress.receivedBytes}
          style={{ width: '100%' }}
        />
      ) : null}
      <ReleaseSummary status={status} />
      <EarlyUpdatesOption client={client} />
      {updating ? (
        <p style={licenceMuted}>
          {status?.mode === 'manual'
            ? 'Download while you work, then choose Install and close KerfDesk or install when you close later. The app asks about unsaved changes and waits while machine work is active.'
            : 'New versions download in the background and install when you close KerfDesk.'}
        </p>
      ) : null}
    </>
  );
}

function ReleaseSummary({ status }: Pick<Props, 'status'>): JSX.Element | null {
  const headingId = useId();
  if (
    !status?.version ||
    !['available', 'downloading', 'ready', 'not-covered'].includes(status.state)
  )
    return null;
  const loading = status.releaseNotesState === 'loading';
  const notes =
    status.releaseNotesState === 'available'
      ? (status.releaseNotes?.slice(0, 6).map((note) => Array.from(note).slice(0, 240).join('')) ??
        [])
      : [];
  return (
    <section aria-labelledby={headingId} style={summary}>
      <p style={{ ...licenceMuted, margin: '0 0 4px', fontWeight: 600 }}>
        KerfDesk {status.version}
      </p>
      <h2 id={headingId} style={{ margin: 0, fontSize: 17 }}>
        What’s improved
      </h2>
      <div aria-live="polite" aria-busy={loading}>
        {notes.length > 0 ? (
          <ul style={summaryList}>
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : (
          <p style={{ ...licenceMuted, margin: '10px 0 0' }}>
            {loading
              ? 'Loading the release summary…'
              : 'No release summary is available for this version.'}
          </p>
        )}
      </div>
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
  onInstallAndClose,
}: Pick<
  Props,
  'client' | 'status' | 'busy' | 'onCheck' | 'onDownload' | 'onInstallOnQuit' | 'onInstallAndClose'
>): JSX.Element | null {
  if (status === null || status.state === 'unavailable') return null;
  return (
    <div style={{ ...licenceButtons, flexShrink: 0 }}>
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
      <ManualUpdateInstallActions
        client={client}
        status={status}
        busy={busy}
        onInstallOnQuit={onInstallOnQuit}
        onInstallAndClose={onInstallAndClose}
      />
    </div>
  );
}

const heading = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  flexShrink: 0,
} as const;

const panel = {
  width: '100%',
  maxWidth: 480,
  maxHeight: 'calc(100dvh - 82px)',
  display: 'flex',
  flexDirection: 'column',
  padding: 'clamp(16px, 4vw, 28px)',
  boxSizing: 'border-box',
  background: 'var(--lf-bg-1)',
  borderRadius: 8,
  color: 'var(--lf-text)',
  fontFamily: 'var(--lf-font)',
} as const;

const details = {
  minHeight: 0,
  overflowY: 'auto',
  overflowWrap: 'anywhere',
  paddingRight: 4,
} as const;

const summary = {
  padding: 16,
  margin: '16px 0',
  border: '1px solid var(--lf-border-strong)',
  borderRadius: 8,
  background: 'var(--lf-bg-2, var(--lf-bg-1))',
} as const;

const summaryList = {
  display: 'grid',
  gap: 8,
  paddingLeft: 20,
  margin: '12px 0 0',
  fontSize: 14,
  lineHeight: 1.5,
} as const;
