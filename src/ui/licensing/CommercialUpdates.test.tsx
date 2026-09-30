import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { useToastStore } from '../state/toast-store';
import { BrowserUpdatesNotice, CommercialUpdates } from './CommercialUpdates';
import { LICENCE_SETTINGS_EVENT } from './edition';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { UpdateReadyButton } from './UpdateReadyButton';

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
  useCommercialUpdateStore.setState({ status: null });
  useToastStore.setState({ toasts: [] });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function status(
  state: CommercialUpdateStatus['state'],
  version: string | null = null,
): CommercialUpdateStatus {
  return { state, currentVersion: '2026.40.0', version, checkedAt: null };
}

function manual(
  state: CommercialUpdateStatus['state'],
  version: string | null = '2026.41.0',
  installOnQuit = false,
): CommercialUpdateStatus {
  return { ...status(state, version), mode: 'manual', installOnQuit };
}

function client(...answers: CommercialUpdateStatus[]): LicenceAdapter {
  const queue = [...answers];
  return {
    updateStatus: vi.fn(async () => queue.shift() ?? answers[answers.length - 1]),
    checkForUpdates: vi.fn(async () => status('checking')),
    earlyUpdates: vi.fn(async () => ({ available: true, enabled: false })),
    setEarlyUpdates: vi.fn(async (enabled: boolean) => ({ available: true, enabled })),
  } as unknown as LicenceAdapter;
}

async function mount(adapter: LicenceAdapter): Promise<void> {
  await act(async () =>
    root.render(
      <>
        <CommercialUpdates client={adapter} updatesUntil={null} />
        <UpdateReadyButton />
      </>,
    ),
  );
}

async function wait(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function button(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === text);
}

