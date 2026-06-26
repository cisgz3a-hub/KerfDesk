import { TRACE_PRESETS } from '../../core/trace';
import { cannyEdges } from '../../core/trace/canny-edges';
import { traceImageToEdgePaths } from '../../core/trace/edge-trace';
import {
  measureSegmentedStrokeContinuity,
  SEGMENTED_STROKE_CIRCLE_FIXTURE,
} from './edge-curve-truth';
import {
  EDGE_SQUARE_FIXTURE,
  NOISY_PHOTO_EDGE_FIXTURE,
  measureSquareEdgeQuality,
  measureSquarePathEdgeQuality,
} from './edge-truth';
import {
  archHouseEdgeCurveCleanupBenchmark,
  archHouseLineArtBaselineBenchmark,
  centerlineLandedRegressionBenchmark,
} from './trace-benchmark-regression-cases';

export type TraceBenchmarkSeverity = 'high' | 'medium' | 'low';

export type TraceBenchmarkFinding = {
  readonly severity: TraceBenchmarkSeverity;
  readonly metric: string;
  readonly actual: number | string;
  readonly target: string;
  readonly message: string;
  readonly fixHint: string;
};

export type TraceBenchmarkResult = {
  readonly id: string;
  readonly name: string;
  readonly rating: number;
  readonly metrics: Readonly<Record<string, number>>;
  readonly benchmark: Readonly<Record<string, string>>;
  readonly findings: ReadonlyArray<TraceBenchmarkFinding>;
};

export type TraceBenchmarkAuditFinding = TraceBenchmarkFinding & {
  readonly caseId: string;
  readonly caseName: string;
};

export type TraceBenchmarkAudit = {
  readonly passed: boolean;
  readonly rating: number;
  readonly goalRating: number;
  readonly results: ReadonlyArray<TraceBenchmarkResult>;
  readonly findings: ReadonlyArray<TraceBenchmarkAuditFinding>;
  readonly fixPrompt: string | null;
};

export type TraceBenchmarkLoopResult = {
  readonly status: 'passed' | 'needs-fix';
  readonly iterations: ReadonlyArray<TraceBenchmarkAudit>;
  readonly fixPrompt: string | null;
};

export type TraceBenchmarkLoopInput = {
  readonly goalRating: number;
  readonly maxIterations: number;
  readonly runBenchmarks: () => Awaitable<ReadonlyArray<TraceBenchmarkResult>>;
  readonly applyFixPrompt?: (prompt: string, audit: TraceBenchmarkAudit) => Awaitable<void>;
};

type NoisyPhotoControlsQuality = {
  readonly pointCount: number;
  readonly totalPolylineLength: number;
  readonly strayPointCount: number;
  readonly coverageRatio: number;
};

type Awaitable<T> = T | Promise<T>;

const EDGE_OPTIONS = TRACE_PRESETS['Edge Detection']!;

export async function runCurrentTraceBenchmarks(): Promise<TraceBenchmarkResult[]> {
  return [
    edgeSquareCannyBenchmark(),
    edgeNoisyPhotoControlsBenchmark(),
    edgeSegmentedCurveLinkingBenchmark(),
    archHouseEdgeCurveCleanupBenchmark(),
    centerlineLandedRegressionBenchmark(),
    await archHouseLineArtBaselineBenchmark(),
  ];
}

export function auditTraceBenchmarkResults(
  results: ReadonlyArray<TraceBenchmarkResult>,
  options: { readonly goalRating: number },
): TraceBenchmarkAudit {
  const findings = results.flatMap((result) =>
    result.findings.map((finding) => ({
      ...finding,
      caseId: result.id,
      caseName: result.name,
    })),
  );
  const rating =
    results.length === 0
      ? 0
      : Math.min(...results.map((result) => result.rating), capFromFindings(findings));
  const passed = findings.length === 0 && rating >= options.goalRating;
  return {
    passed,
    rating,
    goalRating: options.goalRating,
    results: [...results],
    findings,
    fixPrompt: passed ? null : buildTraceBenchmarkFixPrompt(options.goalRating, rating, findings),
  };
}

export async function runTraceBenchmarkLoop(
  input: TraceBenchmarkLoopInput,
): Promise<TraceBenchmarkLoopResult> {
  const iterations: TraceBenchmarkAudit[] = [];
  const maxIterations = Math.max(1, Math.floor(input.maxIterations));
  for (let index = 0; index < maxIterations; index += 1) {
    const audit = auditTraceBenchmarkResults(await input.runBenchmarks(), {
      goalRating: input.goalRating,
    });
    iterations.push(audit);
    if (audit.passed) return { status: 'passed', iterations, fixPrompt: null };
    if (audit.fixPrompt === null || input.applyFixPrompt === undefined) {
      return { status: 'needs-fix', iterations, fixPrompt: audit.fixPrompt };
    }
    await input.applyFixPrompt(audit.fixPrompt, audit);
  }
  const last = iterations.at(-1);
  return { status: 'needs-fix', iterations, fixPrompt: last?.fixPrompt ?? null };
}

