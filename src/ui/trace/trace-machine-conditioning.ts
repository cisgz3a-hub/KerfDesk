// Machine conditioning of a committed trace: CNC fairing (ADR-260) or laser
// move simplification (ADR-391). Both tolerances are physical, so both run at
// commit with the exact placement the store will apply.

import type { TracedImage, Transform } from '../../core/scene';
import { boundsFromColoredPaths, type TraceOptions } from '../../core/trace';
import { runTraceSteps, type TraceSteps } from '../../core/trace/trace-steps';
import { createCooperativeTraceRunner } from './cooperative-trace-runner';
import type { TraceOutput } from './dialog-parts';
import { checkTraceSignal } from './trace-cancellation';
import { fairTracedImageForCnc, shouldFairTracedImageForCnc } from './fair-traced-image-for-cnc';
import { simplifyTracedPathsForLaserSteps } from './laser-trace-moves';

export type TraceMachineRequest = {
  readonly options: TraceOptions;
  readonly traceOutput?: TraceOutput;
};

/** Condition a trace for the machine that will run it. Photo shading and
 *  laser raster-scan output keep the tracer's geometry. */
export function conditionTracedImageForMachine(
  traced: TracedImage,
  placement: Transform,
  machineKind: 'laser' | 'cnc' | undefined,
  request: TraceMachineRequest,
): TracedImage {
  return runTraceSteps(
    conditionTracedImageForMachineSteps(traced, placement, machineKind, request),
  );
}

/** Traced vertices up to which a commit conditions in its own task: a few
 *  milliseconds of work, with nothing to gain from handing the browser turns. */
export const COMMIT_CONDITIONING_SYNC_VERTICES = 2_000;

/** conditionTracedImageForMachine for a commit. A dense trace runs the same
 *  steps in short slices so the app keeps painting and taking input: on a
 *  dense laser trace this is seconds of work, which froze the whole app after
 *  the trace when it ran in one task. An abort of `signal` stops it. */
export async function conditionTracedImageForCommit(
  traced: TracedImage,
  placement: Transform,
  machineKind: 'laser' | 'cnc' | undefined,
  request: TraceMachineRequest,
  signal?: AbortSignal,
): Promise<TracedImage> {
  const steps = conditionTracedImageForMachineSteps(traced, placement, machineKind, request);
  if (tracedVerticesExceed(traced, COMMIT_CONDITIONING_SYNC_VERTICES)) {
    return createCooperativeTraceRunner(() => checkTraceSignal(signal))(steps);
  }
  return runTraceSteps(steps);
}

function tracedVerticesExceed(traced: TracedImage, limit: number): boolean {
  let vertices = 0;
  for (const path of traced.paths) {
    for (const polyline of path.polylines) vertices += polyline.points.length;
    for (const curve of path.curves ?? []) vertices += curve.segments.length + 1;
    if (vertices > limit) return true;
  }
  return false;
}

/** conditionTracedImageForMachine as resumable steps. */
export function* conditionTracedImageForMachineSteps(
  traced: TracedImage,
  placement: Transform,
  machineKind: 'laser' | 'cnc' | undefined,
  request: TraceMachineRequest,
): TraceSteps<TracedImage> {
  if (shouldFairTracedImageForCnc(machineKind, request.options)) {
    return fairTracedImageForCnc(traced, placement);
  }
  if (!shouldSimplifyTracedImageForLaser(machineKind, request)) return traced;
  const paths = yield* simplifyTracedPathsForLaserSteps(traced.paths, placement);
  if (paths.every((path, index) => path === traced.paths[index])) return traced;
  return { ...traced, paths, bounds: boundsFromColoredPaths(paths) };
}

/** Projects saved before CNC support have no machine and run as lasers. Photo
 *  ribbon widths encode tone, and a raster scan burns pixels rather than the
 *  traced moves, so neither is simplified. */
export function shouldSimplifyTracedImageForLaser(
  machineKind: 'laser' | 'cnc' | undefined,
  request: TraceMachineRequest,
): boolean {
  return (
    machineKind !== 'cnc' &&
    request.options.photoDetail === undefined &&
    (request.traceOutput ?? 'vector') === 'vector'
  );
}
