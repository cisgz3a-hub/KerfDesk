import { expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { groupFillContoursIntoIslands } from './island-fill';

it.each([0.4, 1])(
  'groups 150,000 contours at pitch %s without argument-limited bounds',
  (pitch) => {
    const contours = Array.from({ length: 150_000 }, (_, index): Polyline => {
      const x = index * pitch;
      return {
        closed: true,
        points: [
          { x, y: 0 },
          { x: x + 0.2, y: 0 },
          { x: x + 0.2, y: 0.2 },
          { x, y: 0.2 },
        ],
      };
    });
    const islands = groupFillContoursIntoIslands(contours);
    expect(islands).toHaveLength(pitch === 0.4 ? 1 : contours.length);
    expect(islands.reduce((count, island) => count + island.length, 0)).toBe(contours.length);
    expect(new Set(islands.flatMap((island) => island)).size).toBe(contours.length);
  },
);
