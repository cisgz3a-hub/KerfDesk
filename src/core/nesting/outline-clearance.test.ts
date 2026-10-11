import { describe, expect, it } from 'vitest';
import { validateNest, outlineNest, type OutlineNestItem } from './outline-compact-nest';
import { placedState } from './nest-outline-geometry';
import { outlinesCloserThan } from './outline-clearance';

const triangle: OutlineNestItem = {
  id: 'a',
  width: 30,
  height: 30,
  canRotate: true,
  outline: [
    [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 30 },
    ],
  ],
};
const bin = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
describe('actual contour spacing', () => {
  it('rejects the measured 1.999 mm triangle gap despite rounded offset polygons', () => {
    const items = [triangle, { ...triangle, id: 'b' }];
    const placements = [
      { id: 'a', x: 1, y: 1, rotated90: true, rotationDeg: 90 as const },
      { id: 'b', x: 1, y: 32.999, rotated90: true, rotationDeg: 90 as const },
    ];
    expect(validateNest(bin, items, placements, { padding: 2 })).toBe(false);
    expect(
      validateNest(bin, items, [placements[0]!, { ...placements[1]!, y: 33 }], { padding: 2 }),
    ).toBe(true);
  });
  it('uses exact clearance bounds for a rounded triangle corner', () => {
    const state = placedState(
      triangle,
      { id: 'a', x: 1, y: 1, rotated90: true, rotationDeg: 90 },
      2,
    );
    expect(state.bounds).toEqual({ minX: 0, minY: 0, maxX: 32, maxY: 32 });
  });
  it('does not compact two triangles below their declared spacing', () => {
    const items = [triangle, { ...triangle, id: 'b' }];
    const result = outlineNest(bin, items, { padding: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = placedState(items[0]!, result.placements.find((p) => p.id === 'a')!, 2);
    const b = placedState(items[1]!, result.placements.find((p) => p.id === 'b')!, 2);
    expect(outlinesCloserThan(a.sourcePaths, b.sourcePaths, 2)).toBe(false);
  });
  it('checks sloping edges and crossing segments independently of rounded offsets', () => {
    const a = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    ];
    expect(
      outlinesCloserThan(
        a,
        [
          [
            { x: 0, y: 2.82 },
            { x: 10, y: 12.82 },
          ],
        ],
        2,
      ),
    ).toBe(true);
    expect(
      outlinesCloserThan(
        a,
        [
          [
            { x: 0, y: 3 },
            { x: 10, y: 13 },
          ],
        ],
        2,
      ),
    ).toBe(false);
    expect(
      outlinesCloserThan(
        a,
        [
          [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
        ],
        2,
      ),
    ).toBe(true);
  });
});
