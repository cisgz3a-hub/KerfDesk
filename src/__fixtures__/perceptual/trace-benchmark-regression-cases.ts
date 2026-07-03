import {
  TRACE_PRESETS,
  traceCenterlineStrokePaths,
  traceImageToColoredPaths,
} from '../../core/trace';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import { measureTopArchContinuity } from './arch-house-edge-truth';
import { measureCenterlineDeviation } from './centerline-deviation';
import { CENTERLINE_TRUTH_FIXTURES } from './centerline-truth';
import { decodePngFile } from './png-decode';
import { rasterizeColoredPaths, type Mask } from './rasterize';
import { buildTraceArtifact, requiredArchHouseFixtureStatus } from './trace-artifact-runner';
import type { TraceBenchmarkFinding, TraceBenchmarkResult } from './trace-benchmark-loop';

type CenterlineRegressionLimit = {
  readonly maxDeviationPx: number;
  readonly maxGapPx: number;
  readonly maxFragmentCount: number;
};

const CENTERLINE_OPTIONS = TRACE_PRESETS['Centerline']!;
const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;
const LINE_ART_OPTIONS = TRACE_PRESETS['Line Art']!;
const LANGEBAAN_BAND = { x0: 300, y0: 660, x1: 735, y1: 725 };

const STRICT_CENTERLINE_LIMIT: CenterlineRegressionLimit = {
  maxDeviationPx: 1,
  maxGapPx: 2,
  maxFragmentCount: 1,
};

const CENTERLINE_REGRESSION_LIMITS: Readonly<Record<string, CenterlineRegressionLimit>> = {
  'h-stroke': STRICT_CENTERLINE_LIMIT,
  'diagonal-stroke': STRICT_CENTERLINE_LIMIT,
  cross: {
    maxDeviationPx: 1,
    maxGapPx: 2,
    maxFragmentCount: 2,
  },
  'l-corner': {
    maxDeviationPx: 1.6,
    maxGapPx: 2,
    maxFragmentCount: 1,
  },
  arc: {
    maxDeviationPx: 1,
    maxGapPx: 3.5,
    maxFragmentCount: 4,
  },
};

export function centerlineLandedRegressionBenchmark(): TraceBenchmarkResult {
  const findings: TraceBenchmarkFinding[] = [];
  let maxDeviationPx = 0;
  let maxGapPx = 0;
  let maxFragmentCount = 0;
  let shortFragmentCount = 0;
  let fragmentOverLimitCount = 0;
  for (const fixture of CENTERLINE_TRUTH_FIXTURES) {
    const traced = traceCenterlineStrokePaths(fixture.image, CENTERLINE_OPTIONS);
    const metric = measureCenterlineDeviation(traced, fixture);
    const limit = CENTERLINE_REGRESSION_LIMITS[fixture.name] ?? STRICT_CENTERLINE_LIMIT;
    maxDeviationPx = Math.max(maxDeviationPx, metric.maxDeviationPx);
    maxGapPx = Math.max(maxGapPx, metric.maxGapPx);
    maxFragmentCount = Math.max(maxFragmentCount, metric.fragmentCount);
    shortFragmentCount += metric.shortFragmentCount;
    if (metric.fragmentCount > limit.maxFragmentCount) fragmentOverLimitCount += 1;
    pushFindingIf(metric.maxDeviationPx > limit.maxDeviationPx, findings, {
      severity: 'high',
      metric: `${fixture.name}.maxDeviationPx`,
      actual: metric.maxDeviationPx,
      target: `<= ${limit.maxDeviationPx}`,
      message: 'Centerline trace drifted outside its landed deviation limit.',
      fixHint: 'Repair centerline thinning, branch chaining, or fitting without loosening limits.',
    });
    pushFindingIf(metric.maxGapPx > limit.maxGapPx, findings, {
      severity: 'high',
      metric: `${fixture.name}.maxGapPx`,
      actual: metric.maxGapPx,
      target: `<= ${limit.maxGapPx}`,
      message: 'Centerline trace left a larger gap than the landed regression limit.',
      fixHint: 'Repair centerline continuity or gap handling before changing UI labels.',
    });
    pushFindingIf(metric.shortFragmentCount > 0, findings, {
      severity: 'medium',
      metric: `${fixture.name}.shortFragmentCount`,
      actual: metric.shortFragmentCount,
      target: '0',
      message: 'Centerline trace emitted short spur-like fragments.',
      fixHint: 'Tighten distance-aware branch pruning while preserving real strokes.',
    });
    pushFindingIf(metric.fragmentCount > limit.maxFragmentCount, findings, {
      severity: 'medium',
      metric: `${fixture.name}.fragmentCount`,
      actual: metric.fragmentCount,
      target: `<= ${limit.maxFragmentCount}`,
      message: 'Centerline trace fragmented a known truth fixture.',
      fixHint: 'Repair junction chaining or conservative gap joining for this fixture.',
    });
  }
  return {
    id: 'centerline-landed-regression',
    name: 'Centerline landed regression bar',
    rating: ratingFromFindings(findings),
    metrics: {
      maxDeviationPx,
      maxGapPx,
      maxFragmentCount,
      shortFragmentCount,
      fragmentOverLimitCount,
    },
    benchmark: {
      maxDeviationPx: '<= fixture limit',
      maxGapPx: '<= fixture limit',
      shortFragmentCount: '0',
      fragmentOverLimitCount: '0',
    },
    findings,
  };
}

