import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import {
  startLiveCanvasRun,
  type CanvasMotionPlan,
  type LiveCanvasLifecycle,
} from '../state/canvas-motion-plan';
import { drawCanvasMotionOverlay } from './draw-canvas-motion';
import { drawBurnTail } from './draw-burn-trail';

afterEach(() => vi.unstubAllGlobals());

function plan(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: gcode,
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: null,
    approachFrom: null,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

function run(canvasPlan: CanvasMotionPlan, mm: number, lifecycle: LiveCanvasLifecycle = 'running') {
  return {
    ...startLiveCanvasRun(canvasPlan),
    lifecycle,
    route: { confirmedRouteMm: mm, candidates: [], uncertain: false },
    reportedHead: { x: mm, y: 0, z: 0 },
    controllerState: lifecycle === 'running' ? 'Run' : 'Idle',
  };
}

function recorder() {
  const colors: string[] = [];
  const strokes: Array<ReadonlyArray<{ x: number; y: number }>> = [];
  let points: Array<{ x: number; y: number }> = [];
  let color = '';
  let alpha = 1;
  const stack: number[] = [];
  const gradient = vi.fn(() => ({ addColorStop: vi.fn() }));
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'globalAlpha') return alpha;
        if (prop === 'createRadialGradient') return gradient;
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'save') return () => stack.push(alpha);
        if (prop === 'restore')
          return () => {
            alpha = stack.pop() ?? 1;
          };
        if (prop === 'beginPath')
          return () => {
            points = [];
          };
        if (prop === 'moveTo' || prop === 'lineTo')
          return (x: number, y: number) => points.push({ x, y });
        if (prop === 'stroke')
          return () => {
            colors.push(color);
            strokes.push(points);
          };
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'strokeStyle') color = value;
        if (prop === 'globalAlpha') alpha = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, gradient, colors, strokes };
}

describe('burn indicator state and segmentation', () => {
  it('does not show a hot beam on an entirely M5/G0 route', () => {
    const canvasPlan = plan('G21\nG90\nM5\nG0 X40');
    expect(canvasPlan.manifest.blocks.every((block) => block.kind !== 'process')).toBe(true);
    const recorded = recorder();
    drawCanvasMotionOverlay(
      recorded.ctx,
      { plan: canvasPlan, run: run(canvasPlan, 20) },
      { scale: 2, offsetX: 0, offsetY: 0 },
    );
    expect(recorded.gradient).not.toHaveBeenCalled();
  });

  it.each(['paused', 'tool-change', 'stopped', 'errored', 'disconnected', 'finished'] as const)(
    'does not keep a hot beam after %s',
    (lifecycle) => {
      const canvasPlan = plan('G21\nG90\nM3 S0\nG0 X0\nG1 X100 S500');
      const recorded = recorder();
      drawCanvasMotionOverlay(
        recorded.ctx,
        { plan: canvasPlan, run: run(canvasPlan, 50, lifecycle) },
        { scale: 2, offsetX: 0, offsetY: 0 },
      );
      expect(recorded.gradient).not.toHaveBeenCalled();
    },
  );

  it.each([0, 5, 10, 15, 25, 30])('shows heat only inside the powered motion at %s mm', (mm) => {
    const canvasPlan = plan('G21\nG90\nM3 S0\nG0 X0\nG1 X10 S500\nG1 X20 S0\nM5\nG1 X30');
    const recorded = recorder();
    drawCanvasMotionOverlay(
      recorded.ctx,
      { plan: canvasPlan, run: run(canvasPlan, mm) },
      { scale: 2, offsetX: 0, offsetY: 0 },
    );
    expect(recorded.gradient).toHaveBeenCalledTimes(mm === 5 ? 1 : 0);
  });

  it.each(['uncertain', 'off', 'idle', 'ambiguous'] as const)(
    'does not show heat for %s motion evidence',
    (state) => {
      const canvasPlan = plan('G21\nG90\nM3 S0\nG0 X0\nG1 X10 S500\nG1 X20 S0');
      const active = run(canvasPlan, 5);
      const uncertain = state === 'uncertain';
      const travelIndex = canvasPlan.manifest.blocks.findIndex(
        (block) => block.routeStartMm === 10,
      );
      expect(travelIndex).toBeGreaterThanOrEqual(0);
      const current = {
        ...active,
        reportedSpindleRpm: state === 'off' ? 0 : 500,
        controllerState: state === 'idle' ? 'Idle' : 'Run',
        route: {
          ...active.route,
          uncertain,
          candidates:
            state === 'ambiguous'
              ? [
                  {
                    blockIndex: travelIndex,
                    segmentIndex: 0,
                    routeMm: 15,
                    distanceMm: 0,
                  },
                ]
              : [],
        },
      };
      const recorded = recorder();
      drawCanvasMotionOverlay(
        recorded.ctx,
        { plan: canvasPlan, run: current },
        { scale: 2, offsetX: 0, offsetY: 0 },
      );
      expect(recorded.gradient).not.toHaveBeenCalled();
      const tail = recorder();
      drawBurnTail(tail.ctx, canvasPlan, current, { scale: 2, offsetX: 0, offsetY: 0 });
      expect(tail.strokes).toEqual([]);
    },
  );

  it('gives equivalent straight burns the same cooling bands regardless of G-code segmentation', () => {
    const single = plan('G21\nG90\nM3 S0\nG0 X0\nG1 X100 S500');
    const subdivided = plan(
      [
        'G21',
        'G90',
        'M3 S0',
        'G0 X0',
        ...Array.from({ length: 100 }, (_, index) => `G1 X${index + 1} S500`),
      ].join('\n'),
    );
    const one = recorder();
    const many = recorder();
    const view = { scale: 2, offsetX: 0, offsetY: 0 };
    drawBurnTail(one.ctx, single, run(single, 50), view);
    drawBurnTail(many.ctx, subdivided, run(subdivided, 50), view);
    expect(new Set(many.colors).size).toBe(6);
    expect(new Set(one.colors)).toEqual(new Set(many.colors));
    for (let i = 0; i < 6; i += 1) {
      for (const recorded of [one, many]) {
        const xs = recorded.strokes[i]?.map((point) => point.x) ?? [];
        expect(Math.min(...xs)).toBeCloseTo(64 + i * 6, 9);
        expect(Math.max(...xs)).toBeCloseTo(70 + i * 6, 9);
      }
    }
  });
});
