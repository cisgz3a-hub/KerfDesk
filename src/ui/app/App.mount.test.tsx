import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useStore } from '../state';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { App } from './App';
import { PlatformProvider } from './platform-context';

// The Windows module runner cannot turn the PWA plugin's virtual id into a
// file path, so this file failed at collection on a Windows checkout (it was
// fine on CI). Stub the hook the way PwaUpdateWatcher.test.tsx does; the
// update watcher's own behaviour is covered there, not here.
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
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

describe('App mount', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    window.localStorage.clear();
    useStore.getState().newProject();
    useUiStore.setState({
      imageDialog: null,
      modalDepth: 0,
      registrationPanelOpen: false,
      textDialog: null,
      workspaceContextBar: null,
    });
    useLaserStore.setState({
      controllerOperation: null,
      fireActive: false,
      motionOperation: null,
      streamer: null,
    });
    useToastStore.setState({ toasts: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = null;
    stubCanvasEnvironment();
  });

  afterEach(() => {
    if (root !== null) act(() => root?.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    'mounts the real shell when storage access is denied: %s',
    async (denied) => {
      if (denied) {
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('Storage disabled for this origin', 'SecurityError');
        });
      }
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args) => {
        consoleErrors.push(args.map(String).join(' '));
      });

      await act(async () => {
        root = createRoot(host);
        root.render(
          <StrictMode>
            <ErrorBoundary>
              <PlatformProvider adapter={mockPlatform}>
                <App />
              </PlatformProvider>
            </ErrorBoundary>
          </StrictMode>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const alertText = host.querySelector('[role="alert"]')?.textContent ?? '';
      expect(host.textContent).not.toContain('Something broke');
      expect(host.querySelector('main')).not.toBeNull();
      expect(alertText).not.toContain('Rendered more hooks');
      expect(consoleErrors.filter(isHookOrderOrBoundaryError)).toEqual([]);
    },
  );

  it('floats the live motion popup outside the workspace so mounting it never reflows anything', async () => {
    useLaserStore.setState({ motionOperation: startMotionOperation('jog') });

    await act(async () => {
      root = createRoot(host);
      root.render(
        <PlatformProvider adapter={mockPlatform}>
          <App />
        </PlatformProvider>,
      );
      await Promise.resolve();
    });

    const workspace = host.querySelector('main');
    const liveMotionBar = host.querySelector<HTMLElement>('[aria-label="Live Motion"]');
    expect(liveMotionBar).not.toBeNull();
    // In flow between <main> and the status bar, the bar resized the canvas
    // every time a jog or auto-focus started and settled. As a `fixed` popup
    // outside <main> it takes no layout space anywhere and sits in no
    // ancestor's box, so the rails and the drawing stay exactly where they
    // were and no overflow can clip it (ADR-207 amendment).
    expect(workspace?.contains(liveMotionBar)).toBe(false);
    expect(liveMotionBar?.style.position).toBe('fixed');
    // Content-sized, not full-bleed: it must not claim the window's width.
    expect(liveMotionBar?.style.width).toBe('max-content');
    // Topmost, so no dialog can cover the software Abort path.
    expect(liveMotionBar?.style.zIndex).toBe('2147483647');
  });
});

describe('CommandShell hook ordering', () => {
  it('keeps input-pick hooks before command-store subscriptions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/commands/CommandShell.tsx'), 'utf8');
    const commandsIndex = source.indexOf('const commands = useAppCommands');
    const imagePickIndex = source.indexOf('const onImagePick = useImagePickHandler();');
    const multiTracePickIndex = source.indexOf(
      'const onMultiFileTracePick = useMultiFileTracePickHandler();',
    );

    expect(commandsIndex).toBeGreaterThan(0);
    expect(imagePickIndex).toBeGreaterThan(0);
    expect(multiTracePickIndex).toBeGreaterThan(0);
    expect(imagePickIndex).toBeLessThan(commandsIndex);
    expect(multiTracePickIndex).toBeLessThan(commandsIndex);
  });
});

function isHookOrderOrBoundaryError(message: string): boolean {
  return (
    message.includes('change in the order of Hooks') ||
    message.includes('Rendered more hooks than during the previous render') ||
    message.includes('[lf2:ErrorBoundary]')
  );
}

function stubCanvasEnvironment(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {
        /* jsdom has no layout; tests trigger no resize callbacks. */
      }
      disconnect(): void {
        /* no-op */
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        bottom: 600,
        height: 600,
        left: 0,
        right: 900,
        top: 0,
        width: 900,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => canvasRenderingContextStub() as CanvasRenderingContext2D,
  );
}

function canvasRenderingContextStub(): Partial<CanvasRenderingContext2D> {
  return new Proxy(
    {
      canvas: document.createElement('canvas'),
      createLinearGradient: () => ({ addColorStop: () => undefined }),
      createPattern: () => null,
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      getImageData: () =>
        ({ colorSpace: 'srgb', data: new Uint8ClampedArray(), height: 0, width: 0 }) as ImageData,
      measureText: () => ({ width: 0 }) as TextMetrics,
    },
    {
      get(target, property: keyof CanvasRenderingContext2D) {
        if (property in target) return target[property as keyof typeof target];
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as unknown as Partial<CanvasRenderingContext2D>;
}
