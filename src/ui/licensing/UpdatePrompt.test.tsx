import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { useLaserStore } from '../state/laser-store';
import { CommercialUpdates } from './CommercialUpdates';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { UpdatePrompt } from './UpdatePrompt';
import { ToolbarUpdateButton } from './ToolbarUpdateButton';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useCommercialUpdateStore.setState({ status: null, controls: null });
  useLaserStore.setState({ fireActive: false });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function manual(
  state: CommercialUpdateStatus['state'],
  version: string | null = '2026.41.0',
  extra: Partial<CommercialUpdateStatus> = {},
): CommercialUpdateStatus {
  return {
    state,
    currentVersion: '2026.40.0',
    version,
    checkedAt: null,
    mode: 'manual',
    installOnQuit: false,
    ...extra,
  };
}

function client(...answers: CommercialUpdateStatus[]) {
  const queue = [...answers];
  return {
    updateStatus: vi.fn(async () => queue.shift() ?? answers[answers.length - 1]),
    checkForUpdates: vi.fn(async () => manual('checking', null)),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    setEarlyUpdates: vi.fn(async (enabled: boolean) => ({ available: false, enabled })),
    downloadUpdate: vi.fn(async () => manual('downloading')),
    installUpdateOnQuit: vi.fn(async () => manual('ready', '2026.41.0', { installOnQuit: true })),
    installUpdateAndClose: vi.fn(async () => manual('ready', '2026.41.0', { installOnQuit: true })),
  };
}

async function mount(adapter: ReturnType<typeof client>): Promise<void> {
  await act(async () =>
    root.render(
      <>
        <CommercialUpdates client={adapter as unknown as LicenceAdapter} updatesUntil={null} />
        <UpdatePrompt />
        <ToolbarUpdateButton />
      </>,
    ),
  );
  await wait(0);
}

async function wait(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

const prompt = (): HTMLElement | null => host.querySelector('[aria-label="KerfDesk update"]');

// The prompt's own buttons; the toolbar's Update button is read by toolbar().
function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>('button:not(.lf-toolbar-update)')].find(
    (item) => item.textContent === text,
  );
}

const toolbar = (): HTMLButtonElement | null => host.querySelector('.lf-toolbar-update');

describe('canvas update prompt (ADR-561 Amendment 5)', () => {
  it('offers an available update with its notes and clears on Not now without downloading', async () => {
    const adapter = client(
      manual('available', '2026.41.0', {
        releaseNotesState: 'available',
        releaseNotes: ['Faster previews', 'Clearer frame review'],
      }),
    );
    await mount(adapter);
    expect(prompt()?.textContent).toContain('KerfDesk 2026.41.0 is available.');
    expect(prompt()?.textContent).toContain('Faster previews');
    await act(async () => button('Not now')?.click());
    expect(prompt()).toBeNull();
    expect(toolbar()?.dataset['updateState']).toBe('download');
    expect(adapter.downloadUpdate).not.toHaveBeenCalled();
    await wait(30_000);
    expect(prompt()).toBeNull();
  });

  it('downloads on Update, follows to ready, and installs only on its own click', async () => {
    const adapter = client(manual('available'), manual('ready'));
    await mount(adapter);
    await act(async () => button('Update')?.click());
    expect(adapter.downloadUpdate).toHaveBeenCalledOnce();
    expect(prompt()?.textContent).toContain('Downloading KerfDesk 2026.41.0');
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    await wait(3_000);
    expect(prompt()?.textContent).toContain('Update ready to install');
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(adapter.installUpdateOnQuit).not.toHaveBeenCalled();
    await act(async () => button('Install now')?.click());
    expect(adapter.installUpdateAndClose).toHaveBeenCalledOnce();
    expect(adapter.installUpdateOnQuit).not.toHaveBeenCalled();
    // A cancelled close leaves the app open with the install choice still at hand.
    expect(button('Install now')?.disabled).toBe(false);
  });

  it('opens the download page on macOS and Linux and then steps aside (ADR-613)', async () => {
    const page = { delivery: 'download-page' as const };
    const adapter = client(manual('available', '2026.41.0', page));
    adapter.downloadUpdate.mockResolvedValue(manual('available', '2026.41.0', page));
    await mount(adapter);
    expect(button('Update')).toBeUndefined();
    const open = button('Download page')!;
    expect(open.title).toContain('Open the download page for KerfDesk 2026.41.0');
    await act(async () => open.click());
    expect(adapter.downloadUpdate).toHaveBeenCalledOnce();
    expect(prompt()).toBeNull();
    // The toolbar keeps the notice until the new version is installed.
    expect(toolbar()?.dataset['updateState']).toBe('download');
    expect(adapter.installUpdateOnQuit).not.toHaveBeenCalled();
  });

  it('arms install-on-close from the prompt and then gets out of the way', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    await act(async () => button('When I close')?.click());
    expect(adapter.installUpdateOnQuit).toHaveBeenCalledOnce();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(prompt()).toBeNull();
  });

  it('waits while machine work is active and while the updates panel is open', async () => {
    useLaserStore.setState({ fireActive: true });
    await mount(client(manual('available')));
    expect(prompt()).toBeNull();
    act(() => useLaserStore.setState({ fireActive: false }));
    expect(prompt()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
    });
    expect(prompt()).toBeNull();
    await act(async () => button('Close')?.click());
    expect(prompt()).not.toBeNull();
  });

  it('reports a failure only after the user acted in the prompt', async () => {
    const adapter = client(manual('available'));
    adapter.downloadUpdate.mockRejectedValueOnce(new Error('offline'));
    await mount(adapter);
    await act(async () => button('Update')?.click());
    expect(prompt()?.textContent).toContain('Update not finished');
    expect(prompt()?.textContent).toContain('download request could not be confirmed');
    await act(async () => button('Dismiss')?.click());
    expect(prompt()).toBeNull();
  });

  it('stays hidden with nothing to offer', async () => {
    await mount(client(manual('up-to-date', null)));
    expect(prompt()).toBeNull();
    await wait(30_000);
    expect(prompt()).toBeNull();
  });
});
