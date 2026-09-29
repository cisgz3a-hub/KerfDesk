import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../../core/scene';
import {
  SecondPassBackgroundCache,
  SECOND_PASS_REDRAW_DELAY_MS,
} from './second-pass-background-cache';
import type { CanvasView } from './second-pass-canvas-view';
import { useSecondPassDrawing } from './second-pass-canvas-draw';
import type { SecondPassDrawing } from './second-pass-preview';
import { drawSecondPassSegments } from './second-pass-render-paths';

vi.mock('./second-pass-render-paths', () => ({ drawSecondPassSegments: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const size = { width: 800, height: 600 };
const view = { x: 17, y: 23, scale: 4 };

function drawing(count = 25_000): SecondPassDrawing {
  return {
    segments: new Float64Array(count * 5),
    chunkBounds: new Float64Array(),
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
}

function canvasHarness() {
  const canvas = document.createElement('canvas');
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  Object.defineProperty(canvas, 'getContext', { value: () => context });
  return { canvas, context };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('second-pass background bitmap', () => {
  it('moves cached pixels during interaction and rebuilds original geometry after settling', () => {
    const { canvas, context } = canvasHarness();
    const cache = new SecondPassBackgroundCache();
    const scene = { drawing: drawing(), preview: null, showPreview: false };
    expect(cache.draw(canvas, scene, view, size)).toBe('exact');
    const moved = { x: -11, y: 18, scale: 8 };
    expect(cache.draw(canvas, scene, moved, size)).toBe('cached');
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(1);
    // Independent affine mapping: x' = newX + (x - oldX) * newScale / oldScale.
    expect(context.drawImage).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      -45,
      -28,
      1600,
      1200,
    );
    expect(cache.draw(canvas, scene, moved, size, true)).toBe('exact');
    expect(drawSecondPassSegments).toHaveBeenLastCalledWith(context, scene.drawing, moved, size, 1);
    expect(cache.draw(canvas, scene, moved, size)).toBe('exact');
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached pixels for source, preview, size and pixel-ratio changes', () => {
    const { canvas } = canvasHarness();
    const cache = new SecondPassBackgroundCache();
    const source = drawing();
    const scene = { drawing: source, preview: null, showPreview: false };
    cache.draw(canvas, scene, view, size);
    cache.draw(canvas, { ...scene, drawing: drawing() }, view, size);
    const preview = drawing(1);
    const selected = { drawing: source, preview, showPreview: true };
    cache.draw(canvas, selected, view, size);
    expect(drawSecondPassSegments).toHaveBeenLastCalledWith(
      expect.anything(),
      preview,
      view,
      size,
      1,
      '#b64214',
    );
    cache.draw(canvas, selected, view, { ...size, width: 700 });
    vi.stubGlobal('devicePixelRatio', 2);
    cache.draw(canvas, selected, view, { ...size, width: 700 });
    cache.draw(canvas, { ...selected, showPreview: false }, view, size);
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(9);
    expect(canvas.width).toBe(1600);
  });

  it('draws small jobs directly and leaves source endpoint arrays unchanged', () => {
    const { canvas, context } = canvasHarness();
    const cache = new SecondPassBackgroundCache();
    const source = drawing(1);
    source.segments.set([1.23456789, -4.7654321, 5.987654321, 8.123456789, 0.125]);
    const before = source.segments.slice();
    const scene = { drawing: source, preview: null, showPreview: false };
    cache.draw(canvas, scene, view, size);
    cache.draw(canvas, scene, { ...view, x: 40 }, size);
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(2);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(source.segments).toEqual(before);
  });
});

describe('settled second-pass canvas redraw ownership', () => {
  let root: Root;
  let host: HTMLDivElement;
  const device = createProject().device;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  function Harness(props: { source: SecondPassDrawing; view: CanvasView }) {
    const refs = useSecondPassDrawing(
      {
        drawing: props.source,
        preview: null,
        showPreview: false,
        strokes: [],
        selected: null,
        device,
      },
      { view: props.view, size },
      null,
    );
    return (
      <>
        <canvas ref={refs.background} />
        <canvas ref={refs.overlay} />
        <canvas ref={refs.highlight} />
      </>
    );
  }
  async function render(source: SecondPassDrawing, nextView: CanvasView) {
    await act(async () => root.render(<Harness source={source} view={nextView} />));
  }

  it('coalesces a burst of view changes into one exact redraw of the last view', async () => {
    const source = drawing();
    await render(source, view);
    await render(source, { ...view, x: 50 });
    await act(async () => vi.advanceTimersByTime(100));
    const finalView = { ...view, x: 100 };
    await render(source, finalView);
    await act(async () => vi.advanceTimersByTime(SECOND_PASS_REDRAW_DELAY_MS - 1));
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(2);
    expect(drawSecondPassSegments).toHaveBeenLastCalledWith(
      expect.anything(),
      source,
      finalView,
      size,
      1,
    );
  });

  it('cancels pending old-source and unmounted redraws', async () => {
    const source = drawing();
    await render(source, view);
    await render(source, { ...view, x: 50 });
    const replacement = drawing();
    await render(replacement, view);
    await act(async () => vi.advanceTimersByTime(SECOND_PASS_REDRAW_DELAY_MS));
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(2);
    await render(replacement, { ...view, x: 80 });
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTime(SECOND_PASS_REDRAW_DELAY_MS));
    expect(drawSecondPassSegments).toHaveBeenCalledTimes(2);
  });
});
