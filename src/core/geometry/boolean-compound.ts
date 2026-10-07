import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene/scene-object';
import {
  MAX_BOOLEAN_COMPOUND_OPERANDS,
  validateBooleanCompound,
  type BooleanCompound,
  type BooleanCompoundOperation,
} from '../scene/boolean-compound';
import { combineVectorObjects } from './vector-path-booleans';
import { weldVectorObjects } from './vector-path-weld';
import type { VectorOpError, VectorSceneObject } from './vector-path-tools';

/** Capture canonical source paths, without retaining live font/template/guide dependencies. */
export function captureBooleanCompound(
  operation: BooleanCompoundOperation,
  sources: ReadonlyArray<VectorSceneObject>,
): Result<BooleanCompound, VectorOpError> {
  if (sources.length < 2 || sources.length > MAX_BOOLEAN_COMPOUND_OPERANDS)
    return err({
      kind: 'too-few-objects',
      message: `A live compound needs 2 to ${MAX_BOOLEAN_COMPOUND_OPERANDS} source fragments.`,
    });
  if (
    sources.some((source) => source.kind === 'imported-svg' && source.booleanCompound !== undefined)
  )
    return err({
      kind: 'operation-failed',
      message: 'Expand an existing compound before combining it into another compound.',
    });
  return ok({
    operation,
    operands: sources.map((source, index) => ({
      sourceId: source.id,
      sourceKind: source.kind,
      object: {
        kind: 'imported-svg',
        id: `operand-${index + 1}`,
        source: sourceLabel(source),
        ...(source.name === undefined ? {} : { name: source.name }),
        ...(source.operationIds === undefined ? {} : { operationIds: source.operationIds }),
        ...(source.operationOverride === undefined
          ? {}
          : { operationOverride: source.operationOverride }),
        ...(source.powerScale === undefined ? {} : { powerScale: source.powerScale }),
        bounds: source.bounds,
        transform: source.transform,
        paths:
          source.kind === 'text'
            ? source.paths.map((path) => ({ ...path, fillRule: path.fillRule ?? 'nonzero' }))
            : source.paths,
      },
    })),
  });
}

/** Recompute derived geometry from retained sources. Cached result points are never authoritative. */
export function evaluateBooleanCompound(
  object: ImportedSvg,
  compound: BooleanCompound | undefined = object.booleanCompound,
): Result<ImportedSvg, VectorOpError> {
  if (compound === undefined || compound.operands.length < 2)
    return err({
      kind: 'too-few-objects',
      message: 'A compound needs at least two retained source fragments.',
    });
  const metadataError = validateBooleanCompound(compound, 'compound', () => null);
  if (metadataError !== null) return err({ kind: 'operation-failed', message: metadataError });
  if (
    object.booleanCompound !== undefined &&
    (object.booleanCompound.operation === 'weld') !== (compound.operation === 'weld')
  )
    return err({
      kind: 'operation-failed',
      message:
        'Expand and recreate the compound to change between Weld partitions and a single Boolean result operation.',
    });
  const sources = compound.operands.map((operand) => operand.object);
  const result =
    compound.operation === 'weld'
      ? weldVectorObjects(sources, object.id)
      : combineVectorObjects(sources, compound.operation, object.id);
  if (result.kind === 'error') return result;
  // The result owns process overrides, bindings, name and outer placement. A
  // source edit changes local geometry without allocating operations or replaying output.
  return ok({
    ...object,
    paths:
      compound.operation === 'weld'
        ? result.value.paths
        : result.value.paths.map((path) => ({
            ...path,
            color: object.paths[0]?.color ?? path.color,
            ...(object.paths[0]?.operationIds === undefined
              ? {}
              : { operationIds: object.paths[0].operationIds }),
          })),
    bounds: result.value.bounds,
    booleanCompound: compound,
  });
}

export function expandBooleanCompound(object: ImportedSvg): ImportedSvg {
  const { booleanCompound: _compound, ...expanded } = object;
  return expanded;
}

export function compoundPreviewObject(object: ImportedSvg): ImportedSvg {
  return { ...object, transform: IDENTITY_TRANSFORM };
}
function sourceLabel(source: VectorSceneObject): string {
  if (source.kind === 'text') return `Text outline: ${source.content}`;
  if (source.kind === 'shape') return `Shape outline: ${source.spec.kind}`;
  return source.source;
}

export function retainBooleanCompoundResult(
  object: ImportedSvg,
  operation: BooleanCompoundOperation,
  sources: ReadonlyArray<VectorSceneObject>,
  enabled: boolean,
): Result<ImportedSvg, VectorOpError> {
  if (!enabled) return ok(object);
  const compound = captureBooleanCompound(operation, sources);
  return compound.kind === 'error' ? compound : ok({ ...object, booleanCompound: compound.value });
}

/** Keep operation fragments in step with an explicit result binding edit. */
export function mapBooleanCompoundBindings(
  original: ImportedSvg,
  edited: ImportedSvg,
  map: (operand: ImportedSvg) => ImportedSvg,
): ImportedSvg {
  const compound = original.booleanCompound;
  if (compound?.operation !== 'weld') return edited;
  const next = {
    ...compound,
    operands: compound.operands.map((operand) => ({ ...operand, object: map(operand.object) })),
  };
  const result = evaluateBooleanCompound({ ...edited, booleanCompound: next });
  return result.kind === 'ok' ? result.value : original;
}
