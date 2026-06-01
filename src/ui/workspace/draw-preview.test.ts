import { describe, expect, it } from 'vitest';

import type { Toolpath } from '../../core/job';
import { drawPreview } from './draw-preview';
import type { ViewTransform } from './view-transform';

function countingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: { lineTo: number; moveTo: number };
} {
  const calls = { lineTo: 0, moveTo: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'lineTo') {
          return () => {
            calls.lineTo += 1;
          };
        }
        if (prop === 'moveTo') {
          return () => {
            calls.moveTo += 1;
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

const view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };

describe('drawPreview', () => {
  it('renders a precomputed toolpath without compiling the project in the draw loop', () => {
    const toolpath: Toolpath = {
      totalLength: 2,
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          length: 2,
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ],
    };
    const { ctx, calls } = countingContext();

    drawPreview(ctx, toolpath, view, 1);

    expect(calls.moveTo).toBe(1);
    expect(calls.lineTo).toBe(2);
  });

  it('samples oversized preview cuts without visiting every point on each redraw', () => {
    const pointCount = 30_001;
    const readBudget = 22_000;
    let pointReads = 0;
    const toolpath: Toolpath = {
      totalLength: 1,
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          length: 1,
          polyline: new Proxy(
            Array.from({ length: pointCount }, (_, x) => ({ x, y: 0 })),
            {
              get(target, prop, receiver) {
                if (typeof prop === 'string' && /^\d+$/.test(prop)) pointReads += 1;
                return Reflect.get(target, prop, receiver);
              },
            },
          ),
        },
      ],
    };
    const { ctx, calls } = countingContext();

    drawPreview(ctx, toolpath, view, 1);

    expect(calls.lineTo).toBeLessThan(12_000);
    expect(pointReads).toBeLessThan(readBudget);
  });
});
