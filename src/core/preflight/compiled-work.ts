import { cncPassXyPoints, type Job, type RasterGroup } from '../job';
import { rasterRow } from '../job/raster-rows';
import type { PreflightIssue, PreflightResult } from './preflight';

export const MAX_COMPILED_MOTION_SEGMENTS = 250_000;
export const MAX_ESTIMATED_OUTPUT_BYTES = 96 * 1024 * 1024;

const ESTIMATED_VECTOR_LINE_BYTES = 48;
const ESTIMATED_RASTER_RUN_BYTES = 48;
const ESTIMATED_RASTER_SPAN_BYTES = 128;
const ESTIMATED_RASTER_ROW_BYTES = 64;
const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

export type CompiledWork = {
  readonly motionSegments: number;
  readonly estimatedOutputBytes: number;
};

type CompiledWorkLimits = {
  readonly motionSegments: number;
  readonly estimatedOutputBytes: number;
};

type CompiledWorkMeasurement = CompiledWork & { readonly isComplete: boolean };

export function measureCompiledWork(job: Job): CompiledWork {
  const { motionSegments, estimatedOutputBytes } = measureCompiledWorkUntilLimit(job);
  return { motionSegments, estimatedOutputBytes };
}

function measureCompiledWorkUntilLimit(
  job: Job,
  limits?: CompiledWorkLimits,
): CompiledWorkMeasurement {
  let motionSegments = 0;
  let estimatedOutputBytes = 0;
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      const raster = measureRasterWork(
        group,
        limits === undefined
          ? undefined
          : {
              motionSegments: limits.motionSegments - motionSegments,
              estimatedOutputBytes: limits.estimatedOutputBytes - estimatedOutputBytes,
            },
      );
      motionSegments += raster.motionSegments;
      estimatedOutputBytes += raster.estimatedOutputBytes;
      if (!raster.isComplete) return { motionSegments, estimatedOutputBytes, isComplete: false };
    } else {
      const groupSegments =
        group.kind === 'cnc'
          ? group.passes.reduce(
              (sum, pass) => sum + Math.max(1, cncPassXyPoints(pass).length - 1),
              0,
            )
          : group.segments.reduce(
              (sum, segment) => sum + Math.max(0, segment.polyline.length - 1),
              0,
            ) * Math.max(1, Math.floor(group.passes));
      motionSegments += groupSegments;
      estimatedOutputBytes += groupSegments * ESTIMATED_VECTOR_LINE_BYTES;
    }
    if (exceedsLimits({ motionSegments, estimatedOutputBytes }, limits)) {
      return { motionSegments, estimatedOutputBytes, isComplete: false };
    }
  }
  return { motionSegments, estimatedOutputBytes, isComplete: true };
}

export function runCompiledWorkPreflight(job: Job): PreflightResult {
  const work = measureCompiledWorkUntilLimit(job, {
    motionSegments: MAX_COMPILED_MOTION_SEGMENTS,
    estimatedOutputBytes: MAX_ESTIMATED_OUTPUT_BYTES,
  });
  const issues: PreflightIssue[] = [];
  if (work.motionSegments > MAX_COMPILED_MOTION_SEGMENTS) {
    issues.push({
      code: 'compiled-output-budget-exceeded',
      message: `Compiled job contains ${work.isComplete ? '' : 'at least '}${work.motionSegments.toLocaleString()} motion segments; the safe preparation limit is ${MAX_COMPILED_MOTION_SEGMENTS.toLocaleString()}. Simplify or split the job.`,
    });
  }
  if (work.estimatedOutputBytes > MAX_ESTIMATED_OUTPUT_BYTES) {
    issues.push({
      code: 'compiled-output-budget-exceeded',
      message: `Compiled job would emit ${work.isComplete ? 'approximately' : 'at least'} ${formatMegabytes(work.estimatedOutputBytes)} MB; the safe in-memory output limit is ${formatMegabytes(MAX_ESTIMATED_OUTPUT_BYTES)} MB. Reduce raster detail or split the job.`,
    });
  }
  return { ok: issues.length === 0, issues };
}

function measureRasterWork(
  group: RasterGroup,
  limits?: CompiledWorkLimits,
): CompiledWorkMeasurement {
  let runs = 0;
  let spans = 0;
  let activeRows = 0;
  const passes = Math.max(1, Math.floor(group.passes));
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const measured = measureRasterRow(rasterRow(group, y), pixelWidthMm);
    if (measured.runs === 0) continue;
    activeRows += 1;
    runs += measured.runs;
    spans += measured.spans;
    const work = rasterWorkFromCounts(runs, spans, activeRows, passes);
    if (exceedsLimits(work, limits)) return { ...work, isComplete: false };
  }
  return { ...rasterWorkFromCounts(runs, spans, activeRows, passes), isComplete: true };
}

function rasterWorkFromCounts(
  runs: number,
  spans: number,
  activeRows: number,
  passes: number,
): CompiledWork {
  const motionSegments = (runs + spans * 2 + activeRows) * passes;
  return {
    motionSegments,
    estimatedOutputBytes:
      (runs * ESTIMATED_RASTER_RUN_BYTES +
        spans * ESTIMATED_RASTER_SPAN_BYTES +
        activeRows * ESTIMATED_RASTER_ROW_BYTES) *
      passes,
  };
}

function exceedsLimits(work: CompiledWork, limits: CompiledWorkLimits | undefined): boolean {
  return (
    limits !== undefined &&
    (work.motionSegments > limits.motionSegments ||
      work.estimatedOutputBytes > limits.estimatedOutputBytes)
  );
}

function measureRasterRow(
  row: Uint16Array,
  pixelWidthMm: number,
): { readonly runs: number; readonly spans: number } {
  let firstActive = -1;
  let lastActive = -1;
  let lastInk = -1;
  let spans = 0;
  for (let x = 0; x < row.length; x += 1) {
    if ((row[x] ?? 0) <= 0) continue;
    if (firstActive === -1) {
      firstActive = x;
      spans = 1;
    } else if ((x - lastInk - 1) * pixelWidthMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans += 1;
    }
    lastActive = x;
    lastInk = x;
  }
  if (firstActive === -1) return { runs: 0, spans: 0 };
  let runs = 1;
  let previous = row[firstActive] ?? 0;
  for (let x = firstActive + 1; x <= lastActive; x += 1) {
    const value = row[x] ?? 0;
    if (value !== previous) runs += 1;
    previous = value;
  }
  return { runs, spans };
}

function formatMegabytes(bytes: number): string {
  return Math.ceil(bytes / (1024 * 1024)).toLocaleString();
}
