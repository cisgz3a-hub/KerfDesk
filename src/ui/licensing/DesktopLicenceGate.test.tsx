import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider, LICENCE_SETTINGS_EVENT } from './EditionProvider';
import { proFeaturesUnlocked } from './edition';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { MESSAGES } from '../../../electron/licensing-messages';
import { desktopCloseController } from '../app/desktop-close-runtime';

// These tests specify the licence window with it turned on (ADR-623). ADR-623
// Amendment 3 holds it off in releases; EditionProvider.licence-window-off.test.tsx
// covers that.
vi.mock('../../../public/desktop-licence-window.mjs', () => ({ DESKTOP_LICENCE_WINDOW: true }));

// The window a commercial desktop build opens behind until a trial or licence is active (ADR-623).

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
  desktopCloseController.keepOpen();
  vi.unstubAllGlobals();
});
function client(status: LicenceStatus = free): LicenceAdapter {
  const none: CommercialUpdateStatus = {
    state: 'unavailable',
    currentVersion: '1.0.0',
    version: null,
    checkedAt: null,
  };
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
    updateStatus: vi.fn(async () => none),
    checkForUpdates: vi.fn(async () => none),
  };
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((value) =>
    value.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}
const licenceWindow = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Activate KerfDesk"]');
it.each([0, 10_000])(
  'acknowledges services only after a normalized trial admits the workspace (budget %s)',
  async (budget) => {
    const workspaceAdmitted = vi.fn(async () => {
      expect(host.querySelector('[data-workspace]')).not.toBeNull();
    });
    const api = {
      ...client({ ...trial, trialExpiresInMs: budget, admissionGeneration: 7 }),
      workspaceAdmitted,
    };
    await act(async () =>
      root.render(
        <EditionProvider client={api}>
          <div data-workspace />
        </EditionProvider>,
      ),
    );
    expect(workspaceAdmitted).toHaveBeenCalledTimes(budget === 0 ? 0 : 1);
    if (budget === 0) expect(licenceWindow()).not.toBeNull();
  },
);
// ADR-623 Amendment 1: a renderer reloaded after a crash, in a session the window
// already let in, reaches its workspace and job recovery though the trial ended.
it.each([
  { opening: 'a reload in an admitted session', sessionAdmitted: true },
  { opening: 'a fresh launch', sessionAdmitted: undefined },
])('after the trial ended, $opening opens the right screen', async ({ sessionAdmitted }) => {
  const workspaceAdmitted = vi.fn(async () => undefined);
  const ended: LicenceStatus = {
    ...trial,
    edition: 'free',
    state: 'trial-expired',
    accessExpiresAt: 1_700_000_000,
    admissionGeneration: 4,
    ...(sessionAdmitted === undefined ? {} : { sessionAdmitted }),
  };
  await act(async () =>
    root.render(
      <EditionProvider client={{ ...client(ended), workspaceAdmitted }}>
        <div data-workspace />
      </EditionProvider>,
    ),
  );
  if (sessionAdmitted) {
    expect(licenceWindow()).toBeNull();
    expect(host.querySelector('[data-workspace]')).not.toBeNull();
    expect(workspaceAdmitted).toHaveBeenCalledWith(4);
  } else {
    expect(licenceWindow()?.dataset.licenceState).toBe('trial-expired');
    expect(host.querySelector('[data-workspace]')).toBeNull();
    expect(workspaceAdmitted).not.toHaveBeenCalled();
  }
  // Either way, new Pro tool choices stay paused.
  expect(proFeaturesUnlocked()).toBe(false);
});
it('opens a commercial build behind the licence window until a trial starts', async () => {
  const api = client();
  const mounted = vi.fn();
  function Workspace() {
    useEffect(() => mounted(), []);
    return <div data-workspace>workspace</div>;
  }
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <Workspace />
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()?.dataset.licenceState).toBe('activation-required');
  expect(host.querySelector('[data-workspace]')).toBeNull();
  expect(mounted).not.toHaveBeenCalled();
  expect(proFeaturesUnlocked()).toBe(false);
  // No Close, and Escape or Help > Licence cannot dismiss it.
  expect(document.querySelector('[aria-label="Close licence settings"]')).toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(licenceWindow()).not.toBeNull();
  expect(host.querySelector('[data-workspace]')).toBeNull();
  await act(async () => button('Start free 30-day trial').click());
  expect(api.startTrial).toHaveBeenCalledOnce();
  expect(licenceWindow()).toBeNull();
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(mounted).toHaveBeenCalledOnce();
  expect(proFeaturesUnlocked()).toBe(true);
});
it('mounts nothing until the first licence status, and offers a retry if it fails', async () => {
  const api = client(trial);
  let fail: (error: Error) => void = () => undefined;
  vi.mocked(api.status).mockImplementationOnce(
    () => new Promise((_resolve, reject) => (fail = reject)),
  );
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()?.dataset.licenceState).toBe('checking');
  await act(async () => fail(new Error('offline')));
  // A failed first read is settled: the splash and qualification see Retry at once.
  expect(licenceWindow()?.dataset.licenceState).toBe('unreachable');
  expect(host.querySelector('[data-workspace]')).toBeNull();
  expect(document.body.textContent).toContain('could not be reached');
  await act(async () => button('Retry licence check').click());
  expect(licenceWindow()).toBeNull();
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
});
it('opens the workspace as soon as a quiet confirmation restores the licence', async () => {
  const paid = { ...trial, tier: 'paid' as const, accessExpiresAt: null };
  const api = client({ ...paid, edition: 'free', state: 'checkin-required' });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()?.dataset.licenceState).toBe('checkin-required');
  vi.mocked(api.status).mockResolvedValue(paid);
  // The main process's data-free signal after its startup confirmation (ADR-623).
  await act(async () => window.dispatchEvent(new CustomEvent('kerfdesk:licence-refreshed')));
  expect(licenceWindow()).toBeNull();
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
});
it('tells a Linux user without a keyring what to install, and stays closed to the workspace', async () => {
  const api = client({ ...free, state: 'unavailable', message: MESSAGES.linuxKeyring });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()?.dataset.licenceState).toBe('unavailable');
  expect(host.querySelector('[data-workspace]')).toBeNull();
  const notice = [...document.querySelectorAll('[role="status"]')].map((n) => n.textContent);
  expect(notice).toContain(MESSAGES.linuxKeyring);
  expect(notice).not.toContain(MESSAGES.unavailable);
});
it('hands the modal role to the updates panel it opens, and takes it back', async () => {
  await act(async () =>
    root.render(
      <EditionProvider client={client()}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()?.getAttribute('aria-modal')).toBe('true');
  await act(async () => button('Check for updates').click());
  expect(document.querySelector('[role="dialog"][aria-label="KerfDesk updates"]')).not.toBeNull();
  expect(licenceWindow()?.getAttribute('aria-modal')).toBe('false');
  expect(licenceWindow()?.getAttribute('aria-hidden')).toBe('true');
  // Neither Tab nor assistive technology reaches the window behind the panel.
  expect(licenceWindow()?.inert).toBe(true);
  const panel = document.querySelector('[role="dialog"][aria-label="KerfDesk updates"]');
  expect(panel?.contains(document.activeElement)).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(document.querySelector('[role="dialog"][aria-label="KerfDesk updates"]')).toBeNull();
  expect(licenceWindow()?.getAttribute('aria-modal')).toBe('true');
  expect(licenceWindow()?.hasAttribute('aria-hidden')).toBe(false);
  expect(licenceWindow()?.inert).toBe(false);
  expect(document.activeElement?.textContent).toBe('Check for updates');
});
it('opens a build that cannot take a licence without the licence window', async () => {
  const api = client({ ...free, channel: 'free', state: 'ready' });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()).toBeNull();
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
});
it('quits from the licence window as the window close does', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  await act(async () =>
    root.render(
      <EditionProvider client={client()}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => button('Quit KerfDesk').click());
  expect(close).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-workspace]')).toBeNull();
  close.mockRestore();
});
const LINKED_KEY = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
const keyField = () => document.querySelector<HTMLInputElement>('#kerfdesk-licence-key');
it('fills the licence window with a purchase-link key and opens no panel after it', async () => {
  const api = {
    ...client(free),
    licenceLink: vi
      .fn()
      .mockResolvedValueOnce({ open: true, licenseKey: LINKED_KEY })
      .mockResolvedValue({ open: false, licenseKey: null }),
  };
  vi.mocked(api.activate).mockResolvedValue({
    ...trial,
    tier: 'paid',
    accessExpiresAt: null,
    licenseKey: LINKED_KEY,
  });
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(licenceWindow()).not.toBeNull();
  expect(keyField()?.value).toBe(LINKED_KEY);
  await act(async () => button('Activate licence').click());
  expect(api.activate).toHaveBeenCalledWith(LINKED_KEY);
  expect(licenceWindow()).toBeNull();
  expect(host.textContent).toBe('workspace');
});

