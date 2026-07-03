import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  TRACE_PRESETS,
  traceCenterlineStrokePaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { cannyEdges } from '../../core/trace/canny-edges';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';
import {
  EDGE_SQUARE_FIXTURE,
  NOISY_PHOTO_EDGE_FIXTURE,
  measureSquarePathEdgeQuality,
  measureSquareEdgeQuality,
  measureSquareEdgeTruth,
} from './edge-truth';
import {
  buildTraceArtifact,
  requiredArchHouseFixtureStatus,
  traceArtifactToJson,
  writeTraceArtifactEvidence,
} from './trace-artifact-runner';
import {
  HOLLOW_LOGO_TRACE_FIXTURE,
  LOGO_LIKE_TRACE_FIXTURE,
  SKETCH_CONTRAST_TRACE_FIXTURE,
  TRANSPARENT_ALPHA_TRACE_FIXTURE,
} from './trace-fixtures';

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;
const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;
const LINE_ART_OPTIONS = TRACE_PRESETS['Line Art']!;

describe('trace artifact harness', () => {
  it('builds deterministic JSON and SVG overlay artifacts for centerline traces', () => {
    const fixture = CENTERLINE_TRUTH_FIXTURES.find((item) => item.name === 'h-stroke')!;
    const paths = traceCenterlineStrokePaths(fixture.image, CENTERLINE_OPTIONS);

    const artifact = buildTraceArtifact({
      name: fixture.name,
      mode: 'centerline',
      source: { width: fixture.width, height: fixture.height },
      paths,
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.metrics.pathCount).toBe(paths.length);
    expect(artifact.metrics.polylineCount).toBe(1);
    expect(artifact.metrics.pointCount).toBeGreaterThanOrEqual(2);
    expect(artifact.metrics.bounds).toEqual({
      minX: expect.any(Number),
      minY: expect.any(Number),
      maxX: expect.any(Number),
      maxY: expect.any(Number),
    });
    expect(artifact.overlaySvg).toContain('<svg');
    expect(artifact.overlaySvg).toContain('data-trace-artifact="h-stroke"');
    expect(artifact.overlaySvg).toContain('<path');
    const parsed = JSON.parse(traceArtifactToJson(artifact)) as unknown;
    expect(parsed).toEqual({
      schemaVersion: 1,
      name: 'h-stroke',
      mode: 'centerline',
      source: { width: fixture.width, height: fixture.height },
      metrics: artifact.metrics,
    });
    expect(traceArtifactToJson(artifact)).toBe(traceArtifactToJson(artifact));
    const scrambledMetricsArtifact = {
      ...artifact,
      metrics: {
        bounds: artifact.metrics.bounds,
        closedPolylineCount: artifact.metrics.closedPolylineCount,
        holeCandidateCount: artifact.metrics.holeCandidateCount,
        openPolylineCount: artifact.metrics.openPolylineCount,
        pointCount: artifact.metrics.pointCount,
        polylineCount: artifact.metrics.polylineCount,
        pathCount: artifact.metrics.pathCount,
        smallClosedPolylineCount: artifact.metrics.smallClosedPolylineCount,
        totalPolylineLength: artifact.metrics.totalPolylineLength,
      },
    };
    expect(traceArtifactToJson(scrambledMetricsArtifact)).toBe(traceArtifactToJson(artifact));
  });

  it('builds edge artifacts that expose thin boundary-trace metrics', () => {
    const image = EDGE_SQUARE_FIXTURE.image;
    const edgeMap = cannyEdges(image);
    const edgeTruth = measureSquareEdgeTruth(edgeMap, EDGE_SQUARE_FIXTURE);
    const quality = measureSquareEdgeQuality(edgeMap, EDGE_SQUARE_FIXTURE);
    const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);

    const artifact = buildTraceArtifact({
      name: 'filled-square-edge',
      mode: 'edge',
      source: { width: image.width, height: image.height },
      paths,
    });

    expect(artifact.metrics.polylineCount).toBeGreaterThanOrEqual(1);
    expect(artifact.metrics.closedPolylineCount).toBeGreaterThanOrEqual(1);
    expect(artifact.metrics.openPolylineCount).toBe(0);
    expect(artifact.metrics.pointCount).toBeGreaterThan(0);
    expect(artifact.metrics.totalPolylineLength).toBeGreaterThan(0);
    expect(edgeTruth.edgePixelCount).toBeGreaterThan(0);
    expect(edgeTruth.maxInteriorVerticalEdgeClustersPerRow).toBeLessThanOrEqual(2);
    expect(edgeTruth.maxInteriorHorizontalEdgeClustersPerColumn).toBeLessThanOrEqual(2);
    expect(quality.coverageRatio).toBeGreaterThan(0.8);
    expect(quality.maxParallelResponsesPerExpectedEdge).toBeLessThanOrEqual(1);
    expect(quality.strayEdgePixelCount).toBeLessThan(8);
    expect(artifact.overlaySvg).toContain('data-trace-mode="edge"');
    const parsed = JSON.parse(traceArtifactToJson(artifact)) as unknown;
    expect(parsed).toEqual({
      schemaVersion: 1,
      name: 'filled-square-edge',
      mode: 'edge',
      source: { width: image.width, height: image.height },
      metrics: artifact.metrics,
    });
  });

  it('measures duplicate parallel responses against square-edge truth bands', () => {
    const fixture = EDGE_SQUARE_FIXTURE;
    const edges = new Uint8Array(fixture.size * fixture.size);
    for (let y = fixture.lo; y < fixture.hi; y += 1) {
      edges[y * fixture.size + fixture.lo] = 1;
      edges[y * fixture.size + fixture.lo + 2] = 1;
      edges[y * fixture.size + fixture.hi] = 1;
    }

    const quality = measureSquareEdgeQuality(edges, fixture);

    expect(quality.coverageRatio).toBeGreaterThan(0.2);
    expect(quality.maxParallelResponsesPerExpectedEdge).toBe(2);
    expect(quality.strayEdgePixelCount).toBe(0);
  });

  it('proves restrained Edge Detection controls reduce photo-like texture paths', () => {
    const fixture = NOISY_PHOTO_EDGE_FIXTURE;
    const detailedPaths = traceImageToEdgePaths(fixture.image, {
      ...EDGE_OPTIONS,
      edgeBlurSigma: 0.4,
      edgeLowThresholdRatio: 0.01,
      edgeHighThresholdRatio: 0.03,
      edgeMinLengthPx: 0,
      edgeJoinGapPx: 0,
    });
    const restrainedPaths = traceImageToEdgePaths(fixture.image, {
      ...EDGE_OPTIONS,
      edgeBlurSigma: 2.5,
      edgeLowThresholdRatio: 0.08,
      edgeHighThresholdRatio: 0.22,
      edgeMinLengthPx: 16,
      edgeJoinGapPx: 1.5,
    });
    const detailedArtifact = buildTraceArtifact({
      name: `${fixture.name}-detailed`,
      mode: 'edge',
      source: { width: fixture.image.width, height: fixture.image.height },
      paths: detailedPaths,
    });
    const restrainedArtifact = buildTraceArtifact({
      name: `${fixture.name}-restrained`,
      mode: 'edge',
      source: { width: fixture.image.width, height: fixture.image.height },
      paths: restrainedPaths,
    });
    const detailedQuality = measureSquarePathEdgeQuality(detailedPaths, fixture);
    const restrainedQuality = measureSquarePathEdgeQuality(restrainedPaths, fixture);

    expect(detailedArtifact.metrics.totalPolylineLength).toBeGreaterThan(
      restrainedArtifact.metrics.totalPolylineLength,
    );
    expect(restrainedQuality.strayPointCount).toBeLessThan(detailedQuality.strayPointCount * 0.5);
    expect(restrainedQuality.coverageRatio).toBeGreaterThan(0.75);
    expect(restrainedArtifact.overlaySvg).toContain(
      'data-trace-artifact="noisy-photo-edge-restrained"',
    );
  });

  it('builds a metric JSON and overlay artifact for a logo-like filled-contour trace', async () => {
    const paths = await traceImageToColoredPaths(LOGO_LIKE_TRACE_FIXTURE.image, LINE_ART_OPTIONS);

    const artifact = buildTraceArtifact({
      name: LOGO_LIKE_TRACE_FIXTURE.name,
      mode: 'filled-contours',
      source: {
        width: LOGO_LIKE_TRACE_FIXTURE.width,
        height: LOGO_LIKE_TRACE_FIXTURE.height,
      },
      paths,
    });

    expect(artifact.metrics.pathCount).toBeGreaterThan(0);
    expect(artifact.metrics.closedPolylineCount).toBeGreaterThan(0);
    expect(artifact.metrics.bounds).not.toBeNull();
    expect(artifact.overlaySvg).toContain('data-trace-artifact="logo-like"');
    expect(artifact.overlaySvg).toContain('data-trace-mode="filled-contours"');
    expect(traceArtifactToJson(artifact)).not.toContain('overlaySvg');
  });

  it('writes metrics JSON and SVG overlay evidence files for a trace artifact', async () => {
    const paths = await traceImageToColoredPaths(LOGO_LIKE_TRACE_FIXTURE.image, LINE_ART_OPTIONS);
    const artifact = buildTraceArtifact({
      name: LOGO_LIKE_TRACE_FIXTURE.name,
      mode: 'filled-contours',
      source: {
        width: LOGO_LIKE_TRACE_FIXTURE.width,
        height: LOGO_LIKE_TRACE_FIXTURE.height,
      },
      paths,
    });
    const dir = mkdtempSync(join(tmpdir(), 'lf-trace-artifacts-'));
    try {
      const written = writeTraceArtifactEvidence(artifact, dir);

      expect(existsSync(written.metricsJsonPath)).toBe(true);
      expect(existsSync(written.overlaySvgPath)).toBe(true);
      expect(readFileSync(written.metricsJsonPath, 'utf8')).toBe(traceArtifactToJson(artifact));
      expect(readFileSync(written.overlaySvgPath, 'utf8')).toBe(artifact.overlaySvg);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('renders Line Art artifacts as filled contours and measures holes/specks', async () => {
    const paths = await traceImageToColoredPaths(HOLLOW_LOGO_TRACE_FIXTURE.image, LINE_ART_OPTIONS);

    const artifact = buildTraceArtifact({
      name: HOLLOW_LOGO_TRACE_FIXTURE.name,
      mode: 'filled-contours',
      source: {
        width: HOLLOW_LOGO_TRACE_FIXTURE.width,
        height: HOLLOW_LOGO_TRACE_FIXTURE.height,
      },
      paths,
    });

    expect(artifact.metrics.openPolylineCount).toBe(0);
    expect(artifact.metrics.closedPolylineCount).toBeGreaterThanOrEqual(2);
    expect(artifact.metrics.holeCandidateCount).toBeGreaterThanOrEqual(1);
    expect(artifact.metrics.smallClosedPolylineCount).toBe(0);
    expect(artifact.overlaySvg).toContain('fill-rule="evenodd"');
    expect(artifact.overlaySvg).toContain('stroke="none"');
    expect(artifact.overlaySvg).not.toContain('fill="none" stroke="#000000"');
  });

  it('proves Trace Alpha Mask differs from normal Line Art on transparent art', async () => {
    const normalPaths = await traceImageToColoredPaths(
      TRANSPARENT_ALPHA_TRACE_FIXTURE.image,
      LINE_ART_OPTIONS,
    );
    const alphaPaths = await traceImageToColoredPaths(TRANSPARENT_ALPHA_TRACE_FIXTURE.image, {
      ...LINE_ART_OPTIONS,
      traceTransparency: true,
    });
    const normalArtifact = buildTraceArtifact({
      name: `${TRANSPARENT_ALPHA_TRACE_FIXTURE.name}-normal-line-art`,
      mode: 'filled-contours',
      source: {
        width: TRANSPARENT_ALPHA_TRACE_FIXTURE.width,
        height: TRANSPARENT_ALPHA_TRACE_FIXTURE.height,
      },
      paths: normalPaths,
    });
    const alphaArtifact = buildTraceArtifact({
      name: `${TRANSPARENT_ALPHA_TRACE_FIXTURE.name}-alpha-mask`,
      mode: 'filled-contours',
      source: {
        width: TRANSPARENT_ALPHA_TRACE_FIXTURE.width,
        height: TRANSPARENT_ALPHA_TRACE_FIXTURE.height,
      },
      paths: alphaPaths,
    });

    expect(normalArtifact.metrics.bounds).not.toBeNull();
    expect(alphaArtifact.metrics.bounds).not.toBeNull();
    expect(boundsArea(alphaArtifact.metrics.bounds)).toBeLessThan(
      boundsArea(normalArtifact.metrics.bounds) * 0.35,
    );
    expect(alphaArtifact.metrics.closedPolylineCount).toBeGreaterThan(0);
    expect(alphaArtifact.overlaySvg).toContain(
      'data-trace-artifact="transparent-alpha-alpha-mask"',
    );
  });

  it('proves Sketch Trace differs from normal Line Art on dark local-contrast strokes', async () => {
    const normalPaths = await traceImageToColoredPaths(
      SKETCH_CONTRAST_TRACE_FIXTURE.image,
      LINE_ART_OPTIONS,
    );
    const sketchPaths = await traceImageToColoredPaths(SKETCH_CONTRAST_TRACE_FIXTURE.image, {
      ...LINE_ART_OPTIONS,
      sketchTrace: true,
    });
    const normalArtifact = buildTraceArtifact({
      name: `${SKETCH_CONTRAST_TRACE_FIXTURE.name}-normal-line-art`,
      mode: 'filled-contours',
      source: {
        width: SKETCH_CONTRAST_TRACE_FIXTURE.width,
        height: SKETCH_CONTRAST_TRACE_FIXTURE.height,
      },
      paths: normalPaths,
    });
    const sketchArtifact = buildTraceArtifact({
      name: `${SKETCH_CONTRAST_TRACE_FIXTURE.name}-sketch-trace`,
      mode: 'filled-contours',
      source: {
        width: SKETCH_CONTRAST_TRACE_FIXTURE.width,
        height: SKETCH_CONTRAST_TRACE_FIXTURE.height,
      },
      paths: sketchPaths,
    });

    expect(normalArtifact.metrics.bounds).not.toBeNull();
    expect(sketchArtifact.metrics.bounds).not.toBeNull();
    expect(boundsArea(sketchArtifact.metrics.bounds)).toBeLessThan(
      boundsArea(normalArtifact.metrics.bounds) * 0.45,
    );
    expect(sketchArtifact.metrics.closedPolylineCount).toBeGreaterThan(0);
    expect(sketchArtifact.overlaySvg).toContain(
      'data-trace-artifact="sketch-contrast-sketch-trace"',
    );
  });

  it('caps loop rating when the required Arch House source fixture is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lf-trace-empty-fixtures-'));
    try {
      const status = requiredArchHouseFixtureStatus(dir);

      expect(status.present).toBe(false);
      expect(status.ratingCap).toBe(9);
      expect(status.path).toBeNull();
      expect(status.expectedPathGlob).toContain('arch-house-langebaan-source');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function boundsArea(
  bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  } | null,
): number {
  if (bounds === null) return 0;
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}
