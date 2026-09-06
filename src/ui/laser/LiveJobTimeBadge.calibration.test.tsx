import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { estimateJobDuration, formatDuration, type Job } from '../../core/job';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { grblStrategy } from '../../core/output';
import { fingerprintGcode } from '../../core/recovery';
import { canvasJobTimingPlan } from '../state/canvas-job-timing-plan';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { liveCanvasStartPatch } from '../state/live-canvas-run';
import { useLaserStore } from '../state/laser-store';
import { LiveJobTimeBadge } from './LiveJobTimeBadge';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = { x: 0, y: 0, z: 0 };
const DEVICE = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  estimateCutTimeScale: 2,
  estimateTravelTimeScale: 3,
};
const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'cut',
      color: '#000000',
      power: 50,
      speed: 600,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: false,
          polyline: [
            { x: 10, y: 0 },
            { x: 110, y: 0 },
          ],
        },
      ],
    },
  ],
};

function canvasPlan(gcode: string): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(gcode, { machineKind: 'laser', initialPosition: ORIGIN }),
    fingerprint: fingerprintGcode(gcode),
    retentionKey: 'calibrated-countdown',
    machineKind: 'laser',
    device: DEVICE,
    coordinateFrame: { kind: 'machine', workOffsetMm: ORIGIN },
    framePerimeter: [],
    jobStart: ORIGIN,
    approachFrom: ORIGIN,
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: 11,
  };
}

describe('live countdown calibration handoff', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;
  const originalRun = useLaserStore.getState().liveCanvasRun ?? null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    useLaserStore.setState({ liveCanvasRun: originalRun });
    vi.useRealTimers();
  });

  it('keeps independent cut and travel calibration when the badge switches to live timing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    useLaserStore.setState({ liveCanvasRun: null });
    const estimate = estimateJobDuration(JOB, DEVICE);
    const gcode = grblStrategy.emit(JOB, DEVICE);
    expect(gcode).toBe(
      grblStrategy.emit(JOB, { ...DEVICE, estimateCutTimeScale: 1, estimateTravelTimeScale: 1 }),
    );
    const timing = canvasJobTimingPlan(gcode, DEVICE, ORIGIN, {
      controllerSessionEpoch: 7,
      positionEpoch: 11,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    });
    if (timing.kind !== 'ok') throw new Error(timing.reason);
    // 10.01 seconds cutting and 1.4 seconds rapid travel become 20.02 + 4.2.
    expect(estimate.totalSeconds).toBeCloseTo(24.22, 6);
    expect(timing.plan.totalSeconds).toBeCloseTo(24.22, 5);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <LiveJobTimeBadge
          estimate={{
            kind: 'estimated',
            label: formatDuration(estimate.totalSeconds),
            ...estimate,
          }}
        />,
      ),
    );
    expect(host.textContent).toBe('≈ 24s');
    await act(async () =>
      useLaserStore.setState(liveCanvasStartPatch(canvasPlan(gcode), Date.now(), timing)),
    );
    expect(host.textContent).toBe('Estimating · ~24s remaining');
    await act(async () => vi.advanceTimersByTime(5000));
    expect(host.textContent).toBe('Estimating · ~24s remaining');
  });
});
