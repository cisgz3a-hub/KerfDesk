import type { ArraySpec, Project } from '../../core/scene';
import type { ArrayMaterialization } from './array-actions';
import { regenerateRetainedArray } from './retained-array-regeneration';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';

type Set = (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => unknown;
export type RetainedArrayActions = {
  readonly regenerateArrayLayout: (
    id: string,
    spec: ArraySpec,
    materialized?: ArrayMaterialization,
    expectedProject?: Project,
    isCurrent?: () => boolean,
  ) => string | null;
  readonly expandArrayLayout: (id: string) => void;
};

export function retainedArrayActions(set: Set): RetainedArrayActions {
  return {
    regenerateArrayLayout: (id, spec, materialized, expectedProject, isCurrent) => {
      let reason: string | null = 'The document changed; review this array again.';
      const committed = set((state) => {
        if (isCurrent?.() === false) return {};
        if (expectedProject !== undefined && state.project !== expectedProject) return {};
        const layout = state.project.arrayLayouts?.find((entry) => entry.id === id);
        if (layout === undefined) return {};
        const result = regenerateRetainedArray(state, layout, spec, materialized);
        reason = result.ok ? null : result.reason;
        if (result.ok) {
          reason = visitWorkflowArchives(result.project);
          if (reason !== null) return {};
        }
        return result.ok
          ? {
              project: result.project,
              selectedObjectId: result.selectedIds[0] ?? null,
              additionalSelectedIds: new Set(result.selectedIds.slice(1)),
              undoStack: pushUndo(state.project, state.undoStack, 'Regenerate array'),
              redoStack: [],
              dirty: true,
            }
          : {};
      });
      return committed === false ? 'The array is waiting for its authoring tool approval.' : reason;
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
