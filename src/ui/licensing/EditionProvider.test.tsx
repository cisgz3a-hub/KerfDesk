import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter, LicenceStatus } from '../../platform/types';

const NO_UPDATES: CommercialUpdateStatus = {
  state: 'unavailable',
  currentVersion: '1.0.0',
  version: null,
  checkedAt: null,
};
import { EditionProvider, LICENCE_SETTINGS_EVENT } from './EditionProvider';
import { proFeaturesUnlocked, requestProFeature, useEdition } from './edition';
import { editionLabel } from './EditionStatusButton';

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

it('can explicitly use an unrestricted development context', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider unlicensedRunsFree={false}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => button('Open V-carve').click());
  expect(open).toHaveBeenCalledOnce();
  expect(requestProFeature('box-generator')).toBe(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('mounts the workspace at once in a Free commercial build', async () => {
  const api = client();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(proFeaturesUnlocked()).toBe(false);
});
it('explains a locked Pro tool and opens it once the trial unlocks Pro', async () => {
  const api = client();
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => button('Open V-carve').click());
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('V-carve is a Pro tool');
  await act(async () => button('Start free 30-day trial').click());
  expect(api.startTrial).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toContain('is a Pro tool');
  await act(async () => button('Open V-carve').click());
  expect(open).toHaveBeenCalledTimes(2);
});
it('lets the operator decline without opening the tool', async () => {
  const api = client({ ...free, state: 'trial-expired', tier: 'trial' });
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => button('Open V-carve').click());
  expect(document.body.textContent).toContain('Pro trial on this device has ended');
  expect(document.body.textContent).not.toContain('Start free 30-day trial');
  await act(async () => button('Not now').click());
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('is a Pro tool');
});
it('keeps the workspace mounted while the licence is managed or deactivated', async () => {
  const api = client(trial);
  const unmount = vi.fn();
  function Workspace() {
    useEffect(() => unmount, []);
    return <div data-workspace>workspace</div>;
  }
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <Workspace />
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.textContent).toContain('Your KerfDesk licence');
  expect(host.textContent).toContain('KerfDesk Pro');
  await act(async () => button('Deactivate this device').click());
  expect(host.textContent).toContain('KerfDesk Free');
  expect(unmount).not.toHaveBeenCalled();
  await act(async () => button('Close').click());
  expect(host.textContent).toBe('workspace');
});
it('shows a saved licence key so a buyer can activate other devices', async () => {
  const api = client({ ...trial, tier: 'paid', licenseKey: 'KD1.license-1.secret' });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  const field = document.getElementById('kerfdesk-saved-licence-key') as HTMLInputElement;
  expect(field.value).toBe('KD1.license-1.secret');
  expect(field.type).toBe('password');
  await act(async () => button('Show key').click());
  expect(field.type).toBe('text');
});
it('offers a reset for an unreadable saved licence and forgetting a stuck order', async () => {
  const api = client({
    ...free,
    state: 'invalid-licence',
    storeUnreadable: true,
    paymentPending: true,
    paymentOrderId: 'order-1',
  });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  await act(async () => button('Reset saved licence').click());
  expect(api.resetStore).toHaveBeenCalledOnce();
  vi.mocked(api.status).mockResolvedValue({ ...free, paymentPending: true, paymentOrderId: 'o-2' });
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(document.body.textContent).toContain('Order number: o-2');
  await act(async () => button('Forget this order').click());
  expect(api.discardPayment).not.toHaveBeenCalled();
  await act(async () => button('Yes, forget this order').click());
  expect(api.discardPayment).toHaveBeenCalledOnce();
});
it('shows developer rights with no purchase or renewal prompt', async () => {
  const api = client({
    ...trial,
    tier: 'developer',
    perpetualUpdates: true,
    accessExpiresAt: null,
  });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(host.textContent).toContain('Every Pro tool and every update');
  expect(host.textContent).not.toContain('Buy Pro');
  expect(host.textContent).not.toContain('Renew updates');
});
it('names the edition in the status bar', () => {
  expect(editionLabel(free, 0)).toBe('Free · Try Pro');
  expect(editionLabel({ ...free, state: 'trial-expired', tier: 'trial' }, 0)).toBe('Free');
  expect(editionLabel(trial, 2_000_000_000 - 86_400 * 3 + 10)).toBe('Pro trial · 3 days left');
  expect(editionLabel({ ...trial, tier: 'paid', accessExpiresAt: null }, 0)).toBe('Pro');
});
