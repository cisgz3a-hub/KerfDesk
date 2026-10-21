import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider, LICENCE_SETTINGS_EVENT } from './EditionProvider';
import { useEdition } from './edition';
import { EditionStatusButton, editionLabel } from './EditionStatusButton';
import { expireTrialStatus } from './trial-expiry';

// ADR-623 Amendment 3: the licence window is held off, so a commercial desktop
// build opens straight into KerfDesk Free, as 1.0.20 did (ADR-540), and a trial
// or licence unlocks Pro. This file pins that state whatever the shared setting
// says; the window-on tests pin the other.
vi.mock('../../../public/desktop-licence-window.mjs', () => ({ DESKTOP_LICENCE_WINDOW: false }));

const NO_UPDATES: CommercialUpdateStatus = {
  state: 'unavailable',
  currentVersion: '1.0.0',
  version: null,
  checkedAt: null,
};
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
    workspaceAdmitted: vi.fn(async () => undefined),
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
const editionChip = () => {
  const chip = document.querySelector<HTMLButtonElement>('button[aria-label^="Edition:"]');
  if (chip === null) throw new Error('Missing edition chip');
  return chip;
};
const licenceWindow = () =>
  document.querySelector('[role="dialog"][aria-label="Activate KerfDesk"]');
function Workspace({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  const edition = useEdition();
  return (
    <div data-workspace>
      <button type="button" onClick={() => edition.requestPro('vcarve', onOpen)}>
        Open V-carve
      </button>
      <EditionStatusButton />
    </div>
  );
}
async function render(api: LicenceAdapter, onOpen = vi.fn()): Promise<void> {
  await act(async () =>
    root.render(
      <EditionProvider client={api}>
        <Workspace onOpen={onOpen} />
      </EditionProvider>,
    ),
  );
}

it('mounts the workspace before the first status and acknowledges it, with no licence window', async () => {
  let report: (status: LicenceStatus) => void = () => undefined;
  const api = {
    ...client(),
    status: vi.fn(() => new Promise<LicenceStatus>((resolve) => (report = resolve))),
  };
  await render(api);
  // As in 1.0.20, nothing waits on a licence to open KerfDesk.
  expect(document.querySelector('[data-workspace]')).not.toBeNull();
  expect(licenceWindow()).toBeNull();
  // The mounted workspace counts as admitted, so desktop services follow it.
  await act(async () => report({ ...free, admissionGeneration: 3 }));
  expect(api.workspaceAdmitted).toHaveBeenCalledWith(3);
  expect(licenceWindow()).toBeNull();
  expect(editionChip().getAttribute('aria-label')).toBe(
    'Edition: Free · Try Pro. Open licence settings',
  );
});

it('asks for a licence only when a Pro tool opens, and a trial opens it', async () => {
  const api = client();
  const open = vi.fn();
  await render(api, open);
  await act(async () => button('Open V-carve').click());
  expect(open).not.toHaveBeenCalled();
  expect(host.textContent).toContain('V-carve is a Pro tool');
  expect(host.textContent).toContain('Everything else in KerfDesk stays free');
  await act(async () => button('Start free 30-day trial').click());
  expect(api.startTrial).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
  expect(editionChip().textContent).toContain('Pro trial');
});

it('opens Help > Licence as KerfDesk Free, with the Pro trial on offer', async () => {
  await render(client());
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  const panel = document.querySelector('[role="dialog"][aria-label="KerfDesk licence"]');
  expect(panel?.textContent).toContain('KerfDesk Free');
  expect(panel?.textContent).toContain('Free covers drawing, text, import');
  expect(panel?.textContent).not.toContain('runs in your web browser');
  expect(panel?.textContent).not.toContain('Licence needed');
  expect(button('Start free 30-day Pro trial')).toBeDefined();
  expect(licenceWindow()).toBeNull();
});

it('opens Help > Licence with a purchase-link key at once, not after a window', async () => {
  const key = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;
  const licenceLink = vi
    .fn()
    .mockResolvedValueOnce({ open: true, licenseKey: key })
    .mockResolvedValue({ open: false, licenseKey: null });
  await render({ ...client(), licenceLink });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(licenceLink).toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"][aria-label="KerfDesk licence"]')).not.toBeNull();
  expect(document.querySelector<HTMLInputElement>('#kerfdesk-licence-key')?.value).toBe(key);
  expect(licenceWindow()).toBeNull();
});

it('names KerfDesk Free in the status bar and after a trial ends', () => {
  expect(editionLabel(free, 0)).toBe('Free · Try Pro');
  const ended = { ...free, state: 'trial-expired', tier: 'trial' } as const;
  expect(editionLabel(ended, 0)).toBe('Free');
  expect(editionLabel(trial, 2_000_000_000 - 86_400 * 3 + 10)).toBe('Pro trial · 3 days left');
  // The ended trial keeps the workspace and Free tools; only Pro pauses.
  const expired = expireTrialStatus({ ...trial, accessExpiresAt: 1 });
  expect(expired.message).toContain('Existing work keeps working');
  expect(expired.message).not.toContain('keep using KerfDesk');
});
