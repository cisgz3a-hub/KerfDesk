import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CncTool } from '../../core/scene';
import {
  BIT_PREVIEW_DURATION_MS,
  BIT_PREVIEW_LOAD_TIMEOUT_MS,
  CncBitPreviewToast,
  type CncBitPreviewToastProps,
} from './CncBitPreviewToast';
import type { BitPreviewSceneResult } from './bit-preview-three-scene';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tool: CncTool = {
  id: 'hobby-v90',
  name: 'Hobby 90° V-bit',
  kind: 'v-bit',
  diameterMm: 12.7,
  tipAngleDeg: 90,
  shankDiameterMm: 6.35,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function renderToast(props: CncBitPreviewToastProps): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<CncBitPreviewToast {...props} />);
    await Promise.resolve();
  });
  return host;
}

describe('CncBitPreviewToast', () => {
  it('labels the view as a model and states the geometry it does not represent', async () => {
    const dispose = vi.fn();
    const createScene = vi.fn(async () => ({ kind: 'ok', handle: { dispose } }) as const);
    const container = await renderToast({ tool, onDismiss: vi.fn(), createScene });
    const status = container.querySelector('[role="status"]');

    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(container.textContent).toContain('Modeled cutting envelope');
    expect(container.textContent).toContain(tool.name);
    expect(container.textContent).toContain('Catalog shank: 6.35 mm (metadata only');
    expect(container.textContent).toContain('its transition is not modeled');
    expect(container.textContent).toContain('Flutes, coating, and cutting length are not modeled');
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toContain(tool.name);
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('false');
    expect(createScene).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      tool,
      expect.any(Function),
    );

    act(() => root?.unmount());
    root = null;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses briefly and also provides an explicit close control', async () => {
    const onDismiss = vi.fn();
    const createScene = vi.fn(async () => ({ kind: 'ok', handle: { dispose: vi.fn() } }) as const);
    const container = await renderToast({ tool, onDismiss, createScene });

    act(() => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    const close = container.querySelector('button');
    expect(close?.getAttribute('aria-label')).toContain(tool.name);
    act(() => close?.click());
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('starts the visible-duration clock only after the lazy scene settles', async () => {
    let finishScene: ((result: BitPreviewSceneResult) => void) | undefined;
    const pendingScene = new Promise<BitPreviewSceneResult>((resolve) => {
      finishScene = resolve;
    });
    const onDismiss = vi.fn();
    const container = await renderToast({
      tool,
      onDismiss,
      createScene: vi.fn(async () => pendingScene),
    });

    expect(container.textContent).toContain('Loading 3D preview');
    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => finishScene?.({ kind: 'ok', handle: { dispose: vi.fn() } }));
    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-dismiss while the operator hovers or focuses the preview', async () => {
    const onDismiss = vi.fn();
    const createScene = vi.fn(async () => ({ kind: 'ok', handle: { dispose: vi.fn() } }) as const);
    const container = await renderToast({ tool, onDismiss, createScene });
    const status = container.querySelector('[role="status"]');
    if (!(status instanceof HTMLElement)) throw new Error('preview status missing');
    const close = container.querySelector('button');
    if (!(close instanceof HTMLButtonElement)) throw new Error('preview close button missing');

    await act(async () => {
      Simulate.mouseEnter(status);
      Simulate.focus(close);
      Simulate.mouseLeave(status);
    });
    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      Simulate.blur(close);
    });
    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('falls back after a bounded lazy-load wait', async () => {
    const onDismiss = vi.fn();
    const createScene = vi.fn(async () => new Promise<BitPreviewSceneResult>(() => undefined));
    const container = await renderToast({ tool, onDismiss, createScene });

    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_LOAD_TIMEOUT_MS);
    });
    expect(container.textContent).toContain('3D preview unavailable');
    await act(async () => {
      vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a readable fallback when WebGL is unavailable', async () => {
    const createScene = vi.fn(async () => ({ kind: 'no-webgl', reason: 'GPU disabled' }) as const);
    const container = await renderToast({ tool, onDismiss: vi.fn(), createScene });
    const fallback = [...container.querySelectorAll('p')].find((node) =>
      node.textContent?.includes('3D preview unavailable'),
    );

    expect(fallback?.title).toBe('');
    expect(container.textContent).toContain('Preview detail: GPU disabled');
    expect(container.textContent).toContain('Cutter details remain available');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not request or draw a cone for a V-bit without a valid included angle', async () => {
    const createScene = vi.fn(async () => ({ kind: 'ok', handle: { dispose: vi.fn() } }) as const);
    const { tipAngleDeg: _removed, ...invalidTool } = tool;
    const container = await renderToast({
      tool: invalidTool,
      onDismiss: vi.fn(),
      createScene,
    });

    expect(createScene).not.toHaveBeenCalled();
    expect(container.textContent).toContain('3D preview unavailable');
    expect(container.textContent).toContain('valid 1–179° included angle');
    expect(container.textContent).toContain('no V-bit cone was modeled');
    expect(container.textContent).toContain('No cutting envelope or display stub was rendered');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not present legacy engraving geometry as a modeled cutting envelope', async () => {
    const createScene = vi.fn(async () => ({ kind: 'ok', handle: { dispose: vi.fn() } }) as const);
    const engravingTool: CncTool = {
      id: 'eng-15',
      name: '15 degree engraving bit',
      kind: 'engraving',
      diameterMm: 3.175,
      tipAngleDeg: 15,
    };
    const container = await renderToast({
      tool: engravingTool,
      onDismiss: vi.fn(),
      createScene,
    });

    expect(createScene).not.toHaveBeenCalled();
    expect(container.textContent).toContain('3D preview unavailable');
    expect(container.textContent).toContain('no engraving shape was modeled');
    expect(container.textContent).toContain('Verify the cutter profile');
    expect(container.textContent).toContain('No cutting envelope or display stub was rendered');
    expect(container.textContent).not.toContain('vertical stub is a display aid');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('switches to a readable fallback when a running scene reports failure', async () => {
    let reportFailure: ((reason: string) => void) | undefined;
    const dispose = vi.fn();
    const createScene = vi.fn(
      async (
        _canvas: HTMLCanvasElement,
        _tool: CncTool,
        onRuntimeFailure: (reason: string) => void,
      ) => {
        reportFailure = onRuntimeFailure;
        return { kind: 'ok', handle: { dispose } } as const;
      },
    );
    const onDismiss = vi.fn();
    const container = await renderToast({ tool, onDismiss, createScene });

    await act(async () => reportFailure?.('The WebGL context was lost.'));

    const fallback = [...container.querySelectorAll('p')].find((node) =>
      node.textContent?.includes('3D preview unavailable'),
    );
    expect(fallback?.title).toBe('');
    expect(container.textContent).toContain('Preview detail: The WebGL context was lost.');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(dispose).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(BIT_PREVIEW_DURATION_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('disposes a scene that finishes loading after the toast unmounts', async () => {
    let finishScene: ((result: BitPreviewSceneResult) => void) | undefined;
    const pendingScene = new Promise<BitPreviewSceneResult>((resolve) => {
      finishScene = resolve;
    });
    const dispose = vi.fn();
    const toolWithoutShank: CncTool = {
      id: tool.id,
      name: tool.name,
      kind: tool.kind,
      diameterMm: tool.diameterMm,
      tipAngleDeg: 90,
    };
    await renderToast({
      tool: toolWithoutShank,
      onDismiss: vi.fn(),
      createScene: vi.fn(async () => pendingScene),
    });

    expect(host?.textContent).toContain('Shank diameter is unknown');
    expect(host?.textContent).toContain('vertical stub is a display aid');
    act(() => root?.unmount());
    root = null;
    await act(async () => finishScene?.({ kind: 'ok', handle: { dispose } }));

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
