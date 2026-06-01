import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../../core/scene';
import { countPolylineSegments } from './draw-complexity';
import { createDisplayPolylineCache } from './display-polylines';

describe('display polyline cache', () => {
  it('builds a bounded display copy without reading every source point', () => {
    const cache = createDisplayPolylineCache();
    const pointCount = 30_001;
    const budget = 3_000;
    const readBudget = 8_000;
    let pointReads = 0;
    const points = watchedPoints(pointCount, () => {
      pointReads += 1;
    });

    const display = cache.get([{ closed: false, points }], budget);

    expect(display.isSimplified).toBe(true);
    expect(countPolylineSegments(display.polylines)).toBeLessThanOrEqual(budget);
    expect(pointReads).toBeLessThan(readBudget);
  });

  it('reuses the sampled display copy for the same immutable source polylines', () => {
    const cache = createDisplayPolylineCache();
    const pointCount = 30_001;
    let pointReads = 0;
    const source = [
      {
        closed: false,
        points: watchedPoints(pointCount, () => {
          pointReads += 1;
        }),
      },
    ];

    const first = cache.get(source);
    const readsAfterFirst = pointReads;
    const second = cache.get(source);

    expect(second).toBe(first);
    expect(pointReads).toBe(readsAfterFirst);
  });
});

function watchedPoints(length: number, onRead: () => void): ReadonlyArray<Vec2> {
  return new Proxy(
    Array.from({ length }, (_, x) => ({ x, y: 0 })),
    {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) onRead();
        return Reflect.get(target, prop, receiver);
      },
    },
  );
}
