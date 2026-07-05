// Benchmarks Edge Detection quality on the real Arch House/Langebaan logo
// fixture: arch continuity, speck cleanup, letter-outline closure, and
// small-letter smoothness (the 2026-07-03 defects). Split from
// trace-benchmark-regression-cases.ts (file size limit).

import { TRACE_PRESETS } from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import {
  LANGEBAAN_BAND,
  measureBandExcessTurnPer100Px,
  measureNearlyClosedOpenChains,
  measureTopArchContinuity,
} from './arch-house-edge-truth';
import { pushFindingIf, ratingFromFindings } from './benchmark-rating';
import { decodePngFile } from './png-decode';
import { buildTraceArtifact, requiredArchHouseFixtureStatus } from './trace-artifact-runner';
import type { TraceBenchmarkFinding, TraceBenchmarkResult } from './trace-benchmark-loop';

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

export function archHouseEdgeCurveCleanupBenchmark(): TraceBenchmarkResult {
  const fixture = requiredArchHouseFixtureStatus();
  const findings: TraceBenchmarkFinding[] = [];
  if (fixture.path === null) {
    return missingArchHouseEdgeBenchmark(fixture.expectedPathGlob, findings);
  }

  const image = decodePngFile(fixture.path);
  const paths = traceImageToEdgePaths(image, EDGE_OPTIONS);
  const artifact = buildTraceArtifact({
    name: 'arch-house-langebaan-edge-detection',
    mode: 'edge',
    source: { width: image.width, height: image.height },
    paths,
  });
  const polylines = paths.flatMap((path) => path.polylines);
  const archQuality = measureTopArchContinuity(polylines);
  const closureQuality = measureNearlyClosedOpenChains(polylines);
  const langebaanExcessTurnPer100Px = measureBandExcessTurnPer100Px(polylines, LANGEBAAN_BAND);
  pushFindingIf(closureQuality.nearlyClosedOpenCount > 0, findings, {
    severity: 'high',
    metric: 'nearlyClosedOpenCount',
    actual: closureQuality.nearlyClosedOpenCount,
    target: '0',
    message: 'Edge Detection left letter outlines open with a small visible gap.',
    fixHint: 'Close almost-closed loops (corner meetings included) without welding across dashes.',
  });
  pushFindingIf(langebaanExcessTurnPer100Px > 12, findings, {
    severity: 'high',
    metric: 'langebaanExcessTurnPer100Px',
    actual: langebaanExcessTurnPer100Px,
    target: '<= 12',
    message: 'Small-letter Edge Detection outlines are faceted instead of smooth on turns.',
    fixHint: 'Improve sub-pixel edge localisation / curve refinement without rounding corners.',
  });
  pushFindingIf(artifact.metrics.smallClosedPolylineCount > 4, findings, {
    severity: 'high',
    metric: 'smallClosedPolylineCount',
    actual: artifact.metrics.smallClosedPolylineCount,
    target: '<= 4',
    message: 'Arch House Edge Detection emitted too many tiny closed curve specks.',
    fixHint: 'Raise or tune edge-only minimum line cleanup without weakening Line Art.',
  });
  pushFindingIf(archQuality.archPolylineCount > 18, findings, {
    severity: 'medium',
    metric: 'archPolylineCount',
    actual: archQuality.archPolylineCount,
    target: '<= 18',
    message: 'The main arch region is over-fragmented by Edge Detection.',
    fixHint: 'Tune curve-gap linking or edge cleanup for real-logo curved bands.',
  });
  pushFindingIf(archQuality.shortArchPolylineCount > 5, findings, {
    severity: 'high',
    metric: 'shortArchPolylineCount',
    actual: archQuality.shortArchPolylineCount,
    target: '<= 5',
    message: 'The main arch still has short dotted curve fragments.',
    fixHint: 'Filter tiny edge fragments while preserving aggregate arch coverage.',
  });
  pushFindingIf(archQuality.aggregateArchCoverageRatio < 0.95, findings, {
    severity: 'high',
    metric: 'aggregateArchCoverageRatio',
    actual: archQuality.aggregateArchCoverageRatio,
    target: '>= 0.95',
    message: 'Edge Detection lost visible coverage across the main arch.',
    fixHint: 'Preserve real curve coverage while filtering short fragments.',
  });
  pushFindingIf(archQuality.longestArchCoverageRatio < 0.7, findings, {
    severity: 'high',
    metric: 'longestArchCoverageRatio',
    actual: archQuality.longestArchCoverageRatio,
    target: '>= 0.7',
    message: 'No single Edge Detection contour carries enough of the main arch.',
    fixHint: 'Keep the VTracer continuity pass active for real-logo curved bands.',
  });
  pushFindingIf(archQuality.maxLongestArchGapDeg > 30, findings, {
    severity: 'medium',
    metric: 'maxLongestArchGapDeg',
    actual: archQuality.maxLongestArchGapDeg,
    target: '<= 30',
    message: 'The strongest arch contour still has a visible curve gap.',
    fixHint: 'Tune VTracer fallback and edge thresholding before loosening the UI preset.',
  });
  return {
    id: 'arch-house-edge-curve-cleanup',
    name: 'Arch House Edge Detection curve cleanup',
    rating: ratingFromFindings(findings),
    metrics: {
      fixturePresent: 1,
      smallClosedPolylineCount: artifact.metrics.smallClosedPolylineCount,
      pointCount: artifact.metrics.pointCount,
      archPolylineCount: archQuality.archPolylineCount,
      shortArchPolylineCount: archQuality.shortArchPolylineCount,
      aggregateArchCoverageRatio: archQuality.aggregateArchCoverageRatio,
      longestArchCoverageRatio: archQuality.longestArchCoverageRatio,
      maxLongestArchGapDeg: archQuality.maxLongestArchGapDeg,
      nearlyClosedOpenCount: closureQuality.nearlyClosedOpenCount,
      maxNearlyClosedGapPx: closureQuality.maxNearlyClosedGapPx,
      langebaanExcessTurnPer100Px,
    },
    benchmark: {
      fixturePresent: 'present',
      smallClosedPolylineCount: '<= 4',
      archPolylineCount: '<= 18',
      shortArchPolylineCount: '<= 5',
      aggregateArchCoverageRatio: '>= 0.95',
      longestArchCoverageRatio: '>= 0.7',
      maxLongestArchGapDeg: '<= 30',
      nearlyClosedOpenCount: '0',
      langebaanExcessTurnPer100Px: '<= 12',
    },
    findings,
  };
}

