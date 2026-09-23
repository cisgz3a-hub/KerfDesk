// Karpathy's law: green lifecycle tests do not prove the burn overlay still
// looks the same. These tests rasterize the route with the ink model (see
// motion-route-ink.test-support.ts) and compare the new raster against the old
// algorithm, re-implemented in paintReference, pixel for pixel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { hatchPlan, paintFrame, paintReference, twin } from './motion-route-fixture.test-support';
import { compareInk, inkCanvas, installInkCanvas } from './motion-route-ink.test-support';
import { resetRouteRastersForTests } from './motion-route-raster';
import type { ViewTransform } from './view-transform';

const RED = 0;
const BLUE = 2;
const ALPHA = 3;
const clock = { now: 1_000 };

beforeEach(() => {
  installInkCanvas();
  resetRouteRastersForTests();
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  resetRouteRastersForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Status updates at these fractions of the route, as a live run appends them. */
function cadence(plan: CanvasMotionPlan): number[] {
  const total = plan.manifest.totalRouteMm;
  return [0.07, 0.19, 0.33, 0.41, 0.58, 0.66].map((fraction) => total * fraction);
}

function paintLive(
  plan: CanvasMotionPlan,
  size: readonly [number, number],
  view: ViewTransform,
): Float32Array {
  const visible = inkCanvas(size[0], size[1]);
  let pixels: Float32Array = new Float32Array(0);
  for (const confirmed of cadence(plan)) pixels = paintFrame(visible, plan, confirmed, view);
  return pixels;
}

function stats(a: Float32Array, b: Float32Array) {
  return {
    scorch: compareInk(a, b, RED),
    planned: compareInk(a, b, BLUE),
    all: compareInk(a, b, ALPHA),
  };
}

describe('burn route raster, drawn against the pre-change algorithm', () => {
  it('is pixel-identical for a plan under the hairline threshold, culled or not', () => {
    // 840 segments with the job hanging off the left edge, so culling runs.
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20 });
    const view = { scale: 6, offsetX: -30, offsetY: 5 };
    const result = stats(
      paintLive(plan, [120, 40], view),
      paintReference(inkCanvas(120, 40), plan, cadence(plan), view),
    );
    // Measured: IoU 1 on every channel, largest difference 1.4e-4.
    for (const channel of Object.values(result)) {
      expect(channel.iou).toBe(1);
      expect(channel.maxAbsDiff).toBeLessThan(1e-3);
    }
  });

  it('keeps the kerf-wide scorch of a dense plan zoomed in; only the planned route thins', () => {
    // 22,000 segments at 12 px/mm: the 0.2 mm kerf is 2.4 px, above the floor.
    const plan = hatchPlan({ rows: 100, segmentsPerRow: 220 });
    const view = { scale: 12, offsetX: -40, offsetY: 6 };
    const result = stats(
      paintLive(plan, [200, 135], view),
      paintReference(inkCanvas(200, 135), twin(plan), cadence(plan), view),
    );
    // Measured: scorch IoU 1 (max diff 1.2e-4); planned 8,000 vs 8,200 inked
    // pixels (IoU 0.976) — the 1 px hairline against the old 1.2 px.
    expect(result.scorch.iou).toBe(1);
    expect(result.scorch.maxAbsDiff).toBeLessThan(1e-3);
    expect(result.planned.iou).toBeGreaterThan(0.97);
    expect(result.planned.inkA / result.planned.inkB).toBeGreaterThan(0.95);
  });

  it.each([
    // Rows 2 px apart, on pixel boundaries: the worst case for a thinner line.
    { name: 'separate rows', pitchMm: 0.5, size: [95, 215] as const },
    // Rows 0.4 px apart: the fill reads as one band either way.
    { name: 'a solid band', pitchMm: 0.1, size: [95, 55] as const },
  ])('draws a dense plan at the burn floor as hairlines within a few percent: $name', (c) => {
    const plan = hatchPlan({ rows: 100, segmentsPerRow: 220, pitchMm: c.pitchMm });
    const view = { scale: 4, offsetX: 6, offsetY: 6 };
    const result = stats(
      paintLive(plan, c.size, view),
      paintReference(inkCanvas(c.size[0], c.size[1]), twin(plan), cadence(plan), view),
    );
    // Measured IoU (mean per-pixel difference), separate rows: scorch 0.9998
    // (0.019), planned 0.976 (0.027), all ink 0.976 (0.045). Solid band: scorch
    // 0.977 (0.014), planned 0.976 (0.023), all ink 0.991 (0.019).
    for (const channel of Object.values(result)) {
      expect(channel.iou).toBeGreaterThan(0.97);
      expect(channel.meanAbsDiff).toBeLessThan(0.05);
    }
  });

  it('shows the old raster moved as the placeholder: exact for a pan, close for a zoom', () => {
    const plan = hatchPlan({ rows: 40, segmentsPerRow: 20, pitchMm: 0.25 });
    const confirmed = plan.manifest.totalRouteMm * 0.6;
    const visible = inkCanvas(170, 90);
    paintFrame(visible, plan, confirmed, { scale: 6, offsetX: 10, offsetY: 8 });
    const panned = { scale: 6, offsetX: 22, offsetY: 15 };
    const zoomed = { scale: 7.5, offsetX: 4, offsetY: 3 };

    const pan = stats(
      paintFrame(visible, plan, confirmed, panned),
      paintFrame(inkCanvas(170, 90), twin(plan), confirmed, panned),
    );
    const zoom = stats(
      paintFrame(visible, plan, confirmed, zoomed),
      paintFrame(inkCanvas(170, 90), twin(plan), confirmed, zoomed),
    );

    // The pan keeps the whole job on canvas, so its placeholder is exact.
    for (const channel of Object.values(pan)) expect(channel.maxAbsDiff).toBe(0);
    // Measured for the 1.25x zoom (nearest-neighbour here; the browser filters):
    // scorch IoU 0.996, planned 0.866, all ink 0.947 — for at most 150 ms.
    expect(zoom.scorch.iou).toBeGreaterThan(0.99);
    expect(zoom.all.iou).toBeGreaterThan(0.9);
  });
});
