import { describe, expect, it } from 'vitest';

import { mergeCollinearOpenPolylines } from './centerline-merge';

describe('mergeCollinearOpenPolylines', () => {
  it('joins straight open segments across a small pruned-junction gap', () => {
    const polylines = mergeCollinearOpenPolylines(
      [
        {
          closed: false,
          points: [
            { x: 2, y: 5 },
            { x: 10, y: 5 },
          ],
        },
        {
          closed: false,
          points: [
            { x: 12, y: 5 },
            { x: 20, y: 5 },
          ],
        },
      ],
      1,
    );

    expect(polylines).toHaveLength(1);
    expect(polylines[0]?.points).toEqual([
      { x: 2, y: 5 },
      { x: 20, y: 5 },
    ]);
  });

  it('keeps angled branches separate', () => {
    const polylines = mergeCollinearOpenPolylines(
      [
        {
          closed: false,
          points: [
            { x: 2, y: 5 },
            { x: 10, y: 5 },
          ],
        },
        {
          closed: false,
          points: [
            { x: 10, y: 5 },
            { x: 14, y: 9 },
          ],
        },
      ],
      1,
    );

    expect(polylines).toHaveLength(2);
  });
});
