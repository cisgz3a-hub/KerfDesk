import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { startLiveCanvasRun, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import { burnWidthPx, drawBurnTail } from './draw-burn-trail';

/**
 * A raster fill hatched finer than one device pixel: the case where the old
 * fixed 2.4px trail overlapped into a solid mass that hid the artwork.
 */
const HATCH_GCODE = ['G21', 'G90', 'M3 S0', 'G0 X0 Y0']
  .concat(
    Array.from({ length: 40 }, (_, row) => {
      const y = (row * 0.05).toFixed(3);
      const sweep = row % 2 === 0 ? 'G1 X10 S500' : 'G1 X0 S500';
      return [`G0 Y${y}`, sweep];
    }).flat(),
  )
  .join('\n');

function plan(gcode = HATCH_GCODE, machineKind: 'laser' | 'cnc' = 'laser'): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, { machineKind }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: `burn-trail-${machineKind}`,
    machineKind,
    device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
    ],
    jobStart: { x: 0, y: 0 },
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

function strokeRecorder(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly strokes: ReadonlyArray<{
    readonly color: string;
    readonly widthPx: number;
    readonly alpha: number;
    readonly points: number;
  }>;
} {
  const strokes: Array<{ color: string; widthPx: number; alpha: number; points: number }> = [];
  let color = '';
  let widthPx = 0;
  let alpha = 1;
  let points = 0;
  const stack: number[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'globalAlpha') return alpha;
        if (prop === 'save') return () => stack.push(alpha);
        if (prop === 'restore') return () => (alpha = stack.pop() ?? 1);
        if (prop === 'beginPath') return () => (points = 0);
        if (prop === 'moveTo' || prop === 'lineTo') return () => (points += 1);
        if (prop === 'stroke') return () => strokes.push({ color, widthPx, alpha, points });
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'globalAlpha' && typeof value === 'number') alpha = value;
        if (prop === 'strokeStyle' && typeof value === 'string') color = value;
        if (prop === 'lineWidth' && typeof value === 'number') widthPx = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, strokes };
}

describe('burnWidthPx', () => {
  it('clamps the burn mark so a sub-pixel hatch can never blot out the artwork', () => {
    const laser = plan();
    // Zoomed far out and far in, the mark stays inside the readable band. The
    // regression was a flat 2.4px at every zoom, which on this hatch (0.05 mm
    // apart) overlapped roughly three deep into one solid mass.
    for (const scale of [0.2, 1, 4, 20, 400]) {
      const width = burnWidthPx(laser, { scale, offsetX: 0, offsetY: 0 });
      expect(width).toBeGreaterThanOrEqual(1.1);
      expect(width).toBeLessThanOrEqual(3);
    }
  });

  it('widens toward the real kerf as the operator zooms in', () => {
    const laser = plan();
    const far = burnWidthPx(laser, { scale: 2, offsetX: 0, offsetY: 0 });
    const near = burnWidthPx(laser, { scale: 12, offsetX: 0, offsetY: 0 });
    expect(near).toBeGreaterThan(far);
  });

  it('scales a CNC trail from the bit rather than the laser spot', () => {
    // At this zoom the millimetre-scale bit is off the floor while the 0.18 mm
    // laser spot is still pinned to it, so the two must not render alike.
    const view = { scale: 2, offsetX: 0, offsetY: 0 };
    expect(burnWidthPx(plan(HATCH_GCODE, 'cnc'), view)).toBeGreaterThan(
      burnWidthPx(plan(HATCH_GCODE, 'laser'), view),
    );
  });
});

describe('drawBurnTail', () => {
  function liveRun(canvasPlan: CanvasMotionPlan, confirmedRouteMm: number) {
    return {
      ...startLiveCanvasRun(canvasPlan),
      route: { confirmedRouteMm, candidates: [], uncertain: false },
    };
  }

  it('paints a cooling ramp behind the head, hottest band last and widest', () => {
    const canvasPlan = plan();
    const recording = strokeRecorder();
    drawBurnTail(recording.ctx, canvasPlan, liveRun(canvasPlan, 60), {
      scale: 8,
      offsetX: 0,
      offsetY: 0,
    });
    expect(recording.strokes.length).toBeGreaterThan(1);
    const first = recording.strokes[0];
    const last = recording.strokes[recording.strokes.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    expect(last.alpha).toBeGreaterThan(first.alpha);
    expect(last.widthPx).toBeGreaterThan(first.widthPx);
    expect(last.color).not.toBe(first.color);
  });

  it('stops glowing once the run is finished', () => {
    const canvasPlan = plan();
    const recording = strokeRecorder();
    drawBurnTail(
      recording.ctx,
      canvasPlan,
      { ...liveRun(canvasPlan, 60), lifecycle: 'finished' },
      { scale: 8, offsetX: 0, offsetY: 0 },
    );
    expect(recording.strokes).toEqual([]);
  });

  it('draws nothing before the controller confirms any route', () => {
    const canvasPlan = plan();
    const recording = strokeRecorder();
    drawBurnTail(recording.ctx, canvasPlan, liveRun(canvasPlan, 0), {
      scale: 8,
      offsetX: 0,
      offsetY: 0,
    });
    expect(recording.strokes).toEqual([]);
  });

  it('leaves rapids cold — only cutting motion is hot', () => {
    // Pure rapid: the head has moved, but nothing was burned, so no ember.
    const rapid = plan('G21\nG90\nM3 S0\nG0 X0 Y0\nG0 X40 Y0');
    const recording = strokeRecorder();
    drawBurnTail(recording.ctx, rapid, liveRun(rapid, 40), {
      scale: 8,
      offsetX: 0,
      offsetY: 0,
    });
    expect(recording.strokes).toEqual([]);
  });

  it('walks only the tail window, not the whole confirmed route', () => {
    const long = plan('G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X1000 S500');
    const recording = strokeRecorder();
    drawBurnTail(recording.ctx, long, liveRun(long, 1000), {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const drawn = recording.strokes.reduce((total, stroke) => total + stroke.points, 0);
    // Six bands of a clipped 18 mm window: a couple of points each, not the
    // 1000 mm of route already settled into the scorch raster.
    expect(drawn).toBeLessThanOrEqual(24);
    expect(drawn).toBeGreaterThan(0);
  });
});