function edgeSquareCannyBenchmark(): TraceBenchmarkResult {
  const quality = measureSquareEdgeQuality(
    cannyEdges(EDGE_SQUARE_FIXTURE.image),
    EDGE_SQUARE_FIXTURE,
  );
  const findings: TraceBenchmarkFinding[] = [];
  pushFindingIf(quality.coverageRatio < 0.8, findings, {
    severity: 'high',
    metric: 'coverageRatio',
    actual: quality.coverageRatio,
    target: '>= 0.8',
    message: 'Canny edge map misses too much of the expected square boundary.',
    fixHint: 'Tune edge thresholds or non-maximum suppression without adding duplicate responses.',
  });
  pushFindingIf(quality.maxParallelResponsesPerExpectedEdge > 1, findings, {
    severity: 'high',
    metric: 'maxParallelResponsesPerExpectedEdge',
    actual: quality.maxParallelResponsesPerExpectedEdge,
    target: '<= 1',
    message: 'Canny edge map emits duplicate parallel responses for one expected edge.',
    fixHint: 'Improve edge thinning/localization before changing vector linking.',
  });
  pushFindingIf(quality.strayEdgePixelCount >= 8, findings, {
    severity: 'medium',
    metric: 'strayEdgePixelCount',
    actual: quality.strayEdgePixelCount,
    target: '< 8',
    message: 'Canny edge map includes too many stray pixels outside the expected boundary.',
    fixHint: 'Adjust hysteresis thresholds or edge cleanup while preserving boundary coverage.',
  });
  return {
    id: 'edge-square-canny-quality',
    name: 'Square Canny edge-map quality',
    rating: ratingFromFindings(findings),
    metrics: {
      coverageRatio: quality.coverageRatio,
      maxParallelResponsesPerExpectedEdge: quality.maxParallelResponsesPerExpectedEdge,
      strayEdgePixelCount: quality.strayEdgePixelCount,
    },
    benchmark: {
      coverageRatio: '>= 0.8',
      maxParallelResponsesPerExpectedEdge: '<= 1',
      strayEdgePixelCount: '< 8',
    },
    findings,
  };
}

function edgeNoisyPhotoControlsBenchmark(): TraceBenchmarkResult {
  const detailedPaths = traceImageToEdgePaths(NOISY_PHOTO_EDGE_FIXTURE.image, {
    ...EDGE_OPTIONS,
    edgeBlurSigma: 0.4,
    edgeLowThresholdRatio: 0.01,
    edgeHighThresholdRatio: 0.03,
    edgeMinLengthPx: 0,
    edgeJoinGapPx: 0,
  });
  const restrainedPaths = traceImageToEdgePaths(NOISY_PHOTO_EDGE_FIXTURE.image, {
    ...EDGE_OPTIONS,
    edgeBlurSigma: 2.5,
    edgeLowThresholdRatio: 0.08,
    edgeHighThresholdRatio: 0.22,
    edgeMinLengthPx: 16,
    edgeJoinGapPx: 1.5,
  });
  const detailed = measureSquarePathEdgeQuality(detailedPaths, NOISY_PHOTO_EDGE_FIXTURE);
  const restrained = measureSquarePathEdgeQuality(restrainedPaths, NOISY_PHOTO_EDGE_FIXTURE);
  return buildNoisyPhotoControlsBenchmark(detailed, restrained);
}

function edgeSegmentedCurveLinkingBenchmark(): TraceBenchmarkResult {
  const paths = traceImageToEdgePaths(SEGMENTED_STROKE_CIRCLE_FIXTURE.image, {
    ...EDGE_OPTIONS,
    edgeBlurSigma: 0.9,
    edgeLowThresholdRatio: 0.04,
    edgeHighThresholdRatio: 0.12,
    edgeMinLengthPx: 10,
    edgeJoinGapPx: 3,
  });
  const polylines = paths.flatMap((path) => path.polylines);
  const quality = measureSegmentedStrokeContinuity(polylines, SEGMENTED_STROKE_CIRCLE_FIXTURE);
  const findings: TraceBenchmarkFinding[] = [];
  pushFindingIf(quality.strokePolylineCount > 4, findings, {
    severity: 'high',
    metric: 'strokePolylineCount',
    actual: quality.strokePolylineCount,
    target: '<= 4',
    message: 'Edge Detection leaves small broken curve gaps as separate stroke fragments.',
    fixHint:
      'Improve bounded curve-gap linking before contour smoothing without broadening independent edges.',
  });
  pushFindingIf(quality.longestStrokeAngularCoverageRatio < 0.9, findings, {
    severity: 'high',
    metric: 'longestStrokeAngularCoverageRatio',
    actual: quality.longestStrokeAngularCoverageRatio,
    target: '>= 0.9',
    message: 'The longest curved stroke contour does not cover enough of the intended arc.',
    fixHint: 'Preserve small curved stroke continuity through the Canny-to-contour bridge.',
  });
  pushFindingIf(quality.maxLongestStrokeAngularGapDeg > 30, findings, {
    severity: 'medium',
    metric: 'maxLongestStrokeAngularGapDeg',
    actual: quality.maxLongestStrokeAngularGapDeg,
    target: '<= 30',
    message: 'The linked curved stroke still has an overly large angular gap.',
    fixHint: 'Tune small-gap linking or post-link cleanup for curved strokes.',
  });
  return {
    id: 'edge-segmented-curve-linking',
    name: 'Segmented curved-stroke Edge Detection linking',
    rating: ratingFromFindings(findings),
    metrics: {
      strokePolylineCount: quality.strokePolylineCount,
      longestStrokeAngularCoverageRatio: quality.longestStrokeAngularCoverageRatio,
      maxLongestStrokeAngularGapDeg: quality.maxLongestStrokeAngularGapDeg,
    },
    benchmark: {
      strokePolylineCount: '<= 4',
      longestStrokeAngularCoverageRatio: '>= 0.9',
      maxLongestStrokeAngularGapDeg: '<= 30',
    },
    findings,
  };
}

