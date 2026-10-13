import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { writeStartPointDefaults } from './start-point-defaults';
import { useStore } from './store';
import { initialState } from './store-initial-state';
import { resetStore } from './test-helpers';

describe('project start point actions', () => {
  beforeEach(() => {
    resetStore();
    writeStartPointDefaults({});
  });
  afterEach(() => {
    writeStartPointDefaults({});
  });

  it('commits both selections once, supports Undo and Redo, and ignores no-op updates', () => {
    const points = { frame: { edge: 1 as const, fraction: 0.5 }, job: { x: 14, y: 28 } };
    useStore.getState().setProjectStartPoints(points);
    expect(useStore.getState().project.startPoints).toEqual(points);
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().setProjectStartPoints(points);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.startPoints).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().project.startPoints).toEqual(points);
    useStore.getState().setProjectStartPoints({});
    expect(useStore.getState().project).not.toHaveProperty('startPoints');
    useStore.getState().undo();
    expect(useStore.getState().project.startPoints).toEqual(points);
  });

  it('applies defaults on New and never on Open, including legacy blank projects', () => {
    const defaults = {
      frame: { edge: 3 as const, fraction: 1 },
      job: { x: 0, y: 1, relative: true as const },
    };
    expect(writeStartPointDefaults(defaults)).toBe(true);
    useStore.getState().newProject();
    expect(useStore.getState().project.startPoints).toEqual(defaults);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().setProject(createProject());
    expect(useStore.getState().project).not.toHaveProperty('startPoints');
    useStore.getState().setProject({ ...createProject(), startPoints: { job: { x: 40, y: 55 } } });
    expect(useStore.getState().project.startPoints).toEqual({ job: { x: 40, y: 55 } });
  });

  it('applies defaults to initial blank startup but not an explicitly restored document', () => {
    const defaults = { frame: { edge: 1 as const, fraction: 0.5 } };
    expect(writeStartPointDefaults(defaults)).toBe(true);
    expect(initialState().project.startPoints).toEqual(defaults);
    expect(initialState(createProject()).project.startPoints).toBeUndefined();
  });
});
