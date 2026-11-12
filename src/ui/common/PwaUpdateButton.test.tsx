import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Laser-store double with getState, read at render and at click time. The web
// Update reloads the page, so it waits while machine work runs, as the
// desktop toolbar button does (ADR-227 Amendment 2, ADR-561 Amendment 7).
const h = vi.hoisted(() => ({
  streamer: { status: null as string | null },
  machine: {
    safetyNotice: null as object | null,
    motionOperation: null as object | null,
    controllerOperation: null as object | null,
  },
}));

vi.mock('../state/laser-store', () => {
  const read = (): Record<string, unknown> => ({
    streamer: h.streamer.status === null ? null : { status: h.streamer.status },
    safetyNotice: h.machine.safetyNotice,
    motionOperation: h.machine.motionOperation,
    controllerOperation: h.machine.controllerOperation,
    fireActive: false,
    mpgActive: false,
    connection: { kind: 'disconnected' },
    statusReport: null,
  });
  const useLaserStore = Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(read()),
    { getState: read },
  );
  return { useLaserStore };
});

import { useFramePreparationStore } from '../state/frame-preparation-store';
import { usePwaUpdateStore } from '../state/pwa-update-store';
import { useToastStore } from '../state/toast-store';
import { PwaUpdateButton, WEB_UPDATE_WAITS_FOR_MACHINE } from './PwaUpdateButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BUTTON = 'button[aria-label="Apply app update"]';
const WAITING_BUTTON = 'button[aria-label="Apply app update after the job"]';
const LIVE_REGION = '[role="status"]';
const mountedRoots = new Set<Root>();

async function render(): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<PwaUpdateButton />);
  });
  if (root === null) throw new Error('root missing');
  mountedRoots.add(root);
  return { host, root };
}

async function click(host: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    host.querySelector<HTMLButtonElement>(selector)?.click();
  });
}

const applyUpdate = vi.fn(() => Promise.resolve());

function markUpdateReady(): void {
  usePwaUpdateStore.setState({ availability: { kind: 'ready', applyUpdate } });
}

function toastMessages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
  h.streamer.status = null;
  h.machine.safetyNotice = null;
  h.machine.motionOperation = null;
  h.machine.controllerOperation = null;
  usePwaUpdateStore.setState({ availability: { kind: 'none' } });
  useFramePreparationStore.setState({ pending: false });
  useToastStore.setState({ toasts: [] });
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
  });
  mountedRoots.clear();
  document.body.innerHTML = '';
});

describe('PwaUpdateButton', () => {
  it('renders nothing when no update is ready', async () => {
    const { host } = await render();
    expect(host.querySelector(BUTTON)).toBeNull();
    expect(host.querySelector(WAITING_BUTTON)).toBeNull();
  });

  it('shows the Update button when an update is ready and the machine is idle', async () => {
    markUpdateReady();
    const { host } = await render();
    const button = host.querySelector(BUTTON);
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Update');
    expect(button?.getAttribute('aria-disabled')).toBe('false');
    // Public branding: the hover copy must say KerfDesk, never LaserForge.
    expect(button?.getAttribute('title')).toContain('KerfDesk');
    expect(button?.getAttribute('title')).not.toContain('LaserForge');
  });

  it('applies the update through the staged callback on click', async () => {
    markUpdateReady();
    const { host } = await render();
    await click(host, BUTTON);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['streaming', 'streaming'],
    ['paused', 'paused'],
    ['done (awaiting Idle cleanup)', 'done'],
    ['errored (needs operator handling)', 'errored'],
  ])('waits while a job is %s, and a click does not reload', async (_label, status) => {
    markUpdateReady();
    h.streamer.status = status;
    const { host } = await render();
    const button = host.querySelector(WAITING_BUTTON);
    expect(button?.textContent).toBe('Update after job');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('title')).toContain(WEB_UPDATE_WAITS_FOR_MACHINE);
    await click(host, WAITING_BUTTON);
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(toastMessages()).toContain(WEB_UPDATE_WAITS_FOR_MACHINE);
  });

  it.each([
    ['a motion operation', 'motionOperation'],
    ['a controller operation', 'controllerOperation'],
  ] as const)('waits during %s', async (_label, field) => {
    markUpdateReady();
    h.machine[field] = {};
    const { host } = await render();
    expect(host.querySelector(WAITING_BUTTON)?.textContent).toBe('Update after job');
    await click(host, WAITING_BUTTON);
    expect(applyUpdate).not.toHaveBeenCalled();
  });

  it('waits while a Frame is being prepared', async () => {
    markUpdateReady();
    useFramePreparationStore.setState({ pending: true });
    const { host } = await render();
    expect(host.querySelector(WAITING_BUTTON)).not.toBeNull();
  });

  it('stays available with only a safety notice standing, since nothing is running', async () => {
    markUpdateReady();
    h.machine.safetyNotice = {};
    const { host } = await render();
    await click(host, BUTTON);
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('checks again at click time, so a job started after the last render still wins', async () => {
    markUpdateReady();
    const { host } = await render();
    // The double is not reactive: the button still shows Update.
    h.streamer.status = 'streaming';
    await click(host, BUTTON);
    expect(applyUpdate).not.toHaveBeenCalled();
    expect(toastMessages()).toContain(WEB_UPDATE_WAITS_FOR_MACHINE);
  });

  it('shows one waiting notice however often the waiting button is clicked', async () => {
    markUpdateReady();
    h.streamer.status = 'streaming';
    const { host } = await render();
    await click(host, WAITING_BUTTON);
    await click(host, WAITING_BUTTON);
    expect(toastMessages().filter((m) => m === WEB_UPDATE_WAITS_FOR_MACHINE)).toHaveLength(1);
  });

  // ADR-227 amendment (audit #22 P3-3): the old banner had role="alert", so
  // screen-reader users were told when an update arrived; the passive button
  // must announce through a polite live region instead — mounted persistently
  // (an already-present region announces text changes; one inserted together
  // with its text may be skipped) and audio-only, never a visual popup.
  it('mounts an empty polite live region before any update is ready', async () => {
    const { host } = await render();
    const region = host.querySelector(LIVE_REGION);
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
  });

  it('announces readiness through the live region', async () => {
    markUpdateReady();
    const { host } = await render();
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('KerfDesk');
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('Update');
  });

  it('keeps announcing readiness while a job is active', async () => {
    markUpdateReady();
    h.streamer.status = 'streaming';
    const { host } = await render();
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('Update');
  });
});
