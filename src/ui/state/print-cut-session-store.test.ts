import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from './store';
import { resolvePrintCutRegistration, usePrintCutSessionStore } from './print-cut-session-store';

const project = {
  ...createProject(),
  printAndCutTargets: { first: { x: 0, y: 0 }, second: { x: 10, y: 0 } },
};

describe('print-and-cut session trust', () => {
  beforeEach(() => usePrintCutSessionStore.getState().clear());

  it('requires both captures from the current position epoch', () => {
    const session = usePrintCutSessionStore.getState();
    session.capture('first', { x: 100, y: 50 }, 3);
    session.capture('second', { x: 120, y: 50 }, 3);
    expect(resolvePrintCutRegistration(project, 3, usePrintCutSessionStore.getState()).kind).toBe(
      'valid',
    );
    expect(resolvePrintCutRegistration(project, 4, usePrintCutSessionStore.getState())).toEqual({
      kind: 'invalid',
      reason: 'Machine position trust changed. Capture both points again.',
    });
  });

  it('stores and removes design targets as undoable project edits', () => {
    const initial = createProject();
    useStore.setState({ project: initial, undoStack: [], redoStack: [], dirty: false });
    useStore.getState().setPrintAndCutTargets(project.printAndCutTargets);
    expect(useStore.getState().project.printAndCutTargets).toEqual(project.printAndCutTargets);
    expect(useStore.getState().undoStack).toEqual([initial]);
    useStore.getState().setPrintAndCutTargets(null);
    expect(useStore.getState().project.printAndCutTargets).toBeUndefined();
  });
});
