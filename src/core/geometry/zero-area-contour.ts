// A closed contour that encloses no area (ADR-486 Amendment 4, tools audit T1
// T30-P1-2 / T30R-P2-1).
//
// A line drawn twice, or a path that runs out and back over itself, closes into
// a loop with nothing inside it. Kerf Offset reads closed contours by the
// even-odd rule before it offsets them (kerf-offset.ts), and that reading has
// no region for such a loop, so the cut vanished from the G-code while the
// canvas still showed the line. Join paths, DXF import and Close Path use this
// to leave such a path open, and the kerf stage uses it to say what it dropped.
//
// The test is the kerf's own: the even-odd normalisation on its 1 µm grid
// returns nothing for the contour. Most contours are ruled out first by their
// shoelace area, so the boolean engine only runs on slivers and on loops whose
// lobes cancel (a figure eight, which does enclose area and stays closed).

import {
  applyTransform,
  flattenCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Transform,
  type Vec2,
} from '../scene';
import { normalizeClosedPolylinesEvenOddChecked } from './polygon-difference';

// A contour whose shoelace area exceeds its perimeter times this half-width is
// wider than the kerf engine's 1 µm grid somewhere, so it encloses area.
const SUSPECT_HALF_WIDTH_MM = 0.001;
// Curves are flattened finely, so a curve and its exact reverse land on the
// same points and an arc between collinear anchors keeps its bulge.
const FLATTEN_TOLERANCE_MM = 0.001;
const FLATTEN_BUDGET = 20_000;

/** Whether `curve` (world millimetres), closed, encloses no area. */
export function curveEnclosesNoArea(curve: CurveSubpath): boolean {
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: FLATTEN_TOLERANCE_MM,
    segmentBudget: FLATTEN_BUDGET,
  });
  return flattened.kind === 'ok' && closedContourEnclosesNoArea(flattened.polyline.points);
}

/**
 * Whether subpath `index` of `path`, closed and placed by `transform`, encloses
 * no area. Reads the exact curve when the path has one, in world millimetres:
 * a compatibility polyline holds only anchors, and a tiny local shape can be
 * large once scaled.
 */
export function subpathEnclosesNoArea(
  path: ColoredPath,
  index: number,
  transform: Transform,
): boolean {
  const curve = path.curves?.[index];
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  if (!(scale > 0) || !Number.isFinite(scale)) return false;
  let local = path.polylines[index]?.points;
  if (curve !== undefined) {
    const flattened = flattenCurveSubpath(curve, {
      toleranceMm: FLATTEN_TOLERANCE_MM / scale,
      segmentBudget: FLATTEN_BUDGET,
    });
    local = flattened.kind === 'ok' ? flattened.polyline.points : undefined;
  }
  if (local === undefined) return false;
  return closedContourEnclosesNoArea(local.map((point) => applyTransform(point, transform)));
}

/** Whether `points`, read as a closed ring, encloses no area under the even-odd rule. */
export function closedContourEnclosesNoArea(points: ReadonlyArray<Vec2>): boolean {
  if (points.length < 3) return true;
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index] as Vec2;
    const b = points[(index + 1) % points.length] as Vec2;
    twiceArea += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (!Number.isFinite(twiceArea) || !Number.isFinite(perimeter)) return false;
  if (Math.abs(twiceArea) / 2 > perimeter * SUSPECT_HALF_WIDTH_MM) return false;
  const normalized = normalizeClosedPolylinesEvenOddChecked([{ points, closed: true }]);
  // An engine failure is not evidence of an empty contour.
  return normalized.kind === 'ok' && normalized.value.length === 0;
}