export async function archHouseLineArtBaselineBenchmark(): Promise<TraceBenchmarkResult> {
  const fixture = requiredArchHouseFixtureStatus();
  const findings: TraceBenchmarkFinding[] = [];
  if (fixture.path === null) return missingArchHouseBenchmark(fixture.expectedPathGlob, findings);

  const image = decodePngFile(fixture.path);
  const paths = await traceImageToColoredPaths(image, LINE_ART_OPTIONS);
  const artifact = buildTraceArtifact({
    name: 'arch-house-langebaan-line-art',
    mode: 'filled-contours',
    source: { width: image.width, height: image.height },
    paths,
  });
  const bottomWordInk = countInk(
    rasterizeColoredPaths(paths, image.width, image.height),
    LANGEBAAN_BAND,
  );
  pushFindingIf(artifact.metrics.openPolylineCount !== 0, findings, {
    severity: 'high',
    metric: 'openPolylineCount',
    actual: artifact.metrics.openPolylineCount,
    target: '0',
    message: 'Arch House Line Art emitted open paths instead of filled logo contours.',
    fixHint: 'Keep Line Art routed to filled-contour tracing, not Centerline or Edge Detection.',
  });
  pushFindingIf(artifact.metrics.closedPolylineCount < 10, findings, {
    severity: 'high',
    metric: 'closedPolylineCount',
    actual: artifact.metrics.closedPolylineCount,
    target: '>= 10',
    message: 'Arch House Line Art lost too many filled logo contours.',
    fixHint:
      'Restore the filled-contour backend and preserve holes before adjusting simplification.',
  });
  pushFindingIf(artifact.metrics.holeCandidateCount < 5, findings, {
    severity: 'medium',
    metric: 'holeCandidateCount',
    actual: artifact.metrics.holeCandidateCount,
    target: '>= 5',
    message: 'Arch House Line Art is not preserving enough interior holes.',
    fixHint: 'Fix contour hierarchy or even-odd filled output before touching trace presets.',
  });
  pushFindingIf(artifact.metrics.smallClosedPolylineCount > 250, findings, {
    severity: 'medium',
    metric: 'smallClosedPolylineCount',
    actual: artifact.metrics.smallClosedPolylineCount,
    target: '<= 250',
    message: 'Arch House Line Art emitted too many tiny closed specks.',
    fixHint: 'Tune despeckle/turd filtering without dropping small text.',
  });
  pushFindingIf(
    artifact.metrics.pointCount <= 500 || artifact.metrics.pointCount >= 80_000,
    findings,
    {
      severity: 'medium',
      metric: 'pointCount',
      actual: artifact.metrics.pointCount,
      target: '> 500 and < 80000',
      message: 'Arch House Line Art point count left the accepted quality/performance band.',
      fixHint: 'Balance simplification and detail retention against the real logo fixture.',
    },
  );
  pushFindingIf(bottomWordInk < 3000, findings, {
    severity: 'high',
    metric: 'bottomWordInk',
    actual: bottomWordInk,
    target: '>= 3000',
    message: 'Arch House Line Art dropped too much of the LANGEBAAN bottom text.',
    fixHint: 'Preserve pale/small logo details without forcing users into Sketch Trace.',
  });
  return {
    id: 'arch-house-line-art-baseline',
    name: 'Arch House/Langebaan Line Art baseline',
    rating: ratingFromFindings(findings),
    metrics: {
      fixturePresent: 1,
      bottomWordInk,
      openPolylineCount: artifact.metrics.openPolylineCount,
      closedPolylineCount: artifact.metrics.closedPolylineCount,
      holeCandidateCount: artifact.metrics.holeCandidateCount,
      smallClosedPolylineCount: artifact.metrics.smallClosedPolylineCount,
      pointCount: artifact.metrics.pointCount,
    },
    benchmark: {
      fixturePresent: 'present',
      bottomWordInk: '>= 3000',
      openPolylineCount: '0',
      closedPolylineCount: '>= 10',
      holeCandidateCount: '>= 5',
      smallClosedPolylineCount: '<= 250',
      pointCount: '> 500 and < 80000',
    },
    findings,
  };
}

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
  const archQuality = measureTopArchContinuity(paths.flatMap((path) => path.polylines));
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
    },
    benchmark: {
      fixturePresent: 'present',
      smallClosedPolylineCount: '<= 4',
      archPolylineCount: '<= 18',
      shortArchPolylineCount: '<= 5',
      aggregateArchCoverageRatio: '>= 0.95',
      longestArchCoverageRatio: '>= 0.7',
      maxLongestArchGapDeg: '<= 30',
    },
    findings,
  };
}

