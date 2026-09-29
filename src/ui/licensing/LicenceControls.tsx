import type { FormEvent } from 'react';
import type { DesktopLicenceAdapter, DesktopLicenceStatus } from '../../platform/types';

type ActionProps = {
  readonly client: DesktopLicenceAdapter;
  readonly status: DesktopLicenceStatus | null;
  readonly busy: boolean;
  readonly run: (work: () => Promise<DesktopLicenceStatus>) => Promise<void>;
};

export function LicenceActivationForm({
  value,
  setValue,
  busy,
  submit,
}: {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly busy: boolean;
  readonly submit: (event: FormEvent) => void;
}): JSX.Element {
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <label htmlFor="kerfdesk-licence-key">Licence key</label>
      <input
        id="kerfdesk-licence-key"
        className="lf-input"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={256}
        disabled={busy}
        placeholder="Enter your licence key"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <button
        type="submit"
        className="lf-btn lf-btn--primary"
        disabled={busy || value.trim().length < 8}
      >
        Activate licence
      </button>
    </form>
  );
}

export function LicenceDeviceActions({ client, status, busy, run }: ActionProps): JSX.Element {
  if (status?.deactivationPending === true)
    return (
      <button
        type="button"
        className="lf-btn"
        disabled={busy}
        onClick={() => void run(client.deactivate)}
      >
        Retry device deactivation
      </button>
    );
  if (status !== null && status.tier !== null)
    return (
      <div style={licenceButtons}>
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void run(client.refresh)}
        >
          Refresh licence
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void run(client.deactivate)}
        >
          Deactivate this device
        </button>
      </div>
    );
  return (
    <>
      <div style={licenceButtons}>
        <button
          type="button"
          className="lf-btn"
          disabled={busy || status === null || status.state === 'unavailable'}
          onClick={() => void run(client.startTrial)}
        >
          Start free 30-day trial
        </button>
      </div>
      <p style={licenceMuted}>
        All desktop features for 30 days. Starting the trial needs an internet connection. No
        payment details required.
      </p>
    </>
  );
}

export function LicencePaymentActions({
  client,
  status,
  busy,
  run,
}: ActionProps): JSX.Element | null {
  if (status?.paymentPending === true)
    return (
      <div style={licenceButtons}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={busy}
          onClick={() => void run(client.claimPayment)}
        >
          Check payment
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void run(() => client.checkout('purchase'))}
        >
          Reopen checkout
        </button>
        <p style={licenceMuted}>
          Your order is saved on this device. Only a payment confirmed by the licence service can
          unlock the app.
        </p>
      </div>
    );
  if (status?.tier === 'developer') return null;
  return (
    <div style={licenceButtons}>
      <button
        type="button"
        className="lf-btn"
        disabled={
          busy || status === null || status.state === 'unavailable' || status.deactivationPending
        }
        onClick={() =>
          void run(() => client.checkout(status?.tier === 'paid' ? 'renewal' : 'purchase'))
        }
      >
        {status?.tier === 'paid' ? 'Renew updates · US$20' : 'Buy licence · US$49.50'}
      </button>
    </div>
  );
}

export const licenceButtons = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  marginTop: 18,
} as const;
export const licenceMuted = {
  fontSize: 13,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.5,
} as const;
