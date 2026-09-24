import { FillRule, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from '../scene';
import type { SceneGroup } from '../scene/scene';
import { selectionUnits } from '../scene/selection-units';
import { groupOperandRegion } from './group-operand-region';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import {
  normalizeVectorObjectBatches,
  VECTOR_PATH_PRECISION_DECIMALS,
  type NormalizedVectorPathBatch,
} from './vector-path-regions';
import {
  boundsForPaths,
  pathDToPolyline,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';

// One object's share of a Weld batch, tagged with the selection unit (a lone
// object, or every member of a group) it belongs to.
type WeldPiece = {
  readonly unitKey: string;
  readonly objectId: string;
  readonly paths: PathsD;
};

type WeldBatch = Pick<
  NormalizedVectorPathBatch,
  'color' | 'operationIds' | 'strokeWidthMm' | 'strokeTransform'
> & {
  readonly pieces: ReadonlyArray<WeldPiece>;
};

/**
 * Union the selection per color/operation batch. Members of a group in
 * `groups` first combine into the group's one shape (ADR-377), so an inner
 * circle grouped with an outer one stays a hole instead of welding shut.
 */
export function weldVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  id: string,
  groups: ReadonlyArray<SceneGroup> = [],
): Result<ImportedSvg, VectorOpError> {
  const firstObject = objects[0];
  if (firstObject === undefined) {
    return err({
      kind: 'too-few-objects',
      message: 'Weld requires selected closed vector contours.',
    });
  }
  const grouped = collectWeldBatches(objects, unitKeysById(objects, groups));
  if (grouped.kind === 'error') return grouped;
  const weldedPaths = weldBatches(grouped.value);
  if (weldedPaths.kind === 'error') return weldedPaths;
  if (weldedPaths.value.length === 0) {
    return err({ kind: 'empty-result', message: 'Welding these shapes produced an empty result.' });
  }
  return ok({
    ...commonObjectMetadata(objects),
    kind: 'imported-svg',
    id,
    source: 'Welded paths',
    bounds: boundsForPaths(weldedPaths.value) ?? firstObject.bounds,
    transform: IDENTITY_TRANSFORM,
    paths: weldedPaths.value,
  });
}

function unitKeysById(
  objects: ReadonlyArray<VectorSceneObject>,
  groups: ReadonlyArray<SceneGroup>,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const unit of selectionUnits(objects, groups)) {
    const unitKey = unit.objects[0]?.id ?? '';
    for (const object of unit.objects) keys.set(object.id, unitKey);
  }
  return keys;
}

function collectWeldBatches(
  objects: ReadonlyArray<VectorSceneObject>,
  unitKeys: ReadonlyMap<string, string>,
): Result<Map<string, WeldBatch>, VectorOpError> {
  const grouped = new Map<string, WeldBatch>();
  for (const object of objects) {
    const normalized = normalizeVectorObjectBatches(object);
    if (normalized.kind === 'error') return normalized;
    for (const batch of normalized.value) {
      const operationIds = normalizedOperationIds(batch.operationIds);
      // One source path may intentionally run under several operations. Split
      // it into one Weld batch per root so an A+B path can union with A-only
      // geometry without changing the independent B run.
      const bindingSets = operationBindingSets(operationIds);
      for (const bindingSet of bindingSets) {
        const key = batchKey(batch.color, bindingSet, batch.strokeWidthMm, batch.strokeTransform);
        const existing = grouped.get(key);
        grouped.set(key, {
          color: batch.color,
          ...(bindingSet === undefined ? {} : { operationIds: bindingSet }),
          ...(batch.strokeWidthMm === undefined ? {} : { strokeWidthMm: batch.strokeWidthMm }),
          ...(batch.strokeTransform === undefined
            ? {}
            : { strokeTransform: batch.strokeTransform }),
          pieces: [
            ...(existing?.pieces ?? []),
            {
              unitKey: unitKeys.get(object.id) ?? object.id,
              objectId: object.id,
              paths: batch.paths,
            },
          ],
        });
      }
    }
  }
  return ok(grouped);
}

