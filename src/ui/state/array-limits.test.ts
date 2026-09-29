// Array and the project's object limit (ADR-307 amendment 1). A project holds
// at most PROJECT_SCENE_LIMITS.objects objects and cannot be reopened above it,
// so that is the one limit on how many copies an array can make: every request
// that fits is placed, in one undo step, and one that does not (however absurd)
// places nothing and says how many copies would.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ArrayPlacement,
  type ArraySpec,
  type Project,
  type SceneGroup,
  type SceneObject,
  type TextObject,
} from '../../core/scene';
import type { CircularArraySpec } from '../../core/scene/array-layout-types';
import { deserializeProject } from '../../io/project/deserialize-project';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import { serializeProject } from '../../io/project/serialize-project';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

const LIMIT = PROJECT_SCENE_LIMITS.objects;
const FEWER_ROWS = 'Use fewer rows or columns.';
const FEWER_COPIES = 'Use fewer copies.';

// One row of `instances`, the original included.
function grid(instances: number): ArraySpec {
  return { kind: 'grid', rows: 1, columns: instances, spacingX: 2, spacingY: 2 };
}

function circle(instances: number): CircularArraySpec {
  return {
    kind: 'circular',
    count: instances,
    centerX: 50,
    centerY: 50,
    radius: 30,
    startAngleDeg: 0,
    rotateCopies: false,
  };
}

function rotation(instances: number): ArraySpec {
  return { kind: 'point-rotation', count: instances, totalAngleDeg: 360 };
}

type Mode = {
  readonly name: string;
  readonly make: (instances: number) => ArraySpec;
  readonly ask: string;
};

const MODES: ReadonlyArray<Mode> = [
  { name: 'grid', make: grid, ask: FEWER_ROWS },
  { name: 'circular', make: circle, ask: FEWER_COPIES },
  { name: 'point rotation', make: rotation, ask: FEWER_COPIES },
];

