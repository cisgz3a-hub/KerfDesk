import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { CommercialUpdates } from './CommercialUpdates';
import { ToolbarUpdateButton, UPDATE_WAITS_FOR_MACHINE } from './ToolbarUpdateButton';

let host: HTMLDivElement;
let root: Root;
const laserAtStart = useLaserStore.getState();
const reviewAtStart = useJobReviewStore.getState().state;

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
  useLaserStore.setState({ streamer: laserAtStart.streamer, fireActive: false });
  useFramePreparationStore.setState({ pending: false });
  useJobReviewStore.setState({ state: reviewAtStart });
  useToastStore.setState({ toasts: [] });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function manual(
  state: CommercialUpdateStatus['state'],
  extra: Partial<CommercialUpdateStatus> = {},
): CommercialUpdateStatus {
  return {
    state,
    currentVersion: '1.0.30',
    version: '1.0.31',
    checkedAt: null,
    mode: 'manual',
    installOnQuit: false,
    ...extra,
  };
}

/** A stubbed native update service: nothing here reaches the live feed. */
function client(...answers: CommercialUpdateStatus[]) {
  const queue = [...answers];
  return {
    updateStatus: vi.fn(async () => queue.shift() ?? answers[answers.length - 1]),
    checkForUpdates: vi.fn(async () => manual('checking')),
    earlyUpdates: vi.fn(async () => ({ available: false, enabled: false })),
    setEarlyUpdates: vi.fn(async (enabled: boolean) => ({ available: false, enabled })),
    downloadUpdate: vi.fn(async () =>
      manual('downloading', {
        downloadProgress: { phase: 'receiving', receivedBytes: 42, totalBytes: 100 },
      }),
    ),
    installUpdateOnQuit: vi.fn(async () => manual('ready', { installOnQuit: true })),
    installUpdateAndClose: vi.fn(async () => manual('ready', { installOnQuit: true })),
  };
}

