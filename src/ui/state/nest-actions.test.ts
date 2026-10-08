import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type SceneObject,
} from '../../core/scene';
import { useStore } from './store';
import { layoutNest } from '../../core/nesting/layout-nest';

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
  it('keeps overlapping legacy groups in one rigid connected unit', () => {
    const state = useStore.getState();
    const objects = [
      part('A', 80, 40, 10, 10),
      part('B', 95, 40, 10, 10),
      part('C', 110, 40, 10, 10),
    ];
    const project = {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects,
        groups: [
          { id: 'AB', name: 'AB', objectIds: ['A', 'B'] },
          { id: 'BC', name: 'BC', objectIds: ['B', 'C'] },
        ],
      },
    };
    useStore.setState({
      project,
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B', 'C']),
    });
    const draft = useStore.getState().prepareNestSelection({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      rotationAngles: [180],
      method: 'fast',
    });
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.units).toHaveLength(1);
    const layout = layoutNest(draft.input)!;
    expect(useStore.getState().acceptNestSelection(draft, layout).ok).toBe(true);
    const [a, b, c] = useStore.getState().project.scene.objects;
    expect(a!.transform.x - b!.transform.x).toBeCloseTo(15, 10);
    expect(b!.transform.x - c!.transform.x).toBeCloseTo(15, 10);
    expect(useStore.getState().project.scene.groups).toBe(project.scene.groups);
    expect(useStore.getState().undoStack).toEqual([project]);
  });
  it('does not split a partially selected/locked group and honours rotation off', () => {
    const state = useStore.getState();
    const project = {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: [part('A', 70, 40, 10, 10), part('B', 90, 40, 10, 10)],
        groups: [{ id: 'AB', name: 'AB', objectIds: ['A', 'B'] }],
      },
    };
    useStore.setState({ project, selectedObjectId: 'A', additionalSelectedIds: new Set() });
    const options = {
      bin: 'workspace' as const,
      padding: 2,
      allowRotation: false,
      rotationAngles: [180] as const,
      method: 'fast' as const,
    };
    expect(useStore.getState().prepareNestSelection(options).ok).toBe(false);
    expect(useStore.getState().project).toBe(project);
    useStore.setState({ additionalSelectedIds: new Set(['B']) });
    const draft = useStore.getState().prepareNestSelection(options);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.input.items[0]!.rotationAngles).toEqual([0]);
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

  it('leaves the scene untouched until a worker draft is accepted, and rejects a changed owner', () => {
    const original = useStore.getState().project;
    const draft = useStore.getState().prepareNestSelection({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      method: 'fast',
      goal: 'compact',
      optimise: true,
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const layout = layoutNest(draft.input)!;
    expect(useStore.getState().project).toBe(original);
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.setState({ project: { ...original, notes: 'Changed document' } });
    expect(useStore.getState().acceptNestSelection(draft, layout).ok).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('rejects forged overlapping placements before an undo or scene mutation', () => {
    const draft = useStore
      .getState()
      .prepareNestSelection({ bin: 'workspace', padding: 2, allowRotation: false, method: 'fast' });
    if (!draft.ok) throw new Error(draft.reason);
    const layout = layoutNest(draft.input)!;
    const original = useStore.getState().project;
    expect(
      useStore.getState().acceptNestSelection(draft, {
        ...layout,
        placements: layout.placements.map((placement) => ({ ...placement, x: 40, y: 20 })),
      }).ok,
    ).toBe(false);
    expect(useStore.getState().project).toBe(original);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('rotates a rigid group by an explicitly permitted half-turn without changing operations or relative distances', () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: [
            { ...part('A', 50, 30, 20, 10), operationIds: ['#000000'] },
            part('B', 75, 30, 10, 10),
          ],
          groups: [{ id: 'rigid', name: 'Rigid', objectIds: ['A', 'B'] }],
        },
      },
    }));
    const original = useStore.getState().project;
    const draft = useStore.getState().prepareNestSelection({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      rotationAngles: [180],
      keepGrain: true,
      method: 'fast',
      goal: 'compact',
    });
    if (!draft.ok) throw new Error(draft.reason);
    const layout = layoutNest(draft.input)!;
    expect(useStore.getState().acceptNestSelection(draft, layout).ok).toBe(true);
    const [a, b] = useStore.getState().project.scene.objects;
    if (a === undefined || b === undefined || !('paths' in a) || !('paths' in b))
      throw new Error('Expected vector parts');
    expect(a!.transform.rotationDeg).toBe(180);
    expect(b!.transform.rotationDeg).toBe(180);
    expect(a!.transform.x - b!.transform.x).toBe(25);
    expect(a!.transform.y - b!.transform.y).toBe(0);
    const [originalA, originalB] = original.scene.objects;
    if (
      originalA === undefined ||
      originalB === undefined ||
      !('paths' in originalA) ||
      !('paths' in originalB)
    )
      throw new Error('Expected original vector parts');
    expect(a.paths).toBe(originalA.paths);
    expect(b.paths).toBe(originalB.paths);
    expect(a!.operationIds).toBe(original.scene.objects[0]!.operationIds);
    expect(useStore.getState().project.scene.layers).toBe(original.scene.layers);
    expect(useStore.getState().project.scene.groups).toBe(original.scene.groups);
    expect(useStore.getState().undoStack).toEqual([original]);
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
