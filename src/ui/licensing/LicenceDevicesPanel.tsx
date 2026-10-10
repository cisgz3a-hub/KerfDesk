import { useEffect, useRef, useState } from 'react';
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
  /** The activation draft, used when no key is saved yet. */
  readonly typedKey: string;
  readonly busy: boolean;
};
type DeviceClient = Required<Pick<LicenceAdapter, 'devices' | 'releaseDevice'>>;

const REQUEST_FAILED = 'This request could not be completed. Please try again.';
const SEATS =
  'Each computer counts as one of the licence’s three seats. Remove a computer you no longer use so another can activate. This computer keeps Pro until its next licence check if you remove it here; prefer Deactivate this device for that.';

/** Bind every list and removal to the exact saved or typed key that produced its rows. */
function managedKey(status: LicenceStatus | null, typedKey: string): string | null {
  if (status === null || status.channel !== 'commercial' || status.state === 'unavailable')
    return null;
  const key = (status.licenseKey ?? typedKey).trim();
  return key.length >= 8 && key.length <= 256 && !/[\r\n\0]/.test(key) ? key : null;
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
  const key = managedKey(status, typedKey);
  const { devices, releaseDevice } = client;
  const [context, setContext] = useState({ key, client, devices, releaseDevice, epoch: 0 });
  // Remount the session before committing new ownership, including adapter changes.
  // Old promises then belong to an unmounted session and cannot overwrite its successor.
  if (
    context.key !== key ||
    context.client !== client ||
    context.devices !== devices ||
    context.releaseDevice !== releaseDevice
  ) {
    setContext({ key, client, devices, releaseDevice, epoch: context.epoch + 1 });
    return null;
  }
  const adapter = deviceClient(client);
  return key === null || adapter === null ? null : (
    <DevicesSession key={context.epoch} adapter={adapter} licenseKey={key} busy={busy} />
  );
}

function DevicesSession({
  adapter,
  licenseKey,
  busy,
}: {
  readonly adapter: DeviceClient;
  readonly licenseKey: string;
  readonly busy: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [result, setResult] = useState<LicenceDevices | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (work: () => Promise<LicenceDevices>): Promise<void> => {
    if (pending.current || busy) return;
    pending.current = true;
    setWorking(true);
    setConfirm(null);
    try {
      const answer = await work();
      if (mounted.current) setResult(answer);
    } catch {
      if (mounted.current) setResult({ devices: null, message: REQUEST_FAILED });
    } finally {
      pending.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  const remove = (activationId: string): void => {
    if (confirm !== activationId) setConfirm(activationId);
    else void run(() => adapter.releaseDevice(activationId, licenseKey));
  };
  return (
    <div style={{ marginTop: 18 }}>
      <DeviceButtons
        open={open}
        disabled={busy || working}
        onList={() => {
          setOpen(true);
          void run(() => adapter.devices(licenseKey));
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