describe('desktop updates in the window (ADR-547)', () => {
  it('follows a check to a ready update and shows it in the status bar', async () => {
    const adapter = client(
      status('checking'),
      status('downloading', '2026.41.0'),
      status('ready', '2026.41.0'),
    );
    await mount(adapter);
    await wait(0);
    expect(button('Update ready')).toBeUndefined();
    await wait(3_000);
    await wait(3_000);
    expect(adapter.updateStatus).toHaveBeenCalledTimes(3);
    const ready = button('Update ready');
    expect(ready?.title).toContain('KerfDesk 2026.41.0 installs when you close KerfDesk');

    await act(async () => ready?.click());
    const dialog = host.querySelector('[role="dialog"][aria-label="KerfDesk updates"]');
    expect(dialog?.textContent).toContain('You have KerfDesk 2026.40.0');
    expect(dialog?.textContent).toContain('KerfDesk 2026.41.0 is ready.');
    expect(button('Check now')?.disabled).toBe(true);
    // Settled: the window stops asking.
    await wait(60_000);
    expect(adapter.updateStatus).toHaveBeenCalledTimes(3);
  });

  it('checks now from Help > Check for Updates and follows the new check', async () => {
    const adapter = client(status('up-to-date'));
    await mount(adapter);
    await wait(0);
    act(() => {
      window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
    });
    expect(host.textContent).toContain('KerfDesk is up to date.');
    await act(async () => button('Check now')?.click());
    expect(adapter.checkForUpdates).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Checking for updates...');
    await wait(3_000);
    expect(host.textContent).toContain('KerfDesk is up to date.');
    expect(host.textContent).toContain('Get new versions early (beta)');

    // The licence panel opens in the same place and replaces this one.
    act(() => {
      window.dispatchEvent(new Event(LICENCE_SETTINGS_EVENT));
    });
    expect(host.querySelector('[aria-label="KerfDesk updates"]')).toBeNull();
  });

  it('shows a build that does not update itself, and stops asking when the status is unreadable', async () => {
    const adapter = client(status('idle'));
    vi.mocked(adapter.updateStatus).mockRejectedValue(new Error('unavailable'));
    await mount(adapter);
    await wait(0);
    act(() => {
      window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
    });
    expect(host.textContent).toContain("This copy of KerfDesk doesn't update itself.");
    expect(button('Check now')).toBeUndefined();
    await wait(60_000);
    expect(adapter.updateStatus).toHaveBeenCalledOnce();
  });

  it('explains in the web app that the browser version updates itself', async () => {
    await act(async () => root.render(<BrowserUpdatesNotice />));
    act(() => {
      window.dispatchEvent(new Event(CHECK_UPDATES_EVENT));
    });
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'KerfDesk in the browser updates itself. When a new version is ready, an Update button appears in the status bar.',
    ]);
  });

  it('notifies about later manual releases and requires separate download and install consent', async () => {
    const downloadUpdate = vi.fn(async () => manual('downloading'));
    const installUpdateOnQuit = vi.fn(async () => manual('ready', '2026.41.0', true));
    const adapter = {
      ...client(manual('up-to-date', null), manual('available'), manual('ready')),
      downloadUpdate,
      installUpdateOnQuit,
      earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    };
    await mount(adapter);
    await wait(0);
    await wait(30_000);
    expect(button('Update available')?.title).toContain('Download it when you are ready');
    expect(downloadUpdate).not.toHaveBeenCalled();
    await act(async () => button('Update available')?.click());
    expect(host.textContent).not.toContain('Get new versions early (beta)');
    expect(host.textContent).not.toContain('New versions download in the background');
    await act(async () => button('Download update')?.click());
    expect(downloadUpdate).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Downloading KerfDesk');
    expect(installUpdateOnQuit).not.toHaveBeenCalled();
    await wait(3_000);
    expect(button('Update ready')?.title).toContain('Choose Install when I close KerfDesk');
    const install = button('Install when I close KerfDesk');
    expect(install?.title).toContain('does not close the app or interrupt a job');
    expect(installUpdateOnQuit).not.toHaveBeenCalled();
    await act(async () => install?.click());
    expect(installUpdateOnQuit).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('installer will open after you close KerfDesk normally');
    expect(button('Install when I close KerfDesk')).toBeUndefined();
    expect(host.querySelector('[aria-label="KerfDesk updates"]')).not.toBeNull();
  });

  it('keeps polling settled manual status, including after a temporarily unreadable response', async () => {
    const adapter = client(manual('up-to-date', null));
    await mount(adapter);
    await wait(0);
    for (let poll = 0; poll < 3; poll += 1) await wait(30_000);
    expect(adapter.updateStatus).toHaveBeenCalledTimes(4);
    vi.mocked(adapter.updateStatus).mockRejectedValueOnce(new Error('temporarily unavailable'));
    await wait(30_000);
    expect(useCommercialUpdateStore.getState().status).toMatchObject({
      state: 'unavailable',
      mode: 'manual',
    });
    await wait(30_000);
    expect(useCommercialUpdateStore.getState().status?.state).toBe('up-to-date');
  });

  it('ignores an older poll after a manual action and disables repeated requests while pending', async () => {
    let resolvePoll: (value: CommercialUpdateStatus) => void = () => undefined;
    let resolveDownload: (value: CommercialUpdateStatus) => void = () => undefined;
    const adapter = {
      ...client(manual('available')),
      downloadUpdate: vi.fn(
        () =>
          new Promise<CommercialUpdateStatus>((resolve) => {
            resolveDownload = resolve;
          }),
      ),
    };
    await mount(adapter);
    await wait(0);
    vi.mocked(adapter.updateStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    await wait(30_000);
    await act(async () => button('Update available')?.click());
    await act(async () => {
      button('Download update')?.click();
      button('Download update')?.click();
    });
    expect(adapter.downloadUpdate).toHaveBeenCalledOnce();
    expect(button('Download update')?.disabled).toBe(true);
    await act(async () => resolveDownload(manual('downloading')));
    await act(async () => resolvePoll(manual('available')));
    expect(useCommercialUpdateStore.getState().status?.state).toBe('downloading');
  });

  it('does not claim installation is armed after a failed manual request', async () => {
    const adapter = {
      ...client(manual('ready')),
      installUpdateOnQuit: vi.fn(async () => {
        throw new Error('verification failed');
      }),
    };
    await mount(adapter);
    await wait(0);
    await act(async () => button('Update ready')?.click());
    await act(async () => button('Install when I close KerfDesk')?.click());
    expect(host.textContent).toContain('try Check now again');
    expect(host.textContent).not.toContain('installer will open after');
    expect(button('Check now')?.disabled).toBe(false);
    expect(useCommercialUpdateStore.getState().status).toMatchObject({
      state: 'failed',
      mode: 'manual',
      installOnQuit: false,
    });
  });
});
