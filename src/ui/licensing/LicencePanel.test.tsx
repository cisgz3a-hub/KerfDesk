import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  CommercialUpdateStatus,
  EarlyUpdates,
  LicenceAdapter,
  LicenceStatus,
} from '../../platform/types';

const NO_UPDATES: CommercialUpdateStatus = {
  state: 'unavailable',
  currentVersion: '1.0.0',
  version: null,
  checkedAt: null,
};
import { LicencePanel } from './LicencePanel';

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
const LABEL = 'Get new versions early (beta)';
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

function client(setting: () => Promise<EarlyUpdates>): LicenceAdapter {
  return {
    status: vi.fn(async () => free),
    activate: vi.fn(async () => free),
    startTrial: vi.fn(async () => free),
    refresh: vi.fn(async () => free),
    deactivate: vi.fn(async () => free),
    resetStore: vi.fn(async () => free),
    checkout: vi.fn(async () => free),
    claimPayment: vi.fn(async () => free),
    discardPayment: vi.fn(async () => free),
    earlyUpdates: vi.fn(setting),
    setEarlyUpdates: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
    updateStatus: vi.fn(async () => NO_UPDATES),
    checkForUpdates: vi.fn(async () => NO_UPDATES),
  };
}
const offered = (enabled: boolean) => async (): Promise<EarlyUpdates> => ({
  available: true,
  enabled,
});
async function show(adapter: LicenceAdapter, status: LicenceStatus = free): Promise<void> {
  await act(async () =>
    root.render(
      <LicencePanel
        client={adapter}
        status={status}
        failure={null}
        onStatus={async () => undefined}
        onRetry={async () => undefined}
        onClose={() => undefined}
      />,
    ),
  );
}
function checkbox(): HTMLInputElement | null {
  const label = [...host.querySelectorAll('label')].find((item) => item.textContent === LABEL);
  return label?.querySelector('input[type="checkbox"]') ?? null;
}

