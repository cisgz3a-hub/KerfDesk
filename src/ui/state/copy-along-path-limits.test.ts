// Copy Along Path and the project's object limit (ADR-498 amendment 1). A
// project holds at most PROJECT_SCENE_LIMITS.objects objects and cannot be
// reopened above it, so that is the one limit on how many copies there can be:
// every count that fits is placed, in one undo step, and a count that does not
// fit (however absurd) places nothing and says how many copies would.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitCopyAlongPathSelection } from '../../core/geometry/copy-along-path-guide';
import { createLayer } from '../../core/scene/layer';
import { createProject, type Project } from '../../core/scene/project';
import type { SceneGroup } from '../../core/scene/scene';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
} from '../../core/scene/scene-object';
import {
  PROJECT_SCENE_LIMITS,
  validateSceneBudgets,
} from '../../io/project/project-scene-integrity-validator';
import { cloneSelectedGroups } from './array-actions';
import type * as ArrayActions from './array-actions';
import {
  copyAlongPathRoom,
  planForSelection,
  previewForSelection,
  type CopyAlongPathRequest,
} from './copy-along-path-plan';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

// Counts what each copy's group cloning looks through; the real cloning still runs.
vi.mock('./array-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof ArrayActions>();
  return { ...actual, cloneSelectedGroups: vi.fn(actual.cloneSelectedGroups) };
});

const REQUEST: CopyAlongPathRequest = {
  mode: 'count',
  count: 3,
  spacingMm: 10,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
  keepOriginal: true,
};
const LIMIT = PROJECT_SCENE_LIMITS.objects;

function poly(points: ReadonlyArray<readonly [number, number]>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function svg(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  const xs = polylines.flatMap((line) => line.points.map((point) => point.x));
  const ys = polylines.flatMap((line) => line.points.map((point) => point.y));
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
  };
}

const BOX = svg('box', [
  poly(
    [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
      [0, 0],
    ],
    true,
  ),
]);
const GUIDE = svg('guide', [
  poly([
    [0, 50],
    [100, 50],
  ]),
]);
// Two triangles: artwork, never a guide. Selected with BOX it makes a two-object copy.
const LOGO = svg('logo', [
  poly(
    [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 0],
    ],
    true,
  ),
  poly(
    [
      [10, 0],
      [15, 0],
      [15, 5],
      [10, 0],
    ],
    true,
  ),
]);
const MASK = svg('mask', [
  poly(
    [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
      [0, 0],
    ],
    true,
  ),
]);
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

// Small artwork that stays out of the selection, to fill the project up.
function filler(count: number): ReadonlyArray<SceneObject> {
  return Array.from({ length: count }, (_, index) =>
    svg(`filler-${index}`, [
      poly([
        [0, 0],
        [1, 1],
      ]),
    ]),
  );
}

function load(
  objects: ReadonlyArray<SceneObject>,
  selected: ReadonlyArray<string>,
  groups: ReadonlyArray<SceneGroup> = [],
): Project {
  const layers = [createLayer({ id: 'cut', name: 'cut', color: '#000000' })];
  const project = { ...createProject(), scene: { objects, layers, groups } };
  useStore.setState({
    project,
    selectedObjectId: selected[0] ?? null,
    additionalSelectedIds: new Set(selected.slice(1)),
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

function roomMessage(room: number): string {
  return `This project has room for at most ${room} more copies of this artwork (project limit ${LIMIT} objects). Ask for fewer copies.`;
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

describe('Copy Along Path count limits', () => {
  it.each([1e12, 1e300, LIMIT])(
    'places nothing and says what fits when %s copies are asked for',
    (count) => {
      const before = load([BOX, GUIDE], ['box', 'guide']);

      expect(useStore.getState().copyAlongPath({ ...REQUEST, count })).toBe(false);

      expect(project()).toBe(before);
      expect(useStore.getState().undoStack).toEqual([]);
      expect(lastToast()).toEqual({ message: roomMessage(LIMIT - 2), variant: 'warning' });
    },
  );

  it.each([
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [Number.NEGATIVE_INFINITY, 1],
    [-3, 1],
    [0, 1],
    [2.9, 2],
  ])('reads a count of %s as %s and lays out nothing malformed', (count, copies) => {
    load([BOX, GUIDE], ['box', 'guide']);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count })).toBe(true);

    const placed = project().scene.objects.slice(2);
    expect(placed).toHaveLength(copies);
    for (const { transform } of placed) {
      const { x, y, scaleX, scaleY, rotationDeg } = transform;
      expect([x, y, scaleX, scaleY, rotationDeg].every(Number.isFinite)).toBe(true);
    }
  });

  it('places exactly as many copies as fit under the project limit, and not one more', () => {
    // 9,982 objects in the project, so 18 more fit.
    const before = load([BOX, GUIDE, ...filler(LIMIT - 20)], ['box', 'guide']);
    const room = 18;

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room + 1 })).toBe(false);
    expect(project()).toBe(before);
    expect(lastToast()?.message).toBe(roomMessage(room));

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room })).toBe(true);
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
    expect(useStore.getState().undoStack).toEqual([before]);
  });

  it('counts everything a copy carries with it against the limit', () => {
    // The image's mask travels with every copy, so a copy is two objects.
    const before = load([MASKED_IMAGE, MASK, GUIDE, ...filler(LIMIT - 23)], ['image', 'guide']);
    const room = 10;

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room + 1 })).toBe(false);
    expect(project()).toBe(before);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room })).toBe(true);
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
  });

  it('counts every selected object of the artwork as part of one copy', () => {
    const before = load([BOX, LOGO, GUIDE, ...filler(LIMIT - 23)], ['box', 'logo', 'guide']);
    const room = 10;

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room + 1 })).toBe(false);
    expect(project()).toBe(before);
    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: room })).toBe(true);
    expect(project().scene.objects).toHaveLength(LIMIT);
  });

  it('frees the original artwork’s place when the original is not kept', () => {
    const before = load([BOX, GUIDE, ...filler(LIMIT - 20)], ['box', 'guide']);
    const room = 19;

    expect(
      useStore.getState().copyAlongPath({ ...REQUEST, count: room + 1, keepOriginal: false }),
    ).toBe(false);
    expect(project()).toBe(before);

    expect(
      useStore.getState().copyAlongPath({ ...REQUEST, count: room, keepOriginal: false }),
    ).toBe(true);
    expect(project().scene.objects).toHaveLength(LIMIT);
    expect(validateSceneBudgets(project().scene)).toBeNull();
  });

  it('explains a spacing or gap that would place more copies than fit', () => {
    // Room for 8 more; the 100 mm guide takes 11 copies 10 mm wide edge to edge.
    load([BOX, GUIDE, ...filler(LIMIT - 10)], ['box', 'guide']);

    expect(
      useStore.getState().copyAlongPath({ ...REQUEST, mode: 'spacing', spacingMm: 0.002 }),
    ).toBe(false);
    expect(lastToast()).toEqual({
      message: `This project has room for at most 8 more copies of this artwork (project limit ${LIMIT} objects), and that spacing places more. Set a larger spacing.`,
      variant: 'warning',
    });

    expect(useStore.getState().copyAlongPath({ ...REQUEST, mode: 'gap', spacingMm: 0 })).toBe(
      false,
    );
    expect(lastToast()?.message).toContain('and that gap places more. Set a larger gap.');
  });

  it('says so when the project has no room for even one copy', () => {
    const before = load([BOX, GUIDE, ...filler(LIMIT - 2)], ['box', 'guide']);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count: 1 })).toBe(false);

    expect(project()).toBe(before);
    expect(lastToast()).toEqual({
      message: `This project has no room for another copy of this artwork (project limit ${LIMIT} objects). Delete some objects first.`,
      variant: 'warning',
    });
  });
});

