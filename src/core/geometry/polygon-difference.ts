// differenceClosedPolylinesChecked — subject minus clip on bare closed
// polylines, keeping the engine-failure/empty distinction (the same contract
// as offsetClosedPolylinesForKerfChecked). The scene-object booleans in
// vector-path-booleans.ts wrap whole VectorSceneObjects and use non-zero
// fill; toolpath code needs a raw-contour variant with the even-odd
// semantics the v-carve ladder already gives source contours, so it lives
// in its own leaf beside kerf-offset rather than growing that file's API.

import { differenceD, FillRule } from 'clipper2-ts';
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
  const combined = tryVectorOp(() => differenceD(subjectPaths, clipPaths, FillRule.EvenOdd));
  if (combined.kind === 'error') return combined;
  // Drop the sub-micron needle vertices clipper leaves along the seam, the
  // same cleanup every offset in kerf-offset.ts applies before the emitter.
  return ok(
    combined.value.map((path) =>
      collapseTinySegments(pathDToPolyline(path), MIN_OFFSET_SEGMENT_MM),
    ),
  );
}
