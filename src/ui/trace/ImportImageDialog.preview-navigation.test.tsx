// Invariant: zooming and panning the trace preview is local viewing state. It
// must never start a new trace request (a worker message) or change the
// Boundary, however the user navigates.
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TraceResult } from './use-trace-worker-client';

const requests = vi.hoisted((): Array<{ resolve: (result: TraceResult) => void }> => []);
vi.mock('./image-loader', () => ({
  PREVIEW_MAX_EDGE_PX: 2048,
  loadImageAsRawData: vi.fn(),
  dataUrlToFile: vi.fn(async () => new File(['fixture'], 'fixture.png')),
}));
vi.mock('./region-enhance-trace', () => ({
  traceImageWithBoundaryMode: vi.fn(
    () => new Promise<TraceResult>((resolve) => requests.push({ resolve })),
  ),
}));
vi.mock('../raster/vector-to-bitmap', () => ({ buildBitmapFromVectors: vi.fn() }));

import { loadImageAsRawData } from './image-loader';
import { traceImageWithBoundaryMode } from './region-enhance-trace';
import { LIVE_ZOOM_SETTLE_MS } from './trace-preview-zoom';
import {
  mountSettlementDialog,
  settlementImage,
  settlementReady,
  settlementResult,
} from './trace-settlement.test-support';

let mounted: Awaited<ReturnType<typeof mountSettlementDialog>> | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  requests.length = 0;
  vi.mocked(traceImageWithBoundaryMode).mockClear();
  vi.mocked(loadImageAsRawData).mockReset().mockResolvedValue(settlementImage);
});
afterEach(async () => {
  await mounted?.close();
  mounted = undefined;
  vi.useRealTimers();
});

it('never re-traces or sets a Boundary while zooming and panning the preview', async () => {
  mounted = await mountSettlementDialog();
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(requests.length).toBeGreaterThan(0);
  await act(async () => requests.at(-1)!.resolve(settlementResult));
  expect(settlementReady(mounted.host)).toBe(true);
  const traced = vi.mocked(traceImageWithBoundaryMode).mock.calls.length;
  const host = mounted.host;
  const viewport = host.querySelector<HTMLDivElement>('[aria-label="Preview viewport"]')!;
  const stage = host.querySelector<HTMLDivElement>('[aria-label="Trace preview"]')!;
  // Give the stage a real size so a mistaken drag WOULD map to a Boundary.
  const rect = { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 } as DOMRect;
  stage.getBoundingClientRect = () => rect;
  viewport.getBoundingClientRect = () => rect;
  // A measured 300x200 viewport, so 1:1 exists: the 100x50 source fits at 3 px
  // per source px, making 1:1 one third of Fit.
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 200 },
  });
  const stageWidth = () => stage.style.width;
  const fire = async (target: EventTarget, event: Event) =>
    act(async () => void target.dispatchEvent(event));
  await fire(window, new Event('resize'));

  await fire(stage, new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
  await fire(
    stage,
    new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -8, ctrlKey: true }),
  );
  // Wheel and pinch steps scale the painted layer live; the stage re-lays
  // once the gesture settles.
  await act(async () => vi.advanceTimersByTimeAsync(LIVE_ZOOM_SETTLE_MS));
  expect(stageWidth()).not.toBe('100%');
  for (const [id, type, x] of [
    [1, 'pointerdown', 100],
    [2, 'pointerdown', 200],
    [2, 'pointermove', 260],
    [2, 'pointerup', 260],
    [1, 'pointerup', 100],
  ] as const) {
    await fire(stage, pointerEvent(type, { id, x, y: 50, pointerType: 'touch' }));
  }
  await fire(stage, pointerEvent('pointerdown', { id: 9, x: 50, y: 50, button: 1 }));
  await fire(stage, pointerEvent('pointermove', { id: 9, x: 20, y: 30, button: 1, buttons: 4 }));
  await fire(stage, pointerEvent('pointerup', { id: 9, x: 20, y: 30, button: 1 }));
  await fire(viewport, pointerEvent('pointerenter', { id: 3, x: 5, y: 5 }));
  await fire(document.body, new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await fire(stage, pointerEvent('pointerdown', { id: 3, x: 40, y: 40 }));
  for (const [type, x] of [
    ['mousedown', 40],
    ['mousemove', 90],
    ['mouseup', 90],
  ] as const) {
    await fire(stage, new MouseEvent(type, { bubbles: true, clientX: x, clientY: x }));
  }
  await fire(stage, pointerEvent('pointerup', { id: 3, x: 90, y: 90 }));
  await fire(document.body, new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  for (const key of ['+', '-', '1']) {
    await fire(viewport, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  expect(parseFloat(stageWidth())).toBeCloseTo(100 / 3, 6);
  await fire(viewport, new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }));
  expect(stageWidth()).toBe('100%');
  for (const label of ['1:1 actual size', 'Zoom in', 'Zoom out', 'Fit']) {
    const button = [...host.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === label || node.textContent === label,
    );
    await act(async () => button!.click());
  }
  await act(async () => vi.advanceTimersByTimeAsync(2_000));

  expect(vi.mocked(traceImageWithBoundaryMode).mock.calls.length).toBe(traced);
  expect(host.querySelector('[aria-label="Trace boundary"]')).toBeNull();
  expect(host.textContent).not.toContain('Clear Boundary');
  expect(settlementReady(host)).toBe(true);

  // Positive control: with navigation over, a plain primary drag still draws a
  // Boundary, and that (not navigation) is what asks for exactly one re-trace.
  await fire(stage, pointerEvent('pointerdown', { id: 5, x: 30, y: 20 }));
  for (const [type, x, y] of [
    ['mousedown', 30, 20],
    ['mousemove', 240, 160],
    ['mouseup', 240, 160],
  ] as const) {
    await fire(stage, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  }
  await fire(stage, pointerEvent('pointerup', { id: 5, x: 240, y: 160 }));
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(host.querySelector('[aria-label="Trace boundary"]')).not.toBeNull();
  expect(vi.mocked(traceImageWithBoundaryMode).mock.calls.length).toBe(traced + 1);
});

function pointerEvent(
  type: string,
  init: {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly button?: number;
    readonly buttons?: number;
    readonly pointerType?: 'mouse' | 'touch';
  },
): MouseEvent {
  // jsdom has no PointerEvent; the handlers only read these MouseEvent fields.
  const event = new MouseEvent(type, {
    bubbles: type !== 'pointerenter',
    cancelable: true,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
    clientX: init.x,
    clientY: init.y,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.id },
    pointerType: { value: init.pointerType ?? 'mouse' },
  });
  return event;
}
