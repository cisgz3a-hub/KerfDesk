import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

// Natural import bounds: 100 wide, 50 tall (mesh aspect 0.5).
function relief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 10, 0, 0, 0, 5, 5],
    targetWidthMm: 100,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 30 },
  };
}

function installReliefProject(): void {
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [relief()],
      layers: [createLayer({ id: DEFAULT_RELIEF_LAYER_COLOR, color: DEFAULT_RELIEF_LAYER_COLOR })],
    },
  };
  useStore.setState({ project, dirty: false, undoStack: [], redoStack: [] });
}

beforeEach(() => {
  resetStore();
  installReliefProject();
});

function storedRelief(): ReliefObject {
  const found = useStore.getState().project.scene.objects.find((o) => o.id === 'R1');
  if (found?.kind !== 'relief') throw new Error('relief missing');
  return found;
}

describe('setReliefParams', () => {
  it('updates depth and background, marks dirty, and pushes one undo entry', () => {
    useStore.getState().setReliefParams('R1', { reliefDepthMm: 8, emptyCells: 'top' });

    const updated = storedRelief();
    expect(updated.reliefDepthMm).toBe(8);
    expect(updated.emptyCells).toBe('top');
    expect(useStore.getState().dirty).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('rescales the natural bounds by the mesh aspect when width changes', () => {
    useStore.getState().setReliefParams('R1', { targetWidthMm: 200 });

    const updated = storedRelief();
    expect(updated.targetWidthMm).toBe(200);
    expect(updated.bounds).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
    // Placement is untouched — only the natural size changes.
    expect(updated.transform).toMatchObject({ x: 20, y: 30 });
  });

  it('clamps width and depth to their editor ranges', () => {
    useStore.getState().setReliefParams('R1', { targetWidthMm: 99999, reliefDepthMm: 0 });

    const updated = storedRelief();
    expect(updated.targetWidthMm).toBe(1500);
    expect(updated.reliefDepthMm).toBe(0.1);
  });

  it('is a no-op for unknown ids and non-relief objects', () => {
    const before = useStore.getState().project;
    useStore.getState().setReliefParams('nope', { reliefDepthMm: 9 });
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
