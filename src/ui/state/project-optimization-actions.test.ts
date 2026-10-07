import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore as reset } from './test-helpers';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../../core/scene';
import { serializeProject } from '../../io/project/serialize-project';

describe('project optimization actions', () => {
  beforeEach(() => {
    reset();
  });

  it('setProjectOptimization updates reduce travel, marks dirty, and is undoable', () => {
    useStore.setState({ dirty: false });

    useStore.getState().setProjectOptimization({ reduceTravelMoves: false });

    expect(useStore.getState().project.optimization.reduceTravelMoves).toBe(false);
    expect(useStore.getState().project.optimization.travelPolicy).toBe('source-order');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(useStore.getState().project.optimization.reduceTravelMoves).toBe(true);
  });

  it('keeps the legacy reduce-travel flag synchronized with the typed policy', () => {
    useStore.getState().setProjectOptimization({ travelPolicy: 'source-order' });

    expect(useStore.getState().project.optimization).toMatchObject({
      travelPolicy: 'source-order',
      reduceTravelMoves: false,
    });
  });

  it('sets and clears the Line preference without changing saved legacy planner settings', () => {
    useStore.getState().setProjectOptimization({
      travelPolicy: 'source-order',
      startPoint: 'job-center',
      closedShapeStart: 'nearest-corner',
      insideFirst: false,
      pathDirection: 'preserve',
    });
    const before = useStore.getState().project;
    const bytes = serializeProject(before);
    useStore.getState().setProjectOptimization({ lineStartRegion: 'back-right' });
    expect(useStore.getState().project.optimization).toEqual({
      ...before.optimization,
      lineStartRegion: 'back-right',
    });
    useStore.getState().undo();
    expect(useStore.getState().project.optimization).toEqual(before.optimization);
    useStore.getState().setProjectOptimization({ lineStartRegion: 'center' });
    useStore.getState().setProjectOptimization({ lineStartRegion: undefined });
    expect('lineStartRegion' in useStore.getState().project.optimization).toBe(false);
    expect(serializeProject(useStore.getState().project)).toBe(bytes);
  });

  it('resets the Line preference for a new canvas while retaining machine configuration', () => {
    const old = useStore.getState().project;
    const device = {
      ...old.device,
      name: 'My saved laser',
      origin: 'rear-right' as const,
      bedWidth: 650,
    };
    useStore.setState({ project: { ...old, device } });
    useStore
      .getState()
      .setProjectOptimization({ lineStartRegion: 'center', startPoint: 'job-center' });
    useStore.getState().newProject();
    const fresh = useStore.getState().project;
    expect(fresh.device).toEqual(device);
    expect(fresh.optimization).toEqual(DEFAULT_PROJECT_OPTIMIZATION);
    expect('lineStartRegion' in fresh.optimization).toBe(false);
  });
});
