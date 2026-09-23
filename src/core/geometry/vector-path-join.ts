import { err, ok, type Result } from '../result';
import {
  curveSubpathBounds,
  flattenCurveSubpath,
  IDENTITY_TRANSFORM,
  pathUsesOperation,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Layer,
} from '../scene';
import { joinCurveEndpointsWithin, type JoinableCurve } from './path-endpoint-join';
import { materializedStrokeFields } from './stroke-transform';
import { transformVectorCurve } from './vector-curve-transform';
import { type VectorOpError, type VectorSceneObject } from './vector-path-tools';

export type VectorPathJoinPlan = {
  readonly objects: ReadonlyArray<VectorSceneObject>;
  readonly joins: number;
  readonly closures: number;
  readonly remainingOpenPaths: number;
  readonly ambiguousEndpoints: number;
  readonly tabbedPaths: number;
};

type SourceCurve = JoinableCurve & {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly curveIndex: number;
};

/** Repairs open paths across artwork without merging independently owned
 * operations. Short gaps become line segments; source curves are never snapped. */
export function joinOpenVectorPaths(
  objects: ReadonlyArray<VectorSceneObject>,
  operations: ReadonlyArray<Layer>,
  toleranceMm: number,
): Result<VectorPathJoinPlan, VectorOpError> {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) {
    return err({
      kind: 'bad-distance',
      message: 'Enter a finite tolerance of zero or more millimetres.',
    });
  }
  const collection = collectJoinSources(objects, operations);
  if (collection.kind === 'error') return collection;
  const sources = collection.value;
  const joined = joinCurveEndpointsWithin(sources, toleranceMm);
  const edits = new Map<string, Map<string, CurveSubpath | null>>();
  for (const [index, replacement] of joined.replacements) {
    const source = sources[index];
    if (source === undefined) continue;
    const paths = edits.get(source.objectId) ?? new Map<string, CurveSubpath | null>();
    paths.set(curveKey(source.pathIndex, source.curveIndex), replacement);
    edits.set(source.objectId, paths);
  }
  const resultObjects: VectorSceneObject[] = [];
  for (const object of objects) {
    const edit = edits.get(object.id);
    if (edit === undefined) {
      resultObjects.push(object);
      continue;
    }
    const result = repairObject(object, operations, edit);
    if (result.kind === 'error') return result;
    if (result.value !== null) resultObjects.push(result.value);
  }
  return ok({
    objects: resultObjects,
    joins: joined.joins,
    closures: joined.closures,
    remainingOpenPaths: sources.length - joined.joins - joined.closures,
    ambiguousEndpoints: joined.ambiguousEndpoints,
    tabbedPaths: sources.filter((source) => source.protected).length,
  });
}

function collectJoinSources(
  objects: ReadonlyArray<VectorSceneObject>,
  operations: ReadonlyArray<Layer>,
): Result<SourceCurve[], VectorOpError> {
  const sources: SourceCurve[] = [];
  for (const object of objects) {
    if (!validTransform(object)) return invalidGeometry();
    for (const [pathIndex, path] of object.paths.entries()) {
      const signature = joinSignature(object, path, operations);
      for (const [curveIndex, curve] of pathCurves(path).entries()) {
        if (curve.closed || curve.segments.length === 0) continue;
        const protectedPath =
          object.cncTabAnchors?.some(
            (tab) => tab.pathIndex === pathIndex && tab.polylineIndex === curveIndex,
          ) === true;
        const world = transformVectorCurve(curve, object.transform);
        if (!finiteCurve(world)) return invalidGeometry();
        sources.push({
          objectId: object.id,
          pathIndex,
          curveIndex,
          curve: world,
          signature,
          protected: protectedPath,
        });
      }
    }
  }
  return ok(sources);
}

type AnchorMap = ReadonlyMap<
  string,
  { readonly pathIndex: number; readonly polylineIndex: number }
>;

