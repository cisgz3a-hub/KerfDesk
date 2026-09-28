// Grid mirrors and a circle centred on a selected object, through the store
// action that Create array runs (LightBurn gap LBG-T13/T14).

import { describe, expect, it } from 'vitest';
import {
  combinedBBox,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { applyArraySelection, arraySelectionIds, placedObject } from './array-actions';
import type { AppState } from './store';

function rect(id: string, x: number, y = 0, rotationDeg = 0): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: { ...IDENTITY_TRANSFORM, x, y, rotationDeg },
    color: '#000000',
    paths: [],
  };
}

function state(objects: ReadonlyArray<SceneObject>, selected: ReadonlyArray<string>): AppState {
  return {
    project: {
      ...createProject(),
      scene: {
        objects,
        layers: [createLayer({ id: '#000000', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
  } as unknown as AppState;
}

function ids(): () => string {
  let next = 0;
  return () => `copy-${next++}`;
}

function boxOf(object: SceneObject | undefined) {
  if (object === undefined) throw new Error('missing object');
  return combinedBBox([object]);
}

describe('grid mirror alternate', () => {
  it('mirrors every other column in place in its cell', () => {
    const before = state([rect('A', 0)], ['A']);
    const result = applyArraySelection(
      before,
      { kind: 'grid', rows: 1, columns: 3, spacingX: 2, spacingY: 0, mirrorColumns: 'vertical' },
      ids(),
    ) as AppState;
    const [original, second, third] = result.project.scene.objects;
    expect(original?.transform.mirrorY).toBe(false);
    expect(second?.transform.mirrorY).toBe(true);
    expect(third?.transform.mirrorY).toBe(false);
    expect(boxOf(second)).toEqual({ minX: 12, minY: 0, maxX: 22, maxY: 5 });
    expect(result.undoStack).toEqual([before.project]);
  });

  it('mirrors a multi-object design as one piece about its centre', () => {
    const before = state([rect('A', 0), rect('B', 15)], ['A', 'B']);
    const result = applyArraySelection(
      before,
      { kind: 'grid', rows: 1, columns: 2, spacingX: 5, spacingY: 0, mirrorColumns: 'horizontal' },
      ids(),
    ) as AppState;
    // The 25 mm design repeats 30 mm along; mirrored, A lands where B was.
    const [copyOfA, copyOfB] = result.project.scene.objects.slice(2);
    expect(boxOf(copyOfA)).toEqual({ minX: 45, minY: 0, maxX: 55, maxY: 5 });
    expect(boxOf(copyOfB)).toEqual({ minX: 30, minY: 0, maxX: 40, maxY: 5 });
  });

  it('keeps a rotated design inside its own box when mirrored both ways', () => {
    const source = rect('A', 3, 4, 30);
    const placed = placedObject(source, {
      dx: 50,
      dy: 0,
      rotationDeg: 0,
      mirror: { horizontal: true, vertical: true, center: centreOf(boxOf(source)) },
    });
    const before = boxOf(source);
    const after = boxOf(placed);
    expect(after?.minX).toBeCloseTo((before?.minX ?? 0) + 50, 6);
    expect(after?.maxY).toBeCloseTo(before?.maxY ?? 0, 6);
    expect(placed.transform).toMatchObject({ mirrorX: true, mirrorY: true, rotationDeg: 30 });
  });
});

describe('circular array centred on a selected object', () => {
  const hub = rect('hub', 45, 47.5);
  const part = rect('part', 65, 47.5);

  it('leaves the centre object where it is and copies only the rest', () => {
    const before = state([hub, part], ['hub', 'part']);
    const result = applyArraySelection(
      before,
      {
        kind: 'circular',
        count: 4,
        centerX: 50,
        centerY: 50,
        radius: 20,
        startAngleDeg: 0,
        rotateCopies: false,
        centerObjectId: 'hub',
      },
      ids(),
    ) as AppState;
    const objects = result.project.scene.objects;
    expect(objects).toHaveLength(5);
    expect(objects[0]).toBe(hub);
    expect(objects[1]?.transform).toEqual(part.transform);
    expect(objects.slice(2).map((object) => centreOf(boxOf(object)))).toEqual([
      { x: 50, y: 70 },
      { x: 30, y: 50 },
      { x: 50, y: 30 },
    ]);
    expect([result.selectedObjectId, ...result.additionalSelectedIds]).toEqual([
      'part',
      'copy-0',
      'copy-1',
      'copy-2',
    ]);
    expect(result.undoStack).toEqual([before.project]);
  });

  it('centres on a locked object, which is never copied', () => {
    const before = state([{ ...hub, locked: true }, part], ['hub', 'part']);
    const result = applyArraySelection(
      before,
      {
        kind: 'circular',
        count: 2,
        centerX: 50,
        centerY: 50,
        radius: 20,
        startAngleDeg: 0,
        rotateCopies: false,
        centerObjectId: 'hub',
      },
      ids(),
    ) as AppState;
    expect(result.project.scene.objects).toHaveLength(3);
  });

  it('copies the whole selection when the centre object is no longer selected', () => {
    const selection = { selectedObjectId: 'part', additionalSelectedIds: new Set<string>() };
    const spec = {
      kind: 'circular' as const,
      count: 2,
      centerX: 0,
      centerY: 0,
      radius: 1,
      startAngleDeg: 0,
      rotateCopies: false,
      centerObjectId: 'hub',
    };
    expect([...arraySelectionIds(selection, spec)]).toEqual(['part']);
    expect([
      ...arraySelectionIds(
        { selectedObjectId: 'hub', additionalSelectedIds: new Set(['part']) },
        { kind: 'grid', rows: 1, columns: 2, spacingX: 0, spacingY: 0 },
      ),
    ]).toEqual(['hub', 'part']);
  });
});

function centreOf(bounds: ReturnType<typeof combinedBBox>): { x: number; y: number } {
  if (bounds === null) throw new Error('no bounds');
  return {
    x: Math.round(((bounds.minX + bounds.maxX) / 2) * 1e9) / 1e9,
    y: Math.round(((bounds.minY + bounds.maxY) / 2) * 1e9) / 1e9,
  };
}