function activationInput(): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('#kerfdesk-licence-key')!;
}
function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
}
async function enterKey(value: string): Promise<void> {
  await act(async () => {
    const input = activationInput();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it.each([
  { ...free, message: 'Enter a valid licence key.' },
  { ...free, message: 'The licence service could not be reached. Try again.' },
  {
    ...free,
    state: 'ready' as const,
    tier: 'paid' as const,
    edition: 'pro' as const,
    licenseKey: 'synthetic-key-to-correct',
    message: 'The licence service could not be reached. Try again.',
  },
  {
    ...free,
    state: 'ready' as const,
    tier: 'paid' as const,
    edition: 'pro' as const,
    licenseKey: 'synthetic-previous-key',
  },
])('retains the activation draft after a rejected or offline response %#', async (answer) => {
  const adapter = client(offered(false));
  vi.mocked(adapter.activate).mockResolvedValue(answer);
  await show(adapter);
  await enterKey('  synthetic-key-to-correct  ');
  await act(async () => button('Activate licence').click());
  expect(adapter.activate).toHaveBeenCalledExactlyOnceWith('synthetic-key-to-correct');
  expect(activationInput().value).toBe('  synthetic-key-to-correct  ');
  expect(button('Activate licence').disabled).toBe(false);
});

it('retains the activation draft after a thrown transport failure and allows a corrected retry', async () => {
  const adapter = client(offered(false));
  vi.mocked(adapter.activate).mockRejectedValueOnce(new Error('bridge unavailable'));
  await show(adapter);
  await enterKey('synthetic-key-to-correct');
  await act(async () => button('Activate licence').click());
  expect(activationInput().value).toBe('synthetic-key-to-correct');
  expect(host.textContent).toContain('This request could not be completed. Please try again.');
  await enterKey('synthetic-corrected-key');
  vi.mocked(adapter.activate).mockResolvedValue({
    ...free,
    state: 'ready',
    tier: 'paid',
    edition: 'pro',
    licenseKey: 'synthetic-corrected-key',
  });
  await act(async () => button('Activate licence').click());
  expect(adapter.activate).toHaveBeenLastCalledWith('synthetic-corrected-key');
  expect(activationInput().value).toBe('');
  expect(button('Activate licence').disabled).toBe(true);
});

it('does not erase a draft when an unrelated licence action completes', async () => {
  const adapter = client(offered(false));
  await show(adapter);
  await enterKey('synthetic-key-to-correct');
  await act(async () => button('Start free 30-day Pro trial').click());
  expect(adapter.startTrial).toHaveBeenCalledOnce();
  expect(activationInput().value).toBe('synthetic-key-to-correct');
});

it('does not submit blank or short activation keys', async () => {
  const adapter = client(offered(false));
  await show(adapter);
  for (const value of ['', '   ', 'short']) {
    await enterKey(value);
    expect(button('Activate licence').disabled).toBe(true);
    await act(async () => button('Activate licence').click());
  }
  expect(adapter.activate).not.toHaveBeenCalled();
});

it('offers new versions early in a commercial build and saves the choice (ADR-541)', async () => {
  const adapter = client(offered(false));
  await show(adapter);
  const box = checkbox();
  expect(box?.checked).toBe(false);
  expect(box?.title).not.toBe('');
  expect(host.textContent).toContain('a few days before everyone else');
  await act(async () => box?.click());
  expect(adapter.setEarlyUpdates).toHaveBeenCalledExactlyOnceWith(true);
  expect(checkbox()?.checked).toBe(true);
  await act(async () => checkbox()?.click());
  expect(adapter.setEarlyUpdates).toHaveBeenLastCalledWith(false);
  expect(checkbox()?.checked).toBe(false);
});

it('shows a saved choice, and says when a change could not be saved', async () => {
  const adapter = client(offered(true));
  vi.mocked(adapter.setEarlyUpdates).mockRejectedValueOnce(new Error('disk full'));
  await show(adapter);
  expect(checkbox()?.checked).toBe(true);
  await act(async () => checkbox()?.click());
  expect(checkbox()?.checked).toBe(true);
  expect(host.textContent).toContain('This setting could not be saved. Please try again.');
});

it('offers nothing where the app takes no commercial updates', async () => {
  const unavailable = async (): Promise<EarlyUpdates> => ({ available: false, enabled: false });
  const unreachable = async (): Promise<EarlyUpdates> => {
    throw new Error('The desktop licence service is unavailable.');
  };
  for (const setting of [unavailable, unreachable]) {
    await show(client(setting));
    expect(checkbox()).toBeNull();
    expect(host.textContent).toContain('Your KerfDesk licence');
  }
  // A Preview or source build has no licence and no update rings at all.
  const preview = client(offered(false));
  await show(preview, { ...free, channel: 'free' });
  expect(checkbox()).toBeNull();
  expect(preview.earlyUpdates).not.toHaveBeenCalled();
});

it('offers Reset beside Retry while a deactivation is stuck (ADR-523 Amendment 2)', async () => {
  const adapter = client(offered(false));
  await show(adapter, { ...free, deactivationPending: true });
  const buttons = [...host.querySelectorAll('button')];
  const named = (label: string) => buttons.find((item) => item.textContent === label);
  expect(named('Retry device deactivation')).toBeDefined();
  await act(async () => named('Reset saved licence')?.click());
  expect(adapter.resetStore).toHaveBeenCalledOnce();
});

it('lets the key’s owner see and free the licence’s seats (Manage devices)', async () => {
  const adapter = client(offered(false));
  const listed = {
    devices: [
      { activationId: 'act-1', deviceName: 'Windows computer', createdAt: 1_800_000_000 },
      { activationId: 'act-2', deviceName: 'Old laptop', createdAt: 1_800_000_500 },
    ],
    message: null,
  };
  const devices = vi.fn(async () => listed);
  const releaseDevice = vi.fn(async () => ({
    devices: listed.devices.slice(0, 1),
    message: 'That computer was removed from the licence. Its seat is free for another device.',
  }));
  const paid: LicenceStatus = {
    ...free,
    state: 'ready',
    tier: 'paid',
    edition: 'pro',
    licenseKey: 'synthetic-saved-key',
  };
  await show({ ...adapter, devices, releaseDevice }, paid);
  await act(async () => button('Manage devices').click());
  expect(devices).toHaveBeenCalledExactlyOnceWith(paid.licenseKey);
  expect(host.textContent).toContain('Old laptop');
  const remove = () =>
    [...host.querySelectorAll('li')]
      .find((item) => item.textContent?.includes('Old laptop'))
      ?.querySelector('button');
  await act(async () => remove()?.click());
  expect(releaseDevice).not.toHaveBeenCalled();
  expect(remove()?.textContent).toBe('Yes, remove it');
  await act(async () => remove()?.click());
  expect(releaseDevice).toHaveBeenCalledExactlyOnceWith('act-2', paid.licenseKey);
  expect(host.textContent).not.toContain('Old laptop');
  expect(host.textContent).toContain('seat is free for another device');
});

it('manages devices with a typed key when none is saved, and hides the option without a key or adapter support', async () => {
  const adapter = client(offered(false));
  const devices = vi.fn(async () => ({ devices: [], message: null }));
  const releaseDevice = vi.fn(async () => ({ devices: [], message: null }));
  await show({ ...adapter, devices, releaseDevice });
  expect(button('Manage devices')).toBeUndefined();
  await enterKey('synthetic-typed-key');
  await act(async () => button('Manage devices').click());
  expect(devices).toHaveBeenCalledExactlyOnceWith('synthetic-typed-key');
  expect(host.textContent).toContain('not active on any computer');
  await show(adapter, { ...free, licenseKey: 'synthetic-saved-key' });
  expect(button('Manage devices')).toBeUndefined();
});

it('Buy Pro opens the purchase page itself, while Renew updates still starts in the app', async () => {
  const adapter = client(offered(false));
  const openPurchasePage = vi.fn(async () => ({
    ...free,
    message: 'The KerfDesk purchase page opened in your browser.',
  }));
  await show({ ...adapter, openPurchasePage });
  await act(async () => button('Buy Pro · US$49.50 plus tax').click());
  expect(openPurchasePage).toHaveBeenCalledOnce();
  expect(adapter.checkout).not.toHaveBeenCalled();
  const paid: LicenceStatus = { ...free, state: 'ready', tier: 'paid', edition: 'pro' };
  await show({ ...adapter, openPurchasePage }, paid);
  await act(async () => button('Renew updates · US$20 plus tax').click());
  expect(adapter.checkout).toHaveBeenCalledExactlyOnceWith('renewal');
  expect(openPurchasePage).toHaveBeenCalledOnce();
});

it('shows the key as typed, pastes it from the clipboard in one click, and spots a partial key', async () => {
  const key = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
  const adapter = client(offered(false));
  const clipboardKey = vi.fn(async (): Promise<string | null> => key);
  await show({ ...adapter, clipboardKey });
  expect(activationInput().type).toBe('text');
  await act(async () => button('Paste key').click());
  expect(clipboardKey).toHaveBeenCalledOnce();
  expect(activationInput().value).toBe(key);
  await act(async () => button('Activate licence').click());
  expect(adapter.activate).toHaveBeenCalledExactlyOnceWith(key);
  clipboardKey.mockResolvedValueOnce(null);
  await act(async () => button('Paste key').click());
  expect(host.textContent).toContain('No KerfDesk licence key is on the clipboard');
  await enterKey(key.slice(0, 50));
  expect(host.textContent).toContain('Part of the key seems to be missing');
  await enterKey(`Licence key: ${key}`);
  expect(host.textContent).toContain('Found your licence key in the pasted text');
});

it('offers no Paste key where the app cannot read a key from the clipboard', async () => {
  await show(client(offered(false)));
  expect(button('Paste key')).toBeUndefined();
});
