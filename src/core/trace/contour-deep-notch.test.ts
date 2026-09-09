import { expect, it } from 'vitest';
import { mergeLightBurnTraceSettings } from '../../ui/trace/trace-options';
import type { Polyline } from '../scene';
import { traceImageToColoredPaths } from './trace-to-paths';
import { TRACE_PRESETS } from './trace-presets';
import type { TraceOptions } from './trace-image';

function horizontalCrossings(loop: Polyline, y: number): number[] {
  const crossings: number[] = [];
  for (let i = 1; i < loop.points.length; i += 1) {
    const a = loop.points[i - 1]!;
    const b = loop.points[i]!;
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  return crossings.sort((a, b) => a - b);
}

it.each([false, true])(
  'keeps a deep open notch through Smooth tracing (reflected: %s)',
  async (reflected) => {
    const data = new Uint8ClampedArray(128 * 128 * 4).fill(255);
    for (let y = 15; y < 110; y += 1) {
      for (let x = 15; x < 110; x += 1) {
        if (x >= 61 && x < 63 && y < 80) continue;
        const column = reflected ? 127 - x : x;
        data.set([0, 0, 0, 255], (y * 128 + column) * 4);
      }
    }
    const options = mergeLightBurnTraceSettings(TRACE_PRESETS.Smooth as TraceOptions, {
      smoothness: 1.33,
      optimize: 2,
      ignoreLessThanPixels: 0,
    });
    const paths = await traceImageToColoredPaths({ width: 128, height: 128, data }, options);
    const loops = paths.flatMap((path) => path.polylines);
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop.closed).toBe(true);
    expect(loop.points.at(-1)).toEqual(loop.points[0]);
    expect(loop.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    // These complete cross-sections must contain ink, an open void, then ink.
    // The flattener used to replace the notch by a short segment ending near
    // y=46, leaving only two outer-boundary crossings at these depths.
    for (const y of [50, 60, 70, 75]) {
      const crossings = horizontalCrossings(loop, y);
      expect(crossings).toHaveLength(4);
      expect(crossings[2]! - crossings[1]!).toBeGreaterThan(0.1);
      expect(crossings[1]).toBeGreaterThan(52);
      expect(crossings[2]).toBeLessThan(76);
    }
  },
);
