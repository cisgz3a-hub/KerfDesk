// Names an undo step from what it did to the scene's objects: "Add text",
// "Delete 3 objects", "Move rectangle", "Rotate 2 objects". Used when the
// action that pushed the step gave no name (undo-step-names.ts). Pure.

import type { SceneObject, ShapeSpec, Transform } from '../../core/scene';

type EditKind = 'move' | 'resize' | 'rotate' | 'flip' | 'transform' | 'lock' | 'unlock' | 'edit';

const EDIT_VERBS: Readonly<Record<EditKind, string>> = {
  move: 'Move',
  resize: 'Resize',
  rotate: 'Rotate',
  flip: 'Flip',
  transform: 'Transform',
  lock: 'Lock',
  unlock: 'Unlock',
  edit: 'Edit',
};

const TRANSFORM_KINDS: ReadonlySet<EditKind> = new Set(['move', 'resize', 'rotate', 'flip']);

const SHAPE_NOUNS: Readonly<Record<ShapeSpec['kind'], string>> = {
  rect: 'rectangle',
  ellipse: 'ellipse',
  polygon: 'polygon',
  star: 'star',
  polyline: 'line',
  barcode: 'barcode',
};

/** Null when no object was added, removed, changed or restacked. */
export function describeObjectChange(
  before: ReadonlyArray<SceneObject>,
  after: ReadonlyArray<SceneObject>,
): string | null {
  const beforeById = new Map(before.map((object) => [object.id, object]));
  const afterIds = new Set(after.map((object) => object.id));
  const added = after.filter((object) => !beforeById.has(object.id));
  const removed = before.filter((object) => !afterIds.has(object.id));
  if (added.length > 0 && removed.length > 0) return replacementName(added, removed);
  if (added.length > 0) return `Add ${objectPhrase(added)}`;
  if (removed.length > 0) return `Delete ${objectPhrase(removed)}`;
  const edits = after.flatMap((object) => {
    const previous = beforeById.get(object.id);
    return previous === undefined || previous === object ? [] : [{ previous, object }];
  });
  if (edits.length > 0) return editName(edits);
  return sameOrder(before, after) ? null : 'Change stacking order';
}

/** "rectangle", "text", or "3 objects". */
export function objectPhrase(objects: ReadonlyArray<SceneObject>): string {
  const [only] = objects;
  if (objects.length === 1 && only !== undefined) return objectNoun(only);
  return `${objects.length} objects`;
}

function objectNoun(object: SceneObject): string {
  switch (object.kind) {
    case 'shape':
      return SHAPE_NOUNS[object.spec.kind];
    case 'text':
      return 'text';
    case 'raster-image':
      return 'image';
    case 'traced-image':
      return 'trace';
    case 'imported-svg':
      return 'artwork';
    case 'relief':
      return 'relief';
  }
}

// Weld, Break Apart, Convert to Path and the like swap objects for new ones.
function replacementName(
  added: ReadonlyArray<SceneObject>,
  removed: ReadonlyArray<SceneObject>,
): string {
  if (added.length < removed.length) return `Combine ${objectPhrase(removed)}`;
  if (added.length > removed.length) return `Split ${objectPhrase(removed)}`;
  return `Replace ${objectPhrase(removed)}`;
}

function editName(
  edits: ReadonlyArray<{ readonly previous: SceneObject; readonly object: SceneObject }>,
): string {
  const kinds = new Set(edits.map((edit) => editKind(edit.previous, edit.object)));
  const phrase = objectPhrase(edits.map((edit) => edit.object));
  const [only] = kinds;
  if (kinds.size === 1 && only !== undefined) return `${EDIT_VERBS[only]} ${phrase}`;
  const allTransforms = [...kinds].every((kind) => TRANSFORM_KINDS.has(kind));
  return `${allTransforms ? 'Transform' : 'Edit'} ${phrase}`;
}

function editKind(previous: SceneObject, next: SceneObject): EditKind {
  const changed = changedKeys(previous, next);
  if (changed.length === 1 && changed[0] === 'transform') {
    return transformKind(previous.transform, next.transform);
  }
  if (changed.length === 1 && changed[0] === 'locked') {
    return next.locked === true ? 'lock' : 'unlock';
  }
  return 'edit';
}

// Position changes along with a turn, a flip or a resize (they pivot on the
// selection), so the other field decides; only a bare x/y change is a move.
function transformKind(previous: Transform, next: Transform): EditKind {
  const resized = previous.scaleX !== next.scaleX || previous.scaleY !== next.scaleY;
  const rotated = previous.rotationDeg !== next.rotationDeg;
  const flipped = previous.mirrorX !== next.mirrorX || previous.mirrorY !== next.mirrorY;
  const count = [resized, rotated, flipped].filter(Boolean).length;
  if (count > 1) return 'transform';
  if (resized) return 'resize';
  if (rotated) return 'rotate';
  if (flipped) return 'flip';
  return 'move';
}

function changedKeys(previous: object, next: object): ReadonlyArray<string> {
  const a = previous as Readonly<Record<string, unknown>>;
  const b = next as Readonly<Record<string, unknown>>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]);
}

function sameOrder(before: ReadonlyArray<SceneObject>, after: ReadonlyArray<SceneObject>): boolean {
  return before.length === after.length && before.every((object, i) => after[i]?.id === object.id);
}
