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
});
