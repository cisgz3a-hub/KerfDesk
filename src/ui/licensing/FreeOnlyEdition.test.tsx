import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider } from './EditionProvider';
import { EditionStatusButton, PRO_IN_DESKTOP_LABEL } from './EditionStatusButton';
import { LICENCE_SETTINGS_EVENT, proFeaturesUnlocked, useEdition } from './edition';
import { DESKTOP_DOWNLOAD_URL } from './edition-policy';
import { PRO_FEATURES } from './pro-features';

// Once sales open, builds that cannot take a licence run KerfDesk Free
// (ADR-544): the web app and free desktop builds point Pro tools to the
// desktop app instead of opening them.

const freeBuild: LicenceStatus = {
  channel: 'free',
  edition: 'pro',
  state: 'ready',
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
function client(status: LicenceStatus): LicenceAdapter {
  return {
    status: vi.fn(async () => status),
    activate: vi.fn(async () => status),
    startTrial: vi.fn(async () => status),
    refresh: vi.fn(async () => status),
    deactivate: vi.fn(async () => status),
    resetStore: vi.fn(async () => status),
    checkout: vi.fn(async () => status),
    claimPayment: vi.fn(async () => status),
    discardPayment: vi.fn(async () => status),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    setEarlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
  };
}
function VcarveTool({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  const edition = useEdition();
  return (
    <button type="button" onClick={() => edition.requestPro('vcarve', onOpen)}>
      Open V-carve {edition.pro ? 'Pro' : 'Free'}
    </button>
  );
}
function openButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((value) =>
    value.textContent?.startsWith('Open V-carve'),
  );
  if (found === undefined) throw new Error('Missing tool button');
  return found;
}
function expectEveryProFeatureListed(): void {
  expect(document.body.textContent).toContain(
    'All Pro features are in the KerfDesk desktop app for Windows',
  );
  const listed = [...document.querySelectorAll('[aria-label="Pro features"] li')].map(
    (item) => item.textContent,
  );
  expect(listed).toEqual(Object.values(PRO_FEATURES).map((pro) => pro.name));
  const link = [...document.querySelectorAll('a')].find(
    (value) => value.textContent === 'Get KerfDesk Pro',
  );
  expect(link?.getAttribute('href')).toBe(DESKTOP_DOWNLOAD_URL);
  expect(document.body.textContent).not.toContain('Start free 30-day trial');
}
async function expectDesktopDialog(open: () => void): Promise<void> {
  await act(async () => openButton().click());
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('V-carve is a Pro tool');
  expectEveryProFeatureListed();
}
function statusChip(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (value) => value.textContent === PRO_IN_DESKTOP_LABEL,
  );
}

it('keeps every tool in the web app until sales open', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider unlicensedRunsFree={false}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => openButton().click());
  expect(open).toHaveBeenCalledTimes(1);
});

it('runs the web app as KerfDesk Free once sales open', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider unlicensedRunsFree>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  expect(openButton().textContent).toContain('Free');
  expect(proFeaturesUnlocked()).toBe(false);
  await expectDesktopDialog(open);
});

it('runs a free desktop build as KerfDesk Free once sales open', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={client(freeBuild)} unlicensedRunsFree>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  expect(openButton().textContent).toContain('Free');
  await expectDesktopDialog(open);
});

it('does not open a Pro tool asked for before a free desktop build reports', async () => {
  let report: (status: LicenceStatus) => void = () => undefined;
  const slow = {
    ...client(freeBuild),
    status: vi.fn(() => new Promise<LicenceStatus>((resolve) => (report = resolve))),
  };
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={slow} unlicensedRunsFree>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => openButton().click());
  await act(async () => report(freeBuild));
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('V-carve is a Pro tool');
  expectEveryProFeatureListed();
});

it('keeps every tool in a free desktop build until sales open', async () => {
  const open = vi.fn();
  await act(async () =>
    root.render(
      <EditionProvider client={client(freeBuild)} unlicensedRunsFree={false}>
        <VcarveTool onOpen={open} />
      </EditionProvider>,
    ),
  );
  await act(async () => openButton().click());
  expect(open).toHaveBeenCalledTimes(1);
});

it('says in the status bar that every Pro feature is in the desktop app', async () => {
  await act(async () =>
    root.render(
      <EditionProvider unlicensedRunsFree>
        <EditionStatusButton />
      </EditionProvider>,
    ),
  );
  const chip = statusChip();
  expect(chip).toBeDefined();
  await act(async () => chip?.click());
  expect(document.body.textContent).toContain('Pro is in the desktop app');
  expectEveryProFeatureListed();
});

it('opens the same notice from Help > Licence in the web app', async () => {
  await act(async () =>
    root.render(
      <EditionProvider unlicensedRunsFree>
        <span>workspace</span>
      </EditionProvider>,
    ),
  );
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(document.body.textContent).toContain('Pro is in the desktop app');
  expectEveryProFeatureListed();
});

it('gives a free desktop build the notice instead of the licence panel', async () => {
  await act(async () =>
    root.render(
      <EditionProvider client={client(freeBuild)} unlicensedRunsFree>
        <EditionStatusButton />
      </EditionProvider>,
    ),
  );
  expect(statusChip()).toBeDefined();
  await act(async () => window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT)));
  expect(document.body.textContent).toContain('Pro is in the desktop app');
  expect(document.querySelector('[aria-label="KerfDesk licence"]')).toBeNull();
  expectEveryProFeatureListed();
});

it('shows no Pro notice before sales open', async () => {
  await act(async () =>
    root.render(
      <>
        <EditionProvider unlicensedRunsFree={false}>
          <EditionStatusButton />
        </EditionProvider>
        <EditionProvider client={client(freeBuild)} unlicensedRunsFree={false}>
          <EditionStatusButton />
        </EditionProvider>
      </>,
    ),
  );
  expect(statusChip()).toBeUndefined();
  expect(document.body.textContent).not.toContain('Pro is in the desktop app');
});
