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

// Display simplification of oversized traces happens upstream in
// display-polylines.ts (see its tests); the stroke helper's contract is to
// draw exactly the polylines it is given.
describe('strokePolylinesBatched', () => {
  it('draws every segment it is given', () => {
    const { ctx, calls } = countingContext();
    strokePolylinesBatched(
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
    );

    expect(calls.lineTo).toBe(2);
  });
});
