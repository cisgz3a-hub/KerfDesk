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
