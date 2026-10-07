import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider } from './EditionProvider';
import { proFeaturesUnlocked, requestProFeature, useEdition } from './edition';

const EXPIRY = 2_000_000_000;
const status: LicenceStatus = {
  channel: 'commercial',
  edition: 'pro',
  state: 'ready',
  tier: 'trial',
  accessExpiresAt: EXPIRY,
  updatesUntil: EXPIRY,
  trialExpiresInMs: 90_000,
  perpetualUpdates: false,
  licenseKey: null,
  deactivationPending: false,
  paymentPending: false,
  paymentOrderId: null,
  storeUnreadable: false,
  message: null,
};
const noUpdates: CommercialUpdateStatus = {
  state: 'unavailable',
  currentVersion: '1.0.8',
  version: null,
  checkedAt: null,
};
let host: HTMLDivElement;
let root: Root;
let elapsed = 0;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.setSystemTime((EXPIRY - 150) * 1000);
  elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function client(): LicenceAdapter {
  const free = { ...status, edition: 'free' as const };
  return {
    status: vi.fn(async () => status),
    activate: vi.fn(async () => status),
    startTrial: vi.fn(async () => status),
    refresh: vi.fn(async () => status),
    deactivate: vi.fn(async () => free),
    resetStore: vi.fn(async () => free),
    checkout: vi.fn(async () => status),
    claimPayment: vi.fn(async () => status),
    discardPayment: vi.fn(async () => status),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    setEarlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    updateStatus: vi.fn(async () => noUpdates),
    checkForUpdates: vi.fn(async () => noUpdates),
  };
}

function Tool({ open }: { readonly open: () => void }): JSX.Element {
  const edition = useEdition();
  return <button onClick={() => edition.requestPro('vcarve', open)}>Choose V-carve</button>;
}

it.each(['timer', 'paused timers'] as const)(
  'stops new Pro choices at the retained 90-second budget with %s while existing work remains mounted',
  async (mode) => {
    const api = client();
    const open = vi.fn();
    const unmount = vi.fn();
    function Workspace() {
      useEffect(() => unmount, []);
      return <div data-workspace>Existing V-carve artwork</div>;
    }
    await act(async () =>
      root.render(
        <EditionProvider client={api}>
          <Workspace />
          <Tool open={open} />
        </EditionProvider>,
      ),
    );
    const choose = host.querySelector('button');
    if (choose === null) throw new Error('The test tool is missing.');
    await act(async () => choose.click());
    expect(open).toHaveBeenCalledOnce();
    expect(proFeaturesUnlocked()).toBe(true);

    elapsed = 89_000;
    expect(proFeaturesUnlocked()).toBe(true);
    elapsed = 90_000;
    if (mode === 'timer') await act(async () => vi.advanceTimersByTimeAsync(90_000));
    else vi.setSystemTime((EXPIRY - 60) * 1000);

    expect(proFeaturesUnlocked()).toBe(false);
    await act(async () => {
      expect(requestProFeature('box-generator', open)).toBe(false);
      choose.click();
    });
    expect(open).toHaveBeenCalledOnce();
    expect(unmount).not.toHaveBeenCalled();
    expect(host.querySelector('[data-workspace]')?.textContent).toBe('Existing V-carve artwork');
    expect(api.status).toHaveBeenCalledOnce();
    expect(api.startTrial).not.toHaveBeenCalled();
    expect(status.accessExpiresAt).toBe(EXPIRY);
  },
);
