import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../../platform/types';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { App } from './App';
import { PlatformProvider } from './platform-context';

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

  it('does not crash the real shell with hook-order warnings on startup', async () => {
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
    expect(alertText).not.toContain('Rendered more hooks');
    expect(consoleErrors.filter(isHookOrderOrBoundaryError)).toEqual([]);
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
