// Copy Along Path (LightBurn gap LBG-T09): which selected object is the guide.
// KerfDesk keeps a selection in stacking order, not in the order it was
// clicked, so the guide is the top-most selected object that is one vector
// path, open or closed, with some length. The dialog can pick another one.

import type { SceneObject } from '../scene/scene-object';
import type { CopyAlongPathGuidePath } from './copy-along-path';
import { pathWalk } from './path-walk';
import {
  isVectorPathObject,
  materializeVectorObject,
  type VectorSceneObject,
} from './vector-path-tools';

export type CopyAlongPathGuide = CopyAlongPathGuidePath & { readonly object: SceneObject };

export type CopyAlongPathSelection =
  | {
      readonly kind: 'ok';
      readonly guide: CopyAlongPathGuide;
      /** Every selected object that could be the guide, top-most first. */
      readonly guides: ReadonlyArray<CopyAlongPathGuide>;
      /** Everything selected except the guide, in stacking order. */
      readonly artwork: ReadonlyArray<SceneObject>;
    }
  /** Nothing selected is one vector path. */
  | { readonly kind: 'no-guide' }
  /** Every single path selected has no length. */
  | { readonly kind: 'zero-length' }
  /** The guide is all there is. */
  | { readonly kind: 'no-artwork' };

// An open path whose ends meet this closely goes round like a closed one, so
// its first and last copies do not land on the same spot.
const ENDS_MEET_MM = 1e-3;

/**
 * Split a selection (in stacking order) into the guide and the artwork to copy.
 * `guideId` picks one of the possible guides; otherwise the top-most is used.
 */
export function splitCopyAlongPathSelection(
  selected: ReadonlyArray<SceneObject>,
  guideId?: string,
): CopyAlongPathSelection {
  const singles = selected.filter(isSinglePathObject).reverse();
  if (singles.length === 0) return { kind: 'no-guide' };
  const guides = singles.flatMap((object) => {
    const guide = guideFor(object);
    return guide === null ? [] : [guide];
  });
  const guide = guides.find((entry) => entry.object.id === guideId) ?? guides[0];
  if (guide === undefined) return { kind: 'zero-length' };
  const artwork = selected.filter((object) => object.id !== guide.object.id);
  if (artwork.length === 0) return { kind: 'no-artwork' };
  return { kind: 'ok', guide, guides, artwork };
}

// One path, open or closed. Text and barcodes are artwork, never guides.
function isSinglePathObject(object: SceneObject): object is VectorSceneObject {
  if (!isVectorPathObject(object) || object.kind === 'text') return false;
  if (object.kind === 'shape' && object.spec.kind === 'barcode') return false;
  let count = 0;
  for (const path of object.paths) {
    for (const polyline of path.polylines) if (polyline.points.length > 0) count += 1;
  }
  return count === 1;
}

function guideFor(object: VectorSceneObject): CopyAlongPathGuide | null {
  const polyline = materializeVectorObject(object)
    .paths.flatMap((path) => path.polylines)
    .find((line) => line.points.length > 0);
  if (polyline === undefined) return null;
  const first = polyline.points[0];
  const last = polyline.points[polyline.points.length - 1];
  const endsMeet =
    polyline.points.length > 2 &&
    first !== undefined &&
    last !== undefined &&
    Math.hypot(last.x - first.x, last.y - first.y) <= ENDS_MEET_MM;
  const closed = polyline.closed || endsMeet;
  const walk = pathWalk({ closed, points: polyline.points });
  return walk === null ? null : { object, walk, closed };
}
