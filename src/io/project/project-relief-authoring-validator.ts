import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import { reliefAuthoringError } from '../../core/relief/relief-authoring-validation';
import {
  materializeReliefAuthoring,
  unchangedImportedReliefField,
  type ReliefAuthoringMaterializationResult,
} from '../../core/relief/materialize-relief-authoring';
import { validateReliefHeightfield } from './project-relief-heightfield-validator';
import { isObject } from './project-shape-primitives';

export type ReliefAuthoringResolutions = Map<unknown, ReliefAuthoringDocument>;

/** Optional metadata never becomes a second CAM source; reject a stale baked field. */
export function validateReliefAuthoringObject(
  object: Record<string, unknown>,
  path: string,
  options: {
    readonly verifyComposition?: boolean;
    readonly resolvedDocuments?: ReliefAuthoringResolutions | undefined;
  } = {},
): string | null {
  const value = object['reliefAuthoring'];
  if (value === undefined) return null;
  const documentError = reliefAuthoringError(value);
  if (documentError !== null) return `invalid ${path}.reliefAuthoring: ${documentError}`;
  const document = value as ReliefAuthoringDocument;
  const source = object['reliefSource'];
  if (!isObject(source) || source['kind'] !== 'heightfield-v1')
    return `invalid ${path}.reliefAuthoring: editable intent requires a canonical heightfield`;
  const bindingError = retainedSourceAndBindingError(document, source as ReliefHeightfield, path);
  if (bindingError !== null) return bindingError;
  if (options.verifyComposition === false)
    return trustedMappingError(document, source as ReliefHeightfield, path);
  const expected = materializeReliefAuthoring(document);
  if (expected.kind === 'ok' && reliefFieldsEquivalent(expected.field, source as ReliefHeightfield))
    return null;
  if (
    resolveUnversionedComposition(
      object,
      document,
      source as ReliefHeightfield,
      options.resolvedDocuments,
    )
  )
    return null;
  return `invalid ${path}.reliefAuthoring: ${compositionMismatchReason(expected)}`;
}

function compositionMismatchReason(result: ReliefAuthoringMaterializationResult): string {
  if (result.kind === 'error') return result.reason;
  if (result.kind === 'cancelled') return 'composition cancelled';
  return 'materialised field does not match retained intent';
}

function resolveUnversionedComposition(
  owner: Record<string, unknown>,
  document: ReliefAuthoringDocument,
  source: ReliefHeightfield,
  resolvedDocuments?: ReliefAuthoringResolutions,
): boolean {
  // #1109 changed composition without changing the v1 marker. Resolve only by
  // an exact field proof, with each interpretation subject to its own work cap.
  if (document.algorithmRevision !== 'retained-relief-v1') return false;
  const current: ReliefAuthoringDocument = { ...document, algorithmRevision: 'retained-relief-v2' };
  const recomposed = materializeReliefAuthoring(current);
  if (recomposed.kind !== 'ok' || !reliefFieldsEquivalent(recomposed.field, source)) return false;
  resolvedDocuments?.set(owner, current);
  return true;
}

export function reliefFieldsEquivalent(a: ReliefHeightfield, b: ReliefHeightfield): boolean {
  return (
    a.digest === b.digest &&
    a.width === b.width &&
    a.height === b.height &&
    a.physicalWidthMm === b.physicalWidthMm &&
    a.physicalHeightMm === b.physicalHeightMm &&
    a.revision === b.revision &&
    JSON.stringify(a.mapping) === JSON.stringify(b.mapping)
  );
}

/** Resolve only the proven interpretation marker; preserve source bytes and floats. */
export function normalizeReliefAuthoringObject(
  object: Record<string, unknown>,
  resolvedDocument?: ReliefAuthoringDocument,
): Record<string, unknown> {
  if (object['reliefAuthoring'] === undefined) return object;
  return {
    ...object,
    reliefAuthoring: resolvedDocument ?? object['reliefAuthoring'],
  };
}

function canonicalAuthoringMapping(
  document: ReliefAuthoringDocument,
): ReliefHeightfield['mapping'] {
  return {
    polarity: 'light-is-high',
    inputLowCode: 0,
    inputHighCode: 65535,
    curve: { kind: 'gamma-v1', gamma: 1 },
    maxDepthMm: document.maxDepthMm,
    crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
    aspect: 'stretch',
    inclusionThreshold: 255,
    outsideMask: document.outsideMask,
  };
}

function retainedSourceAndBindingError(
  document: ReliefAuthoringDocument,
  source: ReliefHeightfield,
  path: string,
): string | null {
  for (const [index, component] of document.components.entries()) {
    if (component.source.kind !== 'retained-field-v1') continue;
    const error = validateReliefHeightfield(
      component.source.field,
      `${path}.reliefAuthoring.components[${index}].source.field`,
    );
    if (error !== null) return error;
  }
  const ownFieldError = validateReliefHeightfield(source, `${path}.reliefSource`);
  if (ownFieldError !== null) return ownFieldError;
  if (document.revision !== source.revision)
    return `invalid ${path}.reliefAuthoring: field revision is stale`;
  const matches = [
    document.width === source.width,
    document.height === source.height,
    document.physicalWidthMm === source.physicalWidthMm,
    document.physicalHeightMm === source.physicalHeightMm,
    document.maxDepthMm === source.mapping.maxDepthMm,
  ];
  return matches.every(Boolean)
    ? null
    : `invalid ${path}.reliefAuthoring: physical field binding is stale`;
}
function trustedMappingError(
  document: ReliefAuthoringDocument,
  source: ReliefHeightfield,
  path: string,
): string | null {
  const mapping =
    unchangedImportedReliefField(document)?.mapping ?? canonicalAuthoringMapping(document);
  return JSON.stringify(mapping) === JSON.stringify(source.mapping)
    ? null
    : `invalid ${path}.reliefAuthoring: field mapping differs from retained intent`;
}