describe('Copy Along Path with a large count', () => {
  it('places every requested copy in one undo step', () => {
    const count = 4_000;
    const before = load([BOX, GUIDE], ['box', 'guide']);

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count })).toBe(true);

    const objects = project().scene.objects;
    expect(objects).toHaveLength(2 + count);
    expect(new Set(objects.map((object) => object.id)).size).toBe(2 + count);
    expect(useStore.getState().additionalSelectedIds.size).toBe(count - 1);
    expect(useStore.getState().undoStack).toEqual([before]);
    expect(lastToast()).toEqual({
      message: `Placed ${count} copies along the guide path.`,
      variant: 'success',
    });

    useStore.getState().undo();
    expect(project()).toBe(before);
  });

  it('gives each copy of a group its own group without going through every group per copy', () => {
    const count = 1_500;
    const lid = { ...BOX, id: 'lid' };
    const others = Array.from({ length: 2_000 }, (_, index) => ({
      id: `other-${index}`,
      name: `Other ${index}`,
      objectIds: [`filler-${2 * index}`, `filler-${2 * index + 1}`],
    }));
    const group = { id: 'g', name: 'Group', objectIds: ['box', 'lid'] };
    load([BOX, lid, GUIDE, ...filler(4_000)], ['box', 'lid', 'guide'], [group, ...others]);
    vi.mocked(cloneSelectedGroups).mockClear();

    expect(useStore.getState().copyAlongPath({ ...REQUEST, count })).toBe(true);

    const groups = project().scene.groups ?? [];
    expect(groups).toHaveLength(1 + others.length + count);
    expect(validateSceneBudgets(project().scene)).toBeNull();
    // Every copy is handed the one group that travels, not the project's 2,001.
    const handed = vi
      .mocked(cloneSelectedGroups)
      .mock.calls.map(([candidates]) => candidates.length);
    expect(handed).toEqual(Array.from({ length: count }, () => 1));
  });
});

describe('the Copy Along Path preview', () => {
  it('says what the plan does, problems included, without the placements', () => {
    const objects = [BOX, GUIDE, ...filler(LIMIT - 12)];
    const selection = splitCopyAlongPathSelection([BOX, GUIDE]);
    const room = copyAlongPathRoom({ ...createProject().scene, objects }, selection, true);
    expect(room).toBe(10);
    const patches: ReadonlyArray<Partial<CopyAlongPathRequest>> = [
      {},
      { count: 10 },
      { count: 11 },
      { count: 1e12 },
      { mode: 'spacing', spacingMm: 25 },
      { mode: 'spacing', spacingMm: 0 },
      { mode: 'spacing', spacingMm: 0.002 },
      { mode: 'gap', spacingMm: 5 },
      { startOffsetMm: 60, endOffsetMm: 50 },
    ];
    for (const patch of patches) {
      const request = { ...REQUEST, ...patch };
      const plan = planForSelection(selection, request, room);
      const preview = previewForSelection(selection, request, room);
      if (plan.kind === 'ready') {
        expect(preview).toMatchObject({
          kind: 'ready',
          count: plan.placements.length,
          stepMm: plan.stepMm,
        });
      } else {
        expect(preview).toEqual(plan);
      }
    }
  });
});
