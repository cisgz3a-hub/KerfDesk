// Guidelines dragged out of the rulers (LightBurn guides). A ruler drag
// edits the guides live inside the drag's interaction snapshot, so creating,
// moving or deleting one guide is a single undo step. Guides never reach output.

import type { ProjectGuide } from '../../core/scene/guides';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type GuideActions = {
  /** Live edit during a guide drag; the drag's interaction owns the history. */
  readonly setGuidesDuringInteraction: (guides: ReadonlyArray<ProjectGuide>) => void;
  readonly clearGuides: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function guideActions(set: Setter): GuideActions {
  return {
    setGuidesDuringInteraction: (guides) =>
      set((state) => ({ project: withGuides(state.project, guides), dirty: true })),
    clearGuides: () =>
      set((state) =>
        (state.project.guides ?? []).length === 0
          ? state
          : {
              project: withGuides(state.project, []),
              undoStack: pushUndo(state.project, state.undoStack),
              redoStack: [],
              dirty: true,
            },
      ),
  };
}

function withGuides(project: AppState['project'], guides: ReadonlyArray<ProjectGuide>) {
  if (guides.length > 0) return { ...project, guides };
  const { guides: _removed, ...rest } = project;
  return rest;
}
