import { describe, expect, it } from 'vitest';

import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { strokePolylinesBatched } from './draw-vector-strokes';
import type { ViewTransform } from './view-transform';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number };
} {
  const calls = { lineTo: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') {
          return () => {
            calls.lineTo += 1;
          };
        }
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, calls };
}

function object(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'o1',
    source: 'shape.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

describe('strokePolylinesBatched', () => {
  it('draws every segment when the stride is one', () => {
    const { ctx, calls } = countingContext();
    const simplified = strokePolylinesBatched(
      ctx,
      object(),
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ],
      view,
      1,
    );

    expect(simplified).toBe(false);
    expect(calls.lineTo).toBe(2);
  });

  it('draws every Nth segment when the scene exceeds the visual budget', () => {
    const { ctx, calls } = countingContext();
    const points = Array.from({ length: 7 }, (_, x) => ({ x, y: 0 }));
    const simplified = strokePolylinesBatched(ctx, object(), [{ closed: false, points }], view, 2);

    expect(simplified).toBe(true);
    expect(calls.lineTo).toBe(3);
  });

  it('does not visit every source point when drawing a sampled trace', () => {
    const { ctx, calls } = countingContext();
    const pointCount = 30_001;
    const stride = 10;
    const readBudget = 8_000;
    let pointReads = 0;
    const points = new Proxy(
      Array.from({ length: pointCount }, (_, x) => ({ x, y: 0 })),
      {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && /^\d+$/.test(prop)) pointReads += 1;
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    const simplified = strokePolylinesBatched(
      ctx,
      object(),
      [{ closed: false, points }],
      view,
      stride,
    );

    expect(simplified).toBe(true);
    expect(calls.lineTo).toBe(3_000);
    expect(pointReads).toBeLessThan(readBudget);
  });
});
