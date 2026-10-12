import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene/scene-object';
import { sceneObjectUsesOperation } from '../../core/scene/operation-binding';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const SQUARE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'square',
  source: 'square.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50 },
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

beforeEach(resetStore);

describe('Generate Path From Cut', () => {
  it('adds the burned outline as unbound artwork at the same place, in one undo step', () => {
    const layer = createLayer({ id: 'cut', color: '#000000' });
    const project = {
      ...createProject(),
      scene: { objects: [SQUARE], layers: [layer], groups: [] },
    };
    useStore.setState({ project, selectedObjectId: 'square', additionalSelectedIds: new Set() });
    useStore.getState().generatePathFromCut();
    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(2);
    const generated = state.project.scene.objects[1] as ImportedSvg;
    expect(generated.operationIds).toEqual([]);
    expect(sceneObjectUsesOperation(generated, layer)).toBe(false);
    const xs = generated.paths.flatMap((path) =>
      path.polylines.flatMap((p) => p.points.map((q) => q.x)),
    );
    const ys = generated.paths.flatMap((path) =>
      path.polylines.flatMap((p) => p.points.map((q) => q.y)),
    );
    expect(Math.min(...xs)).toBeCloseTo(50, 6);
    expect(Math.max(...xs)).toBeCloseTo(60, 6);
    expect(Math.min(...ys)).toBeCloseTo(50, 6);
    expect(Math.max(...ys)).toBeCloseTo(60, 6);
    expect(state.undoStack).toEqual([project]);
  });
});
