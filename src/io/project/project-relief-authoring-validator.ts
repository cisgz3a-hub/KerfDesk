import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import { reliefAuthoringError } from '../../core/relief/relief-authoring-validation';
import {
  materializeReliefAuthoring,
  unchangedImportedReliefField,
} from '../../core/relief/materialize-relief-authoring';
import { validateReliefHeightfield } from './project-relief-heightfield-validator';
import { isObject } from './project-shape-primitives';

/** Optional metadata never becomes a second CAM source; reject a stale baked field. */
export function validateReliefAuthoringObject(
  object: Record<string, unknown>,
  path: string,
  options: { readonly verifyComposition?: boolean } = {},
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
  if (expected.kind !== 'ok')
    return `invalid ${path}.reliefAuthoring: ${expected.kind === 'error' ? expected.reason : 'composition cancelled'}`;
  return reliefFieldsEquivalent(expected.field, source as ReliefHeightfield)
    ? null
    : `invalid ${path}.reliefAuthoring: materialised field does not match retained intent`;
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

/** Preserve all admitted floats/source bytes. No flattening or implicit migration. */
export function normalizeReliefAuthoringObject(
  object: Record<string, unknown>,
): Record<string, unknown> {
  if (object['reliefAuthoring'] === undefined) return object;
  return { ...object, reliefAuthoring: object['reliefAuthoring'] };
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