function repairObject(
  object: VectorSceneObject,
  operations: ReadonlyArray<Layer>,
  edits: ReadonlyMap<string, CurveSubpath | null>,
): Result<ImportedSvg | null, VectorOpError> {
  const paths: ColoredPath[] = [];
  const anchorMap = new Map<
    string,
    { readonly pathIndex: number; readonly polylineIndex: number }
  >();
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [pathIndex, path] of object.paths.entries()) {
    const curves: CurveSubpath[] = [];
    for (const [curveIndex, original] of pathCurves(path).entries()) {
      const key = curveKey(pathIndex, curveIndex);
      const curve = edits.has(key)
        ? edits.get(key)
        : transformVectorCurve(original, object.transform);
      if (curve == null) continue;
      if (!finiteCurve(curve)) return invalidGeometry();
      anchorMap.set(key, { pathIndex: paths.length, polylineIndex: curves.length });
      curves.push(curve);
      const extent = curveSubpathBounds(curve);
      bounds.minX = Math.min(bounds.minX, extent.minX);
      bounds.minY = Math.min(bounds.minY, extent.minY);
      bounds.maxX = Math.max(bounds.maxX, extent.maxX);
      bounds.maxY = Math.max(bounds.maxY, extent.maxY);
    }
    if (curves.length === 0) continue;
    const polylines = [];
    for (const curve of curves) {
      const flattened = flattenCurveSubpath(curve, { toleranceMm: 0.025 });
      if (flattened.kind !== 'ok') {
        return err({
          kind: 'operation-failed',
          message: 'These curves are too complex to join. The artwork is unchanged.',
        });
      }
      polylines.push(flattened.polyline);
    }
    paths.push({
      ...path,
      operationIds: boundIds(object, path, operations),
      ...materializedStrokeFields(path, object.transform),
      fillRule: pathFillRule(object, path),
      curves,
      polylines,
    });
  }
  if (paths.length === 0) return ok(null);
  return ok({
    kind: 'imported-svg',
    id: object.id,
    source: 'source' in object ? object.source : 'Joined paths',
    ...repairMetadata(object, anchorMap),
    transform: IDENTITY_TRANSFORM,
    bounds,
    paths,
  });
}

function repairMetadata(
  object: VectorSceneObject,
  anchorMap: AnchorMap,
): Pick<
  ImportedSvg,
  | 'operationIds'
  | 'operationOverride'
  | 'powerScale'
  | 'locked'
  | 'libraryProvenance'
  | 'cncTabAnchors'
> {
  return {
    ...(object.operationIds === undefined ? {} : { operationIds: object.operationIds }),
    ...(object.operationOverride === undefined
      ? {}
      : { operationOverride: object.operationOverride }),
    ...(object.powerScale === undefined ? {} : { powerScale: object.powerScale }),
    ...(object.locked === undefined ? {} : { locked: object.locked }),
    ...(object.kind === 'imported-svg' && object.libraryProvenance !== undefined
      ? { libraryProvenance: object.libraryProvenance }
      : {}),
    ...(object.cncTabAnchors === undefined
      ? {}
      : {
          cncTabAnchors: object.cncTabAnchors.flatMap((anchor) => {
            const position = anchorMap.get(curveKey(anchor.pathIndex, anchor.polylineIndex));
            return position === undefined ? [] : [{ ...anchor, ...position }];
          }),
        }),
  };
}

function pathCurves(path: ColoredPath): ReadonlyArray<CurveSubpath> {
  return path.curves ?? path.polylines.map(polylineToCurveSubpath);
}

function boundIds(
  object: VectorSceneObject,
  path: ColoredPath,
  operations: ReadonlyArray<Layer>,
): string[] {
  return [
    ...new Set(
      path.operationIds ??
        object.operationIds ??
        operations
          .filter((operation) => pathUsesOperation(object, path, operation))
          .map((operation) => operation.bindingOperationId ?? operation.id),
    ),
  ].sort();
}

function joinSignature(
  object: VectorSceneObject,
  path: ColoredPath,
  operations: ReadonlyArray<Layer>,
): string {
  return stableValue({
    operations: boundIds(object, path, operations),
    color: path.color.toLowerCase(),
    powerScale: object.powerScale ?? 100,
    override: object.operationOverride ?? {},
    fillRule: pathFillRule(object, path),
    ...materializedStrokeFields(path, object.transform),
  });
}

function pathFillRule(
  object: VectorSceneObject,
  path: ColoredPath,
): NonNullable<ColoredPath['fillRule']> {
  return path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function curveKey(pathIndex: number, curveIndex: number): string {
  return `${pathIndex}:${curveIndex}`;
}

function finiteCurve(curve: CurveSubpath): boolean {
  return (
    Object.values(curve.start).every(Number.isFinite) &&
    curve.segments.every((segment) =>
      Object.values(segment).every((value) =>
        typeof value === 'object'
          ? Object.values(value).every(Number.isFinite)
          : typeof value !== 'number' || Number.isFinite(value),
      ),
    )
  );
}

function validTransform(object: VectorSceneObject): boolean {
  return (
    Object.values(object.transform).every(
      (value) => typeof value !== 'number' || Number.isFinite(value),
    ) &&
    object.transform.scaleX !== 0 &&
    object.transform.scaleY !== 0
  );
}

function invalidGeometry(): Result<never, VectorOpError> {
  return err({
    kind: 'operation-failed',
    message: 'A selected path has invalid or zero-scale geometry. The artwork is unchanged.',
  });
}
