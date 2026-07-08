// box-anchor-align — snap the selected artwork to a corner or the centre of a
// reference box (the captured-board outline, ADR-124). The registration jig
// already centres artwork on the box (selection-transform-actions); this adds
// the four corners by composing an X-kind and a Y-kind of the existing align
// delta. Pure — no scene mutation, no I/O.

import type { BoardAnchor } from './board-capture';
import { transformedBBox, type AABB } from './hit-test';
import type { SceneObject, Transform } from './scene-object';
import { alignDelta, type SelectionAlignKind } from './selection-align';
import type { SelectionTransform } from './selection-transform';

export type BoxAnchorAlignError = 'empty-selection' | 'missing-reference';

export type BoxAnchorAlignResult =
  | { readonly kind: 'ok'; readonly transforms: ReadonlyArray<SelectionTransform> }
  | { readonly kind: 'error'; readonly reason: BoxAnchorAlignError };

// Each board anchor is one horizontal + one vertical single-axis align. Canvas Y
// is SVG-down, so 'bottom' is the max-Y edge — the board's origin corner
// (bottom-left) the operator jogged to.
const ANCHOR_KINDS: Readonly<
  Record<BoardAnchor, { readonly x: SelectionAlignKind; readonly y: SelectionAlignKind }>
> = {
  center: { x: 'center-x', y: 'center-y' },
  'top-left': { x: 'left', y: 'top' },
  'top-right': { x: 'right', y: 'top' },
  'bottom-left': { x: 'left', y: 'bottom' },
  'bottom-right': { x: 'right', y: 'bottom' },
};

/**
 * Build the transforms that move every non-reference object in `objects` so its
 * bounding box lands on `anchor` of the reference box (identified by
 * `referenceId`). Objects already at the anchor are omitted (zero-delta), so an
 * empty `transforms` list means "nothing to move".
 */
export function buildBoxAnchorAlign(
  objects: ReadonlyArray<SceneObject>,
  referenceId: string,
  anchor: BoardAnchor,
): BoxAnchorAlignResult {
  if (objects.length === 0) return { kind: 'error', reason: 'empty-selection' };
  const reference = objects.find((object) => object.id === referenceId);
  if (reference === undefined) return { kind: 'error', reason: 'missing-reference' };
  const referenceBox = transformedBBox(reference);
  const kinds = ANCHOR_KINDS[anchor];
  const transforms = objects
    .filter((object) => object.id !== reference.id)
    .map((object) => alignObjectToAnchor(object, referenceBox, kinds))
    .filter((item): item is SelectionTransform => item !== null);
  return { kind: 'ok', transforms };
}

function alignObjectToAnchor(
  object: SceneObject,
  referenceBox: AABB,
  kinds: { readonly x: SelectionAlignKind; readonly y: SelectionAlignKind },
): SelectionTransform | null {
  const objectBox = transformedBBox(object);
  const dx = alignDelta(objectBox, referenceBox, kinds.x).x;
  const dy = alignDelta(objectBox, referenceBox, kinds.y).y;
  if (dx === 0 && dy === 0) return null;
  return { id: object.id, transform: translateTransform(object.transform, dx, dy) };
}

function translateTransform(transform: Transform, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}
