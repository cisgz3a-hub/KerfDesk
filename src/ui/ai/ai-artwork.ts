import type { AiDraft, AiRequest } from '../../core/ai/assistant';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import type { AppState } from '../state/store';
import { pushUndo } from '../state/undo-stack';
import { validateSceneBudgets } from '../../io/project/project-scene-integrity-validator';
import { carriedSelectionReference } from '../state/selection-reference';

export type AiDocumentOwner = {
  readonly project: Project;
  readonly epoch: number;
};
export function aiOwnerIsCurrent(state: AppState, owner: AiDocumentOwner): boolean {
  return state.project === owner.project && state.projectDocumentEpoch === owner.epoch;
}
export function aiDraftArtwork(draft: AiDraft, request: AiRequest, id: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    name: draft.title,
    source: 'AI draft · reviewed geometry',
    bounds: { minX: 0, minY: 0, maxX: request.widthMm, maxY: request.heightMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        // Scene path colour, not UI chrome: normal new artwork starts in black.
        // eslint-disable-next-line no-restricted-syntax
        color: '#000000',
        polylines: draft.paths.map((path) => ({
          ...path,
          points: path.points.map((point) => ({ ...point })),
        })),
      },
    ],
  };
}
/** Normal artwork allocator and Undo; no generated operation settings are accepted. */
export function applyAiDraft(
  state: AppState,
  owner: AiDocumentOwner,
  object: ImportedSvg,
): Partial<AppState> {
  if (
    !aiOwnerIsCurrent(state, owner) ||
    state.project.scene.objects.some((item) => item.id === object.id)
  )
    return {};
  const created = createArtworkOperation(state.project.scene, object, {
    mode: 'line',
    name: object.name ?? 'AI draft',
  });
  const scene = addLayer(addObject(state.project.scene, created.object), created.operation);
  const budgetError = validateSceneBudgets(scene as unknown as Record<string, unknown>);
  if (budgetError !== null)
    throw new Error(
      `${budgetError}. Remove unused artwork/operations or use another sheet before adding this draft.`,
    );
  const selection = { selectedObjectId: object.id, additionalSelectedIds: new Set<string>() };
  return {
    project: {
      ...state.project,
      scene,
    },
    ...selection,
    selectedPathNode: null,
    selectedPathNodes: [],
    selectionReference: carriedSelectionReference(state, selection),
    dirty: true,
    undoStack: pushUndo(state.project, state.undoStack, 'Add reviewed AI design'),
    redoStack: [],
  };
}
