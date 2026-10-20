// The Registration jig and Place Board pages are full pages (ADR-641,
// ADR-636): the workspace's bars, tool strip, Artwork panel and status bar
// stand down, the page's own header carries Done, the title, the steps,
// Undo/Redo and the machine connection, the machine panel stays docked, and
// Done brings the workspace back as it was.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import type { PlatformAdapter } from '../../platform/types';
import { useCommandSearchStore } from '../commands/command-search-store';
import { useStore } from '../state';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { App } from './App';
import { PlatformProvider } from './platform-context';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));
// The pages' canvases need layout jsdom does not have; the page chrome is what
// this file checks.
vi.mock('../workspace/registration-jig/RegistrationJigCanvas', () => ({
  RegistrationJigCanvas: () => <div aria-label="Registration jig editing canvas" />,
}));
vi.mock('../laser/board-capture/PlaceBoardCanvas', () => ({
  PlaceBoardCanvas: () => <div aria-label="Place board canvas" />,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const platform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: { isSupported: () => false, requestPort: vi.fn(async () => null) },
};

let host: HTMLDivElement;
let root: Root;

// The whole app mounts for every test; on a busy runner that alone can take
// seconds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

// The jig page is a lazy chunk. Load it once up front so the first test does
// not spend its time budget on the import.
beforeAll(async () => {
  await import('../workspace/registration-jig/RegistrationJigEditor');
}, 300_000);

beforeEach(async () => {
  window.localStorage.clear();
  useStore.getState().newProject();
  useUiStore.setState({
    modalDepth: 0,
    registrationPanelOpen: false,
    boardCapturePanelOpen: false,
    workspaceContextBar: null,
    zoomFactor: 1,
    panX: 0,
    panY: 0,
  });
  useLaserStore.setState({ motionOperation: null, streamer: null, controllerOperation: null });
  useCommandSearchStore.getState().closeCommandSearch();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* jsdom has no layout */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <PlatformProvider adapter={platform}>
        <App />
      </PlatformProvider>,
    );
    await Promise.resolve();
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useUiStore.setState({ registrationPanelOpen: false, boardCapturePanelOpen: false });
  useLaserStore.setState({ motionOperation: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function find(selector: string): Element | null {
  return host.querySelector(selector);
}

// The workspace's own chrome, which a full page replaces.
function workspaceChrome(): Record<string, boolean> {
  return {
    menuBar: find('[role="menubar"][aria-label="Application menu"]') !== null,
    toolbar: find('header[aria-label="Toolbar"]') !== null,
    toolStrip: find('[aria-label="Drawing tools"]') !== null,
    // The wide layout docks the Artwork panel; the compact one offers its tab.
    artworkPanel:
      find('[aria-label="Artwork resizable panel"]') !== null ||
      find('[role="tab"][aria-label="Artwork"]') !== null,
    statusBar: find('footer[aria-label="Status bar"]') !== null,
  };
}

async function waitFor(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const found = find(selector);
    if (found !== null) return found;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Missing ${selector}`);
}

function button(within: Element, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`Missing ${name}`);
  return found;
}

const PAGES = [
  {
    name: 'Registration jig',
    page: '[role="region"][aria-label="Registration Jig"]',
    steps: 'Jig steps',
    open: () => useUiStore.getState().openRegistrationPanel(),
  },
  {
    name: 'Place board',
    page: 'section[aria-label="Place board"]',
    steps: 'Place board steps',
    open: () => useUiStore.getState().openBoardCapturePanel(),
  },
] as const;

describe.each(PAGES)('the $name page', (spec) => {
  it('takes the whole window except the docked machine panel', async () => {
    expect(Object.values(workspaceChrome())).toEqual([true, true, true, true, true]);
    act(() => spec.open());
    const page = await waitFor(spec.page);
    expect(workspaceChrome()).toEqual({
      menuBar: false,
      toolbar: false,
      toolStrip: false,
      artworkPanel: false,
      statusBar: false,
    });
    expect(
      find('[aria-label="Machine controls resizable panel"]') ??
        find('[data-active-panel="machine"]'),
    ).not.toBeNull();
    // The page's own header: Done, the title, the steps, Undo/Redo and the
    // machine connection that otherwise sits on the workspace's top bar.
    const header = page.querySelector('header');
    expect(header?.querySelector('h1')?.textContent).toBe(spec.name);
    const steps = header?.querySelector(`[role="group"][aria-label="${spec.steps}"]`);
    expect(steps?.querySelectorAll('button')).toHaveLength(3);
    expect(steps?.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(button(page, 'Done').className).toContain('lf-btn--primary');
    expect(button(page, 'Undo')).toBeDefined();
    expect(header?.querySelector('[aria-label="Machine toolbar"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="Machine toolbar"]')).toHaveLength(1);
  });

  it('keeps the live motion bar above the page', async () => {
    act(() => spec.open());
    await waitFor(spec.page);
    act(() => useLaserStore.setState({ motionOperation: startMotionOperation('jog') }));
    expect(find('[aria-label="Live Motion"]')).not.toBeNull();
  });

  it('stands down the command search and the main canvas view keys', async () => {
    act(() => spec.open());
    await waitFor(spec.page);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    });
    expect(useCommandSearchStore.getState().open).toBe(false);
    expect(useUiStore.getState().zoomFactor).toBe(1);
  });

  it('Done returns to the workspace as it was', async () => {
    act(() => {
      useStore.getState().drawShape(
        createRectangle({
          id: 'art',
          color: '#0000ff',
          spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
          transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
        }),
      );
      useStore.getState().selectObject('art');
      useUiStore.setState({ zoomFactor: 2, panX: 12, panY: -8 });
    });
    act(() => spec.open());
    const page = await waitFor(spec.page);
    // The page changes the shared selection and view while it is open.
    act(() => {
      useStore.getState().selectObject(null);
      useUiStore.setState({ zoomFactor: 4, panX: 0, panY: 0 });
    });
    act(() => button(page, 'Done').click());
    await act(async () => Promise.resolve());

    expect(find(spec.page)).toBeNull();
    expect(Object.values(workspaceChrome())).toEqual([true, true, true, true, true]);
    expect(find('[aria-label="Machine toolbar"]')).not.toBeNull();
    const ui = useUiStore.getState();
    expect([ui.zoomFactor, ui.panX, ui.panY]).toEqual([2, 12, -8]);
    expect(useStore.getState().selectedObjectId).toBe('art');
  });
});

it('a project opened on the page keeps its own view after Done', async () => {
  act(() => useUiStore.setState({ zoomFactor: 2 }));
  act(() => useUiStore.getState().openBoardCapturePanel());
  const page = await waitFor('section[aria-label="Place board"]');
  act(() => {
    useStore.getState().newProject();
    useUiStore.setState({ zoomFactor: 1 });
  });
  act(() => button(page, 'Done').click());
  expect(useUiStore.getState().zoomFactor).toBe(1);
});
