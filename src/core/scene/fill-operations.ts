// The Fill operations that burn a filled path (ADR-683 Amendment 1).
//
// A path can be bound to several operations (the Operation inspector's Add
// operation), and the compiler hatches it under every output Fill operation
// it uses, each pooled even-odd with that operation's other objects. The
// canvas fills a path when its first visible operation is Fill for its object
// (visibility.ts); it then belongs to the pool of every visible Fill
// operation it is bound to, so a point any of them burns is shown inked.

import { effectiveOperationForObject } from './effective-operation';
import type { Layer } from './layer';
import type { ColoredPath, SceneObject } from './scene-object';
import { visibleOperationsForPath } from './visibility';

export type PathFillOperation = {
  readonly operation: Layer;
  /** The operation's output switch for this object, after its own settings. */
  readonly output: boolean;
};

const NONE: ReadonlyArray<PathFillOperation> = [];

/** The visible Fill operations a filled path burns under, first the one that
 *  styles it; none when the canvas strokes the path instead of filling it. */
export function pathFillOperations(
  object: SceneObject,
  path: ColoredPath,
  operationLookup: ReadonlyMap<string, Layer>,
): ReadonlyArray<PathFillOperation> {
  const fills: PathFillOperation[] = [];
  for (const operation of visibleOperationsForPath(object, path, operationLookup)) {
    const effective = effectiveOperationForObject(operation, object);
    if (effective.mode === 'fill') fills.push({ operation, output: effective.output });
    else if (fills.length === 0) return NONE;
  }
  return fills;
}

/** One Fill pool: an operation's objects with one output switch burn together. */
export function fillPoolKey(fill: PathFillOperation): string {
  return `${fill.operation.id}\n${fill.output ? 1 : 0}`;
}
