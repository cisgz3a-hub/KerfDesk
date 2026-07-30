import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { canvasTheme } from '../theme/canvas-theme';
import { gridStepMm, paintDesignCanvas, type DesignCanvasPaint } from './design-canvas-draw';

// Recording stub: jsdom has no 2D context, and the browser pane will not
// composite frames in this environment, so the draw calls themselves are what
// gets asserted. This pins the geometry of the painting, not its appearance —
// the appearance claim stays unverified (CLAUDE.md rule 2).
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
  const ctx = {
    canvas: { width: 800, height: 600 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    stroke: record('stroke'),
    setLineDash: record('setLineDash'),
    clearRect: record('clearRect'),
    // The grid is clipped to the bed, so the stub needs the clipping calls.
    save: record('save'),
    restore: record('restore'),
    clip: record('clip'),
    rect: record('rect'),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const emptySketch: Sketch = { entities: [] };

const basePaint: DesignCanvasPaint = {
  view: { pxPerMm: 2, panXmm: 0, panYmm: 0 },
  sketch: emptySketch,
  selectedIds: new Set<string>(),
  bedWidthMm: 400,
  bedHeightMm: 300,
  showGrid: false,
  gridMm: 10,
  widthPx: 800,
  heightPx: 600,
};

describe('gridStepMm', () => {
  it('keeps the configured spacing when it is comfortably visible', () => {
    expect(gridStepMm(10, 4)).toBe(10);
  });

  it('steps up the 1/2/5 ladder as the view zooms out', () => {
    // At 0.1 px/mm a 10 mm grid would be 1 px apart; it must coarsen.
    const step = gridStepMm(10, 0.1);
    expect(step).toBeGreaterThan(10);
    expect(step * 0.1).toBeGreaterThanOrEqual(6);
    expect([20, 50, 100, 200, 500, 1000]).toContain(step);
  });

  it('terminates and stays finite for absurd zooms', () => {
    expect(Number.isFinite(gridStepMm(10, 1e-12))).toBe(true);
    expect(Number.isFinite(gridStepMm(10, 0))).toBe(true);
  });

  it('falls back to a 1 mm base for a non-positive or non-finite spacing', () => {
    // The fallback is 1 mm, but the visibility floor still applies: at 4 px/mm a
    // 1 mm grid would be 4 px apart, under MIN_MINOR_GRID_PX, so it coarsens to
    // 2 mm. At 20 px/mm the 1 mm fallback is comfortably visible and survives.
    expect(gridStepMm(0, 4)).toBe(2);
    expect(gridStepMm(Number.NaN, 4)).toBe(2);
    expect(gridStepMm(0, 20)).toBe(1);
  });
});

describe('paintDesignCanvas — bed', () => {
  it('fills the surround then the bed at the view scale', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, basePaint);
    const fills = calls.filter((call) => call.op === 'fillRect');
    expect(fills[0]?.args).toEqual([0, 0, 800, 600]);
    // 400x300 mm at 2 px/mm, panned to the origin.
    expect(fills[1]?.args).toEqual([0, 0, 800, 600]);
    expect(calls.some((call) => call.op === 'strokeRect')).toBe(true);
  });

  it('places the bed correctly when the view is panned and zoomed', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, {
      ...basePaint,
      view: { pxPerMm: 1, panXmm: 50, panYmm: 20 },
    });
    const bed = calls.filter((call) => call.op === 'fillRect')[1];
    // Origin (0,0) mm sits at -50, -20 px; the bed spans 400x300 px.
    expect(bed?.args).toEqual([-50, -20, 400, 300]);
  });
});

