// Which laser operations cut around other work, read from the geometry the
// compiler burns. Line mode covers both cutting and scoring and the project has
// no cut flag, so a Line operation counts as a cut when one of its closed shapes
// surrounds work from another output operation: that shape frees a part before
// the work inside it can run. Sort Cuts Last orders the job by this analysis.

import { effectiveOperationForObject } from './effective-output';
import { compilationPolylines } from './job/compilation-polylines';
import { containerCandidateQuery } from './job/containment-depth';
import { polygonSurrounds } from './job/cut-order-hazards';
import { boundsCenter, polylineBounds, type SegmentBounds } from './job/segment-bounds';
import {
  applyTransform,
  isRegistrationLayer,
  pathUsesOperation,
  sceneObjectUsesOperation,
  transformedBBox,
  type ColoredPath,
  type Layer,
  type Scene,
  type SceneObject,
  type Vec2,
} from './scene';

type Piece = {
  readonly objectId: string;
  readonly operationId: string;
  readonly bounds: SegmentBounds;
  /** A closed contour burned in Line mode; only these can free a part. */
  readonly polygon: ReadonlyArray<Vec2> | null;
};

type WorldPolyline = { readonly points: ReadonlyArray<Vec2>; readonly closed: boolean };

export type CutEnclosure = {
  readonly cutOperationIds: ReadonlySet<string>;
  /** For each operation, how many other cut operations surround part of it. */
  readonly operationDepths: ReadonlyMap<string, number>;
  /** For each artwork, how many other artworks surround part of it with a cut. */
  readonly objectDepths: ReadonlyMap<string, number>;
};

const NO_ENCLOSURE: CutEnclosure = {
  cutOperationIds: new Set(),
  operationDepths: new Map(),
  objectDepths: new Map(),
};

export function analyzeCutEnclosure(scene: Scene): CutEnclosure {
  const pieces = scenePieces(scene);
  const containers = pieces.filter((piece) => piece.polygon !== null);
  if (containers.length === 0) return NO_ENCLOSURE;
  const candidates = containerCandidateQuery(containers.map((piece) => piece.bounds));
  const cutOperationIds = new Set<string>();
  const operationEnclosers = new Map<string, Set<string>>();
  const objectEnclosers = new Map<string, Set<string>>();
  for (const target of pieces) {
    const probe = boundsCenter(target.bounds);
    if (probe === null) continue;
    for (const index of candidates(probe)) {
      const container = containers[index];
      if (!surroundsOtherWork(container, target)) continue;
      cutOperationIds.add(container.operationId);
      addTo(operationEnclosers, target.operationId, container.operationId);
      if (container.objectId !== target.objectId) {
        addTo(objectEnclosers, target.objectId, container.objectId);
      }
    }
  }
  return {
    cutOperationIds,
    operationDepths: countsOf(operationEnclosers),
    objectDepths: countsOf(objectEnclosers),
  };
}

// Work on the container's own operation is ordered by the optimizer's
// inside-first rule, so only another operation's work makes this a cut.
function surroundsOtherWork(container: Piece | undefined, target: Piece): container is Piece {
  return (
    container !== undefined &&
    container !== target &&
    container.polygon !== null &&
    container.operationId !== target.operationId &&
    polygonSurrounds(container.polygon, container.bounds, target.bounds)
  );
}

function scenePieces(scene: Scene): ReadonlyArray<Piece> {
  const operations = scene.layers.filter((layer) => layer.output && !isRegistrationLayer(layer));
  const pieces: Piece[] = [];
  for (const object of scene.objects) {
    const world = new Map<ColoredPath, ReadonlyArray<WorldPolyline>>();
    for (const operation of operations) {
      if (sceneObjectUsesOperation(object, operation)) {
        appendPieces(object, operation, world, pieces);
      }
    }
  }
  return pieces;
}

// Mirrors what compile burns: a raster only on an Image operation, vector
// paths only on Line or Fill, each with the artwork's own mode override.
function appendPieces(
  object: SceneObject,
  operation: Layer,
  world: Map<ColoredPath, ReadonlyArray<WorldPolyline>>,
  pieces: Piece[],
): void {
  const mode = effectiveOperationForObject(operation, object).mode;
  const identity = { objectId: object.id, operationId: operation.id };
  if (object.kind === 'raster-image') {
    if (mode === 'image')
      pieces.push({ ...identity, bounds: transformedBBox(object), polygon: null });
    return;
  }
  if (!('paths' in object) || mode === 'image') return;
  for (const path of object.paths) {
    if (!pathUsesOperation(object, path, operation)) continue;
    for (const polyline of worldPolylines(object, path, world)) {
      const bounds = polylineBounds(polyline.points);
      if (bounds === null) continue;
      const polygon = mode === 'line' && polyline.closed ? polyline.points : null;
      pieces.push({ ...identity, bounds, polygon });
    }
  }
}

function worldPolylines(
  object: Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>,
  path: ColoredPath,
  cache: Map<ColoredPath, ReadonlyArray<WorldPolyline>>,
): ReadonlyArray<WorldPolyline> {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;
  const polylines = compilationPolylines(path, object.transform).map((polyline) => ({
    points: polyline.points.map((point) => applyTransform(point, object.transform)),
    closed: polyline.closed,
  }));
  cache.set(path, polylines);
  return polylines;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, new Set([value]));
  else values.add(value);
}

function countsOf(map: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, number> {
  return new Map([...map].map(([key, values]) => [key, values.size]));
}
