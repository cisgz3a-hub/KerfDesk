import { useState, type FormEvent } from 'react';
import type { DesktopLicenceAdapter, DesktopLicenceStatus } from '../../platform/types';
import {
  LicenceActivationForm,
  LicenceDeviceActions,
  LicencePaymentActions,
  licenceMuted,
} from './LicenceControls';

type Props = {
  readonly client: DesktopLicenceAdapter;
  readonly status: DesktopLicenceStatus | null;
  readonly failure: string | null;
  readonly onStatus: (status: DesktopLicenceStatus) => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onClose?: () => void;
};

export function LicencePanel({
  client,
  status,
  failure,
  onStatus,
  onRetry,
  onClose,
}: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<DesktopLicenceStatus>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStatus(await work());
      setKey('');
    } catch {
      setError('This request could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const activate = (event: FormEvent): void => {
    event.preventDefault();
    void run(() => client.activate(key.trim()));
  };
  if (status?.channel === 'free')
    return (
      <section style={panel}>
        <LicenceHeading onClose={onClose} />
        <p>Free desktop edition</p>
        <p style={licenceMuted}>
          This Preview or source build is free to use. No licence or activation is required.
        </p>
      </section>
    );
  const message = error ?? failure ?? status?.message;
  return (
    <section style={panel} aria-busy={busy}>
      <LicenceHeading onClose={onClose} />
      <p style={licenceMuted}>Commercial desktop edition</p>
      <LicenceNotice
        status={status}
        failure={failure}
        message={message}
        busy={busy}
        onRetry={onRetry}
      />
      {status?.deactivationPending === true ? null : (
        <LicenceActivationForm value={key} setValue={setKey} busy={busy} submit={activate} />
      )}
      <LicenceDeviceActions client={client} status={status} busy={busy} run={run} />
      <LicencePaymentActions client={client} status={status} busy={busy} run={run} />
      <p style={licenceMuted}>
        A paid licence covers three devices and keeps working with eligible versions after its first
        year of updates. Developer licences include ongoing access and updates.
      </p>
      <p style={licenceMuted}>
        Licence changes take effect at the next launch. They never stop an open workspace or an
        ongoing machine operation.
      </p>
    </section>
  );
}

function LicenceHeading({ onClose }: { readonly onClose: (() => void) | undefined }): JSX.Element {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
    >
      <h1 style={{ margin: 0, fontSize: 24 }}>
        {onClose === undefined ? 'Welcome to KerfDesk' : 'Your KerfDesk licence'}
      </h1>
      {onClose === undefined ? null : (
        <button
          type="button"
          className="lf-btn"
          onClick={onClose}
          aria-label="Close licence settings"
          title="Close licence settings"
        >
          Close
        </button>
      )}
    </div>
  );
}

function LicenceNotice({
  status,
  failure,
  message,
  busy,
  onRetry,
}: Pick<Props, 'status' | 'failure' | 'onRetry'> & {
  readonly message: string | null | undefined;
  readonly busy: boolean;
}): JSX.Element {
  return (
    <>
      {status === null && failure === null ? (
        <p role="status">Checking your saved licence...</p>
      ) : null}
      {status === null || status.tier === null ? null : <p>{licenceDescription(status)}</p>}
      {message === null || message === undefined ? null : (
        <p role="status" style={{ lineHeight: 1.5 }}>
          {message}
        </p>
      )}
      {failure === null ? null : (
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void onRetry()}
          title="Try reading your saved licence again"
        >
          Retry licence check
        </button>
      )}
    </>
  );
}

function date(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
}
function licenceDescription(status: DesktopLicenceStatus): string {
  if (status.tier === 'developer') return 'Developer licence · Permanent access and updates';
  if (status.tier === 'trial')
    return `30-day trial${status.accessExpiresAt === null ? '' : ` · Ends ${date(status.accessExpiresAt)}`}`;
  return `Perpetual licence${status.updatesUntil === null ? '' : ` · Updates through ${date(status.updatesUntil)}`}`;
}
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
