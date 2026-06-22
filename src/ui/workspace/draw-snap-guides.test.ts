import { describe, expect, it } from 'vitest';
import { drawSnapGuides } from './draw-snap-guides';
import type { SnapGuide } from './snapping';
import type { ViewTransform } from './view-transform';

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: Array<{ readonly name: string; readonly args: ReadonlyArray<number> }>;
} {
  const calls: Array<{ readonly name: string; readonly args: ReadonlyArray<number> }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'moveTo' || prop === 'lineTo') {
          return (...args: ReadonlyArray<number>) => {
            calls.push({ name: String(prop), args });
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

const view: ViewTransform = { scale: 2, offsetX: 10, offsetY: 100 };

describe('drawSnapGuides', () => {
  it('draws vertical and horizontal guide lines in viewport coordinates', () => {
    const guides: ReadonlyArray<SnapGuide> = [
      { axis: 'x', positionMm: 20, fromMm: 5, toMm: 15 },
      { axis: 'y', positionMm: 30, fromMm: 12, toMm: 22 },
    ];
    const { ctx, calls } = recordingContext();

    drawSnapGuides(ctx, guides, view);

    expect(calls).toContainEqual({ name: 'moveTo', args: [50, 110] });
    expect(calls).toContainEqual({ name: 'lineTo', args: [50, 130] });
    expect(calls).toContainEqual({ name: 'moveTo', args: [34, 160] });
    expect(calls).toContainEqual({ name: 'lineTo', args: [54, 160] });
  });
});
