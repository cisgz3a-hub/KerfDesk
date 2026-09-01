import { describe, expect, it } from 'vitest';
import {
  combinedBBox,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import { applyArraySelection } from './array-actions';
import type { AppState } from './store';

function object(id: string, x: number): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x },
    color: '#000000',
    paths: [],
  };
}

function state(): AppState {
  const project = {
    ...createProject(),
    scene: {
      objects: [object('A', 0), object('B', 15)],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [{ id: 'G', name: 'Pair', objectIds: ['A', 'B'] }],
    },
  };
  return {
    project,
    selectedObjectId: 'A',
    additionalSelectedIds: new Set(['B']),
    undoStack: [],
  } as unknown as AppState;
}

describe('arraySelection', () => {
  it('clones a grouped selection as one undoable grid operation', () => {
    let nextId = 0;
    const before = state();
    const result = applyArraySelection(
      before,
      { kind: 'grid', rows: 1, columns: 2, spacingX: 5, spacingY: 0 },
      () => `new-${nextId++}`,
    ) as AppState;
    expect(result.project.scene.objects).toHaveLength(4);
    expect(result.project.scene.objects[2]?.transform.x).toBe(30);
    expect(result.project.scene.objects[3]?.transform.x).toBe(45);
    expect(result.project.scene.groups).toHaveLength(2);
    expect(result.project.scene.groups?.[1]?.objectIds).toEqual(['new-0', 'new-1']);
    expect(result.undoStack).toEqual([before.project]);
    expect(result.additionalSelectedIds.size).toBe(3);
  });

  it('refuses arrays containing locked objects', () => {
    const before = state();
    const lockedProject = {
      ...before.project,
      scene: {
        ...before.project.scene,
        objects: before.project.scene.objects.map((item) =>
          item.id === 'B' ? { ...item, locked: true } : item,
        ),
      },
    };
    const locked = { ...before, project: lockedProject };
    expect(
      applyArraySelection(locked, {
        kind: 'grid',
        rows: 2,
        columns: 2,
        spacingX: 0,
        spacingY: 0,
      }),
    ).toBe(locked);
  });

  it('rotates a grouped selection rigidly around its combined center in one undo action', () => {
    let nextId = 0;
    const before = state();
    const result = applyArraySelection(
      before,
      { kind: 'point-rotation', count: 4, totalAngleDeg: 360 },
      () => `point-${nextId++}`,
    ) as AppState;

    expect(result.project.scene.objects).toHaveLength(8);
    expect(result.project.scene.groups).toHaveLength(4);
    expect(result.undoStack).toEqual([before.project]);
    expect(result.redoStack).toEqual([]);
    expect(result.additionalSelectedIds.size).toBe(7);
    expect(new Set(result.project.scene.objects.map((item) => item.id)).size).toBe(8);

    const firstRotatedCopy = result.project.scene.objects.slice(2, 4);
    const rotatedBounds = combinedBBox(firstRotatedCopy);
    expect(rotatedBounds).not.toBeNull();
    expect(((rotatedBounds?.minX ?? 0) + (rotatedBounds?.maxX ?? 0)) / 2).toBeCloseTo(12.5);
    expect(((rotatedBounds?.minY ?? 0) + (rotatedBounds?.maxY ?? 0)) / 2).toBeCloseTo(2.5);
    expect(firstRotatedCopy.map((item) => item.transform.rotationDeg)).toEqual([90, 90]);
  });

  it('composes point rotation with the source rotation', () => {
    const before = state();
    const rotated = {
      ...before,
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects: before.project.scene.objects.map((item) =>
            item.id === 'A' ? { ...item, transform: { ...item.transform, rotationDeg: 30 } } : item,
          ),
        },
      },
    };
    const result = applyArraySelection(
      rotated,
      { kind: 'point-rotation', count: 2, totalAngleDeg: 180 },
      () => 'rotated-copy',
    ) as AppState;

    expect(result.project.scene.objects[0]?.transform.rotationDeg).toBe(30);
    expect(result.project.scene.objects[2]?.transform.rotationDeg).toBe(120);
  });

  it('copies and remaps every hop in a selected dependency chain', () => {
    let nextId = 0;
    const before = state();
    const chained = {
      ...before,
      selectedObjectId: 'text-a',
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects: [
            object('guide-c', 0),
            dependentText('text-b', 'guide-c'),
            dependentText('text-a', 'text-b'),
          ],
        },
      },
    };

    const result = applyArraySelection(
      chained,
      { kind: 'grid', rows: 1, columns: 2, spacingX: 5, spacingY: 0 },
      () => `copy-${nextId++}`,
    ) as AppState;
    const copiedRootId = [...result.additionalSelectedIds][0];
    const copiedRoot = result.project.scene.objects.find((item) => item.id === copiedRootId);
    if (copiedRoot?.kind !== 'text') throw new Error('copied root text missing');
    const copiedMiddle = result.project.scene.objects.find(
      (item) => item.id === copiedRoot.pathText?.guideObjectId,
    );
    if (copiedMiddle?.kind !== 'text') throw new Error('copied middle text missing');

    expect(copiedMiddle.pathText?.guideObjectId).toBe('copy-0');
    expect(result.project.scene.objects.some((item) => item.id === 'copy-0')).toBe(true);
    expect([...result.additionalSelectedIds]).toEqual([copiedRoot.id]);
  });

  it('preserves a shared dependency cycle by selecting a placed clone', () => {
    let nextId = 0;
    const before = state();
    const root = dependentText('root', 'middle');
    const middle = dependentText('middle', root.id);
    const outside = {
      ...dependentText('outside', middle.id),
      transform: { ...IDENTITY_TRANSFORM, x: 30 },
    };
    const cyclic = {
      ...before,
      selectedObjectId: root.id,
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: { ...before.project.scene, objects: [root, middle, outside] },
      },
    };

    const result = applyArraySelection(
      cyclic,
      {
        kind: 'circular',
        count: 1,
        centerX: 100,
        centerY: 100,
        radius: 0,
        startAngleDeg: 0,
        rotateCopies: false,
      },
      () => `copy-${nextId++}`,
    ) as AppState;

    const originalRoot = result.project.scene.objects.find((item) => item.id === root.id);
    const originalMiddle = result.project.scene.objects.find((item) => item.id === middle.id);
    const selectedClone = result.project.scene.objects.find(
      (item) => item.id === result.selectedObjectId,
    );
    expect(originalRoot?.transform).toEqual(root.transform);
    expect(originalMiddle?.transform).toEqual(middle.transform);
    expect(selectedClone?.kind).toBe('text');
    expect(selectedClone?.transform).toMatchObject({ x: 95, y: 97.5 });
    expect(selectedClone?.id).not.toBe(root.id);
  });

  it('clones a selected guide instead of moving it beneath unselected path text', () => {
    let nextId = 0;
    const before = state();
    const root = object('root', 0);
    const outside = {
      ...dependentText('outside', root.id),
      transform: { ...IDENTITY_TRANSFORM, x: 30 },
    };
    const owned = {
      ...before,
      selectedObjectId: root.id,
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: { ...before.project.scene, objects: [root, outside], groups: [] },
      },
    };

    const result = applyArraySelection(
      owned,
      {
        kind: 'circular',
        count: 1,
        centerX: 100,
        centerY: 100,
        radius: 0,
        startAngleDeg: 0,
        rotateCopies: false,
      },
      () => `copy-${nextId++}`,
    ) as AppState;

    expect(result.project.scene.objects.find((item) => item.id === root.id)).toEqual(root);
    expect(result.project.scene.objects.find((item) => item.id === outside.id)).toEqual(outside);
    expect(result.selectedObjectId).toBe('copy-0');
    expect(
      result.project.scene.objects.find((item) => item.id === 'copy-0')?.transform,
    ).toMatchObject({ x: 95, y: 97.5 });
  });

  it.each([270, -90])(
    'keeps a shared component byte-equivalent for circular start angle %d',
    (startAngleDeg) => {
      let idCalls = 0;
      const before = state();
      const guide = object('guide', 0);
      const root = dependentText('root', guide.id);
      const outside = {
        ...dependentText('outside', guide.id),
        transform: { ...IDENTITY_TRANSFORM, x: 30 },
      };
      const shared = {
        ...before,
        selectedObjectId: root.id,
        additionalSelectedIds: new Set<string>(),
        project: {
          ...before.project,
          scene: { ...before.project.scene, objects: [guide, root, outside], groups: [] },
        },
      };

      const result = applyArraySelection(
        shared,
        {
          kind: 'circular',
          count: 1,
          centerX: 5,
          centerY: 12.5,
          radius: 10,
          startAngleDeg,
          rotateCopies: true,
        },
        () => `copy-${idCalls++}`,
      ) as AppState;

      expect(result.project.scene.objects).toEqual(shared.project.scene.objects);
      expect(idCalls).toBe(0);
    },
  );

  it('does not clone a partial group through an unrelated referenced member', () => {
    let nextId = 0;
    const before = state();
    const root = dependentText('root', 'a');
    const a = dependentText('a', 'b');
    const b = object('b', 0);
    const unrelated = object('unrelated', 30);
    const outside = {
      ...dependentText('outside', unrelated.id),
      transform: { ...IDENTITY_TRANSFORM, x: 60 },
    };
    const group = { id: 'mixed-group', name: 'Mixed', objectIds: [a.id, b.id, unrelated.id] };
    const grouped = {
      ...before,
      selectedObjectId: root.id,
      additionalSelectedIds: new Set<string>(),
      project: {
        ...before.project,
        scene: {
          ...before.project.scene,
          objects: [root, a, b, unrelated, outside],
          groups: [group],
        },
      },
    };

    const result = applyArraySelection(
      grouped,
      {
        kind: 'circular',
        count: 1,
        centerX: 100,
        centerY: 100,
        radius: 0,
        startAngleDeg: 0,
        rotateCopies: false,
      },
      () => `copy-${nextId++}`,
    ) as AppState;

    expect(result.project.scene.groups).toEqual([group]);
  });
});

function dependentText(id: string, guideObjectId: string): TextObject {
  return {
    kind: 'text',
    id,
    content: id,
    fontKey: 'Roboto',
    sizeMm: 5,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    pathText: { guideObjectId, offsetMm: 0, reverse: false },
  };
}
