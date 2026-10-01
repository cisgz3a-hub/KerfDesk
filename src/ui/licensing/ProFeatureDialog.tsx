import { useState, type FormEvent } from 'react';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { Button, Dialog, DialogActions } from '../kit';
import { LicenceActivationForm, licenceMuted } from './LicenceControls';
import {
  PRO_FEATURES,
  PRO_PRICE_LABEL,
  RENEWAL_PRICE_LABEL,
  type ProFeature,
} from './pro-features';

type Props = {
  readonly feature: ProFeature;
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  readonly onStatus: (status: LicenceStatus) => Promise<void>;
  readonly onClose: () => void;
};

/**
 * Explains a locked Pro tool and offers the ways to unlock it (ADR-540). If Pro
 * becomes available here, the provider closes this and opens the tool.
 */
export function ProFeatureDialog({
  feature,
  client,
  status,
  onStatus,
  onClose,
}: Props): JSX.Element {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tool = PRO_FEATURES[feature];
  const run = async (work: () => Promise<LicenceStatus>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onStatus(await work());
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
  const message = error ?? status?.message ?? null;
  return (
    <Dialog size="sm" title={`${tool.name} is a Pro tool`} onClose={onClose}>
      <p style={bodyStyle}>{tool.summary}</p>
      <p role={status === null ? 'status' : undefined} style={bodyStyle}>
        {status === null ? 'Checking your licence…' : lead(status)}
      </p>
      {message === null ? null : (
        <p role="status" style={licenceMuted}>
          {message}
        </p>
      )}
      {showKey ? (
        <LicenceActivationForm value={key} setValue={setKey} busy={busy} submit={activate} />
      ) : null}
      <DialogActions>
        {status === null ? null : (
          <UnlockButtons client={client} status={status} busy={busy} run={run} />
        )}
        {showKey || status === null ? null : (
          <Button
            disabled={busy}
            onClick={() => setShowKey(true)}
            title="Activate Pro with a licence key you already have"
          >
            I have a licence key
          </Button>
        )}
        <Button onClick={onClose}>Not now</Button>
      </DialogActions>
      <p style={licenceMuted}>
        Everything else in KerfDesk stays free, and a licence never stops a job that is running.
      </p>
    </Dialog>
  );
}

function UnlockButtons({
  client,
  status,
  busy,
  run,
}: {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus;
  readonly busy: boolean;
  readonly run: (work: () => Promise<LicenceStatus>) => Promise<void>;
}): JSX.Element {
  const trial = offersTrial(status);
  const renewal = status.tier === 'paid';
  return (
    <>
      {trial ? (
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void run(client.startTrial)}
          title="Unlock every Pro tool on this device for 30 days"
        >
          Start free 30-day trial
        </Button>
      ) : null}
      {offersPurchase(status) ? (
        <Button
          variant={trial ? 'default' : 'primary'}
          disabled={busy}
          onClick={() => void run(() => client.checkout(renewal ? 'renewal' : 'purchase'))}
        >
          {renewal ? `Renew updates · ${RENEWAL_PRICE_LABEL}` : `Buy Pro · ${PRO_PRICE_LABEL}`}
        </Button>
      ) : null}
    </>
  );
}

function offersTrial(status: LicenceStatus): boolean {
  return (
    status.state === 'activation-required' &&
    status.tier === null &&
    !status.deactivationPending &&
    !status.paymentPending
  );
}

function offersPurchase(status: LicenceStatus): boolean {
  return (
    status.channel === 'commercial' &&
    status.state !== 'unavailable' &&
    status.tier !== 'developer' &&
    !status.deactivationPending &&
    !status.paymentPending
  );
}

function lead(status: LicenceStatus): string {
  if (status.paymentPending)
    return 'Your order is saved. Open Help > Licence and choose Check payment once you have paid.';
  if (status.deactivationPending)
    return 'This device is still signing out of its licence. Open Help > Licence to finish.';
  switch (status.state) {
    case 'trial-expired':
      return 'Your Pro trial on this device has ended. Buy Pro, or enter your licence key.';
    case 'updates-expired':
      return 'This version is newer than your licence’s included updates. Renew updates to use Pro in it.';
    case 'activation-required':
      return `Try every Pro tool free for 30 days on this device, no card needed, or buy Pro once for ${PRO_PRICE_LABEL}. It includes a year of updates and runs on three devices.`;
    case 'ready':
    case 'invalid-licence':
    case 'unavailable':
    case 'clock-error':
      return 'Pro tools are locked on this device right now. Open Help > Licence for details.';
  }
}

const bodyStyle: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 };
