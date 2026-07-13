import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type SceneObject,
} from '../../core/scene';
import { useStore } from './store';

function part(id: string, x: number, y: number, width = 20, height = 10): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: width, heightMm: height, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    color: '#000000',
    paths: [],
  };
}

describe('quickNestSelection', () => {
  beforeEach(() => {
    const project = {
      ...createProject(),
      workspace: { width: 100, height: 60, units: 'mm' as const },
      scene: {
        objects: [
          part('A', 70, 40, 25, 15),
          part('B', 50, 30, 20, 10),
          { ...part('lock', 0, 0, 35, 60), locked: true },
        ],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };
    useStore.setState({
      project,
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });
  });

  it('packs unlocked selection around locked obstacles as one undo step', () => {
    const before = useStore.getState().project;
    const result = useStore
      .getState()
      .quickNestSelection({ bin: 'workspace', padding: 2, allowRotation: true });
    expect(result).toEqual({ ok: true, packedUnits: 2 });
    const state = useStore.getState();
    const a = state.project.scene.objects.find((object) => object.id === 'A')!;
    const b = state.project.scene.objects.find((object) => object.id === 'B')!;
    expect(transformedBBox(a).minX).toBeGreaterThanOrEqual(36);
    expect(transformedBBox(b).minX).toBeGreaterThanOrEqual(36);
    expect(state.project.scene.objects.find((object) => object.id === 'lock')).toBe(
      before.scene.objects[2],
    );
    expect(state.undoStack).toEqual([before]);
  });

  it('keeps a selected group rigid and refuses bins that cannot fit it', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === 'B' ? { ...object, transform: { ...object.transform, x: 10 } } : object,
          ),
          groups: [{ id: 'pair', name: 'Pair', objectIds: ['A', 'B'] }],
        },
      },
    }));
    const result = useStore
      .getState()
      .quickNestSelection({ bin: 'workspace', padding: 2, allowRotation: false });
    expect(result).toEqual({ ok: false, reason: '1 selected unit(s) do not fit.' });
    expect(useStore.getState().undoStack).toEqual([]);
  });
});