async function mount(adapter: ReturnType<typeof client>): Promise<void> {
  await act(async () =>
    root.render(
      <>
        <CommercialUpdates client={adapter as unknown as LicenceAdapter} updatesUntil={null} />
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

const toolbar = (): HTMLButtonElement | null => host.querySelector('.lf-toolbar-update');
const confirm = (): HTMLElement | null =>
  document.body.querySelector('[role="dialog"][aria-label="Install KerfDesk 1.0.31"]');

function confirmButton(text: string): HTMLButtonElement | undefined {
  return [...(confirm()?.querySelectorAll('button') ?? [])].find(
    (item) => item.textContent === text,
  );
}

async function click(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => element?.click());
}

function runJob(status: 'streaming' | 'paused'): void {
  act(() => useLaserStore.setState({ streamer: { status } as never }));
}

describe('toolbar Update button (ADR-561 Amendment 7)', () => {
  it('downloads with one click, shows progress, then installs after one confirmation', async () => {
    const adapter = client(manual('available'), manual('ready'));
    await mount(adapter);
    expect(toolbar()?.textContent).toBe('Update');
    expect(toolbar()?.dataset['glow']).toBe('true');
    expect(toolbar()?.getAttribute('aria-label')).toContain('KerfDesk 1.0.31 is available');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('1.0.31');

    await click(toolbar());
    expect(adapter.downloadUpdate).toHaveBeenCalledOnce();
    expect(toolbar()?.textContent).toBe('Updating 42%');
    expect(toolbar()?.dataset['glow']).toBeUndefined();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();

    await wait(3_000);
    expect(toolbar()?.dataset['updateState']).toBe('install');
    await click(toolbar());
    expect(confirm()?.textContent).toContain('Install KerfDesk 1.0.31 now?');
    expect(confirm()?.textContent).toContain('save unsaved changes');
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    await click(confirmButton('Install now'));
    expect(adapter.installUpdateAndClose).toHaveBeenCalledOnce();
    expect(adapter.installUpdateOnQuit).not.toHaveBeenCalled();
    expect(confirm()).toBeNull();
  });

  it('Not now closes the question without installing', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    await click(toolbar());
    await click(confirmButton('Not now'));
    expect(confirm()).toBeNull();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(toolbar()?.dataset['updateState']).toBe('install');
  });

  it('never installs while a job runs or is paused, and offers it again when idle', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    for (const status of ['streaming', 'paused'] as const) {
      runJob(status);
      expect(toolbar()?.textContent).toBe('Update after job');
      expect(toolbar()?.getAttribute('aria-disabled')).toBe('true');
      expect(toolbar()?.dataset['glow']).toBeUndefined();
      await click(toolbar());
      expect(confirm()).toBeNull();
    }
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    act(() => useLaserStore.setState({ streamer: laserAtStart.streamer }));
    // Nothing installs on its own once the job ends; the button is offered again.
    await wait(60_000);
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(toolbar()?.textContent).toBe('Update');
    expect(toolbar()?.getAttribute('aria-disabled')).toBe('false');
  });

  it('withdraws an open question when machine work starts', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    await click(toolbar());
    expect(confirm()).not.toBeNull();
    act(() => useFramePreparationStore.setState({ pending: true }));
    expect(confirm()).toBeNull();
    expect(toolbar()?.dataset['updateState']).toBe('waiting');
    act(() => useFramePreparationStore.setState({ pending: false }));
    expect(confirm()).toBeNull();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
  });

  it('rechecks machine work at the click, even before the button re-renders', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    await click(toolbar());
    const install = confirmButton('Install now');
    // Fire latched between the last render and the click.
    useLaserStore.setState({ fireActive: true });
    await click(install);
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      UPDATE_WAITS_FOR_MACHINE,
    );
  });

  it('waits while Job Review is open', async () => {
    const adapter = client(manual('ready'));
    await mount(adapter);
    act(() =>
      useJobReviewStore.setState({
        state: { kind: 'open', isPreparing: false, blocker: null } as never,
      }),
    );
    expect(toolbar()?.dataset['updateState']).toBe('waiting');
  });

  it('opens the verified download page on macOS and Linux and never installs', async () => {
    const page = { delivery: 'download-page' as const };
    const adapter = client(manual('available', page));
    adapter.downloadUpdate.mockResolvedValue(manual('available', page));
    await mount(adapter);
    expect(toolbar()?.title).toContain('Open its download page in your browser');
    await click(toolbar());
    expect(adapter.downloadUpdate).toHaveBeenCalledOnce();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
    expect(adapter.installUpdateOnQuit).not.toHaveBeenCalled();
  });

  it('opens Check for Updates for an update that installs on close', async () => {
    const signed: CommercialUpdateStatus = {
      state: 'ready',
      currentVersion: '1.0.30',
      version: '1.0.31',
      checkedAt: null,
    };
    const adapter = client(signed);
    await mount(adapter);
    expect(toolbar()?.textContent).toBe('Update ready');
    await click(toolbar());
    expect(host.querySelector('[aria-label="KerfDesk updates"]')).not.toBeNull();
    expect(adapter.installUpdateAndClose).not.toHaveBeenCalled();
  });

  it('stays hidden for a failure the user did not cause', async () => {
    await mount(client(manual('failed')));
    expect(toolbar()).toBeNull();
  });

  it('reports a failed install on the button, which then opens Check for Updates', async () => {
    const failing = client(manual('ready'));
    failing.installUpdateAndClose.mockRejectedValue(new Error('verification failed'));
    await mount(failing);
    await click(toolbar());
    await click(confirmButton('Install now'));
    expect(failing.installUpdateAndClose).toHaveBeenCalledOnce();
    expect(toolbar()?.textContent).toBe('Update failed');
    await click(toolbar());
    expect(host.querySelector('[aria-label="KerfDesk updates"]')).not.toBeNull();
  });
});
