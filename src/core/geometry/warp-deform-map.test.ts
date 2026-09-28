// Warp (projective, 4 handles) and Deform (bicubic Bezier patch, 16 handles)
// maps for LBG-T06.
import { describe, expect, it } from 'vitest';
import type { Bounds, Vec2 } from '../scene/scene-object';
import {
  deformMap,
  initialWarpDeformHandles,
  warpDeformBox,
  warpDeformHandlesUnmoved,
  warpDeformMap,
  warpDeformStretch,
  warpMap,
} from './warp-deform-map';

const BOX: Bounds = { minX: 10, minY: 20, maxX: 110, maxY: 80 };

function samplePoints(box: Bounds): ReadonlyArray<Vec2> {
  const points: Vec2[] = [];
  for (let row = 0; row <= 6; row += 1) {
    for (let col = 0; col <= 6; col += 1) {
      points.push({
        x: box.minX + ((box.maxX - box.minX) * col) / 6,
        y: box.minY + ((box.maxY - box.minY) * row) / 6,
      });
    }
  }
  return points;
}

function expectClose(actual: Vec2, expected: Vec2, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('initial handles', () => {
  it('put the four Warp handles on the box corners, in order round the box', () => {
    expect(initialWarpDeformHandles('warp', BOX)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 80 },
      { x: 10, y: 80 },
    ]);
  });

  it('spread the 16 Deform handles evenly, row by row', () => {
    const handles = initialWarpDeformHandles('deform', BOX);
    expect(handles).toHaveLength(16);
    expect(handles[0]).toEqual({ x: 10, y: 20 });
    expect(handles[1]?.x).toBeCloseTo(10 + 100 / 3, 12);
    expect(handles[4]?.y).toBeCloseTo(40, 12);
    expect(handles[15]).toEqual({ x: 110, y: 80 });
  });

  it('are recognised as unmoved until one moves', () => {
    const handles = initialWarpDeformHandles('deform', BOX);
    expect(warpDeformHandlesUnmoved('deform', BOX, handles)).toBe(true);
    const moved = handles.map((handle, index) =>
      index === 5 ? { ...handle, x: handle.x + 1 } : handle,
    );
    expect(warpDeformHandlesUnmoved('deform', BOX, moved)).toBe(false);
  });
});

describe('identity handles leave points unchanged', () => {
  it.each(['warp', 'deform'] as const)('%s', (grid) => {
    const map = warpDeformMap(grid, BOX, initialWarpDeformHandles(grid, BOX));
    for (const point of samplePoints(BOX)) expectClose(map.apply(point), point, 10);
  });
});

describe('Warp', () => {
  const handles: ReadonlyArray<Vec2> = [
    { x: 0, y: 0 },
    { x: 130, y: 15 },
    { x: 120, y: 95 },
    { x: 20, y: 70 },
  ];

  it('maps the box corners exactly onto the handles', () => {
    const map = warpMap(BOX, handles);
    initialWarpDeformHandles('warp', BOX).forEach((corner, index) => {
      expect(map.apply(corner)).toEqual(handles[index]);
    });
    expect(map.keepsLinesStraight).toBe(true);
    // Just inside a corner the projective map itself lands next to the handle.
    expectClose(map.apply({ x: 110 - 1e-9, y: 80 - 1e-9 }), handles[2] as Vec2, 6);
  });

  it('keeps straight lines straight (a projective map)', () => {
    const map = warpMap(BOX, handles);
    const a = map.apply({ x: 20, y: 30 });
    const b = map.apply({ x: 100, y: 70 });
    for (const t of [0.2, 0.5, 0.8]) {
      const p = map.apply({ x: 20 + 80 * t, y: 30 + 40 * t });
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-9);
    }
  });

  it('is affine when Shift keeps the handles on a parallelogram', () => {
    const parallelogram = [
      { x: 10, y: 20 },
      { x: 110, y: 30 },
      { x: 130, y: 90 },
      { x: 30, y: 80 },
    ];
    const map = warpMap(BOX, parallelogram);
    const centre = map.apply({ x: 60, y: 50 });
    expectClose(centre, { x: 70, y: 55 }, 9);
  });

  it('still maps crossed handles, folding over through the bilinear map', () => {
    const crossed = [handles[0], handles[2], handles[1], handles[3]] as ReadonlyArray<Vec2>;
    const map = warpMap(BOX, crossed);
    expect(map.keepsLinesStraight).toBe(false);
    initialWarpDeformHandles('warp', BOX).forEach((corner, index) => {
      expectClose(map.apply(corner), crossed[index] as Vec2, 9);
    });
    for (const point of samplePoints(BOX)) {
      const mapped = map.apply(point);
      expect(Number.isFinite(mapped.x) && Number.isFinite(mapped.y)).toBe(true);
    }
  });

  it('falls back to the bilinear map when one handle is pulled inside the others', () => {
    const dented = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 30, y: 30 },
      { x: 10, y: 80 },
    ];
    const map = warpMap(BOX, dented);
    expect(map.keepsLinesStraight).toBe(false);
    expectClose(map.apply({ x: 60, y: 50 }), { x: 40, y: 37.5 }, 9);
  });
});

