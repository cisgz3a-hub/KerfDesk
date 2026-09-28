import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../scene';
import { createEllipse } from '../shapes/primitives';
import { findTrimTarget, type TrimTarget } from './trim-shapes';
import { remapTrimmedAnchors, trimEdit } from './trim-shape-edit';
import { isVectorPathObject } from './vector-path-tools';

type Point = readonly [number, number];

function poly(points: ReadonlyArray<Point>, closed = false): Polyline {
  return { closed, points: points.map(([x, y]) => ({ x, y })) };
}

function art(
  id: string,
  polylines: ReadonlyArray<Polyline>,
  patch: Partial<ImportedSvg> = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['cut'],
    paths: [{ color: '#000000', polylines }],
    ...patch,
  };
}

function scene(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer> = []): Scene {
  return {
    objects,
    layers: [createLayer({ id: 'cut', name: 'Cut', color: '#000000' }), ...layers],
    groups: [],
  };
}

function target(s: Scene, point: Point, tolerance = 0.5): TrimTarget {
  const found = findTrimTarget(s, { x: point[0], y: point[1] }, tolerance);
  if (found === null) throw new Error('no trim target');
  return found;
}

function edited(s: Scene, found: TrimTarget): ReadonlyArray<Polyline> {
  const object = s.objects.find((entry) => entry.id === found.contour.objectId);
  if (object === undefined || !isVectorPathObject(object)) throw new Error('missing object');
  const edit = trimEdit(object, found);
  if (edit === null) throw new Error('edit refused');
  return edit.paths.flatMap((path) => path.polylines);
}

function rounded(points: ReadonlyArray<Vec2>): ReadonlyArray<Point> {
  return points.map((point) => [round(point.x), round(point.y)] as const);
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}

// A horizontal line crossed by two verticals at x = 10 and x = 20.
const LADDER = scene([
  art('rail', [
    poly([
      [0, 10],
      [30, 10],
    ]),
  ]),
  art('left', [
    poly([
      [10, 0],
      [10, 20],
    ]),
  ]),
  art('right', [
    poly([
      [20, 0],
      [20, 20],
    ]),
  ]),
]);

