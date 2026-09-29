import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LicenceAdapter, LicenceStatus } from '../../platform/types';
import { EditionProvider } from './EditionProvider';
import { proFeaturesUnlocked, useEdition } from './edition';
import { DESKTOP_DOWNLOAD_URL } from './edition-policy';

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
async function expectDesktopDialog(open: () => void): Promise<void> {
  await act(async () => openButton().click());
  expect(open).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('V-carve is a Pro tool');
  const link = [...document.querySelectorAll('a')].find(
    (value) => value.textContent === 'Get KerfDesk Pro',
  );
  expect(link?.getAttribute('href')).toBe(DESKTOP_DOWNLOAD_URL);
  expect(document.body.textContent).not.toContain('Start free 30-day trial');
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
  expect(document.body.textContent).toContain('Pro tools come with KerfDesk Pro');
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
