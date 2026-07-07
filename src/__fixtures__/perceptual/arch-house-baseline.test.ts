// Real-image baseline: the user's actual Arch House / Langebaan source logo.
// This is the non-skippable acceptance fixture for the first trace-quality loop:
// logo-like imports must use Line Art filled contours, not Edge Detection or
// Centerline, so text does not become the broken double-outline artwork the user
// reported from screenshots.

import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import { preprocessForTrace } from '../../core/trace/trace-image';
import { decodePngFile } from './png-decode';
import { compareMasks } from './compare';
import {
  buildTraceArtifact,
  DEFAULT_TRACE_ARTIFACT_EVIDENCE_DIR,
  requiredArchHouseFixtureStatus,
  writeTraceArtifactEvidence,
} from './trace-artifact-runner';
import { rasterizeColoredPaths, type Mask } from './rasterize';
import { countInk } from './benchmark-rating';

const LINE_ART_OPTIONS = TRACE_PRESETS['Line Art']!;
const LANGEBAAN_BAND = { x0: 300, y0: 660, x1: 735, y1: 725 };

describe('arch-house real logo Line Art acceptance', () => {
  it(
    'traces the required source fixture as filled logo contours, not edge outlines',
    { timeout: 120_000 },
    async () => {
      const fixture = requiredArchHouseFixtureStatus();
      expect(fixture.present, fixture.expectedPathGlob).toBe(true);
      expect(fixture.path, fixture.expectedPathGlob).not.toBeNull();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);

      const image = decodePngFile(fixture.path);
      const start = performance.now();
      const paths = await traceImageToColoredPaths(image, LINE_ART_OPTIONS);
      const elapsedMs = performance.now() - start;
      const artifact = buildTraceArtifact({
        name: 'arch-house-langebaan-line-art',
        mode: 'filled-contours',
        source: { width: image.width, height: image.height },
        paths,
      });
      console.log(
        `[arch-house] ${image.width}x${image.height} Line Art: ${elapsedMs.toFixed(0)}ms, ` +
          `${artifact.metrics.closedPolylineCount} closed polylines, ` +
          `${artifact.metrics.openPolylineCount} open polylines, ` +
          `${artifact.metrics.holeCandidateCount} hole candidates, ` +
          `${artifact.metrics.pointCount} points`,
      );

      if (process.env.PERCEPTUAL_ARTIFACTS === '1') {
        const written = writeTraceArtifactEvidence(artifact, DEFAULT_TRACE_ARTIFACT_EVIDENCE_DIR);
        console.log(`[arch-house] evidence: ${written.metricsJsonPath}, ${written.overlaySvgPath}`);
      }

      expect(image.width).toBe(1024);
      expect(image.height).toBe(1024);
      expect(artifact.metrics.pathCount).toBeGreaterThan(0);
      expect(artifact.metrics.openPolylineCount).toBe(0);
      expect(artifact.metrics.closedPolylineCount).toBeGreaterThanOrEqual(10);
      expect(artifact.metrics.holeCandidateCount).toBeGreaterThanOrEqual(5);
      expect(artifact.metrics.smallClosedPolylineCount).toBeLessThanOrEqual(250);
      expect(artifact.metrics.pointCount).toBeGreaterThan(500);
      expect(artifact.metrics.pointCount).toBeLessThan(80_000);
      expect(artifact.metrics.bounds).toEqual({
        minX: expect.any(Number),
        minY: expect.any(Number),
        maxX: expect.any(Number),
        maxY: expect.any(Number),
      });
      expect(artifact.overlaySvg).toContain('data-trace-mode="filled-contours"');
      expect(artifact.overlaySvg).toContain('fill-rule="evenodd"');
      expect(artifact.overlaySvg).toContain('stroke="none"');
      expect(artifact.overlaySvg).not.toContain('vector-effect="non-scaling-stroke"');
    },
  );

  it(
    'keeps enough traced ink in the bottom LANGEBAAN word band',
    { timeout: 120_000 },
    async () => {
      const fixture = requiredArchHouseFixtureStatus();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
      const image = decodePngFile(fixture.path);
      const paths = await traceImageToColoredPaths(image, LINE_ART_OPTIONS);
      const mask = rasterizeColoredPaths(paths, image.width, image.height);
      const bottomWordInk = countInk(mask, LANGEBAAN_BAND);

      console.log(`[arch-house] LANGEBAAN band ink pixels: ${bottomWordInk}`);

      expect(bottomWordInk).toBeGreaterThanOrEqual(3000);
    },
  );

  it(
    'matches the preprocessed logo mask closely enough to catch visible flooding',
    { timeout: 120_000 },
    async () => {
      const fixture = requiredArchHouseFixtureStatus();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
      const image = decodePngFile(fixture.path);
      const paths = await traceImageToColoredPaths(image, LINE_ART_OPTIONS);
      const tracedMask = rasterizeColoredPaths(paths, image.width, image.height);
      const truthMask = maskFromMonochrome(preprocessForTrace(image, LINE_ART_OPTIONS));
      const metrics = compareMasks(tracedMask, truthMask);

      console.log(
        `[arch-house] Line Art mask IoU=${metrics.iou.toFixed(3)}, ` +
          `precision=${metrics.precision.toFixed(3)}, recall=${metrics.recall.toFixed(3)}`,
      );

      expect(metrics.iou).toBeGreaterThanOrEqual(0.9);
      expect(metrics.precision).toBeGreaterThanOrEqual(0.9);
      expect(metrics.recall).toBeGreaterThanOrEqual(0.9);
    },
  );

  it(
    'keeps LANGEBAAN when Line Art receives an explicit Sketch Trace off override',
    { timeout: 120_000 },
    async () => {
      const fixture = requiredArchHouseFixtureStatus();
      if (fixture.path === null) throw new Error(`Missing fixture: ${fixture.expectedPathGlob}`);
      const image = decodePngFile(fixture.path);
      const paths = await traceImageToColoredPaths(image, {
        ...LINE_ART_OPTIONS,
        sketchTrace: false,
      });
      const mask = rasterizeColoredPaths(paths, image.width, image.height);
      const bottomWordInk = countInk(mask, LANGEBAAN_BAND);

      console.log(`[arch-house] LANGEBAAN band ink pixels with sketch off: ${bottomWordInk}`);

      expect(bottomWordInk).toBeGreaterThanOrEqual(3000);
    },
  );
});

function maskFromMonochrome(image: {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}): Mask {
  const data = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < data.length; pixel += 1) {
    data[pixel] = (image.data[pixel * 4] ?? 255) < 128 ? 1 : 0;
  }
  return { width: image.width, height: image.height, data };
}
