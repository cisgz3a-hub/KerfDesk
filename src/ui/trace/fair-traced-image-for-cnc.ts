import type { TracedImage, Transform } from '../../core/scene';
import { boundsFromColoredPaths, type TraceOptions } from '../../core/trace';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

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
  const paths = fairTracedPathsForCnc(traced.paths, placement);
  return { ...traced, paths, bounds: boundsFromColoredPaths(paths) };
}
