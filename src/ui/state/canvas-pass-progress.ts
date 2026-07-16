// canvas-pass-progress — projects the ADR-215 CNC pass-span sidecar onto the
// canvas motion route so a live run can say which depth pass the controller is
// cutting and how many are still ahead (ADR-216).
//
// The mapping is derived, never trusted blindly: the sidecar re-emission must
// reproduce the started program byte-for-byte, and the mapped route ranges
// must ascend like the spans they came from. Any disagreement drops the pass
// display entirely — a missing counter is honest, a wrong one is not.

import type { DeviceProfile } from '../../core/devices';
import type { Job } from '../../core/job';
import type { MotionBlock, MotionManifest } from '../../core/job/motion-manifest';
import { emitCncJobWithPassSpans, type CncPassSpan } from '../../core/output';

export type CncPassRouteSpan = {
  /** Index into Job.groups, as recorded by the emission sidecar. */
  readonly groupIndex: number;
  /** Index into that group's passes. */
  readonly passIndex: number;
  /** Route distance where this pass's first manifest block begins. */
  readonly routeStartMm: number;
  /** Route distance where this pass's last manifest block ends. */
  readonly routeEndMm: number;
};

export type CncPassPosition = {
  /** 1-based job-wide ordinal of the pass the confirmed route sits in. The
   * preview's pass stepper counts the same way (WORKFLOW F-CNC4). */
  readonly current: number;
  readonly total: number;
  /** Passes that have not started yet — excludes the one in progress. */
  readonly remaining: number;
};

/**
 * Maps each emitted CNC pass onto the motion-route distances the live canvas
 * trail speaks. Returns undefined when the started program is not the plain
 * strategy emission of this job (headers, resume rewrites) or when the spans
 * and manifest disagree — callers must then omit the pass display.
 */
export function cncPassRouteSpans(
  job: Job,
  device: DeviceProfile,
  startedGcode: string,
  manifest: MotionManifest,
): ReadonlyArray<CncPassRouteSpan> | undefined {
  const emission = emitCncJobWithPassSpans(job, device);
  if (emission.gcode !== startedGcode) return undefined;
  if (!spansAscend(emission.spans)) return undefined;
  const mapped = mapSpansToRoute(emission.spans, manifest.blocks);
  if (mapped.length === 0) return undefined;
  return routeRangesAscend(mapped) ? mapped : undefined;
}

/** Where the confirmed route distance sits among the job's passes. */
export function cncPassPosition(
  spans: ReadonlyArray<CncPassRouteSpan>,
  confirmedRouteMm: number,
): CncPassPosition | null {
  const total = spans.length;
  if (total === 0) return null;
  const index = spans.findIndex((span) => confirmedRouteMm < span.routeEndMm);
  const current = index < 0 ? total : index + 1;
  return { current, total, remaining: total - current };
}

// Both lists ascend (spans by raw line, blocks by emission order), so one
// forward walk maps every span without rescanning the manifest.
function mapSpansToRoute(
  spans: ReadonlyArray<CncPassSpan>,
  blocks: ReadonlyArray<MotionBlock>,
): ReadonlyArray<CncPassRouteSpan> {
  const mapped: CncPassRouteSpan[] = [];
  let blockIndex = 0;
  for (const span of spans) {
    while (blockIndex < blocks.length && rawLineOf(blocks[blockIndex]) < span.firstRawLine) {
      blockIndex += 1;
    }
    let routeStartMm = Number.POSITIVE_INFINITY;
    let routeEndMm = Number.NEGATIVE_INFINITY;
    while (blockIndex < blocks.length && rawLineOf(blocks[blockIndex]) <= span.lastRawLine) {
      const block = blocks[blockIndex];
      if (block !== undefined) {
        routeStartMm = Math.min(routeStartMm, block.routeStartMm);
        routeEndMm = Math.max(routeEndMm, block.routeEndMm);
      }
      blockIndex += 1;
    }
    if (Number.isFinite(routeStartMm) && Number.isFinite(routeEndMm)) {
      mapped.push({
        groupIndex: span.groupIndex,
        passIndex: span.passIndex,
        routeStartMm,
        routeEndMm,
      });
    }
  }
  return mapped;
}

// Manifest raw lines are 0-based; spans speak the 1-based raw numbering of
// Start-from-line and the recovery core (cnc-pass-spans.ts).
function rawLineOf(block: MotionBlock | undefined): number {
  return block === undefined ? Number.POSITIVE_INFINITY : block.rawLineIndex + 1;
}

function spansAscend(spans: ReadonlyArray<CncPassSpan>): boolean {
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const next = spans[index];
    if (previous === undefined || next === undefined) return false;
    if (next.firstRawLine <= previous.lastRawLine) return false;
  }
  return true;
}

function routeRangesAscend(spans: ReadonlyArray<CncPassRouteSpan>): boolean {
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const next = spans[index];
    if (previous === undefined || next === undefined) return false;
    if (next.routeStartMm < previous.routeEndMm) return false;
  }
  return true;
}
