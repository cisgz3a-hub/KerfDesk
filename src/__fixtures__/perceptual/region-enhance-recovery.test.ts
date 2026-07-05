// Fix A1 acceptance (docs/trace-fidelity-fixes-handoff.md §4): on the real
// arch-house logo traced with the app's MERGED Edge options, the 2nd "A" of
// LANGEBAAN's "AA" pair loses its triangular counter (closed interior loop) at
// native resolution — the census reads 1 loop instead of 2. Re-tracing just
// the boxed AA region supersampled via enhanceRegionPaths must recover it:
// both A's read 2 closed loops, while geometry outside the region is
// untouched. Skips (like the other fixture-gated suites) when the private
// logo fixture is absent.
import { expect, it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { enhanceRegionPaths } from '../../core/trace/region-enhance';
import type { TraceOptions } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { requiredArchHouseFixtureStatus } from './trace-artifact-runner';

// The LANGEBAAN "AA" pair with padding (same band the audit harness renders).
const AA_REGION = { x: 570, y: 648, width: 110, height: 87 };
const A_COLUMNS = [
  { name: 'A2', x0: 578, x1: 625 },
  { name: 'A3', x0: 625, x1: 672 },
];
const LETTER_BAND_Y = { min: 655, max: 730 };

function mergedAppEdgeOptions(): TraceOptions {
  return {
    ...(TRACE_PRESETS['Edge Detection'] as TraceOptions),
    edgeLowThresholdRatio: 0.074,
    edgeHighThresholdRatio: 0.185,
    edgeMinLengthPx: 3,
  };
}

it(
  'region-enhance recovers the dropped AA counter on the real logo',
  { timeout: 120000 },
  async () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) return; // fixture not present in this checkout
    const image = decodePngFile(fixture.path);
    const options = mergedAppEdgeOptions();
    const fullTracePaths = traceImageToEdgePaths(image, options);

    const enhanced = await enhanceRegionPaths({
      image,
      region: AA_REGION,
      fullTracePaths,
      options,
      trace: (crop, cropOptions) => Promise.resolve(traceImageToEdgePaths(crop, cropOptions)),
    });

    // Both A's must now census 2 closed loops (silhouette + counter). At native
    // resolution A3 reads 1 — that failing state is pinned by the audit harness.
    const polylines = enhanced.flatMap((p) => p.polylines);
    for (const col of A_COLUMNS) {
      const loops = polylines.filter((pl) => {
        if (!pl.closed || pl.points.length < 3) return false;
        const c = centroid(pl.points);
        return (
          c.x >= col.x0 && c.x <= col.x1 && c.y >= LETTER_BAND_Y.min && c.y <= LETTER_BAND_Y.max
        );
      });
      expect(loops.length, `${col.name} closed-loop census`).toBe(2);
    }

    // The patch must not disturb geometry outside the region: every original
    // polyline with any point outside the AA box survives identically.
    const outside = fullTracePaths
      .flatMap((p) => p.polylines)
      .filter((pl) => !pl.points.every((p) => insideRegion(p)));
    for (const pl of outside) {
      expect(polylines).toContainEqual(pl);
    }
  },
);

function insideRegion(p: Vec2): boolean {
  return (
    p.x >= AA_REGION.x &&
    p.x <= AA_REGION.x + AA_REGION.width &&
    p.y >= AA_REGION.y &&
    p.y <= AA_REGION.y + AA_REGION.height
  );
}

function centroid(pts: ReadonlyArray<Vec2>): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
