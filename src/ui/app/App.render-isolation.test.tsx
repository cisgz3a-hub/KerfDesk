// App has no memoised boundaries below it, so any App re-render re-renders
// every rail, dialog host and the workspace. The shortcut hooks it hosted
// subscribed to the 250 ms status report and, through a fresh output-scope
// object, to every main-store write — including each cursor hover. The side
// panels stand in for "the rest of the tree": they have no subscriptions of
// their own here, so they render only when App does.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import type * as WorkspaceModule from '../workspace';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { App } from './App';
import { PlatformProvider } from './platform-context';

const renders = vi.hoisted(() => ({ sidePanels: 0 }));

vi.mock('./WorkspaceSidePanels', () => ({
  WorkspaceSidePanels: (): null => {
    renders.sidePanels += 1;
    return null;
  },
}));

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

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(async () => {
  window.localStorage.clear();
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <App />
      </PlatformProvider>,
    );
  });
  renders.sidePanels = 0;
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  useStore.getState().newProject();
  useLaserStore.setState(initialLaserState());
});

describe('App render isolation', () => {
  it('does not re-render the tree for a controller status report', async () => {
    for (const x of [1, 2, 3]) {
      await act(async () =>
        useLaserStore.setState({
          statusReport: {
            state: 'Run',
            subState: null,
            mPos: { x, y: 0, z: 0 },
            wPos: null,
            wco: null,
            feed: 600,
            spindle: 255,
          },
        }),
      );
    }

    expect(renders.sidePanels).toBe(0);
  });

  it('does not re-render the tree when the cursor moves over the canvas', async () => {
    for (const x of [1, 2, 3]) {
      await act(async () => useStore.getState().setCursorMm({ x, y: 4 }));
    }

    expect(renders.sidePanels).toBe(0);
  });

  it('still answers the shortcuts App hosts, reading the state at keypress time', async () => {
    await act(async () => useStore.getState().setCursorMm({ x: 1, y: 1 }));
    expect(useStore.getState().previewMode).toBe(false);

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }),
      );
    });

    expect(useStore.getState().previewMode).toBe(true);
    expect(renders.sidePanels).toBe(0);
  });
});