describe('Trim Shapes target', () => {
  it('highlights the stretch between the nearest crossings', () => {
    const found = target(LADDER, [15, 10.2]);
    expect(found.contour.objectId).toBe('rail');
    expect(found.whole).toBe(false);
    expect(rounded(found.highlight)).toEqual([
      [10, 10],
      [20, 10],
    ]);
  });

  it('runs from an open end to the first crossing', () => {
    const found = target(LADDER, [4, 10]);
    expect(found.start).toBeNull();
    expect(rounded(found.highlight)).toEqual([
      [0, 10],
      [10, 10],
    ]);
  });

  it('keeps up to two open pieces of an open path', () => {
    const middle = edited(LADDER, target(LADDER, [15, 10]));
    expect(middle.map((polyline) => rounded(polyline.points))).toEqual([
      [
        [0, 10],
        [10, 10],
      ],
      [
        [20, 10],
        [30, 10],
      ],
    ]);
    expect(middle.every((polyline) => !polyline.closed)).toBe(true);
    const end = edited(LADDER, target(LADDER, [25, 10]));
    expect(end.map((polyline) => rounded(polyline.points))).toEqual([
      [
        [0, 10],
        [20, 10],
      ],
    ]);
  });

  it('takes a contour that crosses nothing whole', () => {
    const s = scene([
      art('lone', [
        poly([
          [0, 0],
          [10, 0],
        ]),
      ]),
    ]);
    const found = target(s, [5, 0]);
    expect(found.whole).toBe(true);
    const object = s.objects[0] as ImportedSvg;
    expect(trimEdit(object, found)).toMatchObject({ paths: [], pieces: 0, pathRemoved: true });
  });

  it('turns a trimmed closed contour into one open path through its old start', () => {
    const s = scene([
      art('square', [
        poly(
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
          true,
        ),
      ]),
      art('cutter', [
        poly([
          [10, -5],
          [10, 25],
        ]),
      ]),
    ]);
    const found = target(s, [15, 0]);
    expect(rounded(found.highlight)).toEqual([
      [10, 0],
      [20, 0],
      [20, 20],
      [10, 20],
    ]);
    const kept = edited(s, found);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.closed).toBe(false);
    expect(rounded(kept[0]?.points ?? [])).toEqual([
      [10, 20],
      [0, 20],
      [0, 0],
      [10, 0],
    ]);
  });

  it('closes on itself: a figure eight loses one loop at its own crossing', () => {
    const s = scene([
      art('eight', [
        poly(
          [
            [0, 0],
            [10, 10],
            [10, 0],
            [0, 10],
          ],
          true,
        ),
      ]),
    ]);
    const found = target(s, [10, 5]);
    expect(found.whole).toBe(false);
    const kept = edited(s, found);
    expect(rounded(kept[0]?.points ?? [])).toEqual([
      [5, 5],
      [0, 10],
      [0, 0],
      [5, 5],
    ]);
  });

  it('counts a touch: a line ending on a shape splits it there', () => {
    const s = scene([
      art('square', [
        poly(
          [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
          ],
          true,
        ),
      ]),
      art('spoke', [
        poly([
          [10, 0],
          [10, -10],
        ]),
      ]),
      art('spoke2', [
        poly([
          [10, 20],
          [10, 30],
        ]),
      ]),
    ]);
    expect(rounded(target(s, [15, 0]).highlight)).toEqual([
      [10, 0],
      [20, 0],
      [20, 20],
      [10, 20],
    ]);
    // The spoke's own end on the square is its end, not a crossing.
    expect(target(s, [10, -5]).whole).toBe(true);
  });

  it('ignores locked artwork and artwork on hidden operations', () => {
    const hidden = { ...createLayer({ id: 'hidden', name: 'Hidden', color: '#ff0000' }) };
    const s = scene(
      [
        art('rail', [
          poly([
            [0, 10],
            [30, 10],
          ]),
        ]),
        art(
          'locked',
          [
            poly([
              [10, 0],
              [10, 20],
            ]),
          ],
          { locked: true },
        ),
        art(
          'ghost',
          [
            poly([
              [20, 0],
              [20, 20],
            ]),
          ],
          { operationIds: ['hidden'] },
        ),
      ],
      [{ ...hidden, visible: false }],
    );
    expect(findTrimTarget(s, { x: 10, y: 5 }, 0.5)).toBeNull();
    expect(findTrimTarget(s, { x: 20, y: 5 }, 0.5)).toBeNull();
    expect(target(s, [15, 10]).whole).toBe(true);
  });

  it('works in world space and edits the object in its own coordinates', () => {
    const moved: ImportedSvg = art(
      'moved',
      [
        poly([
          [0, 0],
          [30, 0],
        ]),
      ],
      {
        transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50, scaleX: 2, scaleY: 2 },
      },
    );
    const s = scene([
      moved,
      art('post', [
        poly([
          [120, 40],
          [120, 60],
        ]),
      ]),
    ]);
    const found = target(s, [110, 50]);
    const kept = edited(s, found);
    expect(rounded(kept[0]?.points ?? [])).toEqual([
      [10, 0],
      [30, 0],
    ]);
    expect(applyTransform(kept[0]?.points[0] ?? { x: 0, y: 0 }, moved.transform)).toEqual({
      x: 120,
      y: 50,
    });
  });

  it('keeps an exact curve and ends it on the crossing line', () => {
    const circle = createEllipse({
      id: 'circle',
      color: '#000000',
      spec: { widthMm: 20, heightMm: 20 },
    });
    const s = scene([
      circle,
      art('chord', [
        poly([
          [10, -5],
          [10, 25],
        ]),
      ]),
    ]);
    const found = target(s, [20, 10]);
    const object = s.objects[0];
    if (object === undefined || !isVectorPathObject(object)) throw new Error('missing circle');
    const path = trimEdit(object, found)!.paths[0]!;
    const curve = path.curves![0]!;
    expect(path.polylines).toHaveLength(1);
    expect(curve.closed).toBe(false);
    expect(curve.segments.some((segment) => segment.kind !== 'line')).toBe(true);
    const end = curve.segments.at(-1)!.to;
    expect(curve.start.x).toBeCloseTo(10, 9);
    expect(end.x).toBeCloseTo(10, 9);
    expect(Math.hypot(curve.start.x - 10, curve.start.y - 10)).toBeCloseTo(10, 6);
    // The left half is kept: every point of its polyline lies left of the line.
    expect(path.polylines[0]!.points.every((point) => point.x <= 10 + 1e-9)).toBe(true);
  });
});

describe('placed tabs after a trim', () => {
  it('drops the trimmed contour tabs and renumbers the rest', () => {
    const anchors = [
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.2 },
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.3 },
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 2, pathT: 0.4 },
      { layerColor: '#000000', pathIndex: 1, polylineIndex: 0, pathT: 0.5 },
    ];
    const edit = { paths: [], pathIndex: 0, polylineIndex: 1, pieces: 2, pathRemoved: false };
    expect(remapTrimmedAnchors(anchors, edit).map((anchor) => anchor.pathT)).toEqual([
      0.2, 0.4, 0.5,
    ]);
    expect(remapTrimmedAnchors(anchors, edit)[1]).toMatchObject({ polylineIndex: 3 });
    const removed = { ...edit, pieces: 0, pathRemoved: true };
    expect(remapTrimmedAnchors(anchors, removed)).toEqual([
      { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.5 },
    ]);
  });
});
