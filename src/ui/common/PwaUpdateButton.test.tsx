import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Negative-control laser-store double: ready Update must stay reachable for
// every old suppression state. If production code ever reintroduces that store
// dependency, the active-state matrix below catches the guard regression.
const h = vi.hoisted(() => ({
  streamer: { status: null as string | null },
  machine: {
    safetyNotice: null as object | null,
    motionOperation: null as object | null,
    controllerOperation: null as object | null,
  },
}));

vi.mock('../state/laser-store', () => ({
  useLaserStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      streamer: h.streamer.status === null ? null : { status: h.streamer.status },
      safetyNotice: h.machine.safetyNotice,
      motionOperation: h.machine.motionOperation,
      controllerOperation: h.machine.controllerOperation,
    }),
}));

import { usePwaUpdateStore } from '../state/pwa-update-store';
import { PwaUpdateButton } from './PwaUpdateButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BUTTON = 'button[aria-label="Apply app update"]';
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

const applyUpdate = vi.fn(() => Promise.resolve());

function markUpdateReady(): void {
  usePwaUpdateStore.setState({ availability: { kind: 'ready', applyUpdate } });
}

beforeEach(() => {
  h.streamer.status = null;
  h.machine.safetyNotice = null;
  h.machine.motionOperation = null;
  h.machine.controllerOperation = null;
  usePwaUpdateStore.setState({ availability: { kind: 'none' } });
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
  });

  it('shows the Update button when an update is ready and the machine is idle', async () => {
    markUpdateReady();
    const { host } = await render();
    const button = host.querySelector(BUTTON);
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Update');
    // Public branding: the hover copy must say KerfDesk, never LaserForge.
    expect(button?.getAttribute('title')).toContain('KerfDesk');
    expect(button?.getAttribute('title')).not.toContain('LaserForge');
  });

  it('applies the update through the staged callback on click', async () => {
    markUpdateReady();
    const { host } = await render();
    await act(async () => {
      host.querySelector<HTMLButtonElement>(BUTTON)?.click();
    });
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['streaming', 'streaming'],
    ['paused', 'paused'],
    ['done (awaiting Idle cleanup)', 'done'],
    ['errored (needs operator handling)', 'errored'],
  ])('keeps the button reachable while a job is %s', async (_label, status) => {
    markUpdateReady();
    h.streamer.status = status;
    const { host } = await render();
    expect(host.querySelector(BUTTON)).not.toBeNull();
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('Update');
  });

  it.each([
    ['a terminal safety notice', 'safetyNotice'],
    ['a motion operation', 'motionOperation'],
    ['a controller operation', 'controllerOperation'],
  ] as const)('keeps the button reachable during %s', async (_label, field) => {
    markUpdateReady();
    h.machine[field] = {};
    const { host } = await render();
    expect(host.querySelector(BUTTON)).not.toBeNull();
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('Update');
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

  it('keeps the live region truthful while a job is active', async () => {
    markUpdateReady();
    h.streamer.status = 'streaming';
    const { host } = await render();
    expect(host.querySelector(LIVE_REGION)?.textContent).toContain('Update');
  });
});
