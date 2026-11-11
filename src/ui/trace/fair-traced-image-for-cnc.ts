import type { TracedImage, Transform } from '../../core/scene';
import { boundsFromColoredPaths, type TraceOptions } from '../../core/trace';
import { runTraceSteps, type TraceSteps } from '../../core/trace/trace-steps';
import { fairTracedPathsForCncSteps } from './cnc-trace-fairing';

/** Photo ribbon widths encode tone and must retain the reviewed geometry. */
export function shouldFairTracedImageForCnc(
  machineKind: 'laser' | 'cnc' | undefined,
  options: TraceOptions,
): boolean {
  return machineKind === 'cnc' && options.photoDetail === undefined;
}

/** Keep scene bounds synchronized with conditioned geometry. The complete
 * trace grid and local coordinates remain the source-placement reference. */
export function fairTracedImageForCnc(traced: TracedImage, placement: Transform): TracedImage {
  return runTraceSteps(fairTracedImageForCncSteps(traced, placement));
}

/** fairTracedImageForCnc as resumable steps, so a commit can fair a dense
 *  trace in slices instead of one long UI task. */
export function* fairTracedImageForCncSteps(
  traced: TracedImage,
  placement: Transform,
): TraceSteps<TracedImage> {
  const paths = yield* fairTracedPathsForCncSteps(traced.paths, placement);
  return { ...traced, paths, bounds: boundsFromColoredPaths(paths) };
}
