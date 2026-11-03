// A render crash in the workspace leaves the job protections running (audit
// 27-P2-2). The job streams from the store, so it carries on under the crash
// screen. Ctrl+. Abort, the wake lock (ADR-117), the desktop close handshake
// (ADR-549), the tab-close laser-off (C3) and the unsaved-changes prompt (H-U6)
// must carry on with it, and the crash screen offers Save for the work in memory.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { SOFTWARE_ABORT_LABEL } from '../common/software-abort-copy';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import type * as WorkspaceModule from '../workspace';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const leaf = vi.hoisted(() => ({ crash: false }));

// One ordinary canvas leaf stands in for any render bug in the workspace.
vi.mock('./AutosaveRecoveryCard', () => ({
  AutosaveRecoveryCard: (): null => {
    if (leaf.crash) throw new Error('canvas card render bug');
    return null;
  },
}));
vi.mock('./WorkspaceSidePanels', () => ({ WorkspaceSidePanels: (): null => null }));
// The canvas is not under test; jsdom has no 2D context for it.
vi.mock('../workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  Workspace: (): null => null,
}));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const realStopJob = useLaserStore.getState().stopJob;
const stopJob = vi.fn(async (_reason?: string) => undefined);
const release = vi.fn(async () => undefined);
const requestWakeLock = vi.fn(async () =>
  Object.assign(new EventTarget(), { released: false, release }),
);
const written: string[] = [];
const target: SaveTarget = {
  displayName: 'crashed.lf2',
  write: async (data) => {
    written.push(typeof data === 'string' ? data : await data.text());
  },
};
const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => target),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  useStore.getState().newProject();
  useStore.setState({ dirty: true });
  useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state, stopJob });
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: requestWakeLock },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaf.crash = false;
  written.length = 0;
  Reflect.deleteProperty(navigator, 'wakeLock');
  useLaserStore.setState({ ...initialLaserState(), stopJob: realStopJob });
  useStore.getState().newProject();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function tree(): JSX.Element {
  return (
    <PlatformProvider adapter={platform}>
      <App />
    </PlatformProvider>
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  if (found === undefined) throw new Error(`Button ${label} not found`);
  return found;
}

it('keeps the job protections and offers Save when the workspace crashes mid-job', async () => {
  await act(async () => root.render(tree()));
  await vi.waitFor(() => expect(requestWakeLock).toHaveBeenCalledOnce());

  leaf.crash = true;
  await act(async () => root.render(tree()));
  expect(host.textContent).toContain('Something broke');
  expect(host.textContent).toContain('canvas card render bug');
  expect(button(SOFTWARE_ABORT_LABEL)).toBeDefined();
  expect(release).not.toHaveBeenCalled();

  const abortKey = new KeyboardEvent('keydown', { key: '.', ctrlKey: true, cancelable: true });
  await act(async () => window.dispatchEvent(abortKey));
  expect(abortKey.defaultPrevented).toBe(true);
  expect(stopJob).toHaveBeenCalledOnce();

  const respond = vi.fn();
  const close = new CustomEvent('kerfdesk:desktop-close', {
    cancelable: true,
    detail: { operation: 'cancel', requestId: 7, respond },
  });
  await act(async () => window.dispatchEvent(close));
  expect(close.defaultPrevented).toBe(true);
  expect(respond).toHaveBeenCalledWith({ status: 'cancelled' });

  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(stopJob).toHaveBeenCalledTimes(2);
  expect(stopJob).toHaveBeenLastCalledWith('app-closing');

  // Once the job ends, closing a tab with unsaved work asks first again.
  await act(async () => useLaserStore.setState({ streamer: null }));
  expect(release).toHaveBeenCalledOnce();
  const unload = new Event('beforeunload', { cancelable: true });
  await act(async () => window.dispatchEvent(unload));
  expect(unload.defaultPrevented).toBe(true);

  const save = button('Save project');
  await act(async () => save.click());
  // act holds React's updates until it returns, so wait for the write outside it.
  await vi.waitFor(() => expect(written).toHaveLength(1));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(platform.pickFileForSave).toHaveBeenCalledOnce();
  expect(useStore.getState().dirty).toBe(false);
  expect(save.textContent).toBe('Saved');
});
