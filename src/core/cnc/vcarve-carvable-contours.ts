// Which contours the V-carve ladder can actually carve.
//
// V-carving is an inward-offset ladder over CLOSED regions (vcarve-ladder.ts):
// an open stroke encloses no area, so it produces no rings, no passes, no CNC
// group, and therefore an emitted program with no motion at all. Single-line
// fonts, traced centerlines and unclosed imports are open by nature and hit
// this every time.
//
// The rule lives here rather than inside the ladder so the design-time note in
// the layers panel and the compiler cannot drift apart.

import type { Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';

const MIN_CLOSED_POINTS = 3;

/** One contour the ladder can offset inward. */
export function isVCarvableContour(polyline: Polyline): boolean {
  return (
    polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline)
  );
}

/** True when at least one contour survives — i.e. the layer will carve
 * something. False with a non-empty input means the layer emits nothing. */
export function hasVCarvableContour(polylines: ReadonlyArray<Polyline>): boolean {
  return polylines.some(isVCarvableContour);
}
