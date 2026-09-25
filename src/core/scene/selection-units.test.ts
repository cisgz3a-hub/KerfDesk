import { describe, expect, it } from 'vitest';
import type { SceneGroup } from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';
import { selectionUnits } from './selection-units';

describe('selectionUnits', () => {
  it('keeps each ungrouped object as its own unit, in selection order', () => {
    const units = selectionUnits([box('b', 40, 0), box('a', 0, 0)], []);

    expect(units.map(unitIds)).toEqual([['b'], ['a']]);
    expect(units[0]?.box).toEqual({ minX: 40, minY: 0, maxX: 50, maxY: 10 });
  });

  it('joins the selected members of a group into one unit with their combined bounds', () => {
    const units = selectionUnits(
      [box('a', 10, 0), box('r', 60, 40), box('b', 30, 20)],
      [group('g', ['a', 'b'])],
    );

    expect(units.map(unitIds)).toEqual([['a', 'b'], ['r']]);
    expect(units[0]?.box).toEqual({ minX: 10, minY: 0, maxX: 40, maxY: 30 });
  });

  it('moves a nested group with the outermost group that shares its members', () => {
    const units = selectionUnits(
      [box('a', 0, 0), box('b', 20, 0), box('c', 40, 0), box('d', 80, 0)],
      [group('inner', ['a', 'b']), group('outer', ['b', 'c'])],
    );

    expect(units.map(unitIds)).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('leaves unselected members out of the unit while still joining the groups they share', () => {
    // 'locked' is not in the selection: it adds no bounds, but its two groups
    // are still one unit, as selecting either member selects both groups.
    const units = selectionUnits(
      [box('a', 0, 0), box('b', 50, 0)],
      [group('left', ['a', 'locked']), group('right', ['locked', 'b'])],
    );

    expect(units.map(unitIds)).toEqual([['a', 'b']]);
    expect(units[0]?.box).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 10 });
  });
});

function unitIds(unit: { readonly objects: ReadonlyArray<SceneObject> }): ReadonlyArray<string> {
  return unit.objects.map((object) => object.id);
}

function group(id: string, objectIds: ReadonlyArray<string>): SceneGroup {
  return { id, name: id, objectIds };
}

function box(id: string, x: number, y: number): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [],
  };
}
