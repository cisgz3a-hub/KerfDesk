import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { measureTopArchContinuity } from './arch-house-edge-truth';
import { buildTraceArtifact, requiredArchHouseFixtureStatus } from './trace-artifact-runner';
import { decodePngFile } from './png-decode';
import { rasterizeColoredPaths } from './rasterize';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

describe('arch-house real logo Edge Detection quality', () => {
  it(
    'uses the smooth-trace cleanup lesson to avoid tiny curve debris on the real logo',
    { timeout: 120_000 },
    () => {
      const fixture = requiredArchHouseFixtureStatus();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
      const image = decodePngFile(fixture.path);
      const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);
      const artifact = buildTraceArtifact({
        name: 'arch-house-langebaan-edge-detection',
        mode: 'edge',
        source: { width: image.width, height: image.height },
        paths,
      });

      console.log(
        `[arch-house-edge] ${artifact.metrics.closedPolylineCount} closed polylines, ` +
          `${artifact.metrics.smallClosedPolylineCount} tiny closed polylines, ` +
          `${artifact.metrics.pointCount} points, length=${artifact.metrics.totalPolylineLength}`,
      );

      // ADR-114: the mask→potrace engine emits closed contours only (the
      // LightBurn trace semantic — its tracer is potrace-based too). The old
      // chained backend emitted a mix, and the assertion history flipped with
      // each engine: outline backend pinned open === 0, chain backend pinned
      // open > 10, and the potrace engine pins open === 0 again — by
      // construction this time (potrace scans region boundaries).
      expect(artifact.metrics.openPolylineCount).toBe(0);
      expect(artifact.metrics.closedPolylineCount).toBeGreaterThan(10);
      expect(artifact.metrics.smallClosedPolylineCount).toBeLessThanOrEqual(4);
      expect(artifact.metrics.pointCount).toBeLessThan(120_000);
    },
  );

  it(
    'keeps the main top arch connected enough to avoid dotted curve fragments',
    { timeout: 120_000 },
    () => {
      const fixture = requiredArchHouseFixtureStatus();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
      const image = decodePngFile(fixture.path);
      const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);
      const archQuality = measureTopArchContinuity(paths.flatMap((path) => path.polylines));

      console.log(
        `[arch-house-edge-arch] ${archQuality.archPolylineCount} arch polylines, ` +
          `${archQuality.shortArchPolylineCount} short, ` +
          `aggregate=${archQuality.aggregateArchCoverageRatio}, ` +
          `coverage=${archQuality.longestArchCoverageRatio}, ` +
          `maxGapDeg=${archQuality.maxLongestArchGapDeg}`,
      );

      expect(archQuality.archPolylineCount).toBeLessThanOrEqual(18);
      expect(archQuality.shortArchPolylineCount).toBeLessThanOrEqual(5);
      expect(archQuality.aggregateArchCoverageRatio).toBeGreaterThanOrEqual(0.95);
      expect(archQuality.longestArchCoverageRatio).toBeGreaterThanOrEqual(0.7);
      expect(archQuality.maxLongestArchGapDeg).toBeLessThanOrEqual(30);
    },
  );

  it('does not scribble dark color regions into dense line mush', { timeout: 120_000 }, () => {
    const fixture = requiredArchHouseFixtureStatus();
    if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
    const image = decodePngFile(fixture.path);
    const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);
    // STROKE coverage, not fill: the chained backend legitimately emits one
    // closed contour around the arch interior, and even-odd filling that
    // contour covers the whole doorway box — the old fill-ratio guard
    // measured enclosure, not the mush it was written to catch. Line
    // density is the honest detector: a clean line drawing of the doorway
    // (arch edge, two birds, wave bands) strokes a small fraction of the
    // box; a noise scribble strokes most of it.
    const strokes = paths.map((path) => ({
      color: path.color,
      polylines: path.polylines.map((pl) => ({ ...pl, closed: false })),
    }));
    const mask = rasterizeColoredPaths(strokes, image.width, image.height);
    const darkDoorStrokeRatio = inkRatio(mask, { x0: 435, y0: 275, x1: 590, y1: 455 });

    console.log(`[arch-house-edge] dark doorway stroke ratio=${darkDoorStrokeRatio.toFixed(3)}`);

    expect(darkDoorStrokeRatio).toBeLessThanOrEqual(0.2);
  });
});

function inkRatio(
  mask: { readonly width: number; readonly data: Uint8Array },
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): number {
  let ink = 0;
  let total = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      ink += mask.data[y * mask.width + x] ?? 0;
      total += 1;
    }
  }
  return total === 0 ? 0 : ink / total;
}
