import type { Vec2 } from '../scene';
import { rasterRowLine, sameRasterHead } from './emit-raster-row-line';
import { rasterScanFrame } from './raster-scan-frame';
import type { RasterRowSweepPlan } from './raster-sweep-plan';

/** Powered motion remaining after the emitter's controller-grid filtering.
 * A skipped powered run must not advance the head used by the following run.
 * Entry runways end at the active edge and contribute no powered motion. */
export function* rasterPoweredSpans(
  plan: RasterRowSweepPlan,
  context: {
    readonly activeStartX: number;
    readonly y: number;
    readonly shiftX: number;
    readonly scanAngleDeg: number | undefined;
  },
): Generator<{ readonly from: Vec2; readonly to: Vec2 }, void> {
  const line = rasterRowLine(rasterScanFrame(context.scanAngleDeg), context.y);
  let head = line.head(context.activeStartX + context.shiftX);
  for (const run of plan.runs) {
    const target = line.head(run.endXWorldMm + context.shiftX);
    if (sameRasterHead(head, target)) continue;
    // Parsed G-code has canonical zero, even when toFixed produced "-0.000".
    if (run.s > 0)
      yield {
        from: { x: head.x + 0, y: head.y + 0 },
        to: { x: target.x + 0, y: target.y + 0 },
      };
    head = target;
  }
}