function rect(id: string, x = 0): SceneObject {
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

const MASKED_IMAGE: SceneObject = {
  kind: 'raster-image',
  id: 'image',
  source: 'image.png',
  dataUrl: 'data:image/png;base64,AA==',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'grayscale',
  linesPerMm: 1,
  lumaBase64: 'AA==',
  imageMaskId: 'mask',
};

// Path text set along another shape.
function lettering(id: string, guideObjectId: string): TextObject {
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

// Small objects that stay out of the selection, to fill the project up.
function filler(count: number): ReadonlyArray<SceneObject> {
  return Array.from({ length: count }, (_, index) => rect(`filler-${index}`, 200));
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string>,
  groups: ReadonlyArray<SceneGroup> = [],
): Project {
  const layers = [createLayer({ id: '#000000', color: '#000000' })];
  const project = { ...createProject(), scene: { objects, layers, groups } };
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
  return project;
}

function project(): Project {
  return useStore.getState().project;
}

function lastToast(): { readonly message: string; readonly variant: string } | undefined {
  const toast = useToastStore.getState().toasts.at(-1);
  return toast === undefined ? undefined : { message: toast.message, variant: toast.variant };
}

function roomMessage(room: number, ask: string): string {
  const copies = room === 1 ? '1 more copy' : `${room} more copies`;
  return `This project has room for at most ${copies} of this selection (project limit ${LIMIT} objects). ${ask}`;
}

function pastTheLimit(what: string, limit: number): string {
  return `This would take the project past its limit of ${limit} ${what}. Ask for fewer copies, or delete some objects first.`;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Array count limits', () => {
  it.each([
    [
      'a grid of a million by a million',
      { kind: 'grid', rows: 1e6, columns: 1e6, spacingX: 2, spacingY: 2 } as ArraySpec,
      FEWER_ROWS,
    ],
    [
      'a grid past the largest number',
      { kind: 'grid', rows: 1e200, columns: 1e200, spacingX: 2, spacingY: 2 } as ArraySpec,
      FEWER_ROWS,
    ],
    ['a circle of a trillion', circle(1e12), FEWER_COPIES],
    ['a point rotation of 1e300', rotation(1e300), FEWER_COPIES],
  ])('places nothing and says what fits for %s', (_name, spec, ask) => {
    const before = load([rect('a'), rect('b', 20)], ['a']);

    expect(() => useStore.getState().arraySelection(spec)).not.toThrow();

    expect(project()).toBe(before);
    expect(useStore.getState().undoStack).toEqual([]);
    expect(lastToast()).toEqual({ message: roomMessage(LIMIT - 2, ask), variant: 'warning' });
  });

  it.each(MODES)('$name: places every instance that fits, and not one more', ({ make, ask }) => {
    // 9,982 objects in the project, so 18 more copies fit: 19 instances.
    const before = load([rect('a'), rect('b', 20), ...filler(LIMIT - 20)], ['a']);
    const room = 18;

    useStore.getState().arraySelection(make(room + 2));
    expect(project()).toBe(before);
    expect(lastToast()).toEqual({ message: roomMessage(room, ask), variant: 'warning' });

    useStore.getState().arraySelection(make(room + 1));
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('places the most a project allows, in one undo step and with no notice', () => {
    // One object leaves room for 9,999 copies: 10,000 instances.
    const before = load([rect('a')], ['a']);

    useStore.getState().arraySelection(grid(LIMIT));

    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()).toBeUndefined();
    // What the array made can be saved and opened again.
    expect(deserializeProject(serializeProject(project())).kind).toBe('ok');
  });

  it('counts everything a copy carries with it', () => {
    // The image's mask travels with every copy, so a copy is two objects.
    const before = load([MASKED_IMAGE, rect('mask'), ...filler(LIMIT - 12)], ['image']);

    // 10 objects free: 5 copies, so 6 instances.
    useStore.getState().arraySelection(grid(7));
    expect(project()).toBe(before);
    expect(lastToast()?.message).toBe(roomMessage(5, FEWER_ROWS));

    useStore.getState().arraySelection(grid(6));
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
  });

  it('counts every selected object as part of one copy', () => {
    const before = load([rect('a'), rect('b', 20), ...filler(LIMIT - 12)], ['a', 'b']);

    // 10 objects free: 5 copies of two.
    useStore.getState().arraySelection(grid(7));
    expect(project()).toBe(before);
    expect(lastToast()?.message).toBe(roomMessage(5, FEWER_ROWS));

    useStore.getState().arraySelection(grid(6));
    expect(project().scene.objects).toHaveLength(LIMIT);
  });

  it('does not count the object a circle is centred on, which is not copied', () => {
    const before = load(
      [rect('hub', 45), rect('part', 15), ...filler(LIMIT - 12)],
      ['hub', 'part'],
    );
    const centred = (instances: number): ArraySpec => ({
      ...circle(instances),
      centerObjectId: 'hub',
    });

    // 10 objects free: 10 copies of the one object that is copied.
    useStore.getState().arraySelection(centred(12));
    expect(project()).toBe(before);
    expect(lastToast()?.message).toBe(roomMessage(10, FEWER_COPIES));

    useStore.getState().arraySelection(centred(11));
    expect(project().scene.objects).toHaveLength(LIMIT);
  });

  it('says so when the project has no room for even one copy', () => {
    const before = load([rect('a'), ...filler(LIMIT - 1)], ['a']);

    useStore.getState().arraySelection(grid(2));

    expect(project()).toBe(before);
    expect(lastToast()).toEqual({
      message: `This project has no room for another copy of this selection (project limit ${LIMIT} objects). Delete some objects first.`,
      variant: 'warning',
    });
    // The original alone is not a copy: it still moves.
    useStore.getState().arraySelection(grid(1));
    expect(project().scene.objects).toHaveLength(LIMIT);
  });

  it('refuses explicit placements, as Find pieces makes, that would not fit', () => {
    const before = load([rect('a'), ...filler(LIMIT - 6)], ['a']);
    const placements = (count: number): ReadonlyArray<ArrayPlacement> =>
      Array.from({ length: count }, (_, index) => ({ dx: index * 20, dy: 0, rotationDeg: 0 }));

    // 5 objects free: 5 copies, so 6 placements.
    expect(useStore.getState().placeSelectionCopies(placements(7), before)).toBe(false);
    expect(project()).toBe(before);
    expect(lastToast()).toEqual({
      message: `This project has room for at most 5 more copies of this selection (project limit ${LIMIT} objects). Untick some pieces.`,
      variant: 'warning',
    });

    expect(useStore.getState().placeSelectionCopies(placements(6), before)).toBe(true);
    expect(project().scene.objects).toHaveLength(LIMIT);
  });

  it('reports a placement that changed nothing as not placed', () => {
    const before = load([{ ...rect('a'), locked: true }], ['a']);

    expect(useStore.getState().placeSelectionCopies([{ dx: 0, dy: 0, rotationDeg: 0 }])).toBe(
      false,
    );
    expect(project()).toBe(before);
  });
});

describe('Array and what the copies carry into the project', () => {
  // 13 objects in a chain of 12 nested groups of 2, 3, ... 13 members, as a
  // saved file can hold them: each copy adds 13 objects, 12 groups and 90
  // group members.
  const parts = Array.from({ length: 13 }, (_, index) => rect(`part-${index}`, index * 12));
  const nested: ReadonlyArray<SceneGroup> = Array.from({ length: 12 }, (_, index) => ({
    id: `nest-${index}`,
    name: `Nest ${index}`,
    objectIds: parts.slice(0, index + 2).map((part) => part.id),
  }));
  const selected = parts.map((part) => part.id);

  it('refuses a request whose group members would pass the limit though its objects fit', () => {
    // 700 instances are 9,100 objects, but 700 x 90 is 63,000 of 50,000 members.
    const before = load(parts, selected, nested);

    useStore.getState().arraySelection(grid(700));

    expect(project()).toBe(before);
    expect(lastToast()).toEqual({
      message: pastTheLimit('group members', PROJECT_SCENE_LIMITS.groupMembers),
      variant: 'warning',
    });
    expect(useStore.getState().undoStack).toEqual([]);
  });

  it('places what fits when the groups stay inside their limits', () => {
    load(parts, selected, nested);

    useStore.getState().arraySelection(grid(500));

    expect(project().scene.objects).toHaveLength(13 * 500);
    expect(project().scene.groups).toHaveLength(12 * 500);
    expect(validateSceneBudgets(project().scene)).toBeNull();
  });

  it('refuses a first placement whose copy of a shape others rely on would pass the limit', () => {
    // Lettering runs along the selected shape, so a circle leaves the shape
    // where it is and puts a copy in the first position: one object more from
    // an array of one.
    const text = lettering('lettering', 'part');

    const before = load([rect('part'), text, ...filler(LIMIT - 2)], ['part']);
    useStore.getState().arraySelection(circle(1));
    expect(project()).toBe(before);
    expect(lastToast()?.message).toBe(pastTheLimit('objects', LIMIT));

    load([rect('part'), text, ...filler(LIMIT - 3)], ['part']);
    useStore.getState().arraySelection(circle(1));
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
  });

  it('leaves a project that is already over the limit free to move things about', () => {
    load([rect('a'), ...filler(LIMIT + 4)], ['a']);

    useStore.getState().arraySelection(grid(1));

    expect(project().scene.objects).toHaveLength(LIMIT + 5);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(lastToast()).toBeUndefined();
  });
});