describe('Deform', () => {
  it('maps the box corners exactly onto the corner handles', () => {
    const handles = initialWarpDeformHandles('deform', BOX).map((handle, index) => ({
      x: handle.x + index * 0.7,
      y: handle.y - index * 0.3,
    }));
    const map = deformMap(BOX, handles);
    expect(map.apply({ x: 10, y: 20 })).toEqual(handles[0]);
    expect(map.apply({ x: 110, y: 20 })).toEqual(handles[3]);
    expect(map.apply({ x: 110, y: 80 })).toEqual(handles[15]);
    expect(map.apply({ x: 10, y: 80 })).toEqual(handles[12]);
  });

  it('bends the artwork smoothly when an inner control point moves', () => {
    const handles = initialWarpDeformHandles('deform', BOX).map((handle, index) =>
      index === 5 ? { x: handle.x, y: handle.y + 30 } : handle,
    );
    const map = deformMap(BOX, handles);
    // The corners stay put; points near the moved control point move most.
    expectClose(map.apply({ x: 10, y: 20 }), { x: 10, y: 20 }, 9);
    expectClose(map.apply({ x: 110, y: 80 }), { x: 110, y: 80 }, 9);
    const near = map.apply({ x: 10 + 100 / 3, y: 40 });
    const far = map.apply({ x: 10 + 200 / 3, y: 60 });
    // B1(1/3)^2 = (4/9)^2 of the 30 mm move lands on the control point's own parameter.
    expect(near.y - 40).toBeCloseTo(30 * (4 / 9) ** 2, 9);
    expect(far.y - 60).toBeCloseTo(30 * (2 / 9) ** 2, 9);
    expect(near.x).toBeCloseTo(10 + 100 / 3, 9);
  });

  it('bends a straight line into a curve', () => {
    const handles = initialWarpDeformHandles('deform', BOX).map((handle, index) =>
      index === 1 || index === 2 ? { x: handle.x, y: handle.y - 30 } : handle,
    );
    const map = deformMap(BOX, handles);
    const left = map.apply({ x: 10, y: 20 });
    const middle = map.apply({ x: 60, y: 20 });
    const right = map.apply({ x: 110, y: 20 });
    expect(left.y).toBeCloseTo(20, 9);
    expect(right.y).toBeCloseTo(20, 9);
    expect(middle.y).toBeCloseTo(20 - 30 * 0.75, 9);
  });
});

describe('warpDeformBox', () => {
  it('opens a flat selection up so the handles have somewhere to sit', () => {
    expect(warpDeformBox({ minX: 0, minY: 5, maxX: 100, maxY: 5 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 10,
    });
    expect(warpDeformBox({ minX: 2, minY: 2, maxX: 2, maxY: 2 })).toEqual({
      minX: 1.5,
      minY: 1.5,
      maxX: 2.5,
      maxY: 2.5,
    });
    expect(warpDeformBox(BOX)).toEqual(BOX);
  });
});

describe('warpDeformStretch', () => {
  it('is 1 for handles that leave the artwork alone and grows with the stretch', () => {
    const identity = warpDeformMap('warp', BOX, initialWarpDeformHandles('warp', BOX));
    expect(warpDeformStretch(identity, BOX)).toBeCloseTo(1, 6);
    const doubled = warpMap(BOX, [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 140 },
      { x: 10, y: 140 },
    ]);
    expect(warpDeformStretch(doubled, BOX)).toBeCloseTo(2, 6);
  });
});
