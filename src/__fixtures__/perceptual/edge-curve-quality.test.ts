import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import { cannyEdges } from '../../core/trace/canny-edges';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { TRACE_PRESETS } from '../../core/trace';
import {
  densifyPolyline,
  measureSegmentedStrokeContinuity,
  SEGMENTED_STROKE_CIRCLE_FIXTURE,
  type CircleFixture,
} from './edge-curve-truth';
import { polylineLength } from './centerline-geometry';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

describe('Edge Detection curved-corner quality', () => {
  it('has a complete Canny source edge map for a clean circle before vector linking', () => {
    const fixture = filledCircleFixture(112, { x: 56, y: 56 }, 30);
    const edges = cannyEdges(fixture.image, {
      blurSigma: 1.1,
      lowThresholdRatio: 0.04,
      highThresholdRatio: 0.12,
    });
    const quality = measureCircleEdgeMapQuality(edges, fixture);

    expect(quality.angularCoverageRatio).toBeGreaterThanOrEqual(0.95);
    expect(quality.maxAngularGapDeg).toBeLessThanOrEqual(22.5);
  });

  it('traces a clean circle as one continuous, well-covered curved boundary', () => {
    const fixture = filledCircleFixture(112, { x: 56, y: 56 }, 30);
    // Join gap stays at the preset default: Canny drops diagonal stretches of
    // a clean circle far wider than 2 px, and the chained backend heals them
    // with tangent-aligned bridging scaled from the join knob.
    const paths = traceImageToEdgePaths(fixture.image, {
      ...EDGE_OPTIONS,
      edgeBlurSigma: 1.1,
      edgeLowThresholdRatio: 0.04,
      edgeHighThresholdRatio: 0.12,
      edgeMinLengthPx: 12,
    });
    const polylines = paths.flatMap((path) => path.polylines);
    const quality = measureCircleBoundaryQuality(polylines, fixture);

    expect(quality.polylineCount).toBeLessThanOrEqual(2);
    expect(quality.endpointGapPx).toBeLessThanOrEqual(3);
    expect(quality.angularCoverageRatio).toBeGreaterThanOrEqual(0.7);
    expect(quality.maxAngularGapDeg).toBeLessThanOrEqual(90);
    expect(quality.meanRadialErrorPx).toBeLessThanOrEqual(8);
  });

  it('keeps smooth curved boundaries stable when the source has isolated trace noise', () => {
    const clean = noisyCircleFixture(112, { x: 56, y: 56 }, 30, false);
    const noisy = noisyCircleFixture(112, { x: 56, y: 56 }, 30, true);
    const options = {
      ...EDGE_OPTIONS,
      edgeBlurSigma: 0.8,
      edgeLowThresholdRatio: 0.035,
      edgeHighThresholdRatio: 0.11,
      edgeMinLengthPx: 8,
      edgeJoinGapPx: 2,
    };
    const cleanPaths = traceImageToEdgePaths(clean.image, options);
    const noisyPaths = traceImageToEdgePaths(noisy.image, options);
    const cleanQuality = measurePathComplexity(cleanPaths);
    const noisyQuality = measurePathComplexity(noisyPaths);

    expect(noisyQuality.polylineCount).toBeLessThanOrEqual(cleanQuality.polylineCount + 2);
    expect(noisyQuality.totalLengthPx).toBeLessThanOrEqual(cleanQuality.totalLengthPx * 1.25);
  });

  // Contract change with the chained backend: a 5-px-wide DASHED stroke has
  // real contrast edges at every dash end, so its truthful edge trace is one
  // closed outline PER DASH (LightBurn's trace of the same art does the
  // same). The old backend fused dashes into one blob outline — an artifact
  // of its dilate/erode step, not a feature. Users who want broken strokes
  // relinked into single lines trace with Centerline, whose join-gap
  // bridging works on open stroke chains.
  it('outlines each dash of a segmented stroke as its own closed contour', () => {
    const fixture = SEGMENTED_STROKE_CIRCLE_FIXTURE;
    const paths = traceImageToEdgePaths(fixture.image, {
      ...EDGE_OPTIONS,
      edgeBlurSigma: 0.9,
      edgeLowThresholdRatio: 0.04,
      edgeHighThresholdRatio: 0.12,
      edgeMinLengthPx: 10,
    });
    const polylines = paths.flatMap((path) => path.polylines);
    const quality = measureSegmentedStrokeContinuity(polylines, fixture);

    // Six dashes → six outlines (a seventh fragment tolerated for Canny
    // jitter), together covering the whole dashed ring.
    expect(quality.strokePolylineCount).toBeGreaterThanOrEqual(6);
    expect(quality.strokePolylineCount).toBeLessThanOrEqual(7);
    const closedStrokeCount = polylines.filter((pl) => pl.closed).length;
    expect(closedStrokeCount).toBeGreaterThanOrEqual(6);
    expect(quality.aggregateAngularCoverageRatio).toBeGreaterThanOrEqual(0.85);
  });
});

