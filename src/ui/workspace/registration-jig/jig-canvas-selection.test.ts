import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  transformedBBox,
  type AABB,
  type Project,
} from '../../../core/scene';
import { createRegistrationBox } from '../../../core/shapes';
import { createRectangle } from '../../../core/shapes/primitives';
import {
  jigEditableSelection,
  jigHandleAt,
  jigSelectableObjects,
  jigSelectAll,
  jigSelectionForHit,
  jigSelectionInMarquee,
  moveJigSelection,
  resizeJigSelection,
  rotateJigSelection,
} from './jig-canvas-selection';

function fixture(): Project {
  const layer = createLayer({ id: 'artwork', color: '#000000' });
  const hidden = { ...createLayer({ id: 'hidden', color: '#ff0000' }), visible: false };
  const objects = ['a', 'b', 'locked', 'hidden', 'other'].map((id) => ({
    ...createRectangle({
      id,
      color: id === 'hidden' ? hidden.color : layer.color,
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    locked: id === 'locked',
  }));
  return {
    ...createProject(),
    scene: {
      objects,
      layers: [layer, hidden],
      groups: [{ id: 'group', name: 'Group', objectIds: ['a', 'b', 'locked', 'hidden'] }],
    },
  };
}

describe('registration jig canvas selection', () => {
  it('selects a complete editable group without its locked or hidden members', () => {
    expect([...jigSelectionForHit(fixture().scene, 'a', new Set(), false)]).toEqual(['a', 'b']);
  });

  it('shift-click adds and removes the whole editable group', () => {
    const scene = fixture().scene;
    const added = jigSelectionForHit(scene, 'a', new Set(['other']), true);
    expect([...added]).toEqual(['a', 'b', 'other']);
    expect([...jigSelectionForHit(scene, 'b', added, true)]).toEqual(['other']);
  });

  it('keeps a multiselection when starting a drag on an already selected member', () => {
    expect([
      ...jigSelectionForHit(fixture().scene, 'a', new Set(['a', 'b', 'other']), false),
    ]).toEqual(['a', 'b', 'other']);
  });

  it('translates only visible unlocked selected objects without mutating source or settings', () => {
    const project = fixture();
    const next = moveJigSelection(project, new Set(['a', 'b', 'locked', 'hidden']), 12, -4);
    expect(next.scene.objects.slice(0, 2).map((object) => object.transform)).toEqual([
      { ...project.scene.objects[0]!.transform, x: 12, y: -4 },
      { ...project.scene.objects[1]!.transform, x: 12, y: -4 },
    ]);
    expect(project.scene.objects[0]!.transform.x).toBe(0);
    expect(next.scene.objects[2]).toBe(project.scene.objects[2]);
    expect(next.scene.objects[3]).toBe(project.scene.objects[3]);
    expect(next.scene.objects[4]).toBe(project.scene.objects[4]);
    expect(next.scene.layers).toBe(project.scene.layers);
    expect(next.scene.groups).toBe(project.scene.groups);
  });

  it('returns the source for a click, invalid displacement or noneditable selection', () => {
    const project = fixture();
    expect(moveJigSelection(project, new Set(['a']), 0, 0)).toBe(project);
    expect(moveJigSelection(project, new Set(['a']), Number.NaN, 2)).toBe(project);
    expect(moveJigSelection(project, new Set(['locked', 'hidden']), 4, 2)).toBe(project);
  });
});

// Four 10 mm squares in a row at x = 0, 20, 40, 60; c and d share a group.
function row(): Project {
  const base = fixture();
  const objects = ['a', 'b', 'locked', 'hidden'].map((id, index) => {
    const object = base.scene.objects.find((candidate) => candidate.id === id)!;
    return { ...object, transform: { ...object.transform, x: index * 20 } };
  });
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [
        ...objects,
        ...['c', 'd'].map((id, index) => ({
          ...base.scene.objects[0]!,
          id,
          transform: { ...base.scene.objects[0]!.transform, x: 80 + index * 20 },
        })),
      ],
      groups: [{ id: 'pair', name: 'Pair', objectIds: ['c', 'd'] }],
    },
  };
}

function bounds(project: Project, id: string) {
  return transformedBBox(project.scene.objects.find((object) => object.id === id)!);
}

function expectBounds(actual: AABB, expected: AABB): void {
  for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
    expect(actual[key]).toBeCloseTo(expected[key]);
  }
}

