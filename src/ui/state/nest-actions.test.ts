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
    const result = useStore.getState().quickNestSelection({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      method: 'fast',
    });
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

  it('discloses units that need conservative bounds in outline mode', () => {
    expect(
      useStore.getState().quickNestSelection({
        bin: 'workspace',
        padding: 2,
        allowRotation: true,
        method: 'outline',
      }),
    ).toEqual({ ok: true, packedUnits: 2, boundsFallbackUnits: 2 });
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
    const result = useStore.getState().quickNestSelection({
      bin: 'workspace',
      padding: 2,
      allowRotation: false,
      method: 'fast',
    });
    expect(result).toEqual({ ok: false, reason: '1 selected unit(s) do not fit.' });
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('uses closed outlines when bounding rectangles cannot fit the workspace', () => {
    const upper = triangle('upper', 0, [
      [0, 0],
      [40, 0],
      [0, 40],
    ]);
    const lower = triangle('lower', 40, [
      [40, 40],
      [40, 0],
      [0, 40],
    ]);
    const project = {
      ...createProject(),
      workspace: { width: 40, height: 40, units: 'mm' as const },
      scene: {
        objects: [upper, lower],
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    };
    useStore.setState({
      project,
      selectedObjectId: upper.id,
      additionalSelectedIds: new Set([lower.id]),
      undoStack: [],
      redoStack: [],
      dirty: false,
    });

    expect(
      useStore.getState().quickNestSelection({
        bin: 'workspace',
        padding: 0,
        allowRotation: false,
        method: 'outline',
      }),
    ).toEqual({ ok: true, packedUnits: 2 });
    const [nestedUpper, nestedLower] = useStore.getState().project.scene.objects;
    expect(nestedUpper?.transform.x).toBe(0);
    expect(nestedLower?.transform.x).toBe(0);
    expect(useStore.getState().undoStack).toEqual([project]);
  });
});

function triangle(
  id: string,
  x: number,
  vertices: ReadonlyArray<readonly [number, number]>,
): SceneObject {
  const points = vertices.map(([pointX, pointY]) => ({ x: pointX, y: pointY }));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: { ...IDENTITY_TRANSFORM, x },
    paths: [{ color: '#000000', polylines: [{ closed: true, points }] }],
  };
}
