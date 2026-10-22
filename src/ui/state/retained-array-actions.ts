import type { ArraySpec, Project } from '../../core/scene';
import type { ArrayMaterialization } from './array-actions';
import { regenerateRetainedArray } from './retained-array-regeneration';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';

// The authoring guard returns false while an edit waits for Pro (ADR-592).
type Set = (
  patch: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  onCommitted?: () => void,
  isCurrent?: () => boolean,
) => unknown;
export type RetainedArrayActions = {
  /** Null once regenerated; `onCommitted` also runs when a regeneration held for Pro lands. */
  readonly regenerateArrayLayout: (
    id: string,
    spec: ArraySpec,
    materialized?: ArrayMaterialization,
    expectedProject?: Project,
    isCurrent?: () => boolean,
    onCommitted?: () => void,
  ) => string | null;
  readonly expandArrayLayout: (id: string) => void;
};

const STALE = 'The document changed; review this array again.';

function regeneratedArrayPatch(
  state: AppState,
  id: string,
  spec: ArraySpec,
  materialized: ArrayMaterialization | undefined,
): { readonly patch: Partial<AppState>; readonly reason: string | null } {
  const layout = state.project.arrayLayouts?.find((entry) => entry.id === id);
  if (layout === undefined) return { patch: {}, reason: STALE };
  const result = regenerateRetainedArray(state, layout, spec, materialized);
  if (!result.ok) return { patch: {}, reason: result.reason };
  const archiveReason = visitWorkflowArchives(result.project);
  if (archiveReason !== null) return { patch: {}, reason: archiveReason };
  return {
    patch: {
      project: result.project,
      selectedObjectId: result.selectedIds[0] ?? null,
      additionalSelectedIds: new Set(result.selectedIds.slice(1)),
      undoStack: pushUndo(state.project, state.undoStack, 'Regenerate array'),
      redoStack: [],
      dirty: true,
    },
    reason: null,
  };
}

export function retainedArrayActions(set: Set): RetainedArrayActions {
  return {
    regenerateArrayLayout: (id, spec, materialized, expectedProject, isCurrent, onCommitted) => {
      let reason: string | null = STALE;
      const committed = set(
        (state) => {
          if (isCurrent?.() === false) return {};
          if (expectedProject !== undefined && state.project !== expectedProject) return {};
          const regenerated = regeneratedArrayPatch(state, id, spec, materialized);
          reason = regenerated.reason;
          return regenerated.patch;
        },
        () => {
          if (reason === null) onCommitted?.();
        },
        // A regeneration held for Pro applies only while its editor still owns it.
        isCurrent,
      );
      if (committed !== false) return reason;
      return isCurrent?.() === false
        ? STALE
        : 'The array is waiting for its authoring tool approval.';
    },
    expandArrayLayout: (id) =>
      set((state) => {
        if (!state.project.arrayLayouts?.some((layout) => layout.id === id)) return {};
        return {
          project: {
            ...state.project,
            arrayLayouts: state.project.arrayLayouts.filter((layout) => layout.id !== id),
          },
          undoStack: pushUndo(state.project, state.undoStack, 'Expand array'),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