type CircleBoundaryQuality = {
  readonly polylineCount: number;
  readonly endpointGapPx: number;
  readonly angularCoverageRatio: number;
  readonly maxAngularGapDeg: number;
  readonly meanRadialErrorPx: number;
};

type CircleEdgeMapQuality = {
  readonly angularCoverageRatio: number;
  readonly maxAngularGapDeg: number;
};

function filledCircleFixture(size: number, center: Vec2, radius: number): CircleFixture {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;
      const value = Math.hypot(dx, dy) <= radius ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { image: { width: size, height: size, data }, center, radius };
}

function noisyCircleFixture(
  size: number,
  center: Vec2,
  radius: number,
  withNoise: boolean,
): CircleFixture {
  const fixture = filledCircleFixture(size, center, radius);
  if (!withNoise) return fixture;
  const data = new Uint8ClampedArray(fixture.image.data);
  for (let index = 0; index < 160; index += 1) {
    const angle = (index * 2.399963229728653) % (Math.PI * 2);
    const radialJitter = index % 2 === 0 ? -7 : 7;
    const x = Math.round(center.x + Math.cos(angle) * (radius + radialJitter));
    const y = Math.round(center.y + Math.sin(angle) * (radius + radialJitter));
    if (x <= 1 || y <= 1 || x + 1 >= size || y + 1 >= size) continue;
    const offset = (y * size + x) * 4;
    const value = index % 3 === 0 ? 0 : 255;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { image: { width: size, height: size, data }, center, radius };
}

function measurePathComplexity(paths: ReturnType<typeof traceImageToEdgePaths>) {
  const polylines = paths.flatMap((path) => path.polylines);
  return {
    polylineCount: polylines.length,
    totalLengthPx: polylines.reduce(
      (total, polyline) => total + polylineLength(polyline.points),
      0,
    ),
  };
}

function measureCircleBoundaryQuality(
  polylines: ReadonlyArray<Polyline>,
  fixture: CircleFixture,
): CircleBoundaryQuality {
  const longest = polylines.reduce<Polyline | null>(
    (best, polyline) =>
      best === null || polylineLength(polyline.points) > polylineLength(best.points)
        ? polyline
        : best,
    null,
  );
  const points = polylines.flatMap((polyline) => densifyPolyline(polyline));
  const sectors = 48;
  const covered = new Uint8Array(sectors);
  let radialErrorTotal = 0;
  for (const point of points) {
    const dx = point.x - fixture.center.x;
    const dy = point.y - fixture.center.y;
    const radius = Math.hypot(dx, dy);
    radialErrorTotal += Math.abs(radius - fixture.radius);
    if (Math.abs(radius - fixture.radius) > 4) continue;
    const angle = Math.atan2(dy, dx);
    const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
    covered[Math.min(sectors - 1, Math.floor((normalized / (Math.PI * 2)) * sectors))] = 1;
  }

  return {
    polylineCount: polylines.length,
    // A CLOSED polyline has no endpoint gap: the closing segment is drawn.
    endpointGapPx:
      longest === null
        ? Number.POSITIVE_INFINITY
        : longest.closed
          ? 0
          : endpointGap(longest.points),
    angularCoverageRatio: countCovered(covered) / sectors,
    maxAngularGapDeg: (maxZeroRunCyclic(covered) * 360) / sectors,
    meanRadialErrorPx:
      points.length === 0 ? Number.POSITIVE_INFINITY : radialErrorTotal / points.length,
  };
}

function measureCircleEdgeMapQuality(
  edges: Uint8Array,
  fixture: CircleFixture,
): CircleEdgeMapQuality {
  const sectors = 48;
  const covered = new Uint8Array(sectors);
  for (let y = 0; y < fixture.image.height; y += 1) {
    for (let x = 0; x < fixture.image.width; x += 1) {
      if (edges[y * fixture.image.width + x] !== 1) continue;
      const dx = x + 0.5 - fixture.center.x;
      const dy = y + 0.5 - fixture.center.y;
      if (Math.abs(Math.hypot(dx, dy) - fixture.radius) > 4) continue;
      const angle = Math.atan2(dy, dx);
      const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
      covered[Math.min(sectors - 1, Math.floor((normalized / (Math.PI * 2)) * sectors))] = 1;
    }
  }
  return {
    angularCoverageRatio: countCovered(covered) / sectors,
    maxAngularGapDeg: (maxZeroRunCyclic(covered) * 360) / sectors,
  };
}

function endpointGap(points: ReadonlyArray<Vec2>): number {
  const start = points[0];
  const end = points[points.length - 1];
  return start === undefined || end === undefined ? Number.POSITIVE_INFINITY : distance(start, end);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function countCovered(values: Uint8Array): number {
  let total = 0;
  for (const value of values) if (value === 1) total += 1;
  return total;
}

function maxZeroRunCyclic(values: Uint8Array): number {
  if (values.length === 0 || countCovered(values) === values.length) return 0;
  let best = 0;
  let run = 0;
  for (let i = 0; i < values.length * 2; i += 1) {
    if (values[i % values.length] === 0) {
      run += 1;
      best = Math.max(best, Math.min(run, values.length));
    } else {
      run = 0;
    }
  }
  return best;
}
