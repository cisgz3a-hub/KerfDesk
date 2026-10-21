import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { DESKTOP_LICENCE_WINDOW } from '../../../public/desktop-licence-window.mjs';
import { EarlyUpdatesOption } from './EarlyUpdatesOption';
import { LicenceDevicesPanel } from './LicenceDevicesPanel';
import {
  LicenceActivationForm,
  LicenceDeviceActions,
  LicenceKeyDisplay,
  LicencePaymentActions,
  licenceButtons,
  licenceMuted,
} from './LicenceControls';
import { PRO_PRICE_LABEL } from './pro-features';
import { useLicenceActions } from './use-licence-actions';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly failure: string | null;
  readonly onStatus: (status: LicenceStatus) => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onClose: () => void;
  /** A key to start with: the one a kerfdesk://licence link found on the clipboard. */
  readonly initialKey?: string;
};

/** Help > Licence: the licence, the saved key and every licence action (ADR-540, ADR-623). */
export function LicencePanel({
  client,
  status,
  failure,
  onStatus,
  onRetry,
  onClose,
  initialKey = '',
}: Props): JSX.Element {
  const { key, setKey, busy, error, run, activate } = useLicenceActions(
    client,
    onStatus,
    initialKey,
  );
  if (status?.channel === 'free') return <EveryFeaturePanel onClose={onClose} />;
  return (
    <section style={licencePanelStyle} aria-busy={busy}>
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
        <LicenceActivationForm
          value={key}
          setValue={setKey}
          busy={busy}
          submit={activate}
          client={client}
        />
      ) : null}
      <LicenceDeviceActions client={client} status={status} busy={busy} run={run} />
      <LicenceDevicesPanel client={client} status={status} typedKey={key} busy={busy} />
      <LicencePaymentActions client={client} status={status} busy={busy} run={run} />
      <EarlyUpdatesOption client={client} />
      <EditionSummary />
    </section>
  );
}

function EveryFeaturePanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <section style={licencePanelStyle}>
      <LicenceHeading onClose={onClose} />
      <p>Every feature included</p>
      <p style={licenceMuted}>
        This Preview or source build includes every tool. No licence or activation is needed.
      </p>
    </section>
  );
}

export function SavedLicence({
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

/**
 * What a desktop licence includes. Behind the licence window, KerfDesk Free is
 * the browser app (ADR-623); while Amendment 3 holds the window off, the desktop
 * app runs Free too and a licence adds Pro (ADR-540).
 */
export function EditionSummary(): JSX.Element {
  if (!DESKTOP_LICENCE_WINDOW)
    return (
      <>
        <p style={licenceMuted}>
          Free covers drawing, text, import, Line Art tracing, laser cut and engrave, 2D CNC cuts,
          the G-code Inspector and all machine control. Pro adds V-carve, 3D relief, adaptive
          clearing, advanced tracing, camera alignment, the Registration Jig, Place Board, the box
          generator and Design Studio.
        </p>
        <p style={licenceMuted}>
          A Pro licence runs on three devices at a time and keeps working with every version
          released during its year of updates. Licence changes never stop a job that is running.
        </p>
      </>
    );
  return (
    <>
      <p style={licenceMuted}>
        The KerfDesk desktop app runs with a free 30-day trial or a licence, {PRO_PRICE_LABEL} once.
        A licence runs on three devices at a time and keeps working with every version released
        during its year of updates. Licence changes never stop a job that is running.
      </p>
      <p style={licenceMuted}>KerfDesk Free, with no licence, runs in your web browser.</p>
    </>
  );
}

function editionTitle(status: LicenceStatus | null): string {
  if (status === null) return 'KerfDesk';
  if (status.edition === 'pro') return 'KerfDesk Pro';
  return DESKTOP_LICENCE_WINDOW ? 'Licence needed' : 'KerfDesk Free';
}

export function offersActivation(status: LicenceStatus | null): boolean {
  if (status === null || status.deactivationPending) return false;
  return status.tier === null || status.tier === 'trial' || status.state !== 'ready';
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

export function LicenceNotice({
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
export const licencePanelStyle = {
  width: '100%',
  maxWidth: 480,
  padding: 28,
  boxSizing: 'border-box',
  background: 'var(--lf-bg-1)',
  borderRadius: 8,
  color: 'var(--lf-text)',
  fontFamily: 'var(--lf-font)',
} as const;
