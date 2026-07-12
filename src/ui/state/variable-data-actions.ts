import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Project,
  type VariableAdvancementPolicy,
} from '../../core/scene';
import { pushUndo } from './scene-mutations';

export type VariableAdvanceTrigger = 'successful-export' | 'successful-stream';

type VariableDataState = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
};

type VariableDataMutation = Partial<VariableDataState> & {
  readonly redoStack?: ReadonlyArray<Project>;
  readonly dirty?: boolean;
};

export type VariableDataActions = {
  readonly advanceVariablesAfter: (
    expectedProject: Project,
    trigger: VariableAdvanceTrigger,
  ) => void;
};

export function variableDataActions(
  set: (mutate: (state: VariableDataState) => VariableDataMutation) => void,
): VariableDataActions {
  return {
    advanceVariablesAfter: (expectedProject, trigger) =>
      set((state) => {
        if (state.project !== expectedProject) return {};
        const variables = state.project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
        if (!policyMatches(variables.advancement, trigger)) return {};
        return {
          project: {
            ...state.project,
            variables: {
              ...variables,
              recordIndex: variables.recordIndex + (variables.csv === undefined ? 0 : 1),
              serialValue: variables.serialValue + 1,
            },
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}

function policyMatches(
  policy: VariableAdvancementPolicy,
  trigger: VariableAdvanceTrigger,
): boolean {
  return (
    (policy === 'after-successful-export' && trigger === 'successful-export') ||
    (policy === 'after-successful-stream' && trigger === 'successful-stream')
  );
}