function missingArchHouseEdgeBenchmark(
  expectedPathGlob: string,
  findings: TraceBenchmarkFinding[],
): TraceBenchmarkResult {
  findings.push({
    severity: 'low',
    metric: 'fixturePresent',
    actual: 'missing',
    target: expectedPathGlob,
    message: 'Required Arch House/Langebaan source fixture is missing.',
    fixHint: 'Restore the real source image before claiming Edge Detection curve cleanup.',
  });
  return {
    id: 'arch-house-edge-curve-cleanup',
    name: 'Arch House Edge Detection curve cleanup',
    rating: ratingFromFindings(findings),
    metrics: {
      fixturePresent: 0,
      smallClosedPolylineCount: 0,
      pointCount: 0,
      archPolylineCount: 0,
      shortArchPolylineCount: 0,
      aggregateArchCoverageRatio: 0,
      longestArchCoverageRatio: 0,
      maxLongestArchGapDeg: 0,
      nearlyClosedOpenCount: 0,
      maxNearlyClosedGapPx: 0,
      langebaanExcessTurnPer100Px: 0,
    },
    benchmark: {
      fixturePresent: 'present',
      smallClosedPolylineCount: '<= 4',
      archPolylineCount: '<= 18',
      shortArchPolylineCount: '<= 5',
      aggregateArchCoverageRatio: '>= 0.95',
      longestArchCoverageRatio: '>= 0.7',
      maxLongestArchGapDeg: '<= 30',
      nearlyClosedOpenCount: '0',
      langebaanExcessTurnPer100Px: '<= 12',
    },
    findings,
  };
}
