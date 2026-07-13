import type { PrintAndCutDesignTargets, Project } from '../../core/scene';
import { pushUndo } from './scene-mutations';

type State = { readonly project: Project; readonly undoStack: ReadonlyArray<Project> };

export type PrintCutProjectActions = {
  readonly setPrintAndCutTargets: (targets: PrintAndCutDesignTargets | null) => void;
};

export function printCutProjectActions(
  set: (
    mutate: (
      state: State,
    ) => Partial<State> & { readonly dirty?: boolean; readonly redoStack?: readonly Project[] },
  ) => void,
): PrintCutProjectActions {
  return {
    setPrintAndCutTargets: (targets) =>
      set((state) => {
        const project =
          targets === null
            ? withoutPrintAndCutTargets(state.project)
            : { ...state.project, printAndCutTargets: targets };
        return {
          project,
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function withoutPrintAndCutTargets(project: Project): Project {
  const { printAndCutTargets: _targets, ...rest } = project;
  return rest;
}