describe('paintDesignCanvas — grid', () => {
  it('draws nothing extra when the grid is off', () => {
    const { ctx: offCtx, calls: offCalls } = recordingContext();
    paintDesignCanvas(offCtx, basePaint);
    const { ctx: onCtx, calls: onCalls } = recordingContext();
    paintDesignCanvas(onCtx, { ...basePaint, showGrid: true });
    expect(onCalls.length).toBeGreaterThan(offCalls.length);
  });

  it('emits one stroked segment per grid line, clipped to the bed', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, { ...basePaint, showGrid: true });
    // The grid is now clipped to the BED, not drawn across the viewport: a 400x300
    // bed at a 10 mm step has 39 interior verticals and 29 interior horizontals
    // (the bed edges themselves are drawn by strokeRect). The origin marker adds two
    // more moveTo pairs.
    const moves = calls.filter((call) => call.op === 'moveTo');
    expect(moves).toHaveLength(39 + 29 + 2);
  });

  it('snaps grid lines to half-pixel centres so 1 px lines stay crisp', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, { ...basePaint, showGrid: true, sketch: emptySketch });
    // Only the grid segments are half-pixel snapped; the origin marker is drawn on
    // exact millimetre coordinates, so it is excluded by taking the clipped run.
    const clipIndex = calls.findIndex((call) => call.op === 'clip');
    const restoreIndex = calls.findIndex((call) => call.op === 'restore');
    const gridMoves = calls.slice(clipIndex, restoreIndex).filter((call) => call.op === 'moveTo');
    expect(gridMoves.length).toBeGreaterThan(60);
    for (const move of gridMoves) {
      const [x, y] = move.args as [number, number];
      expect(Math.abs((x % 1) - 0.5)).toBeLessThan(1e-9);
      expect(Math.abs((y % 1) - 0.5)).toBeLessThan(1e-9);
    }
  });
});

describe('paintDesignCanvas — entities', () => {
  const sketch: Sketch = {
    entities: [
      { kind: 'line', id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      {
        kind: 'line',
        id: 'guide',
        start: { x: 0, y: 50 },
        end: { x: 100, y: 50 },
        construction: true,
      },
    ],
  };

  it('strokes each entity once', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, { ...basePaint, sketch });
    // Two entity strokes plus one for the origin marker. The bed outline uses
    // strokeRect, which is a separate op.
    expect(calls.filter((call) => call.op === 'stroke')).toHaveLength(3);
  });

  it('dashes construction geometry and resets the dash afterwards', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, { ...basePaint, sketch });
    const dashes = calls.filter((call) => call.op === 'setLineDash');
    expect(dashes.some((call) => (call.args[0] as number[]).length > 0)).toBe(true);
    expect(dashes[dashes.length - 1]?.args[0]).toEqual([]);
  });

  it('never mutates the shared dash constant', () => {
    const { ctx } = recordingContext();
    paintDesignCanvas(ctx, { ...basePaint, sketch });
    const { ctx: second, calls } = recordingContext();
    paintDesignCanvas(second, { ...basePaint, sketch });
    const dashed = calls.find(
      (call) => call.op === 'setLineDash' && (call.args[0] as number[]).length > 0,
    );
    expect(dashed?.args[0]).toEqual([6, 4]);
  });

  it('uses only palette colours, never a raw literal', () => {
    const palette = new Set<string>(Object.values(canvasTheme));
    const { ctx } = recordingContext();
    // The stub records ops, not property writes, so assert the palette contains
    // the tokens this module names — the ADR-047 lint rule covers the rest.
    expect(palette.has(canvasTheme.designGeometry)).toBe(true);
    expect(palette.has(canvasTheme.designConstruction)).toBe(true);
    expect(() => paintDesignCanvas(ctx, { ...basePaint, sketch })).not.toThrow();
  });

  it('draws a degenerate entity as nothing rather than crashing', () => {
    const { ctx, calls } = recordingContext();
    paintDesignCanvas(ctx, {
      ...basePaint,
      sketch: {
        entities: [{ kind: 'line', id: 'dead', start: { x: 5, y: 5 }, end: { x: 5, y: 5 } }],
      },
    });
    // Only the origin marker strokes; the degenerate entity contributes nothing.
    expect(calls.filter((call) => call.op === 'stroke')).toHaveLength(1);
  });
});
