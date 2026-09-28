// Applies a Trim Shapes stretch (LightBurn gap LBG-T04) to the object's own
// paths, in its local coordinates, so its placement and every exact curve it
// keeps stay as they were. The ends of the kept pieces are moved from the chord
// crossing onto the exact curve where it meets the other outline's chord.
// An open contour keeps up to two open pieces; a closed one keeps one open
// piece running from the end of the stretch round to its start.

import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
} from '../scene';
import { contourSource } from './trim-contours';
import type { TrimCrossing } from './trim-crossings';
import type { TrimTarget } from './trim-shapes';
import {
  contourParam,
  contourPoint,
  sliceClosedContour,
  sliceContour,
  type ContourSegments,
} from './trim-curve-split';
import type { VectorSceneObject } from './vector-path-tools';

export type TrimEdit = {
  /** The object's paths after the trim; a path left with no contours is dropped. */
  readonly paths: ReadonlyArray<ColoredPath>;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  /** How many open pieces replace the trimmed contour (0 to 2). */
  readonly pieces: number;
  readonly pathRemoved: boolean;
};

type TabAnchorLike = { readonly pathIndex: number; readonly polylineIndex: number };

const REFINE_STEPS = 52;

/** The object's paths with the target stretch removed, or null when the target no longer fits it. */
export function trimEdit(object: VectorSceneObject, target: TrimTarget): TrimEdit | null {
  const { pathIndex, polylineIndex } = target.contour;
  const path = object.paths[pathIndex];
  if (path === undefined || target.contour.objectId !== object.id) return null;
  const source = contourSource(path, polylineIndex);
  if (source === null || !source.trimmable) return null;
  const pieces = keptPieces(source.segments, target);
  const replaced = replaceContour(path, polylineIndex, pieces, source.curved);
  const pathRemoved = replaced.polylines.length === 0;
  const paths = pathRemoved
    ? object.paths.filter((_path, index) => index !== pathIndex)
    : object.paths.map((entry, index) => (index === pathIndex ? replaced : entry));
  return { paths, pathIndex, polylineIndex, pieces: pieces.length, pathRemoved };
}

/** Drop the placed tabs of the trimmed contour and renumber the ones after it. */
export function remapTrimmedAnchors<A extends TabAnchorLike>(
  anchors: ReadonlyArray<A>,
  edit: TrimEdit,
): ReadonlyArray<A> {
  return anchors.flatMap((anchor) => {
    if (anchor.pathIndex > edit.pathIndex && edit.pathRemoved) {
      return [{ ...anchor, pathIndex: anchor.pathIndex - 1 }];
    }
    if (anchor.pathIndex !== edit.pathIndex) return [anchor];
    if (edit.pathRemoved || anchor.polylineIndex === edit.polylineIndex) return [];
    if (anchor.polylineIndex < edit.polylineIndex) return [anchor];
    return [{ ...anchor, polylineIndex: anchor.polylineIndex + edit.pieces - 1 }];
  });
}

function keptPieces(segments: ContourSegments, target: TrimTarget): ReadonlyArray<CurveSubpath> {
  if (target.whole) return [];
  const end = segments.segments.length;
  const from = target.start === null ? 0 : refine(segments, target, target.start);
  const to = target.end === null ? end : refine(segments, target, target.end);
  const pieces = segments.closed
    ? [sliceClosedContour(segments, to, from)]
    : [
        ...(target.start === null ? [] : [sliceContour(segments, 0, from)]),
        ...(target.end === null ? [] : [sliceContour(segments, to, end)]),
      ];
  return pieces.filter((piece) => piece.segments.length > 0);
}

// Bisect along the crossing chord's stretch of the exact curve for the point
// on the other outline's chord line. A line is already exact; a curve moves by
// at most the chord tolerance, and its new end then lies on that outline.
function refine(segments: ContourSegments, target: TrimTarget, crossing: TrimCrossing): number {
  const contour = target.contour;
  const segment = segments.segments[contourParam(segments, crossing.p).index];
  if (segment === undefined || segment.kind === 'line') return crossing.p;
  let low = contour.params[crossing.chord] as number;
  let high = contour.params[crossing.chord + 1] as number;
  const side = (p: number): number => {
    const point = applyTransform(contourPoint(segments, p), contour.transform);
    const { edgeStart: a, edgeEnd: b } = crossing;
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  };
  let lowSide = side(low);
  if (lowSide === 0) return low;
  if (Math.sign(lowSide) === Math.sign(side(high))) return crossing.p;
  for (let step = 0; step < REFINE_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const middleSide = side(middle);
    if (middleSide === 0) return middle;
    if (Math.sign(middleSide) === Math.sign(lowSide)) {
      low = middle;
      lowSide = middleSide;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function replaceContour(
  path: ColoredPath,
  index: number,
  pieces: ReadonlyArray<CurveSubpath>,
  curved: boolean,
): ColoredPath {
  const polylines = splice(
    path.polylines,
    index,
    pieces.map(curved ? curvePolyline : linePolyline),
  );
  if (!curved || path.curves === undefined) return { ...path, polylines };
  return { ...path, polylines, curves: splice(path.curves, index, pieces) };
}

function splice<T>(items: ReadonlyArray<T>, index: number, replacement: ReadonlyArray<T>): T[] {
  return [...items.slice(0, index), ...replacement, ...items.slice(index + 1)];
}

/** A piece of an all-line contour back as a polyline of its own points. */
function linePolyline(piece: CurveSubpath): Polyline {
  return { closed: false, points: [piece.start, ...piece.segments.map((segment) => segment.to)] };
}

/** A curved piece's compatibility polyline at machine tolerance, as Break Apart builds it. */
function curvePolyline(piece: CurveSubpath): Polyline {
  const flattened = flattenCurveSubpath(piece, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flattened.kind === 'ok') return flattened.polyline;
  return linePolyline(piece);
}
