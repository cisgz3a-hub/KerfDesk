// Line + fill path roles (ADR-443). Kept apart from the tracer so the
// preview, the commit and the scene can tell strokes from outlines without
// loading the tracing lanes.

import type { ColoredPath } from '../../scene';

/** Source colour of the Line + fill strokes (bound to a LINE operation). */
export const HYBRID_STROKE_COLOR = '#0000ff';
/** Source colour of the Line + fill outlines (bound to a FILL operation). */
export const HYBRID_FILL_COLOR = '#000000';

/** Whether a Line + fill path is a stroke (drawn as a hairline, bound to a
 *  line operation) rather than a filled outline. */
export function isHybridStrokePath(path: Pick<ColoredPath, 'color'>): boolean {
  return path.color.toLowerCase() === HYBRID_STROKE_COLOR;
}
