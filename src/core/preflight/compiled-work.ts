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

export function measureCompiledWork(job: Job): CompiledWork {
  let motionSegments = 0;
  let estimatedOutputBytes = 0;
  for (const group of job.groups) {
    if (group.kind === 'raster') {
      const raster = measureRasterWork(group);
      motionSegments += raster.motionSegments;
      estimatedOutputBytes += raster.estimatedOutputBytes;
      continue;
    }
    const groupSegments =
      group.kind === 'cnc'
        ? group.passes.reduce((sum, pass) => sum + Math.max(1, cncPassXyPoints(pass).length - 1), 0)
        : group.segments.reduce(
            (sum, segment) => sum + Math.max(0, segment.polyline.length - 1),
            0,
          ) * Math.max(1, Math.floor(group.passes));
    motionSegments += groupSegments;
    estimatedOutputBytes += groupSegments * ESTIMATED_VECTOR_LINE_BYTES;
  }
  return { motionSegments, estimatedOutputBytes };
}

export function runCompiledWorkPreflight(job: Job): PreflightResult {
  const work = measureCompiledWork(job);
  const issues: PreflightIssue[] = [];
  if (work.motionSegments > MAX_COMPILED_MOTION_SEGMENTS) {
    issues.push({
      code: 'compiled-output-budget-exceeded',
      message: `Compiled job contains ${work.motionSegments.toLocaleString()} motion segments; the safe preparation limit is ${MAX_COMPILED_MOTION_SEGMENTS.toLocaleString()}. Simplify or split the job.`,
    });
  }
  if (work.estimatedOutputBytes > MAX_ESTIMATED_OUTPUT_BYTES) {
    issues.push({
      code: 'compiled-output-budget-exceeded',
      message: `Compiled job would emit approximately ${formatMegabytes(work.estimatedOutputBytes)} MB; the safe in-memory output limit is ${formatMegabytes(MAX_ESTIMATED_OUTPUT_BYTES)} MB. Reduce raster detail or split the job.`,
    });
  }
  return { ok: issues.length === 0, issues };
}

function measureRasterWork(group: RasterGroup): CompiledWork {
  let runs = 0;
  let spans = 0;
  let activeRows = 0;
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const measured = measureRasterRow(rasterRow(group, y), pixelWidthMm);
    if (measured.runs === 0) continue;
    activeRows += 1;
    runs += measured.runs;
    spans += measured.spans;
  }
  const passes = Math.max(1, Math.floor(group.passes));
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
