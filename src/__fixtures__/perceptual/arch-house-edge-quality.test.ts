import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { buildTraceArtifact, requiredArchHouseFixtureStatus } from './trace-artifact-runner';
import { decodePngFile } from './png-decode';

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

      expect(artifact.metrics.openPolylineCount).toBe(0);
      expect(artifact.metrics.closedPolylineCount).toBeGreaterThan(10);
      expect(artifact.metrics.smallClosedPolylineCount).toBeLessThanOrEqual(20);
      expect(artifact.metrics.pointCount).toBeLessThan(120_000);
    },
  );
});
