// Stacked copies that cancel on a laser Fill operation (ADR-683).
//
// The compiler pools every object on a Fill operation under even-odd parity
// (fill-rule.ts, ADR-486 Amendment 2), so where two copies of one shape lie
// exactly on each other, neither burns. Duplicate (Ctrl+D) or Paste in Place
// on a Fill part, or importing a file twice, does this, and the job silently
// loses the part. LightBurn warns about such duplicates before Preview or
// engraving ("Missing Shapes"). An odd number of copies still burns once, so
// only sets with an even count are reported. CNC merges its exact copies at
// compile time instead (ADR-359 Amendment 3).
import { closedContourKey } from '../geometry/duplicate-shapes';
import { effectiveOperationForObject } from '../effective-output';
import {
  applyTransform,
  outputOperationLayers,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
} from '../scene';

type VectorSceneObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

export type CancelledFillCopies = {
  readonly operationName: string;
  /** Every copy in the set, in canvas order. */
  readonly objectIds: ReadonlyArray<string>;
};

export function cancelledFillCopies(scene: Scene): ReadonlyArray<CancelledFillCopies> {
  const found: CancelledFillCopies[] = [];
  for (const operation of scene.layers.flatMap(outputOperationLayers)) {
    const candidates = new Map<string, Candidate[]>();
    for (const object of scene.objects) {
      if (!('paths' in object)) continue;
      if (effectiveOperationForObject(operation, object).mode !== 'fill') continue;
      const contours = filledContours(object, operation);
      if (contours.length === 0) continue;
      const key = roughKey(contours);
      const same = candidates.get(key) ?? [];
      same.push({ object, contours });
      candidates.set(key, same);
    }
    for (const rough of candidates.values()) {
      if (rough.length < 2) continue;
      for (const copies of exactSets(rough)) {
        if (copies.length % 2 !== 0) continue;
        found.push({
          operationName: operation.name,
          objectIds: copies.map(({ object }) => object.id),
        });
      }
    }
  }
  return found;
}

type Candidate = {
  readonly object: VectorSceneObject;
  readonly contours: ReadonlyArray<{
    readonly points: Polyline['points'];
    readonly nonzero: boolean;
  }>;
};

// The world-space closed contours the operation fills for this object, each
// marked with whether its path keeps its winding (non-zero, as text does).
function filledContours(object: VectorSceneObject, operation: Layer): Candidate['contours'] {
  return object.paths.flatMap((path) => {
    if (!pathUsesOperation(object, path, operation)) return [];
    const nonzero =
      (path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd')) === 'nonzero';
    return path.polylines
      .filter((polyline) => polyline.closed && polyline.points.length >= 3)
      .map((polyline) => ({
        points: polyline.points.map((point) => applyTransform(point, object.transform)),
        nonzero,
      }));
  });
}

// Cheap, so only objects that could be copies pay for exact keys: the contour
// count, the ring vertex count (a repeated start point is the same ring) and
// the world box on the exact keys' 0.001 mm grid.
function roughKey(contours: Candidate['contours']): string {
  let points = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const contour of contours) {
    const first = contour.points[0];
    const last = contour.points.at(-1);
    const seam =
      first !== undefined && last !== undefined && first.x === last.x && first.y === last.y;
    points += contour.points.length - (seam ? 1 : 0);
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const box = [minX, minY, maxX, maxY].map((value) => Math.round(value * 1000)).join(',');
  return `${contours.length}|${points}|${box}`;
}

// Exact copies: the same rings to 0.001 mm, from any start point and either
// way round (Delete Duplicates' test, ADR-480), keeping winding for non-zero.
function exactSets(rough: ReadonlyArray<Candidate>): Candidate[][] {
  const sets = new Map<string, Candidate[]>();
  for (const candidate of rough) {
    const key = candidate.contours
      .map(
        (contour) =>
          `${contour.nonzero ? 'N' : 'E'}${closedContourKey({ closed: true, points: contour.points }, contour.nonzero)}`,
      )
      .sort()
      .join('#');
    const set = sets.get(key) ?? [];
    set.push(candidate);
    sets.set(key, set);
  }
  return [...sets.values()];
}
