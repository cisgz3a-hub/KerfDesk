import { useMemo, useState } from 'react';
import {
  DEFAULT_PROJECT_VARIABLE_DATA,
  type Project,
  type ProjectVariableData,
} from '../../core/scene';
import { resolveVariableSequence } from '../../core/variables';
import { variableDataActions, type VariableDataActions } from '../state/variable-data-actions';

export type CanvasTextVariables = {
  readonly variables: ProjectVariableData;
  readonly changed: boolean;
  readonly setCsv: VariableDataActions['setVariableCsv'];
  readonly setSettings: VariableDataActions['setVariableSettings'];
  readonly advance: () => void;
  readonly retreat: () => void;
  readonly reset: () => void;
};

/** Uses the normal variable reducers against a local draft, never the project store. */
export function useCanvasTextVariables(project: Project): CanvasTextVariables {
  const [draft, setDraft] = useState<ProjectVariableData | null>(null);
  const original = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  const variables = draft ?? original;
  const changed = useMemo(
    () => variables !== original && variableDataKey(variables) !== variableDataKey(original),
    [variables, original],
  );
  const actions = variableDataActions((mutate) => {
    setDraft((current) => {
      const snapshot = { ...project, variables: current ?? original };
      // The reducers also return history updates for their store caller. This
      // editor keeps only their variable result until its owning save commits.
      return mutate({ project: snapshot, undoStack: [] }).project?.variables ?? current ?? original;
    });
  });
  return {
    variables,
    changed,
    setCsv: actions.setVariableCsv,
    setSettings: actions.setVariableSettings,
    advance: actions.advanceVariablesManually,
    retreat: actions.retreatVariablesManually,
    reset: actions.resetVariablesManually,
  };
}

function variableDataKey(variables: ProjectVariableData): string {
  return JSON.stringify({
    csv: variables.csv,
    recordIndex: variables.recordIndex,
    serialValue: variables.serialValue,
    advancement: variables.advancement,
    sequence: resolveVariableSequence(variables),
  });
}
