import { isOwnedReliefComposition } from '../../core/relief/relief-authoring-composition-proof';
import type { AppState } from './store';
import type { HeightfieldReliefObject } from '../../core/scene/scene-object';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../../core/scene/scene-object';
import type { ReliefHeightfield } from '../../core/scene/relief/relief-heightfield';
import type { ReliefAuthoringDocument } from '../../core/scene/relief/relief-authoring';
import {
  reliefFieldsEquivalent,
  validateReliefAuthoringObject,
} from '../../io/project/project-relief-authoring-validator';
import { pushUndo } from './scene-mutations';

export type ReliefCommitOwnership = {
  readonly source: ReliefHeightfield;
  readonly documentEpoch: number;
};
export type ReliefAuthoringActions = {
  readonly commitReliefAuthoring: (
    id: string,
    expectedRevision: number | null,
    document: ReliefAuthoringDocument,
    source: ReliefHeightfield,
    ownership?: ReliefCommitOwnership,
  ) => boolean;
  readonly addEditableRelief: (
    source: ReliefHeightfield,
    document: ReliefAuthoringDocument,
  ) => boolean;
};
type Setter = (fn: (state: AppState) => Partial<AppState>) => void;

function currentTarget(
  state: AppState,
  id: string,
  ownership?: ReliefCommitOwnership,
): HeightfieldReliefObject | null {
  const object = state.project.scene.objects.find((item) => item.id === id);
  if (object?.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') return null;
  const target = object as HeightfieldReliefObject;
  if (
    target.targetWidthMm !== target.reliefSource.physicalWidthMm ||
    target.reliefDepthMm !== target.reliefSource.mapping.maxDepthMm
  )
    return null;
  if (
    ownership !== undefined &&
    (ownership.source !== target.reliefSource ||
      ownership.documentEpoch !== state.projectDocumentEpoch)
  )
    return null;
  return target;
}
function documentAcceptsTarget(
  target: HeightfieldReliefObject,
  expectedRevision: number | null,
  document: ReliefAuthoringDocument,
): boolean {
  if ((target.reliefAuthoring?.revision ?? null) !== expectedRevision) return false;
  if (expectedRevision !== null) return document.revision === expectedRevision + 1;
  const initial = document.components.find((component) => component.id === 'source-1')?.source;
  return (
    initial?.kind === 'retained-field-v1' &&
    reliefFieldsEquivalent(initial.field, target.reliefSource)
  );
}
function withReliefComposition(
  target: HeightfieldReliefObject,
  document: ReliefAuthoringDocument,
  source: ReliefHeightfield,
): HeightfieldReliefObject {
  return {
    ...target,
    reliefAuthoring: document,
    reliefSource: source,
    targetWidthMm: source.physicalWidthMm,
    reliefDepthMm: source.mapping.maxDepthMm,
    bounds: { minX: 0, minY: 0, maxX: source.physicalWidthMm, maxY: source.physicalHeightMm },
  };
}
function validComposition(
  object: HeightfieldReliefObject,
  document: ReliefAuthoringDocument,
  source: ReliefHeightfield,
): boolean {
  return (
    validateReliefAuthoringObject(object as unknown as Record<string, unknown>, 'relief', {
      verifyComposition: !isOwnedReliefComposition(document, source),
    }) === null
  );
}
function newEditableRelief(
  source: ReliefHeightfield,
  document: ReliefAuthoringDocument,
): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: crypto.randomUUID(),
    source: 'Editable relief',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    transform: IDENTITY_TRANSFORM,
    targetWidthMm: source.physicalWidthMm,
    reliefDepthMm: source.mapping.maxDepthMm,
    bounds: { minX: 0, minY: 0, maxX: source.physicalWidthMm, maxY: source.physicalHeightMm },
    reliefSource: source,
    reliefAuthoring: document,
  };
}
export function reliefAuthoringActions(set: Setter, get: () => AppState): ReliefAuthoringActions {
  return {
    commitReliefAuthoring: (id, expectedRevision, document, source, ownership) => {
      let applied = false;
      set((state) => {
        const target = currentTarget(state, id, ownership);
        if (target === null || !documentAcceptsTarget(target, expectedRevision, document))
          return {};
        const next = withReliefComposition(target, document, source);
        if (!validComposition(next, document, source)) return {};
        applied = true;
        return {
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) =>
                object.id === id ? next : object,
              ),
            },
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return applied;
    },
    addEditableRelief: (source, document) => {
      const object = newEditableRelief(source, document);
      if (!validComposition(object, document, source)) return false;
      get().importRasterImage(object);
      return get().project.scene.objects.some((item) => item.id === object.id);
    },
  };
}
