import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { hatchPlan, paintFrame, twin } from './motion-route-fixture.test-support';
import {
  compareInk,
  inkCanvas,
  InkContext,
  inkContextOf,
  installInkCanvas,
  type InkOp,
} from './motion-route-ink.test-support';
import {
  resetRouteRastersForTests,
  ROUTE_RASTER_SETTLE_MS,
  ROUTE_REBUILD_SLICE_MS,
} from './motion-route-raster';
import { visitRouteRange } from './route-range-walk';
import type { ViewTransform } from './view-transform';

const clock = { now: 1_000 };
const V1: ViewTransform = { scale: 6, offsetX: 10, offsetY: 10 };
const V2: ViewTransform = { scale: 7.2, offsetX: 4, offsetY: 7 };

beforeEach(() => {
  installInkCanvas();
  resetRouteRastersForTests();
  clock.now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  InkContext.onStroke = () => undefined;
  resetRouteRastersForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function elapse(ms: number): void {
  clock.now += ms;
  vi.advanceTimersByTime(ms);
}

function lastBlit(canvas: HTMLCanvasElement): ReadonlyArray<number> {
  const blits = inkContextOf(canvas).ops.filter(
    (op): op is Extract<InkOp, { kind: 'drawImage' }> => op.kind === 'drawImage',
  );
  const last = blits[blits.length - 1];
  if (last === undefined) throw new Error('no blit recorded');
  return last.args;
}

function segmentsBetween(plan: CanvasMotionPlan, from: number, to: number): number {
  let count = 0;
  visitRouteRange(plan, from, to, () => (count += 1));
  return count;
}

function recordStrokes(): Array<{ readonly segments: number; readonly widthPx: number }> {
  const strokes: Array<{ segments: number; widthPx: number }> = [];
  InkContext.onStroke = (segments, widthPx) => strokes.push({ segments, widthPx });
  return strokes;
}

describe('burn route raster across view changes', () => {
  it('blits the existing raster through a wheel gesture instead of restroking the route', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const half = plan.manifest.totalRouteMm / 2;
    const visible = inkCanvas(160, 90);
    paintFrame(visible, plan, half, V1);
    const strokes = recordStrokes();
    const created = vi.spyOn(document, 'createElement');

    for (let notch = 1; notch <= 10; notch += 1) {
      const view = { scale: 6 * 1.1 ** notch, offsetX: 10 - notch * 3, offsetY: 10 - notch * 2 };
      paintFrame(visible, plan, half, view);
      const ratio = view.scale / V1.scale;
      // The old view's raster, carried into the new view: offset' - offset * ratio.
      expect(lastBlit(visible)).toEqual([
        view.offsetX - V1.offsetX * ratio,
        view.offsetY - V1.offsetY * ratio,
        160 * ratio,
        90 * ratio,
      ]);
    }

    // Before: every notch restroked the whole plan and re-walked, restroked the
    // whole confirmed route. Now a notch is one drawImage.
    expect(strokes).toEqual([]);
    expect(created).not.toHaveBeenCalled();
  });

  it('keeps appending newly confirmed segments into the placeholder, in its own view', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const total = plan.manifest.totalRouteMm;
    const visible = inkCanvas(160, 90);
    paintFrame(visible, plan, total * 0.5, V1);
    paintFrame(visible, plan, total * 0.5, V2);
    const strokes = recordStrokes();

    paintFrame(visible, plan, total * 0.6, V2);

    const stroked = strokes.reduce((sum, stroke) => sum + stroke.segments, 0);
    expect(stroked).toBe(segmentsBetween(plan, total * 0.5, total * 0.6));
    // Painted at the placeholder's own scale (kerf 0.2 mm x 6 px/mm), not V2's.
    expect(strokes[0]?.widthPx).toBeCloseTo(1.2, 9);
    expect(lastBlit(visible)).toHaveLength(4);
  });

  it('rebuilds once the view is quiet, holding every segment confirmed meanwhile', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const total = plan.manifest.totalRouteMm;
    const visible = inkCanvas(160, 90);
    let confirmed = total * 0.3;
    let latest: Float32Array = new Float32Array(0);
    const redraw = vi.fn(() => {
      latest = paintFrame(visible, plan, confirmed, V2, redraw);
    });
    paintFrame(visible, plan, confirmed, V1, redraw);
    paintFrame(visible, plan, confirmed, V2, redraw);
    elapse(ROUTE_RASTER_SETTLE_MS - 50);
    confirmed = total * 0.7;
    paintFrame(visible, plan, confirmed, V2, redraw);
    expect(redraw).not.toHaveBeenCalled();

    elapse(50);

    expect(redraw).toHaveBeenCalledTimes(1);
    expect(lastBlit(visible)).toEqual([0, 0]);
    const fresh = paintFrame(inkCanvas(160, 90), twin(plan), confirmed, V2);
    for (const channel of [0, 2, 3]) {
      const ink = compareInk(latest, fresh, channel);
      expect(ink.iou).toBe(1);
      expect(ink.maxAbsDiff).toBeLessThan(1e-6);
    }
  });

  it('restarts the quiet period on every new view, so a gesture rebuilds once at its end', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const visible = inkCanvas(160, 90);
    let view = V2;
    const redraw = vi.fn(() => paintFrame(visible, plan, 5, view, redraw));
    paintFrame(visible, plan, 5, V1, redraw);
    paintFrame(visible, plan, 5, view, redraw);
    elapse(100);
    view = { ...V2, offsetX: V2.offsetX + 25 };
    paintFrame(visible, plan, 5, view, redraw);
    const strokes = recordStrokes();

    elapse(100);
    expect(redraw).not.toHaveBeenCalled();
    expect(strokes).toEqual([]);

    elapse(ROUTE_RASTER_SETTLE_MS - 100);
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(strokes.length).toBeGreaterThan(0);
    expect(lastBlit(visible)).toEqual([0, 0]);
  });

  it('drops the pending rebuild when the view returns to the painted one', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const visible = inkCanvas(160, 90);
    let view = V2;
    const redraw = vi.fn(() => paintFrame(visible, plan, 5, view, redraw));
    paintFrame(visible, plan, 5, V1, redraw);
    paintFrame(visible, plan, 5, view, redraw);
    view = V1;
    paintFrame(visible, plan, 5, view, redraw);
    const strokes = recordStrokes();

    elapse(ROUTE_RASTER_SETTLE_MS * 4);

    expect(strokes).toEqual([]);
    expect(lastBlit(visible)).toEqual([0, 0]);
  });

  it('starts over from the planned route when the confirmed route goes backwards', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const total = plan.manifest.totalRouteMm;
    const visible = inkCanvas(160, 90);
    paintFrame(visible, plan, total * 0.8, V1);

    const rewound = paintFrame(visible, plan, total * 0.2, V1);

    const fresh = paintFrame(inkCanvas(160, 90), twin(plan), total * 0.2, V1);
    expect(compareInk(rewound, fresh, 0).maxAbsDiff).toBeLessThan(1e-6);
  });

  it('spreads a large rebuild over bounded slices instead of one long task', () => {
    // 22,000 cut segments, zoomed in far enough that the kerf (0.2 mm x 13 px)
    // is wider than the floor, so every confirmed segment pays the full stroker.
    const plan = hatchPlan({ rows: 100, segmentsPerRow: 220 });
    const total = plan.manifest.totalRouteMm;
    const zoomedIn = { scale: 12, offsetX: 8, offsetY: 8 };
    const settledView = { scale: 13.2, offsetX: 6, offsetY: 6 };
    const visible = inkCanvas(280, 150);
    const redraw = vi.fn(() => paintFrame(visible, plan, total * 0.8, settledView, redraw));
    paintFrame(visible, plan, total * 0.8, zoomedIn, redraw);
    paintFrame(visible, plan, total * 0.8, settledView, redraw);
    // ADR-346's measured costs: ~3 µs per segment above one device pixel,
    // ~0.05 µs at or under it.
    let work = 0;
    InkContext.onStroke = (segments, widthPx) => {
      const cost = segments * (widthPx > 1 ? 0.003 : 0.00005);
      clock.now += cost;
      work += cost;
    };

    const slices: number[] = [];
    let before = work;
    elapse(ROUTE_RASTER_SETTLE_MS);
    slices.push(work - before);
    for (let guard = 0; redraw.mock.calls.length < 2 && guard < 1_000; guard += 1) {
      before = work;
      vi.advanceTimersToNextTimer();
      slices.push(work - before);
    }

    expect(redraw).toHaveBeenCalledTimes(2);
    expect(lastBlit(visible)).toEqual([0, 0]);
    // One batch of 1,024 wide segments is the most a slice can overrun by.
    const longest = Math.max(...slices);
    expect(longest).toBeLessThanOrEqual(ROUTE_REBUILD_SLICE_MS + 1_024 * 0.003);
    expect(slices.length).toBeGreaterThanOrEqual(4);
    // The same work used to be one synchronous task in the zoom's layout effect.
    expect(work).toBeGreaterThan(40);
  });
});
