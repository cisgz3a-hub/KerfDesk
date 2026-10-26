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
import { proFeaturesUnlocked, proPromptOpen, requestProFeature, useEdition } from './edition';
import { editionLabel } from './EditionStatusButton';

// These tests specify the licence window with it turned on (ADR-623). ADR-623
// Amendment 3 holds it off in releases; EditionProvider.licence-window-off.test.tsx
// covers that.
vi.mock('../../../public/desktop-licence-window.mjs', () => ({ DESKTOP_LICENCE_WINDOW: true }));

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
const licenceWindow = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Activate KerfDesk"]');
it('explains a locked Pro tool after rights end mid-session and opens it once a trial starts', async () => {
  const api = client({ ...trial, tier: 'paid', accessExpiresAt: null });
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  // The owner signs this device out: the workspace stays for the session.
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  vi.mocked(api.status).mockResolvedValue(free);
  await act(async () => button('Deactivate this device').click());
  await act(async () => button('Close').click());
  expect(licenceWindow()).toBeNull();
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
  const api = client(trial);
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  // The trial ends while KerfDesk is open; the next status read reports it.
  vi.mocked(api.status).mockResolvedValue({ ...free, state: 'trial-expired', tier: 'trial' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(licenceWindow()).toBeNull();
  await act(async () => button('Open V-carve').click());
  expect(document.body.textContent).toContain('Pro trial on this device has ended');
  expect(document.body.textContent).not.toContain('Start free 30-day trial');
  // Background work reads this so it never commits over the waiting edit (ADR-609).
  expect(proPromptOpen()).toBe(true);
  await act(async () => button('Not now').click());
  expect(proPromptOpen()).toBe(false);
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('is a Pro tool');
});
it.each(['timer', 'selection', 'rollback'] as const)(
  'blocks new Pro choices after trial expiry through %s without unmounting existing work',
  async (trigger) => {
    vi.useFakeTimers();
    let elapsed = 0;
    const elapsedClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const now = 2_000_000_000;
    vi.setSystemTime(now * 1000);
    const api = client({ ...trial, accessExpiresAt: now + 1, updatesUntil: now + 1 });
    const open = vi.fn();
    const unmount = vi.fn();
    function Workspace() {
      useEffect(() => unmount, []);
      return <div data-workspace>existing work</div>;
    }
    try {
      await act(async () =>
        root.render(
          <EditionProvider client={api}>
            <Workspace />
            <VcarveTool onOpen={open} />
          </EditionProvider>,
        ),
      );
      await act(async () => button('Open V-carve').click());
      expect(open).toHaveBeenCalledOnce();
      if (trigger === 'timer') await act(async () => vi.advanceTimersByTime(1000));
      else if (trigger === 'rollback') {
        vi.setSystemTime((now - 60) * 1000);
        elapsed = 1000;
      } else vi.setSystemTime((now + 1) * 1000); // Suspended timers cannot extend rights.
      expect(proFeaturesUnlocked()).toBe(false);
      vi.setSystemTime((now - 60) * 1000); // An observed expiry must also stay expired.
      await act(async () => button('Open V-carve').click());
      await act(async () => expect(requestProFeature('box-generator', open)).toBe(false));
      expect(open).toHaveBeenCalledOnce();
      expect(unmount).not.toHaveBeenCalled();
      expect(host.querySelector('[data-workspace]')?.textContent).toBe('existing work');
      expect(document.body.textContent).toContain('Pro trial on this device has ended');
      expect(api.startTrial).not.toHaveBeenCalled();
    } finally {
      elapsedClock.mockRestore();
      vi.useRealTimers();
    }
  },
);
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
  expect(host.textContent).toContain('Licence needed');
  expect(licenceWindow()).toBeNull();
  expect(unmount).not.toHaveBeenCalled();
  await act(async () => button('Close').click());
  expect(host.textContent).toBe('workspace');
});
it('ignores an older status response after the operator deactivates this device', async () => {
  const api = client(trial);
  let reportStatus: ((status: LicenceStatus) => void) | undefined;
  vi.mocked(api.status)
    .mockResolvedValueOnce(trial)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reportStatus = resolve;
        }),
    );
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  await act(async () => button('Deactivate this device').click());
  expect(proFeaturesUnlocked()).toBe(false);
  await act(async () => reportStatus?.(trial));
  expect(proFeaturesUnlocked()).toBe(false);
  await act(async () => button('Close').click());
  await act(async () => button('Open V-carve').click());
  expect(open).not.toHaveBeenCalled();
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
it('names the licence in the status bar, with no desktop Free edition', () => {
  expect(editionLabel(free, 0)).toBe('Licence needed');
  expect(editionLabel({ ...free, state: 'trial-expired', tier: 'trial' }, 0)).toBe(
    'Licence needed',
  );
  expect(editionLabel(trial, 2_000_000_000 - 86_400 * 3 + 10)).toBe('Pro trial · 3 days left');
  expect(editionLabel({ ...trial, tier: 'paid', accessExpiresAt: null }, 0)).toBe('Pro');
});
const LINKED_KEY = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
function linkedClient(status: LicenceStatus) {
  const licenceLink = vi
    .fn()
    .mockResolvedValueOnce({ open: true, licenseKey: LINKED_KEY })
    .mockResolvedValue({ open: false, licenseKey: null });
  return { api: { ...client(status), licenceLink }, licenceLink };
}
const keyField = () => document.querySelector<HTMLInputElement>('#kerfdesk-licence-key');
it('opens Help > Licence with a purchase-link key in a licensed session', async () => {
  const { api, licenceLink } = linkedClient(trial);
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(keyField()?.value).toBe(LINKED_KEY);
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Close licence settings"]')?.click(),
  );
  expect(keyField()).toBeNull();
  // A later link reaching the running app opens the panel again, once.
  licenceLink.mockResolvedValueOnce({ open: true, licenseKey: null });
  await act(async () => window.dispatchEvent(new Event('kerfdesk:licence-link')));
  expect(keyField()?.value).toBe('');
  expect(licenceLink).toHaveBeenCalledTimes(2);
});
it('activates a purchase during an active trial without signing the trial out first', async () => {
  const key = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
  const api = client(trial);
  vi.mocked(api.activate)
    .mockResolvedValueOnce({ ...trial, message: 'The licence could not be confirmed. Try again.' })
    .mockResolvedValueOnce({ ...trial, tier: 'paid', accessExpiresAt: null, licenseKey: key });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  const input = host.querySelector<HTMLInputElement>('#kerfdesk-licence-key');
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, key);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Activate licence').click());
  expect(host.textContent).toContain('30-day Pro trial');
  expect(input?.value).toBe(key);
  expect(proFeaturesUnlocked()).toBe(true);
  await act(async () => button('Activate licence').click());
  expect(api.activate).toHaveBeenNthCalledWith(2, key);
  expect(api.deactivate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Pro licence');
  expect(host.textContent).not.toContain('30-day Pro trial');
  expect(host.querySelector<HTMLInputElement>('#kerfdesk-saved-licence-key')?.value).toBe(key);
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(proFeaturesUnlocked()).toBe(true);
});
