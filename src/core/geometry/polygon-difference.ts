// differenceClosedPolylinesChecked — subject minus clip on bare closed
// polylines, keeping the engine-failure/empty distinction (the same contract
// as offsetClosedPolylinesForKerfChecked). The scene-object booleans in
// vector-path-booleans.ts wrap whole VectorSceneObjects and use non-zero
// fill; toolpath code needs a raw-contour variant with the even-odd
// semantics the normalized V-carve planner gives source contours, so it lives
// in its own leaf beside kerf-offset rather than growing that file's API.

import {
  booleanOpDWithPolyTree,
  ClipType,
  differenceD,
  FillRule,
  PolyTreeD,
  unionD,
  type PolyPathD,
} from 'clipper2-ts';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';
import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from './vector-path-tools';

const MIN_CLOSED_POINTS = 3;
// Same 1 µm rounding grid as kerf-offset's OFFSET_PRECISION_DECIMALS — the
// clipper default is 2 decimals, which would quantize hairline slivers more
// coarsely than the coverage slack that filters them (#575 finding).
const DIFFERENCE_PRECISION_DECIMALS = 3;

export type NormalizedPolylineTreeNode = {
  readonly contour: Polyline;
  readonly isHole: boolean;
  readonly parentIndex: number | null;
};

/**
 * Area of `subject` not inside `clip`, both read with even-odd fill. An empty
 * clip returns the subject unchanged; an empty result is `ok([])`, distinct
 * from an engine failure so callers never mistake "nothing left" for "the
 * engine gave up" (the silent-truncation trap offset-ladder.ts documents).
 */
export function differenceClosedPolylinesChecked(
  subject: ReadonlyArray<Polyline>,
  clip: ReadonlyArray<Polyline>,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  const subjectPaths = subject
    .map(polylineToPathD)
    .filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (subjectPaths.length === 0) return ok([]);
  const clipPaths = clip.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (clipPaths.length === 0) return ok(subject);
  const combined = tryVectorOp(() =>
    differenceD(subjectPaths, clipPaths, FillRule.EvenOdd, DIFFERENCE_PRECISION_DECIMALS),
  );
  if (combined.kind === 'error') return combined;
  // Drop the sub-micron needle vertices clipper leaves along the seam, the
  // same cleanup every offset in kerf-offset.ts applies before the emitter.
  return ok(
    combined.value.map((path) =>
      collapseTinySegments(pathDToPolyline(path), MIN_OFFSET_SEGMENT_MM),
    ),
  );
}

/**
 * Resolve overlaps and self-intersections into ordinary even-odd contour
 * roots before an offset ladder consumes them. Offsetting a raw bow-tie can
 * invert the intended inset and grow outward on every step; normalization
 * keeps the ladder inside the filled artwork instead.
 */
export function normalizeClosedPolylinesEvenOddChecked(
  contours: ReadonlyArray<Polyline>,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  const paths = contours.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return ok([]);
  const normalized = tryVectorOp(() =>
    unionD(paths, [], FillRule.EvenOdd, DIFFERENCE_PRECISION_DECIMALS),
  );
  if (normalized.kind === 'error') return normalized;
  return ok(
    normalized.value.map((path) =>
      collapseTinySegments(pathDToPolyline(path), MIN_OFFSET_SEGMENT_MM),
    ),
  );
}

/**
 * The same normalization with Clipper's exact ownership tree retained. Flat
 * path lists cannot distinguish a hole touching its owner from a sibling that
 * merely touches at a vertex; the tree can, because ownership is resolved by
 * the boolean engine while it still has its output-record topology.
 */
export function normalizeClosedPolylineTreeEvenOddChecked(
  contours: ReadonlyArray<Polyline>,
): Result<ReadonlyArray<NormalizedPolylineTreeNode>, VectorOpError> {
  const paths = contours.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return ok([]);
  const normalized = tryVectorOp(() => {
    const tree = new PolyTreeD();
    booleanOpDWithPolyTree(
      ClipType.Union,
      paths,
      null,
      tree,
      FillRule.EvenOdd,
      DIFFERENCE_PRECISION_DECIMALS,
    );
    return tree;
  });
  if (normalized.kind === 'error') return normalized;
  return ok(flattenPolyTree(normalized.value));
}

export function flattenNormalizedPolylineTree(
  nodes: ReadonlyArray<NormalizedPolylineTreeNode>,
): ReadonlyArray<Polyline> {
  return nodes.map((node) => node.contour);
}

function flattenPolyTree(tree: PolyTreeD): ReadonlyArray<NormalizedPolylineTreeNode> {
  const result: NormalizedPolylineTreeNode[] = [];
  const stack: Array<{
    readonly node: PolyPathD;
    readonly parentIndex: number | null;
    readonly isHole: boolean;
  }> = [];
  for (let index = tree.count - 1; index >= 0; index -= 1) {
    stack.push({ node: tree.child(index), parentIndex: null, isHole: false });
  }
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const currentIndex = result.length;
    result.push({
      contour: collapseTinySegments(
        pathDToPolyline(current.node.poly ?? []),
        MIN_OFFSET_SEGMENT_MM,
      ),
      isHole: current.isHole,
      parentIndex: current.parentIndex,
    });
    for (let index = current.node.count - 1; index >= 0; index -= 1) {
      stack.push({
        node: current.node.child(index),
        parentIndex: currentIndex,
        isHole: !current.isHole,
      });
    }
  }
  return result;
}
