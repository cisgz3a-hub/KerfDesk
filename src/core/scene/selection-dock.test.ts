import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { buildSelectionDockEdit, type DockOptions } from './selection-dock';

const BED = { width: 300, height: 200 };
const LEFT: DockOptions = { direction: 'left', paddingMm: 0, moveAsGroup: false, lockInner: false };

describe('buildSelectionDockEdit', () => {
  it('stops at the nearest object in the way, with padding, else at the bed edge', () => {
    const wall = box('wall', 20, 0, 10, 50);
    const blocked = box('blocked', 100, 10, 10, 10);
    const free = box('free', 100, 100, 10, 10);
    const edits = buildSelectionDockEdit([blocked, free], [wall], { ...LEFT, paddingMm: 2 }, BED);
    expect(edits).toEqual([
      { id: 'blocked', transform: { ...blocked.transform, x: 32 } },
      { id: 'free', transform: { ...free.transform, x: 2 } },
    ]);
  });

  it('packs a row of selected objects one after another against the wall', () => {
    const a = box('a', 50, 0, 10, 10);
    const b = box('b', 100, 0, 10, 10);
    const edits = buildSelectionDockEdit([b, a], [], LEFT, BED);
    expect(edits.map((edit) => [edit.id, edit.transform.x])).toEqual([
      ['a', 0],
      ['b', 10],
    ]);
  });

  it('docks past the inside of an enclosing frame and moves as a group when asked', () => {
    const frame = box('frame', 0, 0, 200, 200);
    const inside = box('inside', 100, 50, 10, 10);
    expect(buildSelectionDockEdit([inside], [frame], LEFT, BED)[0]?.transform.x).toBe(0);
    const a = box('a', 100, 0, 10, 10);
    const b = box('b', 150, 30, 10, 10);
    const grouped = buildSelectionDockEdit([a, b], [], { ...LEFT, moveAsGroup: true }, BED);
    expect(grouped.map((edit) => edit.transform.x)).toEqual([0, 50]);
  });

  it('keeps an inner selected object locked to its container', () => {
    const outer = box('outer', 100, 0, 50, 50);
    const inner = box('inner', 110, 10, 10, 10);
    const edits = buildSelectionDockEdit([outer, inner], [], { ...LEFT, lockInner: true }, BED);
    expect(edits.map((edit) => [edit.id, edit.transform.x])).toEqual([
      ['outer', 0],
      ['inner', 10],
    ]);
  });

  it('docks coincident selected objects together when inner objects are locked', () => {
    const a = box('a', 100, 0, 50, 50);
    const b = box('b', 100, 0, 50, 50);
    const inner = box('inner', 110, 10, 10, 10);
    for (const selected of [
      [a, b, inner],
      [inner, b, a],
    ]) {
      const edits = buildSelectionDockEdit(selected, [], { ...LEFT, lockInner: true }, BED);
      expect(edits).toHaveLength(3);
      expect(new Map(edits.map((edit) => [edit.id, edit.transform.x]))).toEqual(
        new Map([
          ['a', 0],
          ['b', 0],
          ['inner', 10],
        ]),
      );
    }
  });
});

function box(id: string, x: number, y: number, width: number, height: number): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: width, heightMm: height, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}
