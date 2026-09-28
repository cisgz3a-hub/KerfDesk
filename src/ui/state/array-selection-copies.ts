import type { ArrayPlacement, SceneObject } from '../../core/scene';
import type { ArrayPlacementMirror } from '../../core/scene/array-layout-types';
import { flipTransformAboutPoint } from '../../core/scene/selection-transform';
import { remapSceneObjectCopyDependencies } from './scene-object-copy-dependencies';

export function copyObjectsAtArrayPlacement(
  sources: ReadonlyArray<SceneObject>,
  placement: ArrayPlacement,
  idFactory: () => string,
): { readonly ids: ReadonlyMap<string, string>; readonly objects: ReadonlyArray<SceneObject> } {
  const assigned = sources.map((object) => ({ object, id: idFactory() }));
  const ids = new Map(assigned.map(({ object, id }) => [object.id, id] as const));
  return {
    ids,
    objects: assigned.map(({ object, id }) => {
      const placed = { ...placedObject(structuredClone(object), placement), id } as SceneObject;
      return remapSceneObjectCopyDependencies(placed, ids);
    }),
  };
}

/** Pure placement of one array copy: mirror, then move, then rotate. Exported for direct pivot coverage. */
export function placedObject(object: SceneObject, placement: ArrayPlacement): SceneObject {
  const source = placement.mirror === undefined ? object : mirrored(object, placement.mirror);
  const moved = {
    ...source.transform,
    x: source.transform.x + placement.dx,
    y: source.transform.y + placement.dy,
  };
  const rotationDeg = normalizeDegrees(placement.rotationDeg);
  if (rotationDeg === 0 || placement.pivot === undefined) {
    return { ...source, transform: moved } as SceneObject;
  }
  const origin = rotateAboutPivot(moved, placement.pivot, rotationDeg);
  return {
    ...source,
    transform: {
      ...moved,
      x: origin.x,
      y: origin.y,
      rotationDeg: normalizeDegrees(source.transform.rotationDeg + rotationDeg),
    },
  } as SceneObject;
}

export function isIdentityArrayPlacement(placement: ArrayPlacement): boolean {
  return (
    placement.dx === 0 &&
    placement.dy === 0 &&
    normalizeDegrees(placement.rotationDeg) === 0 &&
    placement.mirror === undefined
  );
}

// Every object in the copy is mirrored about the same point, so a multi-object
// design mirrors as one piece, as Flip does.
function mirrored(object: SceneObject, mirror: ArrayPlacementMirror): SceneObject {
  let result = object;
  if (mirror.horizontal) {
    const transform = flipTransformAboutPoint(result, 'horizontal', mirror.center);
    result = { ...result, transform } as SceneObject;
  }
  if (mirror.vertical) {
    const transform = flipTransformAboutPoint(result, 'vertical', mirror.center);
    result = { ...result, transform } as SceneObject;
  }
  return result;
}

function rotateAboutPivot(
  origin: { readonly x: number; readonly y: number },
  pivot: { readonly x: number; readonly y: number },
  deltaDeg: number,
): { readonly x: number; readonly y: number } {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = origin.x - pivot.x;
  const dy = origin.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
