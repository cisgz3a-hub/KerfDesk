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
  stage.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200 }) as DOMRect;
  const stageWidth = () => stage.style.width;
  const fire = async (target: EventTarget, event: Event) =>
    act(async () => void target.dispatchEvent(event));

  await fire(stage, new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
  await fire(
    stage,
    new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -8, ctrlKey: true }),
  );
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
  await fire(stage, pointerEvent('pointermove', { id: 9, x: 20, y: 30, button: 1 }));
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
  for (const key of ['+', '-', '1', '0']) {
    await fire(viewport, new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
  for (const label of ['Zoom in', 'Zoom out', 'Fit']) {
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
});

function pointerEvent(
  type: string,
  init: {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly button?: number;
    readonly pointerType?: 'mouse' | 'touch';
  },
): MouseEvent {
  // jsdom has no PointerEvent; the handlers only read these MouseEvent fields.
  const event = new MouseEvent(type, {
    bubbles: type !== 'pointerenter',
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.x,
    clientY: init.y,
  });
  Object.defineProperties(event, {
    pointerId: { value: init.id },
    pointerType: { value: init.pointerType ?? 'mouse' },
  });
  return event;
}
