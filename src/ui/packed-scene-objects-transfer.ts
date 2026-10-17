// A selection of scene objects crosses a worker boundary as packed geometry,
// exactly as a whole project does (ADR-346, ADR-609).
//
// Workers that operate on the selection rather than the project (the vector
// geometry worker behind Offset Shapes and Combine Shapes) would otherwise
// structured-clone every {x, y} point on the sending thread: a traced image
// measured about 200 ms of UI time per post. The packed vertices travel in one
// transferred buffer instead, and the receiving side rebuilds equal objects.
// Small selections are sent unchanged, under the same threshold.

import type { ColoredPath, SceneObject } from '../core/scene';
import {
  countObjectVectorPoints,
  PACK_MIN_POINTS,
  packedPathsFor,
  unpackColoredPath,
  type PackedObjectGeometry,
} from './packed-project-transfer';
import { copyPackedGeometryForTransfer } from './packed-project-transfer-buffer';

export type SceneObjectsMessage<T extends SceneObject> =
  | { readonly kind: 'scene-objects'; readonly objects: ReadonlyArray<T> }
  | {
      readonly kind: 'packed-scene-objects';
      /** The objects with every packed object's `paths` emptied. */
      readonly objects: ReadonlyArray<T>;
      readonly geometry: ReadonlyArray<PackedObjectGeometry>;
    };

export type SceneObjectsTransfer<T extends SceneObject> = {
  readonly message: SceneObjectsMessage<T>;
  /** Buffers to hand to postMessage; empty when the objects are sent as they are. */
  readonly transfer: ArrayBuffer[];
};

type WithPaths = { readonly paths: ReadonlyArray<ColoredPath> };

export function packSceneObjectsMessage<T extends SceneObject>(
  objects: ReadonlyArray<T>,
): SceneObjectsTransfer<T> {
  if (countObjectVectorPoints(objects) < PACK_MIN_POINTS) {
    return { message: { kind: 'scene-objects', objects }, transfer: [] };
  }
  const geometry: PackedObjectGeometry[] = [];
  const stripped = objects.map((object, index) => {
    if (!hasPaths(object) || object.paths.length === 0) return object;
    geometry.push({ index, paths: packedPathsFor(object.paths) });
    return { ...object, paths: [] };
  });
  const copied = copyPackedGeometryForTransfer(geometry);
  return {
    message: { kind: 'packed-scene-objects', objects: stripped, geometry: copied.geometry },
    transfer: copied.transfer,
  };
}

export function unpackSceneObjectsMessage<T extends SceneObject>(
  message: SceneObjectsMessage<T>,
): ReadonlyArray<T> {
  if (message.kind === 'scene-objects') return message.objects;
  const byIndex = new Map(message.geometry.map((entry) => [entry.index, entry.paths]));
  return message.objects.map((object, index) => {
    const packed = byIndex.get(index);
    if (packed === undefined || !hasPaths(object)) return object;
    return { ...object, paths: packed.map(unpackColoredPath) };
  });
}

function hasPaths(object: SceneObject): object is SceneObject & WithPaths {
  return 'paths' in object;
}
