import { describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
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
});
