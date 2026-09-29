import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, DEFAULT_PROJECT_VARIABLE_DATA, type Project } from '../../core/scene';
import { useStore } from './store';
import { useToastStore } from './toast-store';
import { fixtureState } from './variable-array-test-fixture';

describe('variable data advancement', () => {
  beforeEach(() => {
    useStore.setState({ project: createProject(), undoStack: [], redoStack: [], dirty: false });
    useToastStore.setState({ toasts: [] });
  });

  it('advances CSV and serial after the configured successful export', () => {
    const project = {
      ...fixtureState().project,
      variables: {
        advancement: 'after-successful-export' as const,
        recordIndex: 0,
        serialValue: 41,
        csv: { sourceName: 'jobs.csv', headers: ['name'], records: [['A'], ['B']] },
      },
    };
    useStore.setState({ project });

    useStore.getState().advanceVariablesAfter(project, 'successful-export');

    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 42,
    });
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('does not advance for the wrong policy', () => {
    const project = streamProject();
    useStore.setState({ project });

    useStore.getState().advanceVariablesAfter(project, 'successful-export');

    expect(useStore.getState().project).toBe(project);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('advances the current project when only the design changed during the job', () => {
    const started = streamProject();
    const edited = { ...started, notes: 'next design prepared during the job' };
    useStore.setState({ project: edited });

    useStore.getState().advanceVariablesAfter(started, 'successful-stream');

    const current = useStore.getState().project;
    expect(current.notes).toBe('next design prepared during the job');
    expect(current.variables).toMatchObject({ recordIndex: 1, serialValue: 11 });
    expect(useStore.getState().undoStack).toEqual([edited]);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('skips the advance with a notice when the values changed during the job', () => {
    const started = streamProject();
    useStore.setState({ project: started });
    useStore.getState().advanceVariablesManually();
    const advancedByHand = useStore.getState().project;

    useStore.getState().advanceVariablesAfter(started, 'successful-stream');

    expect(useStore.getState().project).toBe(advancedByHand);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'warning',
        message: expect.stringContaining('were not advanced after this job'),
      }),
    ]);
  });

  it('embeds and clears CSV while manual advancement remains undoable', () => {
    const original = useStore.getState().project;
    useStore.getState().setVariableCsv({
      sourceName: 'parts.csv',
      headers: ['name'],
      records: [['A'], ['B']],
    });
    useStore.getState().setVariableSettings({ serialValue: 8, advancement: 'manual' });
    useStore.getState().advanceVariablesManually();
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 9,
      csv: { sourceName: 'parts.csv' },
    });
    expect(useStore.getState().undoStack[0]).toBe(original);

    useStore.getState().setVariableCsv(undefined);
    expect(useStore.getState().project.variables?.csv).toBeUndefined();
  });

  it('wraps automatic advancement and supports Previous and Reset', () => {
    const project = {
      ...fixtureState().project,
      variables: {
        advancement: 'after-successful-export' as const,
        recordIndex: 2,
        serialValue: 12,
        csv: { sourceName: 'jobs.csv', headers: ['name'], records: [['A'], ['B'], ['C']] },
        sequence: {
          recordStartIndex: 1,
          recordEndIndex: 2,
          serialStartValue: 10,
          serialEndValue: 12,
          advanceBy: 1,
        },
      },
    };
    useStore.setState({ project });

    useStore.getState().advanceVariablesAfter(project, 'successful-export');
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 10,
    });

    useStore.getState().retreatVariablesManually();
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 2,
      serialValue: 12,
    });

    useStore.getState().resetVariablesManually();
    expect(useStore.getState().project.variables).toMatchObject({
      recordIndex: 1,
      serialValue: 10,
    });
  });
});

function streamProject(): Project {
  const { project } = fixtureState();
  const variables = project.variables ?? DEFAULT_PROJECT_VARIABLE_DATA;
  return { ...project, variables: { ...variables, advancement: 'after-successful-stream' } };
}
