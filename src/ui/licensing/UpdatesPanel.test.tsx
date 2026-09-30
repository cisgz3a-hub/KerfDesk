import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { UpdatesPanel } from './UpdatesPanel';

let host: HTMLDivElement;
let root: Root;
const onDownload = vi.fn(async () => undefined);
const onInstallOnQuit = vi.fn(async () => undefined);
const onClose = vi.fn();
const client = {
  earlyUpdates: async () => ({ available: false, enabled: false }),
  downloadUpdate: vi.fn(),
  installUpdateOnQuit: vi.fn(),
} as unknown as LicenceAdapter;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function candidate(overrides: Partial<CommercialUpdateStatus> = {}): CommercialUpdateStatus {
  return {
    state: 'available',
    mode: 'manual',
    currentVersion: '1.0.3',
    version: '1.0.4',
    checkedAt: null,
    releaseNotesState: 'available',
    releaseNotes: ['Numeric values are easier to edit.', 'Licence entry keeps rejected drafts.'],
    ...overrides,
  };
}

async function render(status: CommercialUpdateStatus): Promise<void> {
  await act(async () =>
    root.render(
      <UpdatesPanel
        client={client}
        status={status}
        updatesUntil={null}
        busy={false}
        onCheck={async () => undefined}
        onDownload={onDownload}
        onInstallOnQuit={onInstallOnQuit}
        onClose={onClose}
      />,
    ),
  );
}

function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label);
}

it('shows a bounded plain-text summary before download without acting on its content', async () => {
  const markup = '<img src=x onerror=alert(1)> https://example.invalid/';
  await render(
    candidate({
      releaseNotes: [markup, 'Two', 'Three', 'Four', 'Five', '👍'.repeat(241), 'Seven'],
    }),
  );
  const heading = host.querySelector('h2')!;
  expect(heading.textContent).toBe('What’s improved');
  const summary = heading.parentElement!;
  expect(summary.getAttribute('aria-labelledby')).toBe(heading.id);
  expect(summary.textContent).toContain('KerfDesk 1.0.4');
  expect(summary.querySelectorAll('li')).toHaveLength(6);
  expect(summary.querySelector('li')?.textContent).toBe(markup);
  expect(summary.querySelector('li:last-child')?.textContent).toBe('👍'.repeat(240));
  expect(summary.querySelector('img, a, script')).toBeNull();
  expect(summary.textContent).not.toContain('Seven');
  const download = button('Download update')!;
  expect(summary.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(onDownload).not.toHaveBeenCalled();
  expect(onInstallOnQuit).not.toHaveBeenCalled();
  await act(async () => download.click());
  expect(onDownload).toHaveBeenCalledOnce();
  expect(onInstallOnQuit).not.toHaveBeenCalled();
});

it('keeps notes for candidate states without offering an uncovered or implicit install', async () => {
  for (const state of ['downloading', 'ready', 'not-covered'] as const) {
    await render(candidate({ state }));
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(button('Download update')).toBeUndefined();
    expect(button('Install when I close KerfDesk') === undefined).toBe(state !== 'ready');
    expect(onDownload).not.toHaveBeenCalled();
    expect(onInstallOnQuit).not.toHaveBeenCalled();
  }
  await render(candidate({ state: 'ready' }));
  await act(async () => button('Install when I close KerfDesk')?.click());
  expect(onInstallOnQuit).toHaveBeenCalledOnce();
  await act(async () => button('Close')?.click());
  expect(onClose).toHaveBeenCalledOnce();
});

it('replaces stale notes with loading or legacy fallback and hides them without a candidate', async () => {
  await render(candidate({ releaseNotesState: 'loading' }));
  expect(host.textContent).toContain('Loading the release summary…');
  expect(host.querySelectorAll('li')).toHaveLength(0);
  expect(button('Download update')?.disabled).toBe(false);
  const legacy: CommercialUpdateStatus = {
    state: 'available',
    mode: 'manual',
    currentVersion: '1.0.3',
    version: '1.0.4',
    checkedAt: null,
  };
  for (const status of [candidate({ releaseNotesState: 'unavailable' }), legacy]) {
    await render(status);
    expect(host.textContent).toContain('No release summary is available for this version.');
    expect(host.querySelectorAll('li')).toHaveLength(0);
  }
  for (const status of [candidate({ version: null }), candidate({ state: 'checking' })]) {
    await render(status);
    expect(host.querySelector('h2')).toBeNull();
    expect(host.querySelectorAll('li')).toHaveLength(0);
  }
});
