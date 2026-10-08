// Checked even-odd region intersection on the same 1 micrometre grid as polygon-difference.
import { intersectD, FillRule } from 'clipper2-ts';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';
import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from './vector-path-tools';

export function intersectClosedPolylinesChecked(
  subject: ReadonlyArray<Polyline>,
  clip: ReadonlyArray<Polyline>,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  const a = subject.map(polylineToPathD).filter((path) => path.length >= 3);
  const b = clip.map(polylineToPathD).filter((path) => path.length >= 3);
  if (a.length === 0 || b.length === 0) return ok([]);
  const result = tryVectorOp(() => intersectD(a, b, FillRule.EvenOdd, 3));
  return result.kind === 'error'
    ? result
    : ok(
        result.value.map((path) =>
          collapseTinySegments(pathDToPolyline(path), MIN_OFFSET_SEGMENT_MM),
        ),
      );
}
