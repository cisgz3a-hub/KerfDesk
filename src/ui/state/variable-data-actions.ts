import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Project,
  type VariableAdvancementPolicy,
  type VariableCsvDataset,
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
type VariablePatch = Omit<Partial<NonNullable<Project['variables']>>, 'csv'> & {
  readonly csv?: VariableCsvDataset | undefined;
};

export type VariableDataActions = {
  readonly setVariableCsv: (csv: VariableCsvDataset | undefined) => void;
  readonly setVariableSettings: (settings: {
    readonly recordIndex?: number;
    readonly serialValue?: number;
    readonly advancement?: VariableAdvancementPolicy;
  }) => void;
  readonly advanceVariablesManually: () => void;
  readonly advanceVariablesAfter: (
    expectedProject: Project,
    trigger: VariableAdvanceTrigger,
  ) => void;
};

export function variableDataActions(
  set: (mutate: (state: VariableDataState) => VariableDataMutation) => void,
): VariableDataActions {
  return {
    setVariableCsv: (csv) => set((state) => variableMutation(state, { csv, recordIndex: 0 })),
    setVariableSettings: (settings) => set((state) => variableMutation(state, settings)),
    advanceVariablesManually: () =>
      set((state) => {
        const variables = state.project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
        return variableMutation(state, {
          recordIndex: variables.recordIndex + (variables.csv === undefined ? 0 : 1),
          serialValue: variables.serialValue + 1,
        });
      }),
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

function variableMutation(state: VariableDataState, patch: VariablePatch): VariableDataMutation {
  const variables = state.project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const { csv: previousCsv, ...withoutCsv } = variables;
  const { csv: patchCsv, ...otherPatch } = patch;
  const next =
    'csv' in patch
      ? patchCsv === undefined
        ? { ...withoutCsv, ...otherPatch }
        : { ...variables, ...otherPatch, csv: patchCsv }
      : previousCsv === undefined
        ? { ...withoutCsv, ...otherPatch }
        : { ...variables, ...otherPatch };
  return {
    project: { ...state.project, variables: next },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
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