function requestClose(operation: 'prepare' | 'approve', requestId: number): Promise<unknown> {
  const reply: unknown = window.eval(rendererCloseRequestScript(operation, requestId));
  return Promise.resolve(reply);
}

it.each(['activation-required', 'unreachable'])(
  'prepares and approves normal desktop close from the %s licence window',
  async (state) => {
    const api = client();
    if (state === 'unreachable') vi.mocked(api.status).mockRejectedValue(new Error('offline'));
    await act(async () =>
      root.render(
        <EditionProvider client={api}>
          <div data-workspace>workspace</div>
        </EditionProvider>,
      ),
    );
    expect(licenceWindow()?.dataset.licenceState).toBe(state);
    expect(host.querySelector('[data-workspace]')).toBeNull();
    expect(await requestClose('prepare', 41)).toEqual({ status: 'ready', dirty: false });
    expect(await requestClose('approve', 41)).toEqual({ status: 'approved' });
  },
);

it('releases the licence close receiver and its approval when the workspace is admitted', async () => {
  await act(async () =>
    root.render(
      <EditionProvider client={client()}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  expect(await requestClose('prepare', 51)).toEqual({ status: 'ready', dirty: false });
  await act(async () => button('Start free 30-day trial').click());
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(desktopCloseController.ownsUnload).toBe(false);
  expect(desktopCloseController.approve(51)).toEqual({ status: 'retry' });
  // This fixture has no workspace receiver: the licence receiver must be gone.
  expect(await requestClose('prepare', 52)).toEqual({ status: 'unavailable' });
});
it('shows a purchase-link key that arrives during a trial start once the workspace opens', async () => {
  let finishTrial: (status: LicenceStatus) => void = () => undefined;
  const licenceLink = vi.fn().mockResolvedValue({ open: false, licenseKey: null });
  const api = {
    ...client(free),
    licenceLink,
    startTrial: vi.fn(() => new Promise<LicenceStatus>((resolve) => (finishTrial = resolve))),
  };
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <div data-workspace>workspace</div>
      </EditionProvider>,
    ),
  );
  await act(async () => button('Start free 30-day trial').click());
  // The purchase page's link reaches the app while the trial is still starting.
  licenceLink.mockResolvedValueOnce({ open: true, licenseKey: LINKED_KEY });
  await act(async () => window.dispatchEvent(new Event('kerfdesk:licence-link')));
  await act(async () => finishTrial(trial));
  expect(licenceWindow()).toBeNull();
  expect(host.querySelector('[data-workspace]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"][aria-label="KerfDesk licence"]')).not.toBeNull();
  expect(keyField()?.value).toBe(LINKED_KEY);
});
