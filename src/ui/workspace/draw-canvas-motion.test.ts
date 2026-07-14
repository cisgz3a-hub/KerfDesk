import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { startLiveCanvasRun, type CanvasMotionPlan } from '../state/canvas-motion-plan';
import { drawCanvasMotionOverlay } from './draw-canvas-motion';

function recordingContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly labels: string[];
  readonly labelAlphas: ReadonlyArray<{ readonly label: string; readonly alpha: number }>;
  readonly dashes: number[][];
  readonly fillAlphas: number[];
  readonly fillStyles: string[];
  readonly strokeStyles: string[];
} {
  const labels: string[] = [];
  const labelAlphas: Array<{ label: string; alpha: number }> = [];
  const dashes: number[][] = [];
  const fillAlphas: number[] = [];
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const alphaStack: number[] = [];
  let alpha = 1;
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') {
          return (label: string) => {
            labels.push(label);
            labelAlphas.push({ label, alpha });
          };
        }
        if (prop === 'globalAlpha') return alpha;
        if (prop === 'save') return () => alphaStack.push(alpha);
        if (prop === 'restore') return () => (alpha = alphaStack.pop() ?? 1);
        if (prop === 'fill') return () => fillAlphas.push(alpha);
        if (prop === 'measureText') return () => ({ width: 40 });
        if (prop === 'setLineDash') return (dash: number[]) => dashes.push(dash);
        return () => undefined;
      },
      set(_target, prop, value) {
        if (prop === 'globalAlpha' && typeof value === 'number') alpha = value;
        if (prop === 'fillStyle' && typeof value === 'string') fillStyles.push(value);
        if (prop === 'strokeStyle' && typeof value === 'string') strokeStyles.push(value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
  return { ctx, labels, labelAlphas, dashes, fillAlphas, fillStyles, strokeStyles };
}

function plan(): CanvasMotionPlan {
  const gcode = 'G21\nG90\nM3 S0\nG0 X0 Y0\nG1 X10 S500\nG1 X20 S0';
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'draw-a',
    machineKind: 'laser',
    device: { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' },
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ],
    jobStart: { x: 0, y: 0 },
    approachFrom: { x: -5, y: 0 },
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 0,
  };
}

describe('drawCanvasMotionOverlay', () => {
  it('draws automatic frame/job markers and the frame direction', () => {
    const canvasPlan = plan();
    const recording = recordingContext();
    drawCanvasMotionOverlay(
      recording.ctx,
      { plan: canvasPlan, run: null },
      {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      },
    );
    expect(recording.labels).toContain('FRAME START');
    expect(recording.labels).toContain('JOB START');
    expect(recording.labelAlphas).toEqual(
      expect.arrayContaining([
        { label: 'FRAME START', alpha: 0.5 },
        { label: 'JOB START', alpha: 0.5 },
      ]),
    );
    expect(recording.fillAlphas).toEqual([1, 1]);
    expect(recording.fillStyles).toContain('rgba(255, 255, 255, 0.2)');
    expect(recording.dashes).toContainEqual([5, 5]);
  });

  it('uses solid red for confirmed process and dashed red for confirmed travel', () => {
    const canvasPlan = plan();
    const run = {
      ...startLiveCanvasRun(canvasPlan),
      route: {
        confirmedRouteMm: canvasPlan.manifest.totalRouteMm,
        candidates: [],
        uncertain: false,
      },
    };
    const recording = recordingContext();
    drawCanvasMotionOverlay(
      recording.ctx,
      { plan: canvasPlan, run },
      {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      },
    );
    expect(recording.strokeStyles).toContain('#dc2626');
    expect(recording.dashes).toContainEqual([]);
    expect(recording.dashes).toContainEqual([6, 4]);
  });

  it('hides only static start markers while retaining the approach route', () => {
    const recording = recordingContext();
    drawCanvasMotionOverlay(
      recording.ctx,
      { plan: plan(), run: null, showStartMarkers: false },
      { scale: 1, offsetX: 0, offsetY: 0 },
    );

    expect(recording.labels).not.toContain('FRAME START');
    expect(recording.labels).not.toContain('JOB START');
    expect(recording.dashes).toContainEqual([5, 5]);
  });
});
