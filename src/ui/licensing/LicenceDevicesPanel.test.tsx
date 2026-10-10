import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter, LicenceDevices, LicenceStatus } from '../../platform/types';
import { LicenceDevicesPanel } from './LicenceDevicesPanel';

const free: LicenceStatus = {
  channel: 'commercial',
  edition: 'free',
  state: 'activation-required',
  tier: null,
  accessExpiresAt: null,
  updatesUntil: null,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
const KEY_A = 'synthetic-key-a';
const KEY_B = 'synthetic-key-b';
const listed = (name: string): LicenceDevices => ({
  devices: [{ activationId: 'activation-1', deviceName: name, createdAt: 1 }],
  message: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function adapter() {
  return {
    devices: vi.fn(async (_key?: string) => listed('Computer A')),
    releaseDevice: vi.fn(
      async (_id: string, _key?: string) => ({ devices: [], message: 'Removed' }) as LicenceDevices,
    ),
  } as unknown as LicenceAdapter & {
    devices: ReturnType<typeof vi.fn<(key?: string) => Promise<LicenceDevices>>>;
    releaseDevice: ReturnType<typeof vi.fn<(id: string, key?: string) => Promise<LicenceDevices>>>;
  };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function show(client: LicenceAdapter, typedKey = KEY_A, status = free) {
  await act(async () =>
    root.render(
      <LicenceDevicesPanel client={client} status={status} typedKey={typedKey} busy={false} />,
    ),
  );
}
function button(label: string) {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label);
}
async function click(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  await act(async () => target!.click());
}

it('ignores an A-key list arriving after the typed key changed to B', async () => {
  const client = adapter();
  const answer = deferred<LicenceDevices>();
  client.devices.mockReturnValueOnce(answer.promise).mockResolvedValueOnce(listed('Computer B'));
  await show(client);
  await click('Manage devices');
  await show(client, KEY_B);
  expect(button('Manage devices')?.disabled).toBe(false);
  await act(async () => answer.resolve(listed('Computer A')));
  expect(host.textContent).not.toContain('Computer A');
  await click('Manage devices');
  expect(client.devices).toHaveBeenLastCalledWith(KEY_B);
  await click('Remove');
  await click('Yes, remove it');
  expect(client.releaseDevice).toHaveBeenCalledExactlyOnceWith('activation-1', KEY_B);
});

it('clears rows and removal confirmation when the saved licence key changes', async () => {
  const client = adapter();
  client.devices
    .mockResolvedValueOnce(listed('Computer A'))
    .mockResolvedValueOnce(listed('Computer B'));
  await show(client, '', { ...free, licenseKey: KEY_A });
  await click('Manage devices');
  expect(client.devices).toHaveBeenCalledWith(KEY_A);
  await click('Remove');
  await show(client, '', { ...free, licenseKey: KEY_B });
  expect(host.textContent).not.toContain('Computer A');
  expect(button('Yes, remove it')).toBeUndefined();
  await click('Manage devices');
  await click('Remove');
  expect(client.releaseDevice).not.toHaveBeenCalled();
  await click('Yes, remove it');
  expect(client.releaseDevice).toHaveBeenCalledExactlyOnceWith('activation-1', KEY_B);
});

it('ignores a previous adapter answer while the replacement adapter has its own list', async () => {
  const previous = adapter();
  const current = adapter();
  const oldAnswer = deferred<LicenceDevices>();
  const newAnswer = deferred<LicenceDevices>();
  previous.devices.mockReturnValueOnce(oldAnswer.promise);
  current.devices.mockReturnValueOnce(newAnswer.promise);
  await show(previous);
  await click('Manage devices');
  await show(current);
  await click('Manage devices');
  await act(async () => newAnswer.resolve(listed('Current computer')));
  await act(async () => oldAnswer.resolve(listed('Stale computer')));
  expect(host.textContent).toContain('Current computer');
  expect(host.textContent).not.toContain('Stale computer');
});

it('ignores a completed A-key removal after B has loaded its own devices', async () => {
  const client = adapter();
  const removal = deferred<LicenceDevices>();
  client.devices
    .mockResolvedValueOnce(listed('Computer A'))
    .mockResolvedValueOnce(listed('Computer B'));
  client.releaseDevice.mockReturnValueOnce(removal.promise);
  await show(client);
  await click('Manage devices');
  await click('Remove');
  await click('Yes, remove it');
  expect(client.releaseDevice).toHaveBeenCalledExactlyOnceWith('activation-1', KEY_A);
  await show(client, KEY_B);
  await click('Manage devices');
  await act(async () => removal.resolve({ devices: [], message: 'A removed' }));
  expect(host.textContent).toContain('Computer B');
  expect(host.textContent).not.toContain('A removed');
});

it('ignores a failed list after hiding the panel through an unavailable key', async () => {
  const client = adapter();
  const answer = deferred<LicenceDevices>();
  client.devices.mockReturnValueOnce(answer.promise).mockResolvedValueOnce(listed('Computer B'));
  await show(client);
  await click('Manage devices');
  await show(client, '');
  expect(host.textContent).toBe('');
  await act(async () => answer.reject(new Error('late failure')));
  await show(client, KEY_B);
  await click('Manage devices');
  expect(host.textContent).toContain('Computer B');
  expect(host.textContent).not.toContain('could not be completed');
});