function missingArchHouseBenchmark(
  expectedPathGlob: string,
  findings: TraceBenchmarkFinding[],
): TraceBenchmarkResult {
  findings.push({
    severity: 'low',
    metric: 'fixturePresent',
    actual: 'missing',
    target: expectedPathGlob,
    message: 'Required Arch House/Langebaan source fixture is missing.',
    fixHint: 'Restore the real source image before claiming a 10/10 trace-quality loop.',
  });
  return {
    id: 'arch-house-line-art-baseline',
    name: 'Arch House/Langebaan Line Art baseline',
    rating: ratingFromFindings(findings),
    metrics: {
      fixturePresent: 0,
      bottomWordInk: 0,
      openPolylineCount: 0,
      closedPolylineCount: 0,
      holeCandidateCount: 0,
      smallClosedPolylineCount: 0,
      pointCount: 0,
    },
    benchmark: {
      fixturePresent: 'present',
      bottomWordInk: '>= 3000',
      openPolylineCount: '0',
      pointCount: '> 500 and < 80000',
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
    },
    benchmark: {
      fixturePresent: 'present',
      smallClosedPolylineCount: '<= 4',
      archPolylineCount: '<= 18',
      shortArchPolylineCount: '<= 5',
      aggregateArchCoverageRatio: '>= 0.95',
      longestArchCoverageRatio: '>= 0.7',
      maxLongestArchGapDeg: '<= 30',
    },
    findings,
  };
}

function pushFindingIf(
  condition: boolean,
  findings: TraceBenchmarkFinding[],
  finding: TraceBenchmarkFinding,
): void {
  if (condition) findings.push(finding);
}

function countInk(
  mask: Mask,
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): number {
  let count = 0;
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      count += mask.data[y * mask.width + x] ?? 0;
    }
  }
  return count;
}

function ratingFromFindings(findings: ReadonlyArray<TraceBenchmarkFinding>): number {
  if (findings.some((finding) => finding.severity === 'high')) return 6;
  if (findings.some((finding) => finding.severity === 'medium')) return 8;
  if (findings.some((finding) => finding.severity === 'low')) return 9;
  return 10;
}
