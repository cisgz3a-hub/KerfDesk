import type { TracedImage, Transform } from '../../core/scene';
import { boundsFromColoredPaths } from '../../core/trace';
import { fairTracedPathsForCnc } from './cnc-trace-fairing';

/** Keep scene bounds synchronized with conditioned geometry. The complete
 * trace grid and local coordinates remain the source-placement reference. */
export function fairTracedImageForCnc(traced: TracedImage, placement: Transform): TracedImage {
  const paths = fairTracedPathsForCnc(traced.paths, placement);
  return { ...traced, paths, bounds: boundsFromColoredPaths(paths) };
}