describe('registration jig canvas marquee and select all', () => {
  it('selects enclosed objects left to right and touched objects right to left', () => {
    const scene = row().scene;
    const none = new Set<string>();
    expect([...jigSelectionInMarquee(scene, { x: -1, y: -1 }, { x: 25, y: 11 }, none)]).toEqual([
      'a',
    ]);
    expect([...jigSelectionInMarquee(scene, { x: 25, y: 11 }, { x: 5, y: -1 }, none)]).toEqual([
      'a',
      'b',
    ]);
  });

  it('skips locked and hidden objects, takes whole groups and adds to the selection', () => {
    const scene = row().scene;
    const caught = jigSelectionInMarquee(scene, { x: 85, y: 11 }, { x: 25, y: -1 }, new Set(['a']));
    expect([...caught]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Ctrl+A selection holds every unlocked visible artwork but no outline', () => {
    const base = row();
    const outline = createRegistrationBox({ widthMm: 80, heightMm: 40, x: 0, y: 0 });
    const scene = {
      ...base.scene,
      layers: [...base.scene.layers, createRegistrationLayer()],
      objects: [...base.scene.objects, { ...outline, locked: false }],
    };
    expect(jigSelectableObjects(scene).map((object) => object.id)).toContain(outline.id);
    expect([...jigSelectAll(scene)]).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('registration jig canvas handles', () => {
  it('keeps the interior of small selected artwork movable while preserving outside handles', () => {
    const objects = jigEditableSelection(row(), new Set(['a']));
    for (const point of [
      { x: 1, y: 1 },
      { x: 5, y: 5 },
      { x: 9, y: 9 },
    ]) {
      expect(jigHandleAt(objects, point, 2.5)).toBeNull();
    }
    expect(jigHandleAt(objects, { x: -1, y: -1 }, 2.5)).toEqual({ kind: 'resize', handle: 'nw' });
  });

  it.each([
    [{ x: 10, y: 20 }, 20],
    [{ x: 10, y: 5 }, 5],
    [{ x: 12, y: 20 }, 20],
    [{ x: 20, y: 12 }, 20],
  ])('follows either corner-drag axis for proportional growth and shrinking: %j', (point, size) => {
    const project = row();
    const result = resizeJigSelection(project, new Set(['a']), {
      handle: 'se',
      start: { x: 10, y: 10 },
      point,
      lockAspect: true,
    });
    expect(result.refused).toBe(false);
    expectBounds(bounds(result.project, 'a'), { minX: 0, minY: 0, maxX: size, maxY: size });
  });

  it('finds the resize handles and the rotate handle of the selection bounds', () => {
    const project = row();
    const objects = jigEditableSelection(project, new Set(['a', 'b']));
    expect(jigHandleAt(objects, { x: 30.2, y: 10.1 }, 0.1)).toEqual({
      kind: 'resize',
      handle: 'se',
    });
    expect(jigHandleAt(objects, { x: 15, y: 0 }, 0.1)).toEqual({ kind: 'resize', handle: 'n' });
    expect(jigHandleAt(objects, { x: 15, y: -2.4 }, 0.1)).toEqual({ kind: 'rotate' });
    expect(jigHandleAt(objects, { x: 5, y: 5 }, 0.1)).toBeNull();
    expect(jigHandleAt([], { x: 0, y: 0 }, 0.1)).toBeNull();
  });

  it('resizes proportionally from a corner, and freely with Shift, about the opposite corner', () => {
    const project = row();
    const drag = { handle: 'se' as const, start: { x: 10, y: 10 }, point: { x: 20, y: 12 } };
    const even = resizeJigSelection(project, new Set(['a']), { ...drag, lockAspect: true });
    expect(even.refused).toBe(false);
    expectBounds(bounds(even.project, 'a'), { minX: 0, minY: 0, maxX: 20, maxY: 20 });
    const free = resizeJigSelection(project, new Set(['a']), { ...drag, lockAspect: false });
    expectBounds(bounds(free.project, 'a'), { minX: 0, minY: 0, maxX: 20, maxY: 12 });
    expect(free.project.scene.objects[1]).toBe(project.scene.objects[1]);
  });

  it('moves the grabbed handle by the pointer travel, so a click changes nothing', () => {
    const project = row();
    const drag = { handle: 'w' as const, start: { x: 0.3, y: 5 }, lockAspect: true };
    const clicked = resizeJigSelection(project, new Set(['a']), { ...drag, point: drag.start });
    expect(clicked.project).toBe(project);
    const pulled = resizeJigSelection(project, new Set(['a']), {
      ...drag,
      point: { x: -4.7, y: 9 },
    });
    expectBounds(bounds(pulled.project, 'a'), { minX: -5, minY: 0, maxX: 10, maxY: 10 });
    expect(
      resizeJigSelection(project, new Set(['locked']), { ...drag, point: { x: 3, y: 5 } }),
    ).toEqual({ project, refused: false });
  });

  it('refuses a free stretch of artwork turned at an angle', () => {
    const base = row();
    const turned: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: base.scene.objects.map((object) =>
          object.id === 'a'
            ? { ...object, transform: { ...object.transform, rotationDeg: 30 } }
            : object,
        ),
      },
    };
    const result = resizeJigSelection(turned, new Set(['a']), {
      handle: 'e',
      start: { x: 0, y: 0 },
      point: { x: 5, y: 0 },
      lockAspect: true,
    });
    expect(result).toEqual({ project: turned, refused: true });
  });

  it('rotates about the centre of the selection bounds, snapping with Shift', () => {
    const project = row();
    // Centre (5, 5): a pointer swept from above it to its right turns 90 degrees.
    const drag = { start: { x: 5, y: -10 }, point: { x: 20, y: 5 } };
    const turned = rotateJigSelection(project, new Set(['a']), { ...drag, snap: false });
    const object = turned.scene.objects[0]!;
    expect(object.transform.rotationDeg).toBeCloseTo(90);
    const box = bounds(turned, 'a');
    expect((box.minX + box.maxX) / 2).toBeCloseTo(5);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(5);
    const nearly = { start: drag.start, point: { x: 20, y: 4 } };
    expect(
      rotateJigSelection(project, new Set(['a']), { ...nearly, snap: true }).scene.objects[0]!
        .transform.rotationDeg,
    ).toBeCloseTo(90);
    expect(
      rotateJigSelection(project, new Set(['a']), { ...drag, point: drag.start, snap: true }),
    ).toBe(project);
  });

  it('turns a multiselection as one about its combined centre', () => {
    const project = row();
    // Centre of a and b is (15, 5); a half turn swaps their places.
    const turned = rotateJigSelection(project, new Set(['a', 'b']), {
      start: { x: 15, y: -10 },
      point: { x: 15, y: 20 },
      snap: false,
    });
    expect(bounds(turned, 'a').minX).toBeCloseTo(20);
    expect(bounds(turned, 'b').minX).toBeCloseTo(0);
  });
});
