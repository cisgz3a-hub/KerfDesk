// Open Fill diagnostics use the same enabled operations and canonical contours
// as compilation. One physical contour is counted once even when several Fill
// operations or suboperations omit it.
import { effectiveOperationForObject } from '../effective-output';
import { isBooleanCompoundObject } from '../scene/boolean-compound';
import {
  applyTransform,
  outputOperationLayers,
  pathUsesOperation,
  type ColoredPath,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../scene';
import { CLOSURE_EPS_MM } from '../scene/polyline-closure';
import { compilationPolylines } from './compilation-polylines';

type VectorSceneObject = Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }>;

export type OpenFillContourGroup = {
  readonly object: VectorSceneObject;
  readonly path: ColoredPath;
  readonly pathIndex: number;
  readonly polylines: ReadonlyArray<Polyline>;
  readonly contourIndexes: ReadonlyArray<number>;
  /** Counts may describe derived compound paths, or canonical geometry whose
   * compatibility pair or parametric shape cannot be repaired without guessing. */
  readonly repairable: boolean;
};

export type OpenFillContourSummary = {
  readonly objectIds: ReadonlyArray<string>;
  readonly contourCount: number;
};

export const CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM = 0.5;

export function openFillContours(
  scene: Scene,
  objectIds?: ReadonlySet<string>,
): ReadonlyArray<OpenFillContourGroup> {
  const outputOperations = scene.layers.flatMap(outputOperationLayers);
  if (outputOperations.length === 0) return [];
  return scene.objects.flatMap((object) => {
    if (!('paths' in object) || (objectIds !== undefined && !objectIds.has(object.id))) return [];
    const fills = outputOperations
      .map((operation) => effectiveOperationForObject(operation, object))
      .filter((operation) => operation.mode === 'fill');
    return openFillContoursForObject(object, fills);
  });
}

export function summarizeOpenFillContours(
  groups: ReadonlyArray<OpenFillContourGroup>,
): OpenFillContourSummary {
  return {
    objectIds: [...new Set(groups.map((group) => group.object.id))],
    contourCount: groups.reduce((sum, group) => sum + group.polylines.length, 0),
  };
}

/** Fill hatching and offset Fill apply isClosedEnough after the world/machine
 * transform. Inspect endpoints in that same mm frame; compatibility flags
 * cannot override a canonical curve because compilationPolylines owns it. */
export function isOpenFillPolyline(polyline: Polyline, transform: Transform): boolean {
  if (polyline.closed || polyline.points.length < 2) return false;
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  return first !== undefined && last !== undefined && endpointsAreOpen(first, last, transform);
}

function endpointsAreOpen(first: Vec2, last: Vec2, transform: Transform): boolean {
  const firstMm = applyTransform(first, transform);
  const lastMm = applyTransform(last, transform);
  return !(
    Math.abs(firstMm.x - lastMm.x) < CLOSURE_EPS_MM &&
    Math.abs(firstMm.y - lastMm.y) < CLOSURE_EPS_MM
  );
}

export function isCloseableOpenFillPolyline(
  polyline: Polyline,
  transform: Transform,
  toleranceMm = CLOSE_OPEN_FILL_CONTOUR_TOLERANCE_MM,
): boolean {
  if (
    !Number.isFinite(toleranceMm) ||
    toleranceMm <= 0 ||
    polyline.points.length < 3 ||
    !isOpenFillPolyline(polyline, transform)
  )
    return false;
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return false;
  const firstMm = applyTransform(first, transform);
  const lastMm = applyTransform(last, transform);
  const gapMm = Math.hypot(firstMm.x - lastMm.x, firstMm.y - lastMm.y);
  return Number.isFinite(gapMm) && gapMm <= toleranceMm;
}

function openFillContoursForObject(
  object: VectorSceneObject,
  fills: ReadonlyArray<Layer>,
): ReadonlyArray<OpenFillContourGroup> {
  return object.paths.flatMap((path, pathIndex) => {
    if (!fills.some((operation) => pathUsesOperation(object, path, operation))) return [];
    const contourIndexes: number[] = [];
    const polylines: Polyline[] = [];
    if (path.curves === undefined) {
      path.polylines.forEach((polyline, index) => {
        if (!isOpenFillPolyline(polyline, object.transform)) return;
        contourIndexes.push(index);
        polylines.push(polyline);
      });
    } else {
      path.curves.forEach((curve, index) => {
        // A closed dense trace needs no materialization for an OPEN-contour
        // advisory. In a mixed path, flatten only potentially open subpaths,
        // keeping their original compatibility/canonical pair indexes.
        const end = curve.segments.at(-1)?.to;
        if (
          curve.closed ||
          end === undefined ||
          !endpointsAreOpen(curve.start, end, object.transform)
        )
          return;
        const polyline = compilationPolylines({ ...path, curves: [curve] }, object.transform)[0];
        if (polyline === undefined || !isOpenFillPolyline(polyline, object.transform)) return;
        contourIndexes.push(index);
        polylines.push(polyline);
      });
    }
    if (contourIndexes.length === 0) return [];
    return [
      {
        object,
        path,
        pathIndex,
        polylines,
        contourIndexes,
        repairable:
          !isBooleanCompoundObject(object) &&
          (path.curves === undefined || path.curves.length === path.polylines.length) &&
          shapeHasRepairableRepresentation(object),
      },
    ];
  });
}

function shapeHasRepairableRepresentation(object: VectorSceneObject): boolean {
  if (object.kind !== 'shape') return true;
  const path = object.paths[0];
  return (
    object.spec.kind === 'polyline' &&
    object.paths.length === 1 &&
    path?.polylines.length === 1 &&
    (path.curves === undefined || path.curves.length === 1)
  );
}