function operationBindingSets(
  operationIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<ReadonlyArray<string> | undefined> {
  if (operationIds === undefined) return [undefined];
  if (operationIds.length === 0) return [[]];
  return operationIds.map((operationId) => [operationId]);
}

function weldBatches(
  grouped: ReadonlyMap<string, WeldBatch>,
): Result<ColoredPath[], VectorOpError> {
  const paths: ColoredPath[] = [];
  // Map insertion order is supplied by scene/source-operation order in the
  // state plan. Do not sort fresh string IDs: operation-10 would precede
  // operation-2 and silently change source-order output.
  for (const batch of grouped.values()) {
    const input = batchUnitPaths(batch.pieces);
    if (input.kind === 'error') return input;
    const welded = tryVectorOp(() =>
      canonicalizeVectorPaths(
        unionD(input.value, [], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
      ),
    );
    if (welded.kind === 'error') return welded;
    if (welded.value.length === 0) continue;
    paths.push({
      color: batch.color,
      ...(batch.operationIds === undefined ? {} : { operationIds: batch.operationIds }),
      ...(batch.strokeWidthMm === undefined ? {} : { strokeWidthMm: batch.strokeWidthMm }),
      ...(batch.strokeTransform === undefined ? {} : { strokeTransform: batch.strokeTransform }),
      polylines: welded.value.map(pathDToPolyline),
    });
  }
  return ok(paths);
}

// A lone object's pieces go into the union unchanged. A group's members first
// merge by nesting, each member's own pieces unioned into one region.
function batchUnitPaths(pieces: ReadonlyArray<WeldPiece>): Result<PathsD, VectorOpError> {
  const units = new Map<string, WeldPiece[]>();
  for (const piece of pieces) {
    const unit = units.get(piece.unitKey);
    if (unit === undefined) units.set(piece.unitKey, [piece]);
    else unit.push(piece);
  }
  const paths: PathD[] = [];
  for (const unit of units.values()) {
    const region = unitRegion(unit);
    if (region.kind === 'error') return region;
    paths.push(...region.value);
  }
  return ok(paths);
}

function unitRegion(pieces: ReadonlyArray<WeldPiece>): Result<PathsD, VectorOpError> {
  const memberPieces = new Map<string, PathsD[]>();
  for (const piece of pieces) {
    memberPieces.set(piece.objectId, [...(memberPieces.get(piece.objectId) ?? []), piece.paths]);
  }
  if (memberPieces.size <= 1) return ok(pieces.flatMap((piece) => piece.paths));
  const members: PathsD[] = [];
  for (const parts of memberPieces.values()) {
    const member =
      parts.length === 1
        ? ok(parts[0] ?? [])
        : tryVectorOp(() =>
            canonicalizeVectorPaths(
              unionD(parts.flat(), [], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
            ),
          );
    if (member.kind === 'error') return member;
    members.push(member.value);
  }
  return groupOperandRegion(members);
}

function normalizedOperationIds(
  operationIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  if (operationIds === undefined) return undefined;
  return [...new Set(operationIds)];
}

function batchKey(
  color: string,
  operationIds: ReadonlyArray<string> | undefined,
  strokeWidthMm: number | undefined,
  strokeTransform: ColoredPath['strokeTransform'],
): string {
  return JSON.stringify([
    color.toLowerCase(),
    operationIds ?? null,
    strokeWidthMm ?? null,
    strokeTransform ?? null,
  ]);
}

function commonObjectMetadata(
  objects: ReadonlyArray<VectorSceneObject>,
): Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'> {
  const first = objects[0];
  if (first === undefined) return {};
  if (objects.slice(1).some((object) => !objectMetadataEqual(first, object))) return {};
  return {
    ...(first.locked === undefined ? {} : { locked: first.locked }),
    ...(first.operationOverride === undefined
      ? {}
      : { operationOverride: first.operationOverride }),
    ...(first.powerScale === undefined ? {} : { powerScale: first.powerScale }),
  };
}

function objectMetadataEqual(left: VectorSceneObject, right: VectorSceneObject): boolean {
  return (
    left.locked === right.locked &&
    Object.is(left.powerScale, right.powerScale) &&
    operationOverrideEqual(left.operationOverride, right.operationOverride)
  );
}

function operationOverrideEqual(
  left: ImportedSvg['operationOverride'],
  right: ImportedSvg['operationOverride'],
): boolean {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right ?? {}).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      if (key !== rightKeys[index]) return false;
      return Object.is(left?.[key as keyof typeof left], right?.[key as keyof typeof right]);
    })
  );
}