export function buildNoisyPhotoControlsBenchmark(
  detailed: NoisyPhotoControlsQuality,
  restrained: NoisyPhotoControlsQuality,
): TraceBenchmarkResult {
  const strayTarget = Math.floor(detailed.strayPointCount * 0.5);
  const findings: TraceBenchmarkFinding[] = [];
  pushFindingIf(restrained.totalPolylineLength >= detailed.totalPolylineLength, findings, {
    severity: 'medium',
    metric: 'restrainedTotalPolylineLength',
    actual: restrained.totalPolylineLength,
    target: `< detailed ${detailed.totalPolylineLength}`,
    message: 'Restrained Edge Detection does not reduce total vector complexity.',
    fixHint:
      'Make Detail, Sensitivity, and Minimum line affect the traced paths before linker work.',
  });
  pushFindingIf(restrained.strayPointCount > strayTarget, findings, {
    severity: 'high',
    metric: 'strayPointCount',
    actual: restrained.strayPointCount,
    target: `<= ${strayTarget}`,
    message: 'Restrained Edge Detection still emits too many texture/noise vector points.',
    fixHint:
      'Tune edge-specific linking, minimum line filtering, or texture suppression before changing UI labels.',
  });
  pushFindingIf(restrained.coverageRatio <= 0.75, findings, {
    severity: 'high',
    metric: 'coverageRatio',
    actual: restrained.coverageRatio,
    target: '> 0.75',
    message: 'Restrained Edge Detection loses too much of the intended square boundary.',
    fixHint:
      'Increase boundary-preserving linking or lower thresholds only enough to recover the main edge.',
  });
  return {
    id: 'edge-noisy-photo-controls',
    name: 'Noisy photo-like Edge Detection controls',
    rating: ratingFromFindings(findings),
    metrics: {
      detailedPointCount: detailed.pointCount,
      restrainedPointCount: restrained.pointCount,
      detailedTotalPolylineLength: detailed.totalPolylineLength,
      restrainedTotalPolylineLength: restrained.totalPolylineLength,
      detailedStrayPointCount: detailed.strayPointCount,
      strayPointCount: restrained.strayPointCount,
      coverageRatio: restrained.coverageRatio,
    },
    benchmark: {
      restrainedTotalPolylineLength: `< detailed ${detailed.totalPolylineLength}`,
      strayPointCount: `<= ${strayTarget}`,
      coverageRatio: '> 0.75',
    },
    findings,
  };
}

function buildTraceBenchmarkFixPrompt(
  goalRating: number,
  actualRating: number,
  findings: ReadonlyArray<TraceBenchmarkAuditFinding>,
): string {
  const lines = [
    `Fix the trace benchmark failures until the audit reaches ${goalRating}/10.`,
    `Current trace benchmark rating: ${actualRating}/10.`,
    '',
    'Accepted findings:',
    ...findings.map(
      (finding) =>
        `- [${finding.severity}] ${finding.caseId} / ${finding.metric}: ${finding.message} ` +
        `(actual ${finding.actual}, target ${finding.target}). Fix: ${finding.fixHint}`,
    ),
    '',
    'Loop instruction: write or update the failing proof first, implement the smallest trace change, rerun the benchmark audit, and repeat until no findings remain.',
  ];
  return `${lines.join('\n')}\n`;
}

function pushFindingIf(
  condition: boolean,
  findings: TraceBenchmarkFinding[],
  finding: TraceBenchmarkFinding,
): void {
  if (condition) findings.push(finding);
}

function ratingFromFindings(findings: ReadonlyArray<TraceBenchmarkFinding>): number {
  return capFromFindings(findings);
}

function capFromFindings(
  findings: ReadonlyArray<{ readonly severity: TraceBenchmarkSeverity }>,
): number {
  if (findings.some((finding) => finding.severity === 'high')) return 6;
  if (findings.some((finding) => finding.severity === 'medium')) return 8;
  if (findings.some((finding) => finding.severity === 'low')) return 9;
  return 10;
}
