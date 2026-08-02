import { describe, expect, it } from 'vitest';
import { paintDesignOverlay, type DesignOverlayPaint } from './design-overlay-draw';

type Call = { readonly op: string; readonly args: ReadonlyArray<unknown> };

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly calls: ReadonlyArray<Call>;
} {
  const calls: Call[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };
  return {
    ctx: {
      clearRect: record('clearRect'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      stroke: record('stroke'),
      setLineDash: record('setLineDash'),
    } as unknown as CanvasRenderingContext2D,
    calls,
  };
}

const basePaint: DesignOverlayPaint = {
  view: { pxPerMm: 2, panXmm: 0, panYmm: 0 },
  draft: null,
  pointSequence: null,
  marquee: null,
  measuredEntity: null,
  measuredField: null,
  snap: null,
  widthPx: 800,
  heightPx: 600,
};

describe('paintDesignOverlay point sequence', () => {
  it('strokes confirmed Polyline segments plus the live pointer segment', () => {
    const { ctx, calls } = recordingContext();
    paintDesignOverlay(ctx, {
      ...basePaint,
      pointSequence: {
        kind: 'path',
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 20 },
        ],
        pointerMm: { x: 30, y: 40 },
      },
    });
    expect(calls.filter((call) => call.op === 'moveTo')).toEqual([
      { op: 'moveTo', args: [20, 40] },
    ]);
    expect(calls.filter((call) => call.op === 'lineTo')).toEqual([
      { op: 'lineTo', args: [60, 40] },
      { op: 'lineTo', args: [60, 80] },
    ]);
    expect(calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });

  it('strokes the shared sampled Arc preview after centre and start are set', () => {
    const { ctx, calls } = recordingContext();
    paintDesignOverlay(ctx, {
      ...basePaint,
      pointSequence: {
        kind: 'arc',
        centerMm: { x: 20, y: 20 },
        startMm: { x: 40, y: 20 },
        pointerMm: { x: 20, y: 40 },
      },
    });
    expect(calls.filter((call) => call.op === 'moveTo')).toHaveLength(1);
    expect(calls.filter((call) => call.op === 'lineTo').length).toBeGreaterThan(2);
    expect(calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });
});
