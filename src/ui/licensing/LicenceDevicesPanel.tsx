import { useState } from 'react';
import type {
  LicenceAdapter,
  LicenceDevice,
  LicenceDevices,
  LicenceStatus,
} from '../../platform/types';
import { licenceButtons, licenceMuted } from './LicenceControls';

type Props = {
  readonly client: LicenceAdapter;
  readonly status: LicenceStatus | null;
  /** The key typed into the activation form, used when no key is saved yet. */
  readonly typedKey: string;
  readonly busy: boolean;
};
type DeviceClient = Required<Pick<LicenceAdapter, 'devices' | 'releaseDevice'>>;

const REQUEST_FAILED = 'This request could not be completed. Please try again.';
const SEATS =
  'Each computer counts as one of the licence’s three seats. Remove a computer you no longer use so another can activate. This computer keeps Pro until its next licence check if you remove it here; prefer Deactivate this device for that.';

/** The key the panel manages with: the saved one, or else what is typed (undefined means saved). */
function managedKey(status: LicenceStatus | null, typedKey: string): string | undefined | null {
  if (status === null || status.state === 'unavailable') return null;
  if (status.licenseKey !== null) return undefined;
  const typed = typedKey.trim();
  return typed.length >= 8 ? typed : null;
}

function deviceClient(client: LicenceAdapter): DeviceClient | null {
  return client.devices !== undefined && client.releaseDevice !== undefined
    ? { devices: client.devices, releaseDevice: client.releaseDevice }
    : null;
}

/**
 * Help > Licence > Manage devices: the computers the licence key is active on,
 * with a Remove action for each. This is how an owner frees the seat of a lost,
 * replaced or reinstalled computer, which can no longer deactivate itself.
 * Removing a seat changes nothing on this device until its next licence check.
 */
export function LicenceDevicesPanel({ client, status, typedKey, busy }: Props): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [result, setResult] = useState<LicenceDevices | null>(null);
  const key = managedKey(status, typedKey);
  const adapter = deviceClient(client);
  if (key === null || adapter === null) return null;
  const run = async (work: () => Promise<LicenceDevices>): Promise<void> => {
    if (working) return;
    setWorking(true);
    setConfirm(null);
    try {
      setResult(await work());
    } catch {
      setResult({ devices: null, message: REQUEST_FAILED });
    } finally {
      setWorking(false);
    }
  };
  const remove = (activationId: string): void => {
    if (confirm !== activationId) setConfirm(activationId);
    else void run(() => adapter.releaseDevice(activationId, key));
  };
  return (
    <div style={{ marginTop: 18 }}>
      <DeviceButtons
        open={open}
        disabled={busy || working}
        onList={() => {
          setOpen(true);
          void run(() => adapter.devices(key));
        }}
        onHide={() => {
          setOpen(false);
          setConfirm(null);
        }}
      />
      {open ? (
        <div aria-busy={working} style={{ marginTop: 10 }}>
          {result?.devices ? (
            <DeviceList
              devices={result.devices}
              confirm={confirm}
              disabled={busy || working}
              onRemove={remove}
            />
          ) : null}
          <p role="status" style={licenceMuted}>
            {deviceNotice(working, result)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function deviceNotice(working: boolean, result: LicenceDevices | null): string {
  if (working) return 'Asking the licence service…';
  if (result?.message) return result.message;
  return result?.devices?.length === 0 ? 'This licence is not active on any computer.' : SEATS;
}

function DeviceButtons({
  open,
  disabled,
  onList,
  onHide,
}: {
  readonly open: boolean;
  readonly disabled: boolean;
  readonly onList: () => void;
  readonly onHide: () => void;
}): JSX.Element {
  return (
    <div style={{ ...licenceButtons, marginTop: 0 }}>
      <button
        type="button"
        className="lf-btn"
        disabled={disabled}
        onClick={onList}
        title="See the computers this licence key is active on and free a seat"
      >
        {open ? 'Refresh device list' : 'Manage devices'}
      </button>
      {open ? (
        <button
          type="button"
          className="lf-btn"
          disabled={disabled}
          onClick={onHide}
          title="Hide the device list"
        >
          Hide devices
        </button>
      ) : null}
    </div>
  );
}

function DeviceList({
  devices,
  confirm,
  disabled,
  onRemove,
}: {
  readonly devices: readonly LicenceDevice[];
  readonly confirm: string | null;
  readonly disabled: boolean;
  readonly onRemove: (activationId: string) => void;
}): JSX.Element {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {devices.map((device) => (
        <li
          key={device.activationId}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>
            {device.deviceName}
            <span style={licenceMuted}>
              {' '}
              · Activated {new Date(device.createdAt * 1000).toLocaleDateString()}
            </span>
          </span>
          <button
            type="button"
            className="lf-btn"
            disabled={disabled}
            onClick={() => onRemove(device.activationId)}
            title="Remove this computer from the licence and free its seat"
          >
            {confirm === device.activationId ? 'Yes, remove it' : 'Remove'}
          </button>
        </li>
      ))}
    </ul>
  );
}
