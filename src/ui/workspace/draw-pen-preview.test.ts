import { describe, expect, it } from 'vitest';
import type { PenNode } from '../../core/shapes/pen-path';
import { drawPenOverlay, type PenOverlay } from './draw-pen-preview';
import type { PenHover } from './pen-draft';

// 2 px per mm, offset 100 px, so a scene point maps to 100 + 2 * mm.
const VIEW = { scale: 2, offsetX: 100, offsetY: 100 };

type Call = { readonly name: string; readonly args: ReadonlyArray<unknown> };

// A canvas context that records every call, so the overlay's drawing order can
// be read back without a real canvas.
function recordingContext(): { readonly ctx: CanvasRenderingContext2D; readonly calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (_, name) =>
      name in state
        ? state[name]
        : (...args: unknown[]) => calls.push({ name: String(name), args }),
    set: (_, name, value) => {
      state[name] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function draw(overlay: PenOverlay): ReadonlyArray<Call> {
  const { ctx, calls } = recordingContext();
  drawPenOverlay(ctx, overlay, VIEW);
  return calls;
}

function corners(...points: ReadonlyArray<[number, number]>): PenNode[] {
  return points.map(([x, y]) => ({ kind: 'corner', point: { x, y } }));
}

function hover(x: number, y: number, extra: Partial<PenHover> = {}): PenHover {
  return { point: { x, y }, snap: null, intent: 'place', ...extra };
}

function named(calls: ReadonlyArray<Call>, name: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return calls.filter((call) => call.name === name).map((call) => call.args);
}

describe('drawPenOverlay (ADR-380)', () => {
  it('draws placed segments solid and the segment to the pointer dashed', () => {
    const calls = draw({
      draft: { nodes: corners([0, 0], [10, 0]) },
      hover: hover(10, 10),
      mode: 'corner',
    });

    const dashAt = calls.findIndex((call) => call.name === 'setLineDash');
    expect(named(calls, 'setLineDash')).toEqual([[[4, 3]], [[]]]);
    const solid = calls.slice(0, dashAt).filter((call) => call.name === 'lineTo');
    const dashed = calls.slice(dashAt).filter((call) => call.name === 'lineTo');
    expect(solid.map((call) => call.args)).toEqual([[120, 100]]);
    expect(dashed[0]?.args).toEqual([120, 120]);
  });

  it('bends both sides of a dragged smooth node and shows its handles', () => {
    const smooth: PenNode = { kind: 'smooth', point: { x: 10, y: 0 }, handleOut: { x: 15, y: 0 } };
    const calls = draw({
      draft: { nodes: [...corners([0, 0]), smooth] },
      hover: hover(20, 10),
      mode: 'corner',
    });

    expect(named(calls, 'bezierCurveTo')).toHaveLength(2);
    // The handle line runs from the mirrored handle to the dragged one.
    expect(named(calls, 'moveTo')).toContainEqual([110, 100]);
    expect(named(calls, 'lineTo')).toContainEqual([130, 100]);
  });

  it('rings a join target, marks the snap and badges smooth mode', () => {
    const calls = draw({
      draft: { nodes: corners([0, 0], [10, 0]) },
      hover: hover(20, 0, { snap: 'endpoint', intent: 'join' }),
      mode: 'smooth',
    });

    const arcs = named(calls, 'arc');
    expect(arcs.some((args) => args[0] === 140 && args[1] === 100 && args[2] === 8)).toBe(true);
    expect(arcs.some((args) => args[0] === 150 && args[1] === 110)).toBe(true);
  });

  it('draws a plus for a grid snap', () => {
    const calls = draw({ draft: null, hover: hover(5, 5, { snap: 'grid' }), mode: 'corner' });

    expect(named(calls, 'moveTo')).toEqual([
      [105, 110],
      [110, 105],
    ]);
  });
});
