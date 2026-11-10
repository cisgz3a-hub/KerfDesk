// ADR-695 Amendment 1 (rolling audit v13 Y5-P1-1) against the four-axis
// grblHAL simulator with the real store, Frame, Job Review and Start: after an
// ABORT JOB part way round the part, Restore saved origin turns the rotary back
// to the turn the job started from, so the re-run's own `G92 A0` zeroes the
// same turn and its burns land on the half-burned part.

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { operatorAbortAlarm, restoreOriginAfterAbort } from './abort-alarm-recovery';
import { rotaryTurnSinceAbort } from './abort-rotary-turn';
import {
  drive,
  harness,
  installRecoveryStressHooks,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };
const ROTARY: RotarySetup = {
  enabled: true,
  type: 'chuck',
  axis: 'A',
  axisConfirmed: 'A',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

// Twenty stripes round the part, each its own outline, so the job turns A
// back and forth through many acknowledged lines before it ends.
function stripesRoundThePart(): Project {
  const project = createProject({
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'grblhal',
    rotary: ROTARY,
  });
  const color = '#ff0000';
  const objects = Array.from({ length: 20 }, (_, index) => ({
    kind: 'imported-svg' as const,
    id: `stripe-${index}`,
    source: `stripe-${index}.svg`,
    bounds: { minX: 4 + index * 2, minY: 4, maxX: 4 + index * 2, maxY: 120 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 4 + index * 2, y: 4 },
              { x: 4 + index * 2, y: 120 },
            ],
          },
        ],
      },
    ],
  }));
  return {
    ...project,
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'red', color }), power: 30, airAssist: false }],
      objects,
    },
  };
}

describe('Abort and re-run on an A rotary, four-axis grblHAL simulator', () => {
  it(
    'turns the part back to where the job started, so the re-run zeroes the same turn',
    async () => {
      const h = await harness({
        simulator: {
          firmware: 'grblhal',
          firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
          fourthAxisA: true,
          motionMs: 400,
        },
        project: stripesRoundThePart(),
      });
      useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
      // Put the part at a turn of its own, then set the XY origin.
      await drive(useLaserStore.getState().jog({ da: 37, feed: 1500 }));
      await tick(1_500);
      await drive(useLaserStore.getState().jog({ dx: ORIGIN.x, dy: ORIGIN.y, feed: 3_000 }));
      await tick(1_500);
      await drive(useLaserStore.getState().setOriginHere());
      await tick(1_500);

      const { running } = await startFramedJob(h.repository);
      await tick(2_500);
      await drive(useLaserStore.getState().stopJob('operator'));
      await drive(running).catch(() => undefined);
      await tick(1_500);

      const firstZero = h.simulator.state().aAxis?.g92 ?? NaN;
      expect(firstZero).toBeCloseTo(37, 3);
      const request = operatorAbortAlarm(useLaserStore.getState());
      expect(request?.rotaryStartTurn).toEqual({ axis: 'A', machine: firstZero });
      // The part stopped somewhere round the turn, away from where it started.
      const since = rotaryTurnSinceAbort(useLaserStore.getState())?.since ?? 0;
      expect(Math.abs(since)).toBeGreaterThan(1);

      await drive(restoreOriginAfterAbort(ORIGIN, false, request?.rotaryStartTurn));
      await tick(1_500);
      expect(h.simulator.state().aAxis?.mpos).toBeCloseTo(firstZero, 3);

      const rerun = await startFramedJob(h.repository);
      await drive(rerun.running);
      await tick(1_500);
      // The re-run's own G92 A0 zeroed the same machine turn as the first run.
      expect(h.simulator.state().aAxis?.g92).toBeCloseTo(firstZero, 3);
      expect(useLaserStore.getState().lastWriteError).toBeNull();
    },
    STRESS_TIMEOUT_MS,
  );
});
