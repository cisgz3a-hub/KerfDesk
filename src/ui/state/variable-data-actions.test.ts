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
});
