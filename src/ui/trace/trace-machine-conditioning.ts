// Machine conditioning of a committed trace: CNC fairing (ADR-260) or laser
// move simplification (ADR-391). Both tolerances are physical, so both run at
// commit with the exact placement the store will apply.

import type { TracedImage, Transform } from '../../core/scene';
import { boundsFromColoredPaths, type TraceOptions } from '../../core/trace';
import type { TraceOutput } from './dialog-parts';
import { fairTracedImageForCnc, shouldFairTracedImageForCnc } from './fair-traced-image-for-cnc';
import { simplifyTracedPathsForLaser } from './laser-trace-moves';

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
  if (shouldFairTracedImageForCnc(machineKind, request.options)) {
    return fairTracedImageForCnc(traced, placement);
  }
  if (!shouldSimplifyTracedImageForLaser(machineKind, request)) return traced;
  const paths = simplifyTracedPathsForLaser(traced.paths, placement);
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
