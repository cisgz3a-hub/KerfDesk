import { useState, type FormEvent } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EarlyUpdatesOption } from './EarlyUpdatesOption';
import {
  LicenceActivationForm,
  LicenceDeviceActions,
  LicenceKeyDisplay,
  LicencePaymentActions,
  licenceButtons,
  licenceMuted,
} from './LicenceControls';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly failure: string | null;
  readonly onStatus: (status: LicenceStatus) => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onClose: () => void;
};

/** Help > Licence: the edition, the saved key and every licence action (ADR-540). */
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
  const run = async (work: () => Promise<LicenceStatus>, activatedKey?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await work();
      await onStatus(next);
      // Failures may resolve with cached rights. Only clear a confirmed matching
      // activation, never a rejected key or an unrelated licence action.
      if (
        activatedKey !== undefined &&
        next.state === 'ready' &&
        next.licenseKey === activatedKey &&
        next.message === null
      )
        setKey('');
    } catch {
      setError('This request could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const activate = (event: FormEvent): void => {
    event.preventDefault();
    const submitted = key.trim();
    void run(() => client.activate(submitted), submitted);
  };
  if (status?.channel === 'free') return <EveryFeaturePanel onClose={onClose} />;
  return (
    <section style={panel} aria-busy={busy}>
      <LicenceHeading onClose={onClose} />
      <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>{editionTitle(status)}</p>
      <LicenceNotice
        status={status}
        failure={failure}
        message={error ?? failure ?? status?.message}
        busy={busy}
        onRetry={onRetry}
      />
      <SavedLicence client={client} status={status} busy={busy} run={run} />
      {offersActivation(status) ? (
        <LicenceActivationForm value={key} setValue={setKey} busy={busy} submit={activate} />
      ) : null}
      <LicenceDeviceActions client={client} status={status} busy={busy} run={run} />
      <LicencePaymentActions client={client} status={status} busy={busy} run={run} />
      <EarlyUpdatesOption client={client} />
      <EditionSummary />
    </section>
  );
}

function EveryFeaturePanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <section style={panel}>
      <LicenceHeading onClose={onClose} />
      <p>Every feature included</p>
      <p style={licenceMuted}>
        This Preview or source build includes every tool. No licence or activation is needed.
      </p>
    </section>
  );
}

function SavedLicence({
  client,
  status,
  busy,
  run,
}: {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly busy: boolean;
  readonly run: (work: () => Promise<LicenceStatus>) => Promise<void>;
}): JSX.Element | null {
  if (status === null) return null;
  return (
    <>
      {status.licenseKey === null ? null : <LicenceKeyDisplay licenseKey={status.licenseKey} />}
      {status.storeUnreadable || status.deactivationPending ? (
        <div style={licenceButtons}>
          <button
            type="button"
            className="lf-btn"
            disabled={busy}
            onClick={() => void run(client.resetStore)}
            title="Clear the stuck saved licence so you can activate again with your key"
          >
            Reset saved licence
          </button>
        </div>
      ) : null}
    </>
  );
}

function EditionSummary(): JSX.Element {
  return (
    <>
      <p style={licenceMuted}>
        Free covers drawing, text, import, basic trace, laser cut and engrave, 2D CNC cuts and all
        machine control. Pro adds V-carve, 3D relief, adaptive clearing, advanced tracing, camera
        alignment, the box generator, Design Studio and the G-code Inspector.
      </p>
      <p style={licenceMuted}>
        A Pro licence runs on three devices at a time and keeps working with every version released
        during its year of updates. Licence changes never stop a job that is running.
      </p>
    </>
  );
}

function editionTitle(status: LicenceStatus | null): string {
  if (status === null) return 'KerfDesk';
  return status.edition === 'pro' ? 'KerfDesk Pro' : 'KerfDesk Free';
}

function offersActivation(status: LicenceStatus | null): boolean {
  if (status === null || status.deactivationPending) return false;
  return status.tier === null || status.state !== 'ready';
}

function LicenceHeading({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
    >
      <h1 style={{ margin: 0, fontSize: 24 }}>Your KerfDesk licence</h1>
      <button
        type="button"
        className="lf-btn"
        onClick={onClose}
        aria-label="Close licence settings"
        title="Close licence settings"
      >
        Close
      </button>
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
export function licenceDescription(status: LicenceStatus): string {
  if (status.tier === 'developer') return 'Developer licence · Every Pro tool and every update';
  if (status.tier === 'trial')
    return `30-day Pro trial${status.accessExpiresAt === null ? '' : ` · Ends ${date(status.accessExpiresAt)}`}`;
  return `Pro licence${status.updatesUntil === null ? '' : ` · Updates through ${date(status.updatesUntil)}`}`;
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
