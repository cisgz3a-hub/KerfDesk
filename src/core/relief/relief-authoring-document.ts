import type { ReliefHeightfield } from '../scene/relief/relief-heightfield';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
  ReliefSculptStroke,
} from '../scene/relief/relief-authoring';
import { IDENTITY_TRANSFORM } from '../scene/scene-object';

/** Attach without converting source samples, mask or tone mapping. */
export function createReliefAuthoringDocument(field: ReliefHeightfield): ReliefAuthoringDocument {
  return {
    schemaVersion: 1,
    algorithmRevision: 'retained-relief-v1',
    revision: field.revision,
    width: field.width,
    height: field.height,
    physicalWidthMm: field.physicalWidthMm,
    physicalHeightMm: field.physicalHeightMm,
    maxDepthMm: field.mapping.maxDepthMm,
    baselineHeightMm: 0,
    outsideMask: field.mapping.outsideMask,
    levels: [{ id: 'level-1', name: 'Relief', visible: true }],
    components: [
      {
        id: 'source-1',
        name: field.provenance.sourceName,
        levelId: 'level-1',
        visible: true,
        combineMode: 'replace',
        transform: IDENTITY_TRANSFORM,
        baseHeightMm: 0,
        heightScale: 1,
        source: { kind: 'retained-field-v1', field },
      },
    ],
    strokes: [],
  };
}

export function reviseReliefDocument(
  document: ReliefAuthoringDocument,
  patch: Partial<Omit<ReliefAuthoringDocument, 'schemaVersion' | 'algorithmRevision' | 'revision'>>,
): ReliefAuthoringDocument {
  if (!Number.isSafeInteger(document.revision + 1))
    throw new RangeError('Relief revision exhausted.');
  return { ...document, ...patch, revision: document.revision + 1 };
}

export function appendReliefStroke(
  document: ReliefAuthoringDocument,
  stroke: ReliefSculptStroke,
): ReliefAuthoringDocument {
  return reviseReliefDocument(document, { strokes: [...document.strokes, stroke] });
}

/** Copy the exact resolved field into a reusable, detached component. */
export function bakeReliefComponent(
  field: ReliefHeightfield,
  id: string,
  levelId: string,
): ReliefComponent {
  return {
    id,
    name: 'Baked relief copy',
    levelId,
    visible: true,
    combineMode: 'replace',
    transform: IDENTITY_TRANSFORM,
    baseHeightMm: 0,
    heightScale: 1,
    source: { kind: 'retained-field-v1', field },
  };
}

export function detachedReliefDocument(field: ReliefHeightfield): ReliefAuthoringDocument {
  return createReliefAuthoringDocument(field);
}

export function createBlankReliefAuthoringDocument(input: {
  readonly width: number;
  readonly height: number;
  readonly physicalWidthMm: number;
  readonly physicalHeightMm: number;
  readonly maxDepthMm: number;
}): ReliefAuthoringDocument {
  return {
    ...input,
    schemaVersion: 1,
    algorithmRevision: 'retained-relief-v1',
    revision: 0,
    baselineHeightMm: 0,
    outsideMask: 'relief-floor',
    levels: [{ id: 'level-1', name: 'Relief', visible: true }],
    components: [],
    strokes: [],
  };
}
