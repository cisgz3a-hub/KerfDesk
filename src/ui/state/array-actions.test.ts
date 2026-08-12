import { describe, expect, it } from 'vitest';
import {
  combinedBBox,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
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
});
