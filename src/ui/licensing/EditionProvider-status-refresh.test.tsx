import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter, LicenceStatus } from '../../platform/types';

const NO_UPDATES: CommercialUpdateStatus = {
  state: 'unavailable',
  currentVersion: '1.0.0',
  version: null,
  checkedAt: null,
};
import { EditionProvider } from './EditionProvider';
import { proFeaturesUnlocked, useEdition } from './edition';

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
const trial: LicenceStatus = {
  ...free,
  edition: 'pro',
  state: 'ready',
  tier: 'trial',
  accessExpiresAt: 2_000_000_000,
  updatesUntil: 2_000_000_000,
};
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
function client(status: LicenceStatus = free): LicenceAdapter {
  return {
    status: vi.fn(async () => status),
    activate: vi.fn(async () => status),
    startTrial: vi.fn(async () => trial),
    refresh: vi.fn(async () => status),
    deactivate: vi.fn(async () => free),
    resetStore: vi.fn(async () => free),
    checkout: vi.fn(async () => ({ ...status, paymentPending: true })),
    claimPayment: vi.fn(async () => status),
    discardPayment: vi.fn(async () => ({ ...status, paymentPending: false })),
    earlyUpdates: vi.fn(async () => ({ available: true, enabled: false })),
    setEarlyUpdates: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
    updateStatus: vi.fn(async () => NO_UPDATES),
    checkForUpdates: vi.fn(async () => NO_UPDATES),
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((value) =>
    value.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}
function VcarveTool({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  const edition = useEdition();
  return (
    <button type="button" onClick={() => edition.requestPro('vcarve', onOpen)}>
      Open V-carve
    </button>
  );
}

it.each(['timer', 'focus', 'visibility'])(
  'reflects a background revocation on %s without unmounting the workspace',
  async (trigger) => {
    vi.useFakeTimers();
    try {
      const api = client({ ...trial, tier: 'paid', accessExpiresAt: null });
      const open = vi.fn();
      await act(async () =>
        root.render(
          <EditionProvider client={api}>
            <div data-workspace>workspace</div>
            <VcarveTool onOpen={open} />
          </EditionProvider>,
        ),
      );
      const workspace = host.querySelector('[data-workspace]');
      expect(proFeaturesUnlocked()).toBe(true);
      vi.mocked(api.status).mockResolvedValue(free);
      await act(async () => {
        if (trigger === 'timer') vi.advanceTimersByTime(30_000);
        if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
        if (trigger === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(proFeaturesUnlocked()).toBe(false);
      expect(host.querySelector('[data-workspace]')).toBe(workspace);
      await act(async () => button('Open V-carve').click());
      expect(open).not.toHaveBeenCalled();
      expect(host.textContent).toContain('V-carve');
      expect(api.refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);
