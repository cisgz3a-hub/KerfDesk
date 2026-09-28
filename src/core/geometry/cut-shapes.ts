// Cut Shapes (LightBurn gap LBG-T08). The top-most selected closed shape is
// the cutter, mirroring Subtract, whose bottom-most shape is the subject: the
// front shape cuts the ones behind it. Every other selected vector object the
// cutter crosses becomes two objects, the part inside the cutter and the part
// outside it; open contours split where they cross its outline. An object the
// cutter does not cross is left exactly as it was, exact curves included.
// Pieces keep their paths' colours and operations and the object's own
// operation bindings, power scale and overrides, so they burn as before.

import type { PathsD } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import { cutSides, cutterRegion } from './cut-shape-sides';
import { boundsForPaths, type VectorSceneObject } from './vector-path-tools';

export type CutShapesError = {
  readonly kind: 'too-few-objects' | 'no-cutter' | 'nothing-cut' | 'operation-failed';
  readonly message: string;
};

export type CutShapesCut = {
  readonly sourceId: string;
  /** The outside piece, then the inside piece. */
  readonly pieces: readonly [ImportedSvg, ImportedSvg];
};

export type CutShapesPlan = {
  readonly cutterId: string;
  readonly cuts: ReadonlyArray<CutShapesCut>;
};

/**
 * Plan a cut of `objects`, given bottom to top in z-order. `usedIds` are the
 * scene's object ids; each piece gets a new one beside its source's.
 */
export function planCutShapes(
  objects: ReadonlyArray<VectorSceneObject>,
  usedIds: ReadonlySet<string>,
): Result<CutShapesPlan, CutShapesError> {
  if (objects.length < 2) {
    return err({
      kind: 'too-few-objects',
      message:
        'Cut Shapes needs two or more unlocked vector shapes selected: the top-most closed shape cuts the others.',
    });
  }
  const cutter = findCutter(objects);
  if (cutter.kind === 'error') return cutter;
  const ids = new Set(usedIds);
  const cuts: CutShapesCut[] = [];
  for (const object of objects) {
    if (object === cutter.value.object) continue;
    const sides = cutSides(object, cutter.value.region);
    if (sides.kind === 'error') return err({ ...sides.error, kind: 'operation-failed' });
    const { inside, outside } = sides.value;
    if (inside.length === 0 || outside.length === 0) continue;
    cuts.push({
      sourceId: object.id,
      pieces: [
        pieceObject(object, nextId(ids, `${object.id}-outside`), 'outside', outside),
        pieceObject(object, nextId(ids, `${object.id}-inside`), 'inside', inside),
      ],
    });
  }
  if (cuts.length === 0) {
    return err({
      kind: 'nothing-cut',
      message:
        'Nothing was cut: the cutter, the top-most selected closed shape, does not cross the other selected shapes.',
    });
  }
  return ok({ cutterId: cutter.value.object.id, cuts });
}

type Cutter = {
  readonly object: VectorSceneObject;
  readonly region: PathsD;
};

function findCutter(objects: ReadonlyArray<VectorSceneObject>): Result<Cutter, CutShapesError> {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (object === undefined) continue;
    const region = cutterRegion(object);
    if (region.kind === 'error') return err({ ...region.error, kind: 'operation-failed' });
    if (region.value !== null) return ok({ object, region: region.value });
  }
  return err({
    kind: 'no-cutter',
    message:
      'Cut Shapes needs a closed shape to cut with, and none of the selected shapes is closed. The top-most selected closed shape is the cutter.',
  });
}

function pieceObject(
  source: VectorSceneObject,
  id: string,
  side: 'inside' | 'outside',
  paths: ReadonlyArray<ColoredPath>,
): ImportedSvg {
  return {
    ...(source.operationIds === undefined ? {} : { operationIds: source.operationIds }),
    ...(source.powerScale === undefined ? {} : { powerScale: source.powerScale }),
    ...(source.operationOverride === undefined
      ? {}
      : { operationOverride: source.operationOverride }),
    kind: 'imported-svg',
    id,
    source: `${sourceName(source)} (${side})`,
    bounds: boundsForPaths(paths) ?? source.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function sourceName(object: VectorSceneObject): string {
  if (object.kind === 'text') return `Text: ${object.content}`;
  if (object.kind === 'shape') return `Shape: ${object.spec.kind}`;
  return object.source;
}

function nextId(used: Set<string>, base: string): string {
  let id = base;
  for (let suffix = 2; used.has(id); suffix += 1) id = `${base}-${suffix}`;
  used.add(id);
  return id;
}
