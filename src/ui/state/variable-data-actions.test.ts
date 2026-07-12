import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from './store';

describe('variable data advancement', () => {
  beforeEach(() => {
    useStore.setState({ project: createProject(), undoStack: [], redoStack: [], dirty: false });
  });

  it('advances CSV and serial after the configured successful export', () => {
    const project = {
      ...createProject(),
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

  it('does not advance for the wrong policy or a stale async project', () => {
    const project = {
      ...createProject(),
      variables: {
        advancement: 'after-successful-stream' as const,
        recordIndex: 2,
        serialValue: 9,
      },
    };
    useStore.setState({ project });
    useStore.getState().advanceVariablesAfter(project, 'successful-export');
    expect(useStore.getState().project).toBe(project);

    const edited = { ...project, notes: 'edited while exporting' };
    useStore.setState({ project: edited });
    useStore.getState().advanceVariablesAfter(project, 'successful-stream');
    expect(useStore.getState().project).toBe(edited);
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
      ...createProject(),
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
