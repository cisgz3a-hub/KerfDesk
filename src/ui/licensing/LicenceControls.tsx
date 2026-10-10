import { useState, type FormEvent } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { purchaseLabel, purchaseTitle, startPurchase } from './purchase-action';

type ActionProps = {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly busy: boolean;
  readonly run: (work: () => Promise<LicenceStatus>) => Promise<void>;
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
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <label htmlFor="kerfdesk-licence-key">Licence key</label>
      <input
        id="kerfdesk-licence-key"
        title="Paste the licence key from your purchase, or the key you were given"
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
        title="Unlock Pro on this device with the licence key"
        disabled={busy || value.trim().length < 8}
      >
        Activate licence
      </button>
    </form>
  );
}

/**
 * Shows the saved key so a buyer can activate their other devices and keep a
 * copy. Hidden until asked, like a password, so it isn't read over a shoulder.
 */
export function LicenceKeyDisplay({ licenseKey }: { readonly licenseKey: string }): JSX.Element {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(licenseKey);
      setCopied('copied');
    } catch {
      setShown(true);
      setCopied('failed');
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <label htmlFor="kerfdesk-saved-licence-key">Your licence key</label>
      <input
        id="kerfdesk-saved-licence-key"
        className="lf-input"
        readOnly
        value={licenseKey}
        type={shown ? 'text' : 'password'}
        spellCheck={false}
        title="Your licence key. Keep a copy: you need it for your other devices."
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--lf-font-mono)' }}
      />
      <div style={{ ...licenceButtons, marginTop: 0 }}>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setShown((value) => !value)}
          title={shown ? 'Hide the licence key' : 'Show the licence key'}
        >
          {shown ? 'Hide key' : 'Show key'}
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => void copy()}
          title="Copy the licence key to the clipboard"
        >
          Copy key
        </button>
      </div>
      <p role="status" style={licenceMuted}>
        {copied === 'copied'
          ? 'Licence key copied. Keep it somewhere safe.'
          : copied === 'failed'
            ? 'Copying was blocked. Select the key above and copy it yourself.'
            : 'Keep a copy of this key: you need it to activate Pro on your other devices.'}
      </p>
    </div>
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
        title="Try again to release this device's licence seat"
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
          title="Check the licence service for renewals and other changes"
        >
          Refresh licence
        </button>
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void run(client.deactivate)}
          title="Sign this device out of the licence and free its seat for another device"
        >
          Deactivate this device
        </button>
      </div>
    );
  if (status === null || status.state !== 'activation-required' || status.paymentPending)
    return <></>;
  return (
    <>
      <div style={licenceButtons}>
        <button
          type="button"
          className="lf-btn"
          disabled={busy}
          onClick={() => void run(client.startTrial)}
          title="Unlock every Pro tool on this device for 30 days"
        >
          Start free 30-day Pro trial
        </button>
      </div>
      <p style={licenceMuted}>
        Every Pro tool for 30 days on this device. Starting the trial needs an internet connection.
        No payment details required.
      </p>
    </>
  );
}

export function LicencePaymentActions(props: ActionProps): JSX.Element | null {
  const { status } = props;
  if (status?.paymentPending === true) return <PendingPaymentActions {...props} status={status} />;
  if (status?.tier === 'developer') return null;
  return <PurchaseAction {...props} />;
}

function PendingPaymentActions({
  client,
  status,
  busy,
  run,
}: ActionProps & { readonly status: LicenceStatus }): JSX.Element {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const forget = (): void => {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    void run(client.discardPayment);
  };
  return (
    <div style={licenceButtons}>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        disabled={busy}
        onClick={() => void run(client.claimPayment)}
        title="Ask the licence service whether your payment has completed"
      >
        Check payment
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={busy}
        onClick={() => void run(() => client.checkout('purchase'))}
        title="Open the saved checkout again without creating a new order"
      >
        Reopen checkout
      </button>
      <button
        type="button"
        className="lf-btn"
        disabled={busy}
        onClick={forget}
        title="Forget this saved order so you can start a new checkout"
      >
        {confirmDiscard ? 'Yes, forget this order' : 'Forget this order'}
      </button>
      <p style={licenceMuted}>
        {confirmDiscard
          ? 'Only forget the order if you did not pay. If you paid, choose Check payment instead, or contact support with the order number below.'
          : 'Your order is saved on this device. Only a payment confirmed by the licence service unlocks Pro.'}
        {status.paymentOrderId === null ? null : (
          <>
            {' '}
            Order number: <span style={{ userSelect: 'all' }}>{status.paymentOrderId}</span>
          </>
        )}
      </p>
    </div>
  );
}

function PurchaseAction({ client, status, busy, run }: ActionProps): JSX.Element {
  const unavailable =
    status === null || status.state === 'unavailable' || status.deactivationPending;
  return (
    <div style={licenceButtons}>
      <button
        type="button"
        className="lf-btn"
        disabled={busy || unavailable}
        onClick={() => void run(() => startPurchase(client, status))}
        title={purchaseTitle(status)}
      >
        {purchaseLabel(status)}
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
